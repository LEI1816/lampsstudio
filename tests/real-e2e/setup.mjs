import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const testRoot = path.join(root, ".test-data", "full-e2e");
const reportDir = path.join(testRoot, "reports");
const fixtureDir = path.join(testRoot, "fixtures");
const generatedDir = path.join(root, "public", "generated-real-e2e");
const sourceDbPath = path.join(root, "data", "mock-db.json");
const testDbPath = path.join(testRoot, "mock-db.json");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function makeFixturePng(filePath, { accent = [37, 99, 235], shade = [15, 23, 42] } = {}) {
  const width = 128;
  const height = 128;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = 1 + x * 4;
      const inBase = x > 42 && x < 86 && y > 82 && y < 94;
      const inStem = x > 60 && x < 68 && y > 44 && y < 88;
      const dx = x - 64;
      const dy = y - 42;
      const inShade = dx * dx + dy * dy * 1.8 < 900 && y > 18 && y < 66;
      const inGlow = dx * dx + (y - 72) * (y - 72) < 180;
      const color = inBase || inStem ? shade : inShade ? accent : inGlow ? [253, 224, 71] : [245, 247, 250];
      row[i] = color[0];
      row[i + 1] = color[1];
      row[i + 2] = color[2];
      row[i + 3] = 255;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, png);
}

function compactDb(source) {
  const settings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const users = {};
  for (const account of ["guanliyuan", "17891112627"]) {
    if (source.users?.[account]) {
      users[account] = {
        ...source.users[account],
        balance: account === "17891112627" ? 100000 : Number(source.users[account].balance || 0)
      };
    }
  }
  return {
    users,
    sessions: {},
    jobs: [],
    payments: [],
    settings: {
      ...settings,
      realOpenAIImages: true
    },
    supportMessages: [],
    verificationCodes: {},
    apiKeyLeases: []
  };
}

ensureDir(testRoot);
ensureDir(reportDir);
ensureDir(fixtureDir);
fs.rmSync(generatedDir, { recursive: true, force: true });
ensureDir(generatedDir);
fs.rmSync(path.join(testRoot, "exports"), { recursive: true, force: true });

const sourceDb = fs.existsSync(sourceDbPath) ? JSON.parse(fs.readFileSync(sourceDbPath, "utf8")) : {};
const db = compactDb(sourceDb);
fs.writeFileSync(testDbPath, JSON.stringify(db, null, 2));

makeFixturePng(path.join(fixtureDir, "lamp-a.png"), { accent: [37, 99, 235], shade: [17, 24, 39] });
makeFixturePng(path.join(fixtureDir, "lamp-b.png"), { accent: [16, 185, 129], shade: [55, 65, 81] });
makeFixturePng(path.join(fixtureDir, "lamp-reference.png"), { accent: [168, 85, 247], shade: [31, 41, 55] });

const manifest = {
  preparedAt: new Date().toISOString(),
  sourceDbBytes: fs.existsSync(sourceDbPath) ? fs.statSync(sourceDbPath).size : 0,
  testDbBytes: fs.statSync(testDbPath).size,
  testDbPath,
  fixtureDir,
  generatedDir,
  reportDir
};
fs.writeFileSync(path.join(testRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`[real-e2e] prepared isolated database at ${testDbPath}`);
