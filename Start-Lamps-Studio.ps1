$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ProjectDir ".env"
$Port = 4192
$EnvValues = @{}

if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $Line = $_.Trim()
    if (-not $Line -or $Line.StartsWith("#")) {
      return
    }
    if ($Line -match "^([^=]+)=(.*)$") {
      $Key = $Matches[1].Trim()
      $Value = $Matches[2].Trim().Trim('"').Trim("'")
      $EnvValues[$Key] = $Value
    }
  }
}

if ($EnvValues.ContainsKey("PORT") -and $EnvValues["PORT"] -match "^\d+$") {
  $Port = [int]$EnvValues["PORT"]
}

$HostBind = "0.0.0.0"
if ($EnvValues.ContainsKey("HOST") -and -not [string]::IsNullOrWhiteSpace($EnvValues["HOST"])) {
  $HostBind = $EnvValues["HOST"]
}

function Resolve-ProjectPath([string]$Value, [string]$Fallback) {
  $Next = $Value
  if ([string]::IsNullOrWhiteSpace($Next)) {
    $Next = $Fallback
  }
  if ([System.IO.Path]::IsPathRooted($Next)) {
    return $Next
  }
  return (Join-Path $ProjectDir $Next)
}

$HttpsEnabled = $EnvValues.ContainsKey("LAMPS_HTTPS") -and $EnvValues["LAMPS_HTTPS"] -eq "1"
$HttpsKeyPath = Resolve-ProjectPath $EnvValues["LAMPS_HTTPS_KEY_PATH"] "certs\lamps.local-key.pem"
$HttpsCertPath = Resolve-ProjectPath $EnvValues["LAMPS_HTTPS_CERT_PATH"] "certs\lamps.local.pem"
$Protocol = "http"
if ($HttpsEnabled -and (Test-Path -LiteralPath $HttpsKeyPath) -and (Test-Path -LiteralPath $HttpsCertPath)) {
  $Protocol = "https"
}

function Ensure-LampsFirewallRule([int]$RulePort) {
  $RuleName = "Lamps Studio LAN $RulePort"
  try {
    $ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($ExistingRule) {
      Set-NetFirewallRule -DisplayName $RuleName -Enabled True -Direction Inbound -Action Allow -Profile Any | Out-Null
      $ExistingRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort $RulePort | Out-Null
      return
    }
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $RulePort -Profile Any | Out-Null
  } catch {
    Write-Warning "Could not create firewall rule for port $RulePort. Run this launcher as Administrator if LAN clients cannot connect."
  }
}

Ensure-LampsFirewallRule $Port

$CacheVersion = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$Url = "${Protocol}://localhost:$Port/?latest=$CacheVersion"
$NodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $NodeExe)) {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($NodeCommand) {
    $NodeExe = $NodeCommand.Source
  }
}

if (-not (Test-Path -LiteralPath $NodeExe)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Node.js was not found. Please install Node.js or add it to PATH.", "lamps studio")
  exit 1
}

$Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($Connection in $Listening) {
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Connection.OwningProcess)" -ErrorAction SilentlyContinue
  if ($Process -and $Process.CommandLine -like "*server.js*") {
    Stop-Process -Id $Process.ProcessId -Force
  }
}

$OutLog = Join-Path $ProjectDir "server.out.log"
$ErrLog = Join-Path $ProjectDir "server.err.log"
Start-Process -FilePath $NodeExe -ArgumentList "server.js" -WorkingDirectory $ProjectDir -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -WindowStyle Hidden

$Ready = $false
for ($i = 0; $i -lt 20; $i += 1) {
  Start-Sleep -Milliseconds 500
  $Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($Listening) {
    $Ready = $true
    break
  }
}

if (-not $Ready) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("lamps studio did not start. Please check server.err.log in the project folder.", "lamps studio")
  exit 1
}

Start-Process $Url
