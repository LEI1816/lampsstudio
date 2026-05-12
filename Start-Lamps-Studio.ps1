$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ProjectDir ".env"
$Port = 4192

if (Test-Path -LiteralPath $EnvFile) {
  Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $Line = $_.Trim()
    if ($Line -match "^PORT\s*=\s*(\d+)") {
      $script:Port = [int]$Matches[1]
    }
  }
}

$CacheVersion = [DateTimeOffset]::Now.ToUnixTimeSeconds()
$Url = "http://localhost:$Port/?latest=$CacheVersion"
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
if (-not $Listening) {
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
}

Start-Process $Url
