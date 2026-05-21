import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import QRCode from "qrcode";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

loadEnvFile(path.join(__dirname, ".env"));

function resolveWorkspacePath(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return path.resolve(__dirname, raw);
}

const PORT = Number(process.env.PORT || 4177);
const HOST = process.env.HOST || "0.0.0.0";
const HTTPS_ENABLED = process.env.LAMPS_HTTPS === "1";
const HTTPS_KEY_PATH = resolveWorkspacePath(process.env.LAMPS_HTTPS_KEY_PATH, path.join(__dirname, "certs", "lamps.local-key.pem"));
const HTTPS_CERT_PATH = resolveWorkspacePath(process.env.LAMPS_HTTPS_CERT_PATH, path.join(__dirname, "certs", "lamps.local.pem"));
const DB_PATH = resolveWorkspacePath(process.env.LAMPS_DB_PATH, path.join(__dirname, "data", "mock-db.json"));
const DATA_DIR = path.dirname(DB_PATH);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_EXPORT_DIR = resolveWorkspacePath(process.env.LAMPS_EXPORT_DIR, path.join(__dirname, "exports"));
const GENERATED_IMAGE_DIR = resolveWorkspacePath(process.env.LAMPS_GENERATED_IMAGE_DIR, path.join(PUBLIC_DIR, "generated"));
const GENERATION_HISTORY_LIMITS = Object.freeze({
  product: 15,
  style: 10,
  templates: 10
});

const DEFAULT_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const DEFAULT_ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || process.env.GEMINI_ANALYSIS_MODEL || "gpt-5.2";
const REAL_OPENAI_IMAGES = process.env.REAL_OPENAI_IMAGES === "1";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const ALIPAY_GATEWAY = process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do";
const DEFAULT_APIYI_BASE_URL = "https://api.apiyi.com/v1";
const DEFAULT_YUNWU_BASE_URL = process.env.YUNWU_BASE_URL || "https://yunwu.ai/v1";
const DEFAULT_SUB2API_BASE_URL = process.env.SUB2API_BASE_URL || "";
const DEFAULT_SUB2API_ADMIN_PATH = process.env.SUB2API_ADMIN_PATH || "/admin";
const ADMIN_ACCOUNT = "guanliyuan";
const ADMIN_PASSWORD = "guanliyuan123";
const TEST_USER_PHONE = "17891112627";
const TEST_USER_PASSWORD = "guanliyuan123";
const ANALYSIS_PLAN_CACHE_MAX = 80;
const REFERENCE_MOUNT_TARGET_CACHE_MAX = 160;
const REFERENCE_MOUNT_TARGET_CONCURRENCY = Math.max(
  1,
  Math.min(4, Math.floor(Number(process.env.REFERENCE_MOUNT_TARGET_CONCURRENCY || 2) || 2))
);
const GENERATION_STREAM_HEARTBEAT_MS = Math.max(
  5000,
  Math.floor(Number(process.env.GENERATION_STREAM_HEARTBEAT_MS || 15000) || 15000)
);
const COLLAGE_CLEAN_PRODUCT_CACHE_MAX = 80;
const analysisPlanCache = new Map();
const referenceMountTargetCache = new Map();
const collageCleanProductCache = new Map();
const collageCleanProductInFlight = new Map();
const modelChannelRuntime = new Map();
const MODEL_CHANNEL_SECRET = process.env.LAMPS_MODEL_CHANNEL_SECRET || process.env.MODEL_CHANNEL_SECRET || ADMIN_PASSWORD;
const MODEL_CHANNEL_COOLDOWN_MS = Math.max(10000, Number(process.env.MODEL_CHANNEL_COOLDOWN_MS || 45000) || 45000);
const MODEL_CHANNEL_RETRY_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.MODEL_CHANNEL_RETRY_ATTEMPTS || 3) || 3));
const DESIGN_SPEC_ANALYSIS_TIMEOUT_MS = Math.max(60000, Number(process.env.DESIGN_SPEC_ANALYSIS_TIMEOUT_MS || 150000) || 150000);
const STYLE_IMAGE_GENERATION_CONCURRENCY = Math.max(
  1,
  Math.min(6, Math.floor(Number(process.env.STYLE_IMAGE_GENERATION_CONCURRENCY || process.env.STYLE_CLONE_GENERATION_CONCURRENCY || 4) || 4))
);
const STYLE_GENERATION_SHOT_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(4, Math.floor(Number(process.env.STYLE_IMAGE_GENERATION_SHOT_MAX_ATTEMPTS || process.env.STYLE_CLONE_SHOT_MAX_ATTEMPTS || 2) || 2))
);
const RELIABLE_GENERATION_SHOT_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(8, Math.floor(Number(process.env.IMAGE_GENERATION_SHOT_MAX_ATTEMPTS || process.env.GENERATION_SHOT_MAX_ATTEMPTS || 4) || 4))
);
const RELIABLE_GENERATION_ROUND_PAUSE_MS = Math.max(
  1000,
  Math.floor(Number(process.env.IMAGE_GENERATION_ROUND_PAUSE_MS || 6000) || 6000)
);

const MODEL_OPTIONS = [
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    provider: "gemini",
    apiModel: "gemini-3.1-flash-image-preview",
    badge: "",
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    provider: "gemini",
    apiModel: "gemini-3-pro-image-preview",
    badge: "",
  },
  {
    id: "gpt-image-2",
    label: "GPT Image-2",
    provider: "openai",
    apiModel: "gpt-image-2",
    badge: "",
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image-1.5",
    provider: "openai",
    apiModel: "gpt-image-1.5",
    badge: "",
  },
  {
    id: "chatgpt-image-latest",
    label: "ChatGPT Images",
    provider: "openai",
    apiModel: "chatgpt-image-latest",
    badge: "通用"
  }
];

const MODEL_ALIASES = {
  image2: "gpt-image-2",
  "image-2": "gpt-image-2",
  "Image 2": "gpt-image-2"
};

function normalizeImageModelId(id = "") {
  const value = String(id || "").trim();
  return MODEL_ALIASES[value] || MODEL_ALIASES[value.toLowerCase()] || value;
}

const ANALYSIS_MODEL_OPTIONS = [
  {
    id: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    provider: "google",
    badge: "",
  },
  {
    id: "gemini-3.1-flash",
    label: "Gemini 3.1 Flash",
    provider: "google",
    badge: "",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    badge: "",
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.2-pro",
    label: "GPT-5.2 Pro",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5.1",
    label: "GPT-5.1",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4.1-nano",
    label: "GPT-4.1 Nano",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "gpt-4-turbo",
    label: "GPT-4 Turbo",
    provider: "openai-compatible",
    badge: "",
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "openai-compatible",
    badge: "鏂囨湰"
  }
];

const POINTS_PER_YUAN = 10;
const BASE_IMAGE_COST_YUAN = 1.2;
const BASE_IMAGE_CREDITS = POINTS_PER_YUAN * BASE_IMAGE_COST_YUAN;

const CREDIT_RULES = {
  pointsPerYuan: POINTS_PER_YUAN,
  baseImageCostYuan: BASE_IMAGE_COST_YUAN,
  baseImageCredits: BASE_IMAGE_CREDITS,
  planningFee: 0,
  clarity: {
    "1k": { label: "", multiplier: 0.8 },
    "2k": { label: "2K 高清", multiplier: 1 },
    "4k": { label: "4K 高清", multiplier: 1.6 }
  },
  speed: {
    standard: { label: "鏍囧噯", multiplier: 1 },
    fast: { label: "", multiplier: 1.25 },
    turbo: { label: "", multiplier: 1.6 }
  },
  model: {
    "nano-banana-2": 1,
    "nano-banana-pro": 1.25,
    "gpt-image-2": 1.3,
    "gpt-image-1.5": 1.15,
    "chatgpt-image-latest": 1.2
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 16,
    fileSize: 12 * 1024 * 1024
  }
});

const suiteUpload = upload.fields([
  { name: "photos", maxCount: 12 },
  { name: "templateReferences", maxCount: 4 },
  { name: "editBase", maxCount: 1 },
  { name: "textRegion", maxCount: 1 }
]);

const app = express();
app.use(
  express.json({
    limit: "40mb",
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    }
  })
);
app.use(
  express.urlencoded({
    extended: false,
    verify: (req, _res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    }
  })
);
app.use(
  express.static(PUBLIC_DIR, {
    etag: false,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  })
);

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, sessions: {}, jobs: [] }, null, 2));
  }
}

function loadDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  db.users ||= {};
  db.sessions ||= {};
  db.jobs ||= [];
  db.payments ||= [];
  db.settings ||= {};
  db.apiKeyLeases ||= [];
  db.supportMessages ||= [];
  db.verificationCodes ||= {};
  ensureAdminUser(db);
  ensureTestUser(db);
  return db;
}

function saveDb(db) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "").slice(0, 11);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeLoginId(value) {
  const raw = String(value || "").trim();
  const phone = normalizePhone(raw);
  if (/^1\d{10}$/.test(phone)) return phone;
  return raw.toLowerCase();
}

function parsePublicAuthAccount(value) {
  const raw = String(value || "").trim();
  const phone = normalizePhone(raw);
  if (/^1\d{10}$/.test(phone)) return { type: "phone", account: phone, phone, email: "" };
  const email = normalizeEmail(raw);
  if (isValidEmail(email)) return { type: "email", account: email, phone: "", email };
  return null;
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function makePasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false;
  const { hash } = makePasswordHash(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function ensureAdminUser(db) {
  const existing = db.users[ADMIN_ACCOUNT];
  if (existing?.role === "admin" && existing.passwordHash) return;
  const { salt, hash } = makePasswordHash(ADMIN_PASSWORD);
  db.users[ADMIN_ACCOUNT] = {
    ...(existing || {}),
    account: ADMIN_ACCOUNT,
    username: ADMIN_ACCOUNT,
    phone: "",
    role: "admin",
    name: "",
    balance: Number(existing?.balance || 0),
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: existing?.createdAt || new Date().toISOString()
  };
}

function ensureTestUser(db) {
  const existing = db.users[TEST_USER_PHONE];
  const { salt, hash } = makePasswordHash(TEST_USER_PASSWORD);
  db.users[TEST_USER_PHONE] = {
    ...(existing || {}),
    account: TEST_USER_PHONE,
    username: "",
    phone: TEST_USER_PHONE,
    role: "user",
    name: `测试用户 ${TEST_USER_PHONE.slice(-4)}`,
    balance: Number(existing?.balance ?? 100),
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: existing?.createdAt || new Date().toISOString()
  };
}

function publicUser(user) {
  return {
    account: user.account || user.phone || user.username,
    username: user.username || "",
    phone: user.phone,
    email: user.email || "",
    role: user.role || "user",
    name: user.name,
    balance: Number(user.balance || 0),
    createdAt: user.createdAt
  };
}

function userAccount(user = {}) {
  return user.account || user.phone || user.username || "";
}

function paymentStatusText(status = "") {
  const map = {
    pending: "待支付",
    paid: "已支付",
    create_failed: "创建失败",
    amount_mismatch: "金额异常"
  };
  return map[status] || status || "-";
}

function jobStatusText(status = "") {
  const map = {
    completed: "已完成",
    partial: "部分完成",
    failed: "失败",
    running: "生成中",
  };
  return map[status] || status || "-";
}

function jobTypeLabel(job = {}) {
  const settings = job.settings || {};
  const counts = job.counts || {};
  if (settings.styleCloneMode) {
    if (settings.similarMode && settings.similarMode !== "none") return "风格复刻";
    return "换主体";
  }
  if (isCollageTemplateSettings(settings)) return "拼图中心";
  if (counts.main && !counts.selling && !counts.function && !counts.scene && !counts.detail && !counts.real) return "主图";
  if (counts.main) return "主图与详情图";
  return "详情图组";
}

function publicPayment(payment = {}) {
  return {
    id: payment.id,
    provider: payment.provider,
    account: payment.account || payment.phone || "",
    phone: payment.phone || "",
    amount: Number(payment.amount || 0),
    creditAmount: Number(payment.creditAmount || 0),
    status: payment.status || "",
    statusText: paymentStatusText(payment.status),
    createdAt: payment.createdAt || "",
    paidAt: payment.paidAt || "",
    apiKeyLeaseId: payment.apiKeyLeaseId || ""
  };
}

function publicConsumption(job = {}) {
  const shots = Array.isArray(job.shots) ? job.shots : [];
  const totalImages =
    shots.length ||
    SHOT_CATEGORY_KEYS.reduce((sum, key) => sum + Number(job.counts?.[key] || 0), 0);
  return {
    id: job.id,
    account: job.account || "",
    type: jobTypeLabel(job),
    status: job.status || "",
    statusText: jobStatusText(job.status),
    credits: Number(job.credits || 0),
    estimatedCredits: Number(job.estimatedCredits || job.credits || 0),
    totalImages,
    model: job.model?.label || job.settings?.model || "",
    apiKeyLease: job.apiKeyLease?.keyMasked || "",
    createdAt: job.createdAt || job.completedAt || ""
  };
}

function generationWorkspaceKey(job = {}) {
  const settings = job.settings || {};
  if (isCollageTemplateSettings(settings)) return "templates";
  if (settings.styleCloneMode) return "style";
  return "product";
}

function generationHistoryLimit(workspaceKey = "product") {
  return GENERATION_HISTORY_LIMITS[workspaceKey] || GENERATION_HISTORY_LIMITS.product;
}

function generationSourceLabel(workspaceKey = "product", job = {}) {
  if (workspaceKey === "style") return "椋庢牸澶嶅埢";
  if (workspaceKey === "templates") return "拼图中心";
  const counts = job.counts || {};
  return counts.main && !counts.selling && !counts.function && !counts.scene && !counts.detail && !counts.real ? "商品主图" : "详情图组";
}

function generationCategoryLabel(category = "") {
  const map = {
    main: "主图",
    selling: "卖点图",
    function: "功能图",
    scene: "场景图",
    detail: "细节图",
    real: "实拍图",
    collage: "拼图"
  };
  return map[category] || "图片";
}

function publicGenerationHistoryItem(job = {}, shot = {}, index = 0) {
  const workspaceKey = generationWorkspaceKey(job);
  const createdSource = shot.regeneratedAt || shot.createdAt || job.completedAt || job.createdAt || new Date().toISOString();
  const createdAt = Number.isFinite(Date.parse(createdSource)) ? Date.parse(createdSource) : Date.now();
  return {
    key: `${job.id || "job"}:${shot.id || `shot-${index + 1}`}:${index}`,
    workspaceKey,
    source: generationSourceLabel(workspaceKey, job),
    title: shot.title || `${generationSourceLabel(workspaceKey, job)} ${index + 1}`,
    category: shot.category || "",
    categoryLabel: generationCategoryLabel(shot.category),
    imageUrl: shot.imageUrl || "",
    prompt: shot.prompt || "",
    savedPath: shot.savedPath || "",
    createdAt
  };
}

function accountGenerationHistory(db, account) {
  const history = { product: [], style: [], templates: [] };
  (db.jobs || [])
    .filter((job) => job.account === account)
    .forEach((job) => {
      const workspaceKey = generationWorkspaceKey(job);
      (Array.isArray(job.shots) ? job.shots : []).forEach((shot, index) => {
        if (shot?.imageUrl) history[workspaceKey].push(publicGenerationHistoryItem(job, shot, index));
      });
    });
  Object.keys(history).forEach((key) => {
    history[key] = history[key].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).slice(0, generationHistoryLimit(key));
  });
  return history;
}

function generatedImageCachePathFromUrl(imageUrl = "") {
  const value = String(imageUrl || "").trim();
  if (!value || /^data:image\//i.test(value)) return "";
  let pathname = "";
  if (value.startsWith("/")) {
    pathname = value.split(/[?#]/)[0];
  } else if (/^https?:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return "";
    }
  }
  if (!pathname || !pathname.startsWith("/generated/")) return "";
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    decodedPathname = pathname;
  }
  const relative = decodedPathname.replace(/^\/+/, "").replace(/\//g, path.sep);
  const resolved = path.resolve(PUBLIC_DIR, relative);
  const generatedRoot = path.resolve(GENERATED_IMAGE_DIR);
  if (resolved === generatedRoot || !resolved.startsWith(`${generatedRoot}${path.sep}`)) return "";
  return resolved;
}

function generatedCacheCreatedAt(job = {}, shot = {}) {
  const source = shot.regeneratedAt || shot.createdAt || job.completedAt || job.createdAt || "";
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountWorkspaceGeneratedShots(db, account, workspaceKey) {
  const entries = [];
  (db.jobs || [])
    .filter((job) => job.account === account && generationWorkspaceKey(job) === workspaceKey)
    .forEach((job) => {
      (Array.isArray(job.shots) ? job.shots : []).forEach((shot, index) => {
        if (!shot?.imageUrl) return;
        entries.push({ job, shot, index, createdAt: generatedCacheCreatedAt(job, shot) });
      });
    });
  return entries.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function unlinkGeneratedCacheFile(filePath = "") {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.warn("[generated-cache] cleanup failed:", filePath, error instanceof Error ? error.message : error);
  }
}

function pruneGeneratedImageCache(db, account, workspaceKey) {
  if (!account || !workspaceKey) return false;
  const entries = accountWorkspaceGeneratedShots(db, account, workspaceKey);
  const retainedEntries = entries.slice(0, generationHistoryLimit(workspaceKey));
  const retained = new Set(retainedEntries.map(({ shot }) => shot));
  const keepPaths = new Set();
  retainedEntries.forEach(({ shot }) => {
    ["imageUrl", "textImageUrl", "noTextImageUrl"].forEach((field) => {
      const filePath = generatedImageCachePathFromUrl(shot?.[field]);
      if (filePath) keepPaths.add(filePath);
    });
  });
  const deletedPaths = new Set();
  let mutated = false;

  entries.forEach(({ shot }) => {
    const keepPrimary = retained.has(shot);
    ["imageUrl", "textImageUrl", "noTextImageUrl"].forEach((field) => {
      const value = String(shot?.[field] || "");
      if (!value) return;
      if (keepPrimary) return;
      const filePath = generatedImageCachePathFromUrl(value);
      if (filePath && !keepPaths.has(filePath) && !deletedPaths.has(filePath)) {
        unlinkGeneratedCacheFile(filePath);
        deletedPaths.add(filePath);
      }
      if (filePath || /^data:image\//i.test(value)) {
        shot[field] = "";
        mutated = true;
        if (field === "imageUrl") shot.imageExpired = true;
      }
    });
  });

  return mutated;
}

function pruneAccountGeneratedImageCache(db, account, workspaceKey = "") {
  const keys = workspaceKey ? [workspaceKey] : ["product", "style", "templates"];
  return keys.reduce((mutated, key) => pruneGeneratedImageCache(db, account, key) || mutated, false);
}

function getAppSettings(db) {
  db.settings ||= {};
  if (!db.settings.defaultImageModel) db.settings.defaultImageModel = DEFAULT_IMAGE_MODEL;
  db.settings.defaultImageModel = normalizeImageModelId(db.settings.defaultImageModel);
  if (!findModel(db.settings.defaultImageModel)) db.settings.defaultImageModel = DEFAULT_IMAGE_MODEL;
  if (!db.settings.defaultAnalysisModel) {
    db.settings.defaultAnalysisModel = db.settings.defaultTextModel || DEFAULT_ANALYSIS_MODEL;
  }
  if (!isSupportedAnalysisModel(db.settings.defaultAnalysisModel)) {
    db.settings.defaultAnalysisModel = DEFAULT_ANALYSIS_MODEL;
  }
  if (typeof db.settings.realOpenAIImages !== "boolean") db.settings.realOpenAIImages = REAL_OPENAI_IMAGES;
  if (typeof db.settings.supportOnlineReply !== "boolean") db.settings.supportOnlineReply = true;
  db.settings.supportWechat ||= "";
  db.settings.supportWechatQrUrl ||= "";
  db.settings.supportWelcome ||= "";
  db.settings.apiyiApiKey ||= "";
  db.settings.apiyiBaseUrl ||= DEFAULT_APIYI_BASE_URL;
  if (typeof db.settings.apiyiEnabled !== "boolean") db.settings.apiyiEnabled = true;
  db.settings.yunwuApiKey ||= "";
  db.settings.yunwuBaseUrl ||= DEFAULT_YUNWU_BASE_URL;
  if (typeof db.settings.yunwuEnabled !== "boolean") db.settings.yunwuEnabled = false;
  if (!Array.isArray(db.settings.modelChannels)) db.settings.modelChannels = [];
  db.settings.sub2apiBaseUrl ||= DEFAULT_SUB2API_BASE_URL;
  db.settings.sub2apiAdminToken ||= "";
  db.settings.sub2apiDashboardPath ||= DEFAULT_SUB2API_ADMIN_PATH;
  if (typeof db.settings.sub2apiEnabled !== "boolean") db.settings.sub2apiEnabled = false;
  db.settings.smsAccessKeyId ||= "";
  db.settings.smsAccessKeySecret ||= "";
  db.settings.smsSignName ||= "";
  db.settings.smsTemplateCode ||= "";
  db.settings.smtpHost ||= "";
  db.settings.smtpPort ||= "";
  if (typeof db.settings.smtpSecure !== "boolean") db.settings.smtpSecure = true;
  db.settings.smtpUser ||= "";
  db.settings.smtpPass ||= "";
  db.settings.smtpFrom ||= "";
  return db.settings;
}

function effectiveOpenAIKey(db) {
  return getAppSettings(db).openaiApiKey || process.env.OPENAI_API_KEY || "";
}

function effectiveGeminiKey(db) {
  return getAppSettings(db).geminiApiKey || process.env.GEMINI_API_KEY || "";
}

function effectiveAPIYiKey(db) {
  return getAppSettings(db).apiyiApiKey || process.env.APIYI_API_KEY || process.env.APIYI_KEY || "";
}

function effectiveAPIYiBaseUrl(db) {
  return (getAppSettings(db).apiyiBaseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "");
}

function effectiveYunwuKey(db) {
  return getAppSettings(db).yunwuApiKey || process.env.YUNWU_API_KEY || process.env.YUNWU_KEY || "";
}

function normalizeOpenAICompatibleBaseUrl(value = "", fallback = DEFAULT_YUNWU_BASE_URL) {
  const baseUrl = normalizeHttpBaseUrl(value || fallback);
  const versionBase = baseUrl.match(/^(.*?\/v1(?:beta)?)(?:\/.*)?$/i);
  if (versionBase?.[1]) return normalizeHttpBaseUrl(versionBase[1]);
  return `${baseUrl}/v1`;
}

function effectiveYunwuBaseUrl(db) {
  return normalizeOpenAICompatibleBaseUrl(getAppSettings(db).yunwuBaseUrl || DEFAULT_YUNWU_BASE_URL);
}

function effectiveAPIYiGeminiBaseUrl(db) {
  const baseUrl = effectiveAPIYiBaseUrl(db);
  if (/\/v1beta$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return baseUrl.replace(/\/v1$/i, "/v1beta");
  return `${baseUrl}/v1beta`;
}

function effectiveYunwuGeminiBaseUrl(db) {
  const baseUrl = effectiveYunwuBaseUrl(db);
  if (/\/v1beta$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return baseUrl.replace(/\/v1$/i, "/v1beta");
  return `${baseUrl}/v1beta`;
}

function openAICompatibleImageChannel(db) {
  const settings = getAppSettings(db);
  const yunwuKey = effectiveYunwuKey(db);
  if (settings.yunwuEnabled && yunwuKey) {
    return {
      source: "yunwu",
      apiKey: yunwuKey,
      baseUrl: effectiveYunwuBaseUrl(db),
      providerName: "云雾 API"
    };
  }
  const apiyiKey = effectiveAPIYiKey(db);
  if (settings.apiyiEnabled && apiyiKey) {
    return {
      source: "apiyi",
      apiKey: apiyiKey,
      baseUrl: effectiveAPIYiBaseUrl(db),
      providerName: "API易",
    };
  }
  return {
    source: "openai",
    apiKey: effectiveOpenAIKey(db),
    baseUrl: "https://api.openai.com/v1",
    providerName: "OpenAI"
  };
}

function openAICompatibleBrainChannel(db) {
  const settings = getAppSettings(db);
  const yunwuKey = effectiveYunwuKey(db);
  if (settings.yunwuEnabled && yunwuKey) {
    return {
      source: "yunwu",
      apiKey: yunwuKey,
      baseUrl: effectiveYunwuBaseUrl(db),
      providerName: "云雾 API"
    };
  }
  const apiyiKey = effectiveAPIYiKey(db);
  if (settings.apiyiEnabled && apiyiKey) {
    return {
      source: "apiyi",
      apiKey: apiyiKey,
      baseUrl: effectiveAPIYiBaseUrl(db),
      providerName: "API易",
    };
  }
  const openAIKey = effectiveOpenAIKey(db);
  if (openAIKey) {
    return {
      source: "openai",
      apiKey: openAIKey,
      baseUrl: "https://api.openai.com/v1",
      providerName: "OpenAI"
    };
  }
  return {
    source: "none",
    apiKey: "",
    baseUrl: "",
    providerName: ""
  };
}

function normalizeHttpBaseUrl(value = "") {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Base URL 必须是完整的 http 或 https 地址");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Base URL 只支持 http 或 https");
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizeUrlPath(value = "", fallback = "/") {
  const text = String(value || "").trim() || fallback;
  return text.startsWith("/") ? text : `/${text}`;
}

function effectiveSub2APIBaseUrl(db) {
  const settings = getAppSettings(db);
  return normalizeHttpBaseUrl(settings.sub2apiBaseUrl || process.env.SUB2API_BASE_URL || "");
}

function effectiveSub2APIAdminToken(db) {
  const settings = getAppSettings(db);
  return settings.sub2apiAdminToken || process.env.SUB2API_ADMIN_TOKEN || "";
}

function effectiveSub2APIDashboardUrl(db) {
  const baseUrl = effectiveSub2APIBaseUrl(db);
  if (!baseUrl) return "";
  const settings = getAppSettings(db);
  return `${baseUrl}${normalizeUrlPath(settings.sub2apiDashboardPath || DEFAULT_SUB2API_ADMIN_PATH)}`;
}

async function readJsonMaybe(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function probeSub2API(db) {
  const settings = getAppSettings(db);
  const baseUrl = effectiveSub2APIBaseUrl(db);
  if (!baseUrl) throw new Error("请先填写 Sub2API Base URL");
  const token = effectiveSub2APIAdminToken(db);
  const startedAt = Date.now();
  const healthResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
  const healthBody = await readJsonMaybe(healthResponse);
  const result = {
    ok: healthResponse.ok,
    baseUrl,
    dashboardUrl: effectiveSub2APIDashboardUrl(db),
    enabled: Boolean(settings.sub2apiEnabled),
    healthStatus: healthResponse.status,
    health: healthBody,
    elapsedMs: Date.now() - startedAt,
    adminOk: false,
    adminStatus: token ? "checking" : "missing-token",
    adminEndpoint: "",
    summary: ""
  };
  if (!healthResponse.ok) {
    result.summary = `health ${healthResponse.status}`;
    return result;
  }
  if (!token) {
    result.summary = "health ok, admin token missing";
    return result;
  }
  const adminPaths = [
    "/api/v1/admin/dashboard/stats",
    "/api/v1/admin/dashboard/snapshot-v2",
    "/api/v1/admin/users"
  ];
  let lastStatus = 0;
  let lastBody = null;
  for (const pathname of adminPaths) {
    const adminResponse = await fetch(`${baseUrl}${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });
    const adminBody = await readJsonMaybe(adminResponse);
    lastStatus = adminResponse.status;
    lastBody = adminBody;
    if (adminResponse.ok) {
      result.adminOk = true;
      result.adminStatus = "ok";
      result.adminEndpoint = pathname;
      result.adminSample = adminBody;
      result.summary = `health ok, admin ok via ${pathname}`;
      return result;
    }
  }
  result.adminStatus = `failed-${lastStatus || "unknown"}`;
  result.adminSample = lastBody;
  result.summary = `health ok, admin ${result.adminStatus}`;
  return result;
}

function effectiveRealOpenAIImages(db) {
  return Boolean(getAppSettings(db).realOpenAIImages);
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 10) return "********";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function modelChannelSecretKey() {
  return crypto.createHash("sha256").update(String(MODEL_CHANNEL_SECRET || ADMIN_PASSWORD)).digest();
}

function encryptModelChannelSecret(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (text.startsWith("enc:v1:")) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", modelChannelSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptModelChannelSecret(value = "") {
  const text = String(value || "");
  if (!text || !text.startsWith("enc:v1:")) return text;
  const [, , ivText, tagText, encryptedText] = text.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", modelChannelSecretKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

function modelLabel(modelId) {
  return resolveModel(modelId).label || modelId;
}

function ensureLeaseStore(db) {
  db.apiKeyLeases ||= [];
  return db.apiKeyLeases;
}

function makeVirtualApiKey(modelId) {
  return `ls_${String(modelId || "model").replace(/[^a-zA-Z0-9]+/g, "_")}_${crypto.randomBytes(18).toString("hex")}`;
}

function createUserModelLease(db, user, modelId, credits, source = "system", paymentId = "") {
  if (!user || user.role === "admin") return null;
  const account = user.account || user.phone || user.username;
  const lease = {
    id: `lease_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    account,
    phone: user.phone || "",
    modelId,
    modelLabel: modelLabel(modelId),
    virtualApiKey: makeVirtualApiKey(modelId),
    keyMasked: "",
    totalCredits: Math.max(1, Math.round(Number(credits || 0) * 100) / 100),
    remainingCredits: Math.max(1, Math.round(Number(credits || 0) * 100) / 100),
    status: "active",
    source,
    paymentId,
    createdAt: new Date().toISOString(),
    depletedAt: ""
  };
  lease.keyMasked = maskSecret(lease.virtualApiKey);
  ensureLeaseStore(db).unshift(lease);
  db.apiKeyLeases = db.apiKeyLeases.slice(0, 500);
  return lease;
}

function findActiveUserModelLease(db, user, modelId) {
  if (!user || user.role === "admin") return null;
  const account = user.account || user.phone || user.username;
  return ensureLeaseStore(db).find(
    (lease) =>
      lease.account === account &&
      lease.modelId === modelId &&
      lease.status === "active" &&
      Number(lease.remainingCredits || 0) > 0
  );
}

function ensureUserModelLease(db, user, modelId, neededCredits) {
  if (!user || user.role === "admin") return null;
  return (
    findActiveUserModelLease(db, user, modelId) ||
    createUserModelLease(db, user, modelId, Math.max(Number(user.balance || 0), Number(neededCredits || 1)), "model-selection")
  );
}

function consumeUserModelLease(lease, credits) {
  if (!lease) return;
  lease.remainingCredits = Math.max(0, Math.round((Number(lease.remainingCredits || 0) - Number(credits || 0)) * 100) / 100);
  lease.lastUsedAt = new Date().toISOString();
  if (lease.remainingCredits <= 0) {
    lease.status = "depleted";
    lease.depletedAt = lease.lastUsedAt;
  }
}

function publicLease(lease) {
  return {
    id: lease.id,
    account: lease.account,
    phone: lease.phone || "",
    modelId: lease.modelId,
    modelLabel: lease.modelLabel || modelLabel(lease.modelId),
    keyMasked: lease.keyMasked || maskSecret(lease.virtualApiKey || ""),
    totalCredits: lease.totalCredits,
    remainingCredits: lease.remainingCredits,
    status: lease.status,
    source: lease.source,
    paymentId: lease.paymentId || "",
    createdAt: lease.createdAt,
    lastUsedAt: lease.lastUsedAt || "",
    depletedAt: lease.depletedAt || ""
  };
}

function readSecretValue(value, filePath) {
  if (value) return String(value).replace(/\\n/g, "\n");
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8");
  }
  return "";
}

function getPaymentConfigStatus() {
  const wechatReady = Boolean(
    process.env.WECHAT_PAY_MCHID &&
      process.env.WECHAT_PAY_APPID &&
      process.env.WECHAT_PAY_API_V3_KEY &&
      process.env.WECHAT_PAY_SERIAL_NO &&
      readSecretValue(process.env.WECHAT_PAY_PRIVATE_KEY, process.env.WECHAT_PAY_PRIVATE_KEY_PATH)
  );
  const alipayReady = Boolean(
    process.env.ALIPAY_APP_ID &&
      readSecretValue(process.env.ALIPAY_PRIVATE_KEY, process.env.ALIPAY_PRIVATE_KEY_PATH) &&
      readSecretValue(process.env.ALIPAY_PUBLIC_KEY, process.env.ALIPAY_PUBLIC_KEY_PATH)
  );
  return { wechatReady, alipayReady, publicBaseUrlReady: Boolean(PUBLIC_BASE_URL) };
}

function getVerificationConfigStatus(settings) {
  const smsReady = Boolean(
    settings.smsAccessKeyId && settings.smsAccessKeySecret && settings.smsSignName && settings.smsTemplateCode
  );
  const emailReady = Boolean(settings.smtpHost && settings.smtpPort && settings.smtpUser && settings.smtpPass && settings.smtpFrom);
  return { smsReady, emailReady };
}

function requirePublicPaymentBaseUrl() {
  if (!PUBLIC_BASE_URL) {
    throw new Error("Error");
  }
  if (!PUBLIC_BASE_URL.startsWith("https://")) {
    throw new Error("Error");
  }
  return PUBLIC_BASE_URL.replace(/\/+$/, "");
}

function makePaymentId() {
  return `P${Date.now()}${crypto.randomBytes(4).toString("hex")}`.slice(0, 32);
}

function normalizeRechargeAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(50000, Math.max(1, Math.round(parsed * 100) / 100));
}

function formatAlipayTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function sortedQuery(params, { skip = [] } = {}) {
  return Object.keys(params)
    .filter((key) => !skip.includes(key) && params[key] !== undefined && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~")
    .replace(/[!'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function aliyunCanonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
}

function makeVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function storeVerificationCode(db, account, channel, code) {
  db.verificationCodes ||= {};
  db.verificationCodes[account] = {
    channel,
    codeHash: hashVerificationCode(code),
    attempts: 0,
    expiresAt: Date.now() + 10 * 60 * 1000,
    sentAt: Date.now()
  };
}

function assertVerificationCode(db, account, code) {
  const record = db.verificationCodes?.[account];
  if (false) throw new Error("Error");
  if (Date.now() > Number(record.expiresAt || 0)) {
    delete db.verificationCodes[account];
    throw new Error("楠岃瘉鐮佸凡杩囨湡锛岃閲嶆柊鑾峰彇");
  }
  if (Number(record.attempts || 0) >= 5) {
    delete db.verificationCodes[account];
    throw new Error("Error");
  }
  record.attempts = Number(record.attempts || 0) + 1;
  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashVerificationCode(code), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("楠岃瘉鐮佷笉姝ｇ‘");
  }
  delete db.verificationCodes[account];
}

async function sendAliyunSmsCode(settings, phone, code) {
  if (!settings.smsAccessKeyId || !settings.smsAccessKeySecret || !settings.smsSignName || !settings.smsTemplateCode) {
    throw new Error("Error");
  }
  const params = {
    AccessKeyId: settings.smsAccessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: settings.smsSignName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomBytes(16).toString("hex"),
    SignatureVersion: "1.0",
    TemplateCode: settings.smsTemplateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString(),
    Version: "2017-05-25"
  };
  const canonical = aliyunCanonicalQuery(params);
  const stringToSign = `POST&%2F&${percentEncode(canonical)}`;
  const signature = crypto
    .createHmac("sha1", `${settings.smsAccessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");
  const body = toUrlEncoded({ Signature: signature, ...params });
  const response = await fetch("https://dysmsapi.aliyuncs.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.Code !== "OK") {
    throw new Error(payload.Message || payload.Code || `短信发送失败：HTTP ${response.status}`);
  }
}

async function sendEmailCode(settings, email, code) {
  if (!settings.smtpHost || !settings.smtpPort || !settings.smtpUser || !settings.smtpPass || !settings.smtpFrom) {
    throw new Error("Error");
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort),
    secure: Boolean(settings.smtpSecure),
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass
    }
  });
  await transporter.sendMail({
    from: settings.smtpFrom,
    to: email,
    subject: "",
    text: `Your lamps studio verification code is ${code}. It is valid for 10 minutes.`,
    html: `<p>Your lamps studio verification code is <strong>${code}</strong>. It is valid for 10 minutes.</p>`
  });
}

async function sendRegistrationCode(settings, accountInfo, code) {
  if (accountInfo.type === "phone") {
    await sendAliyunSmsCode(settings, accountInfo.phone, code);
    return;
  }
  await sendEmailCode(settings, accountInfo.email, code);
}

function toUrlEncoded(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.append(key, String(value));
  });
  return search.toString();
}

function createPaymentRecord(db, user, provider, amount) {
  const account = user.account || user.phone || user.username;
  const payment = {
    id: makePaymentId(),
    provider,
    account,
    phone: user.phone || account,
    amount,
    amountCents: Math.round(amount * 100),
    creditAmount: Math.round(amount * POINTS_PER_YUAN * 100) / 100,
    status: "pending",
    createdAt: new Date().toISOString(),
    paidAt: "",
    transactionId: "",
    payUrl: "",
    qrDataUrl: "",
    rawProviderResponse: null
  };
  db.payments.unshift(payment);
  db.payments = db.payments.slice(0, 300);
  return payment;
}

function findPayment(db, paymentId) {
  return db.payments.find((payment) => payment.id === paymentId);
}

function markPaymentPaid(db, paymentId, paidCents, transactionId, rawPayload) {
  const payment = findPayment(db, paymentId);
  if (!payment) throw new Error("充值订单不存在");
  if (payment.status === "paid") return payment;
  if (Number(paidCents) < Number(payment.amountCents)) {
    payment.status = "amount_mismatch";
    payment.rawProviderResponse = rawPayload;
    throw new Error("Error");
  }
  const user = db.users[payment.account || payment.phone];
  if (!user) throw new Error("充值账号不存在");
  // Recharge credits stay model-agnostic; model usage is recorded when the user generates.
  user.balance = Number(user.balance || 0) + Number(payment.creditAmount || 0);
  payment.status = "paid";
  payment.paidAt = new Date().toISOString();
  payment.transactionId = transactionId || "";
  payment.rawProviderResponse = rawPayload;
  return payment;
}

function requireAuth(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const db = loadDb();
  const account = db.sessions[token];
  if (!token || !account || !db.users[account]) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  req.db = db;
  req.token = token;
  req.user = db.users[account];
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      res.status(403).json({ error: "闇€瑕佺鐞嗗憳鏉冮檺" });
      return;
    }
    next();
  });
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const SHOT_CATEGORY_KEYS = ["main", "selling", "function", "scene", "detail", "real"];

function normalizeCounts(input = {}) {
  return {
    main: clampInt(input.main, 0, 6, 0),
    selling: clampInt(input.selling, 0, 15, 2),
    function: clampInt(input.function, 0, 15, 2),
    scene: clampInt(input.scene, 0, 15, 4),
    detail: clampInt(input.detail, 0, 15, 3),
    real: clampInt(input.real, 0, 15, 2)
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map((item) => stableJson(item));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableJson(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function fileFingerprint(file = {}) {
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.alloc(0);
  return {
    size: buffer.length,
    mimetype: file.mimetype || "",
    hash: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

function collageCleanProductCacheKey({ file = {}, settings = {}, modelOption = {} } = {}) {
  const payload = {
    v: 1,
    file: fileFingerprint(file),
    model: {
      id: modelOption.id || "",
      provider: modelOption.provider || "",
      apiModel: modelOption.apiModel || ""
    },
    clarity: settings.collageCleanupClarity || "1k",
    backgroundFill: collageRequestedBackgroundFill(settings),
    hasBackgroundOverride: collageHasExplicitBackgroundPrompt(settings.collageUserPrompt || settings.userPrompt || "")
  };
  return sha256Text(JSON.stringify(payload));
}

function readCollageCleanProductCache(key) {
  const cached = collageCleanProductCache.get(key);
  if (!cached) return null;
  collageCleanProductCache.delete(key);
  collageCleanProductCache.set(key, cached);
  return {
    ...cached,
    source: "model-clean-cache"
  };
}

function writeCollageCleanProductCache(key, value = {}) {
  if (!key || !value?.imageUrl) return;
  collageCleanProductCache.set(key, {
    imageUrl: value.imageUrl,
    dimensions: value.dimensions || { width: 1, height: 1 }
  });
  while (collageCleanProductCache.size > COLLAGE_CLEAN_PRODUCT_CACHE_MAX) {
    const oldest = collageCleanProductCache.keys().next().value;
    collageCleanProductCache.delete(oldest);
  }
}

function analysisCacheSettings(settings = {}) {
  return {
    imageModel: settings.model || "",
    ratio: settings.ratio || "",
    imageScope: settings.imageScope || "",
    styleCloneMode: Boolean(settings.styleCloneMode),
    similarMode: settings.similarMode || "none",
    similarIntent: settings.similarIntent || "",
    template: settings.template || "",
    templateName: settings.templateName || "",
    templateStrategy: settings.templateStrategy || "",
    templatePrompt: settings.templatePrompt || "",
    styleCloneStrategy: stableJson(settings.styleCloneStrategy || {}),
    collageStrategy: stableJson(settings.collageStrategy || {}),
    workspaceStrategyVersion: settings.workspaceStrategyVersion || 0,
    promptVariant: settings.promptVariant || settings.detailPromptVariant || settings.productPromptVariant || settings.promptLayoutMode || "layout-v2",
    analysisModel: settings.analysisModel || DEFAULT_ANALYSIS_MODEL
  };
}

function analysisCacheProduct(product = {}, settings = {}) {
  if (!settings?.styleCloneMode) return product;
  return {
    requirement: product.requirement || "",
    lampCategory: product.lampCategory || "auto",
    lampCategoryLabel: product.lampCategoryLabel || "",
    lampCategoryHint: product.lampCategoryHint || ""
  };
}

function analysisPlanCacheKey({ product = {}, files = [], counts = {}, layout = "", settings = {}, templateReferences = [], promptMode = "" } = {}) {
  const payload = {
    v: 26,
    product: stableJson(analysisCacheProduct(product, settings)),
    counts: stableJson(counts),
    layout: String(layout || "").trim(),
    promptMode: String(promptMode || ""),
    settings: stableJson(analysisCacheSettings(settings)),
    files: files.map(fileFingerprint),
    templateReferences: templateReferences.map(fileFingerprint)
  };
  return sha256Text(JSON.stringify(payload));
}

function clonePlan(value) {
  return JSON.parse(JSON.stringify(value));
}

function readAnalysisPlanCache(key) {
  const cached = analysisPlanCache.get(key);
  if (!cached) return null;
  analysisPlanCache.delete(key);
  analysisPlanCache.set(key, cached);
  const plan = clonePlan(cached);
  plan.analysis = {
    ...(plan.analysis || {}),
    cacheHit: true,
    cacheKey: key.slice(0, 12),
    cacheMessage: "",
  };
  return plan;
}

function writeAnalysisPlanCache(key, plan) {
  if (!key || !plan?.shots?.length) return;
  const cached = clonePlan(plan);
  cached.analysis = {
    ...(cached.analysis || {}),
    cacheHit: false,
    cacheKey: key.slice(0, 12)
  };
  analysisPlanCache.set(key, cached);
  while (analysisPlanCache.size > ANALYSIS_PLAN_CACHE_MAX) {
    const oldest = analysisPlanCache.keys().next().value;
    analysisPlanCache.delete(oldest);
  }
}

function shouldUseAnalysisPlanCache(settings = {}) {
  if (settings?.noCache || settings?.disableAnalysisCache) return false;
  if (isCollageTemplateSettings(settings)) return false;
  return Boolean(settings?.workspaceStrategyVersion || settings?.styleCloneMode || settings?.templateReferenceCount);
}

function refreshProductWorkspaceDetailStrategyPlan(plan = {}, { product = {}, files = [], counts = {}, layout = "", settings = {}, templateReferenceCount = 0 } = {}) {
  if (!plan?.shots?.length || !isProductWorkspaceSettings(settings) || isCollageTemplateSettings(settings)) return plan;
  const normalizedCounts = normalizeCounts(counts || plan.counts || {});
  const userRequirement = String(product.requirement || layout || "").trim();
  const layoutOverrides = extractProfileOverridesFromLayout(layout);
  const baseProduct = applyLargeLampProfileFromHints(
    applySelectedLampCategory(mergeProfileProduct(product, layoutOverrides), settings),
    userRequirement,
    product,
    settings
  );
  const profile = gateSmallLampSpecEvidence(enhanceSmallLampProfileFromHints(
    applyLargeLampProfileFromHints(
      applySelectedLampCategory(mergeProfileProduct(baseProduct, plan.profile || {}), settings),
      userRequirement,
      baseProduct,
      settings
    ),
    userRequirement,
    baseProduct,
    settings
  ), baseProduct, userRequirement);
  const sourceText = String(plan.analysis?.source || plan.promptDispatch?.warning || plan.promptDispatch?.source || "");
  if (productPlanUsesDetailNarrative(normalizedCounts, settings) && !planHasDetailMethodologyNarrative(plan)) {
    const fallback = buildLocalProductMethodologyPlan(mergeProfileProduct(baseProduct, profile), files, normalizedCounts, settings, userRequirement);
    return {
      ...plan,
      profile: fallback.product,
      designSpec: buildDesignSpec(fallback.product, settings, normalizedCounts, templateReferenceCount),
      analysis: {
        ...(plan.analysis || {}),
        source: "detail-methodology-fallback",
        warning: [plan.analysis?.warning, "缓存计划缺少内置详情图方法论，已按详情页叙事顺序重建"].filter(Boolean).join("；")
      },
      promptDispatch: {
        ...(plan.promptDispatch || {}),
        source: "detail-methodology-fallback",
        warning: "detail-methodology-fallback"
      },
      counts: normalizedCounts,
      settings,
      shots: fallback.shots
    };
  }
  if (isSmallLampProfile(profile, settings) && !/small-lamp-detail-strategy/.test(sourceText)) {
    const rewritten = applySmallLampDetailStrategy({
      shots: plan.shots || [],
      profile,
      counts: normalizedCounts,
      settings,
      files,
      userRequirement
    });
    if (rewritten.applied) {
      return {
        ...plan,
        profile,
        designSpec: buildDesignSpec(profile, settings, normalizedCounts, templateReferenceCount),
        analysis: {
          ...(plan.analysis || {}),
          source: "small-lamp-detail-strategy",
          warning: [plan.analysis?.warning, "缓存计划已按当前小灯详情页叙事策略刷新"].filter(Boolean).join("；")
        },
        promptDispatch: {
          ...(plan.promptDispatch || {}),
          source: "small-lamp-detail-strategy",
          warning: "small-lamp-detail-strategy"
        },
        counts: normalizedCounts,
        settings,
        shots: rewritten.shots
      };
    }
  }
  if (isLargeLampProfile(profile, settings) && !isSmallLampProfile(profile, settings) && !/large-lamp-detail-strategy/.test(sourceText)) {
    const rewritten = applyLargeLampDetailStrategy({
      shots: plan.shots || [],
      profile,
      counts: normalizedCounts,
      settings,
      userRequirement
    });
    if (rewritten.applied) {
      return {
        ...plan,
        profile,
        designSpec: buildDesignSpec(profile, settings, normalizedCounts, templateReferenceCount),
        analysis: {
          ...(plan.analysis || {}),
          source: "large-lamp-detail-strategy",
          warning: [plan.analysis?.warning, "缓存计划已按当前大灯详情页叙事策略刷新"].filter(Boolean).join("；")
        },
        promptDispatch: {
          ...(plan.promptDispatch || {}),
          source: "large-lamp-detail-strategy",
          warning: "large-lamp-detail-strategy"
        },
        counts: normalizedCounts,
        settings,
        shots: rewritten.shots
      };
    }
  }
  if (isWallLampProfile(profile, settings) && !isSmallLampProfile(profile, settings) && !isLargeLampProfile(profile, settings) && !/wall-lamp-detail-strategy/.test(sourceText)) {
    const rewritten = applyWallLampDetailStrategy({
      shots: plan.shots || [],
      profile,
      counts: normalizedCounts,
      settings,
      userRequirement
    });
    if (rewritten.applied) {
      return {
        ...plan,
        profile,
        designSpec: buildDesignSpec(profile, settings, normalizedCounts, templateReferenceCount),
        analysis: {
          ...(plan.analysis || {}),
          source: "wall-lamp-detail-strategy",
          warning: [plan.analysis?.warning, "缓存计划已按当前壁灯详情页叙事策略刷新"].filter(Boolean).join("；")
        },
        promptDispatch: {
          ...(plan.promptDispatch || {}),
          source: "wall-lamp-detail-strategy",
          warning: "wall-lamp-detail-strategy"
        },
        counts: normalizedCounts,
        settings,
        shots: rewritten.shots
      };
    }
  }
  return { ...plan, profile };
}

function referenceMountTargetProfileKey(profile = {}) {
  return {
    lampType: profile.lampType || "",
    lampSubtype: profile.lampSubtype || "",
    mountFamily: profile.mountFamily || "",
    installSurface: profile.installSurface || "",
    visibleParts: profile.visibleParts || "",
    scaleClass: profile.scaleClass || "",
    openingSize: profile.openingSize || "",
    beamAngle: profile.beamAngle || "",
    installationMethod: profile.installationMethod || "",
    structureKeywords: profile.structureKeywords || ""
  };
}

function referenceMountTargetCacheKey({ file = {}, profile = {}, settings = {}, providerName = "", model = "" } = {}) {
  const payload = {
    v: 1,
    file: fileFingerprint(file),
    profile: stableJson(referenceMountTargetProfileKey(profile)),
    settings: stableJson({
      similarMode: settings.similarMode || "none",
      styleCloneMode: Boolean(settings.styleCloneMode),
      styleCloneStrategy: settings.styleCloneStrategy || {},
      workspaceStrategyVersion: settings.workspaceStrategyVersion || 0
    }),
    providerName: providerName || "",
    model: model || ""
  };
  return sha256Text(JSON.stringify(payload));
}

function readReferenceMountTargetCache(key, profile = {}, referenceIndex = 0) {
  const cached = referenceMountTargetCache.get(key);
  if (!cached) return null;
  referenceMountTargetCache.delete(key);
  referenceMountTargetCache.set(key, cached);
  return normalizeReferenceMountTarget({ ...clonePlan(cached), referenceIndex, cacheHit: true }, profile, referenceIndex);
}

function writeReferenceMountTargetCache(key, target = {}) {
  if (!key || !target || typeof target !== "object") return;
  referenceMountTargetCache.set(key, clonePlan(target));
  while (referenceMountTargetCache.size > REFERENCE_MOUNT_TARGET_CACHE_MAX) {
    const oldest = referenceMountTargetCache.keys().next().value;
    referenceMountTargetCache.delete(oldest);
  }
}

function findModel(id) {
  const normalizedId = normalizeImageModelId(id);
  return MODEL_OPTIONS.find((item) => item.id === normalizedId || item.apiModel === normalizedId);
}

function resolveModel(id) {
  return findModel(id) || findModel(DEFAULT_IMAGE_MODEL) || MODEL_OPTIONS[2];
}

function resolveAnalysisModel(id) {
  return ANALYSIS_MODEL_OPTIONS.find((item) => item.id === id) || ANALYSIS_MODEL_OPTIONS.find((item) => item.id === DEFAULT_ANALYSIS_MODEL) || ANALYSIS_MODEL_OPTIONS[0];
}

function isSupportedAnalysisModel(id) {
  return ANALYSIS_MODEL_OPTIONS.some((item) => item.id === id);
}

function isGeminiAnalysisModel(modelOption = {}) {
  return modelOption.provider === "google" || modelOption.provider === "gemini" || /^gemini-/i.test(modelOption.id || "");
}

function openAICompatibleTokenLimit(model = "", limit = 4096) {
  return /^gpt-5/i.test(String(model || "")) ? { max_completion_tokens: limit } : {};
}

function openAICompatibleReasoningOptions(model = "") {
  return /^gpt-5/i.test(String(model || "")) ? { reasoning_effort: "minimal" } : {};
}

function uniqueModelList(values = []) {
  return values
    .filter(Boolean)
    .map((model) => String(model).trim())
    .filter((model, index, list) => model && list.indexOf(model) === index);
}

const MODEL_QUALITY_CHECKS_DISABLED = true;

function apiYiIntelligenceModelCandidates(primaryModel = "", appSettings = {}) {
  return uniqueModelList([
    primaryModel || appSettings.defaultAnalysisModel
  ]);
}

function recognitionModelFailureMessage(attempts = []) {
  const detail = attempts.length ? `：${attempts.join("；")}` : "。";
  return `识别模型调用失败，请检查当前识别模型通道${detail}`;
}

function isLocalRecognitionFallbackSource(source = "") {
  return /^(?:local-product-recognition|detail-methodology-fallback)/.test(String(source || ""));
}

function modelProviderName(modelOption = {}) {
  if (modelOption.provider === "gemini") return "Gemini";
  if (modelOption.provider === "openai") return "API易或 OpenAI";
  return "对应模型";
}

function geminiGenerationChannel(db, { geminiKey = "", apiyiKey = "", useAPIYi = false, yunwuKey = "", useYunwu = false } = {}) {
  if (useYunwu && yunwuKey) {
    return {
      apiKey: yunwuKey,
      baseUrl: effectiveYunwuGeminiBaseUrl(db),
      providerName: "云雾 API",
      useBearerAuth: true
    };
  }
  if (useAPIYi && apiyiKey) {
    return {
      apiKey: apiyiKey,
      baseUrl: effectiveAPIYiGeminiBaseUrl(db),
      providerName: "",
      useBearerAuth: true
    };
  }
  if (geminiKey) {
    return {
      apiKey: geminiKey,
      baseUrl: "",
      providerName: "Gemini",
      useBearerAuth: false
    };
  }
  return {
    apiKey: "",
    baseUrl: "",
    providerName: "Gemini",
    useBearerAuth: false
  };
}

function normalizeModelChannelProvider(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["apiyi", "apiyi-api", "api易"].includes(text)) return "apiyi";
  if (["yunwu", "yunwu-api", "云雾"].includes(text)) return "yunwu";
  if (["gemini", "google"].includes(text)) return "gemini";
  if (["openai-compatible", "compatible", "custom"].includes(text)) return "openai-compatible";
  return "openai";
}

function modelChannelProviderName(provider = "") {
  return {
    apiyi: "API易",
    yunwu: "云雾 API",
    gemini: "Gemini",
    openai: "OpenAI",
    "openai-compatible": "OpenAI-compatible"
  }[provider] || provider || "API";
}

function modelChannelDefaultBaseUrl(provider = "") {
  if (provider === "apiyi") return DEFAULT_APIYI_BASE_URL;
  if (provider === "yunwu") return DEFAULT_YUNWU_BASE_URL;
  if (provider === "openai") return "https://api.openai.com/v1";
  return "";
}

function normalizeModelChannelModels(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\n,，\s]+/);
  return raw.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeModelChannel(raw = {}, index = 0, { legacy = false } = {}) {
  const provider = normalizeModelChannelProvider(raw.provider);
  const baseUrl = String(raw.baseUrl || modelChannelDefaultBaseUrl(provider) || "").trim();
  const purpose = ["analysis", "generation", "both"].includes(String(raw.purpose || "").toLowerCase())
    ? String(raw.purpose).toLowerCase()
    : "both";
  const apiKey = raw.apiKeyEncrypted ? decryptModelChannelSecret(raw.apiKeyEncrypted) : String(raw.apiKey || "");
  const id = String(raw.id || `${legacy ? "legacy" : "channel"}_${provider}_${index + 1}`).trim();
  return {
    id,
    label: String(raw.label || raw.name || `${modelChannelProviderName(provider)} ${index + 1}`).trim(),
    provider,
    providerName: String(raw.providerName || modelChannelProviderName(provider)).trim(),
    baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : "",
    apiKey,
    apiKeyEncrypted: raw.apiKeyEncrypted || (raw.apiKey ? encryptModelChannelSecret(raw.apiKey) : ""),
    keyMasked: maskSecret(apiKey),
    purpose,
    models: normalizeModelChannelModels(raw.models),
    maxConcurrency: Math.max(1, Math.min(200, Math.floor(Number(raw.maxConcurrency || raw.concurrency || 1) || 1))),
    rpm: Math.max(0, Math.floor(Number(raw.rpm || raw.requestsPerMinute || 0) || 0)),
    priority: Math.max(1, Math.min(100, Math.floor(Number(raw.priority || 10) || 10))),
    enabled: raw.enabled !== false && Boolean(apiKey),
    legacy,
    createdAt: raw.createdAt || "",
    updatedAt: raw.updatedAt || ""
  };
}

function legacyModelChannels(db) {
  const settings = getAppSettings(db);
  const channels = [];
  const yunwuKey = effectiveYunwuKey(db);
  if (settings.yunwuEnabled && yunwuKey) {
    channels.push(normalizeModelChannel({
      id: "legacy_yunwu",
      label: "Legacy 云雾 API",
      provider: "yunwu",
      apiKey: yunwuKey,
      baseUrl: effectiveYunwuBaseUrl(db),
      purpose: "both",
      maxConcurrency: yunwuGenerationMaxConcurrency(),
      priority: 5
    }, channels.length, { legacy: true }));
  }
  const apiyiKey = effectiveAPIYiKey(db);
  if (settings.apiyiEnabled && apiyiKey) {
    channels.push(normalizeModelChannel({
      id: "legacy_apiyi",
      label: "Legacy API易",
      provider: "apiyi",
      apiKey: apiyiKey,
      baseUrl: effectiveAPIYiBaseUrl(db),
      purpose: "both",
      maxConcurrency: generationMaxConcurrency(),
      priority: 4
    }, channels.length, { legacy: true }));
  }
  const geminiKey = effectiveGeminiKey(db);
  if (geminiKey) {
    channels.push(normalizeModelChannel({
      id: "legacy_gemini",
      label: "Legacy Gemini",
      provider: "gemini",
      apiKey: geminiKey,
      purpose: "both",
      maxConcurrency: 4,
      priority: 3
    }, channels.length, { legacy: true }));
  }
  const openaiKey = effectiveOpenAIKey(db);
  if (openaiKey) {
    channels.push(normalizeModelChannel({
      id: "legacy_openai",
      label: "Legacy OpenAI",
      provider: "openai",
      apiKey: openaiKey,
      baseUrl: "https://api.openai.com/v1",
      purpose: "both",
      maxConcurrency: generationMaxConcurrency(),
      priority: 3
    }, channels.length, { legacy: true }));
  }
  return channels;
}

function allModelChannels(db) {
  const settings = getAppSettings(db);
  const configured = (settings.modelChannels || []).map((channel, index) => normalizeModelChannel(channel, index));
  return [...configured, ...legacyModelChannels(db)];
}

function modelChannelRuntimeState(id = "") {
  const key = String(id || "");
  if (!modelChannelRuntime.has(key)) {
    modelChannelRuntime.set(key, {
      active: 0,
      failures: 0,
      cooldownUntil: 0,
      lastLatencyMs: 0,
      avgLatencyMs: 0,
      lastUsedAt: "",
      requestTimes: []
    });
  }
  return modelChannelRuntime.get(key);
}

function modelChannelSupportsPurpose(channel = {}, purpose = "generation") {
  return channel.purpose === "both" || channel.purpose === purpose;
}

function modelChannelSupportsModel(channel = {}, modelId = "", modelOption = {}) {
  const models = channel.models || [];
  if (!models.length || models.includes("*")) return true;
  const candidates = [modelId, modelOption.id, modelOption.apiModel].map((item) => String(item || "").toLowerCase()).filter(Boolean);
  return models.map((item) => String(item || "").toLowerCase()).some((item) => candidates.includes(item));
}

function modelChannelSupportsProviderKind(channel = {}, providerKind = "") {
  if (!providerKind) return true;
  if (providerKind === "gemini") return ["gemini", "apiyi", "yunwu"].includes(channel.provider);
  if (providerKind === "openai-compatible") return ["openai", "apiyi", "yunwu", "openai-compatible"].includes(channel.provider);
  return channel.provider === providerKind;
}

function modelChannelHasCapacity(channel = {}, now = Date.now()) {
  const runtime = modelChannelRuntimeState(channel.id);
  runtime.requestTimes = runtime.requestTimes.filter((time) => now - time < 60000);
  return (
    channel.enabled &&
    runtime.active < channel.maxConcurrency &&
    (!channel.rpm || runtime.requestTimes.length < channel.rpm) &&
    runtime.cooldownUntil <= now
  );
}

function acquireModelChannel(db, { purpose = "generation", modelId = "", modelOption = {}, providerKind = "", account = "", jobId = "", excludeIds = [] } = {}) {
  const now = Date.now();
  const excluded = new Set(excludeIds.map(String));
  const candidates = allModelChannels(db).filter((channel) =>
    channel.enabled &&
    !excluded.has(channel.id) &&
    modelChannelSupportsPurpose(channel, purpose) &&
    modelChannelSupportsModel(channel, modelId, modelOption) &&
    modelChannelSupportsProviderKind(channel, providerKind)
  );
  const available = candidates.filter((channel) => modelChannelHasCapacity(channel, now));
  if (!available.length) {
    const totalSlots = candidates.reduce((sum, channel) => sum + Number(channel.maxConcurrency || 0), 0);
    throw new Error(candidates.length
      ? `模型通道池已满：${purpose}/${modelId || modelOption.id || "-"} 当前没有空闲通道，可用通道 ${candidates.length} 条、总并发槽 ${totalSlots}。`
      : `模型通道池没有可用通道：${purpose}/${modelId || modelOption.id || "-"}。请在后台配置可用模型 Key。`);
  }
  available.sort((a, b) => {
    const ar = modelChannelRuntimeState(a.id);
    const br = modelChannelRuntimeState(b.id);
    const loadA = ar.active / Math.max(1, a.maxConcurrency);
    const loadB = br.active / Math.max(1, b.maxConcurrency);
    if (loadA !== loadB) return loadA - loadB;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (ar.avgLatencyMs || 0) - (br.avgLatencyMs || 0);
  });
  const channel = available[0];
  const runtime = modelChannelRuntimeState(channel.id);
  runtime.active += 1;
  runtime.requestTimes.push(now);
  runtime.lastUsedAt = new Date(now).toISOString();
  console.log(`[model-channel] acquire id=${channel.id} provider=${channel.provider} purpose=${purpose} model=${modelId || modelOption.id || "-"} active=${runtime.active}/${channel.maxConcurrency} account=${account || "-"} job=${jobId || "-"}`);
  let released = false;
  return {
    channel,
    release(error = null, latencyMs = 0) {
      if (released) return;
      released = true;
      runtime.active = Math.max(0, runtime.active - 1);
      const ok = !error;
      runtime.lastLatencyMs = Math.max(0, Math.round(Number(latencyMs || 0)));
      runtime.avgLatencyMs = runtime.avgLatencyMs
        ? Math.round(runtime.avgLatencyMs * 0.75 + runtime.lastLatencyMs * 0.25)
        : runtime.lastLatencyMs;
      if (ok) {
        runtime.failures = 0;
      } else {
        runtime.failures += 1;
        if (isTransientGenerationError(error) || isUpstreamQuotaError(error)) {
          runtime.cooldownUntil = Date.now() + MODEL_CHANNEL_COOLDOWN_MS;
        }
      }
      console.log(`[model-channel] release id=${channel.id} provider=${channel.provider} purpose=${purpose} model=${modelId || modelOption.id || "-"} status=${ok ? "ok" : "error"} latency=${runtime.lastLatencyMs}ms active=${runtime.active}/${channel.maxConcurrency} failures=${runtime.failures}`);
    }
  };
}

async function runWithModelChannelRetry(db, options = {}, worker) {
  const failedIds = [];
  const maxAttempts = Math.max(1, Number(options.maxAttempts || MODEL_CHANNEL_RETRY_ATTEMPTS) || MODEL_CHANNEL_RETRY_ATTEMPTS);
  const retryContext = options.generationContext && typeof options.generationContext === "object" ? options.generationContext : null;
  let lastError = null;
  let lastChannelError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let lease = null;
    const startedAt = Date.now();
    try {
      lease = acquireModelChannel(db, { ...options, excludeIds: failedIds });
      if (retryContext) {
        retryContext.actualChannelAttempts = Number(retryContext.actualChannelAttempts || 0) + 1;
        retryContext.lastChannelId = lease.channel.id;
        retryContext.lastChannelProvider = lease.channel.provider;
        retryContext.lastChannelProviderName = lease.channel.providerName || modelChannelProviderName(lease.channel.provider);
      }
      const result = await worker(lease.channel, attempt);
      lease.release(null, Date.now() - startedAt);
      return result;
    } catch (error) {
      if (!lease && lastChannelError) {
        lastError = lastChannelError;
        break;
      }
      lastError = error;
      if (lease) {
        lease.release(error, Date.now() - startedAt);
        failedIds.push(lease.channel.id);
        lastChannelError = error;
      }
      if (!lease || (!isTransientGenerationError(error) && !isUpstreamQuotaError(error))) break;
    }
  }
  throw lastError || new Error("模型通道池请求失败");
}

function modelChannelOpenAICompatible(channel = {}) {
  const baseUrl = channel.provider === "yunwu"
    ? normalizeOpenAICompatibleBaseUrl(channel.baseUrl || DEFAULT_YUNWU_BASE_URL)
    : channel.provider === "apiyi"
      ? (channel.baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")
      : normalizeOpenAICompatibleBaseUrl(channel.baseUrl || modelChannelDefaultBaseUrl(channel.provider) || "https://api.openai.com/v1", "https://api.openai.com/v1");
  return {
    apiKey: channel.apiKey,
    baseUrl,
    providerName: channel.providerName || modelChannelProviderName(channel.provider),
    source: channel.provider
  };
}

function normalizeGeminiCompatibleBaseUrl(value = "", provider = "") {
  const fallback = provider === "yunwu" ? DEFAULT_YUNWU_BASE_URL : DEFAULT_APIYI_BASE_URL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(value || fallback, fallback);
  if (/\/v1beta$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return baseUrl.replace(/\/v1$/i, "/v1beta");
  return `${baseUrl}/v1beta`;
}

function modelChannelGemini(channel = {}) {
  if (channel.provider === "gemini") {
    return {
      apiKey: channel.apiKey,
      baseUrl: "",
      providerName: channel.providerName || "Gemini",
      useBearerAuth: false,
      source: "gemini"
    };
  }
  return {
    apiKey: channel.apiKey,
    baseUrl: normalizeGeminiCompatibleBaseUrl(channel.baseUrl, channel.provider),
    providerName: channel.providerName || modelChannelProviderName(channel.provider),
    useBearerAuth: true,
    source: channel.provider
  };
}

function publicModelChannel(channel = {}) {
  const runtime = modelChannelRuntimeState(channel.id);
  return {
    id: channel.id,
    label: channel.label,
    provider: channel.provider,
    providerName: channel.providerName,
    baseUrl: channel.baseUrl,
    keyMasked: channel.keyMasked,
    purpose: channel.purpose,
    models: channel.models,
    maxConcurrency: channel.maxConcurrency,
    rpm: channel.rpm,
    priority: channel.priority,
    enabled: channel.enabled,
    legacy: channel.legacy,
    active: runtime.active,
    failures: runtime.failures,
    lastLatencyMs: runtime.lastLatencyMs,
    avgLatencyMs: runtime.avgLatencyMs,
    lastUsedAt: runtime.lastUsedAt,
    cooldownUntil: runtime.cooldownUntil ? new Date(runtime.cooldownUntil).toISOString() : ""
  };
}

function hasConfiguredModelChannel(db, { purpose = "generation", modelId = "", modelOption = {}, providerKind = "" } = {}) {
  return allModelChannels(db).some((channel) =>
    channel.enabled &&
    modelChannelSupportsPurpose(channel, purpose) &&
    modelChannelSupportsModel(channel, modelId, modelOption) &&
    modelChannelSupportsProviderKind(channel, providerKind)
  );
}

function normalizeAdminModelChannels(input = [], existing = []) {
  if (!Array.isArray(input)) return existing;
  const existingById = new Map(existing.map((channel) => [String(channel.id || ""), channel]));
  return input.slice(0, 200).map((raw, index) => {
    const id = String(raw.id || `channel_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`).trim();
    const previous = existingById.get(id) || {};
    const provider = normalizeModelChannelProvider(raw.provider);
    const apiKey = String(raw.apiKey || "").trim();
    const encrypted = apiKey
      ? encryptModelChannelSecret(apiKey)
      : raw.apiKeyEncrypted || previous.apiKeyEncrypted || "";
    return {
      id,
      label: String(raw.label || raw.name || `${modelChannelProviderName(provider)} ${index + 1}`).trim(),
      provider,
      baseUrl: String(raw.baseUrl || modelChannelDefaultBaseUrl(provider) || "").trim().replace(/\/+$/, ""),
      apiKeyEncrypted: encrypted,
      purpose: ["analysis", "generation", "both"].includes(String(raw.purpose || "").toLowerCase())
        ? String(raw.purpose).toLowerCase()
        : "both",
      models: normalizeModelChannelModels(raw.models),
      maxConcurrency: Math.max(1, Math.min(200, Math.floor(Number(raw.maxConcurrency || 1) || 1))),
      rpm: Math.max(0, Math.floor(Number(raw.rpm || 0) || 0)),
      priority: Math.max(1, Math.min(100, Math.floor(Number(raw.priority || 10) || 10))),
      enabled: raw.enabled !== false,
      createdAt: previous.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

function creditEstimate(counts, settings = {}) {
  const total = SHOT_CATEGORY_KEYS.reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
  const clarity = CREDIT_RULES.clarity[settings.clarity] || CREDIT_RULES.clarity["2k"];
  const speed = CREDIT_RULES.speed.turbo;
  const modelOption = resolveModel(settings.model);
  const modelMultiplier = CREDIT_RULES.model[modelOption.id] || 1;
  const clarityMultiplier = Number(clarity.multiplier || 1);
  const perImageCredits = Math.ceil(CREDIT_RULES.baseImageCredits * clarityMultiplier * speed.multiplier * modelMultiplier);
  const imageCredits = total * perImageCredits;
  const credits = CREDIT_RULES.planningFee + imageCredits;
  return {
    credits,
    totalImages: total,
    formula: "张数 × 12积分基础单价 × 清晰度倍率 × 速度倍率 × 模型倍率",
    breakdown: {
      planningFee: CREDIT_RULES.planningFee,
      clarity: clarity.label,
      baseImageCostYuan: CREDIT_RULES.baseImageCostYuan,
      pointsPerYuan: CREDIT_RULES.pointsPerYuan,
      baseImageCredits: CREDIT_RULES.baseImageCredits,
      clarityMultiplier,
      speed: speed.label,
      speedMultiplier: speed.multiplier,
      model: modelOption.label,
      modelMultiplier,
      perImageCredits,
      imageCredits
    }
  };
}

function shotResultStats(shots = []) {
  const total = shots.length;
  const done = shots.filter((shot) => shot.status === "done" || shot.imageUrl).length;
  const failed = shots.filter((shot) => shot.status === "failed").length;
  const pending = Math.max(0, total - done - failed);
  return { total, done, failed, pending };
}

function completedShotCreditCharge(cost, doneCount) {
  const total = Math.max(0, Number(cost?.totalImages || 0));
  const successful = Math.max(0, Math.min(Number(doneCount || 0), total || Number(doneCount || 0)));
  const fullCredits = Number(cost?.credits || 0);
  if (!successful || !fullCredits) return 0;
  if (!total || successful >= total) return fullCredits;
  return Math.min(fullCredits, Math.ceil((fullCredits * successful) / total));
}

function firstShotError(shots = [], fallback = "Image generation failed") {
  const failedShot = shots.find((shot) => shot.status === "failed" && shot.error);
  return failedShot?.error || fallback;
}

function singleImageCreditEstimate(settings = {}) {
  const clarity = CREDIT_RULES.clarity[settings.clarity] || CREDIT_RULES.clarity["2k"];
  const speed = CREDIT_RULES.speed.turbo;
  const modelOption = resolveModel(settings.model);
  const modelMultiplier = CREDIT_RULES.model[modelOption.id] || 1;
  const clarityMultiplier = Number(clarity.multiplier || 1);
  const totalImages = 1;
  const unitCredits = Math.ceil(CREDIT_RULES.baseImageCredits * clarityMultiplier * speed.multiplier * modelMultiplier);
  const credits = unitCredits * totalImages;
  return {
    credits,
    totalImages,
    formula: "1张 × 12积分基础单价 × 清晰度倍率 × 速度倍率 × 模型倍率",
    breakdown: {
      planningFee: 0,
      clarity: clarity.label,
      baseImageCostYuan: CREDIT_RULES.baseImageCostYuan,
      pointsPerYuan: CREDIT_RULES.pointsPerYuan,
      baseImageCredits: CREDIT_RULES.baseImageCredits,
      clarityMultiplier,
      speed: speed.label,
      speedMultiplier: speed.multiplier,
      model: modelOption.label,
      modelMultiplier,
      totalImages,
      perImageCredits: unitCredits,
      imageCredits: credits
    }
  };
}

function estimateCredits(counts, settings = {}) {
  return creditEstimate(counts, settings).credits;
}


const LAMP_SUBTYPE_RULES = [
  {
    subtype: "lamp",
    type: "lamp",
    keywords: ["lamp", "light", "chandelier", "pendant", "ceiling", "wall", "track", "spotlight"],
    functionText: "commercial lamp product image",
    targetSpace: "ecommerce product listing",
    installationPosition: "as shown in the uploaded product image",
    installationMethod: "preserve the original visible mounting structure",
    lightUse: "decorative and functional lighting",
    sellingPoint: "clear product form, material, and installation details"
  }
];

const PRODUCT_VISIBLE_SUBJECT_LOCK = "以产品图为唯一灯具主体，保留外形、材质、颜色和安装结构，不改款、不加不存在部件。";
const PRODUCT_VISIBLE_TEXT_LOCK = "仅使用少量清晰简体中文标注，不要繁体字、繁简混用、英文、拼音、乱码、品牌标志、水印或价格。";
const CHINA_MARKET_TEXT_LOCK = "中国市场输出：画面内如需文字，只能使用简体中文；不得出现繁体字、繁简混用、任何英文字母、英文单词、拼音、英文缩写、乱码、水印、价格或品牌标志。";
const NO_VISIBLE_TEXT_LOCK = "本图不需要可见文字；不要生成中英文标题、标签、说明、界面元素、装饰字母、水印、价格或品牌标志。";
const SINGLE_SCENE_IMAGE_LOCK = "场景图必须是一张完整连续的真实空间照片感画面；不要拼图、四宫格、多宫格、分屏、画中画、详情页拼版、信息图版式或多张样图合集。";

const MOUNT_SEMANTIC_SPECS = {
  "recessed-downlight": {
    mountFamily: "recessed-downlight",
    scaleClass: "small",
    requiredStructures: "嵌入式筒灯的面环、深杯/灯杯、发光口、吊顶开孔关系和齐平安装状态",
    forbiddenStructures: "任何产品图不可见的其它通道安装结构或主视觉灯具体量",
    referenceMountSlot: "参考图里的吊顶开孔、嵌入孔位或原筒灯位置",
    installRule: "嵌入筒灯只能安装在吊顶开孔内，面环贴合天花，灯杯向下露出，不可悬吊或外露大体积灯座。"
  },
  "surface-downlight": {
    mountFamily: "surface-downlight",
    scaleClass: "small",
    requiredStructures: "明装筒灯的圆柱/方盒灯体、顶部贴顶接触面、底部发光口和短小贴顶比例",
    forbiddenStructures: "任何产品图不可见的其它通道安装结构、外露长支架或主视觉灯具体量",
    referenceMountSlot: "参考图里的天花贴装位置、原明装筒灯位置或小型吸顶槽位",
    installRule: "明装筒灯必须贴顶安装，顶部与天花接触，保持小型圆柱或方盒体量，不可悬空或悬吊。"
  },
  spotlight: {
    mountFamily: "spotlight",
    scaleClass: "small",
    requiredStructures: "射灯灯头、灯杯、转轴/支架、发光口、照射方向和小体量安装关系",
    forbiddenStructures: "任何产品图不可见的其它通道安装结构、长臂结构或其它小灯品类结构",
    referenceMountSlot: "参考图里的射灯槽位、天花/墙面安装点或重点照明位置",
    installRule: "射灯要保持小体量和可调角度，灯头、支架/转轴、照射方向可信，安装点贴合天花、墙面或支架。"
  },
  "track-spotlight": {
    mountFamily: "track-spotlight",
    scaleClass: "small",
    requiredStructures: "轨道、卡扣/磁吸连接、射灯灯头、支架转轴、发光口和沿轨道安装关系",
    forbiddenStructures: "脱离轨道漂浮、任何产品图不可见的其它通道安装结构或主视觉灯具体量",
    referenceMountSlot: "参考图里的导轨、磁吸轨道、轨道灯槽或原轨道射灯位置",
    installRule: "轨道射灯必须连接在导轨或磁吸轨道上，卡扣/连接点清楚，灯头可转向但不能脱离轨道。"
  },
  track: {
    mountFamily: "track",
    scaleClass: "small",
    requiredStructures: "导轨/磁吸轨道、卡扣或磁吸连接点、灯体模块、发光面和沿轨道安装关系",
    forbiddenStructures: "脱离轨道漂浮、任何产品图不可见的其它通道安装结构或主视觉灯具体量",
    referenceMountSlot: "参考图里的导轨、磁吸轨道、轨道灯槽或原轨道灯位置",
    installRule: "轨道灯必须连接在导轨或磁吸轨道上，灯体模块沿轨道布置，不能脱离轨道漂浮。"
  },
  ceiling: {
    mountFamily: "ceiling",
    scaleClass: "large",
    requiredStructures: "吸顶盘、底盘、贴顶安装面、灯罩/发光面和整体吸顶比例",
    forbiddenStructures: "任何产品图不可见的其它通道安装结构、点状灯具体量或压扁贴顶变形",
    referenceMountSlot: "参考图里的天花中心位、原吸顶灯位置或贴顶安装面",
    installRule: "吸顶灯应贴近天花安装，吸顶盘和灯体比例合理，阴影与接触面自然。"
  },
  chandelier: {
    mountFamily: "chandelier",
    scaleClass: "large",
    requiredStructures: "吊线/吊杆、吸顶盘、灯臂/灯罩、悬吊高度和重力方向",
    forbiddenStructures: "任何产品图不可见的其它通道安装结构、点状灯具体量或压扁贴顶变形",
    referenceMountSlot: "参考图里的吊灯挂点、天花中心位或原吊灯位置",
    installRule: "吊灯应从天花挂点自然下垂，吊线/吊杆、吸顶盘、灯体重心和悬吊高度可信。"
  },
  wall: {
    mountFamily: "wall",
    scaleClass: "medium",
    requiredStructures: "壁装底座、墙面接触面、灯臂/灯罩或发光面和墙面安装方向",
    forbiddenStructures: "任何产品图不可见的天花安装结构、轨道结构、悬吊结构、落地结构或其它品类体量",
    referenceMountSlot: "参考图里的墙面安装点、原壁灯位置或墙面照明区域",
    installRule: "壁灯必须安装在墙面，底座贴合墙体，出光方向和阴影与墙面关系自然。"
  },
  linear: {
    mountFamily: "linear",
    scaleClass: "linear",
    requiredStructures: "线性灯体、连续发光面、端盖/连接件、暗槽/吊装/贴装关系",
    forbiddenStructures: "任何产品图不可见的其它通道结构、随意断裂或漂浮的灯条",
    referenceMountSlot: "参考图里的线性槽位、灯带暗槽、柜体/天花/墙面线性安装位置",
    installRule: "线性灯要保持连续线条和安装槽位关系，可贴装、嵌入或吊装，但不能变成其它通道灯具体量。"
  },
  generic: {
    mountFamily: "generic",
    scaleClass: "general",
    requiredStructures: "产品图中真实可见的灯体轮廓、发光面、材质颜色、安装接触关系和真实比例",
    forbiddenStructures: "产品图里没有的电源线、驱动盒、弹簧卡扣、散热器、吊线、吊杆、链条、灯臂、底盘、轨道、开孔或装饰零件",
    referenceMountSlot: "参考图里的原灯具位置、安装平面或最合理的灯具槽位",
    installRule: "安装方式必须来自产品图可见结构，比例、接触点、阴影和透视要可信。"
  }
};

const LAMP_CHANNEL_SPECS = {
  small: {
    label: "小灯独立通道",
    boundary: "只使用小型灯具语义：紧凑灯体、灯杯/灯头/面环/发光口/卡扣/轨道或贴顶接触面；不要借用其它通道的结构表达或体量。",
    identityLine: "输入图 2 是替换用小灯身份来源：保留紧凑灯体、发光口、灯杯/灯头/面环/模块、对应安装接触结构、材质、颜色、小体量和安装几何。",
    physicsLine: "小灯安装物理：体量小、贴合安装平面或轨道槽位，接触点清楚，阴影短而可信，不能被放大成主灯主体。"
  },
  large: {
    label: "大灯独立通道",
    boundary: "只使用大灯语义：完整灯体、灯罩、灯臂、底盘/吸顶盘、吊线/吊杆或大型贴顶结构；不要借用其它通道的结构表达或体量。",
    identityLine: "输入图 2 是替换用大灯身份来源：保留完整灯体、灯罩、灯臂、吸顶盘/底座、可见吊线/吊杆、材质、颜色、比例和安装结构。",
    physicsLine: "大灯安装物理：保持主灯体量、重心、挂点/贴顶面、阴影和空间尺度可信，不要压缩成其它通道体量。"
  },
  wall: {
    label: "壁装独立通道",
    boundary: "只使用壁装灯具语义：墙面底座、墙体接触面、出光方向、灯臂/灯罩或壁装发光面；不要借用其它通道的结构表达或体量。",
    identityLine: "输入图 2 是替换用壁装灯身份来源：保留墙面底座、可见灯臂或灯罩、发光面、墙体接触几何、材质、颜色和比例。",
    physicsLine: "壁装安装物理：灯具必须贴合墙面，底座、投影、阴影和出光方向与墙面一致。"
  },
  linear: {
    label: "线性灯独立通道",
    boundary: "只使用线性灯具语义：连续线条、长条发光面、端盖、连接件、暗槽/贴装/吊装关系；不要借用其它通道的结构表达或体量。",
    identityLine: "输入图 2 是替换用线性灯身份来源：保留连续灯体、长条发光面、端盖、连接件、安装槽/接触面、材质、颜色和比例。",
    physicsLine: "线性灯安装物理：保持连续线条和槽位/贴装/吊装关系，不断裂、不漂浮、不变成点状灯。"
  },
  generic: {
    label: "通用灯具通道",
    boundary: "只使用产品图可见的灯具结构语义，不主动借用其它通道的专用安装结构。",
    identityLine: "输入图 2 是替换用灯具身份来源：保留上传产品图可见外形、材质、颜色、发光面、比例和安装结构。",
    physicsLine: "通用安装物理：安装方向、安装平面、连接结构、阴影、比例和透视必须来自产品图并保持可信。"
  }
};

function mountSemanticText(profile = {}, settings = {}) {
  return [
    settings.lampCategory,
    settings.lampCategoryLabel,
    settings.lampCategoryHint,
    profile.lampCategory,
    profile.lampCategoryLabel,
    profile.lampCategoryHint,
    profile.productName,
    profile.lampType,
    profile.lampSubtype,
    profile.installationPosition,
    profile.installationMethod,
    profile.visibleParts,
    profile.structureKeywords,
    profile.hardConstraints,
    profile.visualStrategy?.hardConstraints,
    profile.sellingPoint,
    profile.sellingPoints
  ].filter(Boolean).join(" ");
}

function hasVisibleAdjustableSmallLampStructure(value = "") {
  const text = String(value || "")
    .replace(/(?:禁止|不得|不要|不出现|不生成|绝对禁止|without|no)[^。；;\n]*(?:可调|调节|转轴|支架|关节|轨道|adjustable|swivel|pivot|gimbal|tiltable|rotatable)[^。；;\n]*/gi, "");
  return /(可调|调节|灯头可调|转轴|万向|球形关节|活动支架|yoke|swivel|pivot|gimbal|adjustable|tiltable|rotatable|track[-\s]?spotlight|轨道射灯|轨道.*射灯|射灯.*轨道)/i.test(text);
}

function hasFixedSurfaceCylinderSmallLampSignal(value = "") {
  const text = String(value || "");
  const surfaceSignal = /(surface[-\s]?mounted|surface[-\s]?mount|ceiling[-\s]?mounted|surface[-\s]?downlight|明装|贴顶|吸顶|顶面接触|顶部接触面|无需开孔)/i.test(text);
  const cylinderSignal = /(cylinder|cylindrical|round|圆柱|圆筒|筒灯|downlight|深杯|灯杯|面环)/i.test(text);
  return surfaceSignal && cylinderSignal;
}

function inferMountFamily(profile = {}, settings = {}) {
  const text = mountSemanticText(profile, settings);
  const adjustableSmallLamp = hasVisibleAdjustableSmallLampStructure(text);
  if (hasFixedSurfaceCylinderSmallLampSignal(text) && !adjustableSmallLamp) return "surface-downlight";
  if (/轨道射灯|track-spotlight|track spotlight|磁吸射灯|轨道.*射灯|射灯.*轨道/i.test(text)) return "track-spotlight";
  if (!adjustableSmallLamp && /明装筒灯|surface[-\s]?mounted|surface[-\s]?mount|surface[-\s]?downlight|ceiling[-\s]?mounted|明装|无需开孔|贴顶筒灯|贴顶|顶面接触|顶部接触面/i.test(text)) return "surface-downlight";
  if (/嵌入筒灯|嵌入式筒灯|防眩筒灯|recessed[-\s]?downlight|anti[-\s]?glare|嵌入|暗装|开孔|面环/i.test(text)) return "recessed-downlight";
  if (/筒灯|downlight/i.test(text)) return "recessed-downlight";
  if (/轨道灯|磁吸轨道|导轨|track|magnetic/i.test(text) && /射灯|spotlight|灯头/i.test(text)) return "track-spotlight";
  if (/轨道灯|磁吸轨道|导轨|track|magnetic/i.test(text)) return "track";
  if (/射灯|spotlight|斗胆灯|洗墙射灯|wall[-\s]?washer|可调射灯|转轴|可调角度|灯头可调/i.test(text)) return "spotlight";
  if (/吸顶灯|ceiling/i.test(text)) return "ceiling";
  if (/吊灯|chandelier|pendant|吊线|吊杆|链条/i.test(text)) return "chandelier";
  if (/壁灯|wall lamp|wall light|墙面安装/i.test(text)) return "wall";
  if (/线性灯|灯带|灯条|柜灯|linear|strip|cabinet/i.test(text)) return "linear";
  return "generic";
}

function mountingSemantics(profile = {}, settings = {}) {
  const explicit = String(profile.mountFamily || settings.mountFamily || "").trim();
  const text = mountSemanticText(profile, settings);
  const fixedSurfaceCylinder = hasFixedSurfaceCylinderSmallLampSignal(text) && !hasVisibleAdjustableSmallLampStructure(text);
  const inferred = inferMountFamily(profile, settings);
  const key = fixedSurfaceCylinder && /^(spotlight|track-spotlight)$/i.test(explicit)
    ? "surface-downlight"
    : explicit === "generic" && inferred !== "generic" ? inferred
      : MOUNT_SEMANTIC_SPECS[explicit] ? explicit : inferred;
  const spec = MOUNT_SEMANTIC_SPECS[key] || MOUNT_SEMANTIC_SPECS.generic;
  const requestedScale = String(profile.scaleClass || "").trim().toLowerCase();
  const scaleClass = /^(tiny|small|medium|large|linear|general)$/.test(requestedScale) ? requestedScale : spec.scaleClass;
  return {
    ...spec,
    mountFamily: spec.mountFamily,
    scaleClass,
    requiredStructures: String(profile.requiredStructures || spec.requiredStructures).trim(),
    forbiddenStructures: String(profile.forbiddenStructures || spec.forbiddenStructures).trim(),
    referenceMountSlot: String(profile.referenceMountSlot || spec.referenceMountSlot).trim()
  };
}

function normalizeInstallSurface(value = "", semantic = {}) {
  const text = String(value || "").trim().toLowerCase();
  if (/ceiling|天花|吊顶|顶面/.test(text)) return "ceiling";
  if (/wall|墙/.test(text)) return "wall";
  if (/track|rail|轨道|导轨|磁吸/.test(text)) return "track";
  if (/cabinet|柜|橱柜|展柜/.test(text)) return "cabinet";
  if (semantic.mountFamily === "wall") return "wall";
  if (semantic.mountFamily === "track" || semantic.mountFamily === "track-spotlight") return "track";
  if (semantic.mountFamily === "linear") return "ceiling";
  return "ceiling";
}

function normalizeVisibleParts(value = "", semantic = {}) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
  const text = String(value || "").trim();
  if (text) return text;
  return semantic.requiredStructures || "灯体、发光面、安装结构";
}

function lampChannelFromSemantic(semantic = {}) {
  if (semantic.scaleClass === "linear" || semantic.mountFamily === "linear") return "linear";
  if (semantic.mountFamily === "wall") return "wall";
  if (["recessed-downlight", "surface-downlight", "spotlight", "track-spotlight", "track"].includes(semantic.mountFamily)) return "small";
  if (["tiny", "small"].includes(semantic.scaleClass)) return "small";
  if (semantic.scaleClass === "large") return "large";
  return "generic";
}

const SMALL_LAMP_VISUAL_STRATEGY_FIELDS = [
  "productStyle",
  "suitableVisualStyle",
  "styleKeywords",
  "moodKeywords",
  "lightingEffect",
  "colorSystem",
  "visualLanguage",
  "decorativeElements",
  "recommendedView",
  "productComplexStructure",
  "hardConstraints"
];

function visualStrategyText(value = "", fallback = "以上传图真实结构和材质为准") {
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
    return joined || fallback;
  }
  if (value && typeof value === "object") {
    const joined = Object.values(value).map((item) => String(item || "").trim()).filter(Boolean).join("、");
    return joined || fallback;
  }
  return String(value || "").trim() || fallback;
}

function stripProductImageBackgroundColorText(value = "", fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const withoutExplicitBackground = raw
    .replace(/(?:产品图|上传图|图片)?(?:背景|底色|底图|画布|环境色)[^，,、；;。.\n]*/g, "")
    .replace(/(?:白底|灰底|黑底|米色背景|浅色背景|深色背景|纯色背景|渐变背景|桌面色|墙面色|地面色|台面色|布景色)/g, "");
  const chunks = withoutExplicitBackground
    .split(/[；;。.\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item
      .split(/[，,、]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/(背景|底色|底图|画布|环境色|桌面|墙面|地面|台面|布景|阴影|环境反光)/.test(part))
      .join("、"))
    .filter(Boolean);
  const cleaned = chunks.join("；").replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, "").trim();
  return cleaned || fallback;
}

function booleanVisualStrategyValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (/^(true|yes|1|复杂|是)$/.test(text)) return true;
  if (/^(false|no|0|简单|否)$/.test(text)) return false;
  return fallback;
}

function inferSmallLampComplexStructure(profile = {}, semantic = {}) {
  const text = [
    profile.visibleParts,
    profile.structureKeywords,
    profile.requiredStructures,
    profile.installationMethod,
    semantic.requiredStructures
  ].filter(Boolean).join(" ");
  return /弹簧|卡扣|反光杯|拉丝|深杯|灯杯|转轴|支架|轨道|磁吸|连接件|安装结构/i.test(text);
}

function normalizeVisualStrategy(profile = {}, semantic = {}, lampChannel = "") {
  const incoming = profile.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {};
  const baseFallback = "以上传图真实结构和材质为准";
  const genericStyle = /^(现代商用产品图|灯具|灯具产品|以上传图真实结构和材质为准)$/;
  const profileStyle = genericStyle.test(String(profile.style || "").trim()) ? "" : profile.style;
  const productInfoStyle = [
    profile.lampSubtype || profile.lampType,
    profile.material,
    profile.colorPalette,
    profile.targetSpace,
    profile.lightUse
  ].map((item) => cleanPromptPart(item)).filter(Boolean).slice(0, 3).join("、") || "产品造型、真实材质和适用空间";
  const productInfoColor = stripProductImageBackgroundColorText(
    [profile.colorPalette, profile.material].map((item) => cleanPromptPart(item)).filter(Boolean).join("、"),
    "按产品本体材质、颜色、发光口和适用空间识别主色、辅助色和点缀色"
  );
  const productInfoScene = [
    profile.targetSpace,
    profile.lightUse,
    profile.sellingPoint
  ].map((item) => cleanPromptPart(item)).filter(Boolean).slice(0, 3).join("、") || productInfoStyle;
  const productInfoLanguage = [
    profileStyle || productInfoStyle,
    profile.structureKeywords || profile.visibleParts,
    profile.targetSpace
  ].map((item) => cleanPromptPart(item)).filter(Boolean).slice(0, 3).join("、");
  const strategy = {
    productStyle: visualStrategyText(incoming.productStyle || profileStyle || productInfoStyle, baseFallback),
    suitableVisualStyle: visualStrategyText(incoming.suitableVisualStyle || productInfoScene, baseFallback),
    styleKeywords: visualStrategyText(incoming.styleKeywords || productInfoStyle, baseFallback),
    moodKeywords: visualStrategyText(incoming.moodKeywords || productInfoScene, baseFallback),
    lightingEffect: visualStrategyText(incoming.lightingEffect || profile.lightUse || productInfoScene, baseFallback),
    colorSystem: stripProductImageBackgroundColorText(
      visualStrategyText(incoming.colorSystem || profile.colorPalette, ""),
      productInfoColor || baseFallback
    ),
    visualLanguage: visualStrategyText(incoming.visualLanguage || productInfoLanguage, baseFallback),
    decorativeElements: visualStrategyText(incoming.decorativeElements || productInfoScene, baseFallback),
    recommendedView: visualStrategyText(incoming.recommendedView || [profile.visibleParts, profile.installationMethod, profile.targetSpace].map((item) => cleanPromptPart(item)).filter(Boolean).slice(0, 3).join("、"), baseFallback),
    productComplexStructure: booleanVisualStrategyValue(incoming.productComplexStructure, inferSmallLampComplexStructure(profile, semantic) || lampChannel !== "generic"),
    hardConstraints: visualStrategyText(incoming.hardConstraints || profile.hardConstraints || [
      "严格还原上传图可见产品结构、材质、颜色和安装关系",
      profile.visibleParts || profile.structureKeywords || semantic.requiredStructures,
      "不得新增上传图里没有的部件或改成其它灯具品类"
    ].filter(Boolean).join("；"), baseFallback)
  };
  for (const field of SMALL_LAMP_VISUAL_STRATEGY_FIELDS) {
    if (!(field in strategy)) strategy[field] = field === "productComplexStructure" ? false : baseFallback;
  }
  return strategy;
}

function isUnusableRecognitionLabel(value = "") {
  const text = String(value || "").trim();
  if (!text) return true;
  const stripped = text.replace(/[?\s/|｜、，,._:-]+/g, "");
  if (!stripped) return true;
  return /^(unknown|none|null|undefined|n\/a)$/i.test(text);
}

function fallbackLampTypeLabel(semantic = {}) {
  const mountFamily = String(semantic.mountFamily || "").trim();
  if (semantic.scaleClass === "large" || ["ceiling", "chandelier"].includes(mountFamily)) return "\u5927\u706f";
  if (semantic.scaleClass === "small" || /downlight|spotlight|track/.test(mountFamily)) return "\u5c0f\u706f";
  if (mountFamily === "wall") return "\u58c1\u706f";
  if (mountFamily === "linear") return "\u7ebf\u6027\u706f";
  return "\u706f\u5177";
}

function fallbackLampSubtypeLabel(semantic = {}) {
  const mountFamily = String(semantic.mountFamily || "").trim();
  if (mountFamily === "chandelier") return "\u540a\u706f";
  if (mountFamily === "ceiling") return "\u5438\u9876\u706f";
  if (mountFamily === "recessed-downlight") return "\u5d4c\u5165\u5f0f\u7b52\u706f";
  if (mountFamily === "surface-downlight") return "\u660e\u88c5\u7b52\u706f";
  if (mountFamily === "track-spotlight") return "\u8f68\u9053\u5c04\u706f";
  if (mountFamily === "spotlight") return "\u5c04\u706f";
  if (mountFamily === "wall") return "\u58c1\u706f";
  if (mountFamily === "linear") return "\u7ebf\u6027\u706f";
  return fallbackLampTypeLabel(semantic);
}

const RECOGNITION_COPY_PLACEHOLDER_RE = /(电商商品图|现代商用产品图|让空间更有层次|产品展示|商品展示|灯具产品|现代商用|以上传图|待识别|高端工业风|专属模板)/g;
const RECOGNITION_COPY_PLACEHOLDER_TEST_RE = /(电商商品图|现代商用产品图|让空间更有层次|产品展示|商品展示|灯具产品|现代商用|以上传图|待识别|高端工业风|专属模板)/;
const RECOGNITION_PRODUCT_WORD_RE = /(空间主灯|艺术吊灯|水晶吊灯|明装小射灯|明装筒灯|轨道射灯|嵌入式筒灯|吊灯|吸顶灯|主灯|壁灯|射灯|筒灯|小灯|线性灯|灯具|产品图|商品图)/g;
const RECOGNITION_PRODUCT_WORD_TEST_RE = /(空间主灯|艺术吊灯|水晶吊灯|明装小射灯|明装筒灯|轨道射灯|嵌入式筒灯|吊灯|吸顶灯|主灯|壁灯|射灯|筒灯|小灯|线性灯|灯具|产品图|商品图)/;
const RECOGNITION_STYLE_CANDIDATES = [
  "现代简约",
  "轻法式",
  "新中式",
  "奶油风",
  "侘寂风",
  "意式",
  "法式",
  "北欧",
  "日式",
  "中式",
  "欧式",
  "美式",
  "轻奢",
  "极简",
  "工业风",
  "现代"
];

function cleanRecognitionCopyText(value = "", { maxLength = 16 } = {}) {
  const text = cleanChineseOverlayText(value, { maxLength: Math.max(24, Number(maxLength) || 16) })
    .replace(RECOGNITION_COPY_PLACEHOLDER_RE, "")
    .replace(/^[的之、，。；：\s]+|[的之、，。；：\s]+$/g, "")
    .trim();
  if (!text || RECOGNITION_COPY_PLACEHOLDER_TEST_RE.test(text)) return "";
  return cleanChineseOverlayText(text, { maxLength });
}

function removeRecognitionCopyTerms(value = "", terms = [], { maxLength = 16 } = {}) {
  let text = cleanRecognitionCopyText(value, { maxLength: Math.max(24, Number(maxLength) || 16) });
  if (!text) return "";
  const cleanTerms = terms
    .map((term) => cleanRecognitionCopyText(term, { maxLength: 16 }))
    .filter((term) => term && term.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const term of cleanTerms) {
    text = text.split(term).join("");
  }
  return cleanRecognitionCopyText(text, { maxLength });
}

function normalizeRecognitionStyle(value = "") {
  const raw = cleanChineseOverlayText(value, { maxLength: 12 });
  if (/现代商用产品图|现代商用/.test(raw)) return "现代";
  const text = cleanRecognitionCopyText(value, { maxLength: 12 });
  if (!text) return "";
  const matched = RECOGNITION_STYLE_CANDIDATES.find((item) => text.includes(item));
  if (matched) return matched;
  if (/照明|光效|光线|灯具|筒灯|射灯|吊灯|壁灯|主灯|小灯|空间|家居质感|功能/.test(text)) return "";
  const withoutProduct = text.replace(RECOGNITION_PRODUCT_WORD_RE, "");
  return cleanRecognitionCopyText(withoutProduct, { maxLength: 6 });
}

function normalizeRecognitionLampSubtype(value = "", terms = [], semantic = {}) {
  const fallback = fallbackLampSubtypeLabel(semantic);
  const stripped = removeRecognitionCopyTerms(value, terms, { maxLength: 12 });
  const text = stripped || cleanRecognitionCopyText(value, { maxLength: 12 });
  if (!text || /^(灯具|产品图|商品图)$/.test(text)) return fallback;
  return text;
}

function recognitionMoodKeywordList(value = "", terms = []) {
  return String(value || "")
    .split(/[、，,；;\/\s]+/)
    .map((item) => removeRecognitionCopyTerms(item, terms, { maxLength: 12 }).replace(RECOGNITION_PRODUCT_WORD_RE, ""))
    .map((item) => cleanRecognitionCopyText(item, { maxLength: 10 }))
    .filter(Boolean)
    .filter((item) => !/(干净留白|基础照明|氛围照明|留白|基础照|照明)/.test(item))
    .filter((item) => !RECOGNITION_PRODUCT_WORD_TEST_RE.test(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 3);
}

function mergeRecognitionCopyParts(parts = [], { maxLength = 14 } = {}) {
  const result = [];
  for (const part of parts) {
    const text = cleanRecognitionCopyText(part, { maxLength });
    if (!text) continue;
    if (result.some((item) => item.includes(text) || text.includes(item))) continue;
    result.push(text);
  }
  return cleanRecognitionCopyText(result.join(""), { maxLength });
}

function normalizeRecognitionHeroCopy(profile = {}, semantic = {}) {
  const incoming = profile.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {};
  const rawIncoming = profile.rawVisualStrategy && typeof profile.rawVisualStrategy === "object" ? profile.rawVisualStrategy : incoming;
  const style = normalizeRecognitionStyle(profile.style || rawIncoming.styleKeywords || rawIncoming.productStyle || "");
  const rawSubtype = profile.lampSubtype || profile.subtype || "";
  const lampType = profile.lampType || profile.type || fallbackLampTypeLabel(semantic);
  const lampSubtype = normalizeRecognitionLampSubtype(rawSubtype, [style], semantic);
  const removalTerms = [style, rawSubtype, lampSubtype, lampType, fallbackLampTypeLabel(semantic), fallbackLampSubtypeLabel(semantic)];
  const moodKeywords = recognitionMoodKeywordList([
    rawIncoming.moodKeywords,
    rawIncoming.productStyle
  ].filter(Boolean).join("、"), removalTerms);
  const productStyle = mergeRecognitionCopyParts([style, moodKeywords[0], lampSubtype], { maxLength: 14 })
    || mergeRecognitionCopyParts([style, lampSubtype], { maxLength: 14 });
  return {
    style,
    lampSubtype,
    productStyle,
    moodKeywords: moodKeywords.join("、")
  };
}

function compactVisualStrategyValue(value = "") {
  const text = cleanPromptPart(value)
    .replace(/^(根据|按照|结合)?(图片|上传图|产品).*?(识别|判断|选择)/, "")
    .replace(/^适合的?/, "")
    .replace(/^只使用符合产品风格的?/, "")
    .trim();
  if (!text || /^[?？…、，,。.;；:\s-]+$/.test(text) || /^根据|^以上传图|^按上传图|^只使用/.test(text)) return "";
  return text;
}

function compactSmallLampVisualStrategy(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile)) return null;
  return compactVisualStrategyFromProfile(safeProfile, "small");
}

function compactVisualStrategyFromProfile(profile = {}, lampChannel = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const strategy = normalizeVisualStrategy(safeProfile, mountingSemantics(safeProfile), lampChannel || safeProfile.lampChannel);
  const style = [
    compactVisualStrategyValue(strategy.suitableVisualStyle),
    compactVisualStrategyValue(strategy.productStyle),
    compactVisualStrategyValue(strategy.styleKeywords)
  ].filter(Boolean).slice(0, 3).join("、");
  const mood = [
    compactVisualStrategyValue(strategy.moodKeywords),
    compactVisualStrategyValue(strategy.lightingEffect)
  ].filter(Boolean).slice(0, 2).join("；");
  const visual = [
    compactVisualStrategyValue(strategy.colorSystem),
    compactVisualStrategyValue(strategy.visualLanguage),
    compactVisualStrategyValue(strategy.decorativeElements)
  ].filter(Boolean).slice(0, 3).join("；");
  return {
    style,
    mood,
    visual,
    view: compactVisualStrategyValue(strategy.recommendedView),
    hard: compactVisualStrategyValue(strategy.hardConstraints),
    complex: Boolean(strategy.productComplexStructure)
  };
}

function compactLargeLampVisualStrategy(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isLargeLampProfile(safeProfile, {}) || isSmallLampProfile(safeProfile, {})) return null;
  return compactVisualStrategyFromProfile(safeProfile, "large");
}

function compactLampVisualStrategy(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (isSmallLampProfile(safeProfile, settings)) return compactSmallLampVisualStrategy(safeProfile);
  if (isLargeLampProfile(safeProfile, settings)) return compactLargeLampVisualStrategy(safeProfile);
  return compactVisualStrategyFromProfile(safeProfile, lampChannelSpec(safeProfile, settings).channel);
}

function smallLampVisualStrategyLines(profile = {}) {
  const compact = compactSmallLampVisualStrategy(profile);
  if (!compact) return [];
  return [
    compact.style ? `视觉方向：${compact.style}。` : "",
    compact.mood ? `氛围光影：${compact.mood}。` : "",
    compact.visual ? `色彩/画面语言：${compact.visual}。` : "",
    compact.hard ? `硬性保真：${compact.hard}。` : ""
  ].filter(Boolean);
}

function smallLampVisualStrategyPrompt(profile = {}, { visible = false } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile)) return "";
  const compact = compactSmallLampVisualStrategy(safeProfile);
  if (!compact) return "";
  if (visible) {
    return [
      compact.style ? `视觉风格：${compact.style}。` : "",
      compact.mood ? `氛围光影：${compact.mood}。` : "",
      compact.visual ? `色彩与装饰：${compact.visual}。` : "",
      `产品呈现：${compact.view ? `${compact.view}，` : ""}突出${safeProfile.structureKeywords || safeProfile.visibleParts}。`
    ].filter(Boolean).join("\n");
  }
  const lines = smallLampVisualStrategyLines(safeProfile);
  if (!lines.length) return "";
  const suffix = "仅作为隐藏方向；不得把字段名、章节标题、字体名、hex 色值或规则说明渲染到画面中。";
  return [...lines, suffix].join("\n");
}

function lampChannelSpec(profile = {}, settings = {}) {
  const semantic = mountingSemantics(profile, settings);
  const requestedChannel = String(profile.lampChannel || settings.lampChannel || "").trim().toLowerCase();
  const channel = /^(large|small|linear|wall|generic)$/.test(requestedChannel)
    ? requestedChannel
    : lampChannelFromSemantic(semantic);
  return { channel, ...(LAMP_CHANNEL_SPECS[channel] || LAMP_CHANNEL_SPECS.generic) };
}

function lampChannelIsolationPrompt(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  if (channel.channel === "small") {
    return [
      `小灯通道：只使用当前安装族 ${safeProfile.mountFamily} 对应的小灯结构，优先遵守本产品图可见的紧凑灯体、灯杯/面环/发光口、贴顶接触面、开孔或导轨连接语义。`,
      "保持小体量和真实安装面，不借用其它通道的大型主体或悬吊结构。"
    ].join("\n");
  }
  if (channel.channel === "large") {
    return [
      "大灯通道：只使用完整灯体、灯罩、灯臂、吊线/吊杆、吸顶盘/底盘、贴顶或悬吊主灯比例。",
      "不读取小灯灯位字段，不压缩成小灯或线性灯体量。"
    ].join("\n");
  }
  if (channel.channel === "wall") {
    return "壁装通道硬隔离：只使用墙面底座、墙体接触面、出光方向和壁装灯体结构，不读取小灯灯位字段，也不生成吊灯/轨道灯结构。";
  }
  if (channel.channel === "linear") {
    return "线性灯通道硬隔离：只使用连续线条、长条发光面、端盖、暗槽/贴装/吊装关系，不生成点状小灯或大型主灯结构。";
  }
  return "通用灯具通道硬隔离：只使用产品图可见结构，不主动借用大灯、小灯、壁灯或线性灯的专用结构。";
}

function smallLampFamilyPrompt(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    generic: "小灯通用模板：只展示上传图真实存在的紧凑灯体、发光口、灯杯/面环/模块和对应安装接触结构；不主动生成转轴、支架、轨道、嵌入开孔或其它未在产品图中出现的结构。",
    "recessed-downlight": "嵌入式筒灯/射灯模板：展示或复刻面环、深杯/灯杯、发光口、吊顶开孔、齐平贴合关系和聚光光斑；场景中必须落在开孔内，灯体藏进吊顶，不生成明装圆柱、贴顶灯座或外露大灯体。",
    "surface-downlight": "明装筒灯模板：展示或复刻贴顶短圆柱/方盒，完整灯体外露，顶部整面接触天花，底部黑色深杯/小发光口朝下；场景中必须整灯垂直贴顶，不悬空、不悬吊、不倾斜，不生成开孔齐平、只露面环、转轴、支架或灯头颈部。",
    spotlight: "射灯模板：展示或复刻灯头、灯杯、转轴、支架、照射方向和光斑/洗墙关系；保持小体量和可信角度。",
    "track-spotlight": "轨道射灯模板：展示或复刻导轨、卡扣/磁吸连接、灯头角度、转轴支架和沿轨道安装关系；必须连接轨道，不漂浮。",
    track: "轨道灯模板：展示或复刻导轨/磁吸轨道、灯体模块、卡扣连接点、发光面和沿轨道安装关系；灯体不能脱离轨道。"
  };
  return map[safeProfile.mountFamily] || map.generic;
}

function smallLampMountFamilyStrictLock(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    "surface-downlight": [
      "明装筒灯结构硬锁：整灯是一个短小贴顶圆柱/方盒，完整灯体外露，顶部整面贴合天花，底部开口朝下，黑色深杯和小发光口在底部中心。",
      "明装筒灯安装比例硬锁：天花只是与灯体顶部接触的平面，灯体必须露出完整筒身高度；不能与天花齐平，不能只露面环，不能让筒身藏进吊顶。",
      "明装筒灯绝对禁止：倾斜灯头、球形关节、转轴、短杆、支架、灯头颈部、侧向洗墙射灯结构、轨道连接件、嵌入式开孔面环、爆炸拆件或把灯杯单独拉出。"
    ].join("\n"),
    "recessed-downlight": [
      "嵌入式筒灯/射灯结构硬锁：只表现贴合吊顶开孔的面环、深杯/灯杯和小发光口，灯体主体隐藏在吊顶内，可表现聚光光斑。",
      "嵌入式绝对禁止：明装圆柱/方盒、贴顶灯座、完整外露筒身、顶部贴顶接触面、悬浮灯体、外露支架/转轴、轨道连接件、弹簧卡扣、电源线或外置驱动。"
    ].join("\n"),
    spotlight: "射灯结构硬锁：只有上传图本身是射灯时才允许灯头、转轴和支架；不得把筒灯改成射灯。",
    "track-spotlight": "轨道射灯结构硬锁：只有上传图本身含轨道/卡扣时才允许轨道和转轴；不得把普通筒灯改成轨道射灯。",
    track: "轨道灯结构硬锁：灯体必须沿导轨安装；不得把无轨道产品改成轨道灯。"
  };
  return map[safeProfile.mountFamily] || "";
}

function smallLampProductWorkspacePrompt(category = "", profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, settings)) return "";
  const isScene = String(category || "").toLowerCase() === "scene";
  return [
    isScene
      ? "小灯场景规则：真实空间安装效果优先，产品细节交给主图、卖点图、功能图和细节图展示，不为了结构清楚而放大成主视觉灯。"
      : "商品图小灯规则：展示清楚小灯真实结构，不放大成主视觉大灯。",
    smallLampFamilyPrompt(safeProfile),
    isScene
      ? "场景中只表现安装后的小灯位、接触点和真实光效，不做局部放大、剖面展示或商品特写。"
      : "可使用正面、侧面、轻微俯视、剖面、局部放大或安装示意；只展示产品图可见结构。",
    smallLampDisplayGuidance(category, safeProfile, settings)
  ].filter(Boolean).join("\n");
}

function smallLampStyleClonePrompt(shot = {}, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, settings)) return "";
  const target = shot.referenceTarget || shot.referenceAnalysis;
  const targetLine = target && typeof target === "object"
    ? "必须使用 referenceTarget 的 bbox/anchor/mountPlane/slotKind/perspective/scaleHint 来控制位置、大小、安装面和透视。"
    : "如果没有 referenceTarget，仍必须保持小灯真实体量、安装面和透视，不要新增大灯结构。";
  const directLine = isDirectStyleCloneSettings(settings)
    ? "直接换主体时：只替换参考图原灯位，不新增第二个灯具，不改变参考图构图、镜头、光影和空间关系。"
    : "相似场景时：不强制复制原灯位，但必须保持小灯安装逻辑、真实比例、接触点、光照方向和透视关系。";
  return [
    "风格复刻小灯规则：位置、大小、透视和安装面优先于商品放大展示。",
    smallLampFamilyPrompt(safeProfile),
    targetLine,
    directLine,
    "小灯保持 tiny/small 体量，不借用其它通道大型主体或悬吊结构。"
  ].join("\n");
}

function lampChannelPrompt(profile = {}, settings = {}) {
  const channel = lampChannelSpec(profile, settings);
  return [
    `灯具生成通道：${channel.label}。`,
    `通道边界：${channel.boundary}`
  ].join("\n");
}

function lampChannelIdentityLine(profile = {}, settings = {}) {
  return lampChannelSpec(profile, settings).identityLine;
}

function installationPhysicsPromptForProfile(profile = {}, settings = {}) {
  return lampChannelSpec(profile, settings).physicsLine;
}

function productConsistencyLockLines(profile = {}, settings = {}) {
  const semantic = mountingSemantics(profile, settings);
  return [
    lampChannelPrompt(profile, settings),
    lampChannelIsolationPrompt(profile, settings),
    "产品一致性：以用户上传的灯具产品图为唯一主体来源，保留真实轮廓、比例、材质、颜色和发光面。",
    lampChannelFromSemantic(semantic) === "small" ? smallLampMountMutationLock({ ...profile, mountFamily: semantic.mountFamily }) : "",
    `安装结构锁定：${semantic.installRule}`,
    `必须保留：${semantic.requiredStructures}。`,
    `禁止生成：${semantic.forbiddenStructures}；禁止改款、融合多个灯具、添加产品图里没有的零件或把灯具变成其它品类。`
  ];
}

function productConsistencyLockPrompt(profile = {}, settings = {}) {
  return productConsistencyLockLines(profile, settings).join("\n");
}

function productConsistencyOneLine(profile = {}, settings = {}) {
  return productConsistencyLockLines(profile, settings).join(" ");
}

function isSmallLampProfile(profile = {}, settings = {}) {
  return lampChannelSpec(profile, settings).channel === "small";
}

function isSmallLampGeneration(profile = {}, settings = {}) {
  return isSmallLampProfile(profile, settings);
}

function smallLampDisplayGuidance(category = "", profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, settings)) return "";
  const family = safeProfile.mountFamily;
  const partText = smallLampPublicVisibleParts(safeProfile);
  const base = `小灯专用展示：${safeProfile.lampType}/${safeProfile.lampSubtype}，安装面 ${safeProfile.installSurface}，可见部件 ${partText}。`;
  const familyGuidance = {
    generic: "小灯只展示上传图真实存在的紧凑灯体、发光口、灯杯/面环/模块和对应安装接触结构；不要补充转轴、支架、轨道、嵌入开孔或其它产品图没有的结构。",
    "recessed-downlight": "嵌入式筒灯/射灯只展示面环、深杯/灯杯、发光口、吊顶开孔剖面、聚光光斑和安装细节；场景中应嵌入吊顶开孔，面环贴合天花，不生成明装圆柱、贴顶灯座或完整外露筒身。",
    "surface-downlight": "明装筒灯展示贴顶短圆柱/方盒、完整外露筒身、顶部整面接触天花、底部黑色深杯和小发光口；场景中必须整灯垂直贴顶，不悬空、不倾斜、不生成开孔齐平、只露面环、转轴或支架。",
    spotlight: "射灯展示灯头、灯杯、转轴/支架、照射方向、光斑或洗墙效果；场景中保持小体量和可信角度。",
    "track-spotlight": "轨道射灯展示轨道线、卡扣连接、灯头角度和沿轨道安装；场景中必须连接轨道，不漂浮。",
    track: "轨道灯展示导轨/磁吸轨道、灯体模块、卡扣或磁吸连接点和沿轨道安装关系。"
  };
  const byCategory = {
    main: "主图以清晰产品结构展示为主，可用正面、侧面或轻微俯视，不要做大型装饰主灯构图。",
    selling: "卖点图围绕防眩、显色、光束角、开孔/明装便利或对应安装方式做单一购买理由；只有射灯/轨道射灯才允许角度调节表达。",
    function: "功能图可做光束角、照射范围、开孔/贴顶/轨道安装的图文卡片；只有射灯/轨道射灯才允许转轴调节表达。",
    scene: "场景图必须按真实安装面放置，尺寸接近真实小灯，保持正常层高和完整空间尺度，不要因为展示清晰而放大成主灯或贴近天花拍摄。",
    detail: "细节图只聚焦当前安装族真实存在的面环、灯杯、发光口、贴顶接触面、卡扣、轨道连接或安装剖面；不要引入产品图没有的转轴、支架或其它结构。",
    real: "实拍图像真实到货或安装后拍摄，保留小灯尺寸、透视和接触点。"
  };
  return [base, familyGuidance[family] || familyGuidance.generic, byCategory[category] || ""].filter(Boolean).join(" ");
}

function smallLampSubjectMultiplicityLock(category = "") {
  const value = String(category || "").toLowerCase();
  if (value === "function") {
    return "功能图单主体锁：只允许一个完整上传产品主体；可添加一个局部放大框、结构裁切或光效示意作为辅助，不得出现多个完整同款产品、多个商品主体卡片、重复产品阵列或多角度产品拼贴。";
  }
  if (value === "detail") {
    return "细节图单主体锁：只允许一个产品局部或一个完整产品加一个局部放大；不得出现多个完整同款产品、多个同等清晰主体或产品拼贴阵列。";
  }
  return "";
}

function smallLampDetailRoutePrompt(shot = {}) {
  const route = shot.promptRoute || {};
  if (!route.sequenceSlot && !route.pageRole && !route.viewMode && !route.subjectPolicy) return "";
  return [
    `页面脚本锁：本张是第 ${route.sequenceIndex || ""} 张，类别=${route.label || route.category || shot.category || ""}，角色=${route.pageRole || shot.title || ""}。`,
    route.viewMode ? `本张构图/镜头：${route.viewMode}。` : "",
    route.focusPoint ? `本张只聚焦：${route.focusPoint}。` : "",
    route.subjectPolicy ? `本张主体策略：${route.subjectPolicy}` : "",
    "识别出的推荐视角、风格和材质只作为补充事实；不得覆盖本张页面脚本、镜头距离、空间/功能/细节分工。"
  ].filter(Boolean).join("\n");
}

function smallLampPhysicalScalePrompt(category = "", profile = {}, settings = {}, options = {}) {
  return smallLampSceneScaleGuard(category, profile, settings, options);
}

function smallLampSceneScaleGuard(category = "", profile = {}, settings = {}, options = {}) {
  const value = String(category || "").toLowerCase();
  const sequenceSlot = options.sequenceSlot || null;
  const sequenceId = String(sequenceSlot?.id || "");
  const mode = styleSimilarMode(settings);
  const active =
    value === "scene" ||
    SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(sequenceId) ||
    (settings?.styleCloneMode && mode === "scene") ||
    Boolean(options.directSwap);
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!active || !isSmallLampProfile(safeProfile, settings)) return "";
  const shot = options.shot || {};
  const target = shot.referenceTarget || shot.referenceAnalysis || options.referenceTarget;
  const hasTarget = target && typeof target === "object";
  const isRecessedDownlight = safeProfile.mountFamily === "recessed-downlight";
  const recessedScaleRule = isRecessedDownlight
    ? "嵌入式小灯额外比例锁：在当前小灯空间比例基础上再缩小 25%，最终只作为天花上的小面环、深杯/灯杯和小发光口；不得为了清晰度放大成大圆盘、主灯、明装圆柱或贴顶近景主体。"
    : "";
  const familyRules = {
    generic: "小灯保持上传图里的紧凑灯体和对应安装结构，不主动生成可调灯头、支架、轨道或嵌入式开孔。",
    "recessed-downlight": "嵌入式筒灯/射灯场景只表现吊顶开孔内的小面环、深杯/灯杯和小发光口；安装后灯体藏在吊顶内，即使参考图是明装小灯也只学习空间氛围，不复制外露黑色筒身、贴顶灯座、弹簧卡扣、外置驱动、电线、明装圆柱或悬浮灯体。",
    "surface-downlight": "明装筒灯只表现贴顶短小灯体、完整外露筒身、顶部接触天花和底部发光口；天花不开孔，不齐平嵌入，不只露面环。",
    spotlight: "射灯保持小灯头、小灯杯和短支架比例。",
    "track-spotlight": "轨道射灯保持细窄导轨上的小模块比例。",
    track: "轨道灯保持导轨上的小体量灯体模块。"
  };
  const referenceRule = hasTarget
    ? (isRecessedDownlight
        ? "有参考灯位时，以原灯位在整张图里的视觉占比为基准，嵌入式小灯最终约为原灯位视觉占比的 45%-50%，不得超过原灯位；安装中心、接触点、安装面和透视对齐参考灯位。"
        : "有参考灯位时，以原灯位在整张图里的视觉占比为基准，在原先缩小 20% 的基础上再收小 15%，新灯最终约为原灯位视觉占比的 60%-65%，不得超过原灯位；安装中心、接触点、安装面和透视对齐参考灯位。")
    : settings?.styleCloneMode || isStyleSimilarSettings(settings)
      ? (isRecessedDownlight
          ? "有参考场景但无可靠灯位框时，参考原图中灯具或主要灯位相对整张图的视觉占比，嵌入式小灯按最终更小的面环灯位生成；参考图若是明装灯，只参考位置、空间和光感，不复制外露灯体。"
          : "有参考场景但无可靠灯位框时，参考原图中灯具或主要灯位相对整张图的视觉占比，在已缩小 20% 的基础上再小 15%，保持真实空间比例，宁可偏小。")
      : (isRecessedDownlight
          ? "没有参考场景时，按正常住宅家装空间里的真实嵌入式筒灯/射灯尺度再收小 25% 生成，镜头更远，只露面环、深杯/灯杯和小发光口。"
          : "没有参考场景时，按正常住宅家装空间里的真实小灯尺度再收小 15% 生成，镜头更远，保留空间比例。");
  return [
    "小灯场景比例锁：灯具只是正常空间里的照明点，比例服从整张画面的空间尺度，以真实安装尺度融入空间。",
    "场景范围锁：只生成住宅家装空间，语境必须是客厅、餐厅、卧室、书房、玄关、走廊或柜体局部。",
    referenceRule,
    recessedScaleRule,
    "最近灯位也不能放大成前景商品主体；空间类图优先保留地面、墙面、柜体、门窗和正常层高。",
    familyRules[safeProfile.mountFamily] || familyRules.generic,
    smallLampMountFamilyStrictLock(safeProfile),
    "当清晰度和比例冲突时，优先缩小灯具并保留完整空间；细节清晰度交给材质、防眩、实拍和尺寸页面。"
  ].filter(Boolean).join("\n");
}

function smallLampDetailSceneScaleGuard(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, {})) return "";
  const common = "小灯场景比例锁：灯具只作为家装空间里的照明点，比例服从整张画面的空间尺度；单个清晰灯位直径约为画面宽度 4% 以内，普通住宅空间只保留 1-2 个小灯位；画面先成立完整家装空间，再出现小灯。";
  const familyRules = {
    "recessed-downlight": "嵌入式小灯只露出天花上的小面环、深杯/灯杯和小发光口，在当前小灯场景比例基础上再缩小 25%，不得为了清晰度放大成大圆盘、两个大圆面、明装圆柱、外露筒身或主灯；宁可只看见小小灯位和真实落光。",
    "surface-downlight": "明装筒灯只表现贴顶短小灯体、完整外露筒身、顶部接触天花和底部发光口；天花不开孔，不齐平嵌入，不只露面环。",
    spotlight: "射灯保持小灯头、小灯杯和短支架比例，光斑服务空间。",
    "track-spotlight": "轨道射灯保持细窄导轨上的小模块比例，灯体必须连接导轨。",
    track: "轨道灯保持导轨上的小体量灯体模块。"
  };
  return [
    common,
    residentialEyeLevelFramingGuard({ id: "scene-scale", title: "家装场景比例" }),
    familyRules[safeProfile.mountFamily] || "小灯保持上传图里的紧凑灯体和对应安装结构，不主动生成产品图没有的结构。",
    "当清晰度和比例冲突时，优先缩小灯具并保留完整空间；细节清晰度交给材质、防眩、实拍和尺寸页面。"
  ].join("\n");
}

function smallLampSingleTargetLockPrompt(category = "", profile = {}, settings = {}, options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampGeneration(safeProfile, settings)) return "";
  const value = String(category || "").toLowerCase();
  const mode = styleSimilarMode(settings);
  const active =
    value === "scene" ||
    (settings?.styleCloneMode && mode === "scene") ||
    Boolean(options.directSwap);
  if (!active) return "";
  const shot = options.shot || {};
    const target = shot.referenceTarget || shot.referenceAnalysis;
    const hasTarget = target && typeof target === "object";
  const directLine = options.directSwap
    ? hasTarget
      ? "小灯直接替换单灯位：只替换识别出的一个原灯位；参考图里的其它灯具/灯位保持背景属性或弱化，不得变成清晰商品主体。"
      : "小灯直接替换单灯位：没有可靠 referenceTarget 时，只在最可能的一个原灯位保守生成一只小灯，不扩散到整排灯位，不替换多个天花孔、多个轨道点或多个背景灯。"
    : "";
  const similarLine = isStyleSimilarSettings(settings)
    ? "小灯相似/换场景合理布灯锁：只使用家装场景；普通客厅、餐厅、卧室或书房使用 1-2 个清晰灯位；走廊、玄关、过道或长柜体可用 2-3 个灯位，但必须沿真实动线或天花结构有节奏排列。"
    : "";
  return [
    options.directSwap
      ? "小灯单目标灯位锁：上传小灯商品主体只允许替换一个目标灯位/一只上传产品；只有产品图本身是多头或多模块时，才按原图数量作为一套产品保留。"
      : "小灯场景数量美感锁：不要绝对单灯，也不要满天花复制；灯具数量必须符合空间功能和画面秩序，主灯位可辨认即可，其它灯位更小、更弱或更远，不得为了清晰度靠近天花拍摄。",
    options.directSwap
      ? "禁止把上传小灯复制到多个天花孔、多个轨道点、多个背景灯位或整排灯阵；禁止出现多个清晰相同灯杯、多个明显商品主体。"
      : "禁止满天花灯阵、随机散点、整排过密、多个同等清晰主体或远近大小混乱；灯位数量和排列必须服务新场景空间，不复制参考图原灯位数量和排列。",
    residentialEyeLevelFramingGuard({ id: "single-target-scene", title: "单目标家装场景" }),
    "非目标/非主灯位不得变成放大的商品主体，必须弱化、虚化或融合进环境光影。",
    directLine,
    similarLine
  ].filter(Boolean).join("\n");
}

function smallLampSceneLightingPrompt(category = "", profile = {}, settings = {}, options = {}) {
  const value = String(category || "").toLowerCase();
  const mode = styleSimilarMode(settings);
  const active =
    value === "scene" ||
    (settings?.styleCloneMode && mode === "scene") ||
    Boolean(options.directSwap);
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!active || !isSmallLampProfile(safeProfile, settings)) return "";
  const familyRules = {
    generic: "小灯光效：光从上传图可见的真实发光口产生，安装结构按产品图保持；不要主动生成射灯角度、转轴支架、轨道或嵌入式开孔。",
    "recessed-downlight": "嵌入筒灯光效：光从小面环内的灯杯/发光口向下发出，面环本身不变成发光大盘，天花周围只保留轻微真实反光和接触阴影。",
    "surface-downlight": "明装筒灯光效：光从底部小发光口发出，灯体只是贴顶短小圆柱/方盒；不要让整个圆柱发亮成大吸顶灯，也不要产生超过小灯体量的大面积光晕。",
    spotlight: "射灯光效：光束方向跟随灯头角度，光斑是局部重点照明；不要出现没有来源的大范围洗墙光或主灯级泛光。",
    "track-spotlight": "轨道射灯光效：每个小灯头按自身角度出光，导轨不发光；不要扩成整排灯阵、线性灯带或无来源大光面。",
    track: "轨道灯光效：小模块沿导轨出光，导轨只是安装结构；不要把导轨画成发光线条或大面积灯带。"
  };
  return [
    "小灯场景光效锁定：光线必须从真实发光口、灯杯或灯头方向产生，光斑、光晕、墙面亮区和阴影都要匹配小灯体量。",
    "小灯只能产生可信的局部照明、柔和落光和轻微环境反射；不能产生大主灯级别的巨大亮区、强烈满屋泛光或无来源光斑。",
    familyRules[safeProfile.mountFamily] || familyRules.generic,
    "允许自然环境光辅助空间质感，但产品光效不能反向放大灯具体量，也不能用巨大光晕把小灯变成画面主视觉。"
  ].join("\n");
}

function styleCloneMountPrompt(profile = {}, settings = {}) {
  const semantic = mountingSemantics(profile, settings);
  const smallLampLine = isSmallLampProfile(profile, settings)
    ? "小灯体量锁定：保持参考图原灯位的小型灯具体量和安装平面，不为了清晰度放大成其它通道体量。"
    : "";
  return [
    lampChannelPrompt(profile, settings),
    lampChannelIsolationPrompt(profile, settings),
    `安装语义：${semantic.installRule}`,
    `参考槽位：优先替换${semantic.referenceMountSlot}，保留参考图构图、镜头、光影和空间关系。`,
    `必须保留结构：${semantic.requiredStructures}。`,
    `禁止结构：${semantic.forbiddenStructures}。`,
    smallLampLine
  ].filter(Boolean).join("\n");
}

function styleSimilarSceneMountPrompt(profile = {}, settings = {}) {
  const semantic = mountingSemantics(profile, settings);
  return [
    lampChannelPrompt(profile, settings),
    lampChannelIsolationPrompt(profile, settings),
    `安装语义：${semantic.installRule}`,
    "相似场景安装方式：在新设计的空间里选择合理安装面和新灯位，不复刻参考图原灯位、家具布局或镜头构图。",
    `必须保留结构：${semantic.requiredStructures}。`,
    `禁止结构：${semantic.forbiddenStructures}。`
  ].filter(Boolean).join("\n");
}

function styleSimilarSceneVariationPrompt(settings = {}, profile = {}) {
  const category = styleSimilarCategoryFromMode(settings.similarMode);
  if (!isStyleSimilarSettings(settings) || category !== "scene") return "";
  const smallLampLine = isSmallLampProfile(profile, settings)
    ? "小灯相似场景：只生成家装空间；普通客厅、餐厅、卧室或书房 1-2 个可辨认灯位，走廊/玄关/过道可 2-3 个；必须有节奏和层级，保持正常层高和完整空间尺度，不放在参考图同一中央大前景位置，不复制参考图灯位数量和排列。"
    : "";
  return [
    "相似场景变化锁：参考图只提取空间类型、色调、材质氛围、光影方向和软装密度，不作为底图重画。",
    "必须重新设计房间布局、家具组合、墙面装饰、植物位置、天花灯位和镜头构图，生成同类但不同景。",
    "禁止复刻参考图的同款柜体、同款植物位置、同款挂画位置、同款墙面分割和同款灯位排列。",
    smallLampLine
  ].filter(Boolean).join("\n");
}

function smallLampStyleSimilarScenePrompt(settings = {}, shot = {}, profile = {}) {
  if (!isStyleSimilarSettings(settings) || styleSimilarCategoryFromMode(settings.similarMode) !== "scene" || !isSmallLampProfile(profile, settings)) return "";
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    "小灯相似场景独立通道：当前任务只按小灯场景逻辑执行，不叠加大灯、主视觉商品展示、直接替换参考图或通用相似主体放大规则。",
    "参考图只用于提取空间类型、色调、材质氛围、光影方向和软装密度；必须重新设计房间布局、家具组合、墙面装饰、植物位置、天花灯位和镜头构图。",
    SINGLE_SCENE_IMAGE_LOCK,
    smallLampSpatialRealismGuard("scene", null),
    CHINA_MARKET_TEXT_LOCK,
    NO_VISIBLE_TEXT_LOCK,
    `产品身份：使用上传产品 ${safeProfile.productName} 的真实小灯外形、材质、颜色、发光口和可见安装结构。`,
    sceneSubjectCountLockPrompt(safeProfile, settings, "scene"),
    smallLampSingleTargetLockPrompt("scene", safeProfile, settings, { shot }),
    smallLampPhysicalScalePrompt("scene", safeProfile, settings, { shot }),
    smallLampSceneLightingPrompt("scene", safeProfile, settings),
    styleSimilarSceneMountPrompt(safeProfile, settings),
    "禁止复刻参考图的同款柜体、同款植物位置、同款挂画位置、同款墙面分割和同款灯位排列。",
    "禁止使用 referenceTarget/bbox/原灯位替换逻辑；小灯必须作为新场景里的真实小灯位，不放在参考图同一中央大前景位置。",
    "数量规则：普通客厅、餐厅、卧室或书房使用 1-2 个可辨认灯位；走廊、玄关、过道或长柜体可用 2-3 个灯位，但必须有节奏、有层级、有真实安装逻辑。",
    "禁止满天花灯阵、随机散点、整排过密、多个同等清晰主体或多个放大的商品主体；背景灯位仍必须弱化，不能变成清晰商品主体。"
  ].filter(Boolean).join("\n");
}

function smallLampHomeScenePrompt(category = "", profile = {}, settings = {}) {
  if (!isProductWorkspaceSettings(settings) || String(category || "").toLowerCase() !== "scene" || !isSmallLampGeneration(profile, settings)) return "";
  const safeProfile = sanitizeRecognitionProfile(profile);
  const recessedLine = safeProfile.mountFamily === "recessed-downlight"
    ? "嵌入式小灯在场景里只露出更小的面环和发光口，比常规小灯规划再小四分之一，不能抢占画面。"
    : "";
  return [
    "小灯家装场景方向：生成家装/住宅空间的中远景或正常室内视角，画面能看到完整空间关系。",
    "空间可选现代客厅、卧室、餐厅、玄关柜、衣帽间、厨房岛台、书房或阳台休闲区。",
    "画面包含家具、软装、柜体、墙面装饰、地面材质、生活物件等家装元素中的至少两类。",
    `将${safeProfile.productName}按真实小灯比例安装在天花、轨道或墙面的自然灯位，作为空间照明细节，配合柔和自然光线。`,
    recessedLine
  ].filter(Boolean).join("\n");
}

function smallLampVisiblePrompt(shot = {}, settings = {}, profile = {}, extra = "", fallbackPrompt = "") {
  if (!isSmallLampGeneration(profile, settings)) return "";
  const safeProfile = sanitizeRecognitionProfile(profile);
  const category = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask(shot);
  const productName = safeProfile.productName || "小灯";
  const family = smallLampWorkspaceFamilySpec(safeProfile);
  const targetSpace = cleanPromptPart(safeProfile.targetSpace) || "真实室内空间";
  const similarScene = isStyleSimilarSettings(settings) && category === "scene";
  const directSwap = isDirectStyleCloneSettings(settings);
  const recessedScenePhrase = safeProfile.mountFamily === "recessed-downlight"
    ? "灯位更小更克制，只露出嵌入式面环和小发光口，"
    : "";
  const map = {
    main: `干净背景展示${productName}的${family.parts}和真实小灯体量，结构清楚、材质自然。`,
    selling: `围绕${productName}的${family.functionFocus}生成简洁卖点图，使用短中文说明真实优势。`,
    function: `生成${productName}的小灯功能图，用简体中文卡片展示${family.install}、${family.parts}和光效特点。`,
    scene: similarScene
      ? `参考空间氛围重新设计一个不同${targetSpace}场景，正常层高、正常室内摄影视角，能看到地面、墙面和家具/柜体/门窗尺度参照，${productName}${recessedScenePhrase}按参考整图灯位比例略小一些合理布灯，光线自然。`
      : directSwap
        ? `保留参考图正常空间和镜头，只把一个原灯位替换为${productName}，其它灯位不替换，新灯${recessedScenePhrase}比原灯位略小且自然安装。`
        : `现代家装客厅、卧室、餐厅或玄关柜等正常层高中远景，${productName}${recessedScenePhrase}按真实小灯比例安装在自然灯位，画面有地面、墙面、家具软装和柔和光线。`,
    detail: `近景展示${productName}的${family.parts}或安装细节，结构真实清楚。`,
    real: `生成${productName}真实安装或到货实拍感图片，保持小灯体量、接触点和自然光影。`
  };
  const base = map[category] || String(fallbackPrompt || shot.prompt || "").trim();
  return [base, extra].filter(Boolean).join("\n");
}

function smallLampPlanPromptGuidance(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const knownSmall = isSmallLampGeneration(safeProfile, settings);
  return [
    knownSmall
      ? "小灯规划分支：后续 prompt 只按小灯语义写，不借用大灯、线性灯、壁灯或通用主视觉灯具表达。"
      : "如识别为小灯，后续 prompt 必须只按小灯语义写，不借用大灯、线性灯、壁灯或通用主视觉灯具表达。",
    "小灯规划必须先读取 profile.visualStrategy，再决定画面风格、背景、光影、色彩、装饰元素和文字气质；不要把所有小灯固定成同一种高端工业照明风。",
    "参考详情页只提供内容链路和画面质量样例，不得固定套用示例里的品牌、芯片、银色拉丝、黑底、包豪斯、RG0、UGR、显色指数、功率或电压；这些内容必须来自当前产品识别或用户补充。",
    "材质、颜色、安装方式和文案必须跟随当前产品：黑色喷涂、白色面环、木质、亚克力、轨道连接、转轴可调、嵌入开孔或明装贴顶都要分别规划，不得互相借用。",
    "用户或识别结果写嵌入式筒灯、嵌入式射灯、嵌入式聚光灯时，统一按 recessed-downlight 规划：只露面环、深杯/灯杯、小发光口和聚光光斑，不写明装贴顶圆柱、外露筒身、外露转轴或轨道结构。",
    "小灯场景 prompt 只写短句：真实空间、正常层高、中远景、小灯比例、正确安装面、自然光线；不要写百分比、bbox、referenceTarget、禁区、尺寸锁或后端规则。",
    "小灯相似场景要写同类但不同景，明确变化家具布局、墙面主视觉、镜头角度或天花灯位之一；不要照抄参考图构图。",
    "小灯直接替换要写只替换原灯位，保持小体量自然安装；不要新增多个清晰商品主体。"
  ].join("\n");
}

function smallLampLeanIdentityLine(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const parts = [
    compactPromptPart(safeProfile.lampSubtype || safeProfile.lampType || "小灯", 18),
    compactPromptPart(smallLampMaterialLabel(safeProfile) || safeProfile.material || safeProfile.colorPalette, 24),
    compactPromptPart(safeProfile.visibleParts || safeProfile.structureKeywords || safeProfile.requiredStructures, 46)
  ].filter(Boolean);
  return parts.join("，") || "上传图小灯真实外形";
}

function smallLampIsDetailStrategyShot(shot = {}) {
  return String(shot?.promptRoute?.source || "") === "small-lamp-detail-strategy";
}

function smallLampLeanMountLine(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    "recessed-downlight": "嵌入式：只露小面环/深杯/灯杯/小发光口，不露明装筒身",
    "surface-downlight": "明装式：短小灯体外露贴顶，天花不开孔，不齐平嵌入",
    spotlight: "射灯：保留灯头、灯杯和真实可调/安装关系，不扩成主灯",
    "track-spotlight": "轨道射灯：灯体必须连在导轨上，不悬空不扩成灯阵",
    track: "轨道灯：保持导轨连接和小模块比例"
  };
  return map[safeProfile.mountFamily] || "安装结构只按上传图可见状态生成，不新增线材、驱动、支架或背部零件";
}

function smallLampLeanSceneLine(profile = {}, sequenceSlot = null) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const recessed = safeProfile.mountFamily === "recessed-downlight" ? "嵌入式只露小面环/灯杯/发光口，无明装筒身。" : "";
  const slotId = String(sequenceSlot?.id || "");
  const isHero = slotId === "hero-atmosphere";
  const countLock = slotId === "hero-atmosphere"
    ? "首屏仅1个清晰灯位，最多1弱远；禁灯阵。"
    : "1-2个灯位；禁灯阵/多孔。";
  const scaleLine = isHero
    ? "首屏灯位≤画宽2%，只作天花小点，不做放大产品主体。"
    : "灯位≤画宽3%。";
  return [
    `场景：完整住宅；平视中远景；机位：入口/走廊端头；天花≤18%；${scaleLine}参照：地面/家具/墙/门窗。`,
    countLock,
    recessed
  ].filter(Boolean).join("");
}

function smallLampLeanRoleLine(category = "", sequenceSlot = null) {
  const id = String(sequenceSlot?.id || "");
  if (category === "scene" || SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(id)) return "角色：家装场景，只表现住宅光感和真实比例。";
  if (category === "function") return "角色：功能图，只讲本页一个功能点，允许少量简体中文短标签，不写未确认参数。";
  if (category === "detail") return "角色：细节图，只拍一个材质/发光口/光斑/安装接触细节，不做多主体拼贴。";
  if (category === "real") return "角色：实拍质感图，单个产品或真实安装状态，不做海报文案。";
  if (category === "main") return "角色：产品气质图，单个完整主体，重材质和光影，不做功能卡片。";
  return "角色：单页单主题，不复用其它页构图。";
}

function smallLampLeanHiddenPrompt(prompt = "", { shot = {}, category = "", profile = {}, sequenceSlot = null, noTextRequested = false, localOverlay = false, isScene = false } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const frontLoadedDetailRules = smallLampIsDetailStrategyShot(shot);
  const allowHeroText = String(sequenceSlot?.id || "") === "hero-atmosphere";
  const hasDirectTextPrompt = /文字[：:]\s*模型直接排版|模型直接生成规划好的简体中文/.test(String(prompt || ""));
  const hasLocalOverlayPrompt = /底图不要生成任何可见文字|后置简体中文排版/.test(String(prompt || ""));
  const textPolicy = hasDirectTextPrompt
    ? ""
    : localOverlay && hasLocalOverlayPrompt
    ? ""
    : localOverlay
    ? "底图无可见文字；文案由应用后置叠加。"
    : noTextRequested || (!productPromptAllowsText(category) && !allowHeroText)
    ? "无可见文字、品牌、水印、价格、随机符号。"
    : "可见文字只用计划里的简体中文短标签，不加英文、乱码或未确认数字。";
  return [
    String(prompt || "").trim(),
    `产品锁：${smallLampLeanIdentityLine(safeProfile)}；不换款。`,
    `安装锁：${smallLampLeanMountLine(safeProfile)}。`,
    smallLampLeanRoleLine(category, sequenceSlot),
    isScene && !frontLoadedDetailRules ? smallLampLeanSceneLine(safeProfile, sequenceSlot) : "",
    ["function", "selling", "detail"].includes(String(category || "").toLowerCase()) ? "参数门禁：未确认品牌、芯片、功率、电压、光学认证和具体数值一律不写。" : "",
    textPolicy
  ].filter(Boolean).join("\n");
}

function smallLampHiddenPrompt(prompt = "", { shot = {}, category = "", templateReferenceCount = 0, settings = {}, profile = {} } = {}) {
  if (!isSmallLampGeneration(profile, settings) || isCollageTemplateSettings(settings)) return "";
  const safeProfile = sanitizeRecognitionProfile(profile);
  const resolvedCategory = category || (isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask({ ...shot, prompt }));
  const isScene = resolvedCategory === "scene";
  const sequenceId = String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || "");
  const sequenceSlot = smallLampDetailSequenceCatalog().find((item) => item.id === sequenceId)
    || SMALL_LAMP_DETAIL_SEQUENCE.find((item) => item.id === sequenceId)
    || null;
  const isSpatialDetailSlot = Boolean(sequenceSlot && SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(sequenceSlot.id));
  const textRenderMode = textRenderModeForShot(shot, resolvedCategory, settings);
  const localOverlay = textRenderMode === "local-overlay" && Boolean(shot?.textOverlay) && isProductWorkspaceSettings(settings);
  const noTextRequested = textRenderMode !== "model-direct" && (
    settingsRequestNoVisibleText(settings)
    || (Boolean(shot?.textOverlay) && !isProductWorkspaceSettings(settings))
    || (sequenceId === "hero-atmosphere"
      ? false
      : visiblePromptRequestsNoText([prompt, shot.prompt].filter(Boolean).join(" "), category || shot.category))
  );
  const directSwap = Boolean(settings?.styleCloneMode && templateReferenceCount > 0 && isDirectStyleCloneSettings(settings));
  const similarScene = isStyleSimilarSettings(settings) && resolvedCategory === "scene";
  const similarNonScene = isStyleSimilarSettings(settings) && !similarScene;
  if (isProductWorkspaceSettings(settings) && String(settings.imageScope || "detail") === "detail" && !directSwap && !similarScene && !similarNonScene) {
    return smallLampLeanHiddenPrompt(prompt, {
      shot,
      category: resolvedCategory,
      profile: safeProfile,
      sequenceSlot,
      noTextRequested,
      localOverlay,
      isScene: isScene || isSpatialDetailSlot
    });
  }
  const categoryGuard = categoryBoundaryPrompt(resolvedCategory);
  const sceneRules = isScene || directSwap || isSpatialDetailSlot
    ? [
        sceneSubjectCountLockPrompt(safeProfile, settings, "scene", { directSwap }),
        smallLampSingleTargetLockPrompt("scene", safeProfile, settings, { directSwap, shot }),
        smallLampSpatialRealismGuard(isScene ? "scene" : resolvedCategory, sequenceSlot),
        smallLampPhysicalScalePrompt(isScene ? "scene" : resolvedCategory, safeProfile, settings, { directSwap, shot, sequenceSlot }),
        sequenceSlot ? smallLampDetailSceneOrderRule(sequenceSlot) : "",
        smallLampSceneLightingPrompt("scene", safeProfile, settings, { directSwap })
      ]
    : [];
  const directRules = directSwap
    ? [
        "小灯直接替换独立通道：只替换参考图原灯位，不新增第二个灯具，不改变参考图背景空间、镜头、光影和裁切。",
        "如果参考图有多个筒灯/射灯/轨道点，只能选择 referenceTarget 对应的一个目标灯位替换；其它原灯保持背景属性或弱化，不得同步替换成上传小灯。",
        smallLampStyleClonePrompt(shot, safeProfile, settings),
        referenceTargetPrompt(shot.referenceTarget || shot.referenceAnalysis, safeProfile, settings)
      ]
    : [];
  const similarSceneRules = similarScene ? [smallLampStyleSimilarScenePrompt(settings, shot, safeProfile)] : [];
  const similarNonSceneRules = similarNonScene
    ? [
        `小灯${styleSimilarModeLabel(settings.similarMode)}独立通道：参考图只借版式、角度、质感或表达节奏，产品身份和结构只来自上传小灯。`,
        "不得借用大灯、线性灯、壁灯或通用灯具结构；不得把小灯放大成主视觉大灯。"
      ]
    : [];
  const productRules = [
    "小灯独立通道：只按上传小灯的真实结构、体量、安装面和发光口生成，不借用大灯、线性灯、壁灯或其它品类结构。",
    lampChannelPrompt(safeProfile, settings),
    lampChannelIsolationPrompt(safeProfile, settings),
    smallLampFamilyPrompt(safeProfile),
    smallLampMountFamilyStrictLock(safeProfile),
    smallLampProductWorkspacePrompt(resolvedCategory, safeProfile, settings),
    smallLampSubjectMultiplicityLock(resolvedCategory),
    smallLampDetailRoutePrompt(shot),
    sequenceSlot ? smallLampDetailLayoutGuard(resolvedCategory, sequenceSlot, safeProfile) : "",
    ["function", "selling", "detail"].includes(resolvedCategory) ? smallLampSpecEvidenceLine(safeProfile) : "",
    smallLampHomeScenePrompt(resolvedCategory, safeProfile, settings),
    sequenceSlot ? smallLampDetailMeaningfulVisualGuard(sequenceSlot, safeProfile) : "",
    smallLampVisualStrategyPrompt(safeProfile, { visible: false }),
    `产品身份：使用上传产品 ${safeProfile.productName} 的真实小灯外形、材质、颜色、发光口和可见安装结构。`,
    `硬性保真：保留 ${safeProfile.visibleParts || safeProfile.requiredStructures || safeProfile.structureKeywords}；${safeProfile.hardConstraints || safeProfile.visualStrategy?.hardConstraints || "上传图真实结构和材质不可改变"}；排除 ${safeProfile.forbiddenStructures}。`
  ];
  const hidden = joinPromptBlocksUnique([
    categoryGuard,
    noTextRequested ? NO_VISIBLE_TEXT_LOCK : "",
    shotVariationSeedPrompt(resolvedCategory, shotVariationIndex(shot, 0)),
    ...productRules,
    ...sceneRules,
    ...directRules,
    ...similarSceneRules,
    ...similarNonSceneRules
  ]);
  return joinPromptBlocksUnique([String(prompt || "").trim(), hidden]);
}

function referenceTargetPrompt(referenceTarget = {}, profile = {}, settings = {}) {
  if (!referenceTarget || typeof referenceTarget !== "object" || !isSmallLampProfile(profile, settings)) return "";
  const target = normalizeReferenceMountTarget(referenceTarget, profile, Number(referenceTarget.referenceIndex || 0));
  const bbox = target.bbox;
  const anchor = target.anchor;
  const confidenceLine = target.confidence >= 0.65
    ? "灯位置信度足够：必须按该位置替换。"
    : "灯位置信度偏低：仍按该位置保守替换，保持参考图构图；如果画面不自然，宁可保持小灯体量和安装面正确，不要强行放大或新增灯。";
  return [
    "小灯参考灯位识别结果：",
    `mountPlane=${target.mountPlane}; slotKind=${target.slotKind}; perspective=${target.perspective}; scaleHint=${target.scaleHint}; confidence=${target.confidence.toFixed(2)}。`,
    `bbox=左上(${bbox.x.toFixed(3)},${bbox.y.toFixed(3)}) 尺寸(${bbox.w.toFixed(3)},${bbox.h.toFixed(3)})；anchor=(${anchor.x.toFixed(3)},${anchor.y.toFixed(3)})。`,
    "生成时只替换 bbox 区域内的原灯位；新灯中心和安装接触点对齐 anchor；安装面和透视方向跟参考灯位一致，可见尺寸按参考灯位整图占比再收小约 20%。",
    confidenceLine,
    target.warning ? `灯位提示：${target.warning}` : ""
  ].filter(Boolean).join("\n");
}

function sanitizeRecognitionProfile(profile = {}) {
  const semantic = mountingSemantics(profile);
  const lampChannel = lampChannelFromSemantic(semantic);
  const functionText = String(profile.functionText || profile.function || "灯具电商产品图").trim();
  const sellingPoint = String(profile.sellingPoint || profile.sellingPoints || "清晰展示灯具外形、材质、发光面和安装结构").trim();
  const installSurface = normalizeInstallSurface(profile.installSurface || profile.mountPlane || "", semantic);
  const visibleParts = normalizeVisibleParts(profile.visibleParts, semantic);
  const rawLampType = String(profile.lampType || profile.type || "").trim();
  const rawLampSubtype = String(profile.lampSubtype || profile.subtype || "").trim();
  const lampType = isUnusableRecognitionLabel(rawLampType) ? fallbackLampTypeLabel(semantic) : rawLampType;
  const lampSubtypeBase = isUnusableRecognitionLabel(rawLampSubtype) ? fallbackLampSubtypeLabel(semantic) : rawLampSubtype;
  const preliminaryVisualStrategy = normalizeVisualStrategy(profile, semantic, lampChannel);
  const normalizedHeroCopy = normalizeRecognitionHeroCopy({
    ...profile,
    lampType,
    lampSubtype: lampSubtypeBase,
    visualStrategy: preliminaryVisualStrategy,
    rawVisualStrategy: profile.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {}
  }, semantic);
  const visualStrategy = normalizeVisualStrategy({
    ...profile,
    lampType,
    lampSubtype: normalizedHeroCopy.lampSubtype || lampSubtypeBase,
    style: normalizedHeroCopy.style || normalizeRecognitionStyle(profile.style) || "现代",
    visualStrategy: {
      ...preliminaryVisualStrategy,
      productStyle: normalizedHeroCopy.productStyle || preliminaryVisualStrategy.productStyle,
      moodKeywords: normalizedHeroCopy.moodKeywords || preliminaryVisualStrategy.moodKeywords
    }
  }, semantic, lampChannel);
  return {
    productName: String(profile.productName || profile.name || "灯具产品").trim(),
    lampType,
    lampSubtype: normalizedHeroCopy.lampSubtype || lampSubtypeBase,
    lampCategory: String(profile.lampCategory || "").trim(),
    lampCategoryLabel: String(profile.lampCategoryLabel || "").trim(),
    lampCategoryHint: String(profile.lampCategoryHint || "").trim(),
    style: normalizedHeroCopy.style || normalizeRecognitionStyle(profile.style) || "现代",
    material: String(profile.material || "以上传图片为准").trim(),
    colorPalette: stripProductImageBackgroundColorText(profile.colorPalette || profile.color, "以上传图片中产品本体颜色为准"),
    functionText,
    function: functionText,
    targetSpace: String(profile.targetSpace || "电商商品图/详情页").trim(),
    installationPosition: String(profile.installationPosition || "以上传产品图可见结构为准").trim(),
    installationMethod: String(profile.installationMethod || "保留原始可见安装结构").trim(),
    installSurface,
    visibleParts,
    lightUse: String(profile.lightUse || "装饰与功能照明").trim(),
    sellingPoint,
    sellingPoints: sellingPoint,
    structureKeywords: String(profile.structureKeywords || semantic.requiredStructures || "灯体、发光面、安装结构").trim(),
    lampChannel,
    mountFamily: semantic.mountFamily,
    scaleClass: semantic.scaleClass,
    requiredStructures: semantic.requiredStructures,
    forbiddenStructures: semantic.forbiddenStructures,
    referenceMountSlot: semantic.referenceMountSlot,
    visualStrategy,
    productComplexStructure: visualStrategy.productComplexStructure,
    hardConstraints: visualStrategy.hardConstraints,
    openingSize: String(profile.openingSize || "").trim(),
    beamAngle: String(profile.beamAngle || "").trim(),
    brandName: String(profile.brandName || profile.brand || "").trim(),
    chipBrand: String(profile.chipBrand || profile.chip || profile.ledChip || "").trim(),
    power: String(profile.power || profile.wattage || "").trim(),
    inputVoltage: String(profile.inputVoltage || profile.voltage || "").trim(),
    colorTemperature: String(profile.colorTemperature || profile.cct || "").trim(),
    cri: String(profile.cri || profile.ra || profile.colorRenderingIndex || "").trim(),
    ugr: String(profile.ugr || "").trim(),
    rgLevel: String(profile.rgLevel || profile.rg || profile.blueLightRisk || "").trim(),
    fpf: String(profile.fpf || profile.flickerPercent || "").trim(),
    flicker: String(profile.flicker || "").trim(),
    adjustable: String(profile.adjustable || profile.tiltable || profile.rotatable || "").trim(),
    antiGlare: String(profile.antiGlare || profile.glareControl || "").trim(),
    deepCup: String(profile.deepCup || profile.cupDepth || "").trim(),
    confidence: Number.isFinite(Number(profile.confidence)) ? Number(profile.confidence) : 0.8,
    requiresLampCategorySelection: Boolean(profile.requiresLampCategorySelection),
    profileAuditWarnings: Array.isArray(profile.profileAuditWarnings) ? profile.profileAuditWarnings.map((item) => String(item || "").trim()).filter(Boolean) : [],
    specBlockedTerms: Array.isArray(profile.specBlockedTerms) ? profile.specBlockedTerms.map((item) => String(item || "").trim()).filter(Boolean) : []
  };
}

function mergeProfileProduct(product = {}, profile = {}) {
  return sanitizeRecognitionProfile({ ...product, ...profile });
}

function inferProductProfile(product = {}, files = []) {
  const names = (files || []).map((file) => file?.originalname || file?.filename || "").filter(Boolean).join(" ");
  return sanitizeRecognitionProfile({
    ...product,
    productName: product.productName || product.name || names || "灯具产品",
    sourceFileCount: Array.isArray(files) ? files.length : 0
  });
}

function profileIsGenericLamp(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return safeProfile.lampChannel === "generic"
    && safeProfile.mountFamily === "generic"
    && /^(灯具|灯具产品)?$/.test(cleanPromptPart(safeProfile.lampSubtype) || "灯具")
    && !/小灯|筒灯|射灯|轨道|嵌入|明装|深杯|防眩/i.test(mountSemanticText(safeProfile));
}

function explicitSmallLampMountFamilyFromText(value = "") {
  const text = String(value || "");
  if (/轨道射灯|track[-\s]?spotlight|track spotlight|磁吸射灯/.test(text)) return "track-spotlight";
  if (/轨道灯|磁吸轨道|导轨|track|magnetic/.test(text)) return "track";
  if (/明装(?:小灯|筒灯|小筒灯|射灯)?|贴顶(?:小灯|筒灯|小筒灯)?|surface[-\s]?(?:mounted|mount|downlight)|ceiling[-\s]?mounted/.test(text)) return "surface-downlight";
  if (/嵌入(?:式)?(?:小灯|筒灯|射灯)?|暗装(?:小灯|筒灯)?|开孔(?:小灯|筒灯)?|recessed[-\s]?downlight/.test(text)) return "recessed-downlight";
  if (/射灯|spotlight|斗胆灯|洗墙射灯/.test(text)) return "spotlight";
  return "";
}

function hasWallStructureContamination(value = "") {
  return /壁灯|wall lamp|wall light|墙面安装|墙装|床头|阅读灯|圆形底座|立柱支架|灯臂|连接臂|外露电线|旋钮|可调角度|灯头可调/i.test(String(value || ""));
}

function smallLampSurfaceDownlightVisibleParts(text = "") {
  return [
    /圆柱|圆筒|cylinder|round/i.test(text) ? "短圆柱灯体" : "短小贴顶灯体",
    "顶部贴顶接触面",
    /黑色|黑杯|黑腔|black/i.test(text) ? "黑色深杯" : "底部灯杯",
    "底部小发光口"
  ].filter(Boolean).join("、");
}

function smallLampHintProfileFromText(profile = {}, hintText = "", options = {}) {
  const text = String(hintText || "");
  const hasSmallLampHint = /小灯|小型|筒灯|射灯|轨道灯|轨道射灯|明装|嵌入|贴顶|深杯|防眩|光束|小孔/i.test(text);
  if (!hasSmallLampHint) return sanitizeRecognitionProfile(profile);
  const surface = /明装|贴顶|吸顶|无需开孔|圆柱|圆筒/i.test(text);
  const recessed = /嵌入|开孔|暗装|面环/i.test(text);
  const track = /轨道|导轨|磁吸/i.test(text);
  const spotlight = /射灯|可调|调角|转轴/i.test(text);
  const forcedMountFamily = options.forceMountFamily || "";
  const mountFamily = forcedMountFamily || (track && spotlight
    ? "track-spotlight"
    : track
      ? "track"
      : surface && !spotlight
        ? "surface-downlight"
        : recessed
          ? "recessed-downlight"
          : spotlight
            ? "spotlight"
            : "surface-downlight");
  const subtypeMap = {
    "surface-downlight": "明装小筒灯",
    "recessed-downlight": "嵌入式筒灯",
    spotlight: "小射灯",
    "track-spotlight": "轨道射灯",
    track: "轨道小灯"
  };
  const installMap = {
    "surface-downlight": "明装贴顶",
    "recessed-downlight": "嵌入安装",
    spotlight: "顶面/墙面射灯安装",
    "track-spotlight": "轨道连接",
    track: "轨道安装"
  };
  const sourceProfileText = [
    profile.productName,
    profile.lampType,
    profile.lampSubtype,
    profile.installationMethod,
    profile.installationPosition,
    profile.visibleParts,
    profile.structureKeywords,
    profile.hardConstraints,
    profile.visualStrategy?.hardConstraints
  ].filter(Boolean).join(" ");
  const hasContamination = hasWallStructureContamination(sourceProfileText);
  const forceCleanSurface = mountFamily === "surface-downlight" && (forcedMountFamily === "surface-downlight" || hasContamination);
  const visible = forceCleanSurface ? smallLampSurfaceDownlightVisibleParts(text) : [
    surface ? "圆柱灯体" : "",
    /深杯|防眩/i.test(text) ? "深杯发光口" : "发光口",
    /黑色|黑杯|黑腔/i.test(text) ? "黑色内杯" : "",
    track ? "轨道连接结构" : "",
    recessed ? "面环和开孔关系" : "",
    spotlight ? "灯头照射方向" : ""
  ].filter(Boolean).join("、");
  const cleanProductName = forceCleanSurface || hasContamination
    ? subtypeMap[mountFamily] || "小灯产品"
    : (profile.productName && profile.productName !== "灯具产品" ? profile.productName : subtypeMap[mountFamily] || "小灯产品");
  const cleanSubtype = forceCleanSurface || hasContamination
    ? subtypeMap[mountFamily] || "小灯"
    : (profile.lampSubtype && profile.lampSubtype !== "灯具" ? profile.lampSubtype : subtypeMap[mountFamily] || "小灯");
  const cleanInstall = forceCleanSurface
    ? "明装式贴顶安装，短小灯体顶部与天花接触"
    : (profile.installationMethod && !/^保留原始/.test(profile.installationMethod) ? profile.installationMethod : installMap[mountFamily]);
  return sanitizeRecognitionProfile({
    ...profile,
    productName: cleanProductName,
    lampType: "小灯",
    lampSubtype: cleanSubtype,
    lampChannel: "small",
    mountFamily,
    installSurface: track ? "track" : "ceiling",
    scaleClass: "small",
    installationPosition: track ? "轨道" : "天花",
    installationMethod: cleanInstall,
    visibleParts: forceCleanSurface || hasContamination || !profile.visibleParts || /^产品图中可见/.test(profile.visibleParts) ? visible : profile.visibleParts,
    structureKeywords: forceCleanSurface || hasContamination || !profile.structureKeywords || /^产品图中可见/.test(profile.structureKeywords) ? visible : profile.structureKeywords,
    sellingPoint: smallLampTrustedSellingText(profile) || (/深杯|防眩/i.test(text) ? "控光防眩、小体量、真实安装比例" : "小体量、真实安装比例、舒适出光"),
    functionText: profile.functionText && profile.functionText !== "灯具电商产品图" ? profile.functionText : "小灯局部照明、空间重点照明和舒适出光",
    targetSpace: profile.targetSpace && profile.targetSpace !== "电商商品图/详情页" ? profile.targetSpace : "住宅、客厅、餐厅、卧室、书房、走廊、玄关",
    lightUse: profile.lightUse && profile.lightUse !== "装饰与功能照明" ? profile.lightUse : "重点照明、局部洗墙和氛围补光",
    antiGlare: profile.antiGlare || (/深杯|防眩/i.test(text) ? "深杯控光结构" : ""),
    deepCup: profile.deepCup || (/深杯/i.test(text) ? "可见深杯发光口" : ""),
    visualStrategy: {
      ...(profile.visualStrategy || {}),
      productStyle: profile.visualStrategy?.productStyle && !/^以上传/.test(profile.visualStrategy.productStyle) ? profile.visualStrategy.productStyle : "小体量精致灯具，视觉克制",
      suitableVisualStyle: profile.visualStrategy?.suitableVisualStyle && !/^以上传/.test(profile.visualStrategy.suitableVisualStyle) ? profile.visualStrategy.suitableVisualStyle : "产品细节、真实安装场景和简洁功能说明",
      lightingEffect: profile.visualStrategy?.lightingEffect && !/^以上传/.test(profile.visualStrategy.lightingEffect) ? profile.visualStrategy.lightingEffect : "小范围重点照明，光斑柔和",
      hardConstraints: forceCleanSurface
        ? `保持${visible}；必须贴顶明装，短小灯体完整外露，不改成其它灯具品类或可调支架灯`
        : (profile.visualStrategy?.hardConstraints && !/^以上传/.test(profile.visualStrategy.hardConstraints) ? profile.visualStrategy.hardConstraints : `保持${visible || "小灯"}，不得生成吊灯、大吸顶灯、轨道以外结构或大型主灯`)
    }
  });
}

function enhanceSmallLampProfileFromHints(profile = {}, layout = "", product = {}, settings = {}) {
  const safeProfile = applyLargeLampProfileFromHints(profile, layout, product, settings);
  if (isLargeLampProfile(safeProfile, settings) && !isSmallLampProfile(safeProfile, settings)) return safeProfile;
  const explicitHintText = [
    layout,
    product?.requirement,
    product?.lampCategory,
    product?.lampCategoryLabel,
    settings?.lampCategory,
    settings?.lampCategoryLabel,
    settings?.lampCategoryHint
  ].filter(Boolean).join(" ");
  const selectedMountFamily = lampCategoryMountFamily(explicitHintText);
  const positiveExplicitHintText = explicitHintText.replace(/(?:禁止|不要|不得|不能|不应|避免|非|不是)[^，。；;\n]*(?:小灯|小型|筒灯|射灯|轨道灯|轨道射灯|明装|嵌入|贴顶|深杯|防眩|灯位)[^，。；;\n]*/gi, "");
  const forcedMountFamily = explicitSmallLampMountFamilyFromText(positiveExplicitHintText);
  if (
    selectedMountFamily &&
    !["recessed-downlight", "surface-downlight", "spotlight", "track-spotlight", "track"].includes(selectedMountFamily)
  ) {
    return safeProfile;
  }
  if (
    !forcedMountFamily &&
    ["wall", "linear", "large"].includes(String(safeProfile.lampChannel || "").toLowerCase()) ||
    (!forcedMountFamily && ["wall", "linear", "ceiling", "chandelier"].includes(safeProfile.mountFamily))
  ) {
    return safeProfile;
  }
  const sourceProfileText = [
    safeProfile.productName,
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.installationMethod,
    safeProfile.installationPosition,
    safeProfile.visibleParts,
    safeProfile.structureKeywords,
    safeProfile.hardConstraints,
    safeProfile.visualStrategy?.hardConstraints
  ].filter(Boolean).join(" ");
  if (
    isSmallLampProfile(safeProfile, {}) &&
    (!forcedMountFamily || (safeProfile.mountFamily === forcedMountFamily && !hasWallStructureContamination(sourceProfileText)))
  ) {
    return safeProfile;
  }
  const hintText = [
    layout,
    product?.requirement,
    product?.lampCategory,
    product?.lampCategoryLabel,
    settings?.lampCategory,
    settings?.lampCategoryLabel,
    settings?.lampCategoryHint,
    product?.lampType,
    product?.lampSubtype,
    product?.sellingPoint,
    product?.structureKeywords,
    product?.installationMethod
  ].filter(Boolean).join(" ");
  if (!forcedMountFamily && !profileIsGenericLamp(safeProfile) && !/小灯|小型|筒灯|射灯|轨道灯|明装|嵌入|贴顶|深杯|防眩/i.test(hintText)) {
    return safeProfile;
  }
  return smallLampHintProfileFromText(safeProfile, hintText, { forceMountFamily: forcedMountFamily });
}

function fallbackSmallLampProfileForLongDetailSuite(profile = {}) {
  return sanitizeRecognitionProfile(profile);
}

function smallLampSpecSourceText(product = {}, layout = "") {
  return [
    product?.requirement,
    product?.openingSize,
    product?.beamAngle,
    product?.colorTemperature,
    product?.cct,
    product?.cri,
    product?.ra,
    product?.power,
    product?.wattage,
    product?.inputVoltage,
    product?.voltage,
    product?.ugr,
    product?.rgLevel,
    product?.rg,
    product?.fpf,
    product?.flicker,
    product?.brandName,
    product?.brand,
    product?.chipBrand,
    product?.chip,
    product?.sellingPoint,
    product?.sellingPoints,
    product?.functionText
  ].filter(Boolean).join(" ");
}

function smallLampProfileAudit(profile = {}, product = {}, layout = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, {})) {
    return { warnings: [], blockedTerms: [] };
  }
  const trustedSource = smallLampSpecSourceText(product, "");
  const profileText = [
    safeProfile.sellingPoint,
    safeProfile.functionText,
    safeProfile.ugr,
    safeProfile.rgLevel,
    safeProfile.fpf,
    safeProfile.cri,
    safeProfile.brandName,
    safeProfile.chipBrand,
    safeProfile.power,
    safeProfile.inputVoltage,
    safeProfile.openingSize
  ].filter(Boolean).join("；");
  const checks = [
    ["brand", /(?:品牌|LOGO|YINGSHU|影束)/i, /(?:品牌|LOGO|YINGSHU|影束)/i],
    ["chip", /(?:芯片|普瑞|科锐|欧司朗|首尔)/i, /(?:芯片|普瑞|科锐|欧司朗|首尔)/i],
    ["power", /(?:\d+(?:\.\d+)?\s*W|功率)/i, /(?:\d+(?:\.\d+)?\s*W|功率)/i],
    ["voltage", /(?:\d+\s*V|AC\s*\d+|电压)/i, /(?:\d+\s*V|AC\s*\d+|电压)/i],
    ["size", /(?:\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)|灯高|高度|直径|开孔|尺寸)/i, /(?:\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)|灯高|高度|直径|开孔|尺寸)/i],
    ["cri", /(?:CRI|Ra|R9|Rf|显色指数|显指|高显色|高显指|\d{2,3}\s*显色)/i, /(?:CRI|Ra|R9|Rf|显色指数|显指)/i],
    ["ugr", /(?:UGR|眩光值|防眩等级)/i, /(?:UGR|眩光值|防眩等级)/i],
    ["rg", /(?:RG0|RG1|蓝光风险|低蓝光认证)/i, /(?:RG0|RG1|蓝光风险|低蓝光认证)/i],
    ["fpf", /(?:FPF|频闪|无频闪|防频闪|≤\s*0\.\d+\s*%)/i, /(?:FPF|频闪|无频闪|防频闪)/i]
  ];
  const blockedTerms = checks
    .filter(([, profilePattern, sourcePattern]) => profilePattern.test(profileText) && !sourcePattern.test(trustedSource))
    .map(([key]) => key);
  const warnings = [];
  if (blockedTerms.length) {
    warnings.push(`blocked-unconfirmed-small-lamp-specs:${blockedTerms.join(",")}`);
  }
  if (layout && /YINGSHU|影束|普瑞|UGR|RG0|FPF|显指|功率|电压|芯片/.test(String(layout))) {
    warnings.push("reference-template-text-not-used-as-spec-evidence");
  }
  return {
    warnings: warnings.filter((item, index, list) => list.indexOf(item) === index),
    blockedTerms: blockedTerms.filter((item, index, list) => list.indexOf(item) === index)
  };
}

function gateSmallLampSpecEvidence(profile = {}, product = {}, layout = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!isSmallLampProfile(safeProfile, {})) return safeProfile;
  const sourceText = smallLampSpecSourceText(product, "");
  const audit = smallLampProfileAudit(safeProfile, product, layout);
  const keep = {
    openingSize: Boolean(firstExplicitProductFact(product, ["openingSize"])) || /开孔|尺寸|mm|cm|毫米|厘米/i.test(sourceText),
    beamAngle: Boolean(firstExplicitProductFact(product, ["beamAngle"])) || /光束角|\d+\s*°/i.test(sourceText),
    colorTemperature: Boolean(firstExplicitProductFact(product, ["colorTemperature", "cct"])) || /色温|\d{3,4}\s*K|暖白|自然光|冷白/i.test(sourceText),
    cri: Boolean(firstExplicitProductFact(product, ["cri", "ra", "colorRenderingIndex"])) || /显色|显指|CRI|Ra|R9|Rf/i.test(sourceText),
    power: Boolean(firstExplicitProductFact(product, ["power", "wattage"])) || /功率|\d+(?:\.\d+)?\s*W/i.test(sourceText),
    inputVoltage: Boolean(firstExplicitProductFact(product, ["inputVoltage", "voltage"])) || /电压|AC\s*\d+|\d+\s*V/i.test(sourceText),
    ugr: Boolean(firstExplicitProductFact(product, ["ugr"])) || /UGR|眩光值|防眩等级/i.test(sourceText),
    rgLevel: Boolean(firstExplicitProductFact(product, ["rgLevel", "rg", "blueLightRisk"])) || /RG0|RG1|蓝光风险|低蓝光认证/i.test(sourceText),
    fpf: Boolean(firstExplicitProductFact(product, ["fpf", "flicker", "flickerPercent"])) || /FPF|频闪|无频闪|防频闪/i.test(sourceText),
    brandName: Boolean(firstExplicitProductFact(product, ["brandName", "brand"])) || /品牌|YINGSHU|影束/i.test(sourceText),
    chipBrand: Boolean(firstExplicitProductFact(product, ["chipBrand", "chip", "ledChip"])) || /芯片|普瑞|科锐|欧司朗/i.test(sourceText)
  };
  const next = { ...safeProfile };
  for (const [key, allowed] of Object.entries(keep)) {
    if (!allowed) next[key] = "";
  }
  if (!keep.fpf) next.flicker = "";
  const safeSelling = smallLampSanitizeEvidenceText(next.sellingPoint || next.sellingPoints || "", next, {
    maxItems: 4,
    maxLength: 8
  });
  next.sellingPoint = safeSelling || (smallLampOpticalTraits(next).hasDeepCup ? "控光防眩、小体量、真实安装比例" : "小体量、真实安装比例、舒适出光");
  next.sellingPoints = next.sellingPoint;
  return sanitizeRecognitionProfile({
    ...next,
    profileAuditWarnings: audit.warnings,
    specBlockedTerms: audit.blockedTerms
  });
}

function selectedLampCategorySpec(settings = {}, product = {}) {
  const label = String(settings.lampCategoryLabel || product.lampCategoryLabel || product.lampType || "灯具").trim();
  return {
    value: String(settings.lampCategory || product.lampCategory || "auto"),
    label,
    type: String(product.lampType || label || "灯具"),
    subtype: String(product.lampSubtype || label || product.lampType || "灯具"),
    hint: String(settings.lampCategoryHint || "")
  };
}

function hasForcedLampCategory(settings = {}, product = {}) {
  const value = String(settings.lampCategory || product.lampCategory || "auto");
  return Boolean(value && value !== "auto");
}

function allowedSubtypesForLampType(type) {
  return type ? [String(type)] : [];
}

function productNameMatchesLampType(productName, type) {
  return Boolean(productName && type && String(productName).includes(String(type)));
}

function lampCategoryMountFamily(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "auto") return "";
  if (/surface[-\s]?downlight|surface[-\s]?mounted|明装|贴顶/.test(text)) return "surface-downlight";
  if (/recessed[-\s]?downlight|嵌入|暗装|开孔/.test(text)) return "recessed-downlight";
  if (/track[-\s]?spotlight|轨道射灯/.test(text)) return "track-spotlight";
  if (/magnetic[-\s]?track|linear[-\s]?track|track|轨道|磁吸/.test(text)) return "track";
  if (/spotlight|射灯|斗胆|洗墙/.test(text)) return "spotlight";
  if (/ceiling|吸顶/.test(text)) return "ceiling";
  if (/panel|grille|classroom|blackboard|fan[-\s]?light|面板|格栅|教室|黑板|风扇灯|吊扇灯/.test(text)) return "ceiling";
  if (/chandelier|pendant|吊灯/.test(text)) return "chandelier";
  if (/wall|壁灯|墙装/.test(text)) return "wall";
  if (/mirror|镜前/.test(text)) return "wall";
  if (/linear|strip|cabinet|线性|灯带|柜灯/.test(text)) return "linear";
  return "";
}

function explicitLargeLampMountFamilyFromText(value = "") {
  const text = String(value || "");
  if (!text) return "";
  if (/吊灯|吊线|吊杆|枝形灯|水晶吊灯|pendant|chandelier/i.test(text)) return "chandelier";
  if (/吸顶灯|顶灯|主灯|大灯|大型贴顶|完整主灯|ceiling[-\s]?light|ceiling[-\s]?lamp/i.test(text)) return "ceiling";
  return "";
}

function applyLargeLampProfileFromHints(profile = {}, layout = "", product = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const selectedMountFamily = lampCategoryMountFamily([
    settings?.lampCategory,
    settings?.lampCategoryLabel,
    settings?.lampCategoryHint,
    product?.lampCategory,
    product?.lampCategoryLabel,
    product?.lampCategoryHint
  ].filter(Boolean).join(" "));
  if (
    selectedMountFamily &&
    !["ceiling", "chandelier"].includes(selectedMountFamily)
  ) {
    return safeProfile;
  }
  if (["wall", "linear", "small"].includes(String(safeProfile.lampChannel || "").toLowerCase()) || ["wall", "linear", "recessed-downlight", "surface-downlight", "spotlight", "track-spotlight", "track"].includes(safeProfile.mountFamily)) {
    return safeProfile;
  }
  const hintText = [
    layout,
    product?.requirement,
    product?.lampCategory,
    product?.lampCategoryLabel,
    product?.lampCategoryHint,
    settings?.lampCategory,
    settings?.lampCategoryLabel,
    settings?.lampCategoryHint,
    safeProfile.productName,
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.installationMethod,
    safeProfile.installationPosition,
    safeProfile.visibleParts,
    safeProfile.structureKeywords,
    safeProfile.hardConstraints,
    safeProfile.visualStrategy?.hardConstraints
  ].filter(Boolean).join(" ");
  const positiveHintText = hintText.replace(/(?:禁止|不要|不得|不能|不应|避免|非|不是)[^，。；;\n]*(?:吊灯|吸顶灯|主灯|大灯|大型贴顶|完整主灯|pendant|chandelier|ceiling[-\s]?light)[^，。；;\n]*/gi, "");
  const mountFamily = explicitLargeLampMountFamilyFromText(positiveHintText);
  if (!mountFamily) return safeProfile;
  if (explicitSmallLampMountFamilyFromText(hintText) && !/吊灯|吸顶灯|主灯|大灯|完整主灯|pendant|chandelier|ceiling[-\s]?light/i.test(hintText)) {
    return safeProfile;
  }
  const type = mountFamily === "chandelier" ? "吊灯" : "吸顶灯";
  return sanitizeRecognitionProfile({
    ...safeProfile,
    productName: safeProfile.productName && safeProfile.productName !== "灯具产品" ? safeProfile.productName : `${type}产品`,
    lampType: type,
    lampSubtype: safeProfile.lampSubtype && !/灯具|小灯|筒灯|射灯|轨道/i.test(safeProfile.lampSubtype) ? safeProfile.lampSubtype : type,
    lampChannel: "large",
    mountFamily,
    installSurface: "ceiling",
    scaleClass: "large",
    installationPosition: safeProfile.installationPosition || "天花",
    installationMethod: safeProfile.installationMethod || (mountFamily === "chandelier" ? "吊线/吊杆悬吊安装" : "吸顶/贴顶安装"),
    visibleParts: safeProfile.visibleParts && !/^产品图中可见|灯具$/.test(safeProfile.visibleParts)
      ? safeProfile.visibleParts
      : (mountFamily === "chandelier" ? "完整灯体、吊线/吊杆、吸顶盘、灯罩或发光面" : "完整主灯灯体、吸顶盘/底盘、灯罩或发光面"),
    structureKeywords: safeProfile.structureKeywords && !/^产品图中可见|灯具$/.test(safeProfile.structureKeywords)
      ? safeProfile.structureKeywords
      : (mountFamily === "chandelier" ? "悬吊主灯结构、完整灯体、天花挂点" : "贴顶主灯结构、完整灯体、天花接触面"),
    visualStrategy: {
      ...(safeProfile.visualStrategy || {}),
      hardConstraints: safeProfile.visualStrategy?.hardConstraints || "保持大灯/主灯真实结构、完整灯体和天花安装关系，不得改成筒灯、射灯、轨道灯、小灯位或壁灯。"
    }
  });
}

function applySelectedLampCategory(product = {}, settings = {}) {
  if (!hasForcedLampCategory(settings, product)) return sanitizeRecognitionProfile(product);
  const spec = selectedLampCategorySpec(settings, product);
  const forcedMountFamily = lampCategoryMountFamily([spec.value, spec.label, spec.hint].filter(Boolean).join(" "));
  const forcedChannel = ["recessed-downlight", "surface-downlight", "spotlight", "track-spotlight", "track"].includes(forcedMountFamily)
    ? "small"
    : forcedMountFamily === "wall"
      ? "wall"
      : ["ceiling", "chandelier"].includes(forcedMountFamily)
        ? "large"
        : forcedMountFamily === "linear"
          ? "linear"
          : "";
  return sanitizeRecognitionProfile({
    ...product,
    lampCategory: spec.value,
    lampCategoryLabel: spec.label,
    lampCategoryHint: spec.hint,
    lampType: spec.label || spec.type,
    lampSubtype: spec.label || spec.subtype || spec.type,
    lampChannel: forcedChannel || product.lampChannel,
    mountFamily: forcedMountFamily || product.mountFamily,
    scaleClass: forcedChannel === "large" ? "large" : forcedChannel === "small" ? "small" : product.scaleClass,
    installSurface: forcedMountFamily === "wall"
      ? "wall"
      : forcedMountFamily === "track" || forcedMountFamily === "track-spotlight"
        ? "track"
        : forcedMountFamily
          ? "ceiling"
          : product.installSurface
  });
}

function categoryLabel(category) {
  const map = { main: "主图", selling: "卖点图", function: "功能图", scene: "场景图", detail: "细节图", real: "实拍图", collage: "拼图" };
  return map[String(category || "")] || "图片";
}

function categoryDescription(category, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    main: `干净展示 ${safeProfile.productName} 的完整灯具主体，适合电商首图。`,
    selling: `围绕 ${safeProfile.productName} 的一个核心卖点做清晰商品表达。`,
    function: `用图文功能版式展示 ${safeProfile.productName} 的真实功能、材质和照明价值。`,
    scene: `把 ${safeProfile.productName} 放入真实室内空间，展示安装后的使用效果。`,
    detail: `近景展示 ${safeProfile.productName} 的材质、发光面、边缘工艺或图中真实可见安装关系。`,
    real: `模拟真实拍摄质感，保留产品可信度和现场感。`,
    collage: `多张灯具主体统一暖灰底拼装，产品互不重叠。`
  };
  return map[String(category || "")] || `生成 ${safeProfile.productName} 的电商商品图。`;
}

function categoryInstruction(category, index = 1, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const label = categoryLabel(category);
  const base = `${label} ${index}：`;
  const smallLampGuidance = smallLampDisplayGuidance(category, safeProfile, settings);
  const common = `主体必须是上传的 ${safeProfile.productName}。${productConsistencyOneLine(safeProfile, settings)}`;
  const withSmallGuidance = (text) => [text, smallLampGuidance, common].filter(Boolean).join("");
  if (category === "main") {
    return withSmallGuidance(`${base}生成干净的电商主图，统一浅色或白色背景，完整展示灯具主体，构图居中，边缘自然，阴影柔和。`);
  }
  if (category === "selling") {
    if (styleSimilarAllowsPlannedText(settings)) {
      return withSmallGuidance(`${base}围绕一个明确购买理由生成卖点图，参考图只作为信息层级、留白、标题/副标题/功能标签和箭头标注节奏；需要渲染规划好的少量简体中文卖点文案，文案必须来自当前灯具真实功能和结构，不照搬参考图原文，不生成乱码、品牌标志、水印、价格或无关界面元素。`);
    }
    return withSmallGuidance(`${base}围绕一个明确购买理由生成卖点图，画面要突出产品造型、材质、光效或安装优势，但不要生成随机文字、图标、价格、箭头或海报元素。`);
  }
  if (category === "function") {
    return withSmallGuidance(`${base}生成图文功能说明图，使用清晰中文标题、编号、短说明和功能卡片，展示护眼光感、均匀透光、材质稳定、安装结构或真实照明价值；文字必须来自当前产品可见结构和通用照明优势，禁止虚构品牌、认证、进口芯片、专利、价格、品牌标志或水印。`);
  }
  if (category === "scene") {
    if (isActiveStyleSimilarSettings(settings) && styleSimilarMode(settings) === "scene") {
      const spec = styleSimilarModeSpec("scene");
      return withSmallGuidance(`${base}${spec.generationGoal} ${spec.referenceUse} ${SINGLE_SCENE_IMAGE_LOCK} ${spec.negativeRules} `);
    }
    return withSmallGuidance(`${base}生成单张完整真实室内场景图，让灯具按合理比例安装在适合的空间中，光照、透视、阴影自然，空间不要喧宾夺主。${SINGLE_SCENE_IMAGE_LOCK}`);
  }
  if (category === "detail") {
    if (styleSimilarAllowsPlannedText(settings)) {
      return withSmallGuidance(`${base}生成产品细节图，参考图只作为微距角度、局部构图、细节标注、材质说明和指示线节奏；需要渲染规划好的少量简体中文细节文字，说明当前灯具真实材质、发光面、边缘工艺或图中可见安装关系，不照搬参考图原文，不生成乱码、品牌标志、水印、价格或无关界面元素。`);
    }
    return withSmallGuidance(`${base}生成产品细节图，近景展示发光面、材质纹理、边缘工艺或图中可见安装关系等真实细节，不能编造不存在的零件。`);
  }
  if (category === "real") {
    if (isActiveStyleSimilarSettings(settings) && styleSimilarMode(settings) === "real") {
      const spec = styleSimilarModeSpec("real");
      return withSmallGuidance(`${base}${spec.generationGoal} ${spec.referenceUse} ${spec.negativeRules} `);
    }
    return withSmallGuidance(`${base}生成可信的实拍风格商品图，允许轻微真实拍摄质感，但产品仍要干净、清晰、可商用。`);
  }
  if (category === "collage") {
    return withSmallGuidance(`${base}${collageStrategyPrompt(settings)} `);
  }
  return withSmallGuidance(`${base}生成灯具电商商品图。`);
}

function selectedLampCategoryLabel(settings = {}, product = {}) {
  return selectedLampCategorySpec(settings, product).label;
}

function selectedLampCategoryPrompt(settings = {}, product = {}) {
  if (!hasForcedLampCategory(settings, product)) return "";
  const spec = selectedLampCategorySpec(settings, product);
  return `已选择灯具类目：${spec.label}。${spec.hint ? `类目提示：${spec.hint}。` : ""}生成时必须保留上传产品图里的真实结构。`;
}

function selectedLampCategoryExecutionPrompt(settings = {}, product = {}) {
  return selectedLampCategoryPrompt(settings, product);
}

function styleCloneStrategy(settings = {}) {
  const nested = settings?.styleCloneStrategy && typeof settings.styleCloneStrategy === "object"
    ? settings.styleCloneStrategy
    : {};
  return {
    cloneStrength: settings.cloneStrength || nested.cloneStrength || "standard",
    backgroundLock: settings.backgroundLock || nested.backgroundLock || "standard",
    positionLock: settings.positionLock || nested.positionLock || "standard",
    styleConsistency: settings.styleConsistency || nested.styleConsistency || "standard"
  };
}

function shouldAnalyzeReferenceMountTargets(settings = {}) {
  const mode = String(process.env.STYLE_REFERENCE_MOUNT_TARGET_ANALYSIS || "strict").toLowerCase();
  if (["always", "1", "true"].includes(mode)) return true;
  if (["never", "0", "false"].includes(mode)) return false;
  return String(styleCloneStrategy(settings).cloneStrength || "").toLowerCase() === "strict";
}

function collageStrategy(settings = {}) {
  return {
    layoutLock: settings.layoutLock || "strict",
    slotOrder: settings.slotOrder || "upload",
    styleUnity: settings.styleUnity || "strong",
    textProtection: settings.textProtection || "protect"
  };
}

function styleCloneStrategyPrompt(settings = {}, options = {}) {
  if (options.direct) {
    return "直接替换参考图：参考图是底图，只借用参考图的画面结构和风格方向，主体必须替换为用户上传的灯具。";
  }
  const spec = styleSimilarModeSpec(styleSimilarMode(settings));
  return `${spec.label}：${spec.generationGoal} ${spec.referenceUse}`;
}

function collageStrategyPrompt(settings = {}) {
  if (isSingleCallRetouchComposeCollage(settings)) {
    return "拼图流程：一次模型调用内完成所有上传图的灯具主体提取、精修、去背景，并放到同一个暖灰方形画布中；文字标签由本地后处理叠加，不交给模型生成。";
  }
  return "拼图流程：每个上传产品保持独立主体，保留真实结构，使用统一连续背景，不要卡片、边框、分隔线、品牌标志、水印或随机文字。";
}

function workspaceStrategyPrompt(settings = {}) {
  if (isCollageTemplateSettings(settings)) return collageStrategyPrompt(settings);
  if (settings.styleCloneMode) return styleCloneStrategyPrompt(settings, { direct: isDirectStyleCloneSettings(settings) });
  return "商品图流程：以上传灯具为唯一主体来源，生成干净、清晰、可商用的电商图片。";
}

function resolveShotTask(shot = {}) {
  const value = String(shot.category || shot.task || "").toLowerCase();
  if (SHOT_CATEGORY_KEYS.includes(value)) return value;
  const text = String((shot.title || "") + " " + (shot.prompt || "")).toLowerCase();
  if (text.includes("detail")) return "detail";
  if (text.includes("scene")) return "scene";
  if (text.includes("real")) return "real";
  if (text.includes("main")) return "main";
  return "selling";
}

function shotVariationIndex(shot = {}, fallbackIndex = 0) {
  const raw = Number(shot.variationIndex ?? shot.index ?? fallbackIndex);
  return Number.isFinite(raw) ? Math.max(1, raw || 1) : Math.max(1, Number(fallbackIndex || 0) + 1);
}

function styleSimilarModeLabel(mode = "") {
  const map = { scene: "相似场景图", selling: "相似卖点图", detail: "相似细节图", real: "相似实拍图", none: "直接替换" };
  return map[String(mode || "none")] || "相似参考图";
}

function styleSimilarModeSpec(mode = "") {
  const value = String(mode || "none").toLowerCase();
  const specs = {
    scene: {
      label: "相似场景图",
      category: "scene",
      analysisGoal: "识别产品图里的灯具主体；独立识别参考图的空间类型、镜头角度、色调、软装、光影、安装关系和氛围。",
      referenceUse: "参考图只用于提取空间类型、色调、材质氛围、光影方向和软装密度，不是底图；必须重新设计房间布局、家具组合、墙面装饰、植物位置、天花灯位和镜头构图。",
      generationGoal: "以用户上传灯具这一套产品为唯一灯具主体，生成同类但明显不同的新场景图，空间合理、光影自然、安装关系可信。",
      textPolicy: "不要生成文字、品牌标志、水印、价格、界面元素或无关标注。",
      negativeRules: "禁止保留参考图原灯具、原商品位置、原完整房间或原背景细节；禁止复刻参考图的同款柜体、同款植物位置、同款挂画位置、同款墙面分割和同款灯位排列；禁止执行换主体/替换参考图主体；禁止复制成多套灯具、灯阵或背景装饰灯。"
    },
    selling: {
      label: "相似卖点/功能图",
      category: "selling",
      analysisGoal: "识别产品图真实结构、功能、材质和光效；独立识别参考图的信息层级、标题/副标题、功能标签、箭头标注、留白和产品呈现方式。",
      referenceUse: "参考图只用于卖点图版式和信息表达节奏，不是底图，不替换参考图里的原商品。",
      generationGoal: "生成当前灯具的相似卖点/功能图，中文卖点文案按当前产品改写。",
      textPolicy: "允许并要求渲染规划好的少量简体中文卖点标题、副标题、功能标签和必要箭头标注；禁止随机文字、乱码、品牌标志、水印、价格或无关界面元素。",
      negativeRules: "禁止照搬参考图原文，禁止把参考图产品当成当前产品，禁止混入场景图、细节图或实拍图表达。"
    },
    detail: {
      label: "相似细节图",
      category: "detail",
      analysisGoal: "识别产品图真实材质、发光面、连接件、安装结构和工艺细节；独立识别参考图的微距角度、局部构图、材质表现、细节标注、指示线和景深。",
      referenceUse: "参考图只用于细节图局部表达方式，不是底图，不替换参考图里的原商品。",
      generationGoal: "生成当前灯具的相似细节图，中文细节说明按当前产品改写。",
      textPolicy: "允许并要求渲染规划好的少量简体中文细节标注、材质/结构说明和必要指示线；禁止随机文字、乱码、品牌标志、水印、价格或无关界面元素。",
      negativeRules: "禁止照搬参考图原文，禁止编造产品图里没有的材质、连接件或安装结构，禁止混入完整空间场景。"
    },
    real: {
      label: "相似实拍图",
      category: "real",
      analysisGoal: "识别产品图真实外形、材质、颜色和安装方式；独立识别参考图的真实拍摄感、自然光、透视、背景质感、阴影和到货质感。",
      referenceUse: "参考图只用于真实拍摄质感和自然背景方向，不是底图，不保留原场景，不替换参考图里的原商品。",
      generationGoal: "生成当前灯具的相似实拍图，像真实拍摄，保留可信透视和自然光影。",
      textPolicy: "不要生成文字、品牌标志、水印、价格、界面元素或无关标注。",
      negativeRules: "禁止做卖点海报、细节拼版、文字排版或参考图主体替换。"
    },
    none: {
      label: "直接换主体",
      category: "scene",
      analysisGoal: "识别参考图画面和用户上传灯具主体。",
      referenceUse: "参考图是底图，保留背景、构图、镜头、光影和空间关系。",
      generationGoal: "只把参考图中的原商品主体替换为用户上传灯具。",
      textPolicy: "不新增随机文字、品牌标志、水印、价格或无关界面元素。",
      negativeRules: "禁止改变参考图背景空间，禁止改款或新增产品图里没有的灯具结构。"
    }
  };
  return specs[value] || specs.none;
}

function styleSimilarCategoryFromMode(mode = "") {
  const value = String(mode || "").toLowerCase();
  return styleSimilarModeSpec(value).category;
}

function styleSimilarMode(settings = {}) {
  return String(settings?.similarMode || settings?.styleSimilarMode || "").trim();
}

function isDirectStyleCloneSettings(settings = {}) {
  return Boolean(settings?.styleCloneMode && (!styleSimilarMode(settings) || styleSimilarMode(settings) === "none"));
}

function isStyleSimilarSettings(settings = {}) {
  const mode = styleSimilarMode(settings);
  return Boolean(settings?.styleCloneMode && mode && mode !== "none");
}

function isActiveStyleSimilarSettings(settings = {}) {
  const mode = styleSimilarMode(settings);
  return Boolean(settings?.styleCloneMode && mode && mode !== "none");
}

function styleSimilarAllowsPlannedText(settings = {}) {
  const mode = typeof settings === "string" ? settings : styleSimilarMode(settings);
  if (typeof settings !== "string" && !settings?.styleCloneMode) return false;
  return ["selling", "detail"].includes(String(mode || "").toLowerCase());
}

function styleSimilarPlannedTextRule(settings = {}) {
  return styleSimilarModeSpec(typeof settings === "string" ? settings : styleSimilarMode(settings)).textPolicy;
}

function productPromptAllowsText(category = "") {
  return ["selling", "function", "detail"].includes(String(category || "").toLowerCase());
}

function settingsRequestNoVisibleText(settings = {}) {
  const text = [
    settings?.language,
    settings?.textPolicy,
    settings?.visibleTextMode,
    settings?.productTextMode
  ].map((item) => String(item || "")).join(" ");
  return /无文字|纯视觉|不要可见文字|不需要可见文字|no visible text|no text/i.test(text);
}

function productWorkspaceVisibleTextEnabled(settings = {}) {
  if (settingsRequestNoVisibleText(settings)) return false;
  if (settings?.allowVisibleText === true || settings?.productVisibleText === true || settings?.renderTextOverlay === true) return true;
  const text = [settings?.language, settings?.visibleTextMode, settings?.productTextMode].map((item) => String(item || "")).join(" ");
  if (!text.trim()) return true;
  return /简体中文|中文|标注|卖点|细节|可见文字|文字版|text/i.test(text);
}

function detailSequenceId(shot = {}) {
  return String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || shot?.id || "");
}

function isDetailHeroTextShot(shot = {}, category = "") {
  const value = String(category || shot?.category || "").toLowerCase();
  const sequenceId = detailSequenceId(shot);
  if (sequenceId === "detail-cover") return value === "main" || value === "scene";
  if (value !== "scene") return false;
  return new Set(["hero-main-space", "hero-atmosphere", "wall-hero-atmosphere"]).has(sequenceId);
}

function isCriticalDetailTextShot(shot = {}, category = "") {
  const value = String(category || shot?.category || "").toLowerCase();
  const sequenceId = detailSequenceId(shot);
  const coreSellingTextShot = value === "selling" && new Set(["core-reason", "core-wall-reason"]).has(sequenceId);
  return value === "function" || value === "detail" || coreSellingTextShot || isDetailHeroTextShot(shot, value);
}

function isCriticalDetailTextSlot(slot = {}, category = "") {
  return isCriticalDetailTextShot({
    category: category || slot?.category,
    sequenceSlot: slot?.id || slot?.sequenceSlot
  }, category || slot?.category);
}

function productWorkspaceTextEnabledForShot(settings = {}, shot = {}, category = "") {
  if (isProductWorkspaceSettings(settings) && isCriticalDetailTextShot(shot, category)) return true;
  return productWorkspaceVisibleTextEnabled(settings);
}

function explicitTextRenderMode(settings = {}) {
  const text = [settings?.textRenderMode, settings?.productTextRenderMode, settings?.visibleTextRenderMode]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (/model[-_\s]?direct|model|模型/.test(text)) return "model-direct";
  if (/local[-_\s]?overlay|svg|overlay|后置/.test(text)) return "local-overlay";
  if (/no[-_\s]?text|none|无文字/.test(text)) return "no-text";
  return "";
}

function textRenderModeForShot(shot = {}, category = "", settings = {}) {
  if (shot.textRenderMode) return String(shot.textRenderMode);
  const explicit = explicitTextRenderMode(settings);
  if (explicit) return explicit;
  if (!shot?.textOverlay && isProductWorkspaceSettings(settings) && new Set(["detail-cover", "function-core"]).has(detailSequenceId(shot))) return "model-direct";
  if (!shot?.textOverlay) return "no-text";
  if (isProductWorkspaceSettings(settings) && isCriticalDetailTextShot(shot, category)) return "model-direct";
  return "local-overlay";
}

function visiblePromptRequestsNoText(prompt = "", category = "") {
  let text = String(prompt || "");
  const task = String(category || "").toLowerCase();
  if (task !== "scene") {
    text = text.replace(/场景图[^。；;\n]*(?:不要任何文字|不需要可见文字|不要可见文字|不要文字|无文字|纯视觉)[^。；;\n]*/g, "");
  }
  if (!["selling", "function", "detail"].includes(task)) {
    return /不要任何文字|不需要可见文字|不要可见文字|无文字|纯视觉|no visible text|no text/i.test(text);
  }
  return /(?:本图|当前图|这张|该图|此图|所有图片|全部图片|整套|每张|画面|图片)[^。；;\n]{0,18}(?:不要任何文字|不需要可见文字|不要可见文字|不要文字|无文字|纯视觉)|^(?:不要任何文字|不需要可见文字|不要可见文字|无文字|纯视觉)$/im.test(text.trim());
}

function promptHasNoTextDirective(prompt = "") {
  return /(?:^|\n)\s*(?:文字|文字内容|text)\s*[：:]\s*(?:无|none|no text|no visible text)\s*(?:[。.!！]?|$)/i.test(String(prompt || ""));
}

function cleanPromptPart(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "以上传图片为准" || text === "待识别") return "";
  return text;
}

function compactPromptPart(value = "", maxLength = 80) {
  const text = cleanPromptPart(value)
    .replace(/\s+/g, " ")
    .replace(/[。；;，,、]+$/g, "")
    .trim();
  const limit = Math.max(12, Number(maxLength) || 80);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function stripUserVisiblePlanningNoise(value = "") {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^本次数量[：:]/.test(line))
    .filter((line) => !/(?:\d+\s*张)?(?:卖点图|功能图|场景图|细节图|实拍图).*(?:\d+\s*张|拆分|本次|数量)/.test(line))
    .filter((line) => !/按(?:卖点图|功能图|场景图|细节图|实拍图).*(?:拆分|独立画面目标)/.test(line))
    .filter((line) => !/未上传参考图/.test(line))
    .filter((line) => !/生成会使用产品图和每张图下方可编辑提示词/.test(line))
    .join("\n")
    .trim();
}

function cleanChineseOverlayText(value = "", { fallback = "", maxLength = 16 } = {}) {
  let text = String(value || "")
    .replace(/[A-Za-z][A-Za-z0-9+/#&.,:_-]*/g, "")
    .replace(/[^\u4e00-\u9fa50-9，。、：；（）\-—\s]/g, " ")
    .replace(/\s+/g, "")
    .replace(/[，。、：；\-—]+$/g, "")
    .trim();
  if (!/[\u4e00-\u9fa5]/.test(text)) text = fallback;
  text = String(text || "")
    .replace(/[A-Za-z][A-Za-z0-9+/#&.,:_-]*/g, "")
    .replace(/[^\u4e00-\u9fa50-9，。、：；（）\-—\s]/g, "")
    .replace(/\s+/g, "")
    .replace(/[，。、：；\-—]+$/g, "")
    .trim();
  if (!text) return "";
  return text.slice(0, Math.max(2, Number(maxLength) || 16));
}

function splitChineseOverlayLabels(value = "", { maxItems = 4, maxLength = 8 } = {}) {
  return String(value || "")
    .split(/[，,、/；;。\n]+/)
    .map((item) => cleanChineseOverlayText(item, { maxLength }))
    .filter((item) => item && /[\u4e00-\u9fa5]/.test(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, Math.max(1, Number(maxItems) || 4));
}

function compactHeroAtmosphereTitleText(value = "", fallback = "温润光境") {
  const raw = cleanChineseOverlayText(value, { fallback, maxLength: 28 })
    .replace(/[的之]/g, "")
    .replace(/高级|高端|质朴|风格/g, "");
  const text = raw || cleanChineseOverlayText(fallback, { maxLength: 8 });
  const nouns = [
    "家居质感",
    "居家质感",
    "空间质感",
    "家居光影",
    "居家光影",
    "空间光影",
    "墙面光境",
    "床头光影",
    "客厅光影",
    "餐厅光影",
    "柔和光感",
    "温润光感",
    "氛围光感",
    "舒适照明"
  ];
  const prefixes = ["克制", "干净", "温润", "静谧", "柔和", "松弛", "现代", "极简", "自然", "轻奢", "简约", "暖调"];
  for (const noun of nouns) {
    if (!text.includes(noun)) continue;
    const prefix = prefixes.find((item) => text.includes(item) && `${item}${noun}`.length <= 8);
    return prefix ? `${prefix}${noun}` : noun;
  }
  const compact = text
    .replace(/家居品质感/g, "家居质感")
    .replace(/克制干净/g, "干净克制")
    .replace(/照明氛围/g, "氛围光感");
  const sliced = compact.length > 8 ? compact.slice(0, 8) : compact;
  return sliced.replace(/[的之与和及质氛空家居]$/g, "") || cleanChineseOverlayText(fallback, { maxLength: 8 });
}

function isWeakCommerceHeroCopy(value = "") {
  const text = cleanChineseOverlayText(value, { maxLength: 20 });
  if (!text) return true;
  return /干净留白|高级留白|克制留白|基础照明|基础光照|普通照明|功能照明|产品展示|商品展示|主图展示|详情首图|页面首图|背景干净|简洁背景|简约背景|留白构图|构图|版式|排版|关键词|视觉风格|氛围营造|情绪关键词|照明为主|氛围照明为主|装饰与功能照明/.test(text)
    || /^(?:柔光氛围|柔和氛围|氛围照明|柔和照明|舒适照明|柔和光线|光线柔和|温暖氛围|高级氛围)$/.test(text);
}

function heroCopySource(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    safeProfile.visualStrategy?.productStyle,
    safeProfile.visualStrategy?.suitableVisualStyle,
    safeProfile.visualStrategy?.styleKeywords,
    safeProfile.visualStrategy?.moodKeywords,
    safeProfile.visualStrategy?.lightingEffect,
    safeProfile.visualStrategy?.visualLanguage,
    safeProfile.visualStrategy?.decorativeElements,
    safeProfile.style,
    safeProfile.targetSpace,
    safeProfile.lightUse,
    safeProfile.sellingPoint || safeProfile.sellingPoints,
    safeProfile.lampSubtype,
    safeProfile.lampType,
    safeProfile.productName,
    safeProfile.material,
    safeProfile.colorPalette
  ].map((item) => cleanPromptPart(item)).filter(Boolean).join("、");
}

function heroSpaceLabel(source = "") {
  const text = String(source || "");
  if (/客餐厅|客厅.*餐厅|餐厅.*客厅/.test(text)) return "客餐厅";
  if (/餐厅|餐桌|餐边|岛台/.test(text)) return "餐厅";
  if (/客厅|沙发|会客/.test(text)) return "客厅";
  if (/卧室|床头|睡眠/.test(text)) return "卧室";
  if (/书房|阅读|办公桌/.test(text)) return "书房";
  if (/玄关|入户/.test(text)) return "玄关";
  if (/走廊|过道|廊道/.test(text)) return "走廊";
  if (/墙面|壁装|壁灯/.test(text)) return "墙面";
  if (/家装|住宅|家居|居家/.test(text)) return "家居";
  return "空间";
}

function heroStyleLabel(source = "") {
  const text = String(source || "");
  if (/轻法式|法式|奶油法式/.test(text)) return "轻法式";
  if (/中古|复古/.test(text)) return "中古";
  if (/侘寂|日式|原木/.test(text)) return "侘寂";
  if (/北欧/.test(text)) return "北欧";
  if (/奶油|米白|暖白/.test(text)) return "奶油";
  if (/极简|简约/.test(text)) return "极简";
  if (/现代|当代/.test(text)) return "现代";
  if (/艺术|雕塑|装置/.test(text)) return "艺术";
  return "";
}

function heroFormMoodLabel(source = "") {
  const text = String(source || "");
  if (/花朵|花瓣|花形|褶皱|皱褶|褶裥/.test(text)) return "花影";
  if (/纸艺|折纸|纸感/.test(text)) return "纸艺";
  if (/云朵|云感|云形/.test(text)) return "云朵";
  if (/水晶|玻璃|晶透|透明/.test(text)) return "晶透";
  if (/藤编|竹编|编织/.test(text)) return "编织";
  if (/木质|原木|木纹/.test(text)) return "木质";
  if (/金属|拉丝|不锈钢|铝/.test(text)) return "金属";
  return "";
}

function heroEmotionLabel(source = "") {
  const text = String(source || "");
  if (/治愈/.test(text)) return "治愈";
  if (/安静|静谧|宁静/.test(text)) return "静谧";
  if (/松弛|放松/.test(text)) return "松弛";
  if (/轻盈|轻柔/.test(text)) return "轻盈";
  if (/温暖|暖|温润/.test(text)) return "暖调";
  if (/清透|通透/.test(text)) return "清透";
  if (/雅致|优雅/.test(text)) return "雅致";
  return "";
}

function heroProductFormLabel(profile = {}, source = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const text = String(source || "");
  if (/花朵吊灯|花瓣吊灯|艺术吊灯/.test(text)) return text.match(/(?:花朵|花瓣|艺术)吊灯/)?.[0] || "艺术吊灯";
  if (/空间主灯|主灯/.test(text) && !/艺术吊灯|水晶吊灯|花朵吊灯|花瓣吊灯/.test(text)) return "空间主灯";
  if (/吊灯/.test(text)) return /花|褶皱|纸艺|云朵|艺术/.test(text) ? "艺术吊灯" : "吊灯";
  if (/吸顶灯|主灯/.test(text)) return "空间主灯";
  if (/壁灯|墙灯/.test(text)) return "墙面壁灯";
  if (/轨道/.test(text)) return "轨道小灯";
  if (/射灯/.test(text)) return "精致射灯";
  if (/筒灯|小灯/.test(text)) return "精致小灯";
  const product = cleanChineseOverlayText(safeProfile.lampSubtype || safeProfile.lampType || safeProfile.productName, { maxLength: 8 });
  return /灯具产品|小灯产品|灯具$/.test(product) ? "" : product;
}

function firstUsefulHeroCopy(candidates = [], fallback = "居家光影") {
  for (const candidate of candidates) {
    const text = cleanChineseOverlayText(candidate, { maxLength: 14 });
    if (!text || isWeakCommerceHeroCopy(text)) continue;
    if (text.length < 4 || text.length > 12) continue;
    return text;
  }
  if (!fallback) return "";
  return cleanChineseOverlayText(fallback, { maxLength: 8 }) || "居家光影";
}

function indexedPromptVariant(items = [], index = 1) {
  const list = items.filter(Boolean);
  if (!list.length) return "";
  return list[(Math.max(1, Number(index) || 1) - 1) % list.length];
}

function smallLampWorkspaceFamilySpec(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    generic: {
      name: "小灯",
      parts: "上传图可见的紧凑灯体、发光口、灯杯/面环/模块和对应安装接触结构",
      install: "按上传图可见安装关系固定",
      functionFocus: "紧凑体量、真实发光口、材质和安装关系",
      sceneFocus: "保持小灯真实体量和安装接触点，不新增转轴、支架或轨道"
    },
    "recessed-downlight": {
      name: "嵌入筒灯",
      parts: "面环、深杯/灯杯、发光口、吊顶开孔剖面、防眩角、光束角",
      install: "嵌入吊顶开孔内，面环与天花齐平贴合",
      functionFocus: "开孔尺寸、防眩深杯、光束角、面环贴合和嵌入安装细节",
      sceneFocus: "只露出齐平面环、灯杯或发光口，尺寸接近真实天花小灯位"
    },
    "surface-downlight": {
      name: "明装筒灯",
      parts: "贴顶圆柱/方盒、顶部接触面、底部发光口、短小灯体",
      install: "顶部直接贴合天花或安装面",
      functionFocus: "免开孔贴顶、顶部接触面、底部发光口和小体量安装",
      sceneFocus: "小圆柱/方盒贴在天花上，不悬空、不悬吊"
    },
    spotlight: {
      name: "射灯",
      parts: "灯头、灯杯、转轴、支架、照射方向、光斑/洗墙效果",
      install: "通过支架或转轴连接安装面，角度可调",
      functionFocus: "转轴调节、照射角度、重点照明、光斑或洗墙效果",
      sceneFocus: "灯头保持小体量，支架/转轴接触点清楚，照射方向可信"
    },
    "track-spotlight": {
      name: "轨道射灯",
      parts: "导轨、卡扣/磁吸连接、灯头、转轴支架、灯头角度",
      install: "灯体必须连接导轨或磁吸轨道",
      functionFocus: "轨道卡扣/磁吸连接、沿轨道移动、灯头角度和重点照明",
      sceneFocus: "灯头沿轨道安装，不脱离轨道、不漂浮"
    },
    track: {
      name: "轨道灯",
      parts: "导轨/磁吸轨道、灯体模块、卡扣连接点、长条或点状发光模块",
      install: "灯体模块沿轨道连续安装",
      functionFocus: "轨道模块化、磁吸/卡扣连接、连续布光和安装槽位",
      sceneFocus: "导轨与灯体连接关系清楚，灯具不脱轨"
    }
  };
  return map[safeProfile.mountFamily] || map.generic;
}

function productWorkspaceSeedContext(profile = {}, settings = {}, userRequirement = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const productName = cleanPromptPart(safeProfile.productName) || "灯具产品";
  const material = cleanPromptPart(safeProfile.material);
  const color = cleanPromptPart(safeProfile.colorPalette);
  const structure = cleanPromptPart(safeProfile.structureKeywords);
  const sellingPoint = cleanPromptPart(safeProfile.sellingPoint);
  const lightUse = cleanPromptPart(safeProfile.lightUse);
  const targetSpace = cleanPromptPart(safeProfile.targetSpace);
  const installation = cleanPromptPart(safeProfile.installationMethod || safeProfile.installationPosition);
  const visualStrategy = safeProfile.visualStrategy || {};
  const compactVisual = compactLampVisualStrategy(safeProfile, settings);
  const visualDirection = compactVisual
    ? [
        compactVisual.style ? `风格 ${compactVisual.style}` : "",
        compactVisual.mood ? `光影 ${compactVisual.mood}` : "",
        compactVisual.visual ? `画面 ${compactVisual.visual}` : "",
        compactVisual.view ? `视角 ${compactVisual.view}` : ""
      ].filter(Boolean).slice(0, 4).join("；")
    : "";
  const materialLine = [material, color].filter(Boolean).join("，");
  const functionBenefits = [
    sellingPoint || lightUse || "护眼光感与均匀照明",
    materialLine || "材质稳定与做工细节",
    structure || installation || "真实结构和安装方式",
    targetSpace || "适合多种家居/商业照明场景"
  ].filter(Boolean);
  return {
    safeProfile,
    channel: lampChannelSpec(safeProfile, settings),
    productName,
    material,
    color,
    structure,
    sellingPoint,
    lightUse,
    targetSpace,
    installation,
    visualStrategy,
    compactVisual,
    visualDirection,
    materialLine,
    functionBenefits,
    functionBenefitText: functionBenefits.slice(0, 4).join("；"),
    userLine: cleanPromptPart(userRequirement) ? `结合用户补充要求：${cleanPromptPart(userRequirement)}。` : "",
    structureLine: structure ? `重点保留 ${structure}。` : "",
    installLine: installation ? `安装方式遵循图片可见结构：${installation}。` : ""
  };
}

function productSuiteStyleLine(profile = {}, settings = {}) {
  const visual = compactLampVisualStrategy(profile, settings);
  if (!visual) return "";
  const usable = (value = "") => {
    const text = cleanPromptPart(value);
    if (!text) return "";
    const questionMarks = (text.match(/\?/g) || []).length;
    if (questionMarks && questionMarks >= Math.max(3, text.length * 0.35)) return "";
    return text;
  };
  const parts = [
    usable(visual.style) ? `风格=${compactPromptPart(usable(visual.style), 28)}` : "",
    usable(visual.mood) ? `光影=${compactPromptPart(usable(visual.mood), 32)}` : "",
    usable(visual.visual) ? `色彩/画面=${compactPromptPart(usable(visual.visual), 36)}` : ""
  ].filter(Boolean);
  return parts.length
    ? `整套视觉主题锁：${parts.join("；")}；详情图和场景图保持同一产品气质、色彩系统和光影氛围。`
    : "";
}

function productWorkspaceGenericSeeds(ctx = {}) {
  const { productName, materialLine, structure, sellingPoint, lightUse, targetSpace, installation, functionBenefitText, functionBenefits } = ctx;
  return {
    main: [
      `生成${productName}的干净电商主图，完整展示产品主体，浅色背景，居中构图，柔和阴影，突出真实轮廓和比例。`,
      `生成${productName}的高级商品主图，产品占画面主体位置，背景简洁明亮，展示${materialLine || "真实材质和颜色"}。`,
      `生成${productName}的首图视角，画面留白适中，主体清晰锐利，边缘干净，适合电商列表页。`
    ],
    selling: [
      `生成${productName}的卖点图，突出${sellingPoint || lightUse || "清晰照明和产品质感"}，画面留白清楚，可使用少量中文卖点标注。`,
      `生成${productName}的功能优势图，围绕${lightUse || sellingPoint || "灯光效果与使用价值"}组织画面，主体保持清晰，可加入简洁局部说明。`,
      `生成${productName}的购买理由图，强调${materialLine || sellingPoint || "材质、光效和安装优势"}，版面干净，不做复杂海报。`
    ],
    function: [
      `生成${productName}的通用功能说明图，使用简洁图文版式展示${functionBenefitText}；只使用上传产品图可见结构，不主动借用其它灯具通道的安装部件。`,
      `生成${productName}的功能优势图，顶部大标题，主体展示产品关键结构，下方用短中文卡片说明${functionBenefitText}；不要虚构图片里不可见的零件。`,
      `生成${productName}的单卖点功能图，主体展示产品或关键结构渲染，旁边放置短中文说明，突出${functionBenefits[0] || "稳定耐用和舒适照明"}。`
    ],
    scene: [
      `生成${productName}的真实空间场景图，放入${targetSpace || "适合的家居空间"}，画面只出现上传产品这一套灯具，展示合理安装关系和自然照明氛围。`,
      `生成${productName}的应用场景图，空间干净高级，只放置一套上传产品，灯具比例可信，光影自然，突出${lightUse || "照明效果"}。`,
      `生成${productName}的室内搭配图，背景简洁不抢主体，安装位置合理，只展示当前产品这一套灯具在实际空间中的使用效果。`
    ],
    detail: [
      `生成${productName}的细节图，近景展示${structure || "发光面、连接件、安装结构和材质纹理"}，画面干净，可使用少量中文细节标注。`,
      `生成${productName}的材质特写图，突出${materialLine || "真实表面质感"}和做工细节，局部放大但不改变结构。`,
      `生成${productName}的结构细节图，展示${installation || structure || "灯体连接、发光面和安装部位"}，背景简洁，主体清晰。`
    ],
    real: [
      `生成${productName}的实拍风格商品图，像真实摄影棚拍摄，光线自然，产品干净清晰，保留可信材质和比例。`,
      `生成${productName}的真实到货拍摄感图片，背景自然简洁，轻微真实阴影，主体不变形。`,
      `生成${productName}的商用实拍图，镜头质感真实，曝光均衡，细节清楚，适合详情页展示。`
    ]
  };
}

function productWorkspaceLargeSeeds(ctx = {}) {
  const { productName, materialLine, sellingPoint, lightUse, targetSpace, installation, functionBenefits, functionBenefitText, visualDirection } = ctx;
  const visualLine = visualDirection ? `画面风格、背景、光影、色彩和装饰元素按实时识别到的产品视觉策略执行：${visualDirection}。` : "";
  return {
    main: [
      `生成${productName}的大灯商品主图，完整展示主灯主体、灯罩/灯臂/吸顶盘或吊装结构，画面居中，保留真实大灯体量和重心。${visualLine}`,
      `生成${productName}的高级大灯首图，清楚展示${materialLine || "材质、颜色和完整灯体"}，不要压缩成其它通道的小体量。${visualLine}`,
      `生成${productName}的电商大灯主图，完整保留吊线/吊杆/灯臂/灯罩/吸顶盘等上传图可见结构，背景干净。${visualLine}`
    ],
    selling: [
      `生成${productName}的大灯卖点图，突出${sellingPoint || "整灯造型、空间氛围和照明覆盖"}，完整灯体清楚，版面留白高级。${visualLine}`,
      `生成${productName}的大灯购买理由图，围绕${lightUse || "主照明、装饰氛围和空间层次"}组织画面，可用短中文标注结构和光效。${visualLine}`,
      `生成${productName}的大灯材质与光效卖点图，强调${materialLine || "灯体质感、灯罩透光和安装结构"}，不改变完整主灯比例。${visualLine}`
    ],
    function: [
      `生成${productName}的大灯功能图，图文展示整灯照明覆盖、灯罩透光、吊装/贴顶结构和空间主灯体量，内容围绕${functionBenefitText}。${visualLine}`,
      `生成${productName}的大灯结构功能图，主体展示完整灯体和吸顶盘/吊线/吊杆/灯臂等可见安装结构，下方短中文卡片说明${functionBenefitText}。${visualLine}`,
      `生成${productName}的大灯光效功能图，展示主灯在空间中的照明范围、氛围光和材质细节，突出${functionBenefits[0] || "稳定耐用和舒适照明"}。${visualLine}`
    ],
    scene: [
      `生成${productName}的大灯空间场景图，安装在${targetSpace || "客厅、餐厅或卧室等真实空间"}，只出现上传产品这一盏/一套主灯，完整主灯比例、悬挂/贴顶关系和空间透视可信。${visualLine}`,
      `生成${productName}的大灯应用图，保留${installation || "真实安装方式"}，在完整房间尺度中展示这一套主灯的照明氛围，不扩展成多盏同款灯。${visualLine}`,
      `生成${productName}的大灯搭配场景，背景高级干净，画面只放置当前产品这一套灯具，灯体尺度、重心、阴影和安装点自然。${visualLine}`
    ],
    detail: [
      `生成${productName}的大灯细节图，近景展示灯罩、灯臂、吊线/吊杆、吸顶盘、连接件或发光面等上传图可见结构。`,
      `生成${productName}的大灯材质特写，突出${materialLine || "灯体表面、灯罩透光和工艺细节"}，不裁掉关键安装结构。`,
      `生成${productName}的大灯安装结构细节图，展示${installation || "吊装/贴顶连接和完整灯体结构"}，比例真实。`
    ],
    real: [
      `生成${productName}的大灯实拍商品图，像真实摄影棚或样板间拍摄，完整灯体、安装结构和大灯体量可信。`,
      `生成${productName}的大灯到货/安装后实拍感图片，光线自然，灯体不变形，吊装或贴顶关系清楚。`,
      `生成${productName}的大灯商用实拍图，曝光均衡，完整主体和结构细节清楚，适合详情页展示。`
    ]
  };
}

function productWorkspaceSmallSeeds(ctx = {}) {
  const { safeProfile, productName, materialLine, sellingPoint, lightUse, targetSpace, functionBenefits, visualDirection } = ctx;
  const family = smallLampWorkspaceFamilySpec(safeProfile);
  const compactLock = "保持 tiny/small 真实小灯体量，不为了商品清晰度放大成主视觉，不借用其它通道悬吊或大型主灯结构。";
  const visualLine = visualDirection ? `画面风格、背景、光影、色彩和装饰元素按识别到的视觉策略执行：${visualDirection}。` : "画面风格、背景、光影、色彩和装饰元素按识别到的产品气质执行。";
  return {
    main: [
      `生成${productName}的${family.name}小灯商品主图，清楚展示${family.parts}，${visualLine}${compactLock}`,
      `生成${productName}的小灯结构主图，以${family.parts}为主体，视角按识别策略选择，展示真实小体量，避免做大型主灯构图。${visualLine}`,
      `生成${productName}的小灯首图，突出${family.install}和${materialLine || "真实材质颜色"}，${visualLine}主体清晰但尺寸感仍是紧凑小灯。`
    ],
    selling: [
      `生成${productName}的小灯卖点图，围绕${sellingPoint || family.functionFocus}表达单一购买理由，画面可展示${family.parts}，${visualLine}${compactLock}`,
      `生成${productName}的小灯购买理由图，突出${lightUse || family.functionFocus}，${visualLine}用短中文说明真实结构，不添加大灯安装件。`,
      `生成${productName}的小灯安装/光效卖点图，重点展示${family.install}、${family.functionFocus}，${visualLine}产品保持小体量。`
    ],
    function: [
      `生成${productName}的${family.name}专用功能图，图文展示${family.functionFocus}；${visualLine}画面主体只使用${family.parts}，必须保持小灯真实体量。`,
      `生成${productName}的小灯安装结构功能图，使用短中文卡片说明${family.install}、${family.parts}和${functionBenefits[0] || "重点照明效果"}，${visualLine}不得放大成主视觉大灯。`,
      `生成${productName}的小灯光效/结构解析图，展示${family.functionFocus}和局部剖面/光束示意；${visualLine}只表现当前产品真实存在的${family.parts}，不添加其它小灯品类零件。`
    ],
    scene: [
      `生成${productName}的家装中远景应用图，空间按识别到的视觉策略选择，画面包含真实尺度参照，${visualLine}${family.sceneFocus}。`,
      `生成${productName}的住宅空间场景图，按${family.install}自然安装在天花、轨道或墙面灯位，${visualLine}画面有地面、柜体、家具或生活物件，不贴近天花拍摄。`,
      `生成${productName}的小灯照明场景，使用正常层高和正常室内视角呈现完整空间关系，${visualLine}小灯作为照明细节融入适合的空间。`
    ],
    detail: [
      `生成${productName}的小灯细节图，近景展示${family.parts}，${visualLine}可局部放大结构但必须说明为结构细节，不改变真实安装逻辑。`,
      `生成${productName}的小灯安装细节图，展示${family.install}、接触点和当前产品真实安装结构，${visualLine}不添加产品图没有的连接件。`,
      `生成${productName}的小灯发光面细节图，突出${family.parts}中的发光口、灯杯、光束角或安装接触关系，${visualLine}避免出现其它小灯品类部件。`
    ],
    real: [
      `生成${productName}的小灯实拍商品图，像真实到货或安装后拍摄，${visualLine}保持紧凑体量、安装接触点和透视关系。`,
      `生成${productName}的小灯现场实拍感图片，展示${family.sceneFocus}，${visualLine}不要把小灯拍成大灯主视觉。`,
      `生成${productName}的小灯真实实拍图，${visualLine}产品结构清楚、材质真实、尺寸可信，适合详情页展示。`
    ]
  };
}

function productWorkspaceLinearSeeds(ctx = {}) {
  const { productName, materialLine, sellingPoint, lightUse, targetSpace, installation, functionBenefitText, functionBenefits } = ctx;
  return {
    main: [
      `生成${productName}的线性灯商品主图，完整展示连续线条、长条发光面、端盖和连接件，保持真实长条比例。`,
      `生成${productName}的线性灯首图，背景简洁，突出${materialLine || "长条灯体材质和发光面"}，不要变成点状小灯或大型主灯。`,
      `生成${productName}的线性灯电商主图，展示暗槽/贴装/吊装关系和连续发光结构。`
    ],
    selling: [
      `生成${productName}的线性灯卖点图，突出${sellingPoint || "连续发光、均匀洗墙和线性空间感"}，版面干净。`,
      `生成${productName}的线性灯优势图，围绕${lightUse || "连续照明和空间延展"}组织画面，保留长条比例。`,
      `生成${productName}的线性灯购买理由图，强调${materialLine || "发光面、端盖和安装槽位"}。`
    ],
    function: [
      `生成${productName}的线性灯功能图，图文展示连续发光、暗槽/贴装/吊装关系、端盖和连接件，内容围绕${functionBenefitText}。`,
      `生成${productName}的线性灯结构解析图，主体展示长条发光面和安装槽位，下方短中文说明${functionBenefits[0] || "均匀线性照明"}。`,
      `生成${productName}的线性光效功能图，展示洗墙、柜体或空间延展光效，保持连续线条比例。`
    ],
    scene: [
      `生成${productName}的线性灯场景图，放入${targetSpace || "家居柜体或室内空间"}，只出现上传产品这一套线性灯，沿天花/墙面/柜体连续安装。`,
      `生成${productName}的线性灯应用图，保留${installation || "真实安装槽位"}和产品图真实模块数量，光线连续自然。`,
      `生成${productName}的线性灯空间搭配图，画面只放置当前产品这一套线性灯，线条不漂浮、不断裂，透视和安装面可信。`
    ],
    detail: [
      `生成${productName}的线性灯细节图，展示长条发光面、端盖、连接件、暗槽或贴装结构。`,
      `生成${productName}的线性灯材质特写，突出${materialLine || "型材、扩散罩和端盖细节"}。`,
      `生成${productName}的线性灯安装细节图，展示${installation || "槽位、贴装或吊装连接"}。`
    ],
    real: [
      `生成${productName}的线性灯实拍商品图，保持长条比例和连续发光结构。`,
      `生成${productName}的线性灯安装后实拍感图片，光线自然，槽位关系可信。`,
      `生成${productName}的线性灯商用实拍图，曝光均衡，细节清楚。`
    ]
  };
}

function productWorkspaceWallSeeds(ctx = {}) {
  const { productName, materialLine, sellingPoint, lightUse, targetSpace, installation, functionBenefitText, functionBenefits } = ctx;
  return {
    main: [
      `生成${productName}的壁装灯商品主图，展示墙面底座、壁体接触面、出光方向和可见灯体结构。`,
      `生成${productName}的壁灯首图，背景简洁，突出${materialLine || "材质颜色和墙装结构"}，保持壁装比例。`,
      `生成${productName}的壁装灯电商主图，清楚展示底座、灯臂/灯罩或发光面，不借用吊装或轨道结构。`
    ],
    selling: [
      `生成${productName}的壁装灯卖点图，突出${sellingPoint || "墙面氛围照明和装饰效果"}，版面干净。`,
      `生成${productName}的壁灯优势图，围绕${lightUse || "墙面洗亮、阅读或氛围补光"}组织画面，保留墙装接触面。`,
      `生成${productName}的壁装购买理由图，强调${materialLine || "底座、出光方向和安装稳定性"}。`
    ],
    function: [
      `生成${productName}的壁装灯功能图，图文展示墙面底座、接触面、出光方向和氛围/洗墙效果，内容围绕${functionBenefitText}。`,
      `生成${productName}的壁灯结构功能图，主体展示底座、灯臂/灯罩或发光面，下方短中文说明${functionBenefits[0] || "墙面氛围照明"}。`,
      `生成${productName}的壁灯光效功能图，展示上下出光、洗墙或局部照明效果，必须贴合墙面。`
    ],
    scene: [
      `生成${productName}的壁装灯场景图，安装在${targetSpace || "走廊、床头、玄关或墙面空间"}，只出现上传产品这一套壁装灯，墙面接触和光影可信。`,
      `生成${productName}的壁灯应用图，保留${installation || "墙面安装方式"}，只放置当前产品这一套灯具，不悬空、不变成其它通道灯。`,
      `生成${productName}的壁装灯搭配场景，画面只展示当前产品这一套壁灯，出光方向自然，底座阴影和墙面透视准确。`
    ],
    detail: [
      `生成${productName}的壁装灯细节图，展示底座、接触面、灯臂/灯罩、发光面和出光方向。`,
      `生成${productName}的壁灯材质特写，突出${materialLine || "表面质感、边缘和安装底座"}。`,
      `生成${productName}的壁灯安装细节图，展示${installation || "墙面底座和连接结构"}。`
    ],
    real: [
      `生成${productName}的壁装灯实拍商品图，保持墙装比例和接触面可信。`,
      `生成${productName}的壁灯安装后实拍感图片，光线自然，墙面阴影真实。`,
      `生成${productName}的壁装灯商用实拍图，曝光均衡，结构细节清楚。`
    ]
  };
}

function productWorkspaceChannelSeeds(ctx = {}) {
  if (ctx.channel?.channel === "large") return productWorkspaceLargeSeeds(ctx);
  if (ctx.channel?.channel === "small") return productWorkspaceSmallSeeds(ctx);
  if (ctx.channel?.channel === "linear") return productWorkspaceLinearSeeds(ctx);
  if (ctx.channel?.channel === "wall") return productWorkspaceWallSeeds(ctx);
  return productWorkspaceGenericSeeds(ctx);
}

function productWorkspaceSeedPrompt(category = "", index = 1, profile = {}, settings = {}, userRequirement = "") {
  const ctx = productWorkspaceSeedContext(profile, settings, userRequirement);
  const { safeProfile, channel, structureLine, installLine, userLine } = ctx;
  const label = categoryLabel(category);
  const seeds = productWorkspaceChannelSeeds(ctx);
  return [
    `${label} ${index}：${indexedPromptVariant(seeds[category] || seeds.selling, index)}`,
    category === "scene" ? SINGLE_SCENE_IMAGE_LOCK : "",
    CHINA_MARKET_TEXT_LOCK,
    productPromptAllowsText(category) ? "" : NO_VISIBLE_TEXT_LOCK,
    `实时识别通道：${channel.channel}；安装族：${safeProfile.mountFamily}；安装面：${safeProfile.installSurface}；只使用该通道的结构模板。`,
    productSuiteStyleLine(safeProfile, settings),
    smallLampDisplayGuidance(category, safeProfile, settings),
    category === "scene" && isSmallLampProfile(safeProfile, settings) ? smallLampSpatialRealismGuard("scene", null) : "",
    category === "scene" && isSmallLampProfile(safeProfile, settings) ? smallLampSceneScaleGuard("scene", safeProfile, settings) : "",
    productPromptAllowsText(category) ? "可见文字必须是简体中文短句；不要虚构品牌、认证、进口芯片、专利、价格、品牌标志、水印或图片里不可见的结构。" : "",
    structureLine,
    installLine,
    userLine
  ].filter(Boolean).join("\n");
}

const SMALL_LAMP_DETAIL_THEMES = [
  {
    id: "reference-detail-suite",
    name: "黑白克制详情套图",
    line: "参考小灯详情页的统一视觉系统：黑白克制底色、真实产品镜头、家装场景嵌入、细线分隔和稳定留白；整套像同一品牌同一次拍摄与排版，不做随机风格跳变",
    scene: "带黑色外边距或深色留白的真实住宅空间，木饰面、白墙、灰墙、窗光和暖色光斑统一克制",
    textTone: "白色或浅灰简体中文，标题短、层级清楚、少量细线和参数块，不出现花哨装饰"
  },
  {
    id: "black-tech",
    name: "黑底科技",
    line: "黑色或深灰背景、高对比柔光、银色金属质感突出，版式克制高级",
    scene: "深色墙面、木饰面或暗调现代住宅空间",
    textTone: "白色大标题、少量短句，强调冷静高级感"
  },
  {
    id: "warm-home",
    name: "暖调家居",
    line: "温暖室内光、米白墙面、木质或软装背景，画面舒适真实",
    scene: "玄关、卧室、餐边柜或生活化家居空间",
    textTone: "温和中文短句，突出舒适、护眼和日常使用价值"
  },
  {
    id: "white-minimal",
    name: "白色极简",
    line: "白墙、浅灰地面、清爽留白和柔和阴影，突出小灯轮廓",
    scene: "正常层高的极简客厅、餐区或开放式住宅空间",
    textTone: "极简标题和参数卡片，文字少而清楚"
  },
  {
    id: "cement-industrial",
    name: "水泥工业",
    line: "水泥纹理、拉丝金属、低饱和灰调和真实材质细节",
    scene: "正常层高的工业风住宅客厅、书房或玄关空间",
    textTone: "偏理性说明，突出结构、材质和光学性能"
  },
  {
    id: "wood-corridor",
    name: "木质走廊",
    line: "木饰面、走廊透视、自然窗光和局部光斑，氛围更有生活感",
    scene: "有门洞、地面和柜体参照的木质过道或玄关空间",
    textTone: "强调见光不见灯、空间层次和安装后的真实比例"
  }
];

function hashIntFromText(value = "") {
  const hash = sha256Text(value || "small-lamp-detail");
  return Number.parseInt(hash.slice(0, 8), 16) || 0;
}

function smallLampDetailThemeKey(profile = {}, files = [], settings = {}) {
  const fileKey = (files || [])
    .slice(0, 4)
    .map((file) => fileFingerprint(file).hash.slice(0, 12))
    .join("|");
  return JSON.stringify({
    productName: profile.productName || "",
    lampType: profile.lampType || "",
    mountFamily: profile.mountFamily || "",
    material: profile.material || "",
    colorPalette: profile.colorPalette || "",
    ratio: settings.ratio || "",
    fileKey
  });
}

function smallLampDetailTheme(profile = {}, files = [], settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (isProductWorkspaceSettings(settings) && String(settings.imageScope || "detail") === "detail") {
    return SMALL_LAMP_DETAIL_THEMES.find((item) => item.id === "reference-detail-suite") || SMALL_LAMP_DETAIL_THEMES[0];
  }
  const strategyText = [
    safeProfile.style,
    safeProfile.material,
    safeProfile.colorPalette,
    safeProfile.visualStrategy?.suitableVisualStyle,
    safeProfile.visualStrategy?.styleKeywords,
    safeProfile.visualStrategy?.moodKeywords,
    safeProfile.visualStrategy?.colorSystem,
    safeProfile.visualStrategy?.visualLanguage,
    safeProfile.targetSpace
  ].map(cleanPromptPart).filter(Boolean).join("；");
  const matched = [
    [/木|暖|家居|卧室|玄关|温馨|米白|奶油|布艺|自然/i, "warm-home"],
    [/白|浅灰|极简|清爽|留白|纯净/i, "white-minimal"],
    [/水泥|工业|混凝土|灰调/i, "cement-industrial"],
    [/走廊|过道|木饰面|柜体|长廊/i, "wood-corridor"],
    [/黑|深灰|科技|高对比|暗调|冷峻/i, "black-tech"]
  ].find(([pattern]) => pattern.test(strategyText));
  if (matched) return SMALL_LAMP_DETAIL_THEMES.find((item) => item.id === matched[1]) || SMALL_LAMP_DETAIL_THEMES[0];
  const index = hashIntFromText(smallLampDetailThemeKey(safeProfile, files, settings)) % SMALL_LAMP_DETAIL_THEMES.length;
  return SMALL_LAMP_DETAIL_THEMES[Math.max(0, index)];
}

const SMALL_LAMP_BACK_HARDWARE_PATTERN = /弹簧|卡扣|散热|鳍片|驱动|电线|连接线|线缆|背面|后盖|电源|端子|内部|电路|PCB/i;

function splitSmallLampPartText(value = "") {
  return String(value || "")
    .split(/[，,、；;。\n/]+/)
    .map((item) => cleanPromptPart(item))
    .filter(Boolean);
}

function smallLampPublicVisibleParts(profile = {}, { allowInstallHardware = false } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const source = [safeProfile.visibleParts, safeProfile.structureKeywords, safeProfile.requiredStructures]
    .map(cleanPromptPart)
    .filter(Boolean)
    .join("、");
  let parts = splitSmallLampPartText(source);
  if (!allowInstallHardware) {
    parts = parts.filter((item) => !SMALL_LAMP_BACK_HARDWARE_PATTERN.test(item));
  }
  const fallback = {
    "recessed-downlight": "面环、深杯/灯杯、小发光口和材质边缘",
    "surface-downlight": "短圆柱/方盒外露灯体、底部灯杯、小发光口和贴顶接触面",
    spotlight: "小灯头、灯杯、转轴/支架和发光口",
    "track-spotlight": "细窄导轨、连接点、小灯头和发光口",
    track: "导轨、小灯体模块、连接点和发光面",
    generic: "紧凑灯体、灯杯/面环、发光口和安装接触面"
  };
  return parts.filter((item, index, list) => list.indexOf(item) === index).join("、") || fallback[safeProfile.mountFamily] || fallback.generic;
}

function smallLampPublicStructureText(profile = {}, options = {}) {
  return smallLampPublicVisibleParts(profile, options);
}

function smallLampProductFactSupplement(profile = {}, options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const strategy = normalizeVisualStrategy(safeProfile, mountingSemantics(safeProfile), "small");
  const visibleParts = smallLampPublicVisibleParts(safeProfile, options);
  const materialText = cleanPromptPart(safeProfile.material).replace(/[（(][^）)]*(?:散热|鳍片|驱动|电线|背面|电源)[^）)]*[）)]/g, "");
  const colorText = cleanPromptPart(safeProfile.colorPalette).replace(/[（(][^）)]*(?:散热|鳍片|驱动|电线|背面|电源)[^）)]*[）)]/g, "");
  return [
    materialText ? `材质：${materialText}` : "",
    colorText ? `颜色：${colorText}` : "",
    cleanPromptPart(visibleParts) ? `可见结构：${cleanPromptPart(visibleParts)}` : "",
    cleanPromptPart(strategy.lightingEffect) ? `真实光效：${cleanPromptPart(strategy.lightingEffect)}` : "",
    cleanPromptPart(safeProfile.mountFamily) ? `安装族：${cleanPromptPart(safeProfile.mountFamily)}` : ""
  ].filter(Boolean).join("；") || "以上传图真实材质、颜色、可见结构、发光口和安装族为准";
}

function isExplicitProductFact(value = "") {
  const text = cleanPromptPart(value);
  if (!text) return false;
  if (/^(无|未知|不确定|未识别|未提供|以上传|以图片|以产品图|保留原始|灯具产品|灯具|现代商用产品图|电商商品图|装饰与功能照明)$/i.test(text)) return false;
  if (/以(?:上传|图片|产品图|实物|实际).*(?:为准|可见结构|真实结构)/.test(text)) return false;
  return true;
}

function firstExplicitProductFact(profile = {}, keys = []) {
  for (const key of keys) {
    const value = cleanPromptPart(profile?.[key]);
    if (isExplicitProductFact(value)) return value;
  }
  return "";
}

function smallLampTrustedMetricEvidence(profile = {}) {
  const safeProfile = profile || {};
  return {
    openingSize: firstExplicitProductFact(safeProfile, ["openingSize"]),
    beamAngle: firstExplicitProductFact(safeProfile, ["beamAngle"]),
    cct: firstExplicitProductFact(safeProfile, ["colorTemperature"]),
    cri: firstExplicitProductFact(safeProfile, ["cri"]),
    power: firstExplicitProductFact(safeProfile, ["power"]),
    voltage: firstExplicitProductFact(safeProfile, ["inputVoltage"]),
    ugr: firstExplicitProductFact(safeProfile, ["ugr"]),
    rg: firstExplicitProductFact(safeProfile, ["rgLevel"]),
    fpf: firstExplicitProductFact(safeProfile, ["fpf", "flicker"]),
    brand: firstExplicitProductFact(safeProfile, ["brandName"]),
    chip: firstExplicitProductFact(safeProfile, ["chipBrand"])
  };
}

function smallLampTextNeedsEvidence(text = "") {
  const value = String(text || "");
  return {
    size: /(?:\d+(?:\.\d+)?\s*(?:mm|cm|毫米|厘米)|灯高|高度|直径|开孔|尺寸)/i.test(value),
    beamAngle: /(?:光束角|束角|\d+\s*°)/i.test(value),
    cct: /(?:\d{3,4}\s*K|色温|暖白|自然光|冷白|三色)/i.test(value),
    cri: /(?:CRI|Ra|R9|Rf|显色指数|显指|高显色|高显指|\d{2,3}\s*显色)/i.test(value),
    power: /(?:\d+(?:\.\d+)?\s*W|功率)/i.test(value),
    voltage: /(?:\d+\s*V|AC\s*\d+|电压)/i.test(value),
    ugr: /(?:UGR|眩光值|防眩等级|≤\s*\d+|<\s*\d+)/i.test(value),
    rg: /(?:RG0|RG1|蓝光风险|低蓝光认证)/i.test(value),
    fpf: /(?:FPF|频闪|无频闪|防频闪|≤\s*0\.\d+\s*%)/i.test(value),
    brand: /(?:品牌|LOGO|YINGSHU|影束)/i.test(value),
    chip: /(?:芯片|普瑞|科锐|欧司朗|首尔)/i.test(value),
    planning: /(?:文案方向|文案|示例|参考|约\d|左右|待定|未确认)/i.test(value)
  };
}

function smallLampSanitizeEvidenceText(value = "", profile = {}, { maxItems = 8, maxLength = 10 } = {}) {
  const evidence = smallLampTrustedMetricEvidence(profile);
  const allow = {
    size: Boolean(evidence.openingSize),
    beamAngle: Boolean(evidence.beamAngle),
    cct: Boolean(evidence.cct),
    cri: Boolean(evidence.cri),
    power: Boolean(evidence.power),
    voltage: Boolean(evidence.voltage),
    ugr: Boolean(evidence.ugr),
    rg: Boolean(evidence.rg),
    fpf: Boolean(evidence.fpf),
    brand: Boolean(evidence.brand),
    chip: Boolean(evidence.chip)
  };
  return String(value || "")
    .split(/[，,、/；;。\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const needs = smallLampTextNeedsEvidence(item);
      if (needs.planning) return false;
      return Object.entries(allow).every(([key, permitted]) => !needs[key] || permitted);
    })
    .map((item) => cleanChineseOverlayText(item, { maxLength }))
    .filter((item) => item && /[\u4e00-\u9fa5]/.test(item))
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, Math.max(1, Number(maxItems) || 8))
    .join("、");
}

function smallLampTrustedSellingText(profile = {}) {
  const safeProfile = profile || {};
  return smallLampSanitizeEvidenceText(safeProfile.sellingPoint || safeProfile.sellingPoints || "", safeProfile, {
    maxItems: 3,
    maxLength: 8
  });
}

function smallLampTextEvidence(profile = {}) {
  const safeProfile = profile || {};
  return [
    safeProfile.productName,
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.material,
    safeProfile.colorPalette,
    safeProfile.visibleParts,
    safeProfile.structureKeywords,
    safeProfile.installationMethod,
    safeProfile.lightUse,
    safeProfile.sellingPoint,
    safeProfile.sellingPoints,
    safeProfile.hardConstraints,
    safeProfile.antiGlare,
    safeProfile.deepCup,
    safeProfile.adjustable,
    safeProfile.visualStrategy?.hardConstraints,
    safeProfile.visualStrategy?.lightingEffect,
    safeProfile.visualStrategy?.styleKeywords
  ].map(cleanPromptPart).filter(Boolean).join("；");
}

function smallLampHasEvidence(profile = {}, pattern) {
  return pattern.test(smallLampTextEvidence(profile));
}

function smallLampOpticalTraits(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const text = smallLampTextEvidence(safeProfile);
  const hasDeepCup = /深杯|深藏|黑杯|黑腔|防眩|遮光|蜂窝|格栅|UGR/i.test(text);
  const hasBlueLight = /低蓝光|护眼|RG0|RG1|蓝光|光生物|频闪|无频闪|FPF|防频闪/i.test(text);
  const hasColorRendering = /显色|还原色彩|CRI|Ra|R9|Rf|高显|色彩还原/i.test(text);
  const hasBeam = Boolean(firstExplicitProductFact(safeProfile, ["beamAngle"])) || /光束角|光束|光斑|洗墙|重点照明/i.test(text);
  const hasCct = Boolean(firstExplicitProductFact(safeProfile, ["colorTemperature"])) || /色温|三色|暖白|自然光|冷白|3000K|3500K|4000K|6000K/i.test(text);
  const explicitAdjustable = firstExplicitProductFact(safeProfile, ["adjustable"]);
  const adjustable = ["spotlight", "track-spotlight"].includes(safeProfile.mountFamily) ||
    Boolean(explicitAdjustable && /可调|转轴|旋转|摆角|调角|万向|tilt|rotate|adjust|true|yes/i.test(explicitAdjustable));
  return {
    hasDeepCup,
    hasBlueLight,
    hasColorRendering,
    hasBeam,
    hasCct,
    adjustable,
    explicitCri: firstExplicitProductFact(safeProfile, ["cri"]),
    explicitUgr: firstExplicitProductFact(safeProfile, ["ugr"]),
    explicitRg: firstExplicitProductFact(safeProfile, ["rgLevel"]),
    explicitFpf: firstExplicitProductFact(safeProfile, ["fpf", "flicker"]),
    explicitBeamAngle: firstExplicitProductFact(safeProfile, ["beamAngle"]),
    explicitCct: firstExplicitProductFact(safeProfile, ["colorTemperature"]),
    explicitPower: firstExplicitProductFact(safeProfile, ["power"]),
    explicitVoltage: firstExplicitProductFact(safeProfile, ["inputVoltage"]),
    explicitBrand: firstExplicitProductFact(safeProfile, ["brandName"]),
    explicitChip: firstExplicitProductFact(safeProfile, ["chipBrand"])
  };
}

function smallLampMaterialLabel(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = firstExplicitProductFact(safeProfile, ["material"]).replace(/[（(][^）)]*(?:散热|鳍片|驱动|电线|背面|电源)[^）)]*[）)]/g, "");
  const color = firstExplicitProductFact(safeProfile, ["colorPalette"]).replace(/[（(][^）)]*(?:散热|鳍片|驱动|电线|背面|电源)[^）)]*[）)]/g, "");
  const value = [material, color].filter(Boolean).join("，");
  return value || "产品本体材质与颜色";
}

function smallLampInstallLabel(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    "surface-downlight": "明装贴顶",
    "recessed-downlight": "嵌入安装",
    spotlight: "小射灯安装",
    "track-spotlight": "轨道连接",
    track: "轨道安装",
    generic: "真实安装"
  };
  const explicit = cleanPromptPart(firstExplicitProductFact(safeProfile, ["installationMethod"]));
  if (explicit && !SMALL_LAMP_BACK_HARDWARE_PATTERN.test(explicit)) return explicit;
  return map[safeProfile.mountFamily] || map.generic;
}

function smallLampOpticalLabel(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const traits = smallLampOpticalTraits(safeProfile);
  if (traits.hasDeepCup) return "控光防眩";
  if (traits.hasBeam) return traits.explicitBeamAngle ? `${traits.explicitBeamAngle}光束` : "清晰光斑";
  if (traits.adjustable) return "可调照射";
  return "柔和出光";
}

function smallLampDynamicLabels(profile = {}, { includeMetrics = false } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const traits = smallLampOpticalTraits(safeProfile);
  const labels = [
    smallLampOpticalLabel(safeProfile),
    firstExplicitProductFact(safeProfile, ["lampSubtype", "lampType"]).replace(/^灯具$/, "") || "小体量灯具",
    smallLampMaterialLabel(safeProfile),
    smallLampInstallLabel(safeProfile),
    traits.adjustable ? "角度可控" : "",
    traits.hasColorRendering ? (traits.explicitCri ? `显色${traits.explicitCri}` : "色彩自然") : "",
    traits.hasBlueLight ? (traits.explicitRg ? `${traits.explicitRg}护眼` : "舒适护眼") : "",
    traits.hasCct ? (traits.explicitCct || "光感可选") : ""
  ];
  if (includeMetrics) {
    labels.push(
      traits.explicitPower ? `功率${traits.explicitPower}` : "",
      traits.explicitVoltage ? `电压${traits.explicitVoltage}` : "",
      traits.explicitUgr ? `UGR${traits.explicitUgr}` : "",
      traits.explicitFpf ? `频闪${traits.explicitFpf}` : ""
    );
  }
  return labels
    .map((item) => cleanChineseOverlayText(item, { maxLength: 10 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function smallLampSpecEvidenceLine(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const traits = smallLampOpticalTraits(safeProfile);
  const specs = [
    firstExplicitProductFact(safeProfile, ["openingSize"]) ? `开孔/尺寸：${firstExplicitProductFact(safeProfile, ["openingSize"])}` : "",
    traits.explicitBeamAngle ? `光束角：${traits.explicitBeamAngle}` : "",
    traits.explicitCct ? `色温：${traits.explicitCct}` : "",
    traits.explicitCri ? `显色：${traits.explicitCri}` : "",
    traits.explicitPower ? `功率：${traits.explicitPower}` : "",
    traits.explicitVoltage ? `输入电压：${traits.explicitVoltage}` : "",
    traits.explicitUgr ? `防眩：${traits.explicitUgr}` : "",
    traits.explicitRg ? `蓝光风险：${traits.explicitRg}` : "",
    traits.explicitFpf ? `频闪：${traits.explicitFpf}` : "",
    traits.explicitBrand ? `品牌：${traits.explicitBrand}` : "",
    traits.explicitChip ? `芯片：${traits.explicitChip}` : ""
  ].filter(Boolean);
  return specs.length ? `可写入的已确认参数：${specs.join("；")}。` : "没有明确识别到的品牌、芯片、功率、电压、显色指数、UGR、RG0 或频闪数值时，只能做方向示意，不写具体数值和认证。";
}

function smallLampDynamicSlotMeta(slot = {}, profile = {}) {
  if (slot && slot._smallLampDynamicMetaApplied) return slot;
  const safeProfile = sanitizeRecognitionProfile(profile);
  const traits = smallLampOpticalTraits(safeProfile);
  const labels = smallLampDynamicLabels(safeProfile);
  const metricLabels = smallLampDynamicLabels(safeProfile, { includeMetrics: true });
  const material = smallLampMaterialLabel(safeProfile);
  const install = smallLampInstallLabel(safeProfile);
  const optical = smallLampOpticalLabel(safeProfile);
  const subtype = firstExplicitProductFact(safeProfile, ["lampSubtype", "lampType"]) || "小灯产品";
  const safeSellingText = smallLampTrustedSellingText(safeProfile);
  const patch = {};
  switch (String(slot.id || "")) {
    case "hero-atmosphere":
      patch.composition = [
        slot.composition,
        "画面可以像参考详情页场景图一样带克制黑色外边距或暗色留白，空间摄影真实、有纵深、有光斑；灯具只作为小灯位融入空间，单个灯位直径不要超过画面宽度约 4%；不是普通室内效果图，也不是卖点海报"
      ].filter(Boolean).join("；");
      patch.subjectFocus = "家装空间里的舒适光感、真实安装比例、墙面/地面光斑、居住氛围和套图第一张的高级感";
      break;
    case "product-mood":
      patch.allowedText = "";
      patch.composition = [
        slot.composition,
        "完整正面主体占画面高度约 45%-60%，四周保留克制留白，不裁切圆形面环，不做微距充满画面",
        safeProfile.mountFamily === "recessed-downlight"
          ? "嵌入式筒灯只呈现买家能看到的正面面环、深杯、发光口和材质光影"
          : "",
        safeProfile.mountFamily === "surface-downlight"
          ? "明装小灯呈现完整短圆柱/方盒外露灯体、底部灯杯和发光口，保持贴顶小体量的产品气质"
          : ""
      ].filter(Boolean).join("；");
      patch.subjectFocus = safeProfile.mountFamily === "recessed-downlight"
        ? "正面面环、深杯、发光口、材质边缘和克制光影气质"
        : "产品真实外形、核心材质、发光口、灯杯/反光杯和光影气质";
      patch.contentClaim = "产品本体气质和材质光影，不提前讲功能参数";
      break;
    case "hero-poster":
      patch.allowedText = [safeSellingText, optical, material, install].map(cleanPromptPart).filter(Boolean).join("、");
      patch.subjectFocus = `${subtype}的真实外形、${material}、发光口和首屏视觉定位`;
      break;
    case "material-closeup":
      patch.visualGoal = `${material}、边缘和发光口质感`;
      patch.allowedText = [material, "细节质感", "边缘工艺"].join("、");
      patch.subjectFocus = `产品外壳、${material}、边缘倒角和发光口细节`;
      patch.contentClaim = `${material}和边缘工艺证据`;
      break;
    case "core-advantages":
      patch.composition = "深黑/黑白克制详情页主视觉，像品牌购买理由总览页；单个完整产品主体或正面结构主体放左侧/下方，右侧保留大块暗色留白给后期信息层；允许细线分区和高级光影，不让模型生成文字、图标、卡片按钮、白底工程说明书、内部零件、多产品阵列或廉价信息图";
      patch.viewAngle = "高级产品摄影信息页，产品主体在左侧或下方，右侧暗色留白；不生成卡片文字";
      patch.allowedText = (safeProfile.mountFamily === "recessed-downlight"
        ? [optical, subtype, material, install, "柔和下照"]
        : metricLabels)
        .map((item) => smallLampSanitizeEvidenceText(item, safeProfile, { maxItems: 1, maxLength: 8 }))
        .filter(Boolean)
        .slice(0, 6)
        .join("、");
      patch.subjectFocus = `${(safeProfile.mountFamily === "recessed-downlight" ? [optical, "小体量", material, install] : labels).slice(0, 4).join("、")}等真实优势摘要`;
      break;
    case "anti-glare-cup":
      patch.title = traits.hasDeepCup ? "防眩控光" : "出光结构";
      patch.visualGoal = traits.hasDeepCup ? "防眩结构、遮光路径和舒适视觉" : "发光口、控光结构和舒适出光";
      patch.composition = "黑色或深灰背景的克制单卖点页，产品正面/深杯或一条墙面光斑作为主画面，少量中文标题和示意线；不要做白底安装说明、剖开内部结构或多主体拼图";
      patch.allowedText = traits.hasDeepCup ? "防眩控光、见光不刺眼、遮光更舒适" : "柔和出光、发光口清晰、光感舒适";
      patch.subjectFocus = traits.hasDeepCup ? "灯杯/反光杯、发光口位置、遮光角和眩光控制" : "发光口位置、控光边界和舒适光感";
      patch.contentClaim = traits.hasDeepCup ? "只讲防眩控光和遮光路径" : "只讲真实发光口和控光结构";
      break;
    case "size-install":
      patch.composition = "黑白克制的尺寸/安装信息页，薄线标注安装面、灯体高度/面环直径方向和接触关系；没有确认数据时不写数字；不做白底工程爆炸图，不露背部结构或内部零件特写";
      patch.allowedText = [install, "安装示意", "尺寸方向", ...metricLabels.filter((item) => /功率|电压|光束|色温|显色|UGR|频闪/.test(item))].slice(0, 6).join("、");
      patch.subjectFocus = `${install}、安装面、灯体高度/直径方向和固定关系`;
      patch.contentClaim = `${install}、尺寸方向和固定关系示意`;
      break;
    case "eye-care":
      patch.title = traits.hasBlueLight ? "护眼光感" : "舒适光感";
      patch.visualGoal = traits.hasBlueLight ? "低蓝光/低频闪等护眼光感表达" : "柔和不刺眼和舒适光感表达";
      patch.allowedText = traits.hasBlueLight ? [traits.explicitRg, traits.explicitFpf, "舒适护眼", "柔和不刺眼"].filter(Boolean).join("、") : "柔和不刺眼、舒适光感、减少压迫感";
      patch.subjectFocus = traits.hasBlueLight ? "已确认护眼信息、舒适光线和视觉疲劳降低" : "柔和光线、低眩感和舒适视觉体验";
      patch.contentClaim = traits.hasBlueLight ? "已确认护眼信息和舒适光感" : "舒适光感和低眩视觉体验";
      break;
    case "color-rendering":
      patch.title = traits.hasColorRendering ? "显色表现" : "色彩还原";
      patch.visualGoal = traits.hasColorRendering ? "显色表现和真实色彩还原" : "自然色彩还原和舒适光环境";
      patch.allowedText = traits.hasColorRendering ? [traits.explicitCri, "色彩自然", "还原真实色彩"].filter(Boolean).join("、") : "色彩自然、真实观感、舒适光环境";
      patch.subjectFocus = traits.hasColorRendering ? "显色信息、色彩还原能力和舒适光环境" : "自然色彩、真实观感和舒适光环境";
      patch.contentClaim = traits.hasColorRendering ? "显色和色彩还原示意" : "自然色彩还原示意";
      break;
    case "beam-spot":
      patch.allowedText = [traits.explicitBeamAngle ? `光束角${traits.explicitBeamAngle}` : "", "柔和光斑", "边缘自然"].filter(Boolean).join("、");
      patch.subjectFocus = `${traits.explicitBeamAngle ? `${traits.explicitBeamAngle}光束角、` : ""}光斑形状、光束方向、发光口和墙面照射效果`;
      break;
    case "cct-choice":
      patch.title = traits.hasCct ? "色温选择" : "光感选择";
      patch.visualGoal = traits.hasCct ? "色温方向和不同光感选择" : "不同使用氛围下的光感选择";
      patch.allowedText = traits.explicitCct || "暖调光感、自然光感、舒适氛围";
      patch.subjectFocus = traits.hasCct ? "不同色温带来的空间光感变化" : "不同空间氛围下的舒适光感变化";
      break;
    default:
      break;
  }
  if (safeProfile.mountFamily === "recessed-downlight" && (patch.composition || slot.composition)) {
    patch.composition = String(patch.composition || slot.composition || "")
      .replace(/按真实比例贴顶安装/g, "按真实比例嵌入吊顶开孔内，面环贴合天花")
      .replace(/真实比例贴顶安装/g, "真实比例嵌入吊顶开孔内，面环贴合天花")
      .replace(/贴顶安装/g, "嵌入吊顶开孔内，面环贴合天花")
      .replace(/真实贴顶比例/g, "真实面环贴合比例")
      .replace(/贴顶近景/g, "天花近景")
      .replace(/贴顶特写/g, "天花特写");
  }
  return { ...slot, ...patch, _smallLampDynamicMetaApplied: true };
}

function smallLampSuiteContext(profile = {}, sequence = [], suiteTheme = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const themeLine = [
    suiteTheme?.name ? `统一主题：${suiteTheme.name}` : "",
    suiteTheme?.line || "",
    suiteTheme?.textTone ? `文字气质：${suiteTheme.textTone}` : ""
  ].filter(Boolean).join("；");
  const categoryTotals = sequence.reduce((map, slot) => {
    const category = String(slot.category || "");
    map[category] = (map[category] || 0) + 1;
    return map;
  }, {});
  return {
    themeId: suiteTheme?.id || "",
    themeName: suiteTheme?.name || "",
    themeLine,
    productFacts: smallLampProductFactSupplement(safeProfile),
    visualSystem: "套图一致性：13 张必须像同一套详情页，统一黑白克制版式、外边距/留白、字体气质、光影色温、产品颜色、镜头语言和信息层级；允许内容分工不同，但不能像不同模板拼在一起。",
    story: "详情页叙事线：首屏家装氛围建立第一印象，随后回到产品气质，再用单卖点、功能证据、真实家装场景、局部细节和实拍可信度逐步展开。",
    categoryTotals
  };
}

function smallLampUnifiedSuiteStyleLine(profile = {}, suiteTheme = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = smallLampMaterialLabel(safeProfile) || cleanPromptPart(safeProfile.material || safeProfile.colorPalette || "");
  const source = [
    safeProfile.material,
    safeProfile.color,
    safeProfile.colorPalette,
    safeProfile.finish,
    safeProfile.style,
    safeProfile.visibleParts,
    safeProfile.lampSubtype,
    safeProfile.mountFamily
  ].map((item) => String(item || "")).join(" ");
  let palette = "黑白克制、浅灰文字、深浅留白";
  if (/拉丝|不锈钢|银|金属|铝|brushed|steel|metal/i.test(source + material) && /黑|哑黑|雅黑|black/i.test(source)) palette = "银黑金属、黑白底色、中性光影";
  else if (/拉丝|不锈钢|银|金属|铝|brushed|steel|metal/i.test(source + material)) palette = "金属微光、黑白底色、冷暖中性光";
  else if (/黑|哑黑|雅黑|black/i.test(source)) palette = "哑黑产品、深灰空间、浅灰文字";
  else if (/白|喷涂|white/i.test(source)) palette = "白色产品、浅灰空间、黑白文字";
  else if (/木|wood/i.test(source)) palette = "木质暖调、黑白克制、自然柔光";
  const mountMap = {
    "recessed-downlight": "嵌入轻薄，只露面环和发光口",
    "surface-downlight": "贴顶短体量，完整外露轮廓",
    spotlight: "小射灯聚光，角度感克制",
    "track-spotlight": "细轨道连接，灯头小比例",
    track: "细轨道线条，小灯模块"
  };
  const form = mountMap[safeProfile.mountFamily] || "保持识别到的小灯结构";
  const theme = cleanPromptPart(suiteTheme?.name || "黑白克制详情套图");
  return `套图风格锁：${theme}；统一${palette}、${material || "真实材质"}、${form}；黑白克制、留白细线；只换内容，不换摄影和排版。`;
}

function smallLampSlotStoryBeat(slot = {}, index = 0) {
  return slot.storyBeat || `详情页第 ${index + 1} 张内容分工`;
}

function smallLampSlotContentClaim(slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const dynamicSlot = smallLampDynamicSlotMeta(slot, safeProfile);
  return cleanPromptPart(dynamicSlot.contentClaim || dynamicSlot.subjectFocus || safeProfile.structureKeywords || safeProfile.visibleParts || "本张独立内容证据");
}

function smallLampSlotViewAngle(slot = {}, category = "") {
  return cleanPromptPart(slot.viewAngle || smallLampDetailViewMode(slot, category));
}

function smallLampAvoidRepeatLine(slot = {}, sequence = [], index = 0) {
  const usedBefore = sequence
    .slice(0, index)
    .map((item) => item.contentClaim || item.subjectFocus || item.title)
    .map(cleanPromptPart)
    .filter(Boolean)
    .slice(-3);
  const base = cleanPromptPart(slot.forbiddenOverlap);
  const before = usedBefore.length ? `避免重复前面已讲内容：${usedBefore.join("、")}。` : "";
  return [before, base ? `本张防重复：${base}。` : ""].filter(Boolean).join(" ");
}

const SMALL_LAMP_DETAIL_SEQUENCE = [
  {
    id: "hero-poster",
    category: "selling",
    title: "详情页品视觉",
    visualGoal: "详情页首屏品视觉，建立产品第一眼识别、品牌感留白和核心材质/光效气质",
    composition: "电商详情页主视觉构图：单个主产品清晰、有品牌感留白和高级产品摄影质感；可使用轻空间或质感背景服务产品气质，但不能变成纯场景图、功能卡片、技术说明页或近景结构页",
    allowedText: "根据识别到的产品风格、核心卖点、材质、光效和安装优势生成少量简体中文短句",
    subjectFocus: "产品真实外形、核心材质、发光口、灯杯/反光杯和首屏视觉定位",
    storyBeat: "首屏建立产品第一印象",
    contentClaim: "品视觉首屏，只建立产品气质和第一购买印象",
    viewAngle: "主产品三分构图或轻微俯视产品摄影，背景只做气质衬托",
    forbiddenOverlap: "不要做参数表、爆炸结构、检测室、功能卡片合集、产品拆解或与识别视觉策略无关的固定风格套图"
  },
  {
    id: "material-closeup",
    category: "detail",
    title: "材质特写",
    visualGoal: "拉丝金属、边缘、灯杯质感",
    composition: "微距或近景产品摄影，只看局部材质和边缘工艺，背景干净克制",
    allowedText: "银色拉丝、金属质感、细腻边缘等短标签",
    subjectFocus: "灯体外壳、拉丝纹理、边缘倒角和黑色灯杯",
    storyBeat: "证明材质和工艺可信度",
    contentClaim: "材质纹理和边缘工艺证据",
    viewAngle: "微距或近景局部摄影，浅景深，背景干净",
    forbiddenOverlap: "不要重复讲防眩、安装参数、护眼光谱或空间场景"
  },
  {
    id: "core-advantages",
    category: "function",
    title: "核心优势",
    visualGoal: "短标签优势总览，不写参数",
    composition: "完整产品主体保持上传结构，周围 4-6 个简体中文短标签卡片；只做清晰卖点总览，不使用伪图表或抽象图标拼贴",
    allowedText: "深杯防眩、小体量、银色拉丝、明装固定、柔和光斑、高显色",
    subjectFocus: "优势摘要和购买理由总览",
    storyBeat: "建立核心优势信息层级",
    contentClaim: "3-4 个真实优势标签总览",
    viewAngle: "正面信息页，产品主体加固定卡片布局",
    forbiddenOverlap: "不要写完整规格表、尺寸图、光谱长图、色温功率表或无依据数字"
  },
  {
    id: "anti-glare-cup",
    category: "selling",
    title: "深杯防眩",
    visualGoal: "深杯、遮光、见光不见灯",
    composition: "完整产品或底部深杯的克制单卖点页，重点表现深杯遮光路径和舒适视觉，可用一条简洁光束/遮光示意线",
    allowedText: "深杯防眩、见光不见灯、遮光更舒适",
    subjectFocus: "深杯黑腔、发光口位置、遮光角和眩光控制",
    storyBeat: "展开最核心单卖点",
    contentClaim: "只讲深杯防眩和遮光路径",
    viewAngle: "产品底部深杯近中景或局部示意",
    forbiddenOverlap: "不要做核心优势总览，不要写尺寸安装参数，不要变成实验室拆件图，不要眼球剖面、随机光谱、空气/眼睛/增长图标或无意义符号"
  },
  {
    id: "home-install-scene",
    category: "scene",
    title: "真实安装场景",
    visualGoal: "真实空间布灯，美感优先",
    composition: "正常层高的完整连续家居空间，中远景或正常人眼视角，能看到地面、完整墙面、窗/门洞和家具，天花只占画面上方一小部分，1-2 个可辨认灯位服务空间构图",
    allowedText: "",
    subjectFocus: "真实空间尺度、自然安装比例、墙面或地面光斑和居住氛围",
    storyBeat: "进入真实家居应用",
    contentClaim: "客餐厅或书房的真实安装比例和居住氛围",
    viewAngle: "正常人眼中远景，正向或轻侧向，保留地面、墙面、家具和窗/门洞",
    forbiddenOverlap: "不要满天花复制、随机散布、多个同等清晰主体、密集灯阵、低矮水泥盒子或贴顶近景"
  },
  {
    id: "product-shoot",
    category: "real",
    title: "产品实拍",
    visualGoal: "产品实物拍摄感，不做信息图",
    composition: "真实摄影棚或桌面实拍质感，单个产品主体，浅景深、自然阴影、可信材质",
    allowedText: "",
    subjectFocus: "实物外观、材质、透视和真实拍摄可信度",
    storyBeat: "建立实拍可信度",
    contentClaim: "单个产品实物摄影可信度",
    viewAngle: "桌面或摄影棚 45 度实拍视角",
    forbiddenOverlap: "不要做卖点海报、功能卡片、参数表、安装场景或拆解图"
  },
  {
    id: "size-install",
    category: "function",
    title: "尺寸安装",
    visualGoal: "安装关系和尺寸示意，不重复优势",
    composition: "干净的尺寸/安装信息页，使用简洁线条说明安装面和接触关系，不拆散产品",
    allowedText: "明装固定、贴顶安装、尺寸示意、安装面等短标签；无可靠数据时不写具体数值",
    subjectFocus: "顶部接触面、安装方式、灯体高度/直径方向和固定关系",
    storyBeat: "说明安装关系",
    contentClaim: "安装面、尺寸方向和固定关系示意",
    viewAngle: "干净信息页，产品主体配少量线条示意",
    forbiddenOverlap: "不要重复核心优势卡片，不要写电压功率频率，不要编造尺寸数字"
  },
  {
    id: "eye-care",
    category: "function",
    title: "低蓝光护眼",
    visualGoal: "护眼光感和低蓝光表达",
    composition: "护眼科普感图形页，用柔和光线、简洁光谱色带或舒适空间光感表达，配少量简体中文标签",
    allowedText: "低蓝光护眼、柔和不刺眼、舒适光感",
    subjectFocus: "光线舒适、视觉疲劳降低和安全光感",
    storyBeat: "补充舒适光感价值",
    contentClaim: "舒适光感和低眩视觉体验",
    viewAngle: "柔和光感图形页或局部空间光感",
    forbiddenOverlap: "不要写任何英文缩写，不要重复显色光谱页，不要眼球解剖图、随机箭头、伪认证图标或无标签曲线"
  },
  {
    id: "color-rendering",
    category: "function",
    title: "显色光谱",
    visualGoal: "色彩还原和显色表现",
    composition: "显色/光谱视觉页，用彩色条、自然物体色彩对比或简洁色彩还原示意表现真实色彩，必须有简体中文标签",
    allowedText: "高显色、还原真实色彩、色彩自然",
    subjectFocus: "色彩还原能力和舒适光环境",
    storyBeat: "补充色彩还原价值",
    contentClaim: "显色和色彩还原示意",
    viewAngle: "色彩对比或色条信息页，中文标签清楚",
    forbiddenOverlap: "不要讲低蓝光护眼，不要写无依据显色指数数字，不要出现英文缩写，不要无意义曲线和随机图标"
  },
  {
    id: "beam-spot",
    category: "detail",
    title: "光束光斑",
    visualGoal: "墙面光斑、柔和边缘和照射范围",
    composition: "墙面或地面光斑细节，突出光束边缘、照射范围和发光口关系",
    allowedText: "柔和光斑、光束角、边缘自然",
    subjectFocus: "光斑形状、光束方向、发光口和墙面照射效果",
    storyBeat: "证明实际出光效果",
    contentClaim: "墙面或地面光斑边缘与照射范围",
    viewAngle: "墙面/地面光斑局部侧向视角",
    forbiddenOverlap: "不要做显色光谱、尺寸安装或核心优势卡片"
  },
  {
    id: "install-detail",
    category: "detail",
    title: "安装局部",
    visualGoal: "安装面、接触关系和关键连接结构",
    composition: "闭合安装后的接触面局部近景，展示灯体贴合天花、顶部边缘或固定接触关系，不打开吊顶，不露线，不做内部拆解",
    allowedText: "安装局部、接触面、稳固结构",
    subjectFocus: "安装接触面、顶部边缘、贴顶关系和一处可信固定细节",
    storyBeat: "补充安装可信证据",
    contentClaim: "安装接触关系和固定结构证据",
    viewAngle: "局部近景，只看闭合后的一个安装证据",
    forbiddenOverlap: "不要重复材质纹理、光斑、核心优势或完整空间场景；不要打开天花、露出电线端子、内部电路板或爆炸零件"
  },
  {
    id: "corridor-scene",
    category: "scene",
    title: "走廊应用",
    visualGoal: "走廊、玄关或柜体空间应用",
    composition: "正常层高的走廊/玄关/柜体空间，使用远景透视，画面有地面、门洞或柜体尺度参照，2-3 个小灯位沿真实动线有节奏排列",
    allowedText: "",
    subjectFocus: "走廊纵深、空间层次、灯位节奏、见光不见灯和真实安装比例",
    storyBeat: "展示动线空间应用",
    contentClaim: "走廊纵深和有节奏灯位",
    viewAngle: "走廊纵深远景透视，灯位沿真实动线排列",
    forbiddenOverlap: "不要满天花散点、随机复制、整排过密、多个前景放大主体或贴着天花拍摄"
  },
  {
    id: "arrival-real",
    category: "real",
    title: "到货实拍",
    visualGoal: "到货或桌面实拍质感",
    composition: "自然桌面或材质表面上的到货实拍感，单个产品，轻微真实阴影",
    allowedText: "",
    subjectFocus: "真实质感、产品边缘、发光口和可触摸材质",
    storyBeat: "模拟用户收到产品",
    contentClaim: "到货桌面质感和可触摸细节",
    viewAngle: "自然桌面手机实拍感，轻微阴影",
    forbiddenOverlap: "不要做参数页、场景安装、光谱图或卖点海报"
  },
  {
    id: "design-aesthetic",
    category: "selling",
    title: "设计美学",
    visualGoal: "极简小灯美学和空间适配",
    composition: "正常层高现代空间的局部远景或克制设计海报，能看到墙面、地面、窗/门洞或家具尺度，空间留白舒展，产品按真实安装比例融入空间",
    allowedText: "极简设计、克制美学、适配现代空间",
    subjectFocus: "空间适配、产品轮廓、比例、材质和现代空间气质",
    storyBeat: "收束到设计适配",
    contentClaim: "产品轮廓与现代空间适配",
    viewAngle: "局部远景或克制设计海报，空间留白舒展",
    forbiddenOverlap: "不要重复首屏场景，不要做功能参数卡片、检测室风格或天花近景主体"
  },
  {
    id: "cct-choice",
    category: "function",
    title: "色温选择",
    visualGoal: "色温方向和不同光感选择",
    composition: "统一主题下的色温对比页，用暖白/自然光等简体中文标签表达，不写无依据功率",
    allowedText: "暖白光、自然光、色温可选、舒适光感",
    subjectFocus: "不同色温带来的空间光感变化",
    storyBeat: "补充可选光感",
    contentClaim: "色温选择和空间光感差异",
    viewAngle: "统一主题下的色温对比信息页",
    forbiddenOverlap: "不要写功率、电压、频率，不要重复护眼或显色光谱"
  },
  {
    id: "entry-scene",
    category: "scene",
    title: "入户玄关",
    visualGoal: "入户、玄关或过道家装应用",
    composition: "正常层高的住宅入户、玄关或过道完整空间，正常人眼平视中远景，天花只占上方 12%-18%，能看到地面、墙面、柜体、门洞或换鞋凳等完整竖向尺度；1-2 个小灯位服务入户光感",
    allowedText: "",
    subjectFocus: "入户空间尺度、家装光感、真实灯位比例和合理布灯",
    storyBeat: "拓展到入户玄关应用",
    contentClaim: "入户或玄关的舒展层高和真实照明",
    viewAngle: "正常人眼平视中远景，地面/墙面/门洞尺度清楚",
    forbiddenOverlap: "不要非住宅公区语境、密集灯阵、满天花复制、多个同等清晰主体、低矮通道或贴顶近景"
  },
  {
    id: "cabinet-scene",
    category: "scene",
    title: "柜体玄关",
    visualGoal: "柜体、玄关或局部墙面的重点照明应用",
    composition: "正常层高的玄关、柜体或局部墙面空间，使用侧向或斜向视角，能看到柜体、墙面、地面或门洞尺度，1-2 个小灯位服务局部重点照明",
    allowedText: "",
    subjectFocus: "柜体/玄关局部、重点照明、墙面光斑和真实安装比例",
    storyBeat: "展示局部重点照明应用",
    contentClaim: "柜体或玄关局部重点照明",
    viewAngle: "局部侧向或斜向视角，不同于客餐厅和走廊",
    forbiddenOverlap: "不要重复客餐厅中远景、走廊纵深、非住宅公区语境或贴顶近景"
  }
];

const SMALL_LAMP_RESIDENTIAL_DETAIL_SEQUENCE = [
  {
    id: "hero-atmosphere",
    category: "scene",
    title: "家装氛围首屏",
    visualGoal: "家装空间氛围首屏，先建立光感、居住感和产品第一印象",
    composition: "真实住宅空间封面，平视中远景，天花约12%-18%，下方保留地面/家具；首屏仅1个小灯位，单灯≤画面宽2%，只作天花小点，不做放大产品主体",
    allowedText: "舒适光感、精致小灯、家装适配",
    subjectFocus: "家装空间里的舒适光感、真实安装比例、墙面/地面光斑和居住氛围",
    storyBeat: "首屏先给空间氛围和第一眼质感",
    contentClaim: "家装空间氛围首屏，可有少量简体中文标题，无参数，只建立居住光感和产品气质",
    viewAngle: "入口平视中远景，保留地面、墙面、家具、窗/门洞",
    forbiddenOverlap: "不要做卖点图、功能卡片、参数表、检测室或非住宅公区语境"
  },
  {
    id: "living-room-scene",
    category: "scene",
    title: "客厅场景",
    visualGoal: "真实客厅/餐厅家装应用",
    composition: "正常层高的客厅或餐厅家装空间，正常人眼平视中远景，天花只占画面上方 12%-18%，下方 30%-40% 能看到地面/地毯/家具底部，完整墙面、窗/门洞、沙发/餐桌等尺度参照清楚；1-2 个小灯按真实比例安装，光斑自然服务空间",
    allowedText: "",
    subjectFocus: "客餐厅空间尺度、真实贴顶比例、舒适光感和墙面/地面光斑",
    storyBeat: "展示主要家装生活场景",
    contentClaim: "客餐厅真实安装比例和居住氛围",
    viewAngle: "正常人眼平视中远景，保留更多地面、完整墙面、家具和窗/门洞竖向尺度",
    forbiddenOverlap: "不要非住宅公区语境、满天花复制、贴顶近景或多主体灯阵"
  },
  {
    id: "product-mood",
    category: "main",
    title: "产品气质",
    visualGoal: "产品主体和材质光影，承接首屏氛围",
    composition: "单个产品的高级摄影页，中景或中近景，产品完整但不做微距，使用真实材质台面、家装背景或克制深浅背景；保留完整正面主体比例、材质、发光口和阴影；不加文字，不做功能卡片、参数图或结构拆解",
    allowedText: "",
    subjectFocus: "产品真实外形、核心材质、发光口、灯杯/反光杯和光影气质",
    storyBeat: "从家装氛围回到产品本体",
    contentClaim: "产品本体气质和材质光影",
    viewAngle: "完整产品中景摄影，浅景深，主体清晰但不做局部大裁切或贴脸特写",
    forbiddenOverlap: "不要重复首屏空间，不要做参数、尺寸、护眼、显色、安装结构或多卖点合集"
  },
  {
    id: "bedroom-study-scene",
    category: "scene",
    title: "卧室书房",
    visualGoal: "卧室、书房或休闲角落的家装氛围",
    composition: "正常层高的卧室、书房或休闲角落，正常人眼平视中远景或轻侧向视角，天花只占上方 12%-18%，下方保留床/书桌/椅子、墙面、窗帘、地面等完整家装尺度；1 个主灯位或 1-2 个弱化灯位，光线柔和克制",
    allowedText: "",
    subjectFocus: "卧室/书房的柔和光感、真实灯位比例、安静居住氛围",
    storyBeat: "补充安静私宅空间应用",
    contentClaim: "卧室或书房柔和家装氛围",
    viewAngle: "正常住宅平视中远景或轻侧向视角，灯具不贴镜头，空间先成立",
    forbiddenOverlap: "不要非住宅公区语境、陈列台面、贴顶特写或密集灯阵"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "core-advantages"),
    allowedText: "控光防眩、小体量、真实安装比例、材质质感、柔和光斑",
    composition: "单页核心优势图，使用产品中景、局部空间光感和少量简体中文标签组织，产品主体约占画面18%-30%，完整外轮廓和周围留白清楚，保持中景留白和舒适阅读节奏",
    forbiddenOverlap: "不要写完整规格表、尺寸图、光谱长图、色温功率表或无依据数字；只保持住宅家装语境"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "anti-glare-cup"),
    composition: "防眩控光页用中景产品和墙面/桌面柔和光斑说明出光舒适，不做镜头贴近灯杯的超大微距，不展示背部散热或内部零件"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "size-install"),
    composition: "尺寸安装页用中景产品、安装面示意和少量中文标签说明安装关系；不做贴顶近景、拆解、爆炸图或内部结构图"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "corridor-scene"),
    title: "玄关走廊",
    visualGoal: "玄关、走廊或过道家装应用",
    contentClaim: "玄关走廊纵深和有节奏灯位",
    forbiddenOverlap: "不要满天花散点、随机复制、整排过密、多个前景放大主体、贴着天花拍摄或非住宅公区走廊"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "cabinet-scene"),
    title: "柜体玄关",
    visualGoal: "柜体、玄关或局部墙面的家装重点照明",
    composition: "正常层高的玄关、柜体或局部墙面空间，侧向或斜向平视中远景，保留柜体、墙面、地面或门洞尺度，1-2 个小灯位服务局部重点照明"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "beam-spot"),
    composition: "光束光斑页以墙面、地面或台面的真实落光为主，产品只作为小比例光源或不必大幅出现，不做灯杯超大近景"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "product-shoot"),
    composition: "产品实拍页用中景完整产品，真实桌面或家装材质背景，产品完整可触摸，不做微距局部裁切"
  },
  {
    ...SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "material-closeup"),
    composition: "唯一材质细节页，只允许一个中近景局部证明材质和边缘工艺，局部占画面约22%-36%，必须看到完整灯口外轮廓和周围背景留白，避免微距贴脸、超大灯杯占满画面或裁掉关键结构"
  },
  SMALL_LAMP_DETAIL_SEQUENCE.find((slot) => slot.id === "arrival-real")
].filter(Boolean);

function smallLampDetailSequenceCatalog() {
  return SMALL_LAMP_RESIDENTIAL_DETAIL_SEQUENCE;
}

function smallLampDetailSuiteRequested(settings = {}, userRequirement = "") {
  const text = cleanPromptPart([
    userRequirement,
    settings?.layout,
    settings?.requirement,
    settings?.prompt,
    settings?.detailMode
  ].filter(Boolean).join("；"));
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  return Boolean(settings.smallLampFullDetailSuite) || /13\s*张|十三张|完整\s*13\s*张|完整十三张|全套\s*13|13\s*张\s*(?:详情页|详情图组|详情套图|套图)|完整链路/.test(text);
}

function smallLampFullDetailCounts(counts = {}) {
  const current = normalizeCounts(counts);
  const total = totalCountFromServerCounts(current);
  if (total >= SMALL_LAMP_RESIDENTIAL_DETAIL_SEQUENCE.length) return current;
  return {
    ...current,
    main: 1,
    selling: 1,
    function: 2,
    scene: 4,
    detail: 3,
    real: 2
  };
}

function smallLampDetailFamilyCopy(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = cleanPromptPart(safeProfile.material) || cleanPromptPart(safeProfile.colorPalette) || "真实金属/灯体材质";
  const common = {
    productForm: "小体量灯体、发光口、安装接触面",
    material,
    antiGlare: "深藏光源、防眩结构和舒适出光",
    install: "真实安装面和接触关系",
    specs: "尺寸、色温、显色、光束角等规格信息方向；只有参考图或识别结果明确时才写具体数值",
    beam: "清晰光束角、自然光斑和照射范围",
    sceneInstall: "按真实小灯比例安装在对应空间里"
  };
  const map = {
    "surface-downlight": {
      productForm: "贴顶圆柱灯体、顶部接触面、底部深杯发光口",
      material: material || "铝/不锈钢拉丝质感",
      antiGlare: "深杯防眩、遮光角和见光不见灯效果",
      install: "明装式螺丝固定、贴顶安装和顶部接触面",
      specs: "大号/小号尺寸、明装固定、深杯防眩、铝材灯体和光束角方向；不要编造输入电压或功率数值",
      beam: "墙面暖色光斑、36度光束角和柔和边缘",
      sceneInstall: "小圆柱贴顶安装在天花上，不悬空、不放大成主灯"
    },
    "recessed-downlight": {
      productForm: "嵌入式筒灯/射灯的齐平面环、吊顶开孔、深杯/灯杯和小发光口",
      material,
      antiGlare: "深杯/灯杯遮光、低眩光、聚光光斑和开孔内隐藏光源",
      install: "嵌入式开孔安装、面环贴合吊顶，灯体主体藏进吊顶内",
      specs: "开孔尺寸、面环直径、色温、显色和光束角方向；不要编造功率或电压数值",
      beam: "从开孔内自然下射的柔和光束和均匀光斑",
      sceneInstall: "嵌入吊顶开孔内，只露出更小的面环、深杯/灯杯和发光口，场景视觉尺寸再小 25%，不出现明装外露筒身"
    },
    spotlight: {
      productForm: "小灯头、灯杯、转轴支架和可调照射方向",
      material,
      antiGlare: "深杯控光、重点照明和不直射眼睛",
      install: "支架/转轴连接安装面，角度可调",
      specs: "可调角度、光束角、色温、显色和安装方式；不要编造功率或电压数值",
      beam: "洗墙光斑、重点照明方向和可调投射范围",
      sceneInstall: "以小射灯比例安装在天花、墙面或轨道附近"
    },
    "track-spotlight": {
      productForm: "导轨、卡扣/磁吸连接、小灯头和转轴结构",
      material,
      antiGlare: "深杯控光、轨道重点照明和低眩光",
      install: "沿导轨卡扣或磁吸安装，灯体必须连接轨道",
      specs: "导轨连接方式、可调角度、光束角、色温和显色；不要编造功率或电压数值",
      beam: "沿轨道调整方向后的重点光斑和墙面洗光",
      sceneInstall: "小灯头连接在导轨上，不脱离轨道、不漂浮"
    },
    track: {
      productForm: "导轨/磁吸轨道、灯体模块、卡扣连接点和发光模块",
      material,
      antiGlare: "模块化控光、低眩光和均匀布光",
      install: "灯体模块沿轨道安装，连接点清晰",
      specs: "轨道规格、模块比例、色温、显色和安装方式；不要编造功率或电压数值",
      beam: "轨道模块形成的连续或重点照明效果",
      sceneInstall: "灯体沿轨道保持真实小模块比例"
    }
  };
  return { ...common, ...(map[safeProfile.mountFamily] || {}) };
}

function smallLampDetailArchetype(category = "", categoryIndex = 1) {
  const options = {
    selling: [
      { id: "hero", title: "首屏场景", goal: "做一张接近参考套图首图的详情页首屏场景，展示小灯安装后的高级空间感和产品第一印象" },
      { id: "anti-glare", title: "防眩卖点", goal: "围绕防眩深杯、遮光结构和舒适视觉体验做单一购买理由图" },
      { id: "design", title: "设计美学", goal: "表达极简小灯美学、克制造型和现代空间适配性" }
    ],
    function: [
      { id: "advantages", title: "核心优势", goal: "做多卡片功能图，展示防眩、小体量、材质、显色、色温、光束角等优势" },
      { id: "specs", title: "规格参数", goal: "做参数信息图，展示尺寸、安装、功率、色温、显色、材质和光束角" },
      { id: "eye-care", title: "低蓝光护眼", goal: "做护眼科普图，表现低蓝光、安全光谱和减少视觉疲劳" },
      { id: "color-rendering", title: "高显色光谱", goal: "做显色/光谱图，表现高显色、真实还原色彩和舒适光环境" },
      { id: "cct-power", title: "色温功率", goal: "做色温/功率组合图，展示3000K、3500K、4000K或三色变光等可选方向" }
    ],
    scene: [
      { id: "home-install", title: "真实安装场景", goal: "做完整连续的家居安装场景，展示小灯真实比例、安装面和自然光斑" },
      { id: "corridor", title: "走廊应用", goal: "做走廊、玄关或柜体空间应用图，突出见光不见灯和空间层次" },
      { id: "living-dining", title: "客餐厅应用", goal: "做客厅、餐厅或开放式空间应用图，展示 1-2 个有秩序的小灯位，不放大产品主体" },
      { id: "entry", title: "入户玄关", goal: "做入户、玄关或过道家装应用图，突出正常层高、完整墙面地面尺度和柔和重点照明" }
    ],
    detail: [
      { id: "material", title: "材质特写", goal: "做微距材质特写，展示金属纹理、边缘、灯杯和发光口细节" },
      { id: "beam", title: "光束光斑", goal: "做光束角/光斑细节图，展示墙面光斑、柔和边缘和照射范围" },
      { id: "structure", title: "结构细节", goal: "做安装结构或剖面细节图，说明接触面、连接方式和发光结构" }
    ],
    real: [
      { id: "product-shoot", title: "产品实拍", goal: "做真实产品实拍图，背景自然、镜头浅景深、产品材质可信" },
      { id: "arrival", title: "到货质感", goal: "做到货/桌面实拍感图片，保留自然阴影和轻微真实拍摄质感" }
    ]
  };
  const list = options[category] || options.selling;
  return list[(Math.max(1, Number(categoryIndex) || 1) - 1) % list.length];
}

function smallLampDetailSequenceTotal(counts = {}, shots = [], options = {}) {
  const sequence = smallLampDetailSequenceCatalog();
  if (options.forceFullSuite) return sequence.length;
  const total = totalCountFromServerCounts(counts) || shots.length || 13;
  return Math.max(1, Math.min(sequence.length, Math.floor(Number(total) || 13)));
}

function smallLampDetailSequenceSlice(counts = {}, shots = [], options = {}) {
  return smallLampDetailSequenceCatalog().slice(0, smallLampDetailSequenceTotal(counts, shots, options));
}

function smallLampDetailSlotsForCategory(category = "") {
  return smallLampDetailSequenceCatalog().filter((slot) => slot.category === category);
}

function smallLampDetailSlotForCategory(category = "", categoryIndex = 1, fallbackIndex = 0) {
  const slots = smallLampDetailSlotsForCategory(category);
  if (slots.length) return slots[(Math.max(1, Number(categoryIndex || 1)) - 1) % slots.length];
  const sequence = smallLampDetailSequenceCatalog();
  const fallback = sequence[fallbackIndex % sequence.length] || sequence[0];
  return { ...fallback, category };
}

function smallLampDetailSequenceForShots(counts = {}, shots = [], options = {}) {
  const sourceShots = Array.isArray(shots) && shots.length
    ? shots
    : productPlanTargetShots(counts);
  if (!options.forceFullSuite) {
    const current = Object.fromEntries(SHOT_CATEGORY_KEYS.map((key) => [key, Math.max(0, Number(counts?.[key] || 0))]));
    const total = totalCountFromServerCounts(current) || sourceShots.length || 0;
    const catalog = smallLampDetailSequenceCatalog();
    if (total > 0 && total < catalog.length) {
      const selected = [];
      const used = new Set();
      const addSlot = (slot) => {
        if (!slot || used.has(slot.id)) return false;
        selected.push(slot);
        used.add(slot.id);
        return true;
      };
      const addCategory = (category, count, preferredIds = []) => {
        let remaining = Math.max(0, Number(count || 0));
        preferredIds.forEach((id) => {
          if (remaining > 0 && addSlot(catalog.find((slot) => slot.id === id))) remaining -= 1;
        });
        for (const slot of catalog) {
          if (remaining <= 0) break;
          if (slot.category === category && addSlot(slot)) remaining -= 1;
        }
      };
      addCategory("scene", current.scene, ["hero-atmosphere"]);
      addCategory("function", current.function, ["core-advantages"]);
      addCategory("detail", current.detail, ["material-closeup"]);
      addCategory("selling", current.selling, ["hero-poster"]);
      addCategory("main", current.main, ["product-mood"]);
      addCategory("real", current.real, ["product-shoot"]);
      for (const slot of catalog) {
        if (selected.length >= total) break;
        addSlot(slot);
      }
      return selected.slice(0, total);
    }
  }
  return smallLampDetailSequenceSlice(counts, sourceShots, options);
}

function smallLampDetailIsSpatialSlot(slot = {}, category = "") {
  return String(category || slot.category || "") === "scene" || SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(String(slot.id || ""));
}

function smallLampDetailInstallAngleLine(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    "recessed-downlight": "嵌入式垂直下照，只露面环/深杯/灯杯/小发光口",
    "surface-downlight": "明装贴顶垂直下照，短灯体贴合天花",
    spotlight: "射灯斜向聚光，灯头角度可信",
    "track-spotlight": "轨道射灯沿导轨转向聚光，灯体连接导轨",
    track: "轨道灯沿导轨模块出光，灯体连接导轨"
  };
  return map[safeProfile.mountFamily] || "按上传图真实安装面出光";
}

function smallLampDetailCameraAngleLine(slot = {}, category = "") {
  const value = String(category || slot.category || "");
  const id = String(slot.id || "");
  if (id === "hero-atmosphere" || id === "hero-scene") return "入口视角平视中远景";
  if (id === "corridor-scene" || id === "entry-scene") return "走廊端头/入口视角平视中远景";
  if (id === "cabinet-scene") return "侧向柜体平视中远景";
  if (id === "bedroom-study-scene") return "平视中远景或轻侧向视角";
  if (smallLampDetailIsSpatialSlot(slot, value)) return "平视中远景";
  if (value === "function") return "正面图文角度";
  if (value === "detail") return id === "material-closeup" ? "微距局部角度" : "中近景局部角度";
  if (value === "real") return "真实摄影视角";
  return "正面产品或轻侧产品角度";
}

function smallLampDetailShotVisualContract(slot = {}, category = "", profile = {}) {
  const value = String(category || slot.category || "");
  const id = String(slot.id || "");
  const movementScene = new Set(["corridor-scene", "entry-scene", "cabinet-scene"]);
  let subjectCount = "1个产品主体";
  let sizeRule = "单主体中景，有留白，不做多主体阵列";
  if (id === "hero-atmosphere" || id === "hero-scene") {
    subjectCount = "1个清晰小灯位+最多1个弱化远处灯位";
    sizeRule = "单灯≤画面宽2%，不做放大产品主体";
  } else if (smallLampDetailIsSpatialSlot(slot, value)) {
    subjectCount = movementScene.has(id) ? "2-3个灯位" : "1-2个灯位";
    sizeRule = "单灯≤画面宽3%";
  } else if (value === "function") {
    subjectCount = "1个完整主体+1个局部放大证据";
    sizeRule = "完整主体中景，局部只作证据";
  } else if (value === "detail") {
    subjectCount = "1个局部主体或1个完整主体+1个局部放大证据";
    sizeRule = "单主体/局部中近景，不做多主体阵列";
  } else if (value === "real") {
    subjectCount = "1个产品主体或1个真实安装主体";
    sizeRule = "真实中景，不做陈列阵列";
  } else if (id === "hero-poster" || id === "product-mood" || value === "main" || value === "selling") {
    subjectCount = "1个清晰产品主体";
    sizeRule = "单主体中景，有留白，不做多主体阵列";
  }
  return [
    `主体数量：${subjectCount}`,
    `体积：${sizeRule}`,
    `镜头角度：${smallLampDetailCameraAngleLine(slot, value)}`,
    `安装/出光角度：${smallLampDetailInstallAngleLine(profile)}`,
    "主体上限：≤3个可辨认小灯主体"
  ].join("；");
}

function smallLampDetailPromptContextLine(slot = {}, category = "", fallback = "") {
  const value = String(category || slot.category || "");
  const id = String(slot.id || "");
  if (id === "hero-atmosphere" || id === "hero-scene") {
    return "真实住宅空间封面，平视中远景，天花约12%-18%，下方保留地面/家具，空间摄影真实、有纵深、有光斑";
  }
  if (id === "living-room-scene") {
    return "正常层高客厅或餐厅家装空间，天花只占上方12%-18%，下方可见地面/家具底部，墙面、窗/门洞和沙发/餐桌尺度清楚";
  }
  if (id === "bedroom-study-scene") {
    return "正常层高卧室、书房或休闲角，保留床/书桌/椅子、墙面、窗帘和地面等完整家装尺度";
  }
  if (id === "corridor-scene" || id === "entry-scene") {
    return "正常层高走廊、玄关或过道空间，远景透视，有地面、门洞、墙面或柜体尺度参照";
  }
  if (id === "cabinet-scene") {
    return "正常层高玄关、柜体或局部墙面空间，侧向或斜向平视中远景，保留柜体、墙面、地面或门洞尺度";
  }
  if (id === "design-aesthetic" || id === "home-install-scene" || smallLampDetailIsSpatialSlot(slot, value)) {
    return "正常层高完整住宅空间中远景，层高舒展，保留墙面、窗/门洞、地面、柜体或家具尺度参照";
  }
  return fallback;
}

function smallLampDetailAllowsRecommendedView(slot = {}, category = "") {
  const id = String(slot.id || "");
  if (smallLampDetailIsSpatialSlot(slot, category)) return false;
  if (String(category || slot.category || "") === "function") return false;
  return ["hero-poster", "material-closeup", "anti-glare-cup", "product-shoot", "arrival-real"].includes(id);
}

function smallLampDetailViewMode(slot = {}, category = "") {
  const value = String(category || slot.category || "");
  const id = String(slot.id || "");
  if (smallLampDetailIsSpatialSlot(slot, value)) {
    return [slot.composition || "正常层高完整空间中远景，灯具作为真实安装后的空间照明点", "层高舒展，天花不压迫画面，保留墙面、窗/门洞、地面、柜体或家具尺度参照"].join("；");
  }
  if (value === "function") {
    return slot.composition || "图文功能页版式，一个完整产品主体配少量功能卡片或示意线";
  }
  if (value === "detail") {
    return slot.composition || "局部近景或微距细节，只聚焦一个材质、发光口、安装或光斑证据";
  }
  if (value === "real") {
    return slot.composition || "真实摄影棚、桌面或安装后实拍视角，单个产品主体";
  }
  if (id === "hero-poster") {
    return "详情页主视觉/品视觉构图，单个主产品清晰、有高级留白和电商首屏品牌感；背景只服务产品气质，不做纯场景、功能卡片、技术说明或近景结构页";
  }
  return slot.composition || "克制卖点海报构图，只围绕本张单一购买理由";
}

function smallLampDetailSubjectPolicy(slot = {}, category = "", profile = {}) {
  const value = String(category || slot.category || "");
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (String(slot.id || "") === "product-mood") {
    if (safeProfile.mountFamily === "recessed-downlight") {
      return "产品气质页只出现一个正面可售卖主体：面环、深杯、发光口和材质边缘清楚；不得出现背部安装件、内部散热/驱动结构、电源连接或多个主体；画面不出现文字。";
    }
    return "产品气质页只出现一个完整可售卖主体，保留真实轮廓、材质和发光口；不得做功能卡片、参数文字、多产品阵列或局部拆解；画面不出现文字。";
  }
  if (value === "function") {
    return "功能图只允许一个完整产品主体；允许一个局部放大或结构裁切作为辅助证据，不得出现多个完整同款产品、商品主体卡片阵列或重复产品分身。";
  }
  if (value === "detail") {
    return "细节图只允许一个完整产品主体或一个局部裁切主体；允许一个局部放大框，但不得出现多个完整同款产品或多产品拼贴。";
  }
  if (smallLampDetailIsSpatialSlot(slot, value)) {
    if (safeProfile.mountFamily === "recessed-downlight") {
      return "空间类图片按真实嵌入式筒灯/射灯安装状态呈现：灯具嵌入吊顶开孔内，面环贴合天花，只露出面环、深杯/灯杯和小发光口；可表现聚光光斑；参考图若是明装小灯只学习空间氛围，不得外露背部结构、外置驱动、电源连接、明装圆柱、贴顶灯座、外露筒身或悬浮灯体。";
    }
    return "空间类图片按真实灯位呈现小灯，主灯位服务空间构图；不得把小灯拍成近景商品主体，不得满天花复制。";
  }
  if (value === "real") {
    return "实拍图只出现一个完整产品主体或一个真实安装后的主体，不做多产品陈列。";
  }
  if (String(slot.id || "") === "hero-poster") {
    return "品视觉首图只出现一个清晰主产品主体，允许轻空间或质感背景衬托；不得把产品缩成场景灯位，也不得做功能卡片、参数表或多产品阵列。";
  }
  return "本张只围绕一个画面主角和一个购买理由，不做多产品阵列或多卖点合集。";
}

function smallLampMountMutationLock(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    "recessed-downlight": "不得把嵌入式筒灯/射灯改成明装筒灯、贴顶吸顶灯、吊灯、大筒灯、轨道灯、外露支架射灯或其它灯具；只允许面环、深杯/灯杯、小发光口和开孔内聚光关系。",
    "surface-downlight": "不得把明装筒灯改成嵌入式开孔、吸顶灯、吊灯、大筒灯、轨道灯或其它灯具；只有上传图本身具备对应结构时才可呈现。",
    spotlight: "不得把射灯改成筒灯、嵌入式开孔、吸顶灯、吊灯、大筒灯、轨道灯或其它灯具；只有上传图本身具备轨道时才可呈现轨道。",
    "track-spotlight": "不得把轨道射灯改成普通筒灯、明装筒灯、嵌入式开孔、吸顶灯、吊灯或其它灯具；灯体必须连接导轨或磁吸轨道。",
    track: "不得把轨道灯改成普通筒灯、射灯、明装筒灯、嵌入式开孔、吸顶灯、吊灯或其它灯具；灯体模块必须沿导轨安装。"
  };
  return map[safeProfile.mountFamily] || "不得把小灯改成吸顶灯、吊灯、大筒灯、轨道灯或其它灯具；只有上传图本身具备对应结构时才可呈现。";
}

function residentialEyeLevelFramingGuard(sequenceSlot = null) {
  const id = String(sequenceSlot?.id || sequenceSlot?.suiteSlot || "");
  const slotText = id ? `当前空间脚本：${sequenceSlot.title || id}。` : "";
  return [
    "住宅平视构图硬锁：镜头像站在房间入口或生活区平视拍摄，视线高度约 1.2-1.5m，先看到完整居住空间，再看到天花灯位。",
    "画面比例硬锁：天花只能是画面最上方的薄顶面或上边界，占画面高度不超过 12%-18%；地面、地毯、家具底部或踢脚线必须出现在画面下方 30%-40%。",
    "墙面高度硬锁：必须看到从地面/家具到天花的连续墙面高度、窗帘、柜体或门洞完整竖向尺度，让空间显得高而舒展。",
    "小灯处理顺序：如果灯位清晰度和层高冲突，优先保持平视空间和正常层高，只把灯缩小或弱化，不能抬镜头、贴近天花或让顶面占满画面。",
    slotText
  ].filter(Boolean).join("\n");
}

function smallLampCeilingHeightGuard(sequenceSlot = null) {
  const id = String(sequenceSlot?.id || sequenceSlot?.suiteSlot || "");
  const slotText = id ? `当前空间脚本：${sequenceSlot.title || id}。` : "";
  return [
    "层高舒展锁：真实空间必须显得开阔、通透、有正常层高，不能像低矮压迫的盒子空间。",
    residentialEyeLevelFramingGuard(sequenceSlot),
    "镜头高度：使用正常人眼视角、中远景或远景，不要把相机贴近天花、贴近灯具底部或向上仰拍成低层高。",
    "构图比例：天花只能作为空间上方的一部分，画面必须保留足够墙面高度、窗/门洞、地面、柜体或家具尺度参照；不要让天花大面积压住画面。",
    "空间边界：柜体、门窗和墙面不能被压到几乎顶住天花；灯具下方要有明显空气感和垂直空间。",
    "禁止低层高表现：不要生成低矮水泥顶、压迫天花、贴顶近景、顶面占满画面、只有柜体上沿和天花的狭窄构图。",
    slotText
  ].filter(Boolean).join("\n");
}

function smallLampDetailSubjectLock(profile = {}, family = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    "产品主体保真最高优先级：以上传产品图为唯一结构来源，结构不变优先于画面创意、空间风格、版式和文字。",
    "不得改变灯体高度、直径比例、发光口大小、深杯形状、灯杯深浅、材质颜色、表面纹理、安装接触面或产品品类。",
    smallLampMountMutationLock(safeProfile),
    smallLampMountFamilyStrictLock(safeProfile),
    `当前产品结构参考：${family.productForm || safeProfile.structureKeywords || "上传图真实结构"}；安装关系参考：${family.install || safeProfile.installationMethod || "上传图可见安装关系"}。`
  ].filter(Boolean).join("\n");
}

const SMALL_LAMP_SPATIAL_SEQUENCE_IDS = new Set([
  "hero-atmosphere",
  "hero-scene",
  "home-install-scene",
  "living-room-scene",
  "corridor-scene",
  "bedroom-study-scene",
  "entry-scene",
  "design-aesthetic",
  "cabinet-scene"
]);

function smallLampSpatialRealismGuard(category = "", sequenceSlot = null) {
  const value = String(category || "").toLowerCase();
  const id = String(sequenceSlot?.id || "");
  if (value !== "scene" && !SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(id)) return "";
  const slotLine = {
    "hero-atmosphere": "首屏必须是家装空间氛围封面：先看见居住空间的光感和层高，再看见真实比例的小灯位；画面以住宅尺度和自然光感为主。",
    "hero-poster": "详情页品视觉必须是电商详情页首屏，产品主体清晰、留白高级，不能变成纯场景图或技术说明页。",
    "hero-scene": "首屏场景必须像真实空间封面，灯具是安装后的空间照明点，镜头保持正常人眼平视中远景。",
    "home-install-scene": "真实安装场景必须像正常住宅实拍，优先呈现客厅、卧室、书房、玄关等正常层高空间。",
    "living-room-scene": "客厅场景必须像正常住宅实拍，能看到地面、家具、墙面和窗/门洞尺度，小灯只是贴顶照明点。",
    "corridor-scene": "走廊应用必须有纵深、地面、门洞或柜体尺度参照，使用远景透视，不贴着天花拍灯。",
    "bedroom-study-scene": "卧室书房场景必须有床、书桌、椅子、墙面、窗帘或地面等家装参照，光感柔和，不做非住宅语境。",
    "design-aesthetic": "设计美学页必须表现产品融入现代空间，使用局部远景或正常室内摄影视角，不做顶面近景海报。",
    "cabinet-scene": "柜体玄关必须使用侧向或斜向局部空间视角，看到柜体、墙面和地面尺度，不重复走廊纵深或客餐厅中远景。"
  }[id] || "场景图必须像真实安装后的空间照片，优先保证空间尺度真实。";
  return [
    "小灯家装空间感锁：只生成住宅家装空间，使用正常层高、正常室内摄影视角或中远景，镜头从房间入口、走廊端头或家具外侧观察。",
    "画面要有地面、墙面、家具、柜体、门窗等家装尺度参照；天花只作为空间一部分，不能压迫画面。",
    "空间语境必须保持住宅家装，不进入公共经营、公区接待或工作场所语境。",
    "灯具数量按空间功能合理布置，主灯位可辨认即可，不做满天花复制、随机散点或多个同等清晰主体。",
    smallLampCeilingHeightGuard(sequenceSlot),
    slotLine
  ].join("\n");
}

function smallLampDetailSceneOrderRule(sequenceSlot = {}) {
  const id = String(sequenceSlot?.id || "");
  if (id === "hero-atmosphere" || id === "hero-poster" || id === "hero-scene") {
    return "合理呈现：首张家装氛围首屏只允许 1 个清晰小灯位，最多 1 个弱化远处点；单灯≤画面宽2%，只作为天花小灯位服务空间光感，不做放大的产品主体；画面保持完整住宅尺度和清爽留白。";
  }
  if (id === "corridor-scene") {
    return "合理布灯：允许 2-3 个小灯位沿走廊、玄关或柜体动线有节奏排列；主灯位可辨认即可，其它更小、更弱或更远；禁止随机散布、满天花复制、整排过密和贴顶近景。";
  }
  if (id === "living-room-scene") {
    return "合理布灯：客厅或餐厅只安排 1-2 个可辨认灯位；主灯位服务空间照明，第二个只能作为空间辅助，不得抢主体或逼近镜头。";
  }
  if (id === "bedroom-study-scene") {
    return "合理布灯：卧室或书房只安排 1 个主灯位或 1-2 个弱化灯位，光感安静柔和，不做密集灯阵。";
  }
  if (id === "home-install-scene") {
    return "合理布灯：普通客厅、餐厅、卧室或书房只安排 1-2 个可辨认灯位；主灯位服务空间照明，第二个只能作为空间辅助，不得抢主体或逼近镜头。";
  }
  if (id === "design-aesthetic") {
    return "合理布灯：设计美学页只安排 1-2 个小灯位，灯具作为空间比例细节，不做多点复制展示或满天花节奏。";
  }
  return "";
}

function smallLampDetailMeaningfulVisualGuard(archetype = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const traits = smallLampOpticalTraits(safeProfile);
  const dynamicArchetype = smallLampDynamicSlotMeta(archetype, safeProfile);
  const id = String(dynamicArchetype?.id || "");
  const common = [
    "详情页有效性：每张图必须像电商详情页中的一个明确页面，画面内容要能直接回答本张标题；禁止无说明的装饰图标、随机箭头、伪科学图表、意义不明符号和无法读懂的抽象拼贴。",
    "所有箭头、线条、图标、色块或图表如果出现，必须服务本张主题，并配有简体中文短标签；不要出现纯图标堆叠、眼睛图标、风图标、上升箭头、对勾、随机光谱曲线或无标签坐标图。"
  ];
  const byId = {
    "core-advantages": "核心优势页只做 4-6 个简体中文短标签卡片围绕完整产品主体；不要眼球、光谱曲线、空气图标、趋势箭头、伪检测图或随机图标合集。",
    "anti-glare-cup": traits.hasDeepCup
      ? "防眩控光页只展示完整产品或底部灯杯剖面感、遮光路径和简体中文短标签；禁止眼球剖面、彩虹箭头、光谱曲线、空气/眼睛/增长图标和无意义检测符号。"
      : "出光结构页只展示真实发光口、控光边界和舒适光感；禁止写深杯防眩、UGR、遮光角等未确认结构或参数。",
    "eye-care": traits.hasBlueLight
      ? "护眼光感页必须用清晰简体中文说明已确认的低蓝光、低频闪或舒适光感信息；禁止眼球解剖图、随机箭头、无标签曲线、英文缩写和伪认证图标。"
      : "舒适光感页只表达柔和、不刺眼、低眩感和使用舒适度；禁止写低蓝光认证、RG0、频闪数值或任何未确认护眼参数。",
    "color-rendering": traits.hasColorRendering
      ? "显色表现页必须用清晰色彩还原对比、色条或自然物体色彩表达，并配简体中文标签；禁止无坐标含义的随机曲线、英文缩写、伪检测图标和无标签图表。"
      : "色彩还原页只表达自然观感和舒适光环境；禁止写 CRI、Ra、R9、Rf 或未确认的显色指数数字。",
    "beam-spot": "光束光斑页只表现墙面/地面光斑、光束边缘和发光口关系；禁止把光谱、护眼、显色、随机图标混到同一页。",
    "size-install": "尺寸安装页只讲安装关系、顶部接触面、贴顶固定或尺寸方向；禁止拆成爆炸零件、伪实验室检测和多主题图标拼贴。",
    "install-detail": "安装局部页只表现闭合后的真实安装接触关系，例如灯体贴合天花、顶部边缘、固定接触面或一处可信连接细节；禁止打开天花、露出电线端子、画内部电路板、爆炸拆解、悬空零件或维修剖面。"
  };
  return [...common, byId[id] || ""].filter(Boolean).join("\n");
}

function smallLampDetailStrategyEnabled(profile = {}, counts = {}, settings = {}) {
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  const total = totalCountFromServerCounts(counts);
  const mainCount = Number(counts?.main || 0);
  if (mainCount > 0 && total <= mainCount) return false;
  return isSmallLampProfile(profile, settings);
}

function isLargeLampProfile(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  return channel.channel === "large" || ["ceiling", "chandelier"].includes(safeProfile.mountFamily);
}

function largeLampDetailStrategyEnabled(profile = {}, counts = {}, settings = {}) {
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  const total = totalCountFromServerCounts(counts);
  const mainCount = Number(counts?.main || 0);
  if (mainCount > 0 && total <= mainCount) return false;
  return isLargeLampProfile(profile, settings) && !isSmallLampProfile(profile, settings);
}

function isWallLampProfile(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  return channel.channel === "wall" || safeProfile.mountFamily === "wall";
}

function wallLampDetailStrategyEnabled(profile = {}, counts = {}, settings = {}) {
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  const total = totalCountFromServerCounts(counts);
  const mainCount = Number(counts?.main || 0);
  if (mainCount > 0 && total <= mainCount) return false;
  return isWallLampProfile(profile, settings);
}

const LARGE_LAMP_DETAIL_SEQUENCE = [
  {
    id: "hero-main-space",
    category: "scene",
    title: "主灯空间首屏",
    role: "建立整套大灯详情页第一眼",
    focus: "完整房间尺度、真实主灯比例和可信安装关系",
    composition: "客厅、餐厅或卧室完整连续空间，房间先行的正常人眼平视或轻仰视中远景，必须看到地面下沿、家具主体、墙面、窗/门洞和天花挂点尺度，主灯只是天花上的真实安装物；标题融入自然负空间，灯体不遮住主要家具"
  },
  {
    id: "product-mood",
    category: "main",
    title: "整灯气质图",
    role: "展示完整可售卖主体",
    focus: "整灯轮廓、灯罩/灯臂/底盘/吊线和材质颜色",
    composition: "干净高级背景，单个完整主灯主体居中或三分构图，主体占画面高度约24%-38%，四周必须保留大块留白和落影，完整吊线/底盘/灯体都可见，不做贴脸近景、微距、裁切或功能卡片"
  },
  {
    id: "core-reason",
    category: "selling",
    title: "核心购买理由",
    role: "只讲一个核心卖点",
    focusKey: "selling",
    composition: "商品页卖点海报，保留完整可售卖主灯和充足留白，主体不得裁切；主灯占画面高度约28%-42%，极限不超过45%，不要贴脸大头灯、不要半空间近景、不要大标题压顶"
  },
  {
    id: "living-scene",
    category: "scene",
    title: "客餐厅应用",
    role: "展示主灯真实空间效果",
    focus: "客餐厅房间尺度、主灯真实比例和环境光",
    composition: "客厅或餐厅完整连续空间，房间先行的平视或轻仰视中远景，保留地面、家具、墙面、窗/门洞尺度，主灯只出现一盏/一套，不能遮住主要空间"
  },
  {
    id: "structure-function",
    category: "function",
    title: "结构功能",
    role: "解释完整主灯结构价值",
    focusKey: "structure",
    composition: "完整主灯主体加少量局部标注，说明灯罩、灯臂、吊线/吊杆、吸顶盘或大型贴顶结构"
  },
  {
    id: "material-detail",
    category: "detail",
    title: "材质细节",
    role: "证明材质和工艺",
    focusKey: "material",
    composition: "近景展示灯罩、金属/玻璃/亚克力/木质表面、边缘连接或工艺纹理，不改变整灯结构"
  },
  {
    id: "lighting-function",
    category: "function",
    title: "主灯光效",
    role: "说明照明与氛围",
    focusKey: "light",
    composition: "完整房间中远景展示主灯向下或向周围扩散的真实光效，可用简体中文短标签说明光感，不写无依据数值"
  },
  {
    id: "bedroom-scene",
    category: "scene",
    title: "卧室/书房应用",
    role: "展示安静生活场景",
    focus: "卧室书房房间尺度、真实主灯比例和柔和光感",
    composition: "卧室或书房完整连续空间，房间先行的平视或轻仰视中远景，先看到床/书桌、地面、墙面和窗帘/门洞尺度，再看到天花上的主灯，只保留当前产品这一盏/一套主灯"
  },
  {
    id: "install-detail",
    category: "detail",
    title: "安装结构细节",
    role: "证明安装可信度",
    focusKey: "install",
    composition: "展示吸顶盘/底盘、吊线/吊杆、贴顶接触面、连接件或大型安装结构中的一个真实局部"
  },
  {
    id: "style-value",
    category: "selling",
    title: "空间风格适配",
    role: "表达造型和软装搭配",
    focusKey: "style",
    composition: "轻空间或克制海报构图，先保留室内墙面、家具和地面尺度，再展示主灯与室内风格匹配，不做参数表，不把主灯拍成大头近景"
  },
  {
    id: "emitter-detail",
    category: "detail",
    title: "透光/发光面",
    role: "证明发光结构",
    focus: "灯罩透光、发光面、光源遮挡关系或柔和出光边界",
    composition: "微距或近景，只聚焦一个透光/发光细节，可有少量中文标注"
  },
  {
    id: "studio-real",
    category: "real",
    title: "整灯实拍感",
    role: "建立真实商品可信度",
    focus: "完整主体、自然透视和真实材质",
    composition: "摄影棚、样板间或自然背景实拍感，单个完整主灯主体，曝光均衡"
  },
  {
    id: "installed-real",
    category: "real",
    title: "安装后实拍感",
    role: "展示真实使用状态",
    focus: "安装点、环境光、阴影和现场感",
    composition: "真实安装后的完整空间视角，房间先行的平视或轻仰视中远景，能看到地面、家具、墙面和门窗尺度，只出现当前产品这一盏/一套主灯，保持入口或房间角落的空间观察距离"
  }
];

function largeLampDetailSequenceCatalog() {
  return LARGE_LAMP_DETAIL_SEQUENCE;
}

function largeLampDetailSuiteRequested(settings = {}, userRequirement = "") {
  const text = cleanPromptPart([
    userRequirement,
    settings?.layout,
    settings?.requirement,
    settings?.prompt,
    settings?.detailMode
  ].filter(Boolean).join("；"));
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  return Boolean(settings.largeLampFullDetailSuite) || /13\s*张|十三张|完整\s*13\s*张|完整十三张|全套\s*13|13\s*张\s*(?:详情页|详情图组|详情套图|套图)|完整链路/.test(text);
}

function largeLampFullDetailCounts(counts = {}) {
  const current = normalizeCounts(counts);
  const total = totalCountFromServerCounts(current);
  if (total >= LARGE_LAMP_DETAIL_SEQUENCE.length) return current;
  return {
    ...current,
    main: 1,
    selling: 2,
    function: 2,
    scene: 3,
    detail: 3,
    real: 2
  };
}

function largeLampDetailSequenceTotal(counts = {}, shots = [], options = {}) {
  if (options.forceFullSuite) return LARGE_LAMP_DETAIL_SEQUENCE.length;
  const total = totalCountFromServerCounts(counts) || shots.length || 5;
  return Math.max(1, Math.min(LARGE_LAMP_DETAIL_SEQUENCE.length, Math.floor(Number(total) || 5)));
}

function largeLampDetailSequenceForShots(counts = {}, shots = [], options = {}) {
  return largeLampDetailSequenceCatalog().slice(0, largeLampDetailSequenceTotal(counts, shots, options));
}

function largeLampFocus(slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = cleanPromptPart([safeProfile.material, safeProfile.colorPalette].filter(Boolean).join("，"));
  const map = {
    selling: cleanPromptPart(safeProfile.sellingPoint || safeProfile.sellingPoints || safeProfile.lightUse) || "整灯造型、空间氛围和照明覆盖",
    material: material || "灯体材质、灯罩透光和表面工艺",
    light: cleanPromptPart(safeProfile.lightUse || safeProfile.visualStrategy?.lightingEffect) || "主照明覆盖、柔和光效和空间氛围",
    structure: cleanPromptPart(safeProfile.structureKeywords || safeProfile.visibleParts) || "完整灯体、灯罩、灯臂、底盘/吸顶盘和安装结构",
    install: cleanPromptPart(safeProfile.installationMethod || safeProfile.installationPosition) || "吸顶盘/底盘、吊线/吊杆、贴顶面或挂点结构",
    style: cleanPromptPart(safeProfile.visualStrategy?.productStyle || safeProfile.style || safeProfile.targetSpace) || "造型风格和空间适配"
  };
  const focus = cleanPromptPart(slot.focus || map[slot.focusKey] || map.structure);
  return focus && focus !== "?" ? focus : "完整主灯结构、材质、安装关系和真实光效";
}

function largeLampTextPlan(category = "", slot = {}, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!productWorkspaceVisibleTextEnabled(settings) && !isCriticalDetailTextSlot(slot, category)) return ["无"];
  if (!productPromptAllowsText(category) && slot.id !== "hero-main-space") return ["无"];
  const focus = splitChineseOverlayLabels(largeLampFocus(slot, safeProfile), { maxItems: 3, maxLength: 8 });
  const selling = splitChineseOverlayLabels(safeProfile.sellingPoint || safeProfile.lightUse, { maxItems: 2, maxLength: 8 });
  const labels = [...selling, ...focus]
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (slot.id === "hero-main-space") {
    return heroAtmosphereTextPlan(safeProfile, {
      fallbackTitle: cleanChineseOverlayText(labels[0] || "居家光影", { maxLength: 8 })
    });
  }
  if (category === "function") return [`标题：${cleanChineseOverlayText(slot.title, { maxLength: 8 })}`, `标签：${labels.slice(0, 4).join("、") || "结构清晰、光感舒适"}`];
  if (category === "detail") return [`标题：${cleanChineseOverlayText(slot.title, { maxLength: 8 })}`, `标注：${labels.slice(0, 2).join("、") || "材质细节"}`];
  if (category === "selling") return [`标题：${cleanChineseOverlayText(labels[0] || slot.title, { maxLength: 8 })}`];
  return ["无"];
}

function visibleTextLineValue(lines = [], labels = []) {
  const pattern = new RegExp(`^(?:${labels.map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[：:]`);
  const line = lines.find((item) => pattern.test(String(item || ""))) || "";
  return cleanChineseOverlayText(String(line).replace(pattern, ""), { maxLength: 12 });
}

function visibleTextLineLabels(lines = [], labels = []) {
  const pattern = new RegExp(`^(?:${labels.map((label) => String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[：:]`);
  return lines
    .filter((item) => pattern.test(String(item || "")))
    .flatMap((item) => splitChineseOverlayLabels(String(item).replace(pattern, ""), { maxItems: 4, maxLength: 8 }))
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function modelDirectTextLinesFromOverlay(shot = {}) {
  const overlay = shot?.textOverlay || {};
  if (overlay.template === "commerce-detail-hero") {
    const heroLine = mergeHeroVisibleTextLine(overlay.title, overlay.subtitle);
    return heroLine ? [heroLine] : [];
  }
  return [
    overlay.title,
    overlay.subtitle,
    ...(Array.isArray(overlay.labels) ? overlay.labels : [])
  ]
    .map((item) => cleanChineseOverlayText(item, { maxLength: 12 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function commonChinesePrefixLength(a = "", b = "") {
  const left = Array.from(String(a || ""));
  const right = Array.from(String(b || ""));
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function mergeHeroVisibleTextLine(title = "", subtitle = "") {
  const first = cleanChineseOverlayText(title || "", { maxLength: 14 });
  const second = cleanChineseOverlayText(subtitle || "", { maxLength: 14 });
  if (!first) return second;
  if (!second) return first;
  if (first === second) return first;
  if (first.includes(second)) return first;
  if (second.includes(first)) return second;
  const prefixLength = commonChinesePrefixLength(first, second);
  const merged = prefixLength >= 2
    ? `${first}${Array.from(second).slice(prefixLength).join("")}`
    : mergeHeroDescriptorAndMood(first, second);
  return cleanChineseOverlayText(merged, { maxLength: 14 });
}

function mergeHeroDescriptorAndMood(descriptor = "", mood = "") {
  const base = cleanChineseOverlayText(descriptor, { maxLength: 14 });
  const accent = cleanChineseOverlayText(mood, { maxLength: 8 })
    .replace(/光影|光感|氛围|质感|空间|家居|居家/g, "");
  if (!base || !accent) return base || accent;
  if (base.includes(accent)) return base;
  const productMatch = base.match(/(?:空间主灯|墙面壁灯|艺术吊灯|水晶吊灯|主灯|吊灯|壁灯|射灯|筒灯|小灯)$/);
  if (productMatch) {
    const index = base.length - productMatch[0].length;
    return `${base.slice(0, index)}${accent}${productMatch[0]}`;
  }
  return base;
}

function localTextOverlayBasePrompt() {
  return "文字：底图不要生成任何可见文字；留白给应用后置简体中文排版。";
}

function modelDirectTextStyleBrief(profile = {}, overlay = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const key = overlay.themeKey || overlay.theme?.key || textOverlayThemeKey(safeProfile, { tone: overlay.tone || "" });
  const evidence = textOverlayEvidence(safeProfile, {});
  if (key === "dark-premium" || /黑|哑黑|金属|轻奢|酒店|高级|dark|black|metal|premium/i.test(evidence)) {
    return "排版风格：高级金属感，细字重、克制留白，禁粗黑大标题。";
  }
  if (key === "clean-tech" || /白|极简|科技|商用|办公|干净|冷白|minimal|tech|office/i.test(evidence)) {
    return "排版风格：干净科技感，网格对齐、细线小标签，不拥挤。";
  }
  if (key === "editorial-natural" || /木|原木|自然|北欧|日式|绿|wood|natural|nordic/i.test(evidence)) {
    return "排版风格：自然编辑感，温和色彩、柔和留白、轻量标注。";
  }
  return "排版风格：温润家居感，中文清楚克制，融入画面。";
}

function modelDirectTextLayoutBrief(shot = {}, category = "") {
  const mode = shot?.textOverlay?.template || "";
  const value = String(category || shot?.category || "").toLowerCase();
  if (isDetailHeroTextShot(shot, value) || mode === "commerce-detail-hero") {
    return "版式：全幅电商详情页封面设计稿，标题融入自然负空间；禁底部/顶部/侧边白条、独立标题栏、纯白文字区、模板海报白块和粗黑大字。";
  }
  if (value === "function" || mode === "feature-cards" || mode === "advantage-editorial") {
    return "版式：功能标题偏小，标签不超4组，靠留白排布，细线不遮主体。";
  }
  if (value === "detail" || mode === "detail-callout") {
    return "版式：细节标注小，1-2个短标签，贴近局部但不覆盖结构。";
  }
  return "版式：文字只占少量留白，不能成为画面最大主体。";
}

function heroCoverArtDirectionEvidence(profile = {}, overlay = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const visual = safeProfile.visualStrategy || {};
  return [
    safeProfile.productName,
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.style,
    safeProfile.material,
    safeProfile.colorPalette,
    safeProfile.targetSpace,
    safeProfile.lightUse,
    visual.productStyle,
    visual.suitableVisualStyle,
    visual.styleKeywords,
    visual.moodKeywords,
    visual.lightingEffect,
    visual.colorSystem,
    visual.visualLanguage,
    visual.decorativeElements,
    overlay.themeKey,
    overlay.tone
  ].filter(Boolean).join(" ");
}

function modelDirectHeroCoverStyleFamily(profile = {}, overlay = {}) {
  const text = heroCoverArtDirectionEvidence(profile, overlay);
  if (/水晶|晶透|玻璃|亚克力|透明|通透|crystal|glass/i.test(text)) return "crystal-luxury";
  if (/彩色|多彩|彩|红|橙|黄|绿|蓝|复古|波普|retro|color|colour|pop/i.test(text)) return "color-editorial";
  if (/黑|哑黑|金属|拉丝|轻奢|酒店|高级|dark|black|metal|premium|brushed/i.test(text)) return "dark-premium";
  if (/白|极简|科技|办公|商用|线性|冷白|minimal|tech|office|clean/i.test(text)) return "clean-tech";
  if (/木|原木|藤|竹|自然|北欧|日式|温润|暖|家居|卧室|客厅|餐厅|wood|warm|natural|home|nordic/i.test(text)) return "warm-home";
  return "warm-home";
}

function modelDirectHeroCoverArtDirection(profile = {}, overlay = {}) {
  const family = modelDirectHeroCoverStyleFamily(profile, overlay);
  const directions = {
    "dark-premium": {
      label: "dark-premium 高级金属封面",
      composition: "深色/中性全幅完整空间，空间光影先成立，灯具高光作真实比例亮点",
      palette: "黑灰、金属高光、少量暖光",
      typography: "细字重现代中文，不能粗黑压屏",
      titlePlacement: "标题落暗部自然负空间，文字区域不超过画面高度10%-14%"
    },
    "warm-home": {
      label: "warm-home 温润家居封面",
      composition: "真实家居全幅完整空间，空间光感先成立，灯具按真实比例建立氛围",
      palette: "暖白、木色、浅灰、柔和光影",
      typography: "轻量现代中文，温和清楚",
      titlePlacement: "标题落墙面/家具旁自然负空间，文字区域不超过画面高度10%-14%"
    },
    "clean-tech": {
      label: "clean-tech 极简科技封面",
      composition: "干净全幅完整空间，灯具结构清晰但不居中放大，有秩序感但不做说明书",
      palette: "白、浅灰、冷中性光、低饱和点缀",
      typography: "细字重现代中文，小比例网格对齐",
      titlePlacement: "标题落上方/侧边自然负空间，不能形成纯白标题栏"
    },
    "color-editorial": {
      label: "color-editorial 彩色编辑封面",
      composition: "复古编辑感全幅生活方式空间，灯具色彩呼应软装但不压过房间尺度",
      palette: "产品主色低饱和呼应背景和软装",
      typography: "轻量现代中文，像杂志小标题",
      titlePlacement: "标题落自然负空间/墙面暗部，文字区域不超过画面高度10%-14%"
    },
    "crystal-luxury": {
      label: "crystal-luxury 晶透轻奢封面",
      composition: "全幅轻奢完整空间，晶透反射作为真实比例空间亮点",
      palette: "灰白、香槟金、透明高光、柔暖光效",
      typography: "细字重高级中文，克制透气",
      titlePlacement: "标题落边缘低对比负空间，文字区域不超过画面高度10%-14%"
    }
  };
  return { family, ...(directions[family] || directions["warm-home"]) };
}

function nonCloseupSpatialLensBrief(profile = {}, settings = {}, options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const prefix = options.prefix || "中远景空间镜头锁";
  if (isWallLampProfile(safeProfile, settings) && !isSmallLampProfile(safeProfile, settings) && !isLargeLampProfile(safeProfile, settings)) {
    return `${prefix}：场景：床头/背景墙/走廊完整墙面；视角：人眼高度平视或30度斜侧中远景；机位角度：离墙2-4米保留地面和家具；灯具比例：真实壁灯比例，占画面6%-14%，最高16%，只作为墙面照明节点；画面参照：墙面、床头/沙发、地面、门洞。`;
  }
  if (isSmallLampProfile(safeProfile, settings)) {
    return `${prefix}：场景：客厅/玄关/走廊/柜体完整住宅；视角：人眼平视中远景，天花只作上边界；机位角度：入口或走廊端头拍房间尺度；灯具比例：1-2个小灯位，单灯≤画面宽3%-4%，灯位只作空间尺度点；画面参照：地面、墙面、柜体、家具、门洞。`;
  }
  if (isLargeLampProfile(safeProfile, settings)) {
    return `${prefix}：场景：完整客厅/餐厅/卧室房间；视角：入口/餐桌外2-4米平视中远景；机位角度：24-35mm轻斜侧，机位不在灯下；灯具比例：一盏/一套真实比例主灯，外轮廓高10%-16%，最高18%，下缘不越过画面高度35%，只作空间中的天花陈设；画面参照：地面、家具、墙面、窗/门洞、天花挂点。`;
  }
  return `${prefix}：场景：完整住宅空间；视角：人眼平视中远景；机位角度：离开灯具先看房间尺度；灯具比例：上传产品真实体量，小于空间主视觉，作为空间陈设出现；画面参照：地面、家具、墙面、门洞、天花或墙体。`;
}

function nonCloseupSpatialExecutionGuard(profile = {}, settings = {}, options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const prefix = options.prefix || "房间优先判定";
  if (isWallLampProfile(safeProfile, settings) && !isSmallLampProfile(safeProfile, settings) && !isLargeLampProfile(safeProfile, settings)) {
    return `${prefix}：空间完整性优先，壁灯服务完整墙面关系，画面先呈现床/沙发/门洞/地面尺度，灯体外轮廓控制在画面6%-14%。`;
  }
  if (isSmallLampProfile(safeProfile, settings)) {
    return `${prefix}：空间优先，小灯只作天花/柜体小体量灯位；下方有地面/家具/门洞，单灯≤画面宽4%，以真实安装尺度融入空间。`;
  }
  if (isLargeLampProfile(safeProfile, settings)) {
    return `${prefix}：空间完整性优先，主灯位于天花挂点附近并以真实家装尺度呈现；完整外轮廓高≤18%，下缘≤画面高度35%，下方保留餐桌/沙发/地面尺度。`;
  }
  return `${prefix}：空间完整性优先，先让完整空间成立，再放入真实比例灯具；灯具以空间陈设比例呈现，画面保留地面、家具、墙面或门洞尺度。`;
}

function shotRequiresNonCloseupSpatialLens(shot = {}, category = "") {
  const route = shot?.promptRoute || shot || {};
  const value = String(category || shot?.category || route.category || "").toLowerCase();
  const slot = String(route.sequenceSlot || route.pageRole || route.id || shot?.sequenceSlot || "");
  const dialect = String(route.visualDialect || shot?.visualDialect || "");
  return value === "scene"
    || dialect === "real-scale-scene"
    || /detail-cover|cover-spatial-hero|hero-main-space|hero-atmosphere|wall-hero-atmosphere|scene/i.test(slot);
}

function modelDirectTextPrompt(shot = {}, profile = {}, settings = {}, category = "") {
  const overlay = shot?.textOverlay || {};
  const isHeroTextShot = isDetailHeroTextShot(shot, category) || overlay.template === "commerce-detail-hero";
  const title = cleanChineseOverlayText(overlay.title || "", { maxLength: 12 });
  const subtitle = cleanChineseOverlayText(overlay.subtitle || "", { maxLength: 14 });
  const heroSingleLine = overlay.template === "commerce-detail-hero"
    ? mergeHeroVisibleTextLine(title, subtitle)
    : "";
  const labels = (Array.isArray(overlay.labels) ? overlay.labels : [])
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 4);
  const plannedTexts = (heroSingleLine ? [heroSingleLine] : [
    title,
    subtitle,
    ...labels
  ])
    .map((item) => cleanChineseOverlayText(item, { maxLength: 12 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  const planned = plannedTexts.length
    ? plannedTexts.map((item) => `「${item}」`).join("、")
    : modelDirectTextLinesFromOverlay(shot).map((item) => `「${item}」`).join("、");
  const styleBrief = modelDirectTextStyleBrief(profile, overlay).replace(/^排版风格：/, "风格：").replace(/。$/, "");
  const layoutBrief = modelDirectTextLayoutBrief(shot, category).replace(/^版式：/, "版式：").replace(/。$/, "");
  if (isHeroTextShot) {
    const art = modelDirectHeroCoverArtDirection(profile, overlay);
    const heroTitle = cleanChineseOverlayText(
      heroSingleLine || plannedTexts[0] || modelDirectTextLinesFromOverlay(shot)[0] || heroAtmosphereTitle(profile, { fallback: "质感光境" }),
      { fallback: "质感光境", maxLength: 12 }
    );
    return [
      `首图：全幅电商详情页封面设计稿，只生成1行简体中文短标题「${heroTitle}」，6-12字。`,
      `设计：${art.family}；细字重，文字区域不超过画面高度10%-14%，标题融入自然负空间。`,
      "禁区：底部白条/顶部白条/侧边白条/独立标题栏/纯白文字区/模板海报白块/粗黑大字；禁副标题/标签/长句/参数/英文/拼音/价格/品牌。"
    ].filter(Boolean).join("\n");
  }
  return [
    `文字：模型直接生成规划好的简体中文，只写：${planned || "无"}；禁英文/拼音/乱码/品牌/水印/数字。`,
    `${styleBrief}；${layoutBrief}`
  ].filter(Boolean).join("\n");
}

function heroAtmosphereTitle(profile = {}, { fallback = "温润光境" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const source = heroCopySource(safeProfile);
  const space = heroSpaceLabel(source);
  const style = heroStyleLabel(source);
  const formMood = heroFormMoodLabel(source);
  const emotion = heroEmotionLabel(source);
  const product = heroProductFormLabel(safeProfile, source);
  const crafted = [
    style && formMood ? `${style}${formMood}` : "",
    formMood && space !== "空间" ? `${space}${formMood}` : "",
    style && style !== "现代" ? `${style}光影` : "",
    emotion && space !== "空间" ? `${emotion}${space}` : "",
    formMood ? `${formMood}光影` : "",
    product && /吊灯|主灯|壁灯/.test(product) && style ? `${style}${product}` : ""
  ].filter(Boolean);
  const craftedTitle = firstUsefulHeroCopy(crafted, "");
  if (craftedTitle) return craftedTitle;

  const candidates = splitChineseOverlayLabels(source, { maxItems: 10, maxLength: 28 })
    .map((item) => compactHeroAtmosphereTitleText(item, fallback))
    .filter((item) => item.length >= 4 && item.length <= 8)
    .filter((item) => !isWeakCommerceHeroCopy(item))
    .filter((item) => !/金属微光|克制光感|精致小灯|完整主灯|筒灯|射灯|吊灯|壁灯|吸顶灯|小灯|产品|材质|结构|安装|比例|灯罩|灯臂|底盘|吊线|面环|灯杯/.test(item));
  if (candidates.length) return candidates[0];
  const text = [safeProfile.targetSpace, safeProfile.lightUse, safeProfile.style].map((item) => String(item || "")).join(" ");
  if (/卧室|书房|床头|阅读/.test(text)) return "静谧光影";
  if (/餐厅|客厅|家居|住宅|居家/.test(text)) return "居家光影";
  if (/玄关|走廊|墙面|壁/.test(text)) return "墙面光境";
  if (/暖|柔|氛围|舒适/.test(text)) return "温润光境";
  return compactHeroAtmosphereTitleText(fallback, "温润光境");
}

function heroAtmosphereSubtitle(profile = {}, { fallback = "让空间更有层次" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const source = heroCopySource(safeProfile);
  const space = heroSpaceLabel(source);
  const style = heroStyleLabel(source);
  const formMood = heroFormMoodLabel(source);
  const emotion = heroEmotionLabel(source);
  const product = heroProductFormLabel(safeProfile, source);
  const light = splitChineseOverlayLabels(safeProfile.lightUse || safeProfile.sellingPoint || "", { maxItems: 4, maxLength: 12 })
    .find((item) => /光|洗墙|阅读|下照|主照明/.test(item) && !isWeakCommerceHeroCopy(item));
  const candidates = [
    style && product ? `${style}${product}` : "",
    formMood && product ? `${formMood}${product}` : "",
    emotion && space !== "空间" ? `${emotion}${space}氛围` : "",
    style && space !== "空间" ? `${style}${space}光感` : "",
    light && !/为主|氛围照明|柔光氛围/.test(light) ? light : "",
    product
  ];
  return firstUsefulHeroCopy(candidates, fallback);
}

function mergeHeroCopyParts(parts = [], { maxLength = 12 } = {}) {
  const result = [];
  for (const part of parts) {
    const text = cleanChineseOverlayText(part, { maxLength });
    if (!text) continue;
    if (result.some((item) => item.includes(text) || text.includes(item))) continue;
    result.push(text);
  }
  return cleanChineseOverlayText(result.join(""), { maxLength });
}

function heroProductDescriptorTitle(profile = {}, { fallbackTitle = "居家光影" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const source = heroCopySource(safeProfile);
  const style = heroStyleLabel(source);
  const product = heroProductFormLabel(safeProfile, source);
  const fallback = heroAtmosphereTitle(safeProfile, { fallback: fallbackTitle });
  if (product && !isWeakCommerceHeroCopy(product)) {
    return mergeHeroCopyParts([style, product], { maxLength: 12 }) || product;
  }
  return fallback;
}

function heroMoodSubtitle(profile = {}, title = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const directMood = mergeHeroCopyParts(
    recognitionMoodKeywordList(safeProfile.visualStrategy?.moodKeywords || "", [
      safeProfile.style,
      safeProfile.lampSubtype,
      safeProfile.lampType,
      title
    ]).map((item) => item.replace(/干净|清爽|清新|的/g, "")),
    { maxLength: 8 }
  );
  if (directMood && !title.includes(directMood) && !directMood.includes(title)) return directMood;
  const source = heroCopySource(safeProfile);
  const formMood = heroFormMoodLabel(source);
  const emotion = heroEmotionLabel(source);
  const mood = mergeHeroCopyParts([formMood, emotion], { maxLength: 8 })
    || heroAtmosphereTitle(safeProfile, { fallback: "温润光影" });
  const cleaned = cleanChineseOverlayText(mood, { maxLength: 8 });
  if (!cleaned || title.includes(cleaned) || cleaned.includes(title)) return "";
  return cleaned;
}

function heroAtmosphereTextPlan(profile = {}, { fallbackTitle = "温润光境" } = {}) {
  const title = heroProductDescriptorTitle(profile, { fallbackTitle });
  const subtitle = heroMoodSubtitle(profile, title);
  return [
    `标题：${title}`,
    subtitle ? `副标题：${subtitle}` : ""
  ].filter(Boolean);
}

const TEXT_OVERLAY_THEME_PRESETS = {
  "default-commerce": {
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    serifFontFamily: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
    titleWeight: 620,
    bodyWeight: 430,
    labelWeight: 600,
    titleScale: 1,
    subtitleScale: 1,
    labelScale: 1,
    letterSpacing: 0,
    titleFill: "#111111",
    subtitleFill: "#4d4942",
    lineFill: "#9c8f7a",
    panelFill: "#ffffff",
    panelOpacity: 0.58,
    panelEndOpacity: 0.1,
    cardFill: "#ffffff",
    cardOpacity: 0.72,
    cardStroke: "#e4ddd2",
    labelFill: "#6a6a64",
    labelTextFill: "#fffaf0",
    dotFill: "#9c8f7a",
    darkPanelFill: "#050505",
    darkTitleFill: "#f4f1ea",
    darkSubtitleFill: "#a9a29a",
    radiusScale: 1
  },
  "warm-home": {
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    serifFontFamily: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
    titleWeight: 580,
    bodyWeight: 420,
    labelWeight: 560,
    titleScale: 0.94,
    subtitleScale: 1.02,
    labelScale: 0.96,
    letterSpacing: 0,
    titleFill: "#2b241d",
    subtitleFill: "#746858",
    lineFill: "#b99467",
    panelFill: "#fff8ee",
    panelOpacity: 0.62,
    panelEndOpacity: 0.08,
    cardFill: "#fffaf2",
    cardOpacity: 0.78,
    cardStroke: "#e6d3b8",
    labelFill: "#8a6a46",
    labelTextFill: "#fff8ee",
    dotFill: "#bf8f57",
    darkPanelFill: "#221913",
    darkTitleFill: "#fff4e4",
    darkSubtitleFill: "#d8c2a4",
    radiusScale: 1.35
  },
  "clean-tech": {
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    serifFontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    titleWeight: 700,
    bodyWeight: 500,
    labelWeight: 650,
    titleScale: 0.9,
    subtitleScale: 0.94,
    labelScale: 0.92,
    letterSpacing: 0,
    titleFill: "#101820",
    subtitleFill: "#47515c",
    lineFill: "#2f7dd3",
    panelFill: "#f8fbff",
    panelOpacity: 0.7,
    panelEndOpacity: 0.12,
    cardFill: "#f8fbff",
    cardOpacity: 0.86,
    cardStroke: "#c8d7e8",
    labelFill: "#1f5f99",
    labelTextFill: "#f7fbff",
    dotFill: "#2f7dd3",
    darkPanelFill: "#07111f",
    darkTitleFill: "#f5fbff",
    darkSubtitleFill: "#a9bfd5",
    radiusScale: 0.72
  },
  "dark-premium": {
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    serifFontFamily: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
    titleWeight: 600,
    bodyWeight: 430,
    labelWeight: 560,
    titleScale: 0.98,
    subtitleScale: 0.98,
    labelScale: 0.96,
    letterSpacing: 0,
    titleFill: "#f6efe4",
    subtitleFill: "#d5c4aa",
    lineFill: "#c7a46f",
    panelFill: "#14110d",
    panelOpacity: 0.54,
    panelEndOpacity: 0.04,
    cardFill: "#17130f",
    cardOpacity: 0.78,
    cardStroke: "#6f5a3c",
    labelFill: "#b58b52",
    labelTextFill: "#fff7ec",
    dotFill: "#c7a46f",
    darkPanelFill: "#050403",
    darkTitleFill: "#fff2dc",
    darkSubtitleFill: "#c9b18c",
    radiusScale: 0.82
  },
  "editorial-natural": {
    fontFamily: "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif",
    serifFontFamily: "Noto Serif SC, Source Han Serif SC, SimSun, serif",
    titleWeight: 520,
    bodyWeight: 400,
    labelWeight: 520,
    titleScale: 0.88,
    subtitleScale: 1,
    labelScale: 0.94,
    letterSpacing: 0,
    titleFill: "#20251f",
    subtitleFill: "#5e6658",
    lineFill: "#8c9a77",
    panelFill: "#fbfbf4",
    panelOpacity: 0.64,
    panelEndOpacity: 0.08,
    cardFill: "#fbfbf4",
    cardOpacity: 0.8,
    cardStroke: "#d8ddca",
    labelFill: "#667255",
    labelTextFill: "#fbfbf4",
    dotFill: "#8c9a77",
    darkPanelFill: "#141a13",
    darkTitleFill: "#f4f5ea",
    darkSubtitleFill: "#bfc8ae",
    radiusScale: 0.95
  }
};

function textOverlayEvidence(profile = {}, settings = {}) {
  const strategy = profile?.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {};
  return [
    profile.style,
    profile.material,
    profile.color,
    profile.colorPalette,
    profile.targetSpace,
    profile.lightUse,
    profile.lampType,
    profile.lampSubtype,
    profile.lampChannel,
    settings?.templateName,
    settings?.similarIntent,
    ...Object.values(strategy)
  ].map((item) => String(item || "")).join(" ").toLowerCase();
}

function textOverlayThemeKey(profile = {}, { settings = {}, tone = "" } = {}) {
  const text = textOverlayEvidence(profile, settings);
  if (/black|dark|luxury|premium|hotel|club|gallery|metal|\u9ed1|\u54d1\u9ed1|\u91d1\u5c5e|\u8f7b\u5962|\u9152\u5e97|\u5c55\u5385|\u9ad8\u7ea7/.test(text) || tone === "dark") return "dark-premium";
  if (/tech|industrial|minimal|office|commercial|\u79d1\u6280|\u5de5\u4e1a|\u6781\u7b80|\u5546\u4e1a|\u529e\u516c|\u5e72\u51c0|\u51b7\u767d/.test(text)) return "clean-tech";
  if (/wood|linen|natural|japanese|nordic|plant|\u6728|\u539f\u6728|\u81ea\u7136|\u65e5\u5f0f|\u5317\u6b27|\u7eff|\u690d\u7269/.test(text)) return "editorial-natural";
  if (/home|residential|bedroom|living|warm|soft|\u5bb6|\u5bb6\u5c45|\u4f4f\u5b85|\u5367\u5ba4|\u5ba2\u5385|\u6e29\u6696|\u6e29\u99a8|\u67d4\u548c/.test(text)) return "warm-home";
  return "default-commerce";
}

function normalizeTextOverlayTheme(theme = {}, fallbackKey = "default-commerce") {
  const key = TEXT_OVERLAY_THEME_PRESETS[fallbackKey] ? fallbackKey : "default-commerce";
  const merged = { ...TEXT_OVERLAY_THEME_PRESETS[key], ...(theme && typeof theme === "object" ? theme : {}) };
  merged.key = String(merged.key || fallbackKey || key);
  return merged;
}

function textOverlayTheme(profile = {}, context = {}) {
  const key = textOverlayThemeKey(profile, context);
  return {
    themeKey: key,
    theme: normalizeTextOverlayTheme({ key }, key)
  };
}

function attachTextOverlayTheme(overlay, profile = {}, context = {}) {
  if (!overlay) return overlay;
  const resolved = textOverlayTheme(profile, { ...context, tone: context.tone || overlay.tone || "" });
  return {
    ...overlay,
    themeKey: overlay.themeKey || resolved.themeKey,
    theme: normalizeTextOverlayTheme(overlay.theme, overlay.themeKey || resolved.themeKey)
  };
}

function commerceHeroTextOverlay(profile = {}, { tone = "light", fallbackTitle = "温润光境" } = {}) {
  const title = heroProductDescriptorTitle(profile, { fallbackTitle });
  const subtitle = heroMoodSubtitle(profile, title);
  return attachTextOverlayTheme({
    template: "commerce-detail-hero",
    title,
    subtitle,
    labels: [],
    tone,
    panel: "none"
  }, profile, { template: "commerce-detail-hero", tone });
}

function largeLampTextOverlayForSlot(category = "", slot = {}, profile = {}) {
  const lines = largeLampTextPlan(category, slot, profile).filter((line) => line && line !== "无");
  if (!lines.length) return null;
  const safeProfile = sanitizeRecognitionProfile(profile);
  const title = visibleTextLineValue(lines, ["标题", "主标题"])
    || cleanChineseOverlayText(slot.title || safeProfile.lampSubtype || "空间主灯", { maxLength: 8 });
  const subtitle = visibleTextLineValue(lines, ["副标题", "短文案"])
    || cleanChineseOverlayText(safeProfile.lampSubtype || safeProfile.lampType || "", { maxLength: 10 });
  const labels = visibleTextLineLabels(lines, ["标签", "标注", "短文案"])
    .concat(splitChineseOverlayLabels(largeLampFocus(slot, safeProfile), { maxItems: 3, maxLength: 8 }))
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (slot.id === "hero-main-space") {
    return commerceHeroTextOverlay(safeProfile, { tone: "light", fallbackTitle: title || "居家光影" });
  }
  if (String(category || "").toLowerCase() === "function") {
    return {
      template: "feature-cards",
      title,
      subtitle,
      labels: labels.slice(0, 4),
      tone: "light"
    };
  }
  if (String(category || "").toLowerCase() === "detail") {
    return {
      template: "detail-callout",
      title,
      subtitle: "",
      labels: labels.slice(0, 2),
      tone: "light"
    };
  }
  return {
    template: "corner-title",
    title,
    subtitle,
    labels: labels.slice(0, 2),
    tone: "light"
  };
}

function largeLampHeroTextAllowed(shot = {}, category = "") {
  return String(category || shot?.category || "").toLowerCase() === "scene"
    && String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || "") === "hero-main-space";
}

function largeLampSpatialScalePrompt(slot = {}, category = "") {
  const id = String(slot?.sequenceSlot || slot?.id || "");
  const value = String(category || slot?.category || "").toLowerCase();
  const text = cleanPromptPart([
    id,
    slot?.title,
    slot?.pageRole,
    slot?.suiteRole,
    slot?.contentClaim,
    slot?.focusPoint,
    slot?.viewMode,
    slot?.composition
  ].filter(Boolean).join("；"));
  const spatialIds = new Set([
    "hero-main-space",
    "living-scene",
    "bedroom-scene",
    "installed-real",
    "style-value",
    "lighting-function"
  ]);
  const excludedIds = new Set([
    "product-mood",
    "material-detail",
    "install-detail",
    "emitter-detail",
    "studio-real",
    "structure-function"
  ]);
  if (excludedIds.has(id)) return "";
  const spatialByCategory = value === "scene" || id === "installed-real";
  const spatialByText = /空间|应用|安装后|光效体验|光效|氛围|客厅|餐厅|卧室|书房|实拍感/.test(text);
  if (!spatialIds.has(id) && !spatialByCategory && !(["selling", "function", "real"].includes(value) && spatialByText)) return "";
  return "大灯空间比例锁：房间先行中远景，先保留完整地面下沿/家具主体/墙面/窗/门洞，再放天花真实比例主灯；主灯外轮廓高10%-16%、最高18%，下缘不越过画面高度35%，宁可偏小也不能偏大；家具无遮挡，画面保持完整住宅空间照片感。";
}

function largeLampSpatialRoomFirstPrompt(slot = {}, category = "") {
  if (!largeLampSpatialScalePrompt(slot, category)) return "";
  return "";
}

function largeLampSpatialStyleLine(line = "", slot = {}, category = "") {
  const value = cleanPromptPart(line);
  if (!value || !largeLampSpatialScalePrompt(slot, category)) return value;
  return value
    .replace(/空间焦点/g, "空间协调")
    .replace(/视觉焦点/g, "空间协调")
    .replace(/中心构图/g, "房间先行构图")
    .replace(/居中主视觉/g, "房间先行主视觉")
    .replace(/强调灯体尺度/g, "强调房间尺度")
    .replace(/突出环体交错关系与悬挂重心/g, "保持环体交错关系与真实悬挂重心")
    .replace(/突出主灯造型/g, "展示主灯与空间关系");
}

function largeLampProductIdentityPrompt(profile = {}, slot = {}, category = "") {
  const spatial = Boolean(largeLampSpatialScalePrompt(slot, category));
  return spatial
    ? "产品：只保留上传产品这一盏/一套主灯，保留关键轮廓、发光面、重心和安装关系；空间图不为展示结构放大主体。"
    : "产品：只使用上传图这一盏/一套大灯，完整主灯结构、真实比例、重心、灯罩/灯臂/吸顶盘/底盘/吊线或吊杆按原图保留。";
}

function largeLampSingleSubjectPrompt(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const connector = safeProfile.mountFamily === "chandelier"
    ? "同一吸顶盘、同一组吊线和同一安装中心"
    : "同一底盘、同一贴顶面和同一安装中心";
  return `大灯单主体组锁：画面只允许一个产品主体组；多头/多环/组合主灯必须连成${connector}；禁止前景一套背景一套、左右两个同款、镜像复制、反射复制或两处独立挂点。`;
}

function largeLampForbiddenStructureText(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const source = [
    safeProfile.visibleParts,
    safeProfile.requiredStructures,
    safeProfile.structureKeywords,
    safeProfile.installationMethod
  ].map((item) => String(item || "")).join("、");
  const raw = cleanPromptPart(safeProfile.forbiddenStructures)
    || "点状小灯体量、线性灯带、墙装灯、产品图不可见零件和其它灯具品类结构";
  return raw
    .split(/[，,、/；;。]+/)
    .map((item) => cleanPromptPart(item))
    .filter(Boolean)
    .filter((item) => {
      if (safeProfile.mountFamily === "chandelier" && /吊线|吊杆|链条|吸顶盘/.test(item) && /吊线|吊杆|链条|吸顶盘/.test(source)) return false;
      if (/灯臂/.test(item) && /灯臂/.test(source)) return false;
      if (/底盘/.test(item) && /底盘|吸顶盘/.test(source)) return false;
      return true;
    })
    .join("、") || "产品图不可见零件和其它灯具品类结构";
}

function largeLampDetailVisiblePlanPrompt({ slot = {}, category = "", profile = {}, userRequirement = "", settings = {} } = {}) {
  const focus = largeLampFocus(slot, profile);
  const userLine = cleanPromptPart(stripUserVisiblePlanningNoise(userRequirement))
    .replace(/^(?:请)?生成(?:\d+\s*张|十三张)?(?:灯具)?(?:详情页|详情图组|详情套图|套图|完整链路)$/i, "");
  const textLines = largeLampTextPlan(category, slot, profile, settings);
  const composition = [slot.composition, userLine ? `用户补充：${userLine}` : ""].filter(Boolean).join("；");
  return [
    `本张任务：${slot.title || categoryLabel(category)}`,
    `画面提示：${compactPromptPart(composition, 140)}`,
    `重点：${compactPromptPart(focus, 72)}`,
    `文字内容：${textLines.filter((line) => line && line !== "无").join("；") || "无"}`
  ].filter(Boolean).join("\n");
}

function largeLampGenerationPromptFromPlan(planPrompt = "", { profile = {}, category = "", shot = {}, settings = {} } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const composition = structuredPlanLine(planPrompt, "画面提示") || shot.promptRoute?.viewMode || "按本张大灯页面脚本构图";
  const goal = structuredPlanLine(planPrompt, "本张任务") || shot.description || categoryDescription(category, safeProfile);
  const focus = structuredPlanLine(planPrompt, "重点") || shot.promptRoute?.focusPoint || largeLampFocus({}, safeProfile);
  const textLines = structuredPlanTextLines(planPrompt).map((item) => item.slice(0, 14));
  const plannedTextLines = textLines.length ? textLines : modelDirectTextLinesFromOverlay(shot);
  const textRenderMode = textRenderModeForShot(shot, category, settings);
  const useLocalTextOverlay = textRenderMode === "local-overlay" && Boolean(shot?.textOverlay && plannedTextLines.length);
  const useModelDirectText = textRenderMode === "model-direct" && Boolean(shot?.textOverlay && plannedTextLines.length);
  const suiteStyleLine = largeLampSpatialStyleLine(shot?.promptRoute?.suiteStyleLine || productSuiteStyleLine(safeProfile, {}), shot?.promptRoute || shot, category);
  const spatialScalePrompt = largeLampSpatialScalePrompt(shot?.promptRoute || shot, category);
  const roomFirstPrompt = largeLampSpatialRoomFirstPrompt(shot?.promptRoute || shot, category);
  const singleSubjectPrompt = largeLampSingleSubjectPrompt(safeProfile);
  const nonCloseupLens = shotRequiresNonCloseupSpatialLens(shot, category)
    && !promptHasSpatialBriefContract(composition)
    ? nonCloseupSpatialLensBrief(safeProfile, settings)
    : "";
  const spatialLensShot = shotRequiresNonCloseupSpatialLens(shot, category);
  const nonCloseupGuard = spatialLensShot ? nonCloseupSpatialExecutionGuard(safeProfile, settings) : "";
  const spatialScaleForPrompt = spatialLensShot ? "" : spatialScalePrompt;
  const suiteLineForPrompt = spatialLensShot ? compactPromptPart(suiteStyleLine, 150) : suiteStyleLine;
  return [
    suiteLineForPrompt,
    `任务：${compactPromptPart(goal, spatialLensShot ? 54 : 64)}`,
    `画面：${compactPromptPart(composition, spatialLensShot ? 84 : 112)}`,
    nonCloseupLens,
    nonCloseupGuard,
    spatialScaleForPrompt,
    roomFirstPrompt,
    singleSubjectPrompt,
    `重点：${compactPromptPart(focus, 64)}`,
    largeLampProductIdentityPrompt(safeProfile, shot?.promptRoute || shot, category),
    "页名/序号/任务名不得入画。",
    useModelDirectText
      ? modelDirectTextPrompt(shot, safeProfile, settings, category)
      : useLocalTextOverlay
      ? localTextOverlayBasePrompt()
      : "文字：无。"
  ].filter(Boolean).join("\n");
}

function largeLampChannelLock(profile = {}, category = "", options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const isScene = String(category || "").toLowerCase() === "scene";
  const renderMode = options.textRenderMode || textRenderModeForShot({ ...(options.shot || {}), textOverlay: options.textOverlay }, category, options.settings || {});
  const localOverlay = renderMode === "local-overlay";
  const modelDirect = renderMode === "model-direct";
  const noTextRequested = !modelDirect && (Boolean(options.noTextRequested) || localOverlay);
  const allowText = !noTextRequested && (Boolean(options.allowText) || productPromptAllowsText(category));
  const spatialScalePrompt = options.skipSpatialLocks ? "" : largeLampSpatialScalePrompt(options.slot || options.shot || {}, category);
  const roomFirstPrompt = options.skipSpatialLocks ? "" : largeLampSpatialRoomFirstPrompt(options.slot || options.shot || {}, category);
  const singleSubjectPrompt = options.skipSingleSubject ? "" : largeLampSingleSubjectPrompt(safeProfile);
  const productIdentityPrompt = options.skipProductIdentity ? "" : largeLampProductIdentityPrompt(safeProfile, options.slot || options.shot || {}, category);
  const textPolicy = options.skipTextPolicy
    ? ""
    : localOverlay
    ? "文字：底图无可见文字；文案由应用后置叠加。"
    : modelDirect
    ? "文字：按已规划的简体中文版式生成，不新增任何其它文字。"
    : allowText
    ? "文字：可见文字只用规划好的简体中文短句；不写品牌、认证、进口芯片、专利、价格或未确认数字。"
    : "文字：无可见文字、品牌标志、水印、价格或随机符号。";
  return [
    "大灯独立通道：只使用完整主灯语义，不读取其它通道灯位、线性灯槽、壁装底座或通用商品图放大规则。",
    `结构：保留 ${safeProfile.requiredStructures || safeProfile.structureKeywords || safeProfile.visibleParts}。`,
    `排除：${largeLampForbiddenStructureText(safeProfile)}。`,
    singleSubjectPrompt,
    isScene && !options.skipSpatialLocks
      ? "场景：先构图完整住宅空间，再放置一盏/一套真实比例主灯；挂点/贴顶面、重心、阴影、透视和空间尺度必须可信。"
      : "",
    spatialScalePrompt,
    roomFirstPrompt,
    productIdentityPrompt,
    textPolicy
  ].filter(Boolean).join("\n");
}

function largeLampHiddenPrompt(prompt = "", { shot = {}, category = "", settings = {}, profile = {} } = {}) {
  if (!isProductWorkspaceSettings(settings) || !isLargeLampProfile(profile, settings) || isSmallLampProfile(profile, settings)) return "";
  const resolvedCategory = category || resolveShotTask({ ...shot, prompt });
  const suiteStyleLine = productSuiteStyleLine(profile, settings);
  const allowHeroText = largeLampHeroTextAllowed(shot, resolvedCategory);
  const existingPrompt = String(prompt || "");
  return joinPromptBlocksUnique([
    existingPrompt.trim(),
    existingPrompt.includes("整套视觉主题锁") ? "" : suiteStyleLine,
    largeLampChannelLock(profile, resolvedCategory, {
      allowText: allowHeroText,
      textOverlay: Boolean(shot?.textOverlay),
      textRenderMode: textRenderModeForShot(shot, resolvedCategory, settings),
      settings,
      noTextRequested: settingsRequestNoVisibleText(settings) || visiblePromptRequestsNoText([existingPrompt, shot.prompt].filter(Boolean).join(" "), resolvedCategory),
      shot,
      slot: shot?.promptRoute,
      skipTextPolicy: /文字[：:]\s*模型直接排版|底图不要生成任何可见文字|后置简体中文排版/.test(existingPrompt)
        || existingPrompt.includes("\u6a21\u578b\u76f4\u63a5\u751f\u6210\u89c4\u5212\u597d\u7684\u7b80\u4f53\u4e2d\u6587"),
      skipSpatialLocks: /大灯空间比例锁|大灯房间先行锁/.test(existingPrompt),
      skipSingleSubject: /大灯单主体组锁/.test(existingPrompt),
      skipProductIdentity: /(?:^|\n)产品[：:]/.test(existingPrompt)
    }),
    String(resolvedCategory).toLowerCase() === "scene" ? SINGLE_SCENE_IMAGE_LOCK : ""
  ]);
}

function applyLargeLampDetailStrategy({ shots = [], profile = {}, counts = {}, settings = {}, userRequirement = "" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!largeLampDetailStrategyEnabled(safeProfile, counts, settings)) {
    return { shots, applied: false };
  }
  const forceFullSuite = largeLampDetailSuiteRequested(settings, userRequirement) || totalCountFromServerCounts(counts) >= LARGE_LAMP_DETAIL_SEQUENCE.length;
  const sequence = largeLampDetailSequenceForShots(counts, shots, { forceFullSuite });
  const suiteStyleLine = productSuiteStyleLine(safeProfile, settings);
  const categoryCounters = {};
  const rewritten = sequence.map((slot, index) => {
    const shot = shots[index] || {};
    const category = slot.category || resolveShotTask(shot);
    categoryCounters[category] = (categoryCounters[category] || 0) + 1;
    const label = categoryLabel(category);
    const focus = largeLampFocus(slot, safeProfile);
    const routeForPrompt = {
      ...(shot.promptRoute || {}),
      source: "large-lamp-detail-strategy",
      category,
      label,
      sequenceIndex: index + 1,
      categoryIndex: categoryCounters[category],
      sequenceSlot: slot.id,
      pageRole: slot.role || slot.title || label,
      suiteRole: slot.role || slot.title || label,
      contentClaim: focus,
      suiteStyleLine,
      viewMode: slot.composition,
      focusPoint: focus,
      subjectLock: "strict-large-lamp",
      mountFamily: safeProfile.mountFamily,
      lampChannel: "large"
    };
    const prompt = largeLampDetailVisiblePlanPrompt({
      slot,
      category,
      profile: safeProfile,
      userRequirement,
      settings
    });
    const textOverlay = productWorkspaceTextEnabledForShot(settings, { ...shot, category, promptRoute: routeForPrompt }, category)
      ? attachTextOverlayTheme(largeLampTextOverlayForSlot(category, slot, safeProfile), safeProfile, { category, settings })
      : null;
    const textRenderMode = textRenderModeForShot({ ...shot, textRenderMode: "", category, textOverlay, promptRoute: routeForPrompt }, category, settings);
    return {
      ...shot,
      id: shot.id || `${slot.id}-${index + 1}`,
      category,
      title: `详情 ${index + 1} · ${slot.title}`,
      description: `${slot.role}：${focus}`,
      prompt: prompt.trim(),
      generationPrompt: largeLampGenerationPromptFromPlan(prompt, { profile: safeProfile, category, settings, shot: { ...shot, textOverlay, textRenderMode, promptRoute: routeForPrompt } }),
      textOverlay: textOverlay || undefined,
      textRenderMode,
      promptRoute: routeForPrompt,
      ratio: String(settings.ratio || shot.ratio || "3:4 竖版"),
      status: shot.status || "",
      imageUrl: shot.imageUrl || "",
      variationIndex: index + 1
    };
  });
  return { shots: rewritten, applied: true };
}

function smallLampDetailLayoutGuard(category = "", archetype = {}, profile = {}) {
  const value = String(category || "");
  const dynamicArchetype = smallLampDynamicSlotMeta(archetype, profile);
  const archetypeId = String(dynamicArchetype?.id || "");
  if (value === "selling") {
    const allowedText = cleanPromptPart(dynamicArchetype?.allowedText || "");
    return [
      "卖点图边界：卖点图必须是参考套图里的首屏氛围、单卖点海报或高级产品氛围方向。",
      "卖点图禁止生成产品检测室、白底实验室、爆炸图、结构拆解、参数表、光学剖面合集、四宫格技术说明、英文编号或意义不明文字。",
      "卖点图如出现任何可见文字，必须全部是简体中文；不得出现英文标题、英文说明、英文单词、拼音、英文缩写或中英混排。",
      allowedText ? `卖点图可见文字只能围绕这些简体中文短标签：${allowedText}。` : "",
      SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(archetypeId) ? "空间型卖点图必须以真实安装后的正常层高空间为主，镜头使用房间入口、走廊端头或家具外侧的观察距离。" : "",
      SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(archetypeId) ? "空间型卖点图默认 1-2 个可辨认小灯位；禁止把同一小灯复制成整排或多点展示阵列。" : "",
      archetypeId === "hero-poster" || archetypeId === "hero-scene" ? "首张主视觉必须以识别到的产品风格和核心材质气质为主，不要做技术说明页，也不要套用与产品无关的固定风格；如果使用空间场景，必须保持舒展层高和完整墙面/窗/门洞尺度，不要贴天花拍成低矮近景。" : ""
    ].filter(Boolean).join("\n");
  }
  if (value === "function") {
    const allowedText = cleanPromptPart(dynamicArchetype?.allowedText || "");
    return [
      "功能图边界：功能图必须是一个明确功能页面，只表达本张指定主题；可以使用卡片、参数、光谱或光束示意，但不能把多种不相关符号混在一起。",
      smallLampSubjectMultiplicityLock("function"),
      "功能图禁止白底产品检测室、爆炸图、拆开零件展示、英文标签、随机编号、繁体字、伪科学图标、无标签图表、眼球解剖图和意义不明的箭头曲线。",
      "功能图不要整句广告文案，只做少量简体中文短标签、清晰信息卡片或有明确含义的图形示意。",
      allowedText ? `功能图可见文字优先从这些简体中文短标签中选择：${allowedText}。禁止写无关文字。` : "",
      "功能图图标内部也不要出现任何英文字母、拼音或缩写；显色、护眼和光谱必须有中文标签，不能只放无说明的曲线、色块或图标。",
      "功能图不要生成完整参数表；禁止虚构电压、功率、频率、显色指数等数值。无法确认的参数只用图标或示意，不写数字。"
    ].filter(Boolean).join("\n");
  }
  if (value === "detail") {
    return [
      "细节图边界：只做材质、灯杯、发光口、光斑或安装局部特写，禁止爆炸拆解和检测室风格。",
      smallLampSubjectMultiplicityLock("detail")
    ].join("\n");
  }
  if (value === "scene") {
    return [
      "场景图边界：只能是完整连续真实空间，禁止参数表、技术剖面、检测室、拼贴和随机文字。",
      "场景图灯具数量必须合理有美感：灯位服务空间构图，不做商品复制展示；禁止满天花、随机散点、密集阵列和多个同等清晰主体。"
    ].filter(Boolean).join("\n");
  }
  return "";
}

function smallLampAllowedTextForSlot(slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const dynamicSlot = smallLampDynamicSlotMeta(slot, safeProfile);
  const id = String(slot.id || "");
  if (safeProfile.mountFamily === "recessed-downlight") {
    const material = smallLampMaterialLabel(safeProfile);
    const recessed = {
      "hero-poster": dynamicSlot.allowedText || "嵌入安装、面环贴合、柔和下照、舒适光感",
      "core-advantages": dynamicSlot.allowedText || "嵌入安装、面环贴合、柔和下照、舒适光感",
      "anti-glare-cup": "深杯防眩、见光不见灯、遮光更舒适",
      "size-install": "嵌入安装、吊顶开孔、面环贴合、安装示意",
      "material-closeup": `${material}、深杯细节、细腻边缘`,
      "beam-spot": "柔和光斑、集中下照、边缘自然"
    };
    if (recessed[id]) return recessed[id];
  }
  return cleanPromptPart(dynamicSlot.allowedText || "");
}

function smallLampTextOverlayForSlot(category = "", slot = {}, profile = {}) {
  const value = String(category || slot.category || "").toLowerCase();
  const slotId = String(slot.id || "");
  if (slotId === "hero-atmosphere") {
    return commerceHeroTextOverlay(profile, { tone: "light", fallbackTitle: "居家光影" });
  }
  if (slotId === "product-mood") return null;
  if (!["selling", "function", "detail"].includes(value)) return null;
  const safeProfile = sanitizeRecognitionProfile(profile);
  const dynamicSlot = smallLampDynamicSlotMeta(slot, safeProfile);
  const selling = splitChineseOverlayLabels(smallLampTrustedSellingText(safeProfile), { maxItems: 1, maxLength: 8 })[0]
    || smallLampDynamicLabels(safeProfile)[0]
    || "精致小灯";
  const productLabel = cleanChineseOverlayText(safeProfile.productName || safeProfile.lampSubtype || safeProfile.lampType, {
    fallback: safeProfile.mountFamily === "recessed-downlight" ? "嵌入式筒灯" : "小灯产品",
    maxLength: 10
  });
  const allowedLabels = splitChineseOverlayLabels(smallLampAllowedTextForSlot(slot, safeProfile), { maxItems: 5, maxLength: 8 });
  const materialLabels = splitChineseOverlayLabels(smallLampMaterialLabel(safeProfile), { maxItems: 2, maxLength: 6 });
  const fallbackLabels = safeProfile.mountFamily === "recessed-downlight"
    ? ["深杯防眩", "嵌入安装", "面环贴合", "柔和下照", "舒适光感", "金属质感"]
    : ["深杯防眩", "小体量", "金属质感", "柔和光斑", "舒适光感"];
  const labels = [...allowedLabels, ...materialLabels, ...fallbackLabels]
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (slotId === "core-advantages") {
    const coreLabels = [
      smallLampOpticalLabel(safeProfile) || labels[0],
      safeProfile.mountFamily === "recessed-downlight" ? "小体量" : labels[1],
      smallLampMaterialLabel(safeProfile) || labels[2],
      safeProfile.mountFamily === "recessed-downlight" ? "嵌入贴合" : (smallLampInstallLabel(safeProfile) || "真实安装")
    ].map((item) => cleanChineseOverlayText(item, { maxLength: 8 })).filter(Boolean);
    return {
      template: "advantage-editorial",
      title: cleanChineseOverlayText(dynamicSlot.title, { fallback: "核心优势", maxLength: 8 }),
      subtitle: productLabel,
      labels: coreLabels.filter((item, index, list) => list.indexOf(item) === index).slice(0, 4),
      tone: "dark"
    };
  }
  if (value === "function") {
    return {
      template: "feature-cards",
      title: cleanChineseOverlayText(dynamicSlot.title, { fallback: "核心优势", maxLength: 8 }),
      subtitle: productLabel,
      labels: labels.slice(0, 4),
      tone: "light"
    };
  }
  if (value === "detail") {
    return {
      template: "detail-callout",
      title: cleanChineseOverlayText(dynamicSlot.title, { fallback: "细节质感", maxLength: 8 }),
      subtitle: "",
      labels: labels.slice(0, 2),
      tone: "light"
    };
  }
  return {
    template: "corner-title",
    title: selling,
    subtitle: productLabel,
    labels: labels.slice(0, 2),
    tone: "light"
  };
}

function smallLampHeroTextAllowed(shot = {}, category = "") {
  return String(category || shot?.category || "").toLowerCase() === "scene"
    && String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || "") === "hero-atmosphere";
}

function smallLampHeroAtmosphereText(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const fields = [
    safeProfile.material,
    safeProfile.color,
    safeProfile.colorPalette,
    safeProfile.finish,
    safeProfile.style,
    safeProfile.visibleParts,
    safeProfile.lampSubtype,
    safeProfile.mountFamily
  ].map((item) => String(item || "")).join(" ");
  const mount = String(safeProfile.mountFamily || "");
  const material = smallLampMaterialLabel(safeProfile);
  let title = "舒适光感";
  let subtitle = "精致小灯";
  if (/recessed|嵌入|内嵌|面环/.test(mount + fields)) {
    title = "隐于顶面";
    subtitle = "轻盈光感";
  } else if (/surface|明装|贴顶|圆柱/.test(mount + fields)) {
    title = "贴顶小灯";
    subtitle = "克制光感";
  } else if (/track|轨道/.test(mount + fields)) {
    title = "轨道光感";
    subtitle = "灵活照明";
  } else if (/spot|射灯|可调/.test(mount + fields)) {
    title = "聚光氛围";
    subtitle = "角度可调";
  }
  if (/黑|哑黑|雅黑|black/i.test(fields)) {
    title = "哑黑轮廓";
  } else if (/拉丝|不锈钢|银|金属|铝|brushed|steel|metal/i.test(fields + material)) {
    title = "金属微光";
  } else if (/白|喷涂|white/i.test(fields)) {
    title = /嵌入|recessed/.test(mount + fields) ? title : "白色光感";
  } else if (/木|wood/i.test(fields)) {
    title = "温润光感";
  }
  return [`标题：${cleanChineseOverlayText(title, { fallback: "舒适光感", maxLength: 8 })}`, `副标题：${cleanChineseOverlayText(subtitle, { fallback: "精致小灯", maxLength: 8 })}`];
}

function smallLampVisibleTextPlan(category = "", slot = {}, profile = {}) {
  const slotId = String(slot.id || "");
  if (slotId === "hero-atmosphere") {
    return heroAtmosphereTextPlan(profile, { fallbackTitle: "居家光影" });
  }
  if (slotId === "product-mood") return ["无"];
  if (!productPromptAllowsText(category)) return ["无"];
  const safeProfile = sanitizeRecognitionProfile(profile);
  const dynamicSlot = smallLampDynamicSlotMeta(slot, safeProfile);
  const compact = compactSmallLampVisualStrategy(safeProfile) || {};
  const selling = cleanPromptPart(smallLampTrustedSellingText(safeProfile));
  const value = String(category || slot.category || "").toLowerCase();
  const allowedLabels = splitChineseOverlayLabels(smallLampAllowedTextForSlot(slot, safeProfile), { maxItems: 6, maxLength: 8 });
  const materialLabels = splitChineseOverlayLabels(smallLampMaterialLabel(safeProfile), { maxItems: 2, maxLength: 6 });
  const sellingLabels = splitChineseOverlayLabels(selling, { maxItems: 2, maxLength: 8 });
  const uniqueLabels = [...sellingLabels, ...allowedLabels, ...materialLabels]
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  const shortTitle = cleanPromptPart(selling)
    .replace(/[，。；:：、/].*$/, "")
    .slice(0, 12) || uniqueLabels[0] || cleanChineseOverlayText(safeProfile.lampSubtype, { fallback: "精致小灯", maxLength: 8 });
  if (slot.id === "hero-poster") {
    return [
      `主标题：${shortTitle}`,
      `副标题：${cleanChineseOverlayText(safeProfile.lightUse || compact.mood, { fallback: "舒适光感真实质感", maxLength: 12 })}`
    ];
  }
  if (value === "function") {
    return [
      `标题：${cleanChineseOverlayText(dynamicSlot.title, { fallback: "核心优势", maxLength: 8 })}`,
      `标签：${(uniqueLabels.length ? uniqueLabels : smallLampDynamicLabels(safeProfile)).slice(0, 4).join("、")}`
    ];
  }
  if (value === "detail") {
    return [
      `标题：${cleanChineseOverlayText(dynamicSlot.title, { fallback: "细节质感", maxLength: 8 })}`,
      `标注：${(uniqueLabels.length ? uniqueLabels : smallLampDynamicLabels(safeProfile)).slice(0, 2).join("、")}`
    ];
  }
  return [
    `标题：${cleanChineseOverlayText(dynamicSlot.title || categoryLabel(category), { fallback: "产品亮点", maxLength: 8 })}`,
    `短文案：${(uniqueLabels.length ? uniqueLabels : ["精致小灯"]).slice(0, 2).join("、")}`
  ];
}

function smallLampDetailVisiblePlanPrompt({ slot = {}, category = "", globalIndex = 0, total = 1, profile = {}, userRequirement = "", suiteContext = {}, sequence = [] } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const dynamicSlot = smallLampDynamicSlotMeta(slot, safeProfile);
  const focus = cleanPromptPart(dynamicSlot.subjectFocus) || smallLampPublicStructureText(safeProfile) || "产品真实结构、材质、发光口和安装关系";
  const viewMode = smallLampDetailViewMode(dynamicSlot, category);
  const userLine = cleanPromptPart(stripUserVisiblePlanningNoise(userRequirement))
    .replace(/^(?:请)?生成(?:\d+\s*张|十三张)?(?:灯具)?(?:详情页|详情图组|详情套图|套图|完整链路)$/i, "");
  const textLines = smallLampVisibleTextPlan(category, dynamicSlot, safeProfile);
  const contentClaim = smallLampSlotContentClaim(dynamicSlot, safeProfile);
  const designDirection = cleanPromptPart(suiteContext.themeLine) || "统一电商详情页主题，背景、留白、光影和文字气质保持同一套视觉语言";
  const taskLine = `${dynamicSlot.title || categoryLabel(category)}：${contentClaim}`;
  const imageLine = [
    viewMode,
    focus ? `重点表现${focus}` : "",
    userLine ? `用户补充：${userLine}` : ""
  ].filter(Boolean).join("；");
  const visibleText = textLines.filter((line) => line && line !== "无").join("；") || "无";
  const visualContract = smallLampDetailShotVisualContract(dynamicSlot, category, safeProfile);
  const promptContext = smallLampDetailPromptContextLine(dynamicSlot, category, viewMode);
  return [
    `本张任务：${dynamicSlot.title || categoryLabel(category)}`,
    `画面提示：${compactPromptPart([visualContract, promptContext].filter(Boolean).join("；"), 230)}`,
    focus ? `重点：${compactPromptPart(focus, 64)}` : "",
    `文字内容：${visibleText}`
  ].filter(Boolean).join("\n");
}

function isStructuredSmallLampPlanPrompt(prompt = "") {
  return /整体主题[：:]|本张任务[：:]|画面提示[：:]|产品复杂结构判定[：:]|图中图元素[：:]|内容要素[：:]|文字内容(?:（使用)?/.test(String(prompt || ""));
}

function structuredPlanLine(prompt = "", label = "") {
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(prompt || "").match(new RegExp(`(?:^|\\n)\\s*(?:•\\s*)?${escaped}[：:]\\s*([^\\n]+)`, "i"));
  return cleanPromptPart(match?.[1] || "");
}

function structuredPlanTextLines(prompt = "") {
  const lines = String(prompt || "").split(/\n+/);
  const inline = structuredPlanLine(prompt, "文字内容");
  if (inline && inline !== "无") {
    return splitChineseOverlayLabels(
      inline.replace(/(?:主标题|副标题|说明文字|标题|短文案方向|短文案|标签|标注)[：:]/g, ""),
      { maxItems: 5, maxLength: 12 }
    );
  }
  const start = lines.findIndex((line) => /文字内容（使用/.test(line));
  if (start < 0) return [];
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^特殊要求[：:]/.test(line.trim())) break;
    const text = line.replace(/^•\s*/, "").replace(/^(主标题|副标题|说明文字|标题|短文案方向|短文案|标签|标注)[：:]\s*/, "").trim();
    if (text && text !== "无") {
      splitChineseOverlayLabels(text, { maxItems: 4, maxLength: 12 }).forEach((item) => result.push(item));
    }
  }
  return result.filter((item, index, list) => list.indexOf(item) === index).slice(0, 5);
}

function compactStructuredSmallLampVisiblePrompt(prompt = "") {
  const title = cleanPromptPart(structuredPlanLine(prompt, "本张任务").replace(/[：:].*$/, ""))
    || cleanPromptPart(String(prompt || "").match(/(?:^|\n)\s*图\d+[：:]\s*([^\n]+)/)?.[1] || "");
  const contentClaim = structuredPlanLine(prompt, "本张内容认领");
  const goal = structuredPlanLine(prompt, "设计目标");
  const theme = structuredPlanLine(prompt, "整体主题") || structuredPlanLine(prompt, "页面设计方向");
  const image = structuredPlanLine(prompt, "画面提示") || structuredPlanLine(prompt, "页面构图");
  const focus = structuredPlanLine(prompt, "重点") || structuredPlanLine(prompt, "展示重点");
  const text = structuredPlanTextLines(prompt).join("；") || "无";
  const task = [title, contentClaim || goal].filter(Boolean).join("：") || goal || title;
  const imageLine = [image, focus ? `重点表现${focus}` : ""].filter(Boolean).join("；");
  return [
    theme ? `整体主题：${theme}` : "",
    task ? `本张任务：${task}` : "",
    imageLine ? `画面提示：${imageLine}` : "",
    `文字内容：${text}`
  ].filter(Boolean).join("\n");
}

function smallLampGenerationPromptFromPlan(planPrompt = "", { profile = {}, category = "", shot = {}, settings = {} } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const composition = structuredPlanLine(planPrompt, "画面提示") || structuredPlanLine(planPrompt, "页面构图") || shot.promptRoute?.viewMode || "按本张页面脚本选择构图";
  const title = cleanPromptPart(structuredPlanLine(planPrompt, "本张任务").replace(/[：:].*$/, "") || String(planPrompt || "").match(/(?:^|\n)\s*图\d+[：:]\s*([^\n]+)/)?.[1] || "") || shot.title || categoryLabel(category);
  const goal = structuredPlanLine(planPrompt, "本张任务") || structuredPlanLine(planPrompt, "设计目标") || shot.description || categoryDescription(category, safeProfile);
  const focus = structuredPlanLine(planPrompt, "重点")
    || structuredPlanLine(planPrompt, "展示重点")
    || cleanPromptPart(shot.promptRoute?.focusPoint || "")
    || (String(category || "").toLowerCase() === "scene"
      ? "完整家装空间尺度、真实灯位比例、墙面/地面光斑和居住氛围"
      : smallLampPublicStructureText(safeProfile))
    || "产品真实结构、材质、发光口和安装关系";
  const contentClaim = structuredPlanLine(planPrompt, "本张内容认领") || shot.promptRoute?.contentClaim || "";
  const viewAngle = structuredPlanLine(planPrompt, "本张镜头视角") || shot.promptRoute?.viewAngle || "";
  const sequenceId = String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || "");
  const sequenceSlot = smallLampDetailSequenceCatalog().find((item) => item.id === sequenceId)
    || SMALL_LAMP_DETAIL_SEQUENCE.find((item) => item.id === sequenceId)
    || null;
  let textLines = structuredPlanTextLines(planPrompt).map((item) => item.slice(0, 18));
  if (!textLines.length && sequenceId === "hero-atmosphere") {
    textLines = smallLampVisibleTextPlan(category, sequenceSlot || { id: "hero-atmosphere", category: "scene" }, safeProfile)
      .filter((line) => line && line !== "无")
      .map((line) => line.replace(/^(标题|副标题|标签|标注)[：:]/, "").slice(0, 18));
  }
  const plannedTextLines = textLines.length ? textLines : modelDirectTextLinesFromOverlay(shot);
  const textRenderMode = textRenderModeForShot(shot, category, settings);
  const useLocalTextOverlay = textRenderMode === "local-overlay" && Boolean(shot?.textOverlay && plannedTextLines.length);
  const useModelDirectText = textRenderMode === "model-direct" && Boolean(shot?.textOverlay && plannedTextLines.length);
  let textPrompt = useModelDirectText
    ? modelDirectTextPrompt(shot, safeProfile, settings, category)
    : useLocalTextOverlay
    ? localTextOverlayBasePrompt()
    : "文字：无。";
  const categoryValue = String(category || "").toLowerCase();
  const isSmallLampDetailRoute = smallLampIsDetailStrategyShot(shot);
  const sceneLine = categoryValue === "scene" && isSmallLampProfile(safeProfile, {}) && !isSmallLampDetailRoute
    ? smallLampLeanSceneLine(safeProfile, sequenceSlot)
    : "";
  const suiteStyleLine = cleanPromptPart(shot?.promptRoute?.suiteStyleLine || "");
  const taskIntent = cleanPromptPart(contentClaim || goal || categoryDescription(category, safeProfile))
    .replace(/^([^：:]{2,14})[：:]/, "")
    .replace(/详情\s*\d+\s*[·\-、]?\s*/g, "")
    .replace(new RegExp(cleanPromptPart(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "")
    .trim() || categoryDescription(category, safeProfile);
  const isScenePrompt = categoryValue === "scene";
  const taskLimit = isScenePrompt ? 54 : 72;
  const imageLimit = isSmallLampDetailRoute ? 150 : (isScenePrompt ? 96 : 120);
  const focusLimit = isScenePrompt ? 56 : 72;
  const includeClaim = Boolean(contentClaim && !isScenePrompt && cleanPromptPart(contentClaim) !== cleanPromptPart(taskIntent));
  const useSmallLampDetailSceneLens = isScenePrompt
    && isSmallLampProfile(safeProfile, {})
    && Boolean(sequenceSlot && SMALL_LAMP_SPATIAL_SEQUENCE_IDS.has(sequenceSlot.id));
  const nonCloseupLens = !useSmallLampDetailSceneLens && shotRequiresNonCloseupSpatialLens(shot, category)
    && !promptHasSpatialBriefContract([composition, viewAngle, sceneLine].filter(Boolean).join("；"))
    ? nonCloseupSpatialLensBrief(safeProfile, settings)
    : "";
  const spatialLensShot = shotRequiresNonCloseupSpatialLens(shot, category);
  const nonCloseupGuard = spatialLensShot && !useSmallLampDetailSceneLens ? nonCloseupSpatialExecutionGuard(safeProfile, settings) : "";
  return [
    suiteStyleLine,
    `任务：${compactPromptPart(taskIntent, taskLimit)}`,
    `画面：${compactPromptPart(composition, imageLimit)}`,
    viewAngle ? `镜头：${compactPromptPart(viewAngle, 72)}` : "",
    nonCloseupLens,
    nonCloseupGuard,
    includeClaim ? `只讲：${compactPromptPart(contentClaim, 48)}` : "",
    `重点：${compactPromptPart(focus, focusLimit)}`,
    sceneLine,
    "页名/序号/任务名不得入画。",
    textPrompt
  ].filter(Boolean).join("\n");
}

function generationPromptForShotPrompt(prompt = "", { profile = {}, category = "", shot = {}, settings = {} } = {}) {
  if (isStructuredSmallLampPlanPrompt(prompt) && isLargeLampProfile(profile, {}) && !isSmallLampProfile(profile, {})) {
    return largeLampGenerationPromptFromPlan(prompt, { profile, category, shot, settings });
  }
  if (isStructuredSmallLampPlanPrompt(prompt) && isWallLampProfile(profile, {}) && !isSmallLampProfile(profile, {}) && !isLargeLampProfile(profile, {})) {
    return wallLampGenerationPromptFromPlan(prompt, { profile, category, shot, settings });
  }
  if (isStructuredSmallLampPlanPrompt(prompt)) {
    return smallLampGenerationPromptFromPlan(prompt, { profile, category, shot, settings });
  }
  return normalizeProductVisiblePrompt(prompt, category);
}

function smallLampDetailPrompt({ shot = {}, sequenceSlot = null, globalIndex = 0, total = 1, profile = {}, settings = {}, files = [], userRequirement = "", suiteTheme = null } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const slot = sequenceSlot || SMALL_LAMP_DETAIL_SEQUENCE[0];
  const category = slot.category || resolveShotTask(shot);
  const sequence = Array.isArray(settings?.smallLampSequenceForPrompt) ? settings.smallLampSequenceForPrompt : [];
  const suiteContext = settings?.smallLampSuiteContext || smallLampSuiteContext(safeProfile, sequence, suiteTheme);
  return smallLampDetailVisiblePlanPrompt({
    slot,
    category,
    globalIndex,
    total,
    profile: safeProfile,
    userRequirement,
    suiteContext,
    sequence
  });
}

function applySmallLampDetailStrategy({ shots = [], profile = {}, counts = {}, settings = {}, files = [], userRequirement = "" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!smallLampDetailStrategyEnabled(safeProfile, counts, settings)) {
    return { shots, applied: false };
  }
  const forceFullSuite = smallLampDetailSuiteRequested(settings, userRequirement) || totalCountFromServerCounts(counts) >= SMALL_LAMP_RESIDENTIAL_DETAIL_SEQUENCE.length;
  const sequence = smallLampDetailSequenceForShots(counts, shots, { forceFullSuite });
  const total = sequence.length;
  const suiteTheme = smallLampDetailTheme(safeProfile, files, settings);
  const suiteContext = smallLampSuiteContext(safeProfile, sequence, suiteTheme);
  const suiteStyleLine = smallLampUnifiedSuiteStyleLine(safeProfile, suiteTheme);
  const categoryCounters = {};
  const rewritten = sequence.map((sequenceSlot, index) => {
    const dynamicSlot = smallLampDynamicSlotMeta(sequenceSlot, safeProfile);
    const shot = shots[index] || {};
    const category = dynamicSlot.category || resolveShotTask(shot);
    categoryCounters[category] = (categoryCounters[category] || 0) + 1;
    const label = categoryLabel(category);
    const routeForPrompt = {
      ...(shot.promptRoute || {}),
      source: "small-lamp-detail-strategy",
      category,
      label,
      sequenceIndex: index + 1,
      categoryIndex: categoryCounters[category],
      sequenceSlot: dynamicSlot.id,
      pageRole: dynamicSlot.visualGoal || dynamicSlot.title || label,
      suiteRole: dynamicSlot.visualGoal || dynamicSlot.title || label,
      storyBeat: smallLampSlotStoryBeat(dynamicSlot, index),
      contentClaim: smallLampSlotContentClaim(dynamicSlot, safeProfile),
      viewAngle: smallLampSlotViewAngle(dynamicSlot, category),
      avoidRepeatWith: smallLampAvoidRepeatLine(dynamicSlot, sequence.map((item) => smallLampDynamicSlotMeta(item, safeProfile)), index),
      suiteTheme: suiteContext.themeLine,
      suiteStyleLine,
      viewMode: smallLampDetailViewMode(dynamicSlot, category),
      visualContract: smallLampDetailShotVisualContract(dynamicSlot, category, safeProfile),
      subjectPolicy: smallLampDetailSubjectPolicy(dynamicSlot, category, safeProfile),
      focusPoint: dynamicSlot.subjectFocus || smallLampPublicStructureText(safeProfile),
      themeId: suiteTheme.id,
      themeName: suiteTheme.name,
      subjectLock: "strict",
      mountFamily: safeProfile.mountFamily,
      lampChannel: lampChannelSpec(safeProfile, settings).channel
    };
    const prompt = smallLampDetailPrompt({
      shot,
      sequenceSlot: dynamicSlot,
      globalIndex: index,
      total,
      profile: safeProfile,
      settings: { ...settings, smallLampSuiteContext: suiteContext, smallLampSequenceForPrompt: sequence },
      files,
      userRequirement,
      suiteTheme
    });
    const textOverlay = productWorkspaceTextEnabledForShot(settings, { ...shot, category, promptRoute: routeForPrompt }, category)
      ? attachTextOverlayTheme(smallLampTextOverlayForSlot(category, dynamicSlot, safeProfile), safeProfile, { category, settings })
      : undefined;
    const textRenderMode = textRenderModeForShot({ ...shot, textRenderMode: "", category, textOverlay, promptRoute: routeForPrompt }, category, settings);
    return {
      ...shot,
      id: shot.id || `${dynamicSlot.id}-${index + 1}`,
      category,
      title: `详情 ${index + 1} · ${dynamicSlot.title}`,
      description: `${dynamicSlot.visualGoal}：${dynamicSlot.subjectFocus}`,
      prompt: prompt.trim(),
      generationPrompt: smallLampGenerationPromptFromPlan(prompt, { profile: safeProfile, category, settings, shot: { ...shot, textOverlay, textRenderMode, promptRoute: routeForPrompt } }),
      textOverlay,
      textRenderMode,
      promptRoute: routeForPrompt,
      ratio: String(settings.ratio || shot.ratio || "3:4 竖版"),
      status: shot.status || "",
      imageUrl: shot.imageUrl || "",
      variationIndex: index + 1
    };
  });
  return { shots: rewritten, applied: true };
}

const WALL_LAMP_DETAIL_SEQUENCE = [
  {
    id: "wall-hero-atmosphere",
    category: "scene",
    title: "墙面氛围首屏",
    role: "建立壁灯详情页第一眼的高级家装气质",
    focusKey: "style",
    composition: "完整住宅墙面空间，中远景，能看到墙面、床头/边柜/装饰画或门洞尺度，壁灯按真实墙装比例出现，留出高级中文标题位置",
    viewMode: "完整墙面中远景，首屏画册构图，留白克制",
    cameraAngle: "正面墙面或轻微斜侧墙面，正常人眼高度",
    scaleBand: "产品占画面约 6%-16%",
    distanceClass: "space"
  },
  {
    id: "bedside-reading-scene",
    category: "scene",
    title: "床头阅读场景",
    role: "展示床头或阅读区的贴墙安装和局部光感",
    focusKey: "light",
    composition: "卧室床头或阅读角斜侧视角，保留床头、墙面、边几和局部地面尺度，壁灯贴墙安装，光线服务阅读或氛围",
    viewMode: "床头侧向生活场景，中远景",
    cameraAngle: "斜侧墙面，略带纵深",
    scaleBand: "产品占画面约 8%-14%",
    distanceClass: "semi-space"
  },
  {
    id: "wall-product-mood",
    category: "main",
    title: "产品气质主图",
    role: "完整展示壁灯本体和材质气质",
    focusKey: "structure",
    composition: "中景产品摄影，完整展示底座、灯臂/灯罩或发光面，背景干净高级，柔和落影，不做功能卡片",
    viewMode: "产品中景，完整主体，三分或居中构图",
    cameraAngle: "正面或 30 度侧前方",
    scaleBand: "产品占画面约 35%-48%",
    distanceClass: "mid"
  },
  {
    id: "entry-corridor-scene",
    category: "scene",
    title: "玄关走廊场景",
    role: "展示玄关或走廊的墙面光斑和空间动线",
    focusKey: "light",
    composition: "住宅玄关或走廊纵深视角，能看到连续墙面、地面、柜体或门洞尺度，壁灯只作为真实墙面照明节点",
    viewMode: "走廊纵深空间，中远景",
    cameraAngle: "沿墙面斜向纵深",
    scaleBand: "产品占画面约 6%-12%",
    distanceClass: "space"
  },
  {
    id: "core-wall-reason",
    category: "selling",
    title: "核心购买理由",
    role: "只讲一个壁灯核心卖点",
    focusKey: "selling",
    composition: "海报式中景，产品与墙面光影配合，一句高级简体中文短标题，不做多卖点合集或参数表",
    viewMode: "卖点中景海报，留白充足",
    cameraAngle: "正侧墙面或产品 30 度角",
    scaleBand: "产品占画面约 22%-35%",
    distanceClass: "mid"
  },
  {
    id: "wall-lighting-function",
    category: "function",
    title: "出光功能",
    role: "展示壁灯上下出光、洗墙、阅读或氛围补光",
    focusKey: "light",
    composition: "墙面正侧视角，清楚呈现出光方向、墙面光斑和环境明暗层次，可有少量中文功能标签",
    viewMode: "功能中景，墙面光效为主",
    cameraAngle: "正侧墙面，略低或平视",
    scaleBand: "产品占画面约 18%-35%",
    distanceClass: "function-mid"
  },
  {
    id: "wall-base-install-detail",
    category: "detail",
    title: "底座安装细节",
    role: "证明墙面底座和接触面可信",
    focusKey: "install",
    composition: "中近景只拍一个真实连接局部，展示完整底座、墙体接触面、边缘贴合和一小段灯臂，周围墙面留白清楚，局部不贴脸占满画面，不做爆炸拆解",
    viewMode: "中近景，单一安装证据",
    cameraAngle: "墙面侧前方，保留周围墙面留白",
    scaleBand: "局部占画面约 22%-36%",
    distanceClass: "mid-close"
  },
  {
    id: "wall-material-detail",
    category: "detail",
    title: "材质细节",
    role: "证明材质、边缘和表面工艺",
    focusKey: "material",
    composition: "中近景展示金属、玻璃、亚克力、喷涂、边缘倒角或表面纹理中的一个重点，背景克制干净",
    viewMode: "材质中近景，浅景深",
    cameraAngle: "侧光微距或斜侧近景",
    scaleBand: "局部占画面约 45%-65%",
    distanceClass: "mid-close"
  },
  {
    id: "wall-adjust-function",
    category: "function",
    title: "使用功能",
    role: "展示可调角度或光效范围",
    focusKey: "adjust",
    composition: "中景功能页；如产品有可调灯臂/灯头，展示角度变化和照射方向，否则展示墙面光效范围与使用距离",
    viewMode: "功能中景，回到完整壁灯和墙面关系",
    cameraAngle: "斜侧墙面，能看到出光方向",
    scaleBand: "产品占画面约 18%-32%",
    distanceClass: "mid"
  },
  {
    id: "soft-decoration-fit",
    category: "selling",
    title: "软装适配",
    role: "表达壁灯与家装风格的搭配价值",
    focusKey: "style",
    composition: "半空间视角，墙面、床头、玄关或客厅背景墙搭配，产品比例真实，画面克制高级，不做参数堆叠",
    viewMode: "半空间搭配，中景到中远景",
    cameraAngle: "斜侧墙面或背景墙三分构图",
    scaleBand: "产品占画面约 12%-22%",
    distanceClass: "semi-space"
  },
  {
    id: "living-wall-scene",
    category: "scene",
    title: "背景墙场景",
    role: "展示客厅或餐厅背景墙装饰照明",
    focusKey: "style",
    composition: "客厅或餐厅完整背景墙中远景，保留沙发/餐桌、墙面、地面或门窗尺度，壁灯贴墙出现，不放大成主灯",
    viewMode: "完整背景墙中远景",
    cameraAngle: "平视或轻微斜侧",
    scaleBand: "产品占画面约 6%-16%",
    distanceClass: "space"
  },
  {
    id: "emitter-shade-detail",
    category: "detail",
    title: "发光面细节",
    role: "证明灯罩、透光面或出光方向",
    focusKey: "emitter",
    composition: "中近景聚焦灯罩、透光面、边缘和出光方向，保持产品真实结构，不连续重复材质近景",
    viewMode: "中近景，发光面和墙面光边界",
    cameraAngle: "侧前方近景",
    scaleBand: "局部占画面约 38%-58%",
    distanceClass: "close"
  },
  {
    id: "installed-wall-real",
    category: "real",
    title: "安装后实拍感",
    role: "建立真实使用状态和现场可信度",
    focusKey: "install",
    composition: "真实住宅安装现场感，能看到墙面阴影、接触点、环境光和少量生活尺度参照，画面自然，不做海报排版",
    viewMode: "安装后真实空间，中景或中远景",
    cameraAngle: "手机实拍感平视斜侧",
    scaleBand: "产品占画面约 10%-20%",
    distanceClass: "semi-space"
  }
];

function wallLampDetailSequenceCatalog() {
  return WALL_LAMP_DETAIL_SEQUENCE;
}

function wallLampDetailSuiteRequested(settings = {}, userRequirement = "") {
  const text = cleanPromptPart([
    userRequirement,
    settings?.layout,
    settings?.requirement,
    settings?.prompt,
    settings?.detailMode,
    settings?.lampCategory,
    settings?.lampCategoryLabel,
    settings?.lampCategoryHint
  ].filter(Boolean).join("；"));
  if (!isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  const wallRequested = /壁灯|壁装|墙装|墙面安装|wall\s*(?:lamp|light)?/i.test(text);
  const fullSuite = /13\s*张|十三张|完整\s*13\s*张|完整十三张|全套\s*13|13\s*张\s*(?:详情页|详情图组|详情套图|套图)|完整链路/.test(text);
  return Boolean(settings.wallLampFullDetailSuite) || (wallRequested && fullSuite);
}

function wallLampFullDetailCounts(counts = {}) {
  const current = normalizeCounts(counts);
  const total = totalCountFromServerCounts(current);
  if (total >= WALL_LAMP_DETAIL_SEQUENCE.length) return current;
  return {
    ...current,
    main: 1,
    selling: 2,
    function: 2,
    scene: 4,
    detail: 3,
    real: 1
  };
}

function wallLampDetailSequenceTotal(counts = {}, shots = [], options = {}) {
  if (options.forceFullSuite) return WALL_LAMP_DETAIL_SEQUENCE.length;
  const total = totalCountFromServerCounts(counts) || shots.length || 5;
  return Math.max(1, Math.min(WALL_LAMP_DETAIL_SEQUENCE.length, Math.floor(Number(total) || 5)));
}

function wallLampDetailSequenceForShots(counts = {}, shots = [], options = {}) {
  const catalog = wallLampDetailSequenceCatalog();
  if (!options.forceFullSuite) {
    const current = Object.fromEntries(SHOT_CATEGORY_KEYS.map((key) => [key, Math.max(0, Number(counts?.[key] || 0))]));
    const total = totalCountFromServerCounts(current) || shots.length || 0;
    if (total > 0 && total < catalog.length) {
      const selected = [];
      const used = new Set();
      const addSlot = (slot) => {
        if (!slot || used.has(slot.id)) return false;
        selected.push(slot);
        used.add(slot.id);
        return true;
      };
      const addCategory = (category, count, preferredIds = []) => {
        let remaining = Math.max(0, Number(count || 0));
        preferredIds.forEach((id) => {
          if (remaining > 0 && addSlot(catalog.find((slot) => slot.id === id))) remaining -= 1;
        });
        for (const slot of catalog) {
          if (remaining <= 0) break;
          if (slot.category === category && addSlot(slot)) remaining -= 1;
        }
      };
      addCategory("scene", current.scene, ["wall-hero-atmosphere"]);
      addCategory("function", current.function, ["wall-lighting-function"]);
      addCategory("detail", current.detail, ["wall-base-install-detail"]);
      addCategory("selling", current.selling, ["core-wall-reason"]);
      addCategory("main", current.main, ["wall-product-mood"]);
      addCategory("real", current.real, ["installed-wall-real"]);
      for (const slot of catalog) {
        if (selected.length >= total) break;
        addSlot(slot);
      }
      return selected.slice(0, total);
    }
  }
  return catalog.slice(0, wallLampDetailSequenceTotal(counts, shots, options));
}

function wallLampTextEvidence(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    safeProfile.productName,
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.material,
    safeProfile.colorPalette,
    safeProfile.visibleParts,
    safeProfile.structureKeywords,
    safeProfile.installationMethod,
    safeProfile.lightUse,
    safeProfile.sellingPoint,
    safeProfile.sellingPoints,
    safeProfile.adjustable,
    safeProfile.visualStrategy?.productStyle,
    safeProfile.visualStrategy?.lightingEffect,
    safeProfile.visualStrategy?.hardConstraints
  ].map(cleanPromptPart).filter(Boolean).join("；");
}

function wallLampHasAdjustableStructure(profile = {}) {
  return /可调|调节|转轴|旋钮|灯头可调|灯臂可调|摆角|旋转|adjust|swivel|pivot|rotate|tilt/i.test(wallLampTextEvidence(profile));
}

function wallLampFocus(slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = cleanPromptPart([safeProfile.material, safeProfile.colorPalette].filter(Boolean).join("，"));
  const adjustable = wallLampHasAdjustableStructure(safeProfile);
  const map = {
    selling: cleanPromptPart(safeProfile.sellingPoint || safeProfile.sellingPoints || safeProfile.lightUse) || "墙面氛围、装饰质感和稳定安装",
    material: material || "灯体材质、表面纹理和边缘工艺",
    light: cleanPromptPart(safeProfile.lightUse || safeProfile.visualStrategy?.lightingEffect) || "上下出光、洗墙光斑和局部氛围补光",
    structure: cleanPromptPart(safeProfile.structureKeywords || safeProfile.visibleParts) || "墙面底座、灯臂/灯罩、发光面和墙装接触面",
    install: cleanPromptPart(safeProfile.installationMethod || safeProfile.installationPosition) || "墙面底座、接触面、阴影和安装可信度",
    style: cleanPromptPart(safeProfile.visualStrategy?.productStyle || safeProfile.style || safeProfile.targetSpace) || "壁灯造型和家装软装适配",
    emitter: cleanPromptPart(safeProfile.visibleParts || safeProfile.lightUse) || "灯罩、发光面、透光边缘和出光方向",
    adjust: adjustable
      ? "可调灯臂/灯头、照射方向和使用角度"
      : "墙面光效范围、局部照明和使用距离"
  };
  const focus = cleanPromptPart(slot.focus || map[slot.focusKey] || map.structure);
  return focus && focus !== "?" ? focus : "壁灯真实结构、墙装比例、材质和墙面光效";
}

function wallLampTextPlan(category = "", slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const isHero = slot.id === "wall-hero-atmosphere";
  if (!isHero && !productPromptAllowsText(category)) return ["无"];
  const focus = splitChineseOverlayLabels(wallLampFocus(slot, safeProfile), { maxItems: 3, maxLength: 8 });
  const selling = splitChineseOverlayLabels(safeProfile.sellingPoint || safeProfile.lightUse || safeProfile.visualStrategy?.productStyle, { maxItems: 2, maxLength: 8 });
  const labels = [...selling, ...focus]
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (isHero) {
    return heroAtmosphereTextPlan(safeProfile, { fallbackTitle: "墙面光境" });
  }
  if (category === "function") return [`标题：${cleanChineseOverlayText(slot.title, { maxLength: 8 })}`, `标签：${labels.slice(0, 4).join("、") || "墙面光效、安装稳定"}`];
  if (category === "detail") return [`标题：${cleanChineseOverlayText(slot.title, { maxLength: 8 })}`, `标注：${labels.slice(0, 2).join("、") || "墙装细节"}`];
  if (category === "selling") return [`标题：${cleanChineseOverlayText(labels[0] || slot.title, { maxLength: 8 })}`];
  return ["无"];
}

function wallLampTextOverlayForSlot(category = "", slot = {}, profile = {}) {
  const lines = wallLampTextPlan(category, slot, profile).filter((line) => line && line !== "无");
  if (!lines.length) return null;
  const safeProfile = sanitizeRecognitionProfile(profile);
  const title = visibleTextLineValue(lines, ["标题", "主标题"])
    || cleanChineseOverlayText(slot.title || safeProfile.lampSubtype || "墙面微光", { maxLength: 8 });
  const subtitle = visibleTextLineValue(lines, ["副标题", "短文案"])
    || cleanChineseOverlayText(safeProfile.lampSubtype || safeProfile.lampType || "高级壁灯", { maxLength: 14 });
  const labels = visibleTextLineLabels(lines, ["标签", "标注", "短文案"])
    .concat(splitChineseOverlayLabels(wallLampFocus(slot, safeProfile), { maxItems: 3, maxLength: 8 }))
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  if (slot.id === "wall-hero-atmosphere") {
    return commerceHeroTextOverlay(safeProfile, { tone: "light", fallbackTitle: title || "墙面光境" });
  }
  if (String(category || "").toLowerCase() === "function") {
    return {
      template: "feature-cards",
      title,
      subtitle,
      labels: labels.slice(0, 4),
      tone: "light"
    };
  }
  if (String(category || "").toLowerCase() === "detail") {
    return {
      template: "detail-callout",
      title,
      subtitle: "",
      labels: labels.slice(0, 2),
      tone: "light"
    };
  }
  return {
    template: "corner-title",
    title,
    subtitle,
    labels: labels.slice(0, 2),
    tone: "light"
  };
}

function wallLampHeroTextAllowed(shot = {}, category = "") {
  return String(category || shot?.category || "").toLowerCase() === "scene"
    && String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || "") === "wall-hero-atmosphere";
}

function wallLampDetailVisiblePlanPrompt({ slot = {}, category = "", profile = {}, userRequirement = "", previousSlot = null } = {}) {
  const focus = wallLampFocus(slot, profile);
  let userLine = cleanPromptPart(stripUserVisiblePlanningNoise(userRequirement))
    .replace(/^(?:请)?生成(?:\d+\s*张|十三张)?(?:灯具|壁灯)?(?:详情页|详情图组|详情套图|套图|完整链路)$/i, "");
  if (/^(?:\d+\s*张?|13|十三|[?\s\d]+)$/.test(userLine)) userLine = "";
  const textLines = wallLampTextPlan(category, slot, profile);
  const viewLine = [
    slot.viewMode,
    slot.cameraAngle ? `镜头=${slot.cameraAngle}` : "",
    slot.scaleBand ? `比例=${slot.scaleBand}` : ""
  ].filter(Boolean).join("；");
  const variationLine = previousSlot
    ? `与上一张区分：上一张是${previousSlot.distanceClass || "其它距离"} / ${previousSlot.cameraAngle || previousSlot.viewMode || "其它视角"}，本张必须换成${slot.distanceClass || "新距离"} / ${slot.cameraAngle || slot.viewMode || "新视角"}。`
    : "首张用完整空间和高级留白建立整体气质。";
  const composition = [
    slot.composition,
    variationLine,
    userLine ? `用户补充：${userLine}` : ""
  ].filter(Boolean).join("；");
  return [
    `本张任务：${slot.title || categoryLabel(category)}`,
    `画面提示：${compactPromptPart(composition, 150)}`,
    `视角比例：${compactPromptPart(viewLine, 100)}`,
    `重点：${compactPromptPart(focus, 72)}`,
    `文字内容：${textLines.filter((line) => line && line !== "无").join("；") || "无"}`
  ].filter(Boolean).join("\n");
}

function wallLampGenerationPromptFromPlan(planPrompt = "", { profile = {}, category = "", shot = {}, settings = {} } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const route = shot?.promptRoute || {};
  const sequenceId = String(route.sequenceSlot || shot?.sequenceSlot || "");
  const composition = structuredPlanLine(planPrompt, "画面提示") || route.viewMode || "按本张壁灯页面脚本构图";
  const goal = structuredPlanLine(planPrompt, "本张任务") || shot.description || categoryDescription(category, safeProfile);
  const viewScale = structuredPlanLine(planPrompt, "视角比例") || [route.viewMode, route.cameraAngle, route.scaleBand].filter(Boolean).join("；");
  const focus = structuredPlanLine(planPrompt, "重点") || route.focusPoint || wallLampFocus({}, safeProfile);
  const textLines = structuredPlanTextLines(planPrompt).map((item) => item.slice(0, 14));
  const plannedTextLines = textLines.length ? textLines : modelDirectTextLinesFromOverlay(shot);
  const textRenderMode = textRenderModeForShot(shot, category, settings);
  const useLocalTextOverlay = textRenderMode === "local-overlay" && Boolean(shot?.textOverlay && plannedTextLines.length);
  const useModelDirectText = textRenderMode === "model-direct" && Boolean(shot?.textOverlay && plannedTextLines.length);
  let textPrompt = useModelDirectText
    ? modelDirectTextPrompt(shot, safeProfile, settings, category)
    : useLocalTextOverlay
    ? localTextOverlayBasePrompt()
    : "文字：无。";
  const sceneScale = String(category || "").toLowerCase() === "scene"
    ? "场景比例：先成立完整住宅墙面、家具、门洞、床头、走廊或地面尺度，再放入真实比例壁灯；壁灯作为墙面照明节点服务空间构图。"
    : "";
  const closeupGuard = route.distanceClass === "close"
    ? "近景边界：只证明一个真实局部，下一张必须回到中景或空间图；不做连续近景堆叠。"
    : "";
  const suiteStyleLine = cleanPromptPart(route.suiteStyleLine || productSuiteStyleLine(safeProfile, {}));
  const nonCloseupLens = shotRequiresNonCloseupSpatialLens(shot, category)
    && !promptHasSpatialBriefContract([composition, viewScale].filter(Boolean).join("；"))
    ? nonCloseupSpatialLensBrief(safeProfile, settings)
    : "";
  const spatialLensShot = shotRequiresNonCloseupSpatialLens(shot, category);
  const nonCloseupGuard = spatialLensShot ? nonCloseupSpatialExecutionGuard(safeProfile, settings) : "";
  return [
    suiteStyleLine,
    `任务：${compactPromptPart(goal, 64)}`,
    `画面：${compactPromptPart(composition, 120)}`,
    viewScale ? `视角/比例：${compactPromptPart(viewScale, 104)}` : "",
    nonCloseupLens,
    nonCloseupGuard,
    sceneScale,
    closeupGuard,
    `重点：${compactPromptPart(focus, 64)}`,
    "产品：只使用上传图这一套壁灯，保留墙面底座、接触面、灯臂/灯罩或发光面、材质颜色和真实墙装比例。",
    "页名/序号/任务名不得入画。",
    textPrompt
  ].filter(Boolean).join("\n");
}

function wallLampChannelLock(profile = {}, category = "", options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const route = options.slot || options.shot?.promptRoute || {};
  const isScene = String(category || "").toLowerCase() === "scene";
  const renderMode = options.textRenderMode || textRenderModeForShot({ ...(options.shot || {}), textOverlay: options.textOverlay }, category, options.settings || {});
  const allowText = renderMode === "model-direct" || Boolean(options.allowText) || productPromptAllowsText(category) || wallLampHeroTextAllowed(options.shot || {}, category);
  return [
    "壁灯独立通道：只使用墙面底座、墙体接触面、灯臂/灯罩或壁装发光面、出光方向和墙面阴影。",
    "产品锁：最终画面只保留上传产品这一套壁灯；不在其它墙面复制同款，也不扩展成装饰灯阵。",
    "安装锁：底座必须贴合墙体，接触点、投影、阴影和出光方向与墙面一致；产品不能悬空或变成其它品类结构。",
    route.scaleBand ? `本张比例：${route.scaleBand}。` : "",
    route.cameraAngle ? `本张视角：${route.cameraAngle}。` : "",
    route.distanceClass ? `距离变化：本张为${route.distanceClass}，整套必须在空间、中景、近景之间轮换。` : "",
    isScene ? "场景锁：保留完整住宅墙面、家具、门洞、床头、走廊或地面尺度，先构图高级家装空间，再放入真实比例壁灯。" : "",
    options.skipTextPolicy
      ? ""
      : renderMode === "model-direct"
      ? "文字：按已规划的简体中文版式生成，不新增任何其它文字。"
      : allowText
      ? "文字：只使用规划好的简体中文短句；不写品牌、认证、价格或未确认数字。"
      : "文字：无可见文字、品牌标志、水印、价格或随机符号。"
  ].filter(Boolean).join("\n");
}

function wallLampHiddenPrompt(prompt = "", { shot = {}, category = "", settings = {}, profile = {} } = {}) {
  if (!isProductWorkspaceSettings(settings) || !isWallLampProfile(profile, settings) || isSmallLampProfile(profile, settings) || isLargeLampProfile(profile, settings)) return "";
  const resolvedCategory = category || resolveShotTask({ ...shot, prompt });
  const suiteStyleLine = productSuiteStyleLine(profile, settings);
  const allowHeroText = wallLampHeroTextAllowed(shot, resolvedCategory);
  const existingPrompt = String(prompt || "");
  return joinPromptBlocksUnique([
    existingPrompt.trim(),
    existingPrompt.includes("整套视觉主题锁") ? "" : suiteStyleLine,
    wallLampChannelLock(profile, resolvedCategory, {
      allowText: allowHeroText,
      textOverlay: Boolean(shot?.textOverlay),
      textRenderMode: textRenderModeForShot(shot, resolvedCategory, settings),
      settings,
      shot,
      slot: shot?.promptRoute,
      skipTextPolicy: /文字[：:]\s*模型直接排版|模型直接生成规划好的简体中文|底图不要生成任何可见文字|后置简体中文排版/.test(existingPrompt)
    }),
    String(resolvedCategory).toLowerCase() === "scene" ? SINGLE_SCENE_IMAGE_LOCK : ""
  ]);
}

function applyWallLampDetailStrategy({ shots = [], profile = {}, counts = {}, settings = {}, userRequirement = "" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!wallLampDetailStrategyEnabled(safeProfile, counts, settings)) {
    return { shots, applied: false };
  }
  const forceFullSuite = wallLampDetailSuiteRequested(settings, userRequirement) || totalCountFromServerCounts(counts) >= WALL_LAMP_DETAIL_SEQUENCE.length;
  const sequence = wallLampDetailSequenceForShots(counts, shots, { forceFullSuite });
  const suiteStyleLine = productSuiteStyleLine(safeProfile, settings);
  const categoryCounters = {};
  const rewritten = sequence.map((slot, index) => {
    const shot = shots[index] || {};
    const previousSlot = sequence[index - 1] || null;
    const category = slot.category || resolveShotTask(shot);
    categoryCounters[category] = (categoryCounters[category] || 0) + 1;
    const label = categoryLabel(category);
    const focus = wallLampFocus(slot, safeProfile);
    const routeForPrompt = {
      ...(shot.promptRoute || {}),
      source: "wall-lamp-detail-strategy",
      category,
      label,
      sequenceIndex: index + 1,
      categoryIndex: categoryCounters[category],
      sequenceSlot: slot.id,
      pageRole: slot.role || slot.title || label,
      suiteRole: slot.role || slot.title || label,
      contentClaim: focus,
      suiteStyleLine,
      viewMode: slot.viewMode || slot.composition,
      cameraAngle: slot.cameraAngle,
      scaleBand: slot.scaleBand,
      distanceClass: slot.distanceClass,
      avoidRepeatWith: previousSlot ? `${previousSlot.distanceClass || ""}/${previousSlot.cameraAngle || previousSlot.viewMode || ""}` : "",
      focusPoint: focus,
      subjectLock: "strict-wall-lamp",
      mountFamily: "wall",
      lampChannel: "wall"
    };
    const prompt = wallLampDetailVisiblePlanPrompt({
      slot,
      category,
      profile: safeProfile,
      userRequirement,
      previousSlot
    });
    const textOverlay = productWorkspaceTextEnabledForShot(settings, { ...shot, category, promptRoute: routeForPrompt }, category)
      ? attachTextOverlayTheme(wallLampTextOverlayForSlot(category, slot, safeProfile), safeProfile, { category, settings }) || undefined
      : undefined;
    const textRenderMode = textRenderModeForShot({ ...shot, textRenderMode: "", category, textOverlay, promptRoute: routeForPrompt }, category, settings);
    return {
      ...shot,
      id: shot.id || `${slot.id}-${index + 1}`,
      category,
      title: `详情 ${index + 1} · ${slot.title}`,
      description: `${slot.role}：${focus}`,
      prompt: prompt.trim(),
      generationPrompt: wallLampGenerationPromptFromPlan(prompt, { profile: safeProfile, category, settings, shot: { ...shot, textOverlay, textRenderMode, promptRoute: routeForPrompt } }),
      textOverlay,
      textRenderMode,
      promptRoute: routeForPrompt,
      ratio: String(settings.ratio || shot.ratio || "3:4 竖版"),
      status: shot.status || "",
      imageUrl: shot.imageUrl || "",
      variationIndex: index + 1
    };
  });
  return { shots: rewritten, applied: true };
}

const SUITE_STORYBOARD_SLOTS = {
  cover: [
    { id: "detail-cover", title: "详情页首图", role: "建立详情页第一眼产品气质和使用氛围", focus: "完整产品识别、真实比例、材质颜色和核心光感", composition: "详情页封面首图，完整住宅空间中远景和高级留白构图；灯具按真实比例在空间中自然出现，保留房间尺度和自然负空间，少量简体中文短标题可以后置排版，不做参数表、功能卡片或多卖点合集" }
  ],
  main: [
    { id: "clean-hero", title: "纯净首图", role: "建立第一眼产品识别", focus: "完整外形、真实比例和材质颜色", composition: "浅色干净背景，主体居中，柔和落影，适合电商列表页" },
    { id: "angle-hero", title: "结构角度", role: "补充第二视角", focus: "安装结构、发光面和侧面层次", composition: "轻微俯视或三分构图，留白与第一张主图不同" },
    { id: "light-hero", title: "轻氛围主图", role: "展示产品气质", focus: "光效、材质反射和产品轮廓", composition: "轻场景或渐变摄影背景，仍以单个产品为主体" }
  ],
  selling: [
    { id: "core-reason", title: "核心购买理由", role: "只讲最核心卖点", focusKey: "selling", composition: "大留白海报构图，产品与一句简体中文短标题配合，不做多卖点合集" },
    { id: "material-value", title: "材质工艺卖点", role: "证明质感和做工", focusKey: "material", composition: "产品近中景或局部放大，强调表面质感、边缘和工艺，不重复光效功能" },
    { id: "light-value", title: "光效体验卖点", role: "表达灯光带来的使用价值", focusKey: "light", composition: "产品结合柔和光斑或局部空间氛围，只讲光感体验" },
    { id: "design-value", title: "设计适配卖点", role: "表达风格和空间适配", focusKey: "style", composition: "克制设计海报或轻空间背景，突出造型、比例和适配场景" }
  ],
  function: [
    { id: "feature-overview", title: "功能总览", role: "建立功能信息层级", focus: "3-4 个真实功能优势", composition: "图文卡片总览版式，短中文标签，避免参数堆叠" },
    { id: "structure-function", title: "结构功能", role: "解释结构如何工作", focusKey: "structure", composition: "产品主体加局部标注或剖面感示意，只说明图片可见结构" },
    { id: "lighting-function", title: "光效功能", role: "说明照明效果", focusKey: "light", composition: "光束、光斑或照射范围示意，中文标签清楚，不写无依据数值" },
    { id: "install-function", title: "安装功能", role: "说明安装关系", focusKey: "install", composition: "安装面、连接点或固定方式图文页，不拆出产品图里没有的零件" }
  ],
  scene: [
    { id: "living-scene", title: "客餐厅应用", role: "展示家居主场景", focus: "真实空间尺度和自然照明氛围", composition: "客厅或餐厅完整连续空间，正常人眼平视中远景，能看到地面下沿、完整墙面、窗帘/门洞和家具尺度，天花只作为上边界" },
    { id: "bedroom-scene", title: "卧室/书房应用", role: "展示安静生活场景", focus: "舒适、柔和、克制的使用氛围", composition: "卧室或书房正常人眼平视中远景，与客餐厅构图明显不同，保留床/书桌、地面、墙面和窗帘竖向尺度" },
    { id: "corridor-scene", title: "玄关/走廊应用", role: "展示动线和安装节奏", focus: "走廊纵深、柜体或门洞尺度参照", composition: "住宅玄关或走廊远景透视，能看到地面、墙面、柜体和门洞高度，灯位服务空间节奏，不做密集复制" },
    { id: "entry-scene", title: "入户家装应用", role: "展示入户与柜体局部家装氛围", focus: "住宅玄关、柜体或过道的真实光感", composition: "住宅入户、柜体或过道完整空间，平视中远景，能看到地面、柜体、墙面和门洞竖向尺度，天花只作为上边界" },
    { id: "cabinet-scene", title: "柜体/局部应用", role: "展示局部重点照明", focus: "柜体、墙面、台面或生活物件的光影层次", composition: "住宅柜体或局部墙面连续空间，侧向或斜向平视视角，仍能看到地面、墙面和柜体高度，不做拼图或海报排版" }
  ],
  detail: [
    { id: "emitter-detail", title: "发光面细节", role: "证明发光结构", focus: "发光口、灯杯、灯罩或透光面", composition: "微距或近景，背景干净，少量中文细节标注" },
    { id: "material-detail", title: "材质边缘细节", role: "证明材质工艺", focusKey: "material", composition: "材质纹理、边缘倒角、连接处近景，不重复完整卖点图" },
    { id: "install-detail", title: "安装接触细节", role: "证明安装可信度", focusKey: "install", composition: "安装接触面、边缘贴合或图中真实可见固定关系局部，禁止爆炸拆解，禁止新增电线、驱动盒、弹簧卡扣或散热器" },
    { id: "beam-detail", title: "光斑细节", role: "证明光效质感", focusKey: "light", composition: "墙面或地面光斑近景，强调边缘、方向和真实发光来源" }
  ],
  real: [
    { id: "studio-real", title: "棚拍实拍", role: "建立真实商品可信度", focus: "真实材质、透视和自然阴影", composition: "摄影棚或桌面实拍感，单个产品，干净自然光" },
    { id: "arrival-real", title: "到货实拍", role: "模拟用户收到产品", focus: "包装外的真实产品质感和可触摸细节", composition: "桌面、纸箱或自然背景，轻微手机拍摄质感" },
    { id: "installed-real", title: "安装后实拍", role: "展示真实使用状态", focus: "安装关系、环境光和现场质感", composition: "真实安装现场视角，不做海报文案或功能卡片" }
  ]
};

function suiteStoryboardFocus(slot = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const material = cleanPromptPart([safeProfile.material, safeProfile.colorPalette].filter(Boolean).join("，"));
  const map = {
    selling: cleanPromptPart(safeProfile.sellingPoint || safeProfile.sellingPoints || safeProfile.lightUse),
    material: material || "材质、颜色和表面工艺",
    light: cleanPromptPart(safeProfile.lightUse || safeProfile.visualStrategy?.lightingEffect) || "柔和照明、光斑和光效体验",
    structure: cleanPromptPart(safeProfile.structureKeywords || safeProfile.visibleParts) || "真实结构、发光面和安装部件",
    install: cleanPromptPart(safeProfile.installationMethod || safeProfile.installationPosition) || "安装方式和接触关系",
    style: cleanPromptPart(safeProfile.visualStrategy?.productStyle || safeProfile.style || safeProfile.targetSpace) || "产品风格和空间适配"
  };
  return cleanPromptPart(slot.focus || map[slot.focusKey] || map.structure);
}

function suiteStoryboardSlotFor(category = "", categoryIndex = 1) {
  const slots = SUITE_STORYBOARD_SLOTS[category] || [];
  if (!slots.length) return null;
  return slots[(Math.max(1, Number(categoryIndex || 1)) - 1) % slots.length];
}

function suiteStoryboardPromptLine(slot = {}, category = "", profile = {}, existingPrompt = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const productName = cleanPromptPart(safeProfile.productName) || "灯具产品";
  const focus = suiteStoryboardFocus(slot, safeProfile);
  const composition = cleanPromptPart(slot.composition);
  const base = cleanPromptPart(existingPrompt);
  const textPolicy = productPromptAllowsText(category)
    ? "可使用少量简体中文短标题或标签，文字只服务本张主题。"
    : "画面不出现文字、品牌标志、水印或价格。";
  return [
    `套图脚本：只负责${slot.role || categoryDescription(category, safeProfile)}，重点表现${productName}的${focus}。`,
    composition ? `构图方向：${composition}。${textPolicy}` : textPolicy,
    base && !base.includes("套图脚本") ? `基础画面方向：${base}` : ""
  ].filter(Boolean).join("\n");
}

function suiteStoryboardTextOverlay(slot = {}, category = "", profile = {}) {
  if (String(slot?.id || "") !== "detail-cover") return undefined;
  return commerceHeroTextOverlay(profile, { tone: "light", fallbackTitle: "温润光境" });
}

function shouldForceDetailCoverShot(shots = [], settings = {}, counts = {}) {
  if (!Array.isArray(shots) || !shots.length) return false;
  if (isCollageTemplateSettings(settings) || !isProductWorkspaceSettings(settings)) return false;
  if (String(settings.imageScope || "detail") !== "detail") return false;
  const total = SHOT_CATEGORY_KEYS.reduce((sum, key) => sum + Number(counts?.[key] || 0), 0) || shots.length;
  if (total < 1) return false;
  const first = shots[0] || {};
  const route = first.promptRoute || {};
  return !/hero|cover|首图|首屏|封面|detail-cover|hero-atmosphere/i.test([
    first.title,
    first.id,
    first.prompt,
    route.suiteSlot,
    route.sequenceSlot
  ].filter(Boolean).join(" "));
}

function applySuiteStoryboardStrategy({ shots = [], profile = {}, counts = {}, settings = {}, userRequirement = "" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  if (!Array.isArray(shots) || !shots.length || isCollageTemplateSettings(settings)) return { shots, applied: false };
  if (!isProductWorkspaceSettings(settings)) return { shots, applied: false };
  if (smallLampDetailStrategyEnabled(safeProfile, counts, settings)) return { shots, applied: false };
  if (largeLampDetailStrategyEnabled(safeProfile, counts, settings)) return { shots, applied: false };
  if (wallLampDetailStrategyEnabled(safeProfile, counts, settings)) return { shots, applied: false };
  const forceCover = shouldForceDetailCoverShot(shots, settings, counts);
  const categoryCounters = {};
  const rewritten = shots.map((shot, index) => {
    const category = resolveShotTask(shot);
    categoryCounters[category] = (categoryCounters[category] || 0) + 1;
    const slot = forceCover && index === 0
      ? SUITE_STORYBOARD_SLOTS.cover[0]
      : suiteStoryboardSlotFor(category, categoryCounters[category]);
    if (!slot) return shot;
    const prompt = suiteStoryboardPromptLine(slot, category, safeProfile, shot.prompt || "");
    const label = categoryLabel(category);
    const title = forceCover && index === 0
      ? `详情 ${index + 1} · ${slot.title}`
      : `${label} ${categoryCounters[category]} · ${slot.title}`;
    const textOverlay = attachTextOverlayTheme(suiteStoryboardTextOverlay(slot, category, safeProfile), safeProfile, { category, settings });
    return {
      ...shot,
      category,
      title,
      description: `${slot.role}：${suiteStoryboardFocus(slot, safeProfile)}`,
      prompt: [prompt, userRequirement ? `用户补充要求：${cleanPromptPart(userRequirement)}` : ""].filter(Boolean).join("\n"),
      textOverlay,
      promptRoute: {
        ...(shot.promptRoute || {}),
        source: shot.promptRoute?.source || "suite-storyboard",
        suiteScript: "dedupe-v1",
        suiteSlot: slot.id,
        suiteRole: slot.role,
        suiteFocus: suiteStoryboardFocus(slot, safeProfile),
        suiteComposition: slot.composition
      },
      referenceIndex: Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : index,
      variationIndex: Number(shot.variationIndex || categoryCounters[category])
    };
  });
  return { shots: rewritten, applied: true };
}

function suiteStoryboardResidentialSceneGuard(shot = {}) {
  const route = shot.promptRoute || {};
  const category = resolveShotTask(shot);
  const suiteSlot = String(route.suiteSlot || "");
  const isScene = category === "scene" || /scene/.test(suiteSlot);
  if (!isScene) return "";
  return [
    residentialEyeLevelFramingGuard({ id: suiteSlot || "suite-scene", title: shot.title || route.suiteRole || suiteSlot }),
    "套图场景范围硬锁：只做住宅家装空间，画面只能是客厅、餐厅、卧室、书房、玄关、走廊或柜体局部，所有家具和生活物件都服务居家语境。",
    "场景图必须是一张平视完整空间照片感画面，先构图房间尺度，再放入真实比例小灯；不做天花灯位特写、顶面展示图或低矮盒子空间。"
  ].join("\n");
}

function suiteStoryboardHiddenPrompt(shot = {}) {
  const route = shot.promptRoute || {};
  if (!route.suiteSlot) return "";
  return [
    `套图脚本锁：本张角色=${route.suiteRole || shot.title || categoryLabel(shot.category)}；展示重点=${route.suiteFocus || shot.description || ""}。`,
    route.suiteComposition ? `本张构图必须使用：${route.suiteComposition}。` : "",
    suiteStoryboardResidentialSceneGuard(shot),
    "同一套图内不得复读其它图片的主要卖点、构图模板、场景空间或细节角度；如果产品信息相同，也要换成当前脚本指定的证据或画面表达。"
  ].filter(Boolean).join("\n");
}

function stripProductPromptRules(prompt = "") {
  let text = String(prompt || "").replace(/\\n/g, "\n").trim();
  if (!text) return "";
  text = text
    .replaceAll(PRODUCT_VISIBLE_SUBJECT_LOCK, "")
    .replaceAll(PRODUCT_VISIBLE_TEXT_LOCK, "")
    .replaceAll("仅使用少量清晰中文标注，不要乱码、logo、水印或价格。", "")
    .replaceAll(CHINA_MARKET_TEXT_LOCK, "")
    .replaceAll(NO_VISIBLE_TEXT_LOCK, "")
    .replaceAll(SINGLE_SCENE_IMAGE_LOCK, "")
    .replace(/产品一致性[：:][\s\S]*?(?=\n|$)/g, "")
    .replace(/产品一致性要求（[^）]*）[：:]?[\s\S]*?(?=\n\n|$)/g, "")
    .replace(/灯具商品图策略[：:]?[\s\S]*?(?=\n\n|$)/g, "")
    .replace(/图片类型边界[：:][\s\S]*?(?=\n|$)/g, "")
    .replace(/输出要求[：:][\s\S]*?(?=\n|$)/g, "")
    .replace(/禁止改款[，、；;][\s\S]*?(?=\n|$)/g, "");
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(小灯.*锁|有参考灯位时|有参考场景但|没有参考场景时|最近灯位|当清晰度和比例冲突|嵌入筒灯只表现|嵌入式小灯只露出|嵌入式筒灯\/射灯|嵌入式绝对禁止|明装筒灯只表现|射灯保持|轨道射灯保持|轨道灯保持|产品主体保真最高优先级|不得改变|不得把小灯|不得把嵌入式|不得把明装|不得把射灯|不得把轨道|当前产品结构参考|场景图边界|场景图灯具数量|卖点图边界|功能图边界|细节图边界|详情页有效性|所有箭头|核心优势页|深杯防眩页|显色光谱页|光束光斑页|尺寸安装页|小灯参考灯位识别结果|mountPlane=|bbox=|结构锁|安装结构锁定|画面要有地面|灯具数量按空间|首屏场景必须|真实安装场景必须|走廊应用必须|设计美学页必须|商业空间必须|场景图必须像真实)/.test(line))
    .join("\n")
    .trim();
}

function normalizeProductVisiblePrompt(prompt = "", category = "") {
  const stripped = stripProductPromptRules(prompt);
  if (/整体主题[：:]|本张任务[：:]|画面提示[：:]|产品复杂结构判定[：:]|图中图元素[：:]|内容要素[：:]|文字内容(?:（使用)?/.test(stripped)) {
    return compactStructuredSmallLampVisiblePrompt(stripped) || stripped;
  }
  const body = stripped
    .replace(/\s+/g, " ")
    .replace(/\s*([，。；：、])\s*/g, "$1")
    .trim();
  if (!body) return "";
  const bodySentence = /[。！？.!?]$/.test(body) ? body : `${body}。`;
  return bodySentence;
}

function selectedTemplateReference(templateReferences = [], shot = {}, shotIndex = 0) {
  if (!templateReferences.length) return null;
  const candidateIndex = Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : Number(shotIndex) || 0;
  const referenceIndex = Math.max(0, Math.min(candidateIndex, templateReferences.length - 1));
  return { file: templateReferences[referenceIndex], referenceIndex };
}

function buildPromptsFromProfile(product = {}, counts = {}, settings = {}, userRequirement = "", files = []) {
  const profile = sanitizeRecognitionProfile(product);
  const shots = [];
  const add = (category, count) => {
    for (let index = 1; index <= Number(count || 0); index += 1) {
      const label = categoryLabel(category);
      shots.push({
        id: category + "-" + index,
        category,
        title: `${label} ${index}`,
        description: categoryDescription(category, profile),
        prompt: isProductWorkspaceSettings(settings)
          ? productWorkspaceSeedPrompt(category, index, profile, settings, userRequirement)
          : [
              categoryInstruction(category, index, profile, settings),
              productConsistencyLockPrompt(profile, settings)
            ].join("\n\n"),
        status: "pending",
        variationIndex: index
      });
    }
  };
  add("main", counts.main);
  add("selling", counts.selling);
  add("function", counts.function);
  add("scene", counts.scene);
  add("detail", counts.detail);
  add("real", counts.real);
  const smallLampDetail = applySmallLampDetailStrategy({
    shots,
    profile,
    counts,
    settings,
    files,
    userRequirement
  });
  if (smallLampDetail.applied) return smallLampDetail.shots;
  const largeLampDetail = applyLargeLampDetailStrategy({
    shots,
    profile,
    counts,
    settings,
    userRequirement
  });
  if (largeLampDetail.applied) return largeLampDetail.shots;
  const wallLampDetail = applyWallLampDetailStrategy({
    shots,
    profile,
    counts,
    settings,
    userRequirement
  });
  if (wallLampDetail.applied) return wallLampDetail.shots;
  return applySuiteStoryboardStrategy({
    shots,
    profile,
    counts,
    settings,
    userRequirement
  }).shots;
}

function buildLocalProductPlan(product = {}, files = [], counts = {}, settings = {}) {
  const profile = enhanceSmallLampProfileFromHints(
    applyLargeLampProfileFromHints(inferProductProfile(product, files), product.requirement || "", product, settings),
    product.requirement || "",
    product,
    settings
  );
  return { product: profile, shots: buildPromptsFromProfile(profile, counts, settings, product.requirement || "", files), source: "local" };
}

function attachReferenceTargetsToShots(shots = [], referenceTargets = []) {
  if (!Array.isArray(shots) || !referenceTargets.length) return shots;
  return shots.map((shot, index) => {
    const referenceIndex = Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : index;
    const safeIndex = Math.max(0, Math.min(referenceTargets.length - 1, referenceIndex));
    return {
      ...shot,
      referenceTarget: referenceTargets[safeIndex] || shot.referenceTarget || null
    };
  });
}

function extractProfileOverridesFromLayout(layout = "") {
  const text = String(layout || "").trim();
  if (!text) return {};
  const get = (labels) => {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label}[：:]\\s*([^\\n；;]+)`, "i"));
      if (match?.[1]) return match[1].trim();
    }
    return "";
  };
  return {
    productName: get(["产品", "产品名称", "名称"]),
    lampType: get(["灯具类型", "类型", "大类"]),
    lampSubtype: get(["灯具细类", "细类", "子类"]),
    material: get(["材质", "材料"]),
    colorPalette: get(["颜色", "色彩", "配色"]),
    style: get(["风格"]),
    structureKeywords: get(["结构", "结构重点", "安装结构"]),
    sellingPoint: get(["卖点", "核心卖点"])
  };
}

function parseJsonFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const candidates = [
    text,
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
  ];
  const firstObject = text.match(/\{[\s\S]*\}/);
  if (firstObject?.[0]) candidates.push(firstObject[0]);
  const firstArray = text.match(/\[[\s\S]*\]/);
  if (firstArray?.[0]) candidates.push(firstArray[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON slice.
    }
  }
  return null;
}

function recognitionRequestPrompt(product = {}, layout = "") {
  const cleanLayout = stripUserVisiblePlanningNoise(layout || product.requirement || "");
  const selectedCategory = selectedLampCategoryPrompt({}, product);
  return [
    "你是灯具电商图产品识别模型。请观察用户上传的灯具图片，返回 JSON，不要写解释。",
    "必须基于图片真实可见信息，不要编造图片里没有的结构。",
    selectedCategory ? `${selectedCategory}分析 lampType、lampSubtype、lampChannel、mountFamily 时以该预设为优先类目；如果图片局部信息不足，不要擅自改成其它灯具大类。` : "",
    "识别字段：productName, lampType, lampSubtype, lampChannel, mountFamily, installSurface, visibleParts, scaleClass, openingSize, beamAngle, style, material, colorPalette, functionText, targetSpace, installationPosition, installationMethod, lightUse, sellingPoint, structureKeywords, confidence。",
    "颜色识别硬规则：colorPalette 只写灯具产品本体和可见部件颜色，忽略产品图背景、桌面、墙面、地面、布景、阴影和环境反光；visualStrategy.colorSystem 只根据产品本身的材质、颜色和发光口推导适合的主色、辅助色、点缀色，不要把背景色写入色彩系统。",
    "小灯识别要求：筒灯、射灯、明装筒灯、轨道射灯必须分清 mountFamily。mountFamily 只能用 recessed-downlight, surface-downlight, spotlight, track-spotlight, track, ceiling, chandelier, wall, linear, generic。",
    "大灯识别要求：吸顶灯、吊灯、完整主灯、枝形灯或大型贴顶灯必须进入 lampChannel=large，mountFamily 只能用 ceiling 或 chandelier；visibleParts 写完整灯体、灯罩、灯臂、底盘/吸顶盘、吊线/吊杆或大型贴顶结构。大灯不能误写成筒灯、射灯、轨道灯、线性灯、壁灯或 generic。",
    "大灯 scaleClass 必须写 large；如果图片主体是完整主灯体、灯罩/灯臂/吸顶盘/吊线/吊杆明显可见，即使背景是电商白底也必须识别为大灯通道。",
    "installSurface 只能用 ceiling, wall, track, cabinet, unknown；visibleParts 写图片可见部件，如面环、灯杯、发光口、转轴、支架、轨道卡扣；openingSize/beamAngle 不确定就返回空字符串。",
    "所有识别结果都必须返回 visualStrategy 对象，不分大灯、小灯、线性灯、壁灯或通用灯具；visualStrategy 必须来自当前产品真实信息，不能使用固定模板或专属兜底风格。",
    "visualStrategy 字段固定为：productStyle, suitableVisualStyle, styleKeywords, moodKeywords, lightingEffect, colorSystem, visualLanguage, decorativeElements, recommendedView, productComplexStructure, hardConstraints。",
    "首屏文案识别规则：style 只写风格词；lampSubtype 只写灯具类型；visualStrategy.productStyle 写成去重后的“风格+核心质感/材质+灯具类型”；moodKeywords 只写情绪/氛围词，不得重复风格词、灯具类型，也不要写“电商商品图”“现代商用产品图”“让空间更有层次”。",
    "visualStrategy 必须根据上传图真实产品判断：产品是什么风格，适合什么视觉风格，关键词、氛围、光影、色彩系统、视觉语言、装饰元素和推荐视角分别是什么；不要默认套用高端工业风、现代商用产品图或大小灯专属模板。",
    "hardConstraints 写最高优先级硬性约束：上传图可见结构、材质、文字、颜色、安装件、弹簧卡扣、反光杯拉丝、深杯、防眩结构等，只写图中真实可见或高度可信的细节。",
    "如果用户补充了要求，只能作为命名或偏好参考，不能覆盖图片事实。",
    `用户补充要求：${cleanLayout || "无"}`,
    '返回格式：{"productName":"...","lampType":"...","lampSubtype":"...","lampChannel":"large|small|linear|wall|generic","mountFamily":"recessed-downlight|surface-downlight|spotlight|track-spotlight|track|ceiling|chandelier|wall|linear|generic","installSurface":"ceiling|wall|track|cabinet|unknown","visibleParts":"...","scaleClass":"tiny|small|medium|large|linear|general","openingSize":"","beamAngle":"","style":"...","material":"...","colorPalette":"...","functionText":"...","targetSpace":"...","installationPosition":"...","installationMethod":"...","lightUse":"...","sellingPoint":"...","structureKeywords":"...","confidence":0.8,"visualStrategy":{"productStyle":"...","suitableVisualStyle":"...","styleKeywords":"...","moodKeywords":"...","lightingEffect":"...","colorSystem":"...","visualLanguage":"...","decorativeElements":"...","recommendedView":"...","productComplexStructure":true,"hardConstraints":"..."}}'
  ].filter(Boolean).join("\n");
}

async function analyzeProductWithGemini({
  files = [],
  product = {},
  layout = "",
  model,
  apiKey,
  baseUrl = "",
  providerName = "Gemini",
  useBearerAuth = false
} = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const parts = [
    { text: recognitionRequestPrompt(product, layout) },
    ...files.slice(0, 4).map((file) => ({
      inlineData: {
        mimeType: file.mimetype || "image/png",
        data: file.buffer.toString("base64")
      }
    }))
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 产品识别失败：HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} 产品识别返回内容不可解析`);
  return sanitizeRecognitionProfile(parsed);
}

async function analyzeProductWithAPIYiVision({ files = [], product = {}, layout = "", model, apiKey, baseUrl, providerName = "API易" } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const content = [
    { type: "text", text: recognitionRequestPrompt(product, layout) },
    ...files.slice(0, 4).map((file) => ({
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    }))
  ];
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      ...openAICompatibleTokenLimit(model),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 产品识别失败：HTTP ${response.status}`));
  const parsed = parseJsonFromText(payload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} 产品识别返回内容不可解析`);
  return sanitizeRecognitionProfile(parsed);
}

function normalizeUnitRect(value = {}) {
  const read = (key, fallback = 0) => {
    const raw = Number(value?.[key]);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.min(1, raw));
  };
  const x = read("x", 0);
  const y = read("y", 0);
  const w = Math.max(0.01, Math.min(1 - x, read("w", read("width", 0.12))));
  const h = Math.max(0.01, Math.min(1 - y, read("h", read("height", 0.12))));
  return { x, y, w, h };
}

function normalizeUnitPoint(value = {}) {
  const read = (key, fallback = 0.5) => {
    const raw = Number(value?.[key]);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.min(1, raw));
  };
  return { x: read("x"), y: read("y") };
}

function normalizeReferenceMountTarget(value = {}, profile = {}, referenceIndex = 0) {
  const semantic = mountingSemantics(profile);
  const mountPlane = String(value.mountPlane || value.installSurface || profile.installSurface || "unknown").toLowerCase();
  const slotKind = String(value.slotKind || "").trim() || (
    semantic.mountFamily === "recessed-downlight" ? "recessed-hole"
      : semantic.mountFamily === "surface-downlight" ? "surface-ceiling"
        : semantic.mountFamily === "track" || semantic.mountFamily === "track-spotlight" ? "track-slot"
          : semantic.mountFamily === "spotlight" ? "spotlight-head"
            : "unknown"
  );
  const bbox = normalizeUnitRect(value.bbox || value.box || {});
  const anchor = normalizeUnitPoint(value.anchor || {
    x: bbox.x + bbox.w / 2,
    y: bbox.y + bbox.h / 2
  });
  const confidence = Math.max(0, Math.min(1, Number(value.confidence ?? 0.35) || 0.35));
  return {
    referenceIndex,
    mountPlane: /^(ceiling|wall|track|cabinet|unknown)$/.test(mountPlane) ? mountPlane : "unknown",
    slotKind,
    bbox,
    anchor,
    perspective: String(value.perspective || "unknown").trim(),
    scaleHint: String(value.scaleHint || value.scale || "small").trim(),
    confidence,
    cacheHit: Boolean(value.cacheHit),
    warning: String(value.warning || (confidence < 0.65 ? "灯位识别置信度较低，可生成但建议必要时框选原灯位重试。" : "")).trim()
  };
}

function referenceMountSlotPrompt(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    "你是灯具参考图灯位识别模型。只分析这张参考图中的原灯具安装位置，返回 JSON，不要解释。",
    "任务对象是小灯：筒灯、射灯、明装筒灯、轨道射灯或轨道灯。必须找原灯位，不要分析家具或其它物体。",
    `当前产品安装族：${safeProfile.mountFamily}；安装面：${safeProfile.installSurface}；可见部件：${safeProfile.visibleParts}。`,
    "输出字段：mountPlane, slotKind, bbox, anchor, perspective, scaleHint, confidence, warning。",
    "bbox 是原灯位外接矩形，使用 0-1 归一化坐标：{\"x\":0.1,\"y\":0.2,\"w\":0.08,\"h\":0.06}。anchor 是安装接触点或原灯位中心，使用 0-1 坐标。",
    "slotKind 只能用 recessed-hole, surface-ceiling, spotlight-head, track-slot, cabinet-slot, unknown。",
    "mountPlane 只能用 ceiling, wall, track, cabinet, unknown；perspective 用 front, side, bottom-up, top-down, oblique, unknown；scaleHint 用 tiny, small, medium。",
    "如果参考图里看不清灯位，也必须返回最可能的位置，并把 confidence 降低到 0.2-0.6。",
    '返回格式：{"mountPlane":"ceiling","slotKind":"recessed-hole","bbox":{"x":0.45,"y":0.08,"w":0.08,"h":0.04},"anchor":{"x":0.49,"y":0.10},"perspective":"bottom-up","scaleHint":"tiny","confidence":0.75,"warning":""}'
  ].join("\n");
}

async function analyzeReferenceMountSlotWithAPIYi({ file, profile = {}, settings = {}, model, apiKey, baseUrl, providerName = "OpenAI-compatible", referenceIndex = 0 } = {}) {
  if (!apiKey || !file) return null;
  const content = [
    { type: "text", text: referenceMountSlotPrompt(profile, settings) },
    {
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    }
  ];
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.15,
      ...openAICompatibleTokenLimit(model, 2048),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 参考图灯位识别失败：HTTP ${response.status}`));
  const parsed = parseJsonFromText(payload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} 参考图灯位识别返回内容不可解析`);
  return normalizeReferenceMountTarget(parsed, profile, referenceIndex);
}

async function analyzeReferenceMountSlotWithGemini({ file, profile = {}, settings = {}, model, apiKey, baseUrl = "", providerName = "Gemini", useBearerAuth = false, referenceIndex = 0 } = {}) {
  if (!apiKey || !file) return null;
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers,
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: referenceMountSlotPrompt(profile, settings) },
          { inlineData: { mimeType: file.mimetype || "image/png", data: file.buffer.toString("base64") } }
        ]
      }],
      generationConfig: { temperature: 0.15, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 参考图灯位识别失败：HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} 参考图灯位识别返回内容不可解析`);
  return normalizeReferenceMountTarget(parsed, profile, referenceIndex);
}

async function analyzeReferenceMountTargets({ db, profile = {}, settings = {}, templateReferences = [] } = {}) {
  if (!settings?.styleCloneMode || !templateReferences.length || !isSmallLampProfile(profile, settings)) return [];
  if (!shouldAnalyzeReferenceMountTargets(settings)) return [];
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const brainChannel = openAICompatibleBrainChannel(db);
  const geminiKey = effectiveGeminiKey(db);
  const apiyiKey = effectiveAPIYiKey(db);
  const yunwuKey = effectiveYunwuKey(db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const geminiChannel = geminiGenerationChannel(db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const results = [];
  const brainModel = apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
  const geminiModel = isGeminiAnalysisModel(analysisModel) ? analysisModel.id : "gemini-2.5-flash";
  const activeProviderName = brainChannel.apiKey
    ? brainChannel.providerName || "OpenAI-compatible"
    : geminiChannel.apiKey
      ? geminiChannel.providerName || "Gemini"
      : "local-fallback";
  const activeModel = brainChannel.apiKey ? brainModel : geminiChannel.apiKey ? geminiModel : "";

  await runWithConcurrency(templateReferences, REFERENCE_MOUNT_TARGET_CONCURRENCY, async (file, index) => {
    const cacheKey = referenceMountTargetCacheKey({
      file,
      profile,
      settings,
      providerName: activeProviderName,
      model: activeModel
    });
    const cached = readReferenceMountTargetCache(cacheKey, profile, index);
    if (cached) {
      results[index] = cached;
      return;
    }
    try {
      let target = null;
      const pooledProviderKind = isGeminiAnalysisModel(analysisModel) ? "gemini" : "openai-compatible";
      const pooledModel = pooledProviderKind === "gemini" ? geminiModel : brainModel;
      target = await runWithModelChannelRetry(db, {
        purpose: "analysis",
        modelId: pooledModel,
        providerKind: pooledProviderKind,
        modelOption: pooledProviderKind === "gemini"
          ? { id: pooledModel, apiModel: pooledModel, provider: "gemini" }
          : { id: pooledModel, apiModel: pooledModel, provider: "openai" }
      }, async (channel) => {
        if (pooledProviderKind === "gemini") {
          const resolved = modelChannelGemini(channel);
          return analyzeReferenceMountSlotWithGemini({
            file,
            profile,
            settings,
            model: pooledModel,
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            providerName: resolved.providerName || "Gemini",
            useBearerAuth: resolved.useBearerAuth,
            referenceIndex: index
          });
        }
        const resolved = modelChannelOpenAICompatible(channel);
        return analyzeReferenceMountSlotWithAPIYi({
          file,
          profile,
          settings,
          model: pooledModel,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          providerName: resolved.providerName || "OpenAI-compatible",
          referenceIndex: index
        });
      });
      if (!target && brainChannel.apiKey) {
        target = await analyzeReferenceMountSlotWithAPIYi({
          file,
          profile,
          settings,
          model: brainModel,
          apiKey: brainChannel.apiKey,
          baseUrl: brainChannel.baseUrl,
          providerName: brainChannel.providerName || "OpenAI-compatible",
          referenceIndex: index
        });
      } else if (geminiChannel.apiKey) {
        target = await analyzeReferenceMountSlotWithGemini({
          file,
          profile,
          settings,
          model: geminiModel,
          apiKey: geminiChannel.apiKey,
          baseUrl: geminiChannel.baseUrl,
          providerName: geminiChannel.providerName || "Gemini",
          useBearerAuth: geminiChannel.useBearerAuth,
          referenceIndex: index
        });
      }
      results[index] = target || normalizeReferenceMountTarget({}, profile, index);
      writeReferenceMountTargetCache(cacheKey, results[index]);
    } catch (error) {
      results[index] = normalizeReferenceMountTarget({
        confidence: 0.25,
        warning: `参考图灯位识别失败，已使用保守小灯槽位：${error instanceof Error ? error.message : "识别不可用"}`
      }, profile, index);
      writeReferenceMountTargetCache(cacheKey, results[index]);
    }
  });
  return results;
}

const DETAIL_CREATION_METHODOLOGY = {
  methodologyId: "provided-lamp-detail-method-v1",
  source: "built-in-from-provided-reference-set",
  contentPlanning: "按合格灯具详情页方法组织：详情页首图建立购买第一印象，真实比例场景图证明使用效果，核心功能图只讲一个有依据卖点，后续再展开材质工艺、控制方式、尺寸参数、适用空间、细节和实拍。",
  coverMethod: "首图不是白底主图，也不是普通场景照加大字。要做全幅电商详情页封面设计稿：先成立中远景完整空间尺度，再让灯具按真实比例出现，标题只用1行6-12字简体中文并融入自然负空间；必须写清场景、视角、机位角度、灯具比例、画面参照；灯具不得成为半屏主视觉或压到画面中线；禁底部/顶部/侧边白条、独立标题栏、纯白文字区、模板海报白块和粗黑大字。",
  sceneMethod: "场景图先成立真实空间尺度，再放入灯。必须写清场景、视角、机位角度、灯具比例、画面参照；必须有家具、桌椅、墙面、地面、天花、门洞、床头或柜体等参照；灯具不得成为半屏主视觉或压到画面中线；大灯是房间里的真实主灯，小灯是小体量灯位，壁灯贴合墙面关系。",
  functionMethod: "功能图一张只讲一个真实功能或卖点，用大标题、短说明、局部图、示意元素或少量图文卡组织；不得做八大功能合集或无依据认证堆叠。",
  detailMethod: "细节图才允许近景，用局部放大、引线标注、材质标签、工艺说明呈现品质；不能重复首图或场景图。",
  parameterMethod: "参数页用产品小图、尺寸线、规格字段和表格层级；只有用户或图片提供规格时才写数值，否则写结构关系或安装提示。",
  typographyMethod: "首图只允许1行简体中文短标题；其它功能/细节页才可使用短副标题或少量标签。文字层级清楚、密度克制，不要英文乱码、品牌水印、价格或长段说明。",
  styleAdaptationRules: "参考图只教会怎么做合格详情页，当前产品识别结果决定主题：木质复古走温润家居，晶透吸顶走灰白轻奢高光，小灯走真实小体量空间，壁灯走墙面/床头/走廊氛围。",
  copyGuards: "不得复制参考图里的品牌、证书、参数、芯片、专利、原文案或原产品；未识别、未提供的信息不得编造。"
};

function productDetailMethodologyPrompt() {
  return [
    `内置详情图创建方法论：${DETAIL_CREATION_METHODOLOGY.methodologyId}。这不是模板，也不是复制参考图；它只沉淀“合格灯具详情页怎么创建”的方法。`,
    `内容规划：${DETAIL_CREATION_METHODOLOGY.contentPlanning}`,
    `首图方法：${DETAIL_CREATION_METHODOLOGY.coverMethod}`,
    `场景方法：${DETAIL_CREATION_METHODOLOGY.sceneMethod}`,
    `功能方法：${DETAIL_CREATION_METHODOLOGY.functionMethod}`,
    `细节方法：${DETAIL_CREATION_METHODOLOGY.detailMethod}`,
    `参数方法：${DETAIL_CREATION_METHODOLOGY.parameterMethod}`,
    `文字排版：${DETAIL_CREATION_METHODOLOGY.typographyMethod}`,
    `风格举一反三：${DETAIL_CREATION_METHODOLOGY.styleAdaptationRules}`,
    `内容边界：学习方法论，不复制参考内容。${DETAIL_CREATION_METHODOLOGY.copyGuards}`
  ].join("\n");
}

function productDetailVisualDialectForSlot(sequenceSlot = "", category = "") {
  const slot = String(sequenceSlot || "");
  if (slot === "detail-cover") return "cover-spatial-hero";
  if (slot === "scene-context") return "real-scale-scene";
  if (slot === "function-core") return "single-function-layout";
  if (/material|detail/.test(slot)) return "material-callout";
  if (/dimension|param/.test(slot)) return "parameter-table";
  if (/control/.test(slot)) return "control-method-layout";
  if (/scene/.test(slot)) return "real-scale-scene";
  if (/real/.test(slot)) return "real-display";
  if (String(category || "") === "selling") return "single-selling-point";
  return "detail-methodology-page";
}

const PRODUCT_DETAIL_OPENING_TARGETS = [
  {
    category: "main",
    sequenceSlot: "detail-cover",
    pageRole: "detail-cover",
    visualDialect: "cover-spatial-hero",
    title: "详情页首图",
    description: "第 1 张：详情页封面主视觉，使用中远景完整空间和真实灯具比例建立第一眼质感，写清场景、视角、机位角度、灯具比例、画面参照，不做白底主图、参数表、功能卡片或证书页。"
  },
  {
    category: "scene",
    sequenceSlot: "scene-context",
    pageRole: "scene-context",
    visualDialect: "real-scale-scene",
    title: "场景图 1 · 真实比例空间",
    description: "第 2 张：真实比例场景图，先成立完整空间尺度，再放入灯具；必须写清场景、视角、机位角度、灯具比例、画面参照；大灯是房间里的真实主灯，小灯是中远景小型灯位，壁灯要有墙面和家具/门洞/床头等尺度参照。"
  },
  {
    category: "function",
    sequenceSlot: "function-core",
    pageRole: "function-core",
    visualDialect: "single-function-layout",
    title: "功能图 1 · 核心功能",
    description: "第 3 张：核心功能图，只讲一个基于识别事实或用户补充信息的功能/卖点，不编造品牌、认证、专利、芯片、功率、护眼参数或检测结论。"
  }
];

const PRODUCT_DETAIL_EXPANSION_CATEGORY_ORDER = [
  "selling",
  "detail",
  "scene",
  "detail",
  "function",
  "real",
  "selling",
  "scene",
  "detail",
  "real",
  "main",
  "function"
];

const PRODUCT_DETAIL_EXPANSION_SLOTS = {
  main: [
    { sequenceSlot: "product-display", title: "产品展示", description: "补充完整产品展示，延续首图视觉系统，清楚呈现产品外形、材质和真实比例。" }
  ],
  selling: [
    { sequenceSlot: "selling-point-1", title: "卖点图 1 · 核心卖点", description: "围绕一个购买理由组织画面和简体中文短文案，不做多卖点堆叠。" },
    { sequenceSlot: "selling-point-2", title: "卖点图 2 · 风格价值", description: "表达产品风格、空间适配或使用价值，和前一张卖点图错开构图。" }
  ],
  function: [
    { sequenceSlot: "control-method", title: "功能图 2 · 控制方式", description: "如识别或用户提供了控制方式，可做 APP、遥控、语音、墙壁开关等图文页；没有依据则改写为真实结构/光效功能。" },
    { sequenceSlot: "lighting-function", title: "功能图 3 · 光效功能", description: "表达可确认的光效、调光、显色、防眩或安装功能，不写无依据参数。" }
  ],
  scene: [
    { sequenceSlot: "application-scene", title: "场景图 2 · 应用空间", description: "换一个真实应用空间或视角，保持完整空间尺度和灯具真实比例，写清场景、视角、机位角度、灯具比例、画面参照。" },
    { sequenceSlot: "application-scene-alt", title: "场景图 3 · 空间变化", description: "继续扩展使用场景，空间、家具尺度和光影氛围必须与整套主题一致，写清中远景机位和灯具比例。" }
  ],
  detail: [
    { sequenceSlot: "material-detail", title: "细节图 1 · 材质工艺", description: "聚焦材质、边缘、发光面、连接件或工艺细节，只有细节图允许近景。" },
    { sequenceSlot: "dimension-params", title: "参数图 1 · 尺寸规格", description: "仅在用户或图片提供规格时做参数页；否则改为结构尺寸关系或安装示意，不编造数值。" }
  ],
  real: [
    { sequenceSlot: "real-display", title: "实拍图 1 · 真实展示", description: "模拟真实拍摄质感，呈现产品实际外观、材质和安装/摆放状态，不做功能卡片。" }
  ]
};

function productPlanUsesDetailNarrative(counts = {}, settings = {}) {
  const hasExplicitProductDetailSettings =
    Object.prototype.hasOwnProperty.call(settings || {}, "imageScope") ||
    Boolean(settings?.workspaceStrategyVersion);
  return Boolean(
    hasExplicitProductDetailSettings &&
    isProductWorkspaceSettings(settings) &&
      String(settings.imageScope || "detail") === "detail" &&
      totalCountFromServerCounts(counts) > 0
  );
}

function productDetailExpansionSlot(category = "", categoryIndex = 1) {
  const slots = PRODUCT_DETAIL_EXPANSION_SLOTS[category] || [];
  if (!slots.length) return {
    sequenceSlot: `${category}-extra`,
    title: `${categoryLabel(category)} ${categoryIndex}`,
    description: categoryDescription(category, {})
  };
  return slots[(Math.max(1, Number(categoryIndex || 1)) - 1) % slots.length];
}

function productPlanTargetFromMeta(meta = {}, categoryIndex = 1, overallIndex = 0) {
  const category = SHOT_CATEGORY_KEYS.includes(meta.category) ? meta.category : "detail";
  const sequenceSlot = meta.sequenceSlot || `${category}-extra`;
  return {
    id: `${category}-${categoryIndex}`,
    category,
    title: meta.title || `${categoryLabel(category)} ${categoryIndex}`,
    description: meta.description || categoryDescription(category, {}),
    sequenceSlot,
    pageRole: meta.pageRole || sequenceSlot,
    methodologyId: DETAIL_CREATION_METHODOLOGY.methodologyId,
    visualDialect: meta.visualDialect || productDetailVisualDialectForSlot(sequenceSlot, category),
    storyIndex: overallIndex + 1
  };
}

function legacyProductPlanTargetShots(counts = {}) {
  const targets = [];
  for (const category of SHOT_CATEGORY_KEYS) {
    for (let index = 1; index <= Number(counts?.[category] || 0); index += 1) {
      targets.push({
        id: `${category}-${index}`,
        category,
        title: `${categoryLabel(category)} ${index}`,
        description: categoryDescription(category, {})
      });
    }
  }
  return targets;
}

function productPlanTargetShots(counts = {}, settings = {}) {
  if (!productPlanUsesDetailNarrative(counts, settings)) return legacyProductPlanTargetShots(counts);
  const total = Math.max(0, Math.floor(totalCountFromServerCounts(counts)));
  const remainingCounts = Object.fromEntries(SHOT_CATEGORY_KEYS.map((key) => [key, Math.max(0, Number(counts?.[key] || 0))]));
  const categoryIndexes = Object.fromEntries(SHOT_CATEGORY_KEYS.map((key) => [key, 0]));
  const targets = [];
  const pushTarget = (meta = {}) => {
    if (targets.length >= total) return;
    const category = SHOT_CATEGORY_KEYS.includes(meta.category) ? meta.category : "detail";
    categoryIndexes[category] = Number(categoryIndexes[category] || 0) + 1;
    targets.push(productPlanTargetFromMeta({ ...meta, category }, categoryIndexes[category], targets.length));
    if (remainingCounts[category] > 0) remainingCounts[category] -= 1;
  };

  PRODUCT_DETAIL_OPENING_TARGETS.forEach(pushTarget);
  let guard = 0;
  while (targets.length < total && guard < total * PRODUCT_DETAIL_EXPANSION_CATEGORY_ORDER.length + 20) {
    guard += 1;
    let added = false;
    for (const category of PRODUCT_DETAIL_EXPANSION_CATEGORY_ORDER) {
      if (targets.length >= total) break;
      if (remainingCounts[category] <= 0) continue;
      const nextIndex = Number(categoryIndexes[category] || 0) + 1;
      pushTarget({ category, ...productDetailExpansionSlot(category, nextIndex) });
      added = true;
    }
    if (!added) break;
  }

  for (const category of SHOT_CATEGORY_KEYS) {
    while (targets.length < total && remainingCounts[category] > 0) {
      const nextIndex = Number(categoryIndexes[category] || 0) + 1;
      pushTarget({ category, ...productDetailExpansionSlot(category, nextIndex) });
    }
  }
  return targets.slice(0, total);
}

function planHasDetailMethodologyNarrative(plan = {}) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  if (!shots.length) return false;
  const firstSlots = shots.slice(0, Math.min(3, shots.length)).map((shot) => String(shot?.promptRoute?.sequenceSlot || shot?.sequenceSlot || ""));
  const expected = ["detail-cover", "scene-context", "function-core"].slice(0, firstSlots.length);
  const hasSequence = expected.every((slot, index) => firstSlots[index] === slot);
  const hasMethodology = shots.every((shot) => String(shot?.promptRoute?.methodologyId || "") === DETAIL_CREATION_METHODOLOGY.methodologyId);
  return hasSequence && hasMethodology;
}

function productDetailMethodologyRoute(target = {}, profile = {}, source = "detail-methodology-fallback") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return {
    source,
    category: target.category || "detail",
    label: categoryLabel(target.category || "detail"),
    sequenceSlot: target.sequenceSlot || "",
    pageRole: target.pageRole || target.sequenceSlot || "",
    storyIndex: target.storyIndex || 1,
    methodologyId: target.methodologyId || DETAIL_CREATION_METHODOLOGY.methodologyId,
    visualDialect: target.visualDialect || productDetailVisualDialectForSlot(target.sequenceSlot, target.category),
    lampChannel: safeProfile.lampChannel,
    mountFamily: safeProfile.mountFamily
  };
}

function productDetailStyleSummary(profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return cleanPromptPart([
    safeProfile.visualStrategy?.productStyle,
    safeProfile.style,
    safeProfile.material,
    safeProfile.colorPalette
  ].filter(Boolean).join("，")) || "根据上传产品的真实造型、材质和光感建立统一主题";
}

function detailCoverTargetLike(target = {}, category = "") {
  const value = String(category || target.category || "").toLowerCase();
  const slot = String(target.sequenceSlot || target.pageRole || target.id || target.visualDialect || "");
  return (value === "main" || value === "scene") && /detail-cover|cover-spatial-hero|首图|首屏|封面/i.test(slot);
}

function detailCoverModelDirectDesignPrompt(profile = {}, { settings = {}, userRequirement = "" } = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const productName = cleanPromptPart(safeProfile.productName) || "上传灯具";
  const style = productDetailStyleSummary(safeProfile);
  const art = modelDirectHeroCoverArtDirection(safeProfile, {});
  const productFacts = cleanPromptPart([
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.visibleParts || safeProfile.structureKeywords,
    safeProfile.visualStrategy?.lightingEffect
  ].filter(Boolean).join("，"));
  const subjectLine = `主体保真：画面中的灯具必须来自上传产品，保留${productFacts || "真实轮廓、材质、发光面和安装结构"}。`;
  const userLine = cleanPromptPart(userRequirement) ? `用户补充：${cleanPromptPart(userRequirement)}` : "";
  return normalizeProductVisiblePrompt([
    `详情页首图/封面主视觉：为${productName}生成全幅电商详情页封面设计稿，不是普通场景照加标题。`,
    `整套主题：围绕${productName}的${style}建立第一眼购买印象，画面风格必须来自识别到的产品材质、颜色、光影和适用空间。`,
    `首图设计导演：风格族=${art.label}；构图=${art.composition}；色彩=${art.palette}；字体=${art.typography}；标题位置=${art.titlePlacement}。`,
    nonCloseupSpatialLensBrief(safeProfile, settings, { prefix: "首图封面镜头" }),
    nonCloseupSpatialExecutionGuard(safeProfile, settings),
    "构图约束：完整住宅空间摄影优先，灯具以真实比例作为空间陈设；镜头从入口、餐桌外或走廊端头观察，画面包含地面、墙面、家具和空间纵深。",
    "画面：先成立完整空间尺度和自然负空间，再让灯具按真实比例出现，标题融入画面内自然负空间，文字区域不超过画面高度10%-14%，保持全幅封面主视觉。",
    "文字策略：只生成1行简体中文短标题，6-12字，细字重现代中文标题；不生成副标题、标签、长句、参数、英文、拼音、价格或品牌。",
    "版式禁区：禁底部白条、顶部白条、侧边白条、独立标题栏、纯白文字区、模板海报白块、粗黑大字。",
    subjectLine,
    userLine
  ].filter(Boolean).join("\n"), "main");
}

function promptHasSpatialBriefContract(prompt = "") {
  const text = String(prompt || "");
  return /场景[：:]/.test(text)
    && /视角[：:]/.test(text)
    && /机位角度[：:]|机位[：:]/.test(text)
    && /灯具比例[：:]/.test(text)
    && /画面参照[：:]/.test(text);
}

function nonCloseupForbiddenPromptText(prompt = "") {
  return /(微距|局部特写|产品特写|大特写|贴脸|近景大头|近景|贴近天花|低角度仰拍|只拍灯体|主体占满画面|大头灯|超大主体)/.test(String(prompt || ""));
}

function nonCloseupSpatialScaleViolationText(prompt = "") {
  const text = String(prompt || "");
  const scaleFragments = text.match(/灯具比例[：:][^。；\n]*/g) || [];
  const scaleText = scaleFragments.join(" ")
    .replace(/下缘[^。；\n]*?\d+\s*%/g, "")
    .replace(/画面高度\s*\d+\s*%/g, "");
  if (/(?:[2-9]\d|100)\s*%/.test(scaleText)) return true;
  const positiveText = text.replace(/不(?:得|能|要|允许)?[^。；\n]*(?:半屏主视觉|上半屏主视觉|画面中线|压到画面中线|前景主灯|前景吊灯|遮挡餐桌|遮挡沙发)[^。；\n]*/g, "");
  return /(半屏主视觉|上半屏主视觉|压到画面中线|居中压屏|灯体巨大|灯具巨大|主体巨大|前景主灯|前景吊灯|放大主视觉|遮挡餐桌|遮挡沙发)/.test(positiveText);
}

function detailCoverPromptHasStrongBrief(prompt = "") {
  const text = String(prompt || "");
  return /全幅.*电商详情页.*封面|电商详情页.*封面设计稿|全幅.*封面设计稿/.test(text)
    && /(?:1\s*行|一行|单行).*短标题|短标题.*(?:1\s*行|一行|单行)/.test(text)
    && /6\s*[-到至~—]\s*12\s*字|6-12字|六到十二字/.test(text)
    && /底部白条/.test(text)
    && /独立标题栏|纯白文字区|粗黑大字/.test(text)
    && /文字区域.*10%.*14%|10%-14%/.test(text)
    && promptHasSpatialBriefContract(text);
}

function detailCoverPromptNeedsRepair(prompt = "", target = {}, category = "") {
  if (!detailCoverTargetLike(target, category)) return false;
  const text = String(prompt || "").trim();
  if (text.length < 260) return true;
  if (!detailCoverPromptHasStrongBrief(text)) return true;
  if (nonCloseupForbiddenPromptText(text)) return true;
  if (nonCloseupSpatialScaleViolationText(text)) return true;
  if (/留出标题层级|标题层级|短副标题|少量标签|大块留白|后置预留|底部白色区域|标题栏|普通场景照加标题/.test(text)) return true;
  return false;
}

function repairDetailCoverPromptIfNeeded(prompt = "", { target = {}, profile = {}, settings = {}, layout = "" } = {}) {
  const category = target.category || "main";
  if (!detailCoverPromptNeedsRepair(prompt, target, category)) return prompt;
  return detailCoverModelDirectDesignPrompt(profile, { settings, userRequirement: layout });
}

function productDetailChannelSceneInstruction(profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    nonCloseupSpatialLensBrief(safeProfile, settings, { prefix: "场景镜头" }),
    nonCloseupSpatialExecutionGuard(safeProfile, settings)
  ].join(" ");
}

function productDetailMethodologyPromptForTarget(target = {}, profile = {}, settings = {}, userRequirement = "") {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const slot = String(target.sequenceSlot || "");
  const category = target.category || "detail";
  const productName = cleanPromptPart(safeProfile.productName) || "上传灯具";
  const style = productDetailStyleSummary(safeProfile);
  const productFacts = cleanPromptPart([
    safeProfile.lampType,
    safeProfile.lampSubtype,
    safeProfile.visibleParts || safeProfile.structureKeywords,
    safeProfile.visualStrategy?.lightingEffect
  ].filter(Boolean).join("，"));
  const textLine = "文字策略：允许规划好的简体中文短标题、短副标题、少量标签或必要引线标注，文字有层级，不出现品牌、水印、价格、英文乱码或未确认参数。";
  const subjectLine = `主体保真：画面中的灯具必须来自上传产品，保留${productFacts || "真实轮廓、材质、发光面和安装结构"}。`;
  const suiteLine = `整套主题：围绕${productName}的${style}做当前产品专属详情图，学习内置详情图方法论的内容规划和视觉语言，不复制参考图品牌、参数、证书或原文案。`;
  const userLine = cleanPromptPart(userRequirement) ? `用户补充：${cleanPromptPart(userRequirement)}` : "";

  if (slot === "detail-cover") {
    return detailCoverModelDirectDesignPrompt(safeProfile, { settings, userRequirement });
  }
  if (slot === "scene-context") {
    return normalizeProductVisiblePrompt([
      `真实比例场景图：把${productName}放入与产品风格匹配的完整住宅空间，先有房间尺度，再有灯具。`,
      productDetailChannelSceneInstruction(safeProfile, settings),
      "构图约束：完整住宅空间摄影优先，灯具以真实比例作为空间陈设；镜头从入口、餐桌外或走廊端头观察，画面包含地面、墙面、家具和空间纵深。",
      "画面：保持中远景完整空间照片感，保留家具、墙面、地面、天花和生活物件作比例参照。",
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (slot === "function-core") {
    const functionTopic = cleanPromptPart(safeProfile.functionText || safeProfile.sellingPoint || safeProfile.lightUse || safeProfile.structureKeywords) || "舒适光效或真实结构优势";
    return normalizeProductVisiblePrompt([
      `核心功能图：只讲一个有依据的功能/卖点：${functionTopic}。`,
      "画面：图文详情页版式，用大标题、短说明、局部产品图或光效示意组织内容；不要做八大功能合集，不写未识别品牌、认证、芯片、专利、功率或检测参数。",
      textLine,
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (/material|detail/.test(slot)) {
    return normalizeProductVisiblePrompt([
      `材质/细节页：聚焦${productName}的${cleanPromptPart(safeProfile.material || safeProfile.visibleParts || safeProfile.structureKeywords) || "真实材质、发光面和连接细节"}。`,
      "画面：允许近景、局部放大、引线标注和简体中文材质标签，只讲一处真实可见细节，不重复首图或场景图。",
      textLine,
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (/dimension|param/.test(slot)) {
    const specText = cleanPromptPart([safeProfile.openingSize, safeProfile.power, safeProfile.colorTemperature, safeProfile.cri].filter(Boolean).join("，"));
    return normalizeProductVisiblePrompt([
      "尺寸/参数页：用产品小图、尺寸线、规格字段或结构关系做清晰参数版式。",
      specText ? `只写已确认参数：${specText}。` : "没有确认数值时，不编造 mm、W、Ra、认证或芯片，只表达结构尺度关系和安装提示。",
      textLine,
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (/control/.test(slot)) {
    const controlText = cleanPromptPart(safeProfile.adjustable || safeProfile.functionText || safeProfile.sellingPoint);
    return normalizeProductVisiblePrompt([
      `控制/使用方式页：${controlText ? `只表达已确认内容：${controlText}` : "如果没有明确控制方式，只改为真实光效或安装使用优势页"}。`,
      "画面：少量图文卡片或生活使用场景，不编造 APP、遥控、语音、认证或智能品牌。",
      textLine,
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (/scene/.test(slot)) {
    return normalizeProductVisiblePrompt([
      `适用空间扩展图：换一个与${style}一致的住宅空间表达${productName}的使用价值。`,
      productDetailChannelSceneInstruction(safeProfile, settings),
      "画面必须与第二张场景图错开空间或视角，保持中远景完整空间、真实比例和整套色彩光影统一。",
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  if (/real/.test(slot)) {
    return normalizeProductVisiblePrompt([
      `实拍感展示：模拟${productName}真实到货或安装后的自然拍摄质感。`,
      "画面：真实镜头、自然阴影和可触摸材质，不做海报功能卡片，不新增无关文字。",
      subjectLine,
      userLine
    ].filter(Boolean).join("\n"), category);
  }
  return normalizeProductVisiblePrompt([
    `单卖点详情页：围绕${productName}的一个购买理由组织画面。`,
    suiteLine,
    "画面：标题、短副标题、少量标签和产品/局部/光效组合，信息简洁有层级，不做多卖点堆叠。",
    textLine,
    subjectLine,
    userLine
  ].filter(Boolean).join("\n"), category);
}

function buildLocalProductMethodologyPlan(product = {}, files = [], counts = {}, settings = {}, layout = "", routeSource = "detail-methodology-fallback") {
  const userRequirement = String(product.requirement || layout || "").trim();
  const profile = gateSmallLampSpecEvidence(enhanceSmallLampProfileFromHints(
    applyLargeLampProfileFromHints(inferProductProfile(product, files), userRequirement, product, settings),
    userRequirement,
    product,
    settings
  ), product, userRequirement);
  const targets = productPlanTargetShots(counts, settings);
  const categoryCounters = {};
  const shots = targets.map((target, index) => {
    const category = target.category || "detail";
    categoryCounters[category] = Number(categoryCounters[category] || 0) + 1;
    const promptRoute = productDetailMethodologyRoute(target, profile, routeSource);
    const prompt = productDetailMethodologyPromptForTarget(target, profile, settings, userRequirement);
    const textRenderMode = isCriticalDetailTextShot({ category, promptRoute }, category) ? "model-direct" : "";
    return {
      id: target.id || `${category}-${categoryCounters[category]}`,
      category,
      title: target.title || `${categoryLabel(category)} ${categoryCounters[category]}`,
      description: target.description || categoryDescription(category, profile),
      ratio: String(settings.ratio || "3:4 竖版"),
      referenceIndex: index,
      variationIndex: index + 1,
      prompt,
      generationPrompt: prompt,
      promptRoute,
      textRenderMode,
      imageUrl: "",
      status: "pending"
    };
  });
  return { product: profile, shots, source: routeSource };
}

function buildProductWorkspaceDetailPlanFromRecognition({
  product = {},
  recognizedProduct = {},
  files = [],
  counts = {},
  layout = "",
  settings = {},
  templateReferenceCount = 0,
  analysis = {},
  promptMode = ""
} = {}) {
  const normalizedCounts = normalizeCounts(counts);
  const userRequirement = String(product.requirement || layout || "").trim();
  const layoutOverrides = extractProfileOverridesFromLayout(userRequirement);
  const baseProduct = applyLargeLampProfileFromHints(
    applySelectedLampCategory(mergeProfileProduct(product, layoutOverrides), settings),
    userRequirement,
    product,
    settings
  );
  const profile = gateSmallLampSpecEvidence(enhanceSmallLampProfileFromHints(
    applyLargeLampProfileFromHints(
      applySelectedLampCategory(mergeProfileProduct(baseProduct, recognizedProduct), settings),
      userRequirement,
      baseProduct,
      settings
    ),
    userRequirement,
    baseProduct,
    settings
  ), baseProduct, userRequirement);
  const methodology = buildLocalProductMethodologyPlan(
    profile,
    files,
    normalizedCounts,
    settings,
    userRequirement,
    "detail-methodology-planner"
  );
  const source = String(analysis?.source || "").trim();
  const model = String(analysis?.model || "").trim();
  const planAnalysis = {
    ...(analysis || {}),
    source: source ? `${source}-detail-methodology` : "profile-recognition-detail-methodology",
    model,
    promptMode: promptMode || (userRequirement ? "optimize" : "generate"),
    optimizedRequirement: userRequirement,
    warning: [analysis?.warning, "已根据产品识别结果按内置详情页叙事实时生成每张图 prompt"].filter(Boolean).join("；")
  };
  return {
    profile: methodology.product,
    designSpec: buildDesignSpec(methodology.product, settings, normalizedCounts, templateReferenceCount),
    analysis: planAnalysis,
    promptDispatch: {
      source: "detail-methodology-planner",
      model,
      warning: "detail-methodology-planner"
    },
    counts: normalizedCounts,
    settings,
    shots: methodology.shots
  };
}

const GPT_PRODUCT_PLAN_MODE = "gpt-design-spec-v1";
const GPT_PRODUCT_CONSISTENCY_BRIEF =
  "生图一致性简版：以参考产品图为准，保持产品本体、结构、比例、颜色、材质、组件、表面细节和可见文字一致；不得新增、替换或改造产品组件与文字。场景/安装/功能图保持符合该灯具类型的真实安装比例。";

const GPT_PRODUCT_FIXED_TARGET_SEQUENCE = [
  { category: "main", title: "详情页首张图", type: "详情页首屏主视觉", sequenceSlot: "detail-cover", description: "详情页第一屏模块，产品主视觉+核心标题+短卖点组，建立第一眼购买兴趣" },
  { category: "scene", title: "场景图", type: "风格/空间定位页", sequenceSlot: "scene-context", description: "用真实空间说明产品适用场景、生活方式、安装关系和氛围价值" },
  { category: "detail", title: "细节图", type: "核心细节证明页", sequenceSlot: "material-detail", description: "把产品关键细节转译成购买利益点，而不是单纯微距照片" },
  { category: "function", title: "功能图", type: "核心功能证明页", sequenceSlot: "function-core", description: "用可视化光效、对比、说明卡或示意结构证明一个核心功能价值" }
];

const GPT_PRODUCT_AUTO_FILL_POOL = [
  { category: "function", title: "安装示意图", type: "安装优势页", sequenceSlot: "install-function", description: "用痛点标题、安装场景、步骤/箭头/说明卡证明安装方式和优势" },
  { category: "detail", title: "材质工艺图", type: "材质工艺证明页", sequenceSlot: "material-value", description: "把表面处理、金属质感、灯罩或工艺细节转成可信卖点" },
  { category: "function", title: "光效表现图", type: "光效证明页", sequenceSlot: "lighting-function", description: "用光束、光斑、照明范围或前后对比证明光效价值" },
  { category: "real", title: "实拍质感图", type: "实拍体验页", sequenceSlot: "studio-real", description: "模拟真实拍摄质感、自然透视和到货观感，增强可信度" },
  { category: "selling", title: "核心卖点图", type: "核心卖点页", sequenceSlot: "core-reason", description: "用标题、主视觉和底部卖点卡突出一个购买理由" },
  { category: "scene", title: "多场景应用图", type: "多场景应用页", sequenceSlot: "application-scene", description: "展示另一类适用空间或使用场景，说明适配范围" },
  { category: "function", title: "尺寸结构图", type: "尺寸/结构说明页", sequenceSlot: "dimension-params", description: "用简洁结构示意、尺寸关系或安装空间需求降低购买疑虑" },
  { category: "detail", title: "组件细节图", type: "组件细节证明页", sequenceSlot: "emitter-detail", description: "围绕发光面、连接件、灯体边缘或局部组件说明一个真实优势" },
  { category: "scene", title: "氛围场景图", type: "氛围应用页", sequenceSlot: "application-scene-alt", description: "展示不同空间氛围下的使用效果和情绪价值" },
  { category: "selling", title: "价值卖点图", type: "价值卖点页", sequenceSlot: "selling-point-2", description: "补充一个与前面不重复的购买理由，可用对比条或结论卡表达" },
  { category: "real", title: "安装后实拍图", type: "安装后实拍页", sequenceSlot: "installed-real", description: "展示安装完成后的自然现场效果和真实比例" }
];

function isGptDesignSpecSettings(settings = {}) {
  return isProductWorkspaceSettings(settings) && String(settings?.productPlanMode || "") === GPT_PRODUCT_PLAN_MODE;
}

function isGptProductDesignPlan(plan = {}) {
  const source = String(plan?.analysis?.source || plan?.promptDispatch?.source || "");
  return (
    String(plan?.designSpec?.mode || plan?.analysis?.planMode || plan?.settings?.productPlanMode || "") === GPT_PRODUCT_PLAN_MODE ||
    source === "gpt-design-spec-plan" ||
    source.startsWith("gpt-design-spec-plan")
  );
}

function isGptProductDesignShot(shot = {}, settings = {}) {
  const source = String(shot?.promptRoute?.source || "");
  return isGptDesignSpecSettings(settings) || String(shot?.planMode || "") === GPT_PRODUCT_PLAN_MODE || source === "gpt-design-spec-plan";
}

function gptProductPlanTargets(counts = {}, settings = {}) {
  const total = Math.max(1, totalCountFromServerCounts(counts) || 1);
  const categoryIndexes = Object.fromEntries(SHOT_CATEGORY_KEYS.map((key) => [key, 0]));
  const targets = [];
  const push = (meta = {}, options = {}) => {
    const category = SHOT_CATEGORY_KEYS.includes(meta.category) ? meta.category : "selling";
    if (targets.length >= total) return false;
    categoryIndexes[category] += 1;
    const index = categoryIndexes[category];
    const sequenceIndex = targets.length + 1;
    targets.push({
      id: meta.id || `${category}-${index}`,
      category,
      type: meta.type || meta.title || categoryLabel(category),
      title: meta.title || `${categoryLabel(category)} ${index}`,
      description: meta.description || categoryDescription(category, {}),
      sequenceSlot: meta.sequenceSlot || "",
      locked: Boolean(options.locked),
      autoFill: Boolean(options.autoFill),
      referenceIndex: targets.length,
      variationIndex: sequenceIndex
    });
    return true;
  };

  if (String(settings.imageScope || "") === "main" || Number(counts?.main || 0) >= total) {
    while (targets.length < total) {
      push({
        category: "main",
        title: "主图",
        type: "主图",
        sequenceSlot: "",
        description: "电商主图产品展示"
      }, { locked: true });
    }
    return targets.slice(0, total);
  }

  GPT_PRODUCT_FIXED_TARGET_SEQUENCE.slice(0, Math.min(total, 4)).forEach((meta) => {
    push(meta, { locked: true });
  });

  let autoIndex = 0;
  while (targets.length < total) {
    const poolItem = GPT_PRODUCT_AUTO_FILL_POOL[autoIndex % GPT_PRODUCT_AUTO_FILL_POOL.length];
    push({
      ...poolItem,
      id: `auto-${targets.length + 1}`
    }, { autoFill: true });
    autoIndex += 1;
  }

  return targets.slice(0, total);
}

function gptProductProfileText(profile = {}) {
  return [
    profile.lampSubtype,
    profile.lampType,
    profile.lampCategoryLabel,
    profile.lampCategory,
    profile.mountFamily,
    profile.installSurface,
    profile.structureKeywords,
    profile.productName
  ].filter(Boolean).join(" ");
}

function isRecessedGptProductProfile(profile = {}) {
  const text = gptProductProfileText(profile);
  return /recessed[-\s]?downlight|嵌入|嵌入式|暗装|开孔|石膏板|吊顶开孔|面环/i.test(text);
}

function recessedGptLampLabel(profile = {}) {
  const text = gptProductProfileText(profile);
  if (/射灯|spotlight/i.test(text)) return "嵌入式射灯";
  if (/筒灯|downlight/i.test(text)) return "嵌入式筒灯";
  return "嵌入式灯具";
}

function recessedCeilingInstallPhrase(profile = {}) {
  return `将该${recessedGptLampLabel(profile)}真实嵌入石膏板天花板。`;
}

function gptProductTargetNeedsRecessedCeilingPhrase(target = {}, prompt = "") {
  const category = String(target.category || "");
  const text = [
    category,
    target.type,
    target.title,
    target.description,
    target.sequenceSlot,
    prompt
  ].filter(Boolean).join(" ");
  const explicitCeilingContext = /安装|天花|吊顶|场景|光效|照明|开孔|石膏板|真实嵌入/i.test(text);
  if (/detail|material/.test(category) && !explicitCeilingContext) return false;
  if (/scene|real|install|application/i.test(category)) return true;
  if (/function|main/i.test(category)) return explicitCeilingContext;
  return explicitCeilingContext;
}

function ensureRecessedCeilingInstallPhrase(prompt = "", profile = {}, target = {}) {
  const text = String(prompt || "").trim();
  if (!text || !isRecessedGptProductProfile(profile)) return text;
  const phrase = recessedCeilingInstallPhrase(profile);
  if (text.includes(phrase) || /真实嵌入石膏板天花板|嵌入石膏板天花板/.test(text)) return text;
  if (!gptProductTargetNeedsRecessedCeilingPhrase(target, text)) return text;
  const suffix = `产品安装要求：${phrase}`;
  const base = promptWithinCharacterLimit(text, Math.max(120, 520 - Array.from(suffix).length - 1));
  return `${base} ${suffix}`;
}

const GPT_PRODUCT_LAYOUT_EXPERIMENT_TYPES = [
  "全幅主视觉型",
  "场景沉浸型",
  "左右对比型",
  "三宫格细节型",
  "剖面说明型",
  "参数卡片型",
  "实拍证据型",
  "光效可视化型",
  "步骤示意型",
  "材质拼贴型",
  "留白杂志型",
  "前后对比型"
];

function gptProductPromptVariant(settings = {}) {
  const value = String(
    settings.promptVariant ||
      settings.detailPromptVariant ||
      settings.productPromptVariant ||
      settings.promptLayoutMode ||
      "layout-v2"
  ).trim().toLowerCase();
  return value === "stable" ? "stable" : "layout-v2";
}

function gptProductPromptPlanningLines(settings = {}) {
  if (gptProductPromptVariant(settings) !== "layout-v2") {
    return [
      "每条 Prompt 必须包含这 5 个要素：页面类型、销售任务、标题方向、画面结构、视觉要求、产品要求。",
      "单张 Prompt 固定写法：为该产品生成一张【页面类型】电商详情页模块海报。销售任务：说明这张图要证明什么、说服用户什么。标题方向：给出 8-16 字中文标题方向。画面结构：顶部标题区，中部主视觉，底部卖点卡/对比条/说明区/参数卡之一。视觉要求：整套图统一字体层级、色彩系统、留白和电商质感。产品要求：产品外观以参考图为准。",
      "单张 Prompt 范围：建议 180-420 个中文字符，复杂功能图可略长；必须像可执行的电商详情页版式 brief，不要像识别报告，也不要堆成后端规则长文。",
      "单张 Prompt 避免：不要只写“生成一张场景图/细节图/产品图”；不要只有摄影画面而没有电商版式；不要复述完整整体设计规范；不要把多张图片内容写进同一条；不要加入产品图中不存在的结构、颜色、文字或参数；不要把产品零件识别报告塞进 Prompt；不要写“整体设计规范”“严格还原参考图”等总规则。"
    ];
  }
  return [
    "正式版 Prompt 规划：保留用户容易编辑的字段，但不要把整套图写成同一个模板反复改细节。",
    `版式类型池：${GPT_PRODUCT_LAYOUT_EXPERIMENT_TYPES.join("、")}。每条 Prompt 必须选择一个版式类型，并避免连续两张使用同一版式；除非产品用途强制，否则整套图至少使用 3 种版式。`,
    "每条 Prompt 必须包含这些字段：页面类型、销售任务、标题方向、版式类型、画面结构、视觉要求、产品要求。",
    "单张 Prompt 字段写法：为该产品生成一张【页面类型】电商详情页模块海报。销售任务：说明这张图要证明什么、说服用户什么。标题方向：给出 8-16 字中文标题方向。版式类型：从版式类型池中选择一个。画面结构：根据版式类型描述主体位置、镜头距离、信息模块、留白节奏和页面阅读顺序。视觉要求：整套图统一字体层级、色彩系统、留白和电商质感。产品要求：产品外观以参考图为准。",
    "画面结构写法：不要所有图片都写成“顶部标题区 + 中部主视觉 + 底部卡片”；可以使用全幅场景、左右对比、三宫格细节、局部剖面、参数卡片、实拍证据、光效曲线、步骤示意、材质拼贴等不同结构。",
    "单张 Prompt 范围：建议 180-360 个中文字符，复杂功能图最多 420；必须像用户可编辑的电商详情页版式 brief，不要像识别报告，也不要堆成后端规则长文。",
    "单张 Prompt 避免：不要只写版式标签不写画面；不要只有摄影画面而没有电商版式；不要复述完整整体设计规范；不要把多张图片内容写进同一条；不要加入产品图中不存在的结构、颜色、文字或参数；不要把产品零件识别报告塞进 Prompt；不要写“整体设计规范”“严格还原参考图”等总规则。"
  ];
}

function productDesignSpecPlanRequestPrompt({ product = {}, counts = {}, layout = "", settings = {} } = {}) {
  const cleanLayout = stripUserVisiblePlanningNoise(layout || product.requirement || "");
  const targets = gptProductPlanTargets(counts, settings);
  const total = targets.length || 1;
  const imageModel = resolveModel(settings.model || DEFAULT_IMAGE_MODEL);
  const clarity = CREDIT_RULES.clarity[settings.clarity]?.label || settings.clarity || "2K 高清";
  const ratio = settings.ratio || "3:4 竖版";
  const selectedCategory = hasForcedLampCategory(settings, product) ? selectedLampCategorySpec(settings, product) : null;
  const promptVariant = gptProductPromptVariant(settings);
  const promptPlanningLines = gptProductPromptPlanningLines(settings);
  const designSpecJsonShape = promptVariant === "layout-v2"
    ? '{"profile":{"productName":"","lampType":"","lampSubtype":"","material":"","colorPalette":"","structureKeywords":"","style":"","scaleClass":"","installSurface":"","mountFamily":""},"designSummaryText":"设计大纲：\\n风格基调：...\\n组图节奏：...\\n版式变化：...\\n比例空间：...\\n文案策略：...\\n产品一致性：...","designSpecText":"整体设计规范：\\n产品定位：...\\n视觉基调：...\\n画面语言：...\\n色彩氛围：...\\n组图结构：...\\n组图变化策略：...\\n比例与空间：...\\n文案策略：...\\n产品一致性：...\\n禁止变化：...\\n用户特殊要求：...","prompts":[{"id":"scene-1","title":"场景图","type":"场景图","category":"scene","prompt":"单张动态生图 brief"}]}'
    : '{"profile":{"productName":"","lampType":"","lampSubtype":"","material":"","colorPalette":"","structureKeywords":"","style":"","scaleClass":"","installSurface":"","mountFamily":""},"designSummaryText":"设计大纲：\\n风格基调：...\\n组图节奏：...\\n比例空间：...\\n文案策略：...\\n产品一致性：...","designSpecText":"整体设计规范：\\n产品定位：...\\n视觉基调：...\\n画面语言：...\\n色彩氛围：...\\n组图结构：...\\n比例与空间：...\\n文案策略：...\\n产品一致性：...\\n禁止变化：...\\n用户特殊要求：...","prompts":[{"id":"scene-1","title":"场景图","type":"场景图","category":"scene","prompt":"单张动态生图 brief"}]}';
  const fixedStructureLines = [
    "N 张图结构规则：",
    "1 张：只输出 1 张详情页首张图。",
    "2 张：详情页首张图 + 场景图。",
    "3 张：详情页首张图 + 场景图 + 细节图。",
    "4 张：详情页首张图 + 场景图 + 细节图 + 功能图。",
    "5 张及以上：前 4 张固定不变，剩余张数根据当前产品特点从补位池自动选择，不要重复同一种表达。"
  ];
  return [
    "你是灯具电商详情图设计规划模型。请观察用户上传的灯具产品图，一次性生成整体设计规范和可直接用于生图模型的动态 Prompt。",
    `用户已选择：生成模型=${imageModel.label || imageModel.id}；生成数量 N=${total}；清晰度=${clarity}；画幅=${ratio}；Prompt版本=${promptVariant === "layout-v2" ? "正式版" : "稳定版"}。`,
    selectedCategory
      ? `前端预设灯具种类：${selectedCategory.label}。${selectedCategory.hint ? `类目提示：${selectedCategory.hint}。` : ""}整体设计规范的产品定位和图片任务规划必须优先按该预设分析。`
      : "前端预设灯具种类：自动识别，请根据参考图判断真实灯具类型。",
    "核心逻辑：整体设计规范用于让你规划整套详情图；系统会自动附加固定一致性简版给生图模型；单张 Prompt 只负责当前这一张详情页模块海报的表达。",
    "任务：",
    "1. 观察上传的灯具产品图，识别灯具类别、整体气质、适合的电商详情页表达方向；产品外观细节只需作为参考图一致性依据，不要写成零件清单。",
    "2. 根据以下范式生成该产品的“整体设计规范”。它是电商详情页视觉规划，不是产品结构鉴定报告，也不要写成一条冗长生图 Prompt：",
    "整体设计规范：",
    "产品定位：用一句话说明灯具类别、适用空间和电商详情页定位；类别优先采用前端预设，预设为空时再自行识别。",
    `视觉基调：围绕该产品规划 ${clarity}、超写实/照片级、干净高级、现代电商详情页风格；说明画面要给用户的第一感受。`,
    "画面语言：规划背景、镜头、光影、留白、主体位置、真实安装比例和空间尺度；重点是如何拍、如何排版、如何让产品显得专业可信。",
    "色彩氛围：基于参考图产品本体颜色规划整体详情页配色、背景色、辅助色和高光氛围；不要把产品颜色重新设计成另一套。",
    "组图结构：按 N 张图规划整套详情页的节奏，例如首张图、场景图、细节图、功能图、安装示意图、材质工艺图、光效图、实拍质感图等，每类图说明画面构成和表达目的。",
    ...(promptVariant === "layout-v2" ? ["组图变化策略：说明整套图如何在统一风格下变化版式、镜头距离、信息密度和页面节奏，避免像同一模板反复替换局部内容。"] : []),
    "比例与空间：场景图、安装图、功能图必须符合该灯具真实尺寸和安装语义，不能把灯具放大成不合理的大型装置。",
    "文案策略：如需文字，只使用少量简体中文短标题/卖点词；不要随机品牌、参数、价格、水印或英文乱码。",
    "产品一致性：产品本体、结构、颜色、材质、细节和可见文字均以参考产品图为准；整体规范里不要展开螺丝、卡扣、散热片、孔位等细节清单，除非它们是某张细节图的表达主题。",
    "禁止变化：不得改变产品造型、增加不存在的组件、替换颜色、虚构品牌文字或参数。",
    `用户特殊要求：${cleanLayout || ""}`,
    "3. 生图一致性简版由系统固定为“以参考图为准，保持产品一致性”，你不需要生成外观描述版简版，也不要把产品外观细节压缩进 consistencyBrief。",
    "4. 同时生成“设计大纲简版”designSummaryText，用于给普通用户查看。它只保留作图方向，不展示内部规则和细节清单：5-7 行即可，建议包含风格基调、组图节奏、版式变化、比例空间、文案策略、产品一致性；不要写品牌参数、禁止规则长文、产品零件清单或模型执行说明。",
    "5. 基于整体设计规范和目标图片结构，为该产品生成 N 条详情图动态 Prompt。",
    "重要角色：你不是普通商品照片提示词生成器，而是电商详情页策划师。每一张图都必须是“电商详情页模块海报”，不是单纯产品照、场景照或微距照片。",
    ...fixedStructureLines,
    `自动补位池：${GPT_PRODUCT_AUTO_FILL_POOL.map((item) => item.type).join("、")}。补位时根据产品图真实结构和适合表达的卖点选择，不要机械照抄顺序。`,
    ...promptPlanningLines,
    "灯具比例要求：首张图、场景图、安装示意图、功能图必须用正向语言表达真实安装比例，例如“保持与天花、墙面、家具的自然比例”“按同类灯具真实尺寸置入空间”，不要只写“灯具不要太大”。",
    "嵌入式灯具硬要求：如果产品是嵌入式筒灯、嵌入式射灯、暗装灯或开孔灯，任何场景图、功能图、光效图、安装图、安装后实拍图里只要出现天花板照明，都必须写入这句：“将该嵌入式射灯/筒灯真实嵌入石膏板天花板”，并按真实开孔、面环贴合、灯体藏入吊顶处理。",
    "单张 Prompt 示例：为该产品生成一张【精准聚光功能页】电商详情页模块海报。销售任务：证明该射灯适合重点照明并提升空间层次。标题方向：重点照明更有层次。画面结构：顶部大标题和一句说明，中部展示射灯真实嵌入石膏板天花板并照亮墙面装饰画，底部用简洁卖点卡列出“聚光、防眩、氛围感”。视觉要求：暖灰背景、现代家居质感、标题层级清晰。产品要求：产品外观以参考图为准。",
    "每条 Prompt 可直接用于生成图像模型生成对应的电商详情页模块。",
    "6. 输出格式：",
    "为了系统读取，请只返回 JSON，不要 Markdown，不要代码块。JSON 格式：",
    designSpecJsonShape,
    "designSummaryText 必须以“设计大纲：”开头，只写用户需要看的作图方向，控制在 5-7 行。",
    "designSpecText 必须以“整体设计规范：”开头，并包含完整规范文本；不要返回 consistencyBrief，系统会自动使用固定一致性简版。",
    "前 1-4 张的用途必须严格按目标顺序；autoFill=true 的目标由你从自动补位池里按产品特点选择最合适用途，可调整 title/type/category，但不要重复前面已经表达过的内容。",
    `prompts 必须恰好 ${total} 条。目标图片顺序为：${JSON.stringify(targets.map((target, index) => ({
      index: index + 1,
      id: target.id,
      category: target.category,
      title: target.title,
      type: target.type,
      description: target.description,
      locked: target.locked,
      autoFill: target.autoFill
    })))}`
  ].join("\n");
}

function promptItemsFromDesignSpecPayload(payload = {}) {
  if (Array.isArray(payload?.prompts)) return payload.prompts;
  if (Array.isArray(payload?.shots)) return payload.shots;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function designSpecTextFromPayload(payload = {}) {
  const candidates = [
    payload?.designSpecText,
    payload?.overallDesignSpec,
    payload?.designSpec,
    payload?.["整体设计规范"]
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const text = candidate.trim();
      return /^整体设计规范[：:]/.test(text) ? text : `整体设计规范：\n${text}`;
    }
  }
  return "";
}

function trimDesignSummaryLine(value = "", limit = 86) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return `${chars.slice(0, Math.max(1, limit - 1)).join("").replace(/[，、；：:,.]*$/, "")}。`;
}

function buildDesignSummaryFromText(text = "") {
  const clean = String(text || "")
    .replace(/^整体设计规范[：:]\s*/i, "")
    .replace(/\r/g, "")
    .trim();
  if (!clean) return "";
  const fieldMap = [
    ["视觉基调", "风格基调"],
    ["组图结构", "组图节奏"],
    ["组图变化策略", "版式变化"],
    ["比例与空间", "比例空间"],
    ["文案策略", "文案策略"],
    ["产品一致性", "产品一致性"]
  ];
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);
  const picked = [];
  for (const [sourceLabel, targetLabel] of fieldMap) {
    const source = lines.find((line) => line.startsWith(`${sourceLabel}：`) || line.startsWith(`${sourceLabel}:`));
    if (!source) continue;
    picked.push(`${targetLabel}：${trimDesignSummaryLine(source.replace(new RegExp(`^${sourceLabel}[：:]\\s*`), ""))}`);
  }
  const fallback = lines
    .filter((line) => !/用户特殊要求|禁止变化|严格|不得|不要返回|consistencyBrief/i.test(line))
    .map((line) => trimDesignSummaryLine(line.replace(/^[-\d.、)\s]+/, "")))
    .filter(Boolean);
  const summaryLines = (picked.length >= 3 ? picked : fallback).slice(0, 6);
  return summaryLines.length ? `设计大纲：\n${summaryLines.join("\n")}` : "";
}

function designSummaryTextFromPayload(payload = {}, designSpecText = "") {
  const candidates = [
    payload?.designSummaryText,
    payload?.designSummary,
    payload?.designBrief,
    payload?.["设计大纲简版"],
    payload?.["设计大纲"]
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const text = candidate.trim();
    const withPrefix = /^设计大纲[：:]/.test(text) ? text : `设计大纲：\n${text}`;
    const lines = withPrefix.split("\n").map((line) => line.trim()).filter(Boolean);
    return lines.length <= 7 ? withPrefix : [lines[0], ...lines.slice(1, 7)].join("\n");
  }
  return buildDesignSummaryFromText(designSpecText);
}

function ensureDesignSpecBriefPrefix(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return /^生图一致性简版[：:]/.test(text) ? text : `生图一致性简版：${text}`;
}

function gptProductConsistencyBrief() {
  return GPT_PRODUCT_CONSISTENCY_BRIEF;
}

function promptWithinCharacterLimit(value = "", limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const sentences = text.split(/(?<=[。！？!?；;])/).map((item) => item.trim()).filter(Boolean);
  let result = "";
  for (const sentence of sentences) {
    const next = `${result}${sentence}`;
    if (Array.from(next).length > limit) break;
    result = next;
  }
  if (result) return result;
  const clipped = chars.slice(0, Math.max(1, limit - 1)).join("").replace(/[，、；：:,.]*$/, "");
  return `${clipped}。`;
}

function normalizeGptProductDynamicPrompt(value = "", limit = 420) {
  const text = String(value || "")
    .replace(/^\s*(?:Prompt|提示词|单张\s*Prompt)\s*[：:]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return promptWithinCharacterLimit(text, limit);
}

function gptDesignSpecGenerationPrompt(prompt = "", designSpec = {}, profile = {}) {
  void designSpec;
  const brief = gptProductConsistencyBrief();
  const task = ensureRecessedCeilingInstallPhrase(
    normalizeGptProductDynamicPrompt(prompt, 420),
    profile,
    { category: "", type: "", title: "", sequenceSlot: "" }
  );
  return [brief, task ? `当前图片任务：${task}` : ""].filter(Boolean).join("\n\n");
}

function normalizeGptProductDesignSpecPlanResult(payload, { product = {}, counts = {}, settings = {} } = {}) {
  const targets = gptProductPlanTargets(counts, settings);
  const incoming = promptItemsFromDesignSpecPayload(payload);
  if (incoming.length !== targets.length) {
    throw new Error(`识别模型返回的 Prompt 数量不匹配：需要 ${targets.length} 条，返回 ${incoming.length} 条`);
  }
  const designSpecText = designSpecTextFromPayload(payload);
  if (!designSpecText) throw new Error("识别模型没有返回整体设计规范");
  const designSummaryText = designSummaryTextFromPayload(payload, designSpecText);
  const profile = applySelectedLampCategory(
    sanitizeRecognitionProfile(mergeProfileProduct(product, payload?.profile || payload?.product || {})),
    settings
  );
  const consistencyBrief = gptProductConsistencyBrief();
  const byId = new Map(incoming.filter((item) => item && typeof item === "object" && item.id).map((item) => [String(item.id), item]));
  const shots = targets.map((target, index) => {
    const planned = byId.get(target.id) || incoming[index] || {};
    const rawPrompt = String(
      typeof planned === "string"
        ? planned
        : planned.prompt || planned.text || planned.content || planned.description || ""
    ).trim();
    const prompt = ensureRecessedCeilingInstallPhrase(
      normalizeGptProductDynamicPrompt(rawPrompt, 420),
      profile,
      target
    );
    if (!prompt) throw new Error(`识别模型没有返回第 ${index + 1} 条 Prompt`);
    const plannedCategory = SHOT_CATEGORY_KEYS.includes(planned.category) ? planned.category : target.category;
    const category = target.locked ? target.category : plannedCategory;
    const title = target.locked
      ? target.title
      : String(planned.title || planned.type || target.title || `${categoryLabel(category)} ${index + 1}`).trim();
    const type = target.locked ? target.type : String(planned.type || planned.title || target.type || title).trim();
    return {
      id: String(planned.id || target.id),
      category,
      title,
      description: String(planned.description || target.description || "").trim(),
      ratio: String(settings.ratio || "3:4 竖版"),
      referenceIndex: index,
      variationIndex: index + 1,
      prompt,
      generationPrompt: gptDesignSpecGenerationPrompt(prompt, { consistencyBrief, rawText: designSpecText }, profile),
      promptRoute: {
        source: "gpt-design-spec-plan",
        category,
        label: categoryLabel(category),
        pageRole: type,
        sequenceSlot: target.sequenceSlot || String(planned.sequenceSlot || ""),
        autoFill: Boolean(target.autoFill),
        planMode: GPT_PRODUCT_PLAN_MODE
      },
      planMode: GPT_PRODUCT_PLAN_MODE,
      imageUrl: "",
      status: ""
    };
  });
  return { profile, designSpecText, designSummaryText, consistencyBrief, shots };
}

async function requestProductDesignSpecPlanWithAPIYi({ files = [], product = {}, counts = {}, layout = "", settings = {}, model, apiKey, baseUrl, providerName = "OpenAI-compatible" } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key is not configured.`);
  const content = [
    { type: "text", text: productDesignSpecPlanRequestPrompt({ product, counts, layout, settings }) },
    ...files.slice(0, 4).map((file) => ({
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    }))
  ];
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(DESIGN_SPEC_ANALYSIS_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.35,
      ...openAICompatibleTokenLimit(model, 8192),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(responsePayload, `${providerName} design spec planning failed: HTTP ${response.status}`));
  const parsed = parseJsonFromText(responsePayload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} returned unparseable design spec JSON`);
  return parsed;
}

async function requestProductDesignSpecPlanWithGemini({ files = [], product = {}, counts = {}, layout = "", settings = {}, model, apiKey, baseUrl = "", providerName = "Gemini", useBearerAuth = false } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key is not configured.`);
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const parts = [
    { text: productDesignSpecPlanRequestPrompt({ product, counts, layout, settings }) },
    ...files.slice(0, 4).map((file) => ({
      inlineData: { mimeType: file.mimetype || "image/png", data: file.buffer.toString("base64") }
    }))
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(DESIGN_SPEC_ANALYSIS_TIMEOUT_MS),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.35, responseMimeType: "application/json", maxOutputTokens: 8192 }
    })
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(responsePayload, `${providerName} design spec planning failed: HTTP ${response.status}`));
  const text = responsePayload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} returned unparseable design spec JSON`);
  return parsed;
}

async function analyzeProductDesignSpecPlanWithModelPool({ db, product = {}, files = [], counts = {}, layout = "", settings = {} } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const providerKind = isGeminiAnalysisModel(analysisModel) ? "gemini" : "openai-compatible";
  const model = providerKind === "gemini" ? analysisModel.id : apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
  const raw = await runWithModelChannelRetry(db, {
    purpose: "analysis",
    modelId: model,
    providerKind,
    modelOption: providerKind === "gemini"
      ? { id: model, apiModel: model, provider: "gemini" }
      : { id: model, apiModel: model, provider: "openai" }
  }, async (channel) => {
    if (providerKind === "gemini") {
      const resolved = modelChannelGemini(channel);
      return requestProductDesignSpecPlanWithGemini({
        files,
        product,
        counts,
        layout,
        settings,
        model,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        providerName: resolved.providerName || "Gemini",
        useBearerAuth: resolved.useBearerAuth
      });
    }
    const resolved = modelChannelOpenAICompatible(channel);
    return requestProductDesignSpecPlanWithAPIYi({
      files,
      product,
      counts,
      layout,
      settings,
      model,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      providerName: resolved.providerName || "OpenAI-compatible"
    });
  });
  const normalized = normalizeGptProductDesignSpecPlanResult(raw, { product, counts, settings });
  console.info("[gpt-design-spec-plan] ok", JSON.stringify({ model, providerKind, shots: normalized.shots.length, promptChars: normalized.shots.map((shot) => String(shot.prompt || "").length) }));
  return {
    product: normalized.profile,
    designSpecText: normalized.designSpecText,
    designSummaryText: normalized.designSummaryText,
    consistencyBrief: normalized.consistencyBrief,
    shots: normalized.shots,
    analysis: { source: "gpt-design-spec-plan", model, planMode: GPT_PRODUCT_PLAN_MODE, warning: "" }
  };
}

function modelDesignSpecObject(designSpecText = "", settings = {}, counts = {}, consistencyBrief = "", designSummaryText = "") {
  const total = totalCountFromServerCounts(counts) || 1;
  return {
    title: "整体设计规范",
    subtitle: `识别模型生成的完整设计规范，共 ${total} 张图片；生图使用一致性简版`,
    summaryText: String(designSummaryText || buildDesignSummaryFromText(designSpecText) || "").trim(),
    rawText: String(designSpecText || "").trim(),
    consistencyBrief: ensureDesignSpecBriefPrefix(consistencyBrief),
    mode: GPT_PRODUCT_PLAN_MODE,
    clarity: settings.clarity || "",
    ratio: settings.ratio || ""
  };
}

function productPlanRequestPrompt({ product = {}, counts = {}, layout = "", settings = {}, repairContext = null } = {}) {
  const cleanLayout = stripUserVisiblePlanningNoise(layout || product.requirement || "");
  const targets = productPlanTargetShots(counts, settings);
  return [
    "你是灯具电商商品图的产品识别与图片规划模型。观察用户上传的灯具产品图，一次性返回产品识别 profile 和每张目标图的短生图 prompt。",
    "必须基于图片真实可见信息，不要编造产品图里没有的结构、品牌、认证、芯片、专利或价格。",
    '返回 JSON，不要解释。JSON 结构必须是：{"profile":{...},"shots":[...]}。',
    "profile 字段：productName, lampType, lampSubtype, lampChannel, mountFamily, installSurface, visibleParts, scaleClass, openingSize, beamAngle, style, material, colorPalette, functionText, targetSpace, installationPosition, installationMethod, lightUse, sellingPoint, structureKeywords, brandName, chipBrand, power, inputVoltage, colorTemperature, cri, ugr, rgLevel, fpf, flicker, adjustable, antiGlare, deepCup, confidence。",
    "颜色识别硬规则：colorPalette 只写灯具产品本体和可见部件颜色，忽略产品图背景、桌面、墙面、地面、布景、阴影和环境反光；visualStrategy.colorSystem 只根据产品本身的材质、颜色和发光口推导适合的主色、辅助色、点缀色，不要把背景色写入色彩系统。",
    "小灯 profile 要求：筒灯、射灯、明装筒灯、轨道射灯必须分清 mountFamily；installSurface 只能用 ceiling/wall/track/cabinet/unknown；visibleParts 写图片可见部件；openingSize/beamAngle 不确定就返回空字符串。",
    "大灯 profile 要求：吸顶灯、吊灯、完整主灯、枝形灯或大型贴顶灯必须进入 lampChannel=large；mountFamily 只能用 ceiling 或 chandelier；scaleClass=large；visibleParts 写完整灯体、灯罩、灯臂、底盘/吸顶盘、吊线/吊杆或大型贴顶结构。禁止把大灯误判成筒灯、射灯、轨道灯、线性灯、壁灯或 generic。",
    "大灯 shots 必须只按大灯语义规划：一盏/一套主灯、真实悬吊/贴顶关系、重心、阴影和空间尺度；空间图必须房间先行，主灯按真实家装比例挂在天花上，使用入口/餐桌外平视中远景；不要读取小灯灯位字段，不要使用小灯比例缩小规则。",
    "小灯事实门禁：brandName、chipBrand、power、inputVoltage、colorTemperature、cri、ugr、rgLevel、fpf、flicker 只有在图片文字、用户补充要求或明确产品资料中可确认时才填写；不能从外观猜测，不能照抄参考示例里的品牌、芯片、认证或数值。",
    "小灯结构判断：antiGlare/deepCup/adjustable 只能依据可见灯杯深度、遮光结构、蜂窝/格栅、转轴支架、轨道连接或用户明确描述填写；普通明装筒灯不要自动写可调角，普通小灯不要自动写轨道或嵌入。",
    "所有 profile 都必须包含 visualStrategy 对象，不分大灯、小灯、线性灯、壁灯或通用灯具；visualStrategy 必须来自当前产品真实信息，不能使用固定模板或专属兜底风格。",
    "visualStrategy 字段固定为：productStyle, suitableVisualStyle, styleKeywords, moodKeywords, lightingEffect, colorSystem, visualLanguage, decorativeElements, recommendedView, productComplexStructure, hardConstraints。",
    "首屏文案识别规则：style 只写风格词；lampSubtype 只写灯具类型；visualStrategy.productStyle 写成去重后的“风格+核心质感/材质+灯具类型”；moodKeywords 只写情绪/氛围词，不得重复风格词、灯具类型，也不要写“电商商品图”“现代商用产品图”“让空间更有层次”。",
    "visualStrategy 必须根据上传图真实产品判断：产品是什么风格，适合什么视觉风格，关键词、氛围、光影、色彩系统、视觉语言、装饰元素和推荐视角分别是什么；不要默认套用高端工业风、现代商用产品图或大小灯专属模板。",
    "所有 shots 必须读取 visualStrategy 来规划构图、背景、光影、色彩、装饰元素和文字气质；每张 prompt 不要把 visualStrategy、字段名、章节标题、字体名或 hex 色值写成画面文字。",
    "整套产品详情图必须保持同一个视觉主题：同一套色彩系统、光影气质、空间语境、材质表现和文字气质；不同图片只变化页面角色和构图，不换成另一套风格。",
    "小灯 hardConstraints 写最高优先级硬性约束：上传图可见结构、材质、文字、颜色、安装件、弹簧卡扣、反光杯拉丝、深杯、防眩结构等，只写图中真实可见或高度可信的细节。",
    "单一灯型通道：先根据 profile.lampChannel 选定唯一通道，再规划整套 shots。large 只写完整主灯/吊灯/吸顶灯的真实空间比例；small 只写筒灯/射灯/轨道小灯的小体量灯位和真实安装尺度；wall 只写墙面底座、墙体接触面和壁灯阅读/氛围关系。不要在同一套 prompt 中混用其它通道的比例、安装方式或构图术语。",
    "通道防混禁令：large prompt 不得出现小灯灯位、筒灯、射灯、嵌入式、轨道灯、开孔、面环、深杯等小灯比例词；small prompt 不得出现完整主灯、吊灯、大型吸顶灯、一盏/一套主灯、吊线、吊杆、主灯占画面等大灯比例词；wall prompt 不得出现天花灯位、筒灯、射灯、轨道灯、吊灯、主灯、嵌入式开孔等非墙装词。",
    "整套叙事要求：所有 shots 必须像同一个电商详情页主题，继承 profile.visualStrategy 的风格、色彩、光影和材质气质；每张图只承担一个清晰角色，避免重复同一卖点、同一构图或同一空间。",
    productDetailMethodologyPrompt(),
    "首图与场景图输出契约：detail-cover 和所有 category=scene / visualDialect=real-scale-scene 的 prompt 必须用正向句式写清：场景：...；视角：...；机位角度：...；灯具比例：...；画面参照：...。不要只写“完整空间”“中远景或正常视角”这类模糊词；空间完整性优先，灯具只作为空间中的陈设元素，不能成为半屏主视觉，不能占据上半屏主要面积，不能压到画面中线。",
    "首图/场景图正向写法：detail-cover 和 scene 必须直接规划成完整住宅空间摄影 brief：场景选择真实客厅/餐厅/卧室/走廊；视角使用入口、餐桌外或走廊端头平视中远景；画面先生成地面、墙面、家具和空间纵深，再放入真实比例灯具。",
    "详情页叙事顺序：严格按照 targetShots 顺序创作。第 1 张 sequenceSlot=detail-cover，是全幅电商详情页封面设计稿，要根据 visualStrategy 做出有质感的产品第一眼；它不是普通场景照加标题，不是白底主图、参数图、功能卡片、证书页或模板页；必须是中远景完整空间和灯具真实比例，房间先成立。",
    "detail-cover prompt 必须写成设计 brief：只允许 1 行 6-12 字简体中文短标题，标题融入画面自然负空间；文字区域不超过画面高度 10%-14%；必须写清场景、视角、机位角度、灯具比例、画面参照；灯具比例写真实小体量，不允许写 20% 以上占比；明确避开底部白条、顶部白条、侧边白条、独立标题栏、纯白文字区、模板海报白块和粗黑大字。",
    "第 2 张 sequenceSlot=scene-context，是真实比例场景图：必须先成立完整空间尺度，再放入灯具；画面要有家具、墙面、地面、天花/墙体或门洞等尺度参照；必须写清场景、视角、机位角度、灯具比例、画面参照；大灯外轮廓高约10%-16%、最高18%，不跨画面中线，小灯和壁灯按对应小体量比例。",
    "第 3 张 sequenceSlot=function-core，是核心功能图：只讲一个基于图片事实或用户补充信息的功能/卖点，允许简体中文图文表达；不要编造品牌、认证、专利、芯片、功率、护眼参数、检测结论或无依据数值。",
    "更多图片按 targetShots 的 sequenceSlot 继续扩展：卖点、材质工艺、尺寸参数、控制方式、应用空间、实拍展示等可以出现，但必须跟整套首图风格一致，且不能复制参考图里的品牌、参数、证书或文案。",
    smallLampPlanPromptGuidance({}, settings),
    "shots 数量和顺序必须严格匹配 targetShots。每个 shot 必须包含 id, category, title, description, prompt。",
    "整套图必须先做脚本分工：每张图只能承担一个清楚角色，卖点、功能证据、场景空间、细节角度和实拍质感都要错开；不得用同一产品信息换词复读。",
    "同类别多张图必须使用不同构图模板：例如自然负空间封面海报、局部放大、图文卡片、完整空间中远景、微距细节、真实桌面实拍；不要连续生成相同的产品居中构图；首图和场景图只能使用完整空间中远景模板。",
    "prompt 是给用户看的真实生图提示词，每张写 2-4 句中文画面指令，默认约 220-420 个中文字；要像可执行的摄影/设计 brief，不要像识别报告，也不要变成后端禁令长文。",
    "prompt 需要写清画面、构图、场景/版式、光线、主体位置、少量必要中文文案方向；功能图必须按 lampChannel 和 mountFamily 给出对应结构版式，不能把小灯按大灯功能图表达。",
    "场景图 prompt 如遇小灯，只用短句表达真实室内小型比例，例如“按真实室内小型明装筒灯比例安装在走廊天花”；不要把厘米、百分比、尺寸锁、禁区或后端规则写进用户可见 prompt。",
    "prompt 不要包含固定约束、禁区规则或识别字段清单；不要写“产品一致性”“必须保留”“禁止”“不要品牌标志/水印/价格”“上传图为唯一主体”等规则文本。",
    "同类别多张图必须主题明显不同，不能复读同一结构词或同一卖点。",
    `卖点图只讲一个购买理由；功能图用图文版式表达功能优势；场景图放入一个真实空间且必须是单张完整连续画面；细节图聚焦一个局部；实拍图像真实拍摄。${CHINA_MARKET_TEXT_LOCK}`,
    `用户补充要求：${cleanLayout || "无"}`,
    `设置：${JSON.stringify({ ratio: settings.ratio || "", imageScope: settings.imageScope || "", template: settings.template || "" })}`,
    `targetShots：${JSON.stringify(targets)}`,
    repairContext ? `上一次返回不合格，请只修复 JSON：${JSON.stringify(repairContext).slice(0, 6000)}` : ""
  ].filter(Boolean).join("\n");
}

function normalizeProductPlanResult(payload, { product = {}, counts = {}, layout = "", settings = {} } = {}) {
  const profileSource = payload?.profile || payload?.product || payload?.recognition || {};
  const profile = sanitizeRecognitionProfile(mergeProfileProduct(product, profileSource));
  const incoming = Array.isArray(payload?.shots) ? payload.shots : [];
  const targets = productPlanTargetShots(counts, settings);
  if (incoming.length !== targets.length) {
    throw new Error(`识别模型返回的图片规划数量不匹配：需要 ${targets.length} 张，返回 ${incoming.length} 张`);
  }
  const byId = new Map(incoming.filter((shot) => shot?.id).map((shot) => [String(shot.id), shot]));
  const shots = targets.map((target, index) => {
    const planned = byId.get(target.id) || incoming[index] || {};
    const category = SHOT_CATEGORY_KEYS.includes(planned.category) ? planned.category : target.category;
    if (category !== target.category) {
      throw new Error(`识别模型返回的第 ${index + 1} 张类别不匹配`);
    }
    const rawPrompt = String(planned.prompt || "").trim();
    if (!rawPrompt) {
      throw new Error(`识别模型没有返回第 ${index + 1} 张的生图提示词`);
    }
    if (isMostlyEnglishPrompt(rawPrompt)) {
      throw new Error(`识别模型返回的第 ${index + 1} 张提示词不是中文`);
    }
    if (shotRequiresNonCloseupSpatialLens({ ...target, category }, category) && nonCloseupForbiddenPromptText(rawPrompt)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张首图/场景图写成了近景或特写`);
    }
    if (shotRequiresNonCloseupSpatialLens({ ...target, category }, category) && nonCloseupSpatialScaleViolationText(rawPrompt)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张首图/场景图写成了灯具过大或压屏构图`);
    }
    if (visiblePromptContainsBackendRules(rawPrompt, { allowSpatialLensPercent: shotRequiresNonCloseupSpatialLens({ ...target, category }, category) })) {
      throw new Error(`识别模型把后端约束写进了第 ${index + 1} 张可见提示词`);
    }
    assertProductPlanPromptChannel(rawPrompt, profile, settings, index);
    const normalizedPrompt = normalizeProductVisiblePrompt(rawPrompt, category);
    const prompt = repairDetailCoverPromptIfNeeded(normalizedPrompt, {
      target: { ...target, category },
      profile,
      settings,
      layout
    });
    assertProductPlanNarrativeShot(prompt, target, index);
    if (!prompt || prompt.length < 12) {
      throw new Error(`识别模型返回的第 ${index + 1} 张提示词过短或不可用`);
    }
    const promptRoute = {
      source: "integrated-model-prompt",
      category,
      label: categoryLabel(category),
      sequenceSlot: target.sequenceSlot || "",
      pageRole: target.pageRole || target.sequenceSlot || "",
      storyIndex: target.storyIndex || index + 1,
      methodologyId: target.methodologyId || DETAIL_CREATION_METHODOLOGY.methodologyId,
      visualDialect: target.visualDialect || productDetailVisualDialectForSlot(target.sequenceSlot, category),
      lampChannel: profile.lampChannel,
      mountFamily: profile.mountFamily
    };
    const criticalTextMode = isCriticalDetailTextShot({ category, promptRoute }, category) ? "model-direct" : "";
    return {
      id: String(planned.id || target.id),
      category,
      title: String(planned.title || target.title).trim(),
      description: String(planned.description || target.description || categoryDescription(category, profile)).trim(),
      ratio: String(settings.ratio || planned.ratio || "3:4 竖版"),
      referenceIndex: index,
      prompt,
      generationPrompt: prompt,
      promptRoute,
      textRenderMode: planned.textRenderMode || criticalTextMode,
      imageUrl: "",
      status: "",
      variationIndex: index + 1
    };
  });
  return { profile, shots };
}

async function requestProductPlanWithAPIYi({ files = [], product = {}, counts = {}, layout = "", settings = {}, model, apiKey, baseUrl, providerName = "OpenAI-compatible", repairContext = null } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key is not configured.`);
  const content = [
    { type: "text", text: productPlanRequestPrompt({ product, counts, layout, settings, repairContext }) },
    ...files.slice(0, 4).map((file) => ({
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    }))
  ];
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: repairContext ? 0.25 : 0.45,
      ...openAICompatibleTokenLimit(model),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(responsePayload, `${providerName} product recognition failed: HTTP ${response.status}`));
  const parsed = parseJsonFromText(responsePayload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} returned unparseable product recognition JSON`);
  return parsed;
}

async function requestProductPlanWithGemini({ files = [], product = {}, counts = {}, layout = "", settings = {}, model, apiKey, baseUrl = "", providerName = "Gemini", useBearerAuth = false, repairContext = null } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key is not configured.`);
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const parts = [
    { text: productPlanRequestPrompt({ product, counts, layout, settings, repairContext }) },
    ...files.slice(0, 4).map((file) => ({
      inlineData: { mimeType: file.mimetype || "image/png", data: file.buffer.toString("base64") }
    }))
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: repairContext ? 0.25 : 0.45, responseMimeType: "application/json" }
    })
  });
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(responsePayload, `${providerName} product recognition failed: HTTP ${response.status}`));
  const text = responsePayload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} returned unparseable product recognition JSON`);
  return parsed;
}

async function analyzeProductPlanWithRealModel({ db, product = {}, files = [], counts = {}, layout = "", settings = {} } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const geminiKey = effectiveGeminiKey(db);
  const apiyiKey = effectiveAPIYiKey(db);
  const yunwuKey = effectiveYunwuKey(db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const geminiChannel = geminiGenerationChannel(db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const brainChannel = openAICompatibleBrainChannel(db);
  const model = apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
  const attempts = [];
  const run = async (repairContext = null) => {
    if (brainChannel.apiKey) {
      return requestProductPlanWithAPIYi({
        files,
        product,
        counts,
        layout,
        settings,
        model,
        apiKey: brainChannel.apiKey,
        baseUrl: brainChannel.baseUrl,
        providerName: brainChannel.providerName || "OpenAI-compatible",
        repairContext
      });
    }
    if (geminiChannel.apiKey) {
      return requestProductPlanWithGemini({
        files,
        product,
        counts,
        layout,
        settings,
        model: isGeminiAnalysisModel(analysisModel.id) ? analysisModel.id : "gemini-2.5-flash",
        apiKey: geminiChannel.apiKey,
        baseUrl: geminiChannel.baseUrl,
        providerName: geminiChannel.providerName || "Gemini",
        useBearerAuth: geminiChannel.useBearerAuth,
        repairContext
      });
    }
    throw new Error("商品图识别需要配置可用的识别模型 API Key。");
  };

  let raw = null;
  try {
    raw = await run();
    const normalized = normalizeProductPlanResult(raw, { product, counts, layout, settings });
    console.info("[integrated-product-plan] ok", JSON.stringify({ source: brainChannel.apiKey ? brainChannel.source : geminiChannel.providerName || "Gemini", shots: normalized.shots.length, methodologyId: productPlanUsesDetailNarrative(counts, settings) ? DETAIL_CREATION_METHODOLOGY.methodologyId : "", promptChars: normalized.shots.map((shot) => String(shot.prompt || "").length) }));
    return {
      product: normalized.profile,
      shots: normalized.shots,
      analysis: { source: brainChannel.apiKey ? `${brainChannel.source}-integrated-plan` : `${geminiChannel.providerName || "Gemini"}-integrated-plan`, model: brainChannel.apiKey ? model : (isGeminiAnalysisModel(analysisModel.id) ? analysisModel.id : "gemini-2.5-flash"), warning: "" }
    };
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
  }

  try {
    raw = await run({ previous: raw, errors: attempts, targetShots: productPlanTargetShots(counts, settings) });
    const normalized = normalizeProductPlanResult(raw, { product, counts, layout, settings });
    console.info("[integrated-product-plan] repaired", JSON.stringify({ source: brainChannel.apiKey ? brainChannel.source : geminiChannel.providerName || "Gemini", shots: normalized.shots.length, methodologyId: productPlanUsesDetailNarrative(counts, settings) ? DETAIL_CREATION_METHODOLOGY.methodologyId : "", promptChars: normalized.shots.map((shot) => String(shot.prompt || "").length) }));
    return {
      product: normalized.profile,
      shots: normalized.shots,
      analysis: { source: brainChannel.apiKey ? `${brainChannel.source}-integrated-plan-repair` : `${geminiChannel.providerName || "Gemini"}-integrated-plan-repair`, model: brainChannel.apiKey ? model : (isGeminiAnalysisModel(analysisModel.id) ? analysisModel.id : "gemini-2.5-flash"), warning: "" }
    };
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
    console.warn("[integrated-product-plan] model output repair failed:", attempts.join("；"));
    throw new Error("识别模型服务返回内容不可用，请重试。");
  }
}

async function analyzeProductPlanWithModelPool({ db, product = {}, files = [], counts = {}, layout = "", settings = {} } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const model = apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
  const analysisProviderKind = isGeminiAnalysisModel(analysisModel) ? "gemini" : "openai-compatible";
  const attempts = [];
  const run = async (repairContext = null) => runWithModelChannelRetry(db, {
    purpose: "analysis",
    modelId: analysisProviderKind === "gemini" ? analysisModel.id : model,
    providerKind: analysisProviderKind,
    modelOption: analysisProviderKind === "gemini"
      ? { id: analysisModel.id, apiModel: analysisModel.id, provider: "gemini" }
      : { id: model, apiModel: model, provider: "openai" }
  }, async (channel) => {
    if (analysisProviderKind === "gemini") {
      const resolved = modelChannelGemini(channel);
      return requestProductPlanWithGemini({
        files,
        product,
        counts,
        layout,
        settings,
        model: analysisModel.id,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        providerName: resolved.providerName || "Gemini",
        useBearerAuth: resolved.useBearerAuth,
        repairContext
      });
    }
    const resolved = modelChannelOpenAICompatible(channel);
    return requestProductPlanWithAPIYi({
      files,
      product,
      counts,
      layout,
      settings,
      model,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      providerName: resolved.providerName || "OpenAI-compatible",
      repairContext
    });
  });

  let raw = null;
  try {
    raw = await run();
    const normalized = normalizeProductPlanResult(raw, { product, counts, layout, settings });
    console.info("[integrated-product-plan] ok", JSON.stringify({ source: analysisProviderKind, model: analysisProviderKind === "gemini" ? analysisModel.id : model, shots: normalized.shots.length, methodologyId: productPlanUsesDetailNarrative(counts, settings) ? DETAIL_CREATION_METHODOLOGY.methodologyId : "", promptChars: normalized.shots.map((shot) => String(shot.prompt || "").length) }));
    return {
      product: normalized.profile,
      shots: normalized.shots,
      analysis: { source: `${analysisProviderKind}-integrated-plan`, model: analysisProviderKind === "gemini" ? analysisModel.id : model, warning: "" }
    };
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
  }

  try {
    raw = await run({ previous: raw, errors: attempts, targetShots: productPlanTargetShots(counts, settings) });
    const normalized = normalizeProductPlanResult(raw, { product, counts, layout, settings });
    console.info("[integrated-product-plan] repaired", JSON.stringify({ source: analysisProviderKind, model: analysisProviderKind === "gemini" ? analysisModel.id : model, shots: normalized.shots.length, methodologyId: productPlanUsesDetailNarrative(counts, settings) ? DETAIL_CREATION_METHODOLOGY.methodologyId : "", promptChars: normalized.shots.map((shot) => String(shot.prompt || "").length) }));
    return {
      product: normalized.profile,
      shots: normalized.shots,
      analysis: { source: `${analysisProviderKind}-integrated-plan-repair`, model: analysisProviderKind === "gemini" ? analysisModel.id : model, warning: "" }
    };
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
  }

  console.warn("[integrated-product-plan] model output repair failed:", attempts.join("；"));
  throw new Error(recognitionModelFailureMessage(attempts));
}

async function analyzeProductWithRealModel({ db, product = {}, files = [], layout = "", settings = {} } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const selectedImageModel = resolveModel(settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL);
  const geminiKey = effectiveGeminiKey(db);
  const apiyiKey = effectiveAPIYiKey(db);
  const yunwuKey = effectiveYunwuKey(db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const geminiChannel = geminiGenerationChannel(db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const brainChannel = openAICompatibleBrainChannel(db);
  const selectedGeminiVisionModel = selectedImageModel.provider === "gemini" ? selectedImageModel.apiModel : "";
  const productWorkspace = isProductWorkspaceSettings(settings);

  if (productWorkspace && brainChannel.apiKey) {
    const model = apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
    const profile = await analyzeProductWithAPIYiVision({
      files,
      product,
      layout,
      model,
      apiKey: brainChannel.apiKey,
      baseUrl: brainChannel.baseUrl,
      providerName: brainChannel.providerName || "OpenAI-compatible"
    });
    return { product: profile, analysis: { source: `${brainChannel.source}-vision`, model, warning: "" } };
  }

  if (productWorkspace && !brainChannel.apiKey) {
    throw new Error("商品图分析需要配置 GPT / OpenAI 兼容语言模型 Key。生图模型 Gemini 只用于最终出图，不用于商品图分析。");
  }

  if (geminiKey && isGeminiAnalysisModel(analysisModel)) {
    const profile = await analyzeProductWithGemini({ files, product, layout, model: analysisModel.id, apiKey: geminiKey, providerName: "Gemini" });
    return { product: profile, analysis: { source: "gemini", model: analysisModel.id, warning: "" } };
  }
  if (!productWorkspace && selectedGeminiVisionModel && geminiChannel.apiKey) {
    const profile = await analyzeProductWithGemini({
      files,
      product,
      layout,
      model: selectedGeminiVisionModel,
      apiKey: geminiChannel.apiKey,
      baseUrl: geminiChannel.baseUrl,
      providerName: geminiChannel.providerName || "Gemini",
      useBearerAuth: geminiChannel.useBearerAuth
    });
    return { product: profile, analysis: { source: `${geminiChannel.providerName || "Gemini"}-image-vision`, model: selectedGeminiVisionModel, warning: "" } };
  }
  if (!productWorkspace && brainChannel.apiKey) {
    const model = apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
    const profile = await analyzeProductWithAPIYiVision({
      files,
      product,
      layout,
      model,
      apiKey: brainChannel.apiKey,
      baseUrl: brainChannel.baseUrl,
      providerName: brainChannel.providerName || "OpenAI-compatible"
    });
    return { product: profile, analysis: { source: `${brainChannel.source}-vision`, model, warning: "" } };
  }
  throw new Error("真实产品识别不可用：请在管理员后台配置 Gemini、API易、云雾或 OpenAI 兼容识别模型 Key。");
}

async function analyzeProductWithModelPool({ db, product = {}, files = [], layout = "", settings = {} } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const selectedImageModel = resolveModel(settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL);
  const productWorkspace = isProductWorkspaceSettings(settings);
  const useGeminiVision = !productWorkspace && selectedImageModel.provider === "gemini";
  const providerKind = useGeminiVision || isGeminiAnalysisModel(analysisModel) ? "gemini" : "openai-compatible";
  const model = useGeminiVision
    ? selectedImageModel.apiModel
    : providerKind === "gemini"
      ? analysisModel.id
      : apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)[0];
  return runWithModelChannelRetry(db, {
    purpose: "analysis",
    modelId: model,
    providerKind,
    modelOption: providerKind === "gemini"
      ? { id: model, apiModel: model, provider: "gemini" }
      : { id: model, apiModel: model, provider: "openai" }
  }, async (channel) => {
    if (providerKind === "gemini") {
      const resolved = modelChannelGemini(channel);
      const profile = await analyzeProductWithGemini({
        files,
        product,
        layout,
        model,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        providerName: resolved.providerName || "Gemini",
        useBearerAuth: resolved.useBearerAuth
      });
      return { product: profile, analysis: { source: `${resolved.source || "gemini"}-vision`, model, warning: "" } };
    }
    const resolved = modelChannelOpenAICompatible(channel);
    const profile = await analyzeProductWithAPIYiVision({
      files,
      product,
      layout,
      model,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      providerName: resolved.providerName || "OpenAI-compatible"
    });
    return { product: profile, analysis: { source: `${resolved.source || "openai-compatible"}-vision`, model, warning: "" } };
  });
}

async function analyzeStyleCloneWithRealModel(args = {}) {
  return analyzeProductWithModelPool(args);
}

function promptPlannerRequest(plan = {}, layout = "", templateReferenceCount = 0, settings = {}) {
  const profile = sanitizeRecognitionProfile(plan.profile || {});
  const cleanLayout = stripUserVisiblePlanningNoise(layout);
  const activeStyleSimilar = isActiveStyleSimilarSettings(settings);
  const productWorkspace = isProductWorkspaceSettings(settings);
  const allowPlannedText = styleSimilarAllowsPlannedText(settings);
  const modeSpec = styleSimilarModeSpec(settings.similarMode);
  const styleSimilarScene = activeStyleSimilar && modeSpec.category === "scene";
  const shots = (plan.shots || []).map((shot, index) => ({
    id: shot.id || `shot-${index + 1}`,
    category: resolveShotTask(shot),
    title: shot.title || `${categoryLabel(resolveShotTask(shot))} ${index + 1}`,
    description: shot.description || "",
    referenceIndex: Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : index,
    currentPrompt: shot.prompt || ""
  }));
  const styleSimilarLines = activeStyleSimilar
    ? [
        `风格复刻模式：${modeSpec.label}。上传图片顺序是：先产品图，后参考图；每个目标图按 referenceIndex 对应参考图。`,
        `独立识别目标：${modeSpec.analysisGoal}`,
        `参考图用途：${modeSpec.referenceUse}`,
        `生成目标：${modeSpec.generationGoal}`,
        `文字策略：${modeSpec.textPolicy}`,
        `禁区：${modeSpec.negativeRules}`,
        styleSimilarScene
          ? "相似场景必须是同类但不同景；prompt 需要写出至少一个明确变化点，例如换镜头角度、换墙面主视觉、换家具布局或换天花灯位。"
          : ""
      ]
    : [];
  return [
    "你是灯具电商图提示词规划模型。请基于产品识别结果和用户上传图片，为每张目标图重写可执行生图提示词。",
    productWorkspace
      ? "返回 JSON，不要解释。prompt 是展示给用户并直接交给生图模型的短中文画面提示词，每张只写 1-3 句。"
      : "返回 JSON，不要解释。每张图必须保留真实灯具主体、结构、材质、比例、发光面和产品图可见安装结构；不要套用其它灯具类目的吊装、嵌入、轨道或壁装结构。",
    "所有 title、description、prompt 字段都必须使用简体中文。不要输出英文提示词，不要用 image_0.png、image_1.png 这类文件名描述产品。",
    "面向中国市场：画面里如果出现任何可见文字，只能是简体中文；不得规划英文标题、英文标签、拼音、英文缩写、乱码、价格、水印或品牌标志。",
    productWorkspace
      ? `普通商品图 prompt 不要复述系统规则、禁区或长约束；末尾只保留这句短主体锁定：${PRODUCT_VISIBLE_SUBJECT_LOCK}。卖点图/功能图/细节图需要文字时，再加：${PRODUCT_VISIBLE_TEXT_LOCK}`
      : "prompt 要写给生图模型执行，但仍然必须是中文；可以包含必要的产品结构词、画面构图、光线、背景、镜头要求。",
    ...styleSimilarLines,
    isSmallLampGeneration(profile, settings) ? smallLampPlanPromptGuidance(profile, settings) : "",
    productWorkspace
      ? `按图片类型分别写清楚画面目标：卖点、功能图文版式、单张完整空间场景、局部细节或真实拍摄感；避免模板腔和重复规则。场景图必须遵守：${SINGLE_SCENE_IMAGE_LOCK}`
      : allowPlannedText
      ? "禁止改款、禁止新增图片里没有的零件；必须按当前模式规划简体中文文字和必要标注；禁止随机文字、乱码、品牌标志、水印、价格或无关界面元素。"
      : "禁止改款、禁止新增图片里没有的零件、禁止随机文字、品牌标志、水印、价格、箭头或界面元素。",
    productWorkspace
      ? "套图脚本要求：先为每张目标图分配唯一角色、唯一展示重点和不同构图；同类别图片不得复读同一卖点、同一空间、同一局部角度或同一版式。"
      : "",
    `产品识别：${JSON.stringify(profile)}`,
    `用户要求：${cleanLayout || "无"}`,
    `参考图数量：${Number(templateReferenceCount || 0)}`,
    `目标图片：${JSON.stringify(shots)}`,
    '返回格式：{"shots":[{"id":"...","category":"main|selling|function|scene|detail|real","title":"中文标题","description":"中文说明","prompt":"中文生图提示词"}]}'
  ].join("\n");
}

function isMostlyEnglishPrompt(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 80 && latin > chinese * 3;
}

function visiblePromptContainsBackendRules(value = "", options = {}) {
  let text = String(value || "").trim();
  if (!text) return false;
  if (options.allowSpatialLensPercent) {
    text = text.replace(/百分比/g, "比例").replace(/\d+(?:\.\d+)?\s*%/g, "比例");
  }
  return /产品一致性|必须保留|禁止|禁区|后端|隐藏规则|小灯.*锁|尺寸锁|体量锁|锚点锁|透视锁|referenceTarget|bbox|scaleHint|百分比|%|缩小\s*20|收小约\s*20|\d+\s*[-~—至]\s*\d+\s*(?:cm|厘米)/i.test(text);
}

function productPlanLampChannel(profile = {}, settings = {}) {
  const raw = String(profile.lampChannel || "").toLowerCase();
  if (raw === "large" || isLargeLampProfile(profile, settings)) return "large";
  if (raw === "wall" || isWallLampProfile(profile, settings)) return "wall";
  if (raw === "small" || isSmallLampProfile(profile, settings)) return "small";
  if (raw === "linear") return "linear";
  return raw || "generic";
}

function productPlanChannelWarnings(prompt = "", profile = {}, settings = {}) {
  const text = String(prompt || "");
  const channel = productPlanLampChannel(profile, settings);
  const warnings = [];
  if (channel === "large" && /小灯|筒灯|射灯|轨道灯|轨道射灯|嵌入式|开孔|灯孔|灯位|面环|深杯|小体量|再小|缩小|收小/i.test(text)) {
    warnings.push("large-with-small-lamp-terms");
  }
  if (channel === "small" && /大灯|主灯|吊灯|大型吸顶灯|完整主灯|一盏\/一套主灯|一盏主灯|一套主灯|吊线|吊杆|吸顶盘|主灯占画面|大体量/i.test(text)) {
    warnings.push("small-with-large-lamp-terms");
  }
  if (channel === "wall" && /天花|吊灯|主灯|筒灯|射灯|轨道灯|嵌入式|开孔|灯孔|小灯灯位|吸顶盘|吊线|吊杆/i.test(text)) {
    warnings.push("wall-with-ceiling-or-non-wall-terms");
  }
  return warnings;
}

function assertProductPlanPromptChannel(prompt = "", profile = {}, settings = {}, index = 0) {
  const warnings = productPlanChannelWarnings(prompt, profile, settings);
  if (warnings.length) {
    throw new Error(`识别规划模型返回的第 ${index + 1} 张 prompt 混入其它灯型通道规则：${warnings.join(", ")}`);
  }
}

function assertProductPlanNarrativeShot(prompt = "", target = {}, index = 0) {
  const text = String(prompt || "").trim();
  const slot = String(target?.sequenceSlot || target?.pageRole || "");
  const targetCategory = String(target?.category || "").toLowerCase();
  const visualDialect = String(target?.visualDialect || "");
  const requiresNonCloseupSpatial = shotRequiresNonCloseupSpatialLens(target, targetCategory);
  if (requiresNonCloseupSpatial) {
    if (nonCloseupForbiddenPromptText(text)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张首图/场景图写成了近景或特写`);
    }
    if (nonCloseupSpatialScaleViolationText(text)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张首图/场景图写成了灯具过大或压屏构图`);
    }
    if (!promptHasSpatialBriefContract(text)) {
      throw new Error(`识别规划模型返回的第 ${index + 1} 张首图/场景图缺少场景、视角、机位角度、灯具比例或画面参照`);
    }
  }
  if (slot === "detail-cover") {
    if (!/(详情页|首图|首屏|封面|主视觉|质感|气质|调性|海报|高级)/.test(text)) {
      throw new Error(`识别规划模型返回的第 ${index + 1} 张不是详情页首图主视觉`);
    }
    if (!/(标题|短文案|副标题|文字层级|标题层级|标签|简体中文)/.test(text) || !/(材质|金属|木|玻璃|水晶|光影|空间|场景|氛围|发光|高光|阴影|桌|椅|墙|留白)/.test(text)) {
      throw new Error(`识别规划模型返回的第 ${index + 1} 张首图缺少标题层级、材质光影或空间氛围`);
    }
    if (/(参数表|规格表|尺寸表|功能卡片|证书|认证|检测报告|多功能合集)/.test(text)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张详情页首图写成了参数/功能/证书页`);
    }
  }
  if (targetCategory === "scene" || visualDialect === "real-scale-scene" || /scene/.test(slot)) {
    if (!/(完整.*空间|真实.*比例|中远景|房间尺度|空间尺度|家具|墙面|地面|天花|餐桌|客厅|卧室|走廊|玄关|门洞|床头)/.test(text)) {
      throw new Error(`识别规划模型返回的第 ${index + 1} 张场景图缺少真实空间尺度`);
    }
  }
  if (slot === "function-core") {
    if (/(八大|8大|四种|4种|多功能合集|参数表|证书墙|认证合集|检测报告)/.test(text)) {
      throw new Error(`识别规划模型把第 ${index + 1} 张核心功能图写成了合集或无依据背书`);
    }
    if (!/(功能|卖点|优势|护眼|调光|调色|显色|防眩|无频闪|控制|安装|光效|照明|色温|亮度|结构)/.test(text)) {
      throw new Error(`识别规划模型返回的第 ${index + 1} 张核心功能图缺少明确功能主题`);
    }
  }
}

function chinesePromptFallback(shot = {}, category = "", layout = "", profile = {}, settings = {}) {
  const base = String(shot.prompt || "").trim();
  const safeCategory = category || resolveShotTask(shot);
  const fallback = [
    base || categoryInstruction(safeCategory, shotVariationIndex(shot, 0), profile),
    layout ? `用户补充要求：${layout}` : "",
    styleSimilarAllowsPlannedText(settings)
      ? "画面要求：商业化、干净、清晰，主体完整；必须使用规划好的短简体中文卖点/细节文字和必要标注；不要生成乱码、品牌标志、水印、价格或无关界面元素。"
      : "画面要求：商业化、干净、清晰，主体完整；不要生成随机文字、品牌标志、水印、价格、箭头或界面元素。"
  ].filter(Boolean).join("\n\n");
  return fallback;
}

function normalizePromptPlannerResult(payload, plan, templateReferenceCount = 0, layout = "", settings = {}) {
  const incoming = Array.isArray(payload?.shots) ? payload.shots : [];
  if (!incoming.length) return null;
  const productWorkspace = isProductWorkspaceSettings(settings);
  const byId = new Map(incoming.filter((shot) => shot?.id).map((shot) => [String(shot.id), shot]));
  const shots = (plan.shots || []).map((shot, index) => {
    const planned = byId.get(String(shot.id || "")) || incoming[index] || {};
    const category = resolveShotTask({ ...shot, category: planned.category || shot.category, prompt: planned.prompt || shot.prompt });
    const plannedPrompt = String(planned.prompt || "").trim();
    if (productWorkspace && (!plannedPrompt || isMostlyEnglishPrompt(plannedPrompt))) {
      throw new Error("真实提示词规划没有返回可用的中文短提示词");
    }
    const prompt = isMostlyEnglishPrompt(plannedPrompt)
      ? chinesePromptFallback(shot, category, layout, plan.profile || {}, settings)
      : productWorkspace
        ? normalizeProductVisiblePrompt(plannedPrompt, category)
        : String(plannedPrompt || shot.prompt || "").trim();
    if (productWorkspace && !prompt) {
      throw new Error("真实提示词规划返回内容过短，无法生成可用画面提示词");
    }
    if (!prompt) return shot;
    const userLine = !productWorkspace && templateReferenceCount === 0 && layout && !prompt.includes(layout)
      ? `用户补充要求：${layout}`
      : "";
    return {
      ...shot,
      category,
      title: String(planned.title || shot.title || `${categoryLabel(category)} ${index + 1}`).trim(),
      description: String(planned.description || shot.description || categoryDescription(category, plan.profile || {})).trim(),
      prompt: [prompt, userLine].filter(Boolean).join("\n"),
      promptRoute: { source: "real-dispatch", category, label: categoryLabel(category) }
    };
  });
  return { ...plan, shots };
}

async function planPromptsWithGemini({
  plan,
  layout,
  templateReferenceCount = 0,
  model,
  apiKey,
  baseUrl = "",
  providerName = "Gemini",
  useBearerAuth = false,
  files = [],
  templateReferences = [],
  settings = {}
} = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const parts = [
    { text: promptPlannerRequest(plan, layout, templateReferenceCount, settings) },
    ...files.slice(0, 4).map((file) => ({
      inlineData: { mimeType: file.mimetype || "image/png", data: file.buffer.toString("base64") }
    })),
    ...templateReferences.slice(0, 4).map((file) => ({
      inlineData: { mimeType: file.mimetype || "image/png", data: file.buffer.toString("base64") }
    }))
  ];
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.55, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 提示词规划失败：HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} 提示词规划返回内容不可解析`);
  return parsed;
}

async function planPromptsWithAPIYi({ plan, layout, templateReferenceCount = 0, model, apiKey, baseUrl, providerName = "API易", files = [], templateReferences = [], settings = {} } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const content = [
    { type: "text", text: promptPlannerRequest(plan, layout, templateReferenceCount, settings) },
    ...files.slice(0, 4).map((file) => ({
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    })),
    ...templateReferences.slice(0, 4).map((file) => ({
      type: "image_url",
      image_url: { url: `data:${file.mimetype || "image/png"};base64,${file.buffer.toString("base64")}` }
    }))
  ];
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.55,
      ...openAICompatibleTokenLimit(model),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 提示词规划失败：HTTP ${response.status}`));
  const parsed = parseJsonFromText(payload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} 提示词规划返回内容不可解析`);
  return parsed;
}

async function dispatchShotPrompts({ db, plan, layout, settings = {}, templateReferenceCount = 0, analysis = {}, files = [], templateReferences = [] } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const selectedImageModel = resolveModel(settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL);
  const geminiKey = effectiveGeminiKey(db);
  const apiyiKey = effectiveAPIYiKey(db);
  const yunwuKey = effectiveYunwuKey(db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const geminiChannel = geminiGenerationChannel(db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const brainChannel = openAICompatibleBrainChannel(db);
  const selectedGeminiPlanningModel = selectedImageModel.provider === "gemini" ? selectedImageModel.apiModel : "";
  const productWorkspace = isProductWorkspaceSettings(settings);
  const attempts = [];
  const tryNormalize = (result, promptDispatch) => {
    const refined = normalizePromptPlannerResult(result, plan, templateReferenceCount, layout, settings);
    if (!refined) return null;
    return {
      ...refined,
      promptDispatch,
      analysis: { ...(analysis || plan.analysis || {}), promptDispatch }
    };
  };

  if (geminiKey && isGeminiAnalysisModel(analysisModel)) {
    try {
      const result = await planPromptsWithGemini({ plan, layout, templateReferenceCount, model: analysisModel.id, apiKey: geminiKey, providerName: "Gemini", files, templateReferences, settings });
      const refined = tryNormalize(result, { source: "gemini-dispatch", model: analysisModel.id, warning: "" });
      if (refined) return refined;
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (brainChannel.apiKey) {
    for (const model of apiYiIntelligenceModelCandidates(analysisModel.id, appSettings)) {
      try {
        const result = await planPromptsWithAPIYi({
          plan,
          layout,
          templateReferenceCount,
          model,
          apiKey: brainChannel.apiKey,
          baseUrl: brainChannel.baseUrl,
          providerName: brainChannel.providerName || "OpenAI-compatible",
          files,
          templateReferences,
          settings
        });
        const refined = tryNormalize(result, { source: `${brainChannel.source}-dispatch`, model, warning: "" });
        if (refined) return refined;
      } catch (error) {
        attempts.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (!productWorkspace && selectedGeminiPlanningModel && geminiChannel.apiKey) {
    try {
      const result = await planPromptsWithGemini({
        plan,
        layout,
        templateReferenceCount,
        model: selectedGeminiPlanningModel,
        apiKey: geminiChannel.apiKey,
        baseUrl: geminiChannel.baseUrl,
        providerName: geminiChannel.providerName || "Gemini",
        useBearerAuth: geminiChannel.useBearerAuth,
        files,
        templateReferences,
        settings
      });
      const refined = tryNormalize(result, { source: `${geminiChannel.providerName || "Gemini"}-image-model-dispatch`, model: selectedGeminiPlanningModel, warning: "" });
      if (refined) return refined;
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (isProductWorkspaceSettings(settings) || isActiveStyleSimilarSettings(settings)) {
    throw new Error(attempts.length ? `真实提示词规划失败：${attempts.join("；")}` : "真实提示词规划不可用：请在管理员后台配置 Gemini、API易、云雾或 OpenAI 兼容模型 Key。");
  }

  return {
    ...plan,
    promptDispatch: { source: "local-dispatch", model: "", warning: attempts.join("；") || "未配置真实提示词规划模型，已使用本地提示词。" },
    analysis: {
      ...(analysis || plan.analysis || {}),
      promptDispatch: { source: "local-dispatch", model: "", warning: attempts.join("；") || "未配置真实提示词规划模型，已使用本地提示词。" }
    }
  };
}

const STYLE_SIMILAR_PHYSICS_COMPACT_PROMPT = "相似图规则：只借用参考图方向，产品身份和结构必须来自上传灯具。";
const LIGHTING_PHYSICS_PROMPT = "光照规则：灯光和阴影自然、干净、商业化，并与产品结构一致。";

function categoryBoundaryPrompt(category = "", options = {}) {
  const value = String(category || "").toLowerCase();
  const typeRules = {
    main: "主图只做单产品电商首图，干净背景和完整主体，不做场景、不做图文说明、不做拼版。",
    selling: "卖点图只围绕一个购买理由组织画面，可有少量简体中文卖点标注，不要变成场景图、结构剖面合集或实拍到货图。",
    function: "功能图必须像详情页功能说明，突出结构、光效或安装功能，可用短简体中文卡片和指示线，不要做成单纯场景氛围图。",
    scene: SINGLE_SCENE_IMAGE_LOCK,
    detail: "细节图聚焦局部材质、发光面、连接件、安装结构或剖面标注，不要做完整空间场景或主图灰底海报。",
    real: "实拍图像真实摄影棚、到货或安装后拍摄，保持自然镜头质感，不做卖点海报、功能卡片或拼版。"
  };
  return [
    `图片类型锁定：本张是「${categoryLabel(category)}」任务，只完成对应类型，不要混入其它图片类型的表达。`,
    typeRules[value] || "",
    CHINA_MARKET_TEXT_LOCK,
    options.allowText || productPromptAllowsText(value) ? "" : NO_VISIBLE_TEXT_LOCK
  ].filter(Boolean).join("\n");
}

function sceneSubjectCountLockPrompt(profile = {}, settings = {}, category = "", options = {}) {
  const mode = styleSimilarMode(settings);
  const active =
    category === "scene" ||
    (settings?.styleCloneMode && mode === "scene") ||
    Boolean(options.directSwap);
  if (!active) return "";
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  const productName = safeProfile.productName || "上传灯具";
  const base = [
    `场景主体数量：画面只出现上传产品「${productName}」这一套灯具。`,
    "产品本身的多头/轨道/线性/多模块结构按原图保留；不额外复制、扩展或阵列化。",
    "允许自然光、产品自身发光、墙面光斑、光晕和真实投影，但不能变成新的独立灯具。"
  ];
  if (channel.channel === "small") {
    base.push("小灯只保留产品图对应的一个目标灯位/一只或一套；默认不生成灯具阵列。其它灯位只能弱化、虚化或融合为环境光点，不能复制成多个清晰商品主体；轨道射灯不自动铺满天花或扩成整排。");
  } else if (channel.channel === "large") {
    base.push("大灯只保留一盏/一套上传主灯，不复制成多个主灯。");
  } else if (channel.channel === "linear") {
    base.push("线性灯只保留上传产品这一套连续灯体，不扩展成多组背景灯槽。");
  } else if (channel.channel === "wall") {
    base.push("壁装灯只保留上传产品这一套，不在其它墙面新增同款或装饰灯。");
  }
  return base.join("\n");
}

function productWorkspaceConsistencyPrompt(category = "", profile = {}, settings = {}, options = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  const smallLampScaleRule = isSmallLampProfile(safeProfile, settings) ? smallLampPhysicalScalePrompt(category, safeProfile, settings) : "";
  const smallLampLightingRule = isSmallLampProfile(safeProfile, settings) ? smallLampSceneLightingPrompt(category, safeProfile, settings) : "";
  const genericFallbackLock = channel.channel === "generic" || /^(灯具|灯具产品|unknown|generic)$/i.test(`${safeProfile.productName}${safeProfile.lampType}${safeProfile.lampSubtype}`)
    ? "识别兜底锁：当前 profile 信息不足，不能按文字重新设计灯具；必须直接观察上传产品图并复刻图中真实灯具主体。禁止把主体换成白色嵌入筒灯、带电源线筒灯、普通射灯、轨道灯、吊灯、吸顶灯或任何新款式。"
    : "";
  return [
    "上传产品图主体锁（最高优先级）：最终画面里的灯具必须来自用户上传产品图，保留原图主体的轮廓、比例、颜色、材质、发光面、灯杯/灯罩/连接件和可见安装结构；画面风格、场景、版式和文字都不能改变产品款式。",
    "禁止主体改款：不得根据功能文案、场景风格或模型习惯重画成另一只灯；不得新增上传图没有的电源线、驱动盒、弹簧卡扣、散热器、轨道、支架、吊线、面环或其它结构。",
    genericFallbackLock,
    `产品一致性（${categoryLabel(category)}）：${safeProfile.productName}；${safeProfile.lampType}/${safeProfile.lampSubtype}；${channel.label}；${safeProfile.mountFamily}/${safeProfile.scaleClass}。`,
    options.skipTextPolicy ? "" : CHINA_MARKET_TEXT_LOCK,
    options.skipTextPolicy || options.allowText || productPromptAllowsText(category) ? "" : NO_VISIBLE_TEXT_LOCK,
    lampChannelIsolationPrompt(safeProfile),
    smallLampProductWorkspacePrompt(category, safeProfile, settings),
    smallLampSubjectMultiplicityLock(category),
    sceneSubjectCountLockPrompt(safeProfile, {}, category),
    isSmallLampProfile(safeProfile, settings) ? smallLampMountMutationLock(safeProfile) : "",
    isSmallLampProfile(safeProfile, settings) ? smallLampMountFamilyStrictLock(safeProfile) : "",
    smallLampScaleRule,
    smallLampLightingRule,
    `结构锁：保留 ${safeProfile.requiredStructures || safeProfile.structureKeywords}；排除 ${safeProfile.forbiddenStructures}。`
  ].filter(Boolean).join("\n");
}

function productStrategyPrompt(settings = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = lampChannelSpec(safeProfile, settings);
  return [
    "商品图策略：可见 prompt 只描述画面任务；固定结构约束由隐藏规则控制。",
    `当前路由：${channel.label} / ${safeProfile.mountFamily}。`
  ].join("\n");
}

function styleSimilarHiddenPrompt(settings = {}, shot = {}, profile = {}) {
  if (!isStyleSimilarSettings(settings)) return "";
  const spec = styleSimilarModeSpec(settings.similarMode);
  const category = styleSimilarCategoryFromMode(settings.similarMode);
  const isSmallLamp = isSmallLampProfile(profile, settings);
  const isScene = category === "scene";
  const smallLampSceneRule = smallLampStyleSimilarScenePrompt(settings, shot, profile);
  if (smallLampSceneRule) return smallLampSceneRule;
  return [
    `相似图规则（${spec.label}）：${spec.generationGoal}`,
    `参考图用途：${spec.referenceUse}`,
    `文字策略：${spec.textPolicy}`,
    CHINA_MARKET_TEXT_LOCK,
    productPromptAllowsText(category) ? "" : NO_VISIBLE_TEXT_LOCK,
    category === "scene" ? SINGLE_SCENE_IMAGE_LOCK : "",
    styleSimilarSceneVariationPrompt(settings, profile),
    `排除项：${spec.negativeRules}`,
    `产品身份：使用上传产品 ${sanitizeRecognitionProfile(profile).productName} 的真实外形、材质、颜色、发光面和可见安装结构。`,
    sceneSubjectCountLockPrompt(profile, settings, category),
    isSmallLamp ? smallLampPhysicalScalePrompt(category, profile, settings, { shot }) : "",
    isSmallLamp ? smallLampSceneLightingPrompt(category, profile, settings) : "",
    isSmallLamp && !isScene ? smallLampStyleClonePrompt(shot, profile, settings) : "",
    isScene ? styleSimilarSceneMountPrompt(profile, settings) : styleCloneMountPrompt(profile, settings),
    isSmallLamp && !isScene ? referenceTargetPrompt(shot.referenceTarget || shot.referenceAnalysis, profile, settings) : ""
  ].filter(Boolean).join("\n");
}

function styleCloneShotTaskSummary(shot = {}, settings = {}) {
  const direct = isDirectStyleCloneSettings(settings);
  const title = String(shot.title || (direct ? "参考图直接换主体" : styleSimilarModeLabel(settings.similarMode))).trim();
  const description = String(shot.description || "").trim();
  const userRevision = String(shot.userRevisionPrompt || shot.revision || shot.textRevisionPrompt || "").trim();
  const modeLine = direct
    ? "任务摘要：保留参考图画面，只替换原灯具/产品主体。"
    : `任务摘要：生成${styleSimilarModeLabel(settings.similarMode)}，参考图只作为该模式的构图/风格方向。`;
  return [title, description, modeLine, userRevision ? `用户补充要求：${userRevision}` : ""].filter(Boolean).join("\n");
}

function directSwapGenerationPrompt(shot = {}, extra = "", settings = {}, profile = {}) {
  const isSmallLamp = isSmallLampProfile(profile, settings);
  return joinPromptBlocksUnique([
    styleCloneShotTaskSummary(shot, settings),
    "直接换主体任务：参考图只作为底图，保留背景、空间、构图、镜头、光影、裁切和整体风格。",
    lampChannelIdentityLine(profile, settings),
    isSmallLamp ? smallLampStyleClonePrompt(shot, profile, settings) : "",
    "最终灯具必须来自上传产品图，并保持同一灯具通道、安装语义和真实体量。",
    "找到参考图中的原灯具/产品槽位，在同一视觉位置替换；不要保留原灯具，也不要返回未修改的参考图。",
    "替换后匹配参考图的透视、尺度、接触点、阴影和光照；不新增额外灯具、随机文字、品牌标志、水印、价格或无关道具。",
    CHINA_MARKET_TEXT_LOCK,
    NO_VISIBLE_TEXT_LOCK,
    sceneSubjectCountLockPrompt(profile, settings, "scene", { directSwap: true }),
    isSmallLamp ? smallLampPhysicalScalePrompt("scene", profile, settings, { directSwap: true, shot }) : "",
    isSmallLamp ? smallLampSceneLightingPrompt("scene", profile, settings, { directSwap: true }) : "",
    styleCloneMountPrompt(profile, settings),
    isSmallLamp ? referenceTargetPrompt(shot.referenceTarget || shot.referenceAnalysis, profile, settings) : "",
    shotVariationSeedPrompt(resolveShotTask(shot), shotVariationIndex(shot, 0)),
    extra,
    workspaceStrategyPrompt(settings)
  ]);
}

function directSwapVisiblePrompt(shot = {}, profile = {}, settings = {}) {
  const smallPrompt = smallLampVisiblePrompt({ ...shot, category: "scene" }, settings, profile);
  if (smallPrompt) return smallPrompt;
  if (isInfographicReferenceTarget(shot)) {
    return [
      "参考图详情版式换主体：保留参考图版式和排版节奏，只把原灯具/产品槽位替换为上传灯具。",
      "保持原槽位的角度、尺寸关系、裁切方式和视觉层级；最终结构约束由后端按灯具通道统一控制。",
      "不要重写海报文案，不要新增随机文字、品牌标志、水印、价格或无关装饰。"
    ].filter(Boolean).join("\n");
  }
  return [
    "参考图直接换主体：保留参考图的场景、构图、镜头角度、光影、色调、空间关系和整体风格。",
    "只把参考图中的原灯具/产品主体替换为上传产品图里的灯具；最终位置、体量、安装面和结构约束由后端按灯具通道统一控制。",
    "不要改变参考图的背景空间，不要新增灯具零件，不要生成随机文字、品牌标志、水印、价格或无关道具。"
  ].filter(Boolean).join("\n");
}

function styleSimilarVisiblePrompt(shot = {}, settings = {}, profile = {}, extra = "", fallbackPrompt = "") {
  const smallPrompt = smallLampVisiblePrompt(shot, settings, profile, extra, fallbackPrompt);
  if (smallPrompt) return smallPrompt;
  const spec = styleSimilarModeSpec(settings.similarMode);
  const category = spec.category;
  const cleanedFallback = stripProductPromptRules(fallbackPrompt).slice(0, 500);
  const isSmallLamp = isSmallLampProfile(profile, settings);
  const modeDetail = {
    scene: [
      "参考本张图的空间氛围，重新设计一个同类但明显不同的完整室内场景，改变家具布局、墙面主视觉、灯位或镜头角度。",
      isSmallLamp
        ? "灯具按真实小灯比例安装在新天花、轨道或墙面灯位，不作为画面中央大主体。"
        : "灯具按真实安装关系融入新空间。",
      SINGLE_SCENE_IMAGE_LOCK
    ].filter(Boolean).join("\n"),
    selling: "根据本张参考图单独提取信息层级和留白节奏，围绕当前灯具的一个真实卖点改写简体中文文案。",
    detail: "根据本张参考图单独提取微距角度、局部构图、指示线和材质表达方式，标注内容必须改写为当前灯具真实结构。",
    real: "根据本张参考图单独提取真实拍摄感、镜头透视、背景质感和自然阴影，不做海报化图文排版。"
  };
  return [
    styleCloneShotTaskSummary(shot, settings),
    `为上传灯具生成一张「${spec.label}」。`,
    "参考图只提供画面方向；固定的产品身份、安装结构、体量和禁区由系统隐藏规则控制。",
    modeDetail[category] || "",
    cleanedFallback ? `本张原始画面提示：${cleanedFallback}` : "",
    CHINA_MARKET_TEXT_LOCK,
    extra || ""
  ].filter(Boolean).join("\n\n");
}

function directSwapTitleFromTarget(shot = {}, _mergedShot = {}, index = 0) {
  return shot.title || `参考图替换 ${index + 1}`;
}

function isInfographicReferenceTarget(shot = {}) {
  const target = shot.referenceTarget || shot.referenceAnalysis || {};
  return /info|poster|detail/i.test(String(target.canvasType || target.layoutType || ""));
}

function styleSimilarTitle(mode = "", index = 0) {
  return `${styleSimilarModeLabel(mode)} ${index + 1}`;
}

function styleSimilarDescription(mode = "") {
  return `在保留上传灯具产品身份的前提下生成${styleSimilarModeLabel(mode)}。`;
}

function buildDesignSpec(profile = {}, settings = {}, counts = normalizeCounts(), templateReferenceCount = 0) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const total = SHOT_CATEGORY_KEYS.reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
  return {
    title: isCollageTemplateSettings(settings) ? "拼图生成大纲" : "商品图生成大纲",
    subtitle: `共 ${total || 1} 张图片，按当前工作区规则生成`,
    sections: [
      {
        title: "产品识别",
        lines: [
          `产品：${safeProfile.productName}`,
          `灯具类型：${safeProfile.lampType} / ${safeProfile.lampSubtype}`,
          `材质/颜色：${safeProfile.material}；${safeProfile.colorPalette}`,
          `结构重点：${safeProfile.structureKeywords}`,
          `安装语义：${safeProfile.mountFamily} / ${safeProfile.scaleClass}`
        ]
      },
      {
        title: "生成规则",
        lines: [
          productConsistencyOneLine(safeProfile, settings),
          templateReferenceCount ? `参考图：已上传 ${templateReferenceCount} 张，仅作构图/风格参考` : "参考图：无",
          workspaceStrategyPrompt(settings)
        ]
      }
    ]
  };
}

async function buildAnalyzedSuitePlan({ db, product = {}, files = [], counts = normalizeCounts(), layout = "", settings = {}, templateReferences = [], promptMode = "" } = {}) {
  if (isCollageTemplateSettings(settings)) {
    return buildCollageGenerationPlan({ settings, counts, layout, files });
  }
  layout = stripUserVisiblePlanningNoise(layout);
  product = { ...product, requirement: stripUserVisiblePlanningNoise(product.requirement || "") };
  const normalizedCounts = normalizeCounts(counts);
  const usePlanCache = shouldUseAnalysisPlanCache(settings);
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const cacheKey = usePlanCache
    ? analysisPlanCacheKey({
        product,
        files,
        counts: normalizedCounts,
        layout,
        settings: { ...settings, analysisModel: analysisModel.id },
        templateReferences,
        promptMode
      })
    : "";
  if (usePlanCache) {
    const cached = readAnalysisPlanCache(cacheKey);
    const cachedSource = cached?.analysis?.source || cached?.promptDispatch?.source || "";
    if (isProductWorkspaceSettings(settings) && cached && isGptProductDesignPlan(cached)) {
      return clonePlan(cached);
    }
    if (!isProductWorkspaceSettings(settings) && cached && !isLocalRecognitionFallbackSource(cachedSource)) {
      const refreshed = refreshProductWorkspaceDetailStrategyPlan(cached, {
        product,
        files,
        counts: normalizedCounts,
        layout,
        settings,
        templateReferenceCount: templateReferences.length
      });
      const refreshedSource = refreshed?.analysis?.source || refreshed?.promptDispatch?.source || "";
      if (!isLocalRecognitionFallbackSource(refreshedSource)) return refreshed;
    }
  }

  const productWorkspace = isProductWorkspaceSettings(settings);
  const layoutOverrides = extractProfileOverridesFromLayout(layout);
  const baseProduct = applyLargeLampProfileFromHints(
    applySelectedLampCategory(mergeProfileProduct(product, layoutOverrides), settings),
    layout,
    product,
    settings
  );
  if (productWorkspace) {
    const modelPlan = await analyzeProductDesignSpecPlanWithModelPool({
      db,
      product: baseProduct,
      files,
      counts: normalizedCounts,
      layout,
      settings
    });
    const resultSettings = { ...settings, productPlanMode: GPT_PRODUCT_PLAN_MODE };
    const result = {
      profile: modelPlan.product,
      designSpec: modelDesignSpecObject(modelPlan.designSpecText, resultSettings, normalizedCounts, modelPlan.consistencyBrief, modelPlan.designSummaryText),
      analysis: {
        ...(modelPlan.analysis || {}),
        promptMode: promptMode || (layout ? "optimize" : "generate"),
        optimizedRequirement: layout
      },
      promptDispatch: {
        source: "gpt-design-spec-plan",
        model: modelPlan.analysis?.model || analysisModel.id,
        warning: ""
      },
      counts: normalizedCounts,
      settings: resultSettings,
      shots: modelPlan.shots
    };
    if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
    return clonePlan(result);
  }

  const activeStyleSimilar = isActiveStyleSimilarSettings(settings);
  let realAnalysis;
  if (settings?.styleCloneMode && !activeStyleSimilar) {
    try {
      realAnalysis = await analyzeStyleCloneWithRealModel({ db, product: baseProduct, files, layout, settings });
    } catch (error) {
      realAnalysis = {
        product: inferProductProfile(baseProduct, files),
        analysis: {
          source: "style-local-plan",
          model: "",
          warning: `风格复刻直接换主体已回退本地产品结构推断：${error instanceof Error ? error.message : "识别不可用"}`
        }
      };
    }
  } else {
    realAnalysis = await analyzeStyleCloneWithRealModel({ db, product: baseProduct, files, layout, settings });
  }
  const profile = gateSmallLampSpecEvidence(enhanceSmallLampProfileFromHints(
    applyLargeLampProfileFromHints(
      applySelectedLampCategory(mergeProfileProduct(baseProduct, realAnalysis.product), settings),
      String(product.requirement || layout || "").trim(),
      baseProduct,
      settings
    ),
    String(product.requirement || layout || "").trim(),
    baseProduct,
    settings
  ), baseProduct, String(product.requirement || layout || "").trim());
  const userRequirement = String(product.requirement || layout || "").trim();
  const shots = buildPromptsFromProfile(profile, normalizedCounts, settings, userRequirement).map((shot, index) => {
    const category = resolveShotTask(shot);
    const prompt = activeStyleSimilar
      ? styleSimilarVisiblePrompt(shot, settings, profile, userRequirement ? `用户补充要求：${userRequirement}` : "", shot.prompt)
      : directSwapVisiblePrompt(shot, profile, settings);
    return {
      ...shot,
      category,
      ratio: String(settings.ratio || shot.ratio || "3:4 竖版"),
      referenceIndex: index,
      userRevisionPrompt: userRequirement,
      prompt,
      promptRoute: { source: "real-analysis-base", category, label: categoryLabel(category) },
      imageUrl: "",
      status: ""
    };
  });
  const analysis = {
    ...(realAnalysis.analysis || {}),
    source: realAnalysis.analysis?.source || "real-analysis",
    model: realAnalysis.analysis?.model || analysisModel.id,
    promptMode: promptMode || (userRequirement ? "optimize" : "generate"),
    optimizedRequirement: userRequirement,
    warning: realAnalysis.analysis?.warning || ""
  };
  const referenceTargets = await analyzeReferenceMountTargets({
    db,
    profile,
    settings,
    templateReferences
  });
  const referenceTargetWarnings = referenceTargets.map((target) => target?.warning).filter(Boolean);
  const referenceTargetCacheHits = referenceTargets.filter((target) => target?.cacheHit).length;
  if (referenceTargets.length) {
    analysis.referenceTarget = {
      total: referenceTargets.length,
      cacheHits: referenceTargetCacheHits,
      warnings: referenceTargetWarnings
    };
  }
  const shotsWithReferenceTargets = attachReferenceTargetsToShots(shots, referenceTargets);
  const basePlan = {
    profile,
    designSpec: buildDesignSpec(profile, settings, normalizedCounts, templateReferences.length),
    analysis,
    promptDispatch: { source: "one-step-gpt-analysis", model: analysis.model || analysisModel.id, warning: "" },
    counts: normalizedCounts,
    settings,
    shots: shotsWithReferenceTargets
  };
  if (isDirectStyleCloneSettings(settings)) {
    const result = clonePlan(basePlan);
    if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
    return result;
  }
  if (false && productWorkspace) {
    const result = {
      ...basePlan,
      promptDispatch: {
        source: "disabled-product-expanded",
        model: "",
        warning: "商品图工作区已在一次主体识别后本地展开多张提示词，避免重复视觉规划超时。"
      },
      analysis: {
        ...basePlan.analysis,
        promptDispatch: {
          source: "disabled-product-expanded",
          model: "",
          warning: ""
        }
      }
    };
    if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
    return clonePlan(result);
  }
  const result = await dispatchShotPromptsWithModelPool({
    db,
    plan: basePlan,
    layout: userRequirement,
    settings,
    templateReferenceCount: templateReferences.length,
    analysis,
    files,
    templateReferences
  });
  result.shots = attachReferenceTargetsToShots(result.shots, referenceTargets);
  if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
  return clonePlan(result);
}

async function dispatchShotPromptsWithModelPool({ db, plan, layout, settings = {}, templateReferenceCount = 0, analysis = {}, files = [], templateReferences = [] } = {}) {
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const selectedImageModel = resolveModel(settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL);
  const productWorkspace = isProductWorkspaceSettings(settings);
  const candidates = [];
  if (isGeminiAnalysisModel(analysisModel)) {
    candidates.push({ providerKind: "gemini", model: analysisModel.id, source: "gemini-dispatch" });
  } else {
    apiYiIntelligenceModelCandidates(analysisModel.id, appSettings).forEach((model) => {
      candidates.push({ providerKind: "openai-compatible", model, source: "openai-compatible-dispatch" });
    });
  }
  if (!productWorkspace && selectedImageModel.provider === "gemini") {
    candidates.push({ providerKind: "gemini", model: selectedImageModel.apiModel, source: "gemini-image-model-dispatch" });
  }
  const seenCandidates = new Set();
  const uniqueCandidates = candidates.filter((candidate) => {
    const key = `${candidate.providerKind}:${candidate.model}`;
    if (seenCandidates.has(key)) return false;
    seenCandidates.add(key);
    return true;
  });
  const attempts = [];
  const tryNormalize = (result, promptDispatch) => {
    const refined = normalizePromptPlannerResult(result, plan, templateReferenceCount, layout, settings);
    if (!refined) return null;
    return {
      ...refined,
      promptDispatch,
      analysis: { ...(analysis || plan.analysis || {}), promptDispatch }
    };
  };
  for (const candidate of uniqueCandidates) {
    try {
      const result = await runWithModelChannelRetry(db, {
        purpose: "analysis",
        modelId: candidate.model,
        providerKind: candidate.providerKind,
        modelOption: candidate.providerKind === "gemini"
          ? { id: candidate.model, apiModel: candidate.model, provider: "gemini" }
          : { id: candidate.model, apiModel: candidate.model, provider: "openai" }
      }, async (channel) => {
        if (candidate.providerKind === "gemini") {
          const resolved = modelChannelGemini(channel);
          return planPromptsWithGemini({
            plan,
            layout,
            templateReferenceCount,
            model: candidate.model,
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            providerName: resolved.providerName || "Gemini",
            useBearerAuth: resolved.useBearerAuth,
            files,
            templateReferences,
            settings
          });
        }
        const resolved = modelChannelOpenAICompatible(channel);
        return planPromptsWithAPIYi({
          plan,
          layout,
          templateReferenceCount,
          model: candidate.model,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          providerName: resolved.providerName || "OpenAI-compatible",
          files,
          templateReferences,
          settings
        });
      });
      const refined = tryNormalize(result, { source: candidate.source, model: candidate.model, warning: "" });
      if (refined) return refined;
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (isProductWorkspaceSettings(settings) || isActiveStyleSimilarSettings(settings)) {
    throw new Error(attempts.length ? recognitionModelFailureMessage(attempts) : "识别模型调用失败，请检查当前识别模型通道。");
  }
  return {
    ...plan,
    promptDispatch: { source: "local-dispatch", model: "", warning: attempts.join("；") || "未配置真实提示词规划模型，已使用本地提示词。" },
    analysis: {
      ...(analysis || plan.analysis || {}),
      promptDispatch: { source: "local-dispatch", model: "", warning: attempts.join("；") || "未配置真实提示词规划模型，已使用本地提示词。" }
    }
  };
}

function isCollageTemplateSettings(settings = {}) {
  return String(settings?.template || "") === "lamp-collage-room-labels";
}

function isCleanThenComposeCollage(settings = {}) {
  if (!isCollageTemplateSettings(settings)) return false;
  return String(settings?.collagePipeline || "") === "clean-then-compose";
}

function isSingleCallRetouchComposeCollage(settings = {}) {
  return (
    isCollageTemplateSettings(settings) &&
    String(settings?.collagePipeline || "single-call-retouch-compose") !== "clean-then-compose"
  );
}

function collageBackgroundSpec(settings = {}) {
  return COLLAGE_BACKGROUND_SPEC;
}

const COLLAGE_BACKGROUND_HEX = "#e8e8e2";
const COLLAGE_BACKGROUND_RGB = "232,232,226";
const COLLAGE_BACKGROUND_SPEC = `${COLLAGE_BACKGROUND_HEX} / RGB ${COLLAGE_BACKGROUND_RGB}`;

function normalizeRgbPart(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(255, number));
}

function normalizeCssHex(value = "") {
  const match = String(value || "").trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return "";
  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex.split("").map((part) => part + part).join("")}`;
  }
  return `#${hex}`;
}

function collageRequestedBackgroundFill(settings = {}) {
  const text = [
    settings?.collageUserPrompt,
    settings?.userPrompt
  ]
    .filter(Boolean)
    .join("\n");
  const value = String(text || "").trim();
  if (!collageHasExplicitBackgroundPrompt(value)) return COLLAGE_BACKGROUND_HEX;
  const hex = normalizeCssHex(value.match(/#(?:[0-9a-f]{3}){1,2}\b/i)?.[0] || "");
  if (hex) return hex;
  const rgbMatch = value.match(/rgba?\s*\(\s*(\d{1,3})\s*[,，]\s*(\d{1,3})\s*[,，]\s*(\d{1,3})/i);
  if (rgbMatch) {
    const parts = rgbMatch.slice(1, 4).map(normalizeRgbPart);
    if (parts.every((part) => part !== null)) return `rgb(${parts.join(",")})`;
  }
  const lower = value.toLowerCase();
  const colorMap = [
    { pattern: /透明|transparent/, fill: "transparent" },
    { pattern: /白底|白色|纯白|white/, fill: "#ffffff" },
    { pattern: /黑底|黑色|black/, fill: "#111111" },
    { pattern: /米色|米白|beige|cream/, fill: "#eee8dc" },
    { pattern: /蓝色|蓝底|blue/, fill: "#e8eef6" },
    { pattern: /红色|红底|red/, fill: "#f4e5e3" },
    { pattern: /绿色|绿底|green/, fill: "#e6efe8" },
    { pattern: /黄色|黄底|yellow/, fill: "#f4efd8" },
    { pattern: /粉色|粉底|pink/, fill: "#f5e6ea" },
    { pattern: /紫色|紫底|purple/, fill: "#ece7f2" },
    { pattern: /灰底|灰色|浅灰|暖灰|gray|grey/, fill: COLLAGE_BACKGROUND_HEX }
  ];
  return colorMap.find((item) => item.pattern.test(lower))?.fill || COLLAGE_BACKGROUND_HEX;
}

function isProductWorkspaceSettings(settings = {}) {
  return !settings?.styleCloneMode && !isCollageTemplateSettings(settings);
}

function lowConfidenceProductGenerationBlocked(settings = {}, analysis = {}) {
  return Boolean(
    isProductWorkspaceSettings(settings) &&
      analysis?.requiresLampCategorySelection &&
      !hasForcedLampCategory(settings, {})
  );
}

function collageInputLabel(settings = {}, index = 0) {
  const labels = Array.isArray(settings?.collageLabels) ? settings.collageLabels : [];
  const item = labels[index];
  const value =
    item && typeof item === "object"
      ? item.name || item.label || item.title || ""
      : item;
  return String(value || "").trim();
}

function collageVisibleLabels(settings = {}) {
  const labels = Array.isArray(settings?.collageLabels) ? settings.collageLabels : [];
  return labels
    .map((item, index) => {
      const name =
        item && typeof item === "object"
          ? item.name || item.label || item.title || ""
          : item;
      return { index: index + 1, name: String(name || "").trim() };
    })
    .filter((item) => item.name);
}

function collageLabelRenderingMode(settings = {}) {
  const mode = String(settings?.collageLabelRendering || "").trim().toLowerCase();
  return mode || "svg";
}

function shouldRenderCollageLabelsWithModel(settings = {}) {
  const labels = collageVisibleLabels(settings);
  if (!isCollageTemplateSettings(settings) || !labels.length) return false;
  const mode = collageLabelRenderingMode(settings);
  return mode === "model" || mode === "image-model" || mode === "native";
}

function collageHasExplicitBackgroundPrompt(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return /(背景|底色|底图|画布|灰底|白底|黑底|米色|蓝色|红色|绿色|黄色|粉色|紫色|透明|渐变|#(?:[0-9a-f]{3}){1,2}\b|rgb\s*\()/i.test(value);
}

function sanitizeCollagePromptText(prompt = "") {
  return String(prompt || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      return !/label[-\s]?safe|rounded\s+pill|pill\s+label|label\s+space|label\s+holder|label\s+container|empty\s+label|placeholder|white\s+space\s+below|clean\s+empty\s+(?:gray|white)\s+space\s+below/i.test(line);
    })
    .join("\n");
}

function collageDirectPlacementPrompt(count = 0) {
  const layouts = {
    2: "Position mapping: input image 1 = left; input image 2 = right.",
    3: "Position mapping: input image 1 = top-left; input image 2 = top-right; input image 3 = bottom-center.",
    4: "Position mapping: input image 1 = top-left; input image 2 = top-right; input image 3 = bottom-left; input image 4 = bottom-right.",
    5: "Position mapping: input image 1 = top-left; input image 2 = top-right; input image 3 = bottom-left; input image 4 = bottom-center; input image 5 = bottom-right.",
    6: "Position mapping: input image 1 = top-left; input image 2 = top-center; input image 3 = top-right; input image 4 = bottom-left; input image 5 = bottom-center; input image 6 = bottom-right."
  };
  return layouts[Math.max(2, Math.min(6, Number(count) || 2))] || layouts[5];
}

function collageNaturalMarginPrompt(count = 0, { modelRenderedLabels = false } = {}) {
  const normalized = Math.max(2, Math.min(6, Number(count) || 2));
  const layoutLines = {
    2: "For 2 products, keep both products centered in their left/right invisible areas with natural lower margin.",
    3: "For 3 products, keep the top two and bottom-center product comfortably inside their invisible areas with natural lower margin.",
    4: "For 4 products, keep each product comfortably inside its 2x2 invisible area with natural lower margin.",
    5: "For 5 products, use a 2-over-3 catalog layout and keep each product comfortably inside its invisible area with natural lower margin.",
    6: "For 6 products, keep each product comfortably inside its two-row invisible area with natural lower margin."
  };
  return [
    "NATURAL PRODUCT MARGINS:",
    "Do not fill each invisible area edge to edge. Each product should sit slightly smaller inside its own invisible area, with natural warm-gray background margin around it and below it.",
    "Scale each product to about 75%-85% of its invisible area, not 95%-100%. Do not push products to the bottom edge of their areas.",
    layoutLines[normalized],
    modelRenderedLabels
      ? "Place each dark charcoal pill label on the natural warm-gray background margin directly below its matching product. Do not create a separate white strip, label base, card, panel, divided row, or special background area for labels."
      : "Keep the lower margin as the same continuous warm-gray background for later app labels. Do not create a separate white strip, label base, card, panel, divided row, or special background area."
  ].join("\n");
}

function collageConversationPrompt(settings = {}, { fileCount = 0, ratio = "", userPrompt = "" } = {}) {
  const count = Math.max(1, Number(fileCount || settings.collageSourceCount || 0) || 1);
  const userText = String(userPrompt || settings.collageUserPrompt || settings.userPrompt || "").trim();
  return directCollagePrompt(userText, { ...settings, ratio: ratio || settings.ratio, collageSourceCount: count }, { sourceCount: count });
}

function collageGenerationHiddenPrompt(settings = {}) {
  if (!isCollageTemplateSettings(settings)) return "";
  return collageDirectHardLockPrompt(settings);
}

function generationInputFiles(productFiles, settings = {}, templateReferences = [], shot = {}, shotIndex = 0) {
  const selectedReference = settings?.styleCloneMode
    ? selectedTemplateReference(templateReferences, shot, shotIndex)
    : templateReferences[0]
    ? { file: templateReferences[0], referenceIndex: 0 }
    : null;

  if (isDirectStyleCloneSettings(settings) && selectedReference?.file) {
    const referenceCanvas = {
      ...selectedReference.file,
      inputRole: "reference-canvas",
      inputIndex: 1,
      referenceIndex: selectedReference.referenceIndex
    };
    const replacementProduct = productFiles[0]
      ? [{ ...productFiles[0], inputRole: "primary-product", inputIndex: 2 }]
      : [];
    return [referenceCanvas, ...replacementProduct];
  }

  if (isStyleSimilarSettings(settings)) {
    const primaryProduct = productFiles[0] ? [{ ...productFiles[0], inputRole: "primary-product", inputIndex: 1 }] : [];
    const styleReference = selectedReference?.file
      ? [
          {
            ...selectedReference.file,
            inputRole: "style-reference",
            inputIndex: 2,
            referenceIndex: selectedReference.referenceIndex
          }
        ]
      : [];
    return [...primaryProduct, ...styleReference];
  }

  if (isCollageTemplateSettings(settings)) {
    const collageProducts = productFiles.slice(0, 6).map((file, index) => ({
      ...file,
      inputRole: index === 0 ? "primary-product" : "product-source",
      inputIndex: index + 1,
      inputLabel: collageInputLabel(settings, index)
    }));
    const referenceInputs = selectedReference?.file
      ? [
          {
            ...selectedReference.file,
            inputRole: "layout-reference",
            inputIndex: collageProducts.length + 1,
            referenceIndex: selectedReference.referenceIndex
          }
        ]
      : [];
    return [...collageProducts, ...referenceInputs];
  }

  const primaryProduct = productFiles[0] ? [{ ...productFiles[0], inputRole: "primary-product", inputIndex: 1 }] : [];
  const supportProducts = productFiles.slice(1, 4).map((file, index) => ({
    ...file,
    inputRole: "product-support",
    inputIndex: index + 2
  }));
  const referenceInputs = selectedReference?.file
    ? [
        {
          ...selectedReference.file,
          inputRole: "layout-reference",
          inputIndex: primaryProduct.length + supportProducts.length + selectedReference.referenceIndex + 1,
          referenceIndex: selectedReference.referenceIndex
        }
      ]
    : [];
  return [...primaryProduct, ...supportProducts, ...referenceInputs];
}

function generationInputSummary(files = []) {
  return {
    total: files.length,
    primaryProduct: files.filter((file) => file.inputRole === "primary-product").length,
    productSupport: files.filter((file) => file.inputRole === "product-support").length,
    layoutReference: files.filter((file) => file.inputRole === "layout-reference" || file.inputRole === "reference-canvas" || file.inputRole === "style-reference").length,
    names: files.map((file) => file.originalname || "image"),
    labels: files.map((file) => file.inputLabel || "").filter(Boolean)
  };
}

function generationInputRoleInstruction(file = {}, index = 0, { settings = {}, styleSpec = null, isDirectStyleSwap = false } = {}) {
  const role = file.inputRole || (index === 0 ? "primary-product" : "product-source");
  const displayIndex = index + 1;
  const label = file.inputLabel ? " 应用稍后添加标签：" + file.inputLabel + "。" : "";
  if (isDirectStyleSwap && role === "reference-canvas") {
    return "输入图 " + displayIndex + " 只作为参考画布。保留它的背景、版式和风格，但不要保留其中原灯具/产品主体；该主体必须被替换。";
  }
  if (isDirectStyleSwap && role === "primary-product") {
    return "输入图 " + displayIndex + " 是替换灯具身份来源。保留这只灯的真实结构、材质和颜色，用它替换参考灯具。";
  }
  if (role === "style-reference") {
    return "输入图 " + displayIndex + " 只作为" + (styleSpec?.label || "风格/版式") + "参考。" + (styleSpec?.referenceUse || "不要复制其中的产品身份。") + "不要复制其中的产品身份。" + label;
  }
  if (role === "layout-reference") {
    return "输入图 " + displayIndex + " 只作为版式、构图或场景参考；不要复制其中的灯具主体，不要把它和上传产品拼成多主体画面。";
  }
  if (role === "product-support") {
    return "输入图 " + displayIndex + " 是同一款灯具的补充角度/结构参考，只用于校准轮廓、安装结构、材质、颜色和发光口；输出画面只能以输入图 1 的产品身份生成一个当前产品主体，不要把这张补充图里的灯具作为第二个可见主体，不要拼贴多张输入图。";
  }
  if (role === "product-source" && !isCollageTemplateSettings(settings)) {
    return "输入图 " + displayIndex + " 是同一产品资料参考，只用于补充产品结构和材质判断；不要在最终图里额外生成这一张图对应的独立灯具主体。";
  }
  return "输入图 " + displayIndex + "（" + role + "）：保留这只灯作为自己的产品主体。" + label;
}

function generationInputRolePrompt(files = [], settings = {}, context = {}) {
  if (!Array.isArray(files) || files.length <= 1 || isCollageTemplateSettings(settings)) return "";
  return [
    "输入图片角色：",
    ...files.map((file, index) => generationInputRoleInstruction(file, index, { ...context, settings }))
  ].join("\n");
}

function generationSpeedKey(settings = {}) {
  return "turbo";
}

function generationMaxConcurrency() {
  const configured = Number(process.env.MAX_IMAGE_GENERATION_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.floor(configured));
  return 5;
}

function isYunwuProviderName(providerName = "") {
  const text = String(providerName || "").toLowerCase();
  return text.includes("yunwu") || text.includes("云雾");
}

function yunwuGenerationMaxConcurrency() {
  const configured = Number(process.env.YUNWU_IMAGE_GENERATION_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.floor(configured));
  return 5;
}

function generationConcurrency(settings = {}, providerName = "") {
  const speed = generationSpeedKey(settings);
  const baseMaxConcurrency = generationMaxConcurrency();
  const providerMaxConcurrency = (isProductWorkspaceSettings(settings) || settings?.styleCloneMode) && isYunwuProviderName(providerName)
    ? Math.min(baseMaxConcurrency, yunwuGenerationMaxConcurrency())
    : baseMaxConcurrency;
  const maxConcurrency = settings?.styleCloneMode && !isYunwuProviderName(providerName)
    ? Math.max(providerMaxConcurrency, STYLE_IMAGE_GENERATION_CONCURRENCY)
    : providerMaxConcurrency;
  let concurrency = 1;
  if (settings?.styleCloneMode) {
    if (speed === "turbo") concurrency = 5;
    else if (speed === "fast") concurrency = 3;
    else concurrency = 2;
    return Math.min(concurrency, maxConcurrency);
  }
  if (speed === "turbo") concurrency = 5;
  else if (speed === "fast") concurrency = 3;
  else concurrency = 2;
  return Math.min(concurrency, maxConcurrency);
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const poolSize = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const runners = Array.from({ length: poolSize }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function generationTimeoutMs({ clarity = "2k", styleCloneMode = false, useBearerAuth = false, attempt = 0, productWorkspace = false } = {}) {
  const clarityKey = String(clarity || "2k").toLowerCase();
  let timeout = clarityKey === "4k" ? 240000 : clarityKey === "1k" ? 120000 : 180000;
  if (productWorkspace && !styleCloneMode) {
    timeout = clarityKey === "4k" ? 300000 : clarityKey === "1k" ? 150000 : 210000;
  }
  if (styleCloneMode) timeout = clarityKey === "4k" ? 360000 : clarityKey === "1k" ? 240000 : 300000;
  if (useBearerAuth) timeout += productWorkspace && !styleCloneMode ? 15000 : 30000;
  return timeout + Math.max(0, Number(attempt) || 0) * 45000;
}

function generationErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || error?.cause?.status || 0);
  return Number.isFinite(status) && status > 0 ? status : 0;
}

function isTransientGenerationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();
  const status = generationErrorStatus(error);
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 429 ||
    name.includes("abort") ||
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("bad gateway") ||
    message.includes("gateway") ||
    message.includes("网关") ||
    message.includes("繁忙") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("429")
  );
}

const USER_BALANCE_ERROR_MESSAGE = "余额不足，请先充值";
const ADMIN_UPSTREAM_QUOTA_ERROR_MESSAGE = "模型/API 服务账户额度不足，请检查后台配置的服务余额或更换 API Key";

function errorTextForMatching(error) {
  return [
    error?.message,
    error?.code,
    error?.status,
    error?.statusText,
    error?.cause?.message,
    typeof error === "string" ? error : ""
  ]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

function isUpstreamQuotaError(error) {
  if (Number(error?.status) === 402) return true;
  const message = errorTextForMatching(error);
  return [
    "user quota is not enough",
    "quota is not enough",
    "insufficient quota",
    "not enough quota",
    "quota exceeded",
    "exceeded your current quota",
    "http 402",
    "payment required",
    "insufficient balance",
    "balance is not enough",
    "not enough balance",
    "额度不足"
  ].some((pattern) => message.includes(pattern));
}

function apiErrorMessage(payload, fallback = "请求失败") {
  if (typeof payload?.error === "string") return payload.error;
  return payload?.error?.message || payload?.error_description || payload?.message || fallback;
}

function quotaErrorMessageForUser(user) {
  return user?.role === "admin" ? ADMIN_UPSTREAM_QUOTA_ERROR_MESSAGE : USER_BALANCE_ERROR_MESSAGE;
}

function userFriendlyServiceError(error, user, fallback = "请求失败") {
  if (isUpstreamQuotaError(error)) return quotaErrorMessageForUser(user);
  return String(error?.message || error || fallback);
}

function userFriendlyGenerationError(error, providerName = "API", user = null) {
  const message = String(error?.message || error || "");
  if (isUpstreamQuotaError(error)) {
    return quotaErrorMessageForUser(user);
  }
  const status = generationErrorStatus(error);
  if (status === 502 || message.toLowerCase().includes("bad gateway") || message.includes("502")) {
    return `${providerName} 生图接口繁忙或网关异常，可重试本张。`;
  }
  if (isTransientGenerationError(error)) {
    return `${providerName} 生图接口排队或响应超时，可重试本张。`;
  }
  return message || "Image generation failed";
}

function isFatalGenerationError(error) {
  if (String(error?.code || "") === "GENERATION_ATTEMPT_BUDGET_EXCEEDED") return true;
  if (isUpstreamQuotaError(error)) return true;
  const status = generationErrorStatus(error);
  if ([400, 401, 402, 403, 404, 422].includes(status)) return true;
  const message = errorTextForMatching(error);
  return [
    "api key",
    "apikey",
    "not configured",
    "unauthorized",
    "forbidden",
    "permission denied",
    "invalid api",
    "invalid key",
    "invalid request",
    "model not found",
    "model does not exist",
    "unsupported model",
    "is not defined",
    "cannot access",
    "referenceerror",
    "typeerror",
    "content policy",
    "safety",
    "blocked by safety",
    "policy violation",
    "quota is not enough",
    "insufficient quota",
    "payment required"
  ].some((pattern) => message.includes(pattern));
}

function isGenerationAttemptBudgetError(error) {
  return String(error?.code || "") === "GENERATION_ATTEMPT_BUDGET_EXCEEDED";
}

function shouldRetryGenerationShot(error, attempt = 0, maxAttempts = RELIABLE_GENERATION_SHOT_MAX_ATTEMPTS) {
  if (Number(attempt) >= Number(maxAttempts)) return false;
  return !isFatalGenerationError(error);
}

function generationShotMaxAttempts(settings = {}) {
  const configured = Number(settings?.generationShotMaxAttempts || settings?.shotMaxAttempts || 0);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.min(3, Math.floor(configured)));
  return Math.max(1, Math.min(3, settings?.styleCloneMode ? STYLE_GENERATION_SHOT_MAX_ATTEMPTS : RELIABLE_GENERATION_SHOT_MAX_ATTEMPTS));
}

function generationRoundPauseMs(round = 1, transientFailures = 0) {
  const multiplier = Math.max(1, Math.min(3, Number(round || 1)));
  const pressure = Math.max(0, Math.min(2, Number(transientFailures || 0)));
  return RELIABLE_GENERATION_ROUND_PAUSE_MS * multiplier + pressure * 1500;
}

function styleTextEditPrompt(textEditPrompt = "", shot = {}, settings = {}) {
  const modeLabel = settings.similarMode === "detail" ? "similar detail image" : "similar selling-point/function image";
  const region = shot.textRevisionRegion || {};
  const hasBox =
    Number.isFinite(Number(region.xPercent)) &&
    Number.isFinite(Number(region.yPercent)) &&
    Number.isFinite(Number(region.widthPercent)) &&
    Number.isFinite(Number(region.heightPercent)) &&
    Number(region.widthPercent) > 0 &&
    Number(region.heightPercent) > 0;
  const hasPoint = Number.isFinite(Number(region.xPercent)) && Number.isFinite(Number(region.yPercent));
  return [
    "TEXT-ONLY EDIT ON GENERATED RESULT.",
    "Use input image 1 as the exact base canvas and return a freshly edited image. Do not return the unchanged input image.",
    "Do not regenerate a new product image, new poster, or new composition.",
    `This image came from ${modeLabel}. The user's request is only to change visible text on the generated result.`,
    "First read/OCR the visible text in the selected area. Use that selected text information to decide exactly which glyphs, labels, or callouts to replace.",
    hasBox
      ? `The user selected a rectangular target text area: left ${Number(region.xPercent).toFixed(1)}%, top ${Number(region.yPercent).toFixed(1)}%, width ${Number(region.widthPercent).toFixed(1)}%, height ${Number(region.heightPercent).toFixed(1)}% of the image. Edit the visible text inside or overlapping this rectangle first.`
      : hasPoint
        ? `The user indicated the target text area near ${Number(region.xPercent).toFixed(1)}% from the left and ${Number(region.yPercent).toFixed(1)}% from the top. Edit the visible text nearest this point.`
        : "If no target region is provided, infer the intended text from the user's instruction and edit only that text.",
    "If input image 2 is present, it is a close crop of the selected text region for OCR/identification only; use input image 1 as the final editable canvas.",
    "Only modify text glyphs, captions, labels, callouts, arrows' text, title text, benefit copy, or detail annotations that the user explicitly targets.",
    "If the selected rectangle contains multiple words or labels, update only the words described by the user and preserve any unrelated nearby labels.",
    "Keep the lamp/product, background, crop, layout, graphic panels, arrows, icons, lighting, shadows, colors, typography placement, and spacing as close as possible.",
    "When replacing text, keep the original text box position, font scale, alignment, color family, and line length; make Chinese text readable and not garbled.",
    "If the user asks to remove text, erase only that text and repair the local background cleanly; do not remove product parts or graphic structure.",
    "Do not add watermarks, brand marks, extra logos, random English, random Chinese, dates, prices, or unrelated numbers.",
    `User text edit instruction: ${String(textEditPrompt || "").trim()}`,
    shot.title ? `Current result title: ${shot.title}` : "",
    shot.prompt ? `Original generation prompt context: ${String(shot.prompt).slice(0, 1200)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchJsonWithGenerationRetry(endpoint, { method, headers, body, clarity, styleCloneMode, useBearerAuth, providerName, settings = {} }) {
  let lastError = null;
  const maxAttempts = styleCloneMode ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const timeoutMs = generationTimeoutMs({
        clarity,
        styleCloneMode,
        useBearerAuth,
        attempt,
        productWorkspace: isProductWorkspaceSettings(settings)
      });
      console.log(
        `[image-generation] start provider=${providerName || "API"} clarity=${clarity || "2k"} style=${Boolean(styleCloneMode)} timeout=${timeoutMs}ms attempt=${attempt + 1}/${maxAttempts}`
      );
      const response = await fetch(endpoint, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(apiErrorMessage(payload, `${providerName} 出图失败：HTTP ${response.status}`));
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (isUpstreamQuotaError(error)) break;
      if (!isTransientGenerationError(error) || attempt >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  }
  if (isUpstreamQuotaError(lastError)) throw lastError;
  throw new Error(userFriendlyGenerationError(lastError, providerName));
}

function generationRetryDelayMs(attempt = 0, retryDelaysMs = []) {
  const configured = Number(retryDelaysMs[attempt]);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return attempt === 0 ? 2000 : 6000;
}

function remainingGenerationApiAttempts(generationContext = {}) {
  const max = Math.max(1, Math.floor(Number(generationContext?.maxActualApiAttempts || 0) || 3));
  const used = Math.max(0, Math.floor(Number(generationContext?.actualApiAttempts || 0) || 0));
  return Math.max(0, max - used);
}

function reserveGenerationApiAttempt(generationContext = {}, providerName = "API") {
  if (!generationContext || typeof generationContext !== "object") return;
  const remaining = remainingGenerationApiAttempts(generationContext);
  if (remaining <= 0) {
    const error = new Error(`${providerName} 生图请求次数已达到本张上限，请检查 prompt 或稍后重试。`);
    error.status = 429;
    error.code = "GENERATION_ATTEMPT_BUDGET_EXCEEDED";
    throw error;
  }
  generationContext.actualApiAttempts = Math.max(0, Number(generationContext.actualApiAttempts || 0)) + 1;
}

async function fetchJsonWithStableGenerationRetry(endpoint, {
  method,
  headers,
  body,
  clarity,
  styleCloneMode,
  useBearerAuth,
  providerName,
  maxAttempts,
  retryDelaysMs,
  jobId = "",
  shotId = "",
  shotCategory = "",
  generationContext = {}
}) {
  let lastError = null;
  const attemptBudget = generationContext && typeof generationContext === "object"
    ? remainingGenerationApiAttempts(generationContext)
    : Number.POSITIVE_INFINITY;
  const baseMaxAttempts = Math.max(1, Math.floor(Number(maxAttempts) || (styleCloneMode ? 1 : 2)));
  const resolvedMaxAttempts = Math.max(1, Math.min(baseMaxAttempts, Number.isFinite(attemptBudget) ? Math.max(1, attemptBudget) : baseMaxAttempts));
  for (let attempt = 0; attempt < resolvedMaxAttempts; attempt += 1) {
    const timeoutMs = generationTimeoutMs({
      clarity,
      styleCloneMode,
      useBearerAuth,
      attempt,
      productWorkspace: Boolean(generationContext?.productWorkspace)
    });
    const startedAt = Date.now();
    try {
      reserveGenerationApiAttempt(generationContext, providerName);
      console.log(
        `[image-generation] start provider=${providerName || "API"} job=${jobId || "-"} shot=${shotId || "-"} category=${shotCategory || "-"} clarity=${clarity || "2k"} style=${Boolean(styleCloneMode)} timeout=${timeoutMs}ms attempt=${attempt + 1}/${resolvedMaxAttempts} actual=${generationContext?.actualApiAttempts || "-"}`
      );
      const response = await fetch(endpoint, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body
      });
      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[image-generation] response provider=${providerName || "API"} job=${jobId || "-"} shot=${shotId || "-"} category=${shotCategory || "-"} status=${response.status} elapsed=${elapsedMs}ms attempt=${attempt + 1}/${resolvedMaxAttempts}`
      );
      if (!response.ok) {
        const error = new Error(apiErrorMessage(payload, `${providerName} image generation failed: HTTP ${response.status}`));
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      console.warn(
        `[image-generation] error provider=${providerName || "API"} job=${jobId || "-"} shot=${shotId || "-"} category=${shotCategory || "-"} status=${generationErrorStatus(error) || "-"} elapsed=${elapsedMs}ms attempt=${attempt + 1}/${resolvedMaxAttempts} message=${String(error?.message || error)}`
      );
      if (isUpstreamQuotaError(error)) break;
      if (!isTransientGenerationError(error) || attempt >= resolvedMaxAttempts - 1) break;
      const waitMs = generationRetryDelayMs(attempt, retryDelaysMs);
      console.warn(
        `[image-generation] retry-wait provider=${providerName || "API"} job=${jobId || "-"} shot=${shotId || "-"} wait=${waitMs}ms nextAttempt=${attempt + 2}/${resolvedMaxAttempts}`
      );
      await delay(waitMs);
    }
  }
  if (isUpstreamQuotaError(lastError)) throw lastError;
  const friendlyError = new Error(userFriendlyGenerationError(lastError, providerName));
  friendlyError.status = generationErrorStatus(lastError);
  friendlyError.cause = lastError;
  throw friendlyError;
}

function base64ImageToDataUrl(value, mimeType = "image/png") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(text)) return text;
  return `data:${mimeType || "image/png"};base64,${text.replace(/\s+/g, "")}`;
}

function likelyBase64Image(value) {
  const text = String(value || "").trim();
  return text.length > 180 && /^[a-zA-Z0-9+/=\s]+$/.test(text);
}

function textImageCandidate(value) {
  const text = String(value || "");
  const dataUrl = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/);
  if (dataUrl?.[0]) return dataUrl[0].replace(/\s+/g, "");
  const url = text.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>]*)?/i);
  return url?.[0] || "";
}

function parseImageJsonFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return parseJsonFromText(text);
}

function extractGeneratedImageUrl(payload) {
  const seen = new Set();

  function visit(value, key = "", depth = 0) {
    if (value == null || depth > 8) return "";

    if (typeof value === "string") {
      if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) return value.replace(/\s+/g, "");
      if (/^https?:\/\//i.test(value) && ["url", "image_url", "file_url", "uri", "fileUri", "file_uri"].includes(key)) {
        return value;
      }
      if (["b64_json", "base64", "image_base64", "data"].includes(key) && likelyBase64Image(value)) {
        return base64ImageToDataUrl(value);
      }
      const embedded = textImageCandidate(value);
      if (embedded) return embedded;
      const parsed = parseImageJsonFromText(value);
      return parsed ? visit(parsed, key, depth + 1) : "";
    }

    if (typeof value !== "object") return "";
    if (seen.has(value)) return "";
    seen.add(value);

    const inlineData = value.inlineData || value.inline_data;
    if (inlineData?.data) {
      return base64ImageToDataUrl(inlineData.data, inlineData.mimeType || inlineData.mime_type || "image/png");
    }

    if (value.image_url && typeof value.image_url === "object") {
      const nestedUrl = visit(value.image_url.url || value.image_url.uri || value.image_url, "image_url", depth + 1);
      if (nestedUrl) return nestedUrl;
    }

    if (value.fileData?.fileUri) return value.fileData.fileUri;
    if (value.file_data?.file_uri) return value.file_data.file_uri;

    for (const field of ["b64_json", "base64", "image_base64"]) {
      if (likelyBase64Image(value[field])) return base64ImageToDataUrl(value[field], value.mimeType || value.mime_type || "image/png");
    }

    if (value.data && (value.mimeType || value.mime_type) && likelyBase64Image(value.data)) {
      return base64ImageToDataUrl(value.data, value.mimeType || value.mime_type || "image/png");
    }

    for (const field of ["url", "image_url", "file_url", "uri", "fileUri", "file_uri"]) {
      const directUrl = visit(value[field], field, depth + 1);
      if (directUrl) return directUrl;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, key, depth + 1);
        if (found) return found;
      }
      return "";
    }

    const preferredFields = ["data", "output", "content", "parts", "choices", "candidates", "images", "result", "results", "message"];
    for (const field of preferredFields) {
      const found = visit(value[field], field, depth + 1);
      if (found) return found;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      if (preferredFields.includes(childKey)) continue;
      const found = visit(childValue, childKey, depth + 1);
      if (found) return found;
    }
    return "";
  }

  return visit(payload);
}

function noGeneratedImageMessage(providerName, modelOption = {}) {
  const modelLabel = [modelOption.label, modelOption.apiModel].filter(Boolean).join(" / ") || "current model";
  return `${providerName} 已返回，但没有返回可用图片字段。模型：${modelLabel}。这通常表示上游只返回了文字说明、拒绝出图，或当前接口返回格式与图片解析不兼容。`;
}

function openAISize(ratio) {
  const text = String(ratio || "");
  if (text.includes("9:16")) return "1024x1536";
  if (text.includes("16:9")) return "1536x1024";
  if (text.includes("3:4") || text.includes("4:5")) return "1024x1536";
  if (text.includes("4:3")) return "1536x1024";
  return "1024x1024";
}

function openAIQuality(clarity) {
  if (clarity === "4k") return "high";
  return "medium";
}

function geminiAspectRatio(ratio) {
  const match = String(ratio || "").match(/(\d+)\s*:\s*(\d+)/);
  return match ? `${match[1]}:${match[2]}` : "1:1";
}

function imageDimensions(file = {}) {
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.toString("ascii", 1, 4) === "PNG") {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return width && height ? { width, height } : null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xc3) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return width && height ? { width, height } : null;
      }
      offset += 2 + length;
    }
  }
  return null;
}

function nearestAspectRatio(width, height, fallback = "1:1") {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return geminiAspectRatio(fallback);
  const value = w / h;
  const options = [
    ["1:1", 1],
    ["3:4", 3 / 4],
    ["4:3", 4 / 3],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16]
  ];
  return options.reduce((best, current) => {
    return Math.abs(current[1] - value) < Math.abs(best[1] - value) ? current : best;
  })[0];
}

function referenceCanvasAspectRatio(referenceCanvas, fallback = "1:1") {
  const dimensions = imageDimensions(referenceCanvas);
  return dimensions ? nearestAspectRatio(dimensions.width, dimensions.height, fallback) : geminiAspectRatio(fallback);
}

function geminiImageSize(clarity) {
  if (clarity === "4k") return "4K";
  if (clarity === "1k") return "1K";
  return "2K";
}

async function generateOpenAIImage({ prompt, files, modelOption, ratio, clarity, apiKey, baseUrl, providerName = "OpenAI", settings = {}, generationContext = {} }) {
  if (!apiKey) {
    throw new Error(`${providerName} API key is not configured.`);
  }

  const form = new FormData();
  const rolePrompt = isGptDesignSpecSettings(settings) ? "" : generationInputRolePrompt(files, settings, {});
  form.append("model", modelOption.apiModel);
  form.append("prompt", [prompt, rolePrompt].filter(Boolean).join("\n\n"));
  form.append("size", openAISize(ratio));
  form.append("quality", openAIQuality(clarity));
  form.append("background", "opaque");

  for (const file of files.slice(0, 8)) {
    const blob = new Blob([file.buffer], { type: file.mimetype || "image/png" });
    form.append("image", blob, file.originalname || "lamp.png");
  }

  const endpoint = `${String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/images/edits`;
  const payload = await fetchJsonWithStableGenerationRetry(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form,
    clarity,
    providerName,
    maxAttempts: generationContext.maxAttempts,
    retryDelaysMs: generationContext.retryDelaysMs,
    jobId: generationContext.jobId,
    shotId: generationContext.shotId,
    shotCategory: generationContext.shotCategory,
    generationContext
  });
  const imageUrl = extractGeneratedImageUrl(payload);
  if (!imageUrl) {
    throw new Error(noGeneratedImageMessage(providerName, modelOption));
  }
  return imageUrl;
}


async function generateGeminiImage({
  prompt,
  files,
  modelOption,
  apiKey,
  baseUrl = "",
  providerName = "Gemini",
  useBearerAuth = false,
  ratio,
  clarity,
  styleCloneMode = false,
  settings = {},
  generationContext = {}
}) {
  if (!apiKey) {
    throw new Error(providerName + " API key is not configured.");
  }
  const outputAspectRatio = settings?.styleTextEditMode
    ? referenceCanvasAspectRatio(files?.[0], ratio)
    : geminiAspectRatio(ratio);
  const isCollageTemplate = isCollageTemplateSettings(settings);
  const selectedFiles = (files || []).slice(0, isCollageTemplate ? 6 : 8);
  const isDirectStyleSwap =
    Boolean(settings?.styleCloneMode) &&
    (!styleSimilarMode(settings) || styleSimilarMode(settings) === "none") &&
    selectedFiles.some((file) => file.inputRole === "reference-canvas") &&
    selectedFiles.some((file) => file.inputRole === "primary-product");
  const styleSpec = isActiveStyleSimilarSettings(settings) ? styleSimilarModeSpec(styleSimilarMode(settings)) : null;
  const backgroundSpec = isCollageTemplate ? collageBackgroundSpec(settings) : "";
  if (!selectedFiles.length) {
    throw new Error("Missing input image for generation.");
  }
  const gptDesignSpecProductPrompt = isGptDesignSpecSettings(settings);
  const rolePrompt = generationInputRolePrompt(selectedFiles, settings, { styleSpec, isDirectStyleSwap });
  const instructionLines = [
    String(prompt || ""),
    rolePrompt,
    "最终输出必须使用指定画幅比例：" + outputAspectRatio + "。",
    isCollageTemplate
      ? "多产品拼图模式：每张输入图都是独立灯具产品来源。提取并修整每张图里的可见灯具主体，去除原背景，把所有产品放在同一张电商方形画布上：" + backgroundSpec + "。"
      : isDirectStyleSwap
        ? "直接换主体模式：输入图 1 只作为参考画布、版式和背景；输入图 2 是替换灯具身份来源。用输入图 2 的灯具替换输入图 1 中的原灯具/产品，不要原样返回输入图 1。"
        : styleSpec
          ? "相似参考模式：输入图 1 是灯具身份来源。输入图 2 只作为" + styleSpec.label + "参考。" + styleSpec.referenceUse
        : "以上传产品图作为唯一身份来源，保持真实灯具结构。",
    isCollageTemplate
      ? "每张输入图都保留一个可见产品；不要漏掉产品、融合灯具、添加新零件、重设计轮廓、做照片拼贴、画卡片、网格线或文字。标签会由应用在生成后本地叠加。"
      : isDirectStyleSwap
        ? "最终图必须清楚包含输入图 2 的灯具，而不是输入图 1 的原灯具。保留参考场景、透视、裁切、光线和背景，只替换灯具/产品主体。"
        : styleSpec
          ? styleSpec.generationGoal + " " + styleSpec.negativeRules
        : "不要添加随机文字、水印、标志或无关产品零件。"
  ];
  const parts = [{ text: gptDesignSpecProductPrompt ? String(prompt || "") : instructionLines.filter(Boolean).join("\n") }];
  selectedFiles.forEach((file, index) => {
    const roleInstruction = generationInputRoleInstruction(file, index, { settings, styleSpec, isDirectStyleSwap });
    if (!gptDesignSpecProductPrompt) {
      parts.push({
        text: roleInstruction
      });
    }
    parts.push({
      inlineData: {
        mimeType: file.mimetype || "image/png",
        data: file.buffer.toString("base64")
      }
    });
  });
  const endpoint = useBearerAuth
    ? String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "") + "/models/" + encodeURIComponent(modelOption.apiModel) + ":generateContent"
    : "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(modelOption.apiModel) + ":generateContent";
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: "Bearer " + apiKey }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const payload = await fetchJsonWithStableGenerationRetry(endpoint, {
    method: "POST",
    headers,
    clarity,
    styleCloneMode,
    useBearerAuth,
    providerName,
    maxAttempts: generationContext.maxAttempts,
    retryDelaysMs: generationContext.retryDelaysMs,
    jobId: generationContext.jobId,
    shotId: generationContext.shotId,
    shotCategory: generationContext.shotCategory,
    generationContext,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: outputAspectRatio,
          imageSize: geminiImageSize(clarity)
        }
      }
    })
  });
  const imageUrl = extractGeneratedImageUrl(payload);
  if (!imageUrl) {
    throw new Error(noGeneratedImageMessage(providerName, modelOption));
  }
  return imageUrl;
}

function imageInlineDataFromUrl(imageUrl) {
  const value = String(imageUrl || "");
  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!dataMatch) return null;
  return { mimeType: dataMatch[1], data: dataMatch[2] };
}

function mimeTypeFromImagePath(filePath = "") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function localPublicImageInlineData(imageUrl = "") {
  const value = String(imageUrl || "").trim();
  if (!value || /^https?:\/\//i.test(value) || /^data:/i.test(value)) return null;
  const pathname = value.startsWith("/") ? value.slice(1) : value;
  const filePath = path.resolve(PUBLIC_DIR, pathname);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return {
    mimeType: mimeTypeFromImagePath(filePath),
    data: fs.readFileSync(filePath).toString("base64")
  };
}

async function imageInlineDataFromUrlOrFetch(imageUrl) {
  const direct = imageInlineDataFromUrl(imageUrl);
  if (direct) return direct;
  const local = localPublicImageInlineData(imageUrl);
  if (local) return local;
  if (!/^https?:\/\//i.test(String(imageUrl || ""))) return null;
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) return null;
  const mimeType = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { mimeType, data: bytes.toString("base64") };
}

function shouldRunSpatialLensVisualQa(shot = {}, category = "", settings = {}) {
  if (MODEL_QUALITY_CHECKS_DISABLED) return false;
  if (!isProductWorkspaceSettings(settings)) return false;
  if (settings?.disableSpatialLensVisualQa || settings?.spatialLensVisualQa === false) return false;
  if (settings?.spatialLensVisualQa !== true) return false;
  return shotRequiresNonCloseupSpatialLens(shot, category);
}

function spatialLensVisualQaPrompt(shot = {}, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = productPlanLampChannel(safeProfile, settings);
  return [
    "你是灯具详情页构图质检模型。只判断图片是否符合首图/场景图的中远景完整空间要求，返回 JSON，不要解释。",
    "合格标准：先看到完整住宅空间尺度，再看到真实比例灯具；画面必须有地面、家具、墙面、门洞/窗或天花挂点等尺度参照。",
    "失败标准：灯具成为前景主视觉、占据上半屏主要面积、压到画面中线、机位在灯具正下方、只拍灯体、空间参照不足，均为 fail。",
    channel === "large"
      ? "大灯阈值：主灯完整外轮廓高度应≤0.18，灯具下缘 y 应≤0.35；像超大吊灯悬在餐桌上方并占住画面上半部，即使有餐厅背景也必须 fail。"
      : channel === "small"
        ? "小灯阈值：单个灯位宽度应≤0.04，灯位只作为天花/柜体上的小尺度点；小灯主体被放大到可清楚占据画面中心必须 fail。"
        : channel === "wall"
          ? "壁灯阈值：壁灯外轮廓应约0.06-0.16，不能占据半面墙主视觉；必须保留墙面、家具、地面或门洞尺度。"
          : "通用阈值：灯具不能成为半屏主视觉，必须小于空间主视觉。",
    `当前图片类型：${shot?.title || shot?.category || "首图/场景图"}。`,
    '返回格式：{"status":"pass|fail","reason":"...","lampHeightRatio":0.18,"lampWidthRatio":0.2,"lampBottomYRatio":0.34,"roomScaleVisible":true}'
  ].join("\n");
}

function normalizeSpatialLensVisualQaResult(value = {}) {
  const parsed = value && typeof value === "object" ? value : {};
  const status = String(parsed.status || parsed.result || "").toLowerCase() === "fail" ? "fail" : "pass";
  const readRatio = (key) => {
    const number = Number(parsed[key]);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  };
  return {
    status,
    reason: String(parsed.reason || parsed.message || "").slice(0, 240),
    lampHeightRatio: readRatio("lampHeightRatio"),
    lampWidthRatio: readRatio("lampWidthRatio"),
    lampBottomYRatio: readRatio("lampBottomYRatio"),
    roomScaleVisible: parsed.roomScaleVisible !== false,
    source: String(parsed.source || "vision")
  };
}

function spatialLensVisualQaFails(result = {}, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const channel = productPlanLampChannel(safeProfile, settings);
  if (result.status === "fail") return true;
  if (channel === "large") {
    return Number(result.lampHeightRatio || 0) > 0.22 || Number(result.lampBottomYRatio || 0) > 0.42;
  }
  if (channel === "small") {
    return Number(result.lampWidthRatio || 0) > 0.06 || Number(result.lampHeightRatio || 0) > 0.08;
  }
  if (channel === "wall") {
    return Number(result.lampHeightRatio || 0) > 0.2 || Number(result.lampWidthRatio || 0) > 0.26;
  }
  return Number(result.lampHeightRatio || 0) > 0.25;
}

async function analyzeSpatialLensWithOpenAICompatibleVision({ imageUrl, shot = {}, profile = {}, settings = {}, model, apiKey, baseUrl, providerName = "OpenAI-compatible" } = {}) {
  if (!apiKey) return null;
  const inline = await imageInlineDataFromUrlOrFetch(imageUrl);
  if (!inline) return null;
  const response = await fetch(`${String(baseUrl || DEFAULT_APIYI_BASE_URL).replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: spatialLensVisualQaPrompt(shot, profile, settings) },
          { type: "image_url", image_url: { url: `data:${inline.mimeType || "image/png"};base64,${inline.data}` } }
        ]
      }],
      temperature: 0,
      ...openAICompatibleTokenLimit(model, 1024),
      ...openAICompatibleReasoningOptions(model),
      response_format: { type: "json_object" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 构图质检失败：HTTP ${response.status}`));
  const parsed = parseJsonFromText(payload?.choices?.[0]?.message?.content || "");
  if (!parsed) throw new Error(`${providerName} 构图质检返回内容不可解析`);
  return normalizeSpatialLensVisualQaResult({ ...parsed, source: providerName });
}

async function analyzeSpatialLensWithGeminiVision({ imageUrl, shot = {}, profile = {}, settings = {}, model, apiKey, baseUrl = "", providerName = "Gemini", useBearerAuth = false } = {}) {
  if (!apiKey) return null;
  const inline = await imageInlineDataFromUrlOrFetch(imageUrl);
  if (!inline) return null;
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers,
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: spatialLensVisualQaPrompt(shot, profile, settings) },
          { inlineData: { mimeType: inline.mimeType || "image/png", data: inline.data } }
        ]
      }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} 构图质检失败：HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  const parsed = parseJsonFromText(text);
  if (!parsed) throw new Error(`${providerName} 构图质检返回内容不可解析`);
  return normalizeSpatialLensVisualQaResult({ ...parsed, source: providerName });
}

async function maybeRunSpatialLensVisualQa({ db, imageUrl, shot = {}, profile = {}, settings = {}, geminiKey = "", geminiBaseUrl = "", geminiProviderName = "Gemini", geminiUseBearerAuth = false, openAICompatibleKey = "", openAICompatibleBaseUrl = "", openAICompatibleName = "OpenAI-compatible" } = {}) {
  if (MODEL_QUALITY_CHECKS_DISABLED) return { status: "skip", reason: "model-quality-checks-disabled" };
  const category = resolveShotTask({ ...shot, prompt: shot.prompt || shot.generationPrompt || "" });
  if (!isProductWorkspaceSettings(settings)) return { status: "skip", reason: "not-product-workspace" };
  if (settings?.disableSpatialLensVisualQa || settings?.spatialLensVisualQa !== true) return { status: "skip", reason: "prompt-planning-only" };
  if (!shotRequiresNonCloseupSpatialLens(shot, category)) return { status: "skip", reason: "not-spatial-shot" };
  const appSettings = db ? getAppSettings(db) : {};
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const brain = db ? openAICompatibleBrainChannel(db) : {
    apiKey: openAICompatibleKey,
    baseUrl: openAICompatibleBaseUrl,
    providerName: openAICompatibleName
  };
  const attempts = [];
  if (db) {
    try {
      const providerKind = isGeminiAnalysisModel(analysisModel) ? "gemini" : "openai-compatible";
      return await runWithModelChannelRetry(db, {
        purpose: "analysis",
        modelId: analysisModel.apiModel || analysisModel.id,
        providerKind,
        modelOption: {
          id: analysisModel.id,
          apiModel: analysisModel.apiModel || analysisModel.id,
          provider: providerKind === "gemini" ? "gemini" : "openai-compatible"
        },
        maxAttempts: 1
      }, async (channel) => {
        if (providerKind === "gemini") {
          const resolved = modelChannelGemini(channel);
          return analyzeSpatialLensWithGeminiVision({
            imageUrl,
            shot,
            profile,
            settings,
            model: analysisModel.apiModel || analysisModel.id,
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            providerName: resolved.providerName,
            useBearerAuth: resolved.useBearerAuth
          });
        }
        const resolved = modelChannelOpenAICompatible(channel);
        return analyzeSpatialLensWithOpenAICompatibleVision({
          imageUrl,
          shot,
          profile,
          settings,
          model: analysisModel.apiModel || analysisModel.id,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          providerName: resolved.providerName
        });
      });
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }
  try {
    if (!isGeminiAnalysisModel(analysisModel) && brain.apiKey) {
      return await analyzeSpatialLensWithOpenAICompatibleVision({
        imageUrl,
        shot,
        profile,
        settings,
        model: analysisModel.apiModel || analysisModel.id,
        apiKey: brain.apiKey,
        baseUrl: brain.baseUrl,
        providerName: brain.providerName || "OpenAI-compatible"
      });
    }
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const resolvedGeminiKey = geminiKey || (db ? effectiveGeminiKey(db) : "");
    if (resolvedGeminiKey) {
      const model = isGeminiAnalysisModel(analysisModel) ? (analysisModel.apiModel || analysisModel.id) : "gemini-2.5-flash";
      return await analyzeSpatialLensWithGeminiVision({
        imageUrl,
        shot,
        profile,
        settings,
        model,
        apiKey: resolvedGeminiKey,
        baseUrl: geminiBaseUrl || (db ? "" : geminiBaseUrl),
        providerName: geminiProviderName || "Gemini",
        useBearerAuth: geminiUseBearerAuth
      });
    }
  } catch (error) {
    attempts.push(error instanceof Error ? error.message : String(error));
  }
  if (attempts.length) {
    console.warn("[spatial-lens-qa] skipped after analysis error:", attempts.join("；"));
  }
  return { status: "skip", reason: attempts.join("；") || "no-analysis-key" };
}

async function generateImageForShot({
  prompt,
  files,
  modelOption,
  ratio,
  clarity,
  geminiKey,
  geminiBaseUrl,
  geminiProviderName,
  geminiUseBearerAuth,
  openAICompatibleKey,
  openAICompatibleBaseUrl,
  openAICompatibleName,
  settings = {},
  generationContext = {}
}) {
  if (generationContext?.db) {
    const providerKind = modelOption.provider === "openai" ? "openai-compatible" : "gemini";
    return runWithModelChannelRetry(generationContext.db, {
      purpose: "generation",
      modelId: modelOption.id || modelOption.apiModel,
      modelOption,
      providerKind,
      account: generationContext.account || "",
      jobId: generationContext.jobId || "",
      maxAttempts: generationContext.maxChannelAttempts || generationContext.channelAttempts,
      generationContext
    }, async (channel) => {
      if (modelOption.provider === "openai") {
        const resolved = modelChannelOpenAICompatible(channel);
        return generateOpenAIImage({
          prompt,
          files,
          modelOption,
          ratio,
          clarity,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          providerName: resolved.providerName,
          settings,
          generationContext
        });
      }
      const resolved = modelChannelGemini(channel);
      return generateGeminiImage({
        prompt,
        files,
        modelOption,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        providerName: resolved.providerName,
        useBearerAuth: resolved.useBearerAuth,
        ratio,
        clarity,
        styleCloneMode: Boolean(settings?.styleCloneMode),
        settings,
        generationContext
      });
    });
  }
  return modelOption.provider === "openai"
    ? generateOpenAIImage({
        prompt,
        files,
        modelOption,
        ratio,
        clarity,
        apiKey: openAICompatibleKey,
        baseUrl: openAICompatibleBaseUrl,
        providerName: openAICompatibleName,
        settings,
        generationContext
      })
    : generateGeminiImage({
        prompt,
        files,
        modelOption,
        apiKey: geminiKey,
        baseUrl: geminiBaseUrl,
        providerName: geminiProviderName,
        useBearerAuth: geminiUseBearerAuth,
        ratio,
        clarity,
        styleCloneMode: Boolean(settings?.styleCloneMode),
        settings,
        generationContext
      });
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function collageCanvasSize(settings = {}) {
  const ratio = String(settings?.ratio || "1:1");
  if (ratio.includes("16:9")) return { width: 1280, height: 720 };
  if (ratio.includes("9:16")) return { width: 720, height: 1280 };
  if (ratio.includes("4:3")) return { width: 1200, height: 900 };
  if (ratio.includes("3:4")) return { width: 900, height: 1200 };
  return { width: 1024, height: 1024 };
}

function imageDimensionsFromUrl(imageUrl = "") {
  const value = String(imageUrl || "");
  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataMatch) {
    return imageDimensions({ buffer: Buffer.from(dataMatch[2], "base64") });
  }
  if (value.startsWith("/")) {
    const filePath = path.resolve(PUBLIC_DIR, value.replace(/^\/+/, ""));
    if (filePath.startsWith(PUBLIC_DIR) && fs.existsSync(filePath)) {
      return imageDimensions({ buffer: fs.readFileSync(filePath) });
    }
  }
  return null;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function collageOverlaySlots(count = 0) {
  return collageLabelBandSlots(count).map((slot) => ({ x: slot.x * 100, y: slot.y * 100 }));
}

function collageLabelBandSlots(count = 0) {
  const normalized = Math.max(2, Math.min(6, Number(count) || 2));
  const slots = {
    2: [
      { x: 0.3, y: 0.74, minX: 0.08, maxX: 0.47, minY: 0.64, maxY: 0.84 },
      { x: 0.7, y: 0.74, minX: 0.53, maxX: 0.92, minY: 0.64, maxY: 0.84 }
    ],
    3: [
      { x: 0.25, y: 0.48, minX: 0.08, maxX: 0.43, minY: 0.4, maxY: 0.58 },
      { x: 0.75, y: 0.48, minX: 0.57, maxX: 0.92, minY: 0.4, maxY: 0.58 },
      { x: 0.5, y: 0.9, minX: 0.3, maxX: 0.7, minY: 0.82, maxY: 0.96 }
    ],
    4: [
      { x: 0.25, y: 0.48, minX: 0.08, maxX: 0.43, minY: 0.4, maxY: 0.58 },
      { x: 0.75, y: 0.48, minX: 0.57, maxX: 0.92, minY: 0.4, maxY: 0.58 },
      { x: 0.25, y: 0.9, minX: 0.08, maxX: 0.43, minY: 0.82, maxY: 0.96 },
      { x: 0.75, y: 0.9, minX: 0.57, maxX: 0.92, minY: 0.82, maxY: 0.96 }
    ],
    5: [
      { x: 0.25, y: 0.48, minX: 0.08, maxX: 0.43, minY: 0.4, maxY: 0.58 },
      { x: 0.75, y: 0.48, minX: 0.57, maxX: 0.92, minY: 0.4, maxY: 0.58 },
      { x: 0.2, y: 0.91, minX: 0.05, maxX: 0.34, minY: 0.83, maxY: 0.965 },
      { x: 0.5, y: 0.91, minX: 0.35, maxX: 0.65, minY: 0.83, maxY: 0.965 },
      { x: 0.8, y: 0.91, minX: 0.66, maxX: 0.95, minY: 0.83, maxY: 0.965 }
    ],
    6: [
      { x: 0.18, y: 0.48, minX: 0.04, maxX: 0.31, minY: 0.4, maxY: 0.58 },
      { x: 0.5, y: 0.48, minX: 0.34, maxX: 0.66, minY: 0.4, maxY: 0.58 },
      { x: 0.82, y: 0.48, minX: 0.69, maxX: 0.96, minY: 0.4, maxY: 0.58 },
      { x: 0.18, y: 0.91, minX: 0.04, maxX: 0.31, minY: 0.83, maxY: 0.965 },
      { x: 0.5, y: 0.91, minX: 0.34, maxX: 0.66, minY: 0.83, maxY: 0.965 },
      { x: 0.82, y: 0.91, minX: 0.69, maxX: 0.96, minY: 0.83, maxY: 0.965 }
    ]
  };
  return slots[normalized] || slots[5];
}

function shouldAnalyzeCollageLabelPositions(settings = {}) {
  const mode = String(settings?.collageLabelPositioning || "").toLowerCase();
  if (mode === "fixed" || mode === "none" || mode === "off") return false;
  if (mode === "vision") return true;
  return isCollageTemplateSettings(settings) && collageVisibleLabels(settings).length > 0;
}

function normalizePositionValue(value, axisSize = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0 && number <= 1) return number;
  if (number > 1 && number <= 100) return number / 100;
  if (number > 100 && axisSize > 0) return number / axisSize;
  return null;
}

function normalizeLabelBox(box = {}, width = 1, height = 1) {
  const x = normalizePositionValue(box.x ?? box.left, width);
  const y = normalizePositionValue(box.y ?? box.top, height);
  const w = normalizePositionValue(box.width ?? box.w, width);
  const h = normalizePositionValue(box.height ?? box.h, height);
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
  return {
    x: clampNumber(x, 0, 0.98),
    y: clampNumber(y, 0, 0.98),
    width: clampNumber(w, 0.02, 1),
    height: clampNumber(h, 0.02, 1)
  };
}

function normalizeLabelPoint(point = {}, width = 1, height = 1) {
  const x = normalizePositionValue(point.x ?? point.cx, width);
  const y = normalizePositionValue(point.y ?? point.cy, height);
  if (x == null || y == null) return null;
  return { x: clampNumber(x, 0, 1), y: clampNumber(y, 0, 1) };
}

function normalizeCollageLabelPositions(rawPositions = [], labels = [], { width = 1, height = 1 } = {}) {
  if (!Array.isArray(rawPositions)) return [];
  const byIndex = new Map();
  for (const item of rawPositions) {
    const index = Number(item?.index ?? item?.sourceIndex ?? item?.imageIndex);
    if (!Number.isFinite(index) || index < 1) continue;
    const bbox = normalizeLabelBox(item?.bbox || item?.box || item?.productBox || {}, width, height);
    const labelCenter = normalizeLabelPoint(item?.labelCenter || item?.label_center || item?.center || {}, width, height);
    const confidence = clampNumber(item?.confidence ?? item?.score ?? 0, 0, 1);
    if (!bbox && !labelCenter) continue;
    byIndex.set(index, { index, bbox, labelCenter, confidence });
  }
  return labels
    .map((label) => {
      const found = byIndex.get(Number(label.index));
      return found && found.confidence >= 0.1 ? { ...found, name: label.name } : null;
    })
    .filter(Boolean);
}

function fallbackCollageLabelPositions(labels = [], settings = {}) {
  const slots = collageLabelBandSlots(Number(settings?.collageSourceCount || labels.length || 2));
  return labels
    .map((label) => {
      const slot = slots[Math.max(0, Math.min(slots.length - 1, Number(label.index || 1) - 1))];
      return slot
        ? {
            index: label.index,
            name: label.name,
            labelCenter: { x: slot.x, y: slot.y },
            labelBand: slot,
            confidence: 0.3
          }
        : null;
    })
    .filter(Boolean);
}

function rectFromCenter(cx, cy, width, height) {
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height
  };
}

function rectOverlapArea(a = {}, b = {}, padding = 0) {
  const ax1 = (Number(a.x) || 0) - padding;
  const ay1 = (Number(a.y) || 0) - padding;
  const ax2 = (Number(a.x) || 0) + (Number(a.width) || 0) + padding;
  const ay2 = (Number(a.y) || 0) + (Number(a.height) || 0) + padding;
  const bx1 = (Number(b.x) || 0) - padding;
  const by1 = (Number(b.y) || 0) - padding;
  const bx2 = (Number(b.x) || 0) + (Number(b.width) || 0) + padding;
  const by2 = (Number(b.y) || 0) + (Number(b.height) || 0) + padding;
  const width = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const height = Math.min(ay2, by2) - Math.max(ay1, by1);
  return Math.max(0, width) * Math.max(0, height);
}

function clampLabelCenterToCanvas(cx, cy, pillWidth, pillHeight, width, height, margin) {
  return {
    cx: clampNumber(cx, margin + pillWidth / 2, width - margin - pillWidth / 2),
    cy: clampNumber(cy, margin + pillHeight / 2, height - margin - pillHeight / 2)
  };
}

function clampLabelCenterToBand(cx, cy, pillWidth, pillHeight, width, height, margin, band = null) {
  const canvas = clampLabelCenterToCanvas(cx, cy, pillWidth, pillHeight, width, height, margin);
  if (!band) return canvas;
  const minX = Math.max(margin + pillWidth / 2, (Number(band.minX) || 0) * width + pillWidth / 2);
  const maxX = Math.min(width - margin - pillWidth / 2, (Number(band.maxX) || 1) * width - pillWidth / 2);
  const minY = Math.max(margin + pillHeight / 2, (Number(band.minY) || 0) * height + pillHeight / 2);
  const maxY = Math.min(height - margin - pillHeight / 2, (Number(band.maxY) || 1) * height - pillHeight / 2);
  return {
    cx: clampNumber(canvas.cx, Math.min(minX, maxX), Math.max(minX, maxX)),
    cy: clampNumber(canvas.cy, Math.min(minY, maxY), Math.max(minY, maxY))
  };
}

function labelPlacementCandidates({ position = {}, bbox = null, band = null, width, height, pillWidth, pillHeight, margin, gap }) {
  const candidates = [];
  const add = (cx, cy, priority = 0) => {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const clamped = clampLabelCenterToBand(cx, cy, pillWidth, pillHeight, width, height, margin, band);
    candidates.push({
      cx: clamped.cx,
      cy: clamped.cy,
      priority,
      rect: rectFromCenter(clamped.cx, clamped.cy, pillWidth, pillHeight)
    });
  };
  const bandCx = (Number(band?.x) || Number(position.labelCenter?.x) || 0.5) * width;
  const bandCy = (Number(band?.y) || Number(position.labelCenter?.y) || 0.72) * height;
  const bboxCx = bbox ? bbox.x + bbox.width / 2 : bandCx;
  const alignedCx = band ? clampNumber(bboxCx, band.minX * width, band.maxX * width) : bboxCx;
  const stepY = Math.max(gap * 0.8, pillHeight * 0.42);
  const stepX = Math.max(pillWidth * 0.45, gap * 2);
  add(alignedCx, bandCy, 0);
  add(bandCx, bandCy, 1);
  add(alignedCx, bandCy + stepY, 2);
  add(alignedCx, bandCy - stepY, 2);
  add(alignedCx - stepX, bandCy, 3);
  add(alignedCx + stepX, bandCy, 3);
  add(bandCx, bandCy + stepY, 4);
  add(bandCx, bandCy - stepY, 4);
  if (bbox) {
    const belowY = bbox.y + bbox.height + gap + pillHeight / 2;
    const nearBelowY = band ? clampNumber(belowY, band.minY * height, band.maxY * height) : belowY;
    add(alignedCx, nearBelowY, 5);
  }
  return candidates;
}

function pickCollageLabelPlacement({ position = {}, bbox = null, band = null, width, height, pillWidth, pillHeight, margin, gap, placedRects = [] }) {
  const productPadding = Math.max(4, Math.round(Math.min(width, height) * 0.007));
  const labelPadding = Math.max(3, Math.round(Math.min(width, height) * 0.006));
  const candidates = labelPlacementCandidates({ position, bbox, band, width, height, pillWidth, pillHeight, margin, gap });
  const bandCx = (Number(band?.x) || Number(position.labelCenter?.x) || 0.5) * width;
  const bandCy = (Number(band?.y) || Number(position.labelCenter?.y) || 0.72) * height;
  let best = null;
  for (const candidate of candidates) {
    const productOverlap = bbox ? rectOverlapArea(candidate.rect, bbox, productPadding) : 0;
    const labelOverlap = placedRects.reduce((sum, rect) => sum + rectOverlapArea(candidate.rect, rect, labelPadding), 0);
    const bandDistance = Math.hypot(candidate.cx - bandCx, candidate.cy - bandCy);
    const score =
      productOverlap * 1000000 +
      labelOverlap * 500000 +
      candidate.priority * 100000 +
      bandDistance;
    if (!best || score < best.score) {
      best = { ...candidate, score };
    }
  }
  return best || candidates[0];
}

async function applyCollageLabelOverlay(imageUrl = "", settings = {}, labelPositions = []) {
  const labels = collageVisibleLabels(settings);
  if (!isCollageTemplateSettings(settings) || !labels.length || !imageUrl) return imageUrl;
  const dimensions = imageDimensionsFromUrl(imageUrl) || collageCanvasSize(settings);
  const width = Math.max(1, Math.round(dimensions.width || 1024));
  const height = Math.max(1, Math.round(dimensions.height || 1024));
  const positions = normalizeCollageLabelPositions(labelPositions, labels, { width, height });
  const fallbackPositions = fallbackCollageLabelPositions(labels, settings);
  const positionByIndex = new Map(fallbackPositions.map((item) => [Number(item.index), item]));
  for (const position of positions) {
    const index = Number(position.index);
    const fallback = positionByIndex.get(index) || {};
    positionByIndex.set(index, {
      ...fallback,
      ...position,
      labelBand: fallback.labelBand || position.labelBand
    });
  }
  const base = Math.min(width, height);
  const maxFont = Math.round(base * 0.02);
  const placedRects = [];
  const labelNodes = labels
    .map((label) => {
      const position = positionByIndex.get(Number(label.index));
      const text = String(label.name || "").trim();
      if (!text || !position) return "";
      const maxPillWidth = Math.round(width * 0.155);
      const minFont = Math.max(10, Math.round(base * 0.012));
      const fontSize = clampNumber(Math.floor((maxPillWidth - base * 0.02) / Math.max(2.7, text.length * 1.02)), minFont, Math.max(minFont, maxFont));
      const pillHeight = Math.round(fontSize * 1.38);
      const pillRadius = Math.round(pillHeight / 2);
      const pillWidth = Math.max(Math.round(fontSize * 2.15), Math.min(maxPillWidth, Math.round(text.length * fontSize * 0.94 + fontSize * 1.16)));
      const margin = Math.round(base * 0.018);
      const gap = Math.round(base * 0.018);
      const bbox = position.bbox
        ? {
            x: position.bbox.x * width,
            y: position.bbox.y * height,
            width: position.bbox.width * width,
            height: position.bbox.height * height
          }
        : null;
      const placement = pickCollageLabelPlacement({
        position,
        bbox,
        band: position.labelBand,
        width,
        height,
        pillWidth,
        pillHeight,
        margin,
        gap,
        placedRects
      });
      const cx = Math.round(placement.cx);
      const cy = Math.round(placement.cy);
      const x = Math.round(cx - pillWidth / 2);
      const y = Math.round(cy - pillHeight / 2);
      placedRects.push({ x, y, width: pillWidth, height: pillHeight });
      return [
        `<g class="collage-label" aria-label="${escapeXml(text)}">`,
        `<rect x="${x}" y="${y}" width="${pillWidth}" height="${pillHeight}" rx="${pillRadius}" fill="#6a6a64" opacity="0.82" stroke="#f4f2eb" stroke-opacity="0.18" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/>`,
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fffaf0" font-size="${fontSize}" font-weight="600" font-family="Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">${escapeXml(text)}</text>`,
        "</g>"
      ].join("");
    })
    .filter(Boolean)
    .join("");
  const inlineBaseImage = await imageInlineDataFromUrlOrFetch(imageUrl).catch(() => null);
  const baseImageHref = inlineBaseImage?.data
    ? `data:${inlineBaseImage.mimeType || "image/png"};base64,${inlineBaseImage.data}`
    : imageUrl;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeXml(baseImageHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`,
    labelNodes,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function overlayTextLines(text = "", maxChars = 14) {
  const value = cleanChineseOverlayText(text, { maxLength: Math.max(2, Number(maxChars) || 14) });
  if (!value) return [];
  if (value.length <= maxChars) return [value];
  return [value.slice(0, maxChars), value.slice(maxChars, maxChars * 2)].filter(Boolean);
}

function svgTextBlock({ lines = [], x = 0, y = 0, size = 28, fill = "#202020", weight = 500, anchor = "start", lineGap = 1.32 } = {}) {
  return lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : size * lineGap;
      return `<text x="${Math.round(x)}" y="${Math.round(y + dy)}" text-anchor="${anchor}" fill="${fill}" font-size="${Math.round(size)}" font-weight="${weight}" font-family="Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">${escapeXml(line)}</text>`;
    })
    .join("");
}

function fittedSvgTextSize(text = "", size = 42, maxWidth = 320, minSize = 28) {
  const cjkCount = (String(text || "").match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = Math.max(0, String(text || "").length - cjkCount);
  const estimatedWidth = cjkCount * size + otherCount * size * 0.56;
  if (!estimatedWidth || estimatedWidth <= maxWidth) return size;
  return clampNumber(Math.floor(size * (maxWidth / estimatedWidth)), minSize, size);
}

function themedOverlay(overlay = {}) {
  if (!overlay?.theme || typeof overlay.theme !== "object") return null;
  return normalizeTextOverlayTheme(overlay.theme, overlay.themeKey || overlay.theme.key || "default-commerce");
}

function svgColorWithOpacity(color = "#ffffff", opacity = 1) {
  const value = String(color || "#ffffff").trim();
  const alpha = clampNumber(opacity, 0, 1);
  if (/^rgba?\(/i.test(value) || alpha >= 0.995) return value;
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return value;
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function shotTextOverlaySvgNodes(overlay = {}, { width = 1024, height = 1024 } = {}) {
  const template = String(overlay.template || "corner-title");
  const base = Math.min(width, height);
  const marginX = Math.round(width * 0.075);
  const marginY = Math.round(height * 0.075);
  const theme = themedOverlay(overlay);
  const fontFamily = theme?.fontFamily || "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const serifFontFamily = theme?.serifFontFamily || "Noto Serif SC, Source Han Serif SC, SimSun, serif";
  const dark = theme?.titleFill || "#1f2427";
  const muted = theme?.subtitleFill || "#5f6466";
  const line = theme?.lineFill || "#9c8f7a";
  const panel = theme ? svgColorWithOpacity(theme.cardFill, theme.cardOpacity) : "rgba(255,255,255,0.72)";
  const title = cleanChineseOverlayText(overlay.title, { fallback: "产品亮点", maxLength: 12 });
  const subtitle = cleanChineseOverlayText(overlay.subtitle, { maxLength: 14 });
  const labels = (overlay.labels || [])
    .map((item) => cleanChineseOverlayText(item, { maxLength: 8 }))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
  const titleSize = Math.max(30, Math.round(base * 0.046 * (theme?.titleScale || 1)));
  const subSize = Math.max(16, Math.round(base * 0.019 * (theme?.subtitleScale || 1)));
  const labelSize = Math.max(16, Math.round(base * 0.019 * (theme?.labelScale || 1)));

  if (template === "commerce-detail-hero") {
    const panelMode = String(overlay.panel || "none");
    const hasPanel = panelMode !== "none";
    const panelX = Math.round(width * 0.055);
    const panelY = Math.round(height * 0.58);
    const panelW = Math.round(width * 0.62);
    const panelH = Math.round(base * 0.24);
    const padX = Math.round(base * 0.048);
    const textX = panelX + (hasPanel ? padX : Math.round(base * 0.028));
    const titleY = panelY + Math.round(panelH * 0.44);
    const heroTitleSize = fittedSvgTextSize(title, clampNumber(Math.round(base * 0.052 * (theme?.titleScale || 1)), 34, 72), Math.round(panelW - padX * 1.35), Math.max(28, Math.round(base * 0.04 * (theme?.titleScale || 1))));
    const heroSubSize = clampNumber(Math.round(base * 0.021 * (theme?.subtitleScale || 1)), 16, 30);
    const darkTone = overlay.tone === "dark";
    const gradientId = "commerceHeroPanel";
    const shadowId = "commerceHeroTextShadow";
    const panelColor = theme ? (darkTone ? theme.darkPanelFill : theme.panelFill) : (darkTone ? "#080808" : "#ffffff");
    const titleFill = theme ? (darkTone ? theme.darkTitleFill : theme.titleFill) : (darkTone ? "#fffaf1" : "#111111");
    const subtitleFill = theme ? (darkTone ? theme.darkSubtitleFill : theme.subtitleFill) : (darkTone ? "#e4dacb" : "#4d4942");
    const shadowColor = darkTone ? "#000000" : "#ffffff";
    const textAttrs = hasPanel
      ? ""
      : ` filter="url(#${shadowId})" paint-order="stroke" stroke="${shadowColor}" stroke-opacity="${darkTone ? "0.18" : "0.28"}" stroke-width="${Math.max(1, Math.round(base * 0.0018))}"`;
    return [
      "<defs>",
      hasPanel ? `<linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0">` : "",
      hasPanel ? `<stop offset="0%" stop-color="${panelColor}" stop-opacity="${theme ? theme.panelOpacity : (darkTone ? "0.62" : "0.58")}"/>` : "",
      hasPanel ? `<stop offset="72%" stop-color="${panelColor}" stop-opacity="${theme ? theme.panelEndOpacity : (darkTone ? "0.10" : "0.10")}"/>` : "",
      hasPanel ? `<stop offset="100%" stop-color="${panelColor}" stop-opacity="0"/>` : "",
      hasPanel ? "</linearGradient>" : "",
      !hasPanel ? `<filter id="${shadowId}" x="-20%" y="-40%" width="150%" height="190%"><feDropShadow dx="0" dy="${Math.max(1, Math.round(base * 0.003))}" stdDeviation="${Math.max(1, Math.round(base * 0.004))}" flood-color="${darkTone ? "#000000" : "#ffffff"}" flood-opacity="${darkTone ? "0.42" : "0.68"}"/></filter>` : "",
      "</defs>",
      hasPanel ? `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${Math.round(base * 0.006 * (theme?.radiusScale || 1))}" fill="url(#${gradientId})"/>` : "",
      !hasPanel ? `<line x1="${textX}" y1="${titleY - Math.round(heroTitleSize * 1.05)}" x2="${textX + Math.round(width * 0.11)}" y2="${titleY - Math.round(heroTitleSize * 1.05)}" stroke="${titleFill}" stroke-width="${Math.max(1, Math.round(base * 0.0016))}" opacity="0.55"/>` : "",
      `<text x="${textX}" y="${titleY}" fill="${titleFill}" font-size="${heroTitleSize}" font-weight="${theme?.titleWeight || 620}" letter-spacing="${theme?.letterSpacing ?? 0}" font-family="${fontFamily}"${textAttrs}>${escapeXml(title)}</text>`,
      subtitle ? `<text x="${textX}" y="${titleY + Math.round(heroTitleSize * 0.78)}" fill="${subtitleFill}" font-size="${heroSubSize}" font-weight="${theme?.bodyWeight || 430}" letter-spacing="${theme?.letterSpacing ?? 0}" font-family="${fontFamily}"${textAttrs}>${escapeXml(subtitle)}</text>` : ""
    ].filter(Boolean).join("");
  }

  if (template === "editorial-hero-title") {
    const x = Math.round(width * 0.075);
    const y = Math.round(height * 0.105);
    const heroTitleSize = clampNumber(Math.round(base * 0.032 * (theme?.titleScale || 1)), 22, 46);
    const heroSubSize = clampNumber(Math.round(base * 0.018 * (theme?.subtitleScale || 1)), 14, 26);
    const fill = theme ? (overlay.tone === "dark" ? theme.darkTitleFill : theme.titleFill) : (overlay.tone === "dark" ? "#f4f1ea" : "#171717");
    const subFill = theme ? (overlay.tone === "dark" ? theme.darkSubtitleFill : theme.subtitleFill) : (overlay.tone === "dark" ? "#d8d2c8" : "#4f4f4b");
    const stroke = theme?.lineFill || (overlay.tone === "dark" ? "#f4f1ea" : "#171717");
    return [
      `<line x1="${x}" y1="${y - Math.round(base * 0.026)}" x2="${x + Math.round(width * 0.105)}" y2="${y - Math.round(base * 0.026)}" stroke="${stroke}" stroke-width="${Math.max(1, Math.round(base * 0.0014))}" opacity="0.72"/>`,
      `<text x="${x}" y="${y}" fill="${fill}" font-size="${heroTitleSize}" font-weight="${theme?.titleWeight || 500}" letter-spacing="${theme?.letterSpacing ?? 1.5}" font-family="${serifFontFamily}">${escapeXml(title)}</text>`,
      subtitle ? `<text x="${x}" y="${y + Math.round(heroTitleSize * 1.28)}" fill="${subFill}" font-size="${heroSubSize}" font-weight="${theme?.bodyWeight || 400}" letter-spacing="${theme?.letterSpacing ?? 1.2}" font-family="${fontFamily}">${escapeXml(subtitle)}</text>` : ""
    ].filter(Boolean).join("");
  }

  if (template === "advantage-editorial") {
    const panelX = Math.round(width * 0.50);
    const panelW = width - panelX;
    const pad = Math.round(base * 0.07);
    const top = Math.round(height * 0.115);
    const gridTop = Math.round(height * 0.36);
    const gridW = panelW - pad * 2;
    const gridH = Math.round(height * 0.34);
    const titleFill = theme?.darkTitleFill || "#f4f1ea";
    const subFill = theme?.darkSubtitleFill || "#a9a29a";
    const thin = theme?.lineFill || "#d8d0c2";
    const labelSizeAdv = clampNumber(Math.round(base * 0.022 * (theme?.labelScale || 1)), 16, 30);
    const indexSize = clampNumber(Math.round(base * 0.014), 11, 18);
    const cells = labels.slice(0, 4).map((label, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = panelX + pad + col * Math.round(gridW / 2);
      const y = gridTop + row * Math.round(gridH / 2);
      const w = Math.round(gridW / 2) - Math.round(base * 0.025);
      return [
        `<text x="${x}" y="${y + Math.round(indexSize * 1.1)}" fill="${subFill}" font-size="${indexSize}" font-weight="${theme?.bodyWeight || 500}" letter-spacing="${theme?.letterSpacing ?? 1.3}" font-family="${fontFamily}">${String(index + 1).padStart(2, "0")}</text>`,
        `<line x1="${x}" y1="${y + Math.round(indexSize * 2.0)}" x2="${x + w}" y2="${y + Math.round(indexSize * 2.0)}" stroke="${thin}" stroke-width="${Math.max(1, Math.round(base * 0.001))}" opacity="0.48"/>`,
        `<text x="${x}" y="${y + Math.round(indexSize * 2.0) + Math.round(labelSizeAdv * 1.55)}" fill="${titleFill}" font-size="${labelSizeAdv}" font-weight="${theme?.labelWeight || 500}" letter-spacing="${theme?.letterSpacing ?? 1.1}" font-family="${fontFamily}">${escapeXml(label)}</text>`
      ].join("");
    }).join("");
    return [
      `<rect x="${panelX}" y="0" width="${panelW}" height="${height}" fill="${theme?.darkPanelFill || "#050505"}" opacity="${theme ? theme.cardOpacity : "0.76"}"/>`,
      `<line x1="${panelX}" y1="${Math.round(height * 0.08)}" x2="${panelX}" y2="${Math.round(height * 0.92)}" stroke="${thin}" stroke-width="${Math.max(1, Math.round(base * 0.001))}" opacity="0.32"/>`,
      `<text x="${panelX + pad}" y="${top}" fill="${titleFill}" font-size="${clampNumber(Math.round(base * 0.04 * (theme?.titleScale || 1)), 28, 52)}" font-weight="${theme?.titleWeight || 600}" letter-spacing="${theme?.letterSpacing ?? 1.4}" font-family="${fontFamily}">${escapeXml(title)}</text>`,
      subtitle ? `<text x="${panelX + pad}" y="${top + Math.round(base * 0.052)}" fill="${subFill}" font-size="${clampNumber(Math.round(base * 0.018 * (theme?.subtitleScale || 1)), 14, 24)}" font-weight="${theme?.bodyWeight || 400}" letter-spacing="${theme?.letterSpacing ?? 1.2}" font-family="${fontFamily}">${escapeXml(subtitle)}</text>` : "",
      cells
    ].filter(Boolean).join("");
  }

  if (template === "feature-cards") {
    const cardWidth = Math.round(width * 0.34);
    const cardHeight = Math.round(base * 0.062);
    const gap = Math.round(base * 0.018);
    const startX = marginX;
    const startY = Math.round(height * 0.64);
    const cards = labels.slice(0, 4).map((label, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = startX + col * (cardWidth + gap);
      const y = startY + row * (cardHeight + gap);
      return [
        `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${Math.round(base * 0.008 * (theme?.radiusScale || 1))}" fill="${panel}" stroke="${theme?.cardStroke || "#e4ddd2"}" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/>`,
        `<circle cx="${x + Math.round(cardHeight * 0.46)}" cy="${y + Math.round(cardHeight * 0.5)}" r="${Math.round(cardHeight * 0.16)}" fill="${line}" opacity="0.9"/>`,
        svgTextBlock({ lines: [label], x: x + Math.round(cardHeight * 0.82), y: y + Math.round(cardHeight * 0.57), size: labelSize, fill: dark, weight: theme?.labelWeight || 600 })
      ].join("");
    }).join("");
    return [
      `<line x1="${marginX}" y1="${marginY - Math.round(base * 0.022)}" x2="${marginX + Math.round(width * 0.14)}" y2="${marginY - Math.round(base * 0.022)}" stroke="${line}" stroke-width="${Math.max(2, Math.round(base * 0.003))}"/>`,
      svgTextBlock({ lines: overlayTextLines(title, 10), x: marginX, y: marginY + titleSize, size: titleSize, fill: dark, weight: theme?.titleWeight || 700 }),
      subtitle ? svgTextBlock({ lines: [subtitle], x: marginX, y: marginY + titleSize + Math.round(base * 0.038), size: subSize, fill: muted, weight: theme?.bodyWeight || 500 }) : "",
      cards
    ].join("");
  }

  if (template === "detail-callout") {
    const x = Math.round(width * 0.64);
    const y = Math.round(height * 0.12);
    const label = labels[0] || title;
    const label2 = labels[1] || "";
    return [
      `<line x1="${x - Math.round(width * 0.16)}" y1="${y + Math.round(base * 0.18)}" x2="${x + Math.round(width * 0.02)}" y2="${y + Math.round(base * 0.06)}" stroke="${line}" stroke-width="${Math.max(1, Math.round(base * 0.0015))}" opacity="0.8"/>`,
      `<circle cx="${x - Math.round(width * 0.16)}" cy="${y + Math.round(base * 0.18)}" r="${Math.max(3, Math.round(base * 0.004))}" fill="${line}"/>`,
      `<rect x="${x}" y="${y}" width="${Math.round(width * 0.27)}" height="${Math.round(base * 0.12)}" rx="${Math.round(base * 0.006 * (theme?.radiusScale || 1))}" fill="${panel}" stroke="${theme?.cardStroke || "#e4ddd2"}" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/>`,
      svgTextBlock({ lines: [title], x: x + Math.round(base * 0.024), y: y + Math.round(base * 0.044), size: Math.max(22, Math.round(base * 0.028 * (theme?.titleScale || 1))), fill: dark, weight: theme?.titleWeight || 700 }),
      svgTextBlock({ lines: [label, label2].filter(Boolean), x: x + Math.round(base * 0.024), y: y + Math.round(base * 0.083), size: labelSize, fill: muted, weight: theme?.bodyWeight || 500, lineGap: 1.22 })
    ].join("");
  }

  return [
    `<line x1="${marginX}" y1="${marginY - Math.round(base * 0.022)}" x2="${marginX + Math.round(width * 0.16)}" y2="${marginY - Math.round(base * 0.022)}" stroke="${line}" stroke-width="${Math.max(2, Math.round(base * 0.003))}"/>`,
    svgTextBlock({ lines: overlayTextLines(title, 10), x: marginX, y: marginY + titleSize, size: titleSize, fill: dark, weight: theme?.titleWeight || 700 }),
    subtitle ? svgTextBlock({ lines: [subtitle], x: marginX, y: marginY + titleSize + Math.round(base * 0.04), size: subSize, fill: muted, weight: theme?.bodyWeight || 500 }) : "",
    labels.slice(0, 2).map((label, index) => {
      const y = marginY + titleSize + Math.round(base * 0.082) + index * Math.round(base * 0.038);
      return [
        `<circle cx="${marginX + Math.round(base * 0.009)}" cy="${y - Math.round(labelSize * 0.28)}" r="${Math.max(3, Math.round(base * 0.004))}" fill="${line}"/>`,
        svgTextBlock({ lines: [label], x: marginX + Math.round(base * 0.026), y, size: labelSize, fill: dark, weight: theme?.labelWeight || 550 })
      ].join("");
    }).join("")
  ].join("");
}

async function applyShotTextOverlay(imageUrl = "", shot = {}, settings = {}) {
  const overlay = shot?.textOverlay;
  if (!overlay || !imageUrl || isCollageTemplateSettings(settings)) return "";
  const dimensions = imageDimensionsFromUrl(imageUrl) || collageCanvasSize(settings);
  const width = Math.max(1, Math.round(dimensions.width || 1024));
  const height = Math.max(1, Math.round(dimensions.height || 1024));
  const inlineBaseImage = await imageInlineDataFromUrlOrFetch(imageUrl).catch(() => null);
  const baseImageHref = inlineBaseImage?.data
    ? `data:${inlineBaseImage.mimeType || "image/png"};base64,${inlineBaseImage.data}`
    : imageUrl;
  const overlayNodes = shotTextOverlaySvgNodes(overlay, { width, height });
  if (!overlayNodes) return "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeXml(baseImageHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`,
    overlayNodes,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

async function persistGeneratedShotImage({ imageUrl = "", shot = {}, settings = {}, title = "generated-shot", category = "image" } = {}) {
  const persistedImageUrl = await persistGeneratedImageUrl(imageUrl, { title, category });
  const shotCategory = shot?.category || category || resolveShotTask(shot);
  const textMode = textRenderModeForShot(shot, shotCategory, settings);
  if (textMode === "model-direct") {
    return {
      imageUrl: persistedImageUrl,
      textImageUrl: persistedImageUrl,
      noTextImageUrl: "",
      overlayApplied: false,
      textMode
    };
  }
  const overlayImageUrl = textMode === "local-overlay"
    ? await applyShotTextOverlay(persistedImageUrl, shot, settings)
    : "";
  if (!overlayImageUrl) {
    return { imageUrl: persistedImageUrl, textImageUrl: "", noTextImageUrl: "", overlayApplied: false, textMode };
  }
  const textImageUrl = await persistGeneratedImageUrl(overlayImageUrl, { title, category: `${category || "image"}-text` });
  return { imageUrl: textImageUrl, textImageUrl, noTextImageUrl: persistedImageUrl, overlayApplied: true, textMode };
}

function modelDirectTextQaResult({ imageUrl = "", shot = {}, settings = {} } = {}) {
  if (MODEL_QUALITY_CHECKS_DISABLED) {
    return { status: "skip", reason: "model-quality-checks-disabled" };
  }
  const category = shot?.category || resolveShotTask(shot);
  if (textRenderModeForShot(shot, category, settings) !== "model-direct") {
    return { status: "skip", reason: "not-model-direct" };
  }
  const forcedFailure = Boolean(
    settings?.forceModelDirectTextQaFail
      || settings?.textQaForceFail
      || settings?.modelDirectTextQa === "fail"
      || shot?.forceTextQaFail
      || shot?.promptRoute?.forceTextQaFail
  );
  if (forcedFailure) return { status: "fail", reason: "forced-model-direct-text-qa" };
  return { status: imageUrl ? "pass" : "skip", reason: imageUrl ? "lightweight-pass" : "missing-image" };
}

function localOverlayFallbackShot(shot = {}, profile = {}, settings = {}) {
  const category = shot?.category || resolveShotTask(shot);
  const fallbackShot = {
    ...shot,
    textRenderMode: "local-overlay"
  };
  const fallbackPrompt = generationPromptForShotPrompt(fallbackShot.prompt || shot.prompt || "", {
    profile,
    category,
    settings,
    shot: fallbackShot
  });
  return {
    ...fallbackShot,
    generationPrompt: /底图不要生成任何可见文字|后置简体中文排版/.test(fallbackPrompt)
      ? fallbackPrompt
      : joinPromptBlocksUnique([fallbackPrompt, localTextOverlayBasePrompt()])
  };
}

function uploadedFileDataUrl(file = {}) {
  const mimeType = file.mimetype || "image/png";
  return `data:${mimeType};base64,${file.buffer.toString("base64")}`;
}

async function normalizeImageHref(imageUrl = "") {
  const inline = await imageInlineDataFromUrlOrFetch(imageUrl);
  if (!inline) return imageUrl;
  return `data:${inline.mimeType || "image/png"};base64,${inline.data}`;
}

function cleanCollageProductPrompt(file = {}, index = 0, settings = {}) {
  const userPrompt = String(settings.collageUserPrompt || settings.userPrompt || "").trim();
  const hasBackgroundOverride = collageHasExplicitBackgroundPrompt(userPrompt);
  const backgroundFill = collageRequestedBackgroundFill(settings);
  const backgroundLine = hasBackgroundOverride
    ? `Put the extracted lamp on the user-requested background direction where it applies. The compositor background fill will be ${backgroundFill}; keep the model output full-bleed, perfectly uniform, and continuous edge to edge so every product can blend into one final sheet.`
    : `Put the extracted lamp on a full-bleed, perfectly uniform matte warm light-gray background ${COLLAGE_BACKGROUND_SPEC}. The background color must match exactly edge to edge so it blends seamlessly when composed into the final sheet.`;
  return [
    "Turn this uploaded lamp image into one commercial-ready product cut-out for a square collage.",
    "Use the uploaded image as the exact product identity. Preserve only the visible lamp outline, material, color, emitting surface, mounting structure, proportions, transparency, metal/glass/acrylic texture, and visible joints from that uploaded product.",
    "Remove the original snapshot or edited-photo background completely. Do not paste the full source photo. Extract only the lamp/product subject and clean its edges.",
    "Make the product look refined and commercial: clean lighting, natural edges, balanced contrast, soft realistic shadow, no harsh crop, and the complete product visible.",
    backgroundLine,
    "Do not redesign the lamp, invent parts, simplify the structure, change the model, or merge it with another product.",
    "Do not create a room scene, poster, panel, square card, border, grid, label, caption, logo, watermark, callout, arrow, price, icon, or any text.",
    "Do not leave a visible rectangular image boundary, source-photo residue, wall/ceiling texture, local gradient, or dirty background patch. The output must look like a clean product cut-out floating on the same continuous background, not a photo tile.",
    "Keep the product complete and centered with breathing room.",
    "The app may add labels later. Do not draw any label text, label holder, rounded rectangle, pill, shadow box, empty bar, badge, frame, or placeholder.",
    "Return one clean product image only."
  ].join("\n");
}

async function generateCleanCollageProductImages({
  db,
  files = [],
  settings = {},
  modelOption,
  geminiKey,
  geminiBaseUrl,
  geminiProviderName,
  geminiUseBearerAuth,
  openAICompatibleKey,
  openAICompatibleBaseUrl,
  openAICompatibleName
}) {
  const results = new Array(files.length);
  const providerName = modelOption.provider === "gemini" ? geminiProviderName : openAICompatibleName;
  const baseConcurrency = generationConcurrency(settings, providerName);
  const cappedConcurrency = isYunwuProviderName(providerName)
    ? Math.min(baseConcurrency, yunwuGenerationMaxConcurrency())
    : baseConcurrency;
  const concurrency = Math.max(1, Math.min(cappedConcurrency, files.length));
  const maxAttempts = Math.max(1, Math.min(2, Number(settings.collageCleanupMaxAttempts || 2) || 2));
  await runWithConcurrency(files, concurrency, async (file, index) => {
    const dimensions = imageDimensions(file) || { width: 1, height: 1 };
    const cacheKey = collageCleanProductCacheKey({ file, settings, modelOption });
    const cached = readCollageCleanProductCache(cacheKey);
    if (cached) {
      results[index] = {
        ...cached,
        originalName: file.originalname || `product-${index + 1}`,
        cacheHit: true
      };
      return;
    }
    try {
      let cleaned = collageCleanProductInFlight.get(cacheKey);
      if (!cleaned) {
        cleaned = (async () => {
          let cleanedUrl = "";
          let lastError = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
              cleanedUrl = await generateImageForShot({
                prompt: cleanCollageProductPrompt(file, index, settings),
                files: [{ ...file, inputRole: "primary-product", inputIndex: 1 }],
                modelOption,
                ratio: "1:1",
                clarity: settings.collageCleanupClarity || "1k",
                geminiKey,
                geminiBaseUrl,
                geminiProviderName,
                geminiUseBearerAuth,
                openAICompatibleKey,
                openAICompatibleBaseUrl,
                openAICompatibleName,
                settings: {
                  ...settings,
                  template: "",
                  styleCloneMode: false,
                  similarMode: "none"
                },
                generationContext: { db }
              });
              break;
            } catch (error) {
              lastError = error;
              if (!isTransientGenerationError(error) || attempt >= maxAttempts) break;
              await delay(900 * attempt);
            }
          }
          if (!cleanedUrl) throw lastError || new Error("model cleanup unavailable");
          const value = {
            imageUrl: await normalizeImageHref(cleanedUrl),
            dimensions
          };
          writeCollageCleanProductCache(cacheKey, value);
          return value;
        })();
        collageCleanProductInFlight.set(cacheKey, cleaned);
        try {
          await cleaned;
        } finally {
          collageCleanProductInFlight.delete(cacheKey);
        }
      }
      const value = await cleaned;
      results[index] = {
        ...value,
        source: "model-clean",
        originalName: file.originalname || `product-${index + 1}`,
        cacheHit: false
      };
    } catch (error) {
      throw new Error(
        `Collage product cleanup failed for image ${index + 1}: ${
          error instanceof Error ? error.message : "model cleanup unavailable"
        }`
      );
    }
  });
  return results.filter(Boolean);
}

function collageCatalogSlots(count = 0) {
  const normalized = Math.max(1, Math.min(6, Number(count) || 1));
  const layouts = {
    1: [{ x: 120, y: 70, w: 784, h: 700, labelY: 850 }],
    2: [
      { x: 34, y: 78, w: 452, h: 590, labelY: 760 },
      { x: 538, y: 78, w: 452, h: 590, labelY: 760 }
    ],
    3: [
      { x: 28, y: 54, w: 452, h: 388, labelY: 500 },
      { x: 544, y: 54, w: 452, h: 388, labelY: 500 },
      { x: 286, y: 560, w: 452, h: 330, labelY: 930 }
    ],
    4: [
      { x: 28, y: 46, w: 452, h: 350, labelY: 452 },
      { x: 544, y: 46, w: 452, h: 350, labelY: 452 },
      { x: 28, y: 555, w: 452, h: 295, labelY: 910 },
      { x: 544, y: 555, w: 452, h: 295, labelY: 910 }
    ],
    5: [
      { x: 16, y: 32, w: 512, h: 318, labelY: 430 },
      { x: 558, y: 40, w: 450, h: 300, labelY: 430 },
      { x: 20, y: 548, w: 304, h: 258, labelY: 890 },
      { x: 360, y: 548, w: 304, h: 258, labelY: 890 },
      { x: 700, y: 548, w: 304, h: 258, labelY: 890 }
    ],
    6: [
      { x: 24, y: 52, w: 306, h: 290, labelY: 420 },
      { x: 359, y: 52, w: 306, h: 290, labelY: 420 },
      { x: 694, y: 52, w: 306, h: 290, labelY: 420 },
      { x: 24, y: 560, w: 306, h: 250, labelY: 890 },
      { x: 359, y: 560, w: 306, h: 250, labelY: 890 },
      { x: 694, y: 560, w: 306, h: 250, labelY: 890 }
    ]
  };
  return layouts[normalized] || layouts[5];
}

function fitRect(slot = {}, dimensions = {}) {
  const imageRatio = Number(dimensions.width || 1) / Math.max(1, Number(dimensions.height || 1));
  const slotRatio = Number(slot.w || 1) / Math.max(1, Number(slot.h || 1));
  let width = slot.w;
  let height = slot.h;
  if (imageRatio > slotRatio) {
    height = width / imageRatio;
  } else {
    width = height * imageRatio;
  }
  return {
    x: Math.round(slot.x + (slot.w - width) / 2),
    y: Math.round(slot.y + (slot.h - height) / 2),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function labelSvgNode({ text = "", cx = 0, cy = 0, base = 1024 }) {
  const value = String(text || "").trim();
  if (!value) return "";
  const fontSize = Math.max(14, Math.round(base * 0.021));
  const pillHeight = Math.round(fontSize * 1.38);
  const pillRadius = Math.round(pillHeight / 2);
  const pillWidth = Math.max(Math.round(fontSize * 2.15), Math.min(Math.round(base * 0.17), Math.round(value.length * fontSize * 0.94 + fontSize * 1.16)));
  const x = Math.round(cx - pillWidth / 2);
  const y = Math.round(cy - pillHeight / 2);
  return [
    `<g class="collage-label" aria-label="${escapeXml(value)}">`,
    `<rect x="${x}" y="${y}" width="${pillWidth}" height="${pillHeight}" rx="${pillRadius}" fill="#6a6a64" opacity="0.82" stroke="#f4f2eb" stroke-opacity="0.18" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/>`,
    `<text x="${Math.round(cx)}" y="${Math.round(cy)}" text-anchor="middle" dominant-baseline="central" fill="#fffaf0" font-size="${fontSize}" font-weight="600" font-family="Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">${escapeXml(value)}</text>`,
    "</g>"
  ].join("");
}

function composeCollageCatalogImage({ products = [], settings = {}, includeLabels = true } = {}) {
  const { width, height } = collageCanvasSize(settings);
  const scaleX = width / 1024;
  const scaleY = height / 1024;
  const labels = includeLabels ? collageVisibleLabels(settings) : [];
  const slots = collageCatalogSlots(products.length);
  const base = Math.min(width, height);
  const backgroundFill = collageRequestedBackgroundFill(settings);
  const imageNodes = products
    .map((product, index) => {
      const rawSlot = slots[index] || slots[slots.length - 1];
      const slot = {
        x: rawSlot.x * scaleX,
        y: rawSlot.y * scaleY,
        w: rawSlot.w * scaleX,
        h: rawSlot.h * scaleY,
        labelY: rawSlot.labelY * scaleY
      };
      const rect = fitRect(slot, product.dimensions);
      return [
        `<image href="${escapeXml(product.imageUrl)}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" preserveAspectRatio="xMidYMid meet"/>`
      ].join("");
    })
    .join("");
  const labelNodes = labels
    .map((label) => {
      const index = Math.max(0, Math.min(slots.length - 1, Number(label.index || 1) - 1));
      const slot = slots[index] || slots[0];
      return labelSvgNode({
        text: label.name,
        cx: (slot.x + slot.w / 2) * scaleX,
        cy: slot.labelY * scaleY,
        base
      });
    })
    .join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${escapeXml(backgroundFill)}"/>`,
    imageNodes,
    labelNodes,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

async function generateCatalogCollageImage({
  db,
  files = [],
  settings = {},
  modelOption,
  geminiKey,
  geminiBaseUrl,
  geminiProviderName,
  geminiUseBearerAuth,
  openAICompatibleKey,
  openAICompatibleBaseUrl,
  openAICompatibleName
}) {
  const products = await generateCleanCollageProductImages({
    files,
    settings: { ...settings, collageSourceCount: files.length },
    db,
    modelOption,
    geminiKey,
    geminiBaseUrl,
    geminiProviderName,
    geminiUseBearerAuth,
    openAICompatibleKey,
    openAICompatibleBaseUrl,
    openAICompatibleName
  });
  const composeSettings = { ...settings, collageSourceCount: files.length };
  const noTextImageUrl = composeCollageCatalogImage({
    products,
    settings: composeSettings,
    includeLabels: false
  });
  const textImageUrl = collageVisibleLabels(composeSettings).length
    ? composeCollageCatalogImage({
        products,
        settings: composeSettings,
        includeLabels: true
      })
    : noTextImageUrl;
  return {
    imageUrl: textImageUrl,
    textImageUrl,
    noTextImageUrl,
    collagePipelineUsed: "clean-then-compose"
  };
}

function directCollagePrompt(prompt = "", settings = {}, { sourceCount = 0 } = {}) {
  const labels = collageVisibleLabels(settings);
  const count = Math.max(2, Math.min(6, Number(sourceCount || settings?.collageSourceCount || 0) || 2));
  const backgroundSpec = collageBackgroundSpec(settings);
  const modelRenderedLabels = shouldRenderCollageLabelsWithModel(settings);
  return [
    `生成 ${count} 个上传灯具的产品集合拼图，按上传顺序排版在统一背景上。`,
    `默认背景：${backgroundSpec}。`,
    labels.length
      ? modelRenderedLabels
        ? `需要模型生成 ${labels.length} 个小标签，标签文字按用户填写名称。`
        : "标签由应用后置叠加，生图底图保持无文字。"
      : "无需标签，画面无文字。",
    sanitizeCollagePromptText(prompt) ? `用户补充要求：${sanitizeCollagePromptText(prompt)}` : ""
  ].filter(Boolean).join("\n");
}

function promptBlockSignature(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function joinPromptBlocksUnique(blocks = [], separator = "\n\n") {
  const seen = new Set();
  return blocks
    .map((block) => String(block || "").trim())
    .filter((block) => {
      if (!block) return false;
      const signature = promptBlockSignature(block);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .join(separator);
}

function splitPromptSentences(block = "") {
  const text = String(block || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  return text
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      if (/^(?:整体主题|套图视觉系统|套图叙事线|本张任务|画面提示|文字内容|特殊要求|产品身份|硬性保真|识别视觉作为产品事实补充|页面设计方向|主体规则)[：:]/.test(trimmed)) {
        return [trimmed];
      }
      return trimmed
        .split(/(?<=[。！？!?；;])\s*/)
        .map((item) => item.trim())
        .filter(Boolean);
    });
}

function promptSentenceSignature(value = "") {
  return String(value || "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, "")
    .replace(/[。！？!?；;，,：:、.]+$/g, "")
    .trim();
}

function promptSentenceGroup(value = "") {
  const text = String(value || "");
  if (text.includes(CHINA_MARKET_TEXT_LOCK) || /中国市场输出|只能使用简体中文|不得出现繁体字/.test(text)) return "text-policy-chinese";
  if (text.includes(NO_VISIBLE_TEXT_LOCK) || promptHasNoTextDirective(text) || /不需要可见文字|画面不出现任何可见文字|底图不要生成任何可见文字|底图无可见文字|不要生成中英文标题/.test(text)) return "text-policy-none";
  if (text.includes(SINGLE_SCENE_IMAGE_LOCK) || /完整连续.*真实空间|不要拼图、四宫格|场景图必须是一张/.test(text)) return "scene-single";
  if (/没有明确识别到的品牌、芯片、功率|可写入的已确认参数/.test(text)) return "spec-evidence";
  if (/图片类型锁定|本张是「.*」任务/.test(text)) return "category-lock";
  if (/Variation seed:/.test(text)) return "variation-seed";
  if (/大灯独立通道/.test(text)) return "large-lamp-channel";
  if (/壁灯独立通道|壁装通道|墙面底座|墙装比例/.test(text)) return "wall-lamp-channel";
  if (/小灯独立通道|小灯通道|灯具生成通道/.test(text)) return "small-lamp-channel";
  if (/产品身份：|以产品图为唯一灯具主体|产品一致性/.test(text)) return "product-identity";
  return "";
}

function detectPromptConflicts(prompt = "", { category = "", allowText = true } = {}) {
  const text = String(prompt || "");
  const warnings = [];
  const hasNoText = text.includes(NO_VISIBLE_TEXT_LOCK) || promptHasNoTextDirective(text) || /画面不出现任何可见文字|底图不要生成任何可见文字|底图无可见文字|无文字|不要生成.*标题|不要生成.*标签/.test(text);
  const hasPlannedText = /文字由生图模型直接绘制|文字内容：(?!无)|主标题：|副标题：|标签：|标题：|标注：|(?:允许|加入|添加|绘制|保留|使用)[^。；;\n]{0,16}可见文字/.test(text);
  if ((hasNoText && hasPlannedText) || (!allowText && hasPlannedText)) warnings.push("text-policy-conflict");
  const value = String(category || "").toLowerCase();
  if (value === "scene" && /信息图|功能图文|参数表|拼版|四宫格|卡片合集/.test(text)) warnings.push("scene-vs-infographic-conflict");
  const mountPolicyText = text.replace(/(?:绝对禁止|禁止|不得|不要|不能|没有|无|未见|不出现|不生成|不开孔|不齐平|不只露)[^。；;\n]*(?:明装|贴顶|嵌入|开孔|面环|轨道|导轨|磁吸|壁装|墙面安装)[^。；;\n]*/g, "");
  const mountMatches = [
    /明装|贴顶/.test(mountPolicyText) ? "surface" : "",
    /嵌入|开孔|面环贴合/.test(mountPolicyText) ? "recessed" : "",
    /轨道|导轨|磁吸/.test(mountPolicyText) ? "track" : "",
    /壁装|墙面安装/.test(mountPolicyText) ? "wall" : ""
  ].filter(Boolean);
  const largeLampPolicy = /\u5927\u706f\u72ec\u7acb\u901a\u9053|\u5b8c\u6574\u4e3b\u706f|\u4e00\u76cf\/\u4e00\u5957\u5927\u706f/.test(text);
  if (!largeLampPolicy && new Set(mountMatches).size > 1 && /结构锁|安装族|安装结构|必须|禁止|硬性/.test(mountPolicyText)) warnings.push("mount-family-mixed");
  return warnings.filter((item, index, list) => list.indexOf(item) === index);
}

function resolvePromptConflicts(sentences = [], conflictWarnings = [], { allowText = true, category = "" } = {}) {
  let result = sentences.slice();
  if (conflictWarnings.includes("text-policy-conflict")) {
    if (!allowText) {
      result = result.filter((sentence) => !/文字由生图模型直接绘制|文字内容：(?!无)|主标题：|副标题：|标签：|标题：|标注：|可见文字/.test(sentence));
    } else {
      result = result.filter((sentence) => !/本图不需要可见文字|画面不出现任何可见文字|不要生成中英文标题/.test(sentence));
    }
  }
  if (String(category || "").toLowerCase() === "scene" && conflictWarnings.includes("scene-vs-infographic-conflict")) {
    result = result.filter((sentence) => !/信息图版式|功能图文版式|参数表|四宫格|多宫格|卡片合集/.test(sentence));
  }
  return result;
}

function compactGenerationPrompt(prompt = "", { shot = {}, settings = {}, profile = {}, templateReferenceCount = 0 } = {}) {
  const category = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask({ ...shot, prompt });
  const promptText = [prompt, shot.prompt].filter(Boolean).join("\n");
  const textMode = textRenderModeForShot(shot, category, settings);
  const localOverlay = textMode === "local-overlay";
  const modelDirectText = textMode === "model-direct";
  const allowText = modelDirectText || (!localOverlay
    && (isProductWorkspaceSettings(settings) || !shot?.textOverlay)
    && (productPromptAllowsText(category) || smallLampHeroTextAllowed(shot, category) || largeLampHeroTextAllowed(shot, category) || wallLampHeroTextAllowed(shot, category))
    && !visiblePromptRequestsNoText(promptText, category)
    && !promptHasNoTextDirective(promptText));
  const sentences = splitPromptSentences(prompt);
  const seen = new Set();
  const seenGroups = new Set();
  const dedupedBlocks = [];
  const compacted = [];
  for (const sentence of sentences) {
    const signature = promptSentenceSignature(sentence);
    const group = promptSentenceGroup(sentence);
    if (!signature) continue;
    if (seen.has(signature)) {
      dedupedBlocks.push(signature.slice(0, 80));
      continue;
    }
    if (group && seenGroups.has(group)) {
      dedupedBlocks.push(group);
      continue;
    }
    seen.add(signature);
    if (group) seenGroups.add(group);
    compacted.push(sentence);
  }
  const initialPrompt = compacted.join("\n");
  const conflictWarnings = detectPromptConflicts(initialPrompt, { category, allowText });
  const resolved = resolvePromptConflicts(compacted, conflictWarnings, { category, allowText });
  const finalPrompt = resolved.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    prompt: finalPrompt,
    meta: {
      originalPromptChars: String(prompt || "").length,
      finalPromptChars: finalPrompt.length,
      originalPromptLines: String(prompt || "").split(/\n+/).filter((line) => line.trim()).length,
      finalPromptLines: finalPrompt.split(/\n+/).filter((line) => line.trim()).length,
      dedupedBlocks: dedupedBlocks.filter((item, index, list) => list.indexOf(item) === index).slice(0, 24),
      conflictWarnings,
      category,
      allowText,
      textMode,
      templateReferenceCount,
      smallLamp: isSmallLampGeneration(profile, settings) && !isCollageTemplateSettings(settings)
    }
  };
}

function shotVariationSeedPrompt(category = "", variationIndex = 1) {
  const index = Math.max(1, Number(variationIndex || 1));
  const value = String(category || "").toLowerCase();
  const focus = {
    main: "use a distinct camera angle, crop distance, or background spacing",
    selling: "use a distinct single selling point and copy/layout rhythm",
    function: "use a distinct function layout, callout placement, or feature emphasis",
    scene: "use a distinct room layout, camera angle, lighting direction, or installation position",
    detail: "use a distinct close-up area, material detail, or annotation placement",
    real: "use a distinct realistic shooting angle, surface, or ambient light"
  };
  return `Variation seed: this is ${categoryLabel(value)} image ${index}; ${focus[value] || "make the composition visibly different from sibling images"} while preserving the same uploaded lamp identity.`;
}

function collageModelRenderedLabelPrompt(settings = {}) {
  const labels = collageVisibleLabels(settings);
  if (!shouldRenderCollageLabelsWithModel(settings) || !labels.length) return "";
  const labelMap = labels.map((item) => `input image ${item.index}: "${item.name}"`).join("; ");
  return [
    "COLLAGE MODEL LABELS:",
    `Draw exactly ${labels.length} tiny refined translucent warm-gray frosted capsule labels, one for each matching product: ${labelMap}.`,
    "Labels sit on the natural warm-gray margin below each product, without covering lamp parts, shadows, or glow.",
    "Copy label text exactly; do not add any other text."
  ].join("\n");
}

function collageNoTextPrompt(settings = {}) {
  const labels = collageVisibleLabels(settings);
  if (shouldRenderCollageLabelsWithModel(settings) && labels.length) return "";
  return labels.length
    ? "Do not draw text or label containers; the app overlays labels later."
    : "Do not draw any text, numbers, labels, captions, logos, watermarks, UI marks, or random glyphs.";
}

function collageDirectHardLockPrompt(settings = {}) {
  const count = Math.max(2, Math.min(6, Number(settings?.collageSourceCount || 0) || 2));
  const backgroundSpec = collageBackgroundSpec(settings);
  return [
    "SINGLE-CALL COLLAGE HARD LOCK:",
    `Exactly ${count} uploaded lamp product subjects must appear once, one from each input image.`,
    collageDirectPlacementPrompt(count),
    collageNaturalMarginPrompt(count, { modelRenderedLabels: shouldRenderCollageLabelsWithModel(settings) }),
    `Use one flat solid warm light-gray background: ${backgroundSpec}.`,
    "Cut out only each lamp product; remove original photo backgrounds.",
    "Keep products independent and faithful: silhouette, material, color, emitting surface, mounting parts, proportions, and visible joints.",
    "No room scene, lifestyle background, photo tiles, cards, panels, borders, grid cells, seams, dividers, extra props, icons, arrows, prices, or decorative typography.",
    collageNoTextPrompt(settings),
    collageModelRenderedLabelPrompt(settings)
  ].filter(Boolean).join("\n");
}

async function analyzeCollageLabelPositionsWithGeminiVision({
  collageImageUrl = "",
  sourceFiles = [],
  settings = {},
  model = "gemini-2.5-flash",
  apiKey = "",
  baseUrl = "",
  providerName = "Gemini",
  useBearerAuth = false
}) {
  const labels = collageVisibleLabels(settings);
  if (!apiKey || !collageImageUrl || !labels.length) return [];
  const collageInline = await imageInlineDataFromUrlOrFetch(collageImageUrl);
  if (!collageInline?.data) return [];
  const prompt = [
    "You are a visual layout detector for a lamp product collage.",
    "Image 1 is the generated no-text collage. The following images are the original source products in upload order.",
    "Match each source product to its visible product in Image 1, then propose a safe label position for the app to overlay one dark gray rounded pill label.",
    "Return normalized coordinates from 0 to 1 relative to Image 1.",
    "For each label, bbox must tightly cover the matched visible product in Image 1. labelCenter should be centered below that product, or just above it only if there is no safe space below.",
    "The labelCenter must avoid covering the main product body and must stay inside the canvas.",
    "If a product cannot be confidently matched, still return the best visual reading-order guess with confidence below 0.45.",
    `Required source indexes: ${labels.map((item) => item.index).join(", ")}. Use only these indexes; do not create image text or label text.`,
    'Return JSON only: {"labels":[{"index":1,"bbox":{"x":0.1,"y":0.1,"width":0.2,"height":0.3},"labelCenter":{"x":0.2,"y":0.45},"confidence":0.9}]}'
  ].join("\n");
  const parts = [
    { text: prompt },
    { text: "Image 1 - final no-text collage to label:" },
    { inlineData: collageInline },
    ...sourceFiles.slice(0, labels.length).flatMap((file, index) => [
      { text: `Source product image ${index + 1}:` },
      {
        inlineData: {
          mimeType: file.mimetype || "image/png",
          data: file.buffer.toString("base64")
        }
      }
    ])
  ];
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} collage label detection failed: HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = parseJsonFromText(text);
  const items = Array.isArray(parsed?.labels) ? parsed.labels : Array.isArray(parsed) ? parsed : [];
  const dimensions = imageDimensionsFromUrl(collageImageUrl) || collageCanvasSize(settings);
  return normalizeCollageLabelPositions(items, labels, dimensions);
}

async function generateDirectCollageImage({
  db,
  files = [],
  generationFiles = [],
  settings = {},
  shot = {},
  modelOption,
  geminiKey,
  geminiBaseUrl,
  geminiProviderName,
  geminiUseBearerAuth,
  openAICompatibleKey,
  openAICompatibleBaseUrl,
  openAICompatibleName,
  profile = {}
}) {
  const sourceCount = files.length || generationFiles.filter((file) => file.inputRole === "primary-product" || file.inputRole === "product-source").length;
  const collageSettings = { ...settings, collageSourceCount: sourceCount };
  const basePrompt = directCollagePrompt(settings.collageUserPrompt || settings.userPrompt || "", collageSettings, { sourceCount });
  const prompt = hiddenGenerationPrompt(basePrompt, {
    shot,
    templateReferenceCount: 0,
    settings: collageSettings,
    modelOption,
    profile
  });
  const modelRenderedLabels = shouldRenderCollageLabelsWithModel(collageSettings);
  const generatedCollageImageUrl = await generateImageForShot({
    prompt,
    files: generationFiles.slice(0, 6),
    modelOption,
    ratio: shot.ratio || settings.ratio,
    clarity: settings.clarity,
    geminiKey,
    geminiBaseUrl,
    geminiProviderName,
    geminiUseBearerAuth,
    openAICompatibleKey,
    openAICompatibleBaseUrl,
    openAICompatibleName,
    settings: collageSettings,
    generationContext: { db }
  });
  const generatedImageUrl = await persistGeneratedImageUrl(generatedCollageImageUrl, {
    title: shot.title || (modelRenderedLabels ? "collage-with-labels" : "collage-no-text"),
    category: modelRenderedLabels ? "collage-labels" : "collage-no-text"
  });
  if (modelRenderedLabels) {
    return {
      imageUrl: generatedImageUrl,
      textImageUrl: generatedImageUrl,
      noTextImageUrl: "",
      collagePipelineUsed: "single-call-retouch-compose",
      collageLabelRenderingUsed: "model"
    };
  }
  let labelPositions = [];
  if (collageVisibleLabels(collageSettings).length && shouldAnalyzeCollageLabelPositions(collageSettings)) {
    try {
      const labelModel = modelOption.provider === "gemini" ? modelOption.apiModel : "gemini-2.5-flash";
      labelPositions = db
        ? await runWithModelChannelRetry(db, {
            purpose: "analysis",
            modelId: labelModel,
            providerKind: "gemini",
            modelOption: { id: labelModel, apiModel: labelModel, provider: "gemini" }
          }, async (channel) => {
            const resolved = modelChannelGemini(channel);
            return analyzeCollageLabelPositionsWithGeminiVision({
              collageImageUrl: generatedImageUrl,
              sourceFiles: files.slice(0, 8),
              settings: collageSettings,
              model: labelModel,
              apiKey: resolved.apiKey,
              baseUrl: resolved.baseUrl,
              providerName: resolved.providerName,
              useBearerAuth: resolved.useBearerAuth
            });
          })
        : await analyzeCollageLabelPositionsWithGeminiVision({
            collageImageUrl: generatedImageUrl,
            sourceFiles: files.slice(0, 8),
            settings: collageSettings,
            model: labelModel,
            apiKey: geminiKey,
            baseUrl: geminiBaseUrl,
            providerName: geminiProviderName,
            useBearerAuth: geminiUseBearerAuth
          });
    } catch (error) {
      console.warn("[collage-labels] position analysis failed; using fallback slots:", error instanceof Error ? error.message : error);
    }
  }
  const textImageUrl = collageVisibleLabels(collageSettings).length
    ? await persistGeneratedImageUrl(await applyCollageLabelOverlay(generatedImageUrl, collageSettings, labelPositions), {
        title: shot.title || "collage-with-labels",
        category: "collage-labels"
      })
    : generatedImageUrl;
  return {
    imageUrl: textImageUrl,
    textImageUrl,
    noTextImageUrl: generatedImageUrl,
    collagePipelineUsed: "single-call-retouch-compose"
  };
}

function productWorkspaceGenerationGuard(prompt = "", { shot = {}, settings = {}, profile = {} } = {}) {
  const category = resolveShotTask({ ...shot, prompt });
  const textMode = textRenderModeForShot(shot, category, settings);
  const textRule = textMode === "model-direct" || productPromptAllowsText(category)
    ? "文字守门：只使用规划好的简体中文短文案，不新增品牌、价格、水印、英文或乱码。"
    : "文字守门：不要生成文字、标志、水印、价格或随机符号。";
  const skipSmallLampDetailSpatialRule = isSmallLampProfile(profile, settings) && smallLampIsDetailStrategyShot(shot);
  const spatialRule = !skipSmallLampDetailSpatialRule && shotRequiresNonCloseupSpatialLens(shot, category)
    ? nonCloseupSpatialExecutionGuard(profile, settings)
    : "";
  return joinPromptBlocksUnique([
    String(prompt || "").trim(),
    spatialRule,
    "主体守门：保持上传灯具的类型、轮廓、材质、颜色、比例、发光面和可见安装结构。",
    textRule
  ]);
}

function hiddenGenerationPrompt(prompt, { shot = {}, templateReferenceCount = 0, settings = {}, modelOption = {}, profile = {} } = {}) {
  const category = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask({ ...shot, prompt });
  const categoryGuard = categoryBoundaryPrompt(category);
  const categoryLine = selectedLampCategoryPrompt(settings);
  const categoryExecution = selectedLampCategoryExecutionPrompt(settings);
  const isStyleClone = Boolean(settings?.styleCloneMode && templateReferenceCount > 0);
  const isStyleSimilar = isStyleSimilarSettings(settings);
  const isDirectSubjectSwap = isStyleClone && (!settings.similarMode || settings.similarMode === "none");
  const isProductWorkspace = isProductWorkspaceSettings(settings);
  const isCollageTemplate = isCollageTemplateSettings(settings);
  if (isProductWorkspace && !isCollageTemplate && !isStyleClone && !isStyleSimilar) {
    return productWorkspaceGenerationGuard(prompt, { shot, settings, profile });
  }
  const smallLampRule = !isCollageTemplate && isSmallLampGeneration(profile, settings)
    ? smallLampHiddenPrompt(prompt, { shot, category, templateReferenceCount, settings, profile })
    : "";
  if (smallLampRule) {
    return smallLampRule;
  }
  const largeLampRule = !isCollageTemplate && !isStyleClone && isProductWorkspace && isLargeLampProfile(profile, settings) && !isSmallLampProfile(profile, settings)
    ? largeLampHiddenPrompt(prompt, { shot, category, settings, profile })
    : "";
  if (largeLampRule) {
    return largeLampRule;
  }
  const wallLampRule = !isCollageTemplate && !isStyleClone && isProductWorkspace && isWallLampProfile(profile, settings) && !isSmallLampProfile(profile, settings) && !isLargeLampProfile(profile, settings)
    ? wallLampHiddenPrompt(prompt, { shot, category, settings, profile })
    : "";
  if (wallLampRule) {
    return wallLampRule;
  }
  if (isDirectSubjectSwap) {
    return directSwapGenerationPrompt(shot, "", settings, profile);
  }
  const referenceRule =
    isCollageTemplate
      ? ""
      : isStyleSimilar
      ? ""
      : isStyleClone
      ? ""
      : templateReferenceCount > 0
      ? ""
      : "";
  const nanoBananaRule = /nano[-_\s]?banana/i.test(`${modelOption.id || ""} ${modelOption.apiModel || ""} ${modelOption.label || ""}`)
    ? isCollageTemplate
      ? ""
      : isStyleSimilar
        ? ""
        : ""
    : "";
  const selectedCategoryStructureLock = hasForcedLampCategory(settings)
    ? `Selected lamp category: ${selectedLampCategoryLabel(settings)}. Preserve the matching installation structure and product category.`
    : "";
  const styleSimilarRule = styleSimilarHiddenPrompt(settings, shot, profile);
  const collageRule = collageGenerationHiddenPrompt(settings);
  const productWorkspaceRule = isProductWorkspace ? productStrategyPrompt(settings, profile) : "";
  const suiteStoryboardRule = suiteStoryboardHiddenPrompt(shot);
  const categoryRule = isCollageTemplate ? "" : categoryLine;
  const categoryExecutionRule = isCollageTemplate || isProductWorkspace ? "" : categoryExecution;
  const variationRule = shotVariationSeedPrompt(category, shotVariationIndex(shot, 0));
  const productConsistencyRule =
    isProductWorkspace
      ? productWorkspaceConsistencyPrompt(category, profile, settings, { skipTextPolicy: Boolean(categoryRule) })
      : isCollageTemplate
        ? ""
        : isStyleSimilar
        ? ""
        : productConsistencyLockPrompt(profile, settings);
  const installationRule = isCollageTemplate || isProductWorkspace
    ? ""
    : isStyleSimilar
      ? ""
      : installationPhysicsPromptForProfile(profile, settings);
  const lightingRule = isCollageTemplate || isStyleSimilar || isProductWorkspace ? "" : LIGHTING_PHYSICS_PROMPT;
  const categoryBoundaryRule = isCollageTemplate ? "" : categoryGuard;
  const hidden = joinPromptBlocksUnique([
    "",
    categoryRule,
    variationRule,
    categoryExecutionRule,
    selectedCategoryStructureLock,
    referenceRule,
    productWorkspaceRule,
    suiteStoryboardRule,
    styleSimilarRule,
    collageRule,
    productConsistencyRule,
    installationRule,
    lightingRule,
    categoryBoundaryRule,
    nanoBananaRule,
    ""
  ]);
  return joinPromptBlocksUnique([String(prompt || "").trim(), hidden]);
}

function generationPromptTextMode(prompt = "", shot = {}) {
  const text = String(prompt || "");
  if (shot?.textRenderMode === "model-direct") return "model-direct";
  if (shot?.textRenderMode === "local-overlay") return "local-overlay";
  if (/模型直接排版|文字由生图模型直接绘制/.test(text)) return "model-direct";
  if (text.includes("\u6a21\u578b\u76f4\u63a5\u751f\u6210\u89c4\u5212\u597d\u7684\u7b80\u4f53\u4e2d\u6587")) return "model-direct";
  if (shot?.textOverlay && /后置简体中文排版|底图不要生成任何可见文字/.test(text)) return "local-overlay";
  return "no-text";
}

function generationPromptDebug(prompt = "", { shot = {}, templateReferenceCount = 0, settings = {}, profile = {} } = {}, compactMeta = {}) {
  const category = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask({ ...shot, prompt });
  const route = shot?.promptRoute || {};
  const textMode = generationPromptTextMode(prompt, shot);
  const noTextRequested = (Boolean(shot?.textOverlay) && !isProductWorkspaceSettings(settings)) || (
    textMode !== "model-direct"
    &&
    !smallLampHeroTextAllowed(shot, category)
    && !largeLampHeroTextAllowed(shot, category)
    && !wallLampHeroTextAllowed(shot, category)
    && visiblePromptRequestsNoText([prompt, shot.prompt].filter(Boolean).join(" "), shot.category)
  );
  const modules = [
    "visible-prompt",
    "category-boundary",
    "variation-seed",
    isSmallLampGeneration(profile, settings) && !isCollageTemplateSettings(settings) ? "small-lamp-route" : "",
    isLargeLampProfile(profile, settings) && !isSmallLampGeneration(profile, settings) && !isCollageTemplateSettings(settings) ? "large-lamp-route" : "",
    isWallLampProfile(profile, settings) && !isSmallLampGeneration(profile, settings) && !isLargeLampProfile(profile, settings) && !isCollageTemplateSettings(settings) ? "wall-lamp-route" : "",
    isProductWorkspaceSettings(settings) ? "product-workspace-consistency" : "",
    isProductWorkspaceSettings(settings) && route.methodologyId ? "detail-methodology" : "",
    isStyleSimilarSettings(settings) ? "style-similar-rule" : "",
    settings?.styleCloneMode && templateReferenceCount > 0 ? "style-clone-reference" : "",
    isCollageTemplateSettings(settings) ? "collage-rule" : "",
    textMode === "model-direct" ? "model-direct-text" : "",
    textMode === "local-overlay" ? "local-text-overlay" : "",
    textMode !== "model-direct" && (noTextRequested || (!productPromptAllowsText(category) && !largeLampHeroTextAllowed(shot, category) && !wallLampHeroTextAllowed(shot, category))) ? "no-visible-text" : "planned-text-allowed"
  ].filter(Boolean);
  return {
    promptChars: String(prompt || "").length,
    promptLines: String(prompt || "").split(/\n+/).filter((line) => line.trim()).length,
    finalPromptChars: compactMeta.finalPromptChars || String(prompt || "").length,
    originalPromptChars: compactMeta.originalPromptChars || String(prompt || "").length,
    finalPromptLines: compactMeta.finalPromptLines || String(prompt || "").split(/\n+/).filter((line) => line.trim()).length,
    originalPromptLines: compactMeta.originalPromptLines || String(prompt || "").split(/\n+/).filter((line) => line.trim()).length,
    dedupedBlocks: compactMeta.dedupedBlocks || [],
    conflictWarnings: compactMeta.conflictWarnings || [],
    profileAuditWarnings: Array.isArray(profile?.profileAuditWarnings) ? profile.profileAuditWarnings : [],
    specBlockedTerms: Array.isArray(profile?.specBlockedTerms) ? profile.specBlockedTerms : [],
    category,
    textMode,
    overlayPlanned: Boolean(shot?.textOverlay),
    methodologyId: route.methodologyId || "",
    visualDialect: route.visualDialect || "",
    spatialLensQa: compactMeta.spatialLensQa || null,
    modules
  };
}

async function generateImageForShotDirect({
  db,
  shot,
  generationFiles,
  modelOption,
  settings,
  geminiKey,
  geminiBaseUrl,
  geminiProviderName,
  geminiUseBearerAuth,
  openAICompatibleKey,
  openAICompatibleBaseUrl,
  openAICompatibleName,
  profile,
  generationContext = {}
}) {
  const inputReferenceCount = generationFiles.filter(
    (file) => file.inputRole === "layout-reference" || file.inputRole === "reference-canvas" || file.inputRole === "style-reference"
  ).length;
  const declaredReferenceCount = Number(settings?.templateReferenceCount || 0);
  const templateReferenceCount = isStyleSimilarSettings(settings)
    ? Math.max(inputReferenceCount, declaredReferenceCount)
    : inputReferenceCount;
  const directSubjectSwap = isDirectStyleCloneSettings(settings) && generationFiles.some((file) => file.inputRole === "reference-canvas");
  const isProductWorkspace = isProductWorkspaceSettings(settings);
  const gptDesignSpecProductPrompt = isGptProductDesignShot(shot, settings);
  const firstPrompt = directSubjectSwap
    ? directSwapGenerationPrompt(shot, "", settings, profile)
    : gptDesignSpecProductPrompt
      ? String(shot.generationPrompt || shot.prompt || "").trim()
      : isProductWorkspace
        ? (String(shot.generationPrompt || "").trim() || generationPromptForShotPrompt(shot.prompt, { profile, category: shot.category, shot, settings }))
        : ensureConsistencyInPrompt(shot.prompt, {
            templateReferenceCount,
            category: shot.category,
            title: shot.title,
            variationIndex: shotVariationIndex(shot, 0),
            allowPlannedText: styleSimilarAllowsPlannedText(settings)
          });
  const firstGenerationPrompt = directSubjectSwap
    ? firstPrompt
    : gptDesignSpecProductPrompt
      ? firstPrompt
      : hiddenGenerationPrompt(firstPrompt, {
          shot,
          templateReferenceCount,
          settings,
          modelOption,
          profile
        });
  const compactedPrompt = gptDesignSpecProductPrompt
    ? {
        prompt: firstGenerationPrompt,
        meta: {
          finalPromptChars: String(firstGenerationPrompt || "").length,
          originalPromptChars: String(firstGenerationPrompt || "").length,
          finalPromptLines: String(firstGenerationPrompt || "").split(/\n+/).filter((line) => line.trim()).length,
          originalPromptLines: String(firstGenerationPrompt || "").split(/\n+/).filter((line) => line.trim()).length,
          dedupedBlocks: [],
          conflictWarnings: []
        }
      }
    : compactGenerationPrompt(firstGenerationPrompt, {
        shot,
        templateReferenceCount,
        settings,
        modelOption,
        profile
      });
  const requestGenerationContext = generationContext && typeof generationContext === "object" ? generationContext : {};
  if (!requestGenerationContext.db) requestGenerationContext.db = db;
  requestGenerationContext.productWorkspace = isProductWorkspaceSettings(settings);
  const generationSettings = gptDesignSpecProductPrompt ? { ...settings, productPlanMode: GPT_PRODUCT_PLAN_MODE } : settings;
  const imageUrl = await generateImageForShot({
    prompt: compactedPrompt.prompt,
    files: generationFiles,
    modelOption,
    ratio: shot.ratio,
    clarity: generationSettings.clarity,
    geminiKey,
    geminiBaseUrl,
    geminiProviderName,
    geminiUseBearerAuth,
    openAICompatibleKey,
    openAICompatibleBaseUrl,
    openAICompatibleName,
    settings: generationSettings,
    generationContext: requestGenerationContext
  });
  const spatialLensQa = gptDesignSpecProductPrompt ? { status: "skip", reason: "gpt-design-spec-plan" } : await maybeRunSpatialLensVisualQa({
    db,
    imageUrl,
    shot,
    profile,
    settings,
    geminiKey,
    geminiBaseUrl,
    geminiProviderName,
    geminiUseBearerAuth,
    openAICompatibleKey,
    openAICompatibleBaseUrl,
    openAICompatibleName
  });
  if (spatialLensQa.status !== "skip" && spatialLensVisualQaFails(spatialLensQa, profile, settings)) {
    const error = new Error(`首图/场景图构图质检未通过：${spatialLensQa.reason || "灯具比例过大或空间尺度不足"}`);
    error.status = 409;
    error.code = "SPATIAL_LENS_QA_FAILED";
    error.spatialLensQa = spatialLensQa;
    throw error;
  }
  return {
    imageUrl,
    promptDebug: generationPromptDebug(compactedPrompt.prompt, {
      shot,
      templateReferenceCount,
      settings,
      profile
    }, { ...compactedPrompt.meta, spatialLensQa })
  };
}

async function maybeUseSvgTextFallback({
  generationResult = {},
  generationArgs = {},
  shot = {},
  settings = {},
  profile = {}
} = {}) {
  const textQa = modelDirectTextQaResult({ imageUrl: generationResult?.imageUrl || "", shot, settings });
  if (textQa.status !== "fail") {
    return { generationResult, shot, textQa, textFallback: "" };
  }
  if (isDetailHeroTextShot(shot, shot?.category)) {
    return { generationResult, shot, textQa, textFallback: "skipped-for-autonomous-hero" };
  }
  const fallbackShot = localOverlayFallbackShot(shot, profile, settings);
  const fallbackResult = await generateImageForShotDirect({
    ...generationArgs,
    shot: fallbackShot,
    settings,
    profile
  });
  return {
    generationResult: {
      ...fallbackResult,
      promptDebug: {
        ...(fallbackResult.promptDebug || {}),
        modelDirectTextQa: textQa,
        textFallback: "svg"
      }
    },
    shot: fallbackShot,
    textQa,
    textFallback: "svg"
  };
}

function writeJsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function startJsonLineHeartbeat(res, payload = {}) {
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(timer);
      return;
    }
    try {
      writeJsonLine(res, {
        type: "heartbeat",
        at: new Date().toISOString(),
        ...payload
      });
    } catch {
      clearInterval(timer);
    }
  }, GENERATION_STREAM_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function safeFilePart(value, fallback = "image") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return cleaned || fallback;
}

function publicGeneratedImageUrl(filePath = "") {
  const relative = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, "/");
  return `/${relative}`;
}

async function imageBytesFromUrl(imageUrl) {
  const value = String(imageUrl || "");
  const dataMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (dataMatch) {
    const mimeType = dataMatch[1];
    const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1].replace("+xml", "");
    return { bytes: Buffer.from(dataMatch[2], "base64"), extension };
  }
  const local = localPublicImageInlineData(value);
  if (local) {
    const extension = local.mimeType.includes("jpeg")
      ? "jpg"
      : local.mimeType.includes("svg")
        ? "svg"
        : local.mimeType.includes("webp")
          ? "webp"
          : "png";
    return { bytes: Buffer.from(local.data, "base64"), extension };
  }
  if (false) throw new Error("Error");
  const response = await fetch(value);
  if (!response.ok) throw new Error(`下载图片失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/png";
  const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("webp") ? "webp" : "png";
  return { bytes: Buffer.from(await response.arrayBuffer()), extension };
}

async function persistGeneratedImageUrl(imageUrl = "", { title = "result", category = "generated" } = {}) {
  const value = String(imageUrl || "");
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)) return value;
  fs.mkdirSync(GENERATED_IMAGE_DIR, { recursive: true });
  const { bytes, extension } = await imageBytesFromUrl(value);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(4).toString("hex");
  const filename = `${timestamp}_${nonce}_${safeFilePart(category, "image")}_${safeFilePart(title, "result")}.${extension}`;
  const filePath = path.join(GENERATED_IMAGE_DIR, filename);
  fs.writeFileSync(filePath, bytes);
  return publicGeneratedImageUrl(filePath);
}

async function saveImageFile({ imageUrl, directory, title, category }) {
  const targetDir = path.resolve(String(directory || "").trim() || DEFAULT_EXPORT_DIR);
  fs.mkdirSync(targetDir, { recursive: true });
  const { bytes, extension } = await imageBytesFromUrl(imageUrl);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}_${safeFilePart(category, "image")}_${safeFilePart(title, "result")}.${extension}`;
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function writeImageBytesAs({ bytes, filePath }) {
  const selectedPath = String(filePath || "").trim();
  if (!selectedPath) throw new Error("请选择保存位置");
  const targetPath = path.resolve(selectedPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes);
  return targetPath;
}

async function selectDirectoryWithSystemDialog(initialDirectory = "") {
  if (process.platform !== "win32") {
    throw new Error("Error");
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = "CenterScreen"
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "";
$dialog.ShowNewFolderButton = $true
$initial = [Environment]::GetEnvironmentVariable("LAMPS_INITIAL_SAVE_DIR")
if ($initial -and (Test-Path -LiteralPath $initial)) {
  $dialog.SelectedPath = (Resolve-Path -LiteralPath $initial).Path
}
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
$owner.Dispose()
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      env: {
        ...process.env,
        LAMPS_INITIAL_SAVE_DIR: String(initialDirectory || "")
      },
      windowsHide: false,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    }
  );
  return String(stdout || "").trim();
}

async function selectSaveFileWithSystemDialog({ initialDirectory = "", filename = "", extension = "png" }) {
  if (process.platform !== "win32") {
    throw new Error("Error");
  }
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = "CenterScreen"
$owner.ShowInTaskbar = $false
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = "保存图片"
$dialog.OverwritePrompt = $true
$dialog.AddExtension = $true
$dialog.RestoreDirectory = $true
$dialog.DefaultExt = [Environment]::GetEnvironmentVariable("LAMPS_SAVE_EXTENSION")
$dialog.FileName = [Environment]::GetEnvironmentVariable("LAMPS_SAVE_FILENAME")
$dialog.Filter = "图片文件 (*." + $dialog.DefaultExt + ")|*." + $dialog.DefaultExt + "|PNG 图片 (*.png)|*.png|JPEG 图片 (*.jpg;*.jpeg)|*.jpg;*.jpeg|WebP 图片 (*.webp)|*.webp|所有文件 (*.*)|*.*"
$initial = [Environment]::GetEnvironmentVariable("LAMPS_INITIAL_SAVE_DIR")
if ($initial -and (Test-Path -LiteralPath $initial)) {
  $dialog.InitialDirectory = (Resolve-Path -LiteralPath $initial).Path
}
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.FileName)
}
$owner.Dispose()
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      env: {
        ...process.env,
        LAMPS_INITIAL_SAVE_DIR: String(initialDirectory || ""),
        LAMPS_SAVE_FILENAME: String(filename || "image.png"),
        LAMPS_SAVE_EXTENSION: String(extension || "png").replace(/^\./, "")
      },
      windowsHide: false,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024
    }
  );
  return String(stdout || "").trim();
}

async function createWechatNativePayment(payment) {
  const baseUrl = requirePublicPaymentBaseUrl();
  const mchid = process.env.WECHAT_PAY_MCHID;
  const appid = process.env.WECHAT_PAY_APPID;
  const serialNo = process.env.WECHAT_PAY_SERIAL_NO;
  const privateKey = readSecretValue(process.env.WECHAT_PAY_PRIVATE_KEY, process.env.WECHAT_PAY_PRIVATE_KEY_PATH);
  if (!mchid || !appid || !serialNo || !privateKey || !process.env.WECHAT_PAY_API_V3_KEY) {
    throw new Error("Error");
  }

  const pathname = "/v3/pay/transactions/native";
  const body = JSON.stringify({
    appid,
    mchid,
    description: `lamps studio recharge ${payment.amount} CNY`,
    out_trade_no: payment.id,
    notify_url: `${baseUrl}/api/payments/wechat/notify`,
    attach: payment.phone,
    amount: {
      total: payment.amountCents,
      currency: "CNY"
    }
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `POST\n${pathname}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.createSign("RSA-SHA256").update(message).sign(privateKey, "base64");
  const authorization = [
    "WECHATPAY2-SHA256-RSA2048",
    `mchid="${mchid}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${serialNo}"`
  ].join(",");

  const response = await fetch(`https://api.mch.weixin.qq.com${pathname}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "LampAICommerceWeb/0.1.0"
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.code_url) {
    throw new Error(payload.message || `微信支付下单失败：HTTP ${response.status}`);
  }
  payment.payUrl = payload.code_url;
  payment.qrDataUrl = await QRCode.toDataURL(payload.code_url, { margin: 1, width: 256 });
  payment.rawProviderResponse = payload;
  return payment;
}

async function createAlipayPrecreatePayment(payment) {
  const baseUrl = requirePublicPaymentBaseUrl();
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = readSecretValue(process.env.ALIPAY_PRIVATE_KEY, process.env.ALIPAY_PRIVATE_KEY_PATH);
  const publicKey = readSecretValue(process.env.ALIPAY_PUBLIC_KEY, process.env.ALIPAY_PUBLIC_KEY_PATH);
  if (!appId || !privateKey || !publicKey) {
    throw new Error("Error");
  }

  const params = {
    app_id: appId,
    method: "alipay.trade.precreate",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    notify_url: `${baseUrl}/api/payments/alipay/notify`,
    biz_content: JSON.stringify({
      out_trade_no: payment.id,
      total_amount: payment.amount.toFixed(2),
      subject: `lamps studio recharge ${payment.amount} CNY`,
      body: `Account ${payment.phone} balance recharge`
    })
  };
  const signContent = sortedQuery(params);
  params.sign = crypto.createSign("RSA-SHA256").update(signContent, "utf8").sign(privateKey, "base64");

  const response = await fetch(ALIPAY_GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
    },
    body: toUrlEncoded(params)
  });
  const payload = await response.json().catch(() => ({}));
  const result = payload.alipay_trade_precreate_response;
  if (!response.ok || result?.code !== "10000" || !result?.qr_code) {
    throw new Error(result?.sub_msg || result?.msg || `鏀粯瀹濅笅鍗曞け璐ワ細HTTP ${response.status}`);
  }
  payment.payUrl = result.qr_code;
  payment.qrDataUrl = await QRCode.toDataURL(result.qr_code, { margin: 1, width: 256 });
  payment.rawProviderResponse = payload;
  return payment;
}

function verifyWechatNotifySignature(req) {
  const publicKey = readSecretValue(process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY, process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH);
  if (!publicKey) {
    throw new Error("Error");
  }
  const timestamp = req.get("wechatpay-timestamp");
  const nonce = req.get("wechatpay-nonce");
  const signature = req.get("wechatpay-signature");
  if (!timestamp || !nonce || !signature || !req.rawBody) return false;
  const message = `${timestamp}\n${nonce}\n${req.rawBody}\n`;
  return crypto.createVerify("RSA-SHA256").update(message).verify(publicKey, signature, "base64");
}

function decryptWechatResource(resource) {
  const key = Buffer.from(process.env.WECHAT_PAY_API_V3_KEY || "", "utf8");
  if (false) throw new Error("Error");
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce, "utf8"));
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  decipher.setAuthTag(authTag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

function verifyAlipayNotify(params) {
  const publicKey = readSecretValue(process.env.ALIPAY_PUBLIC_KEY, process.env.ALIPAY_PUBLIC_KEY_PATH);
  if (!publicKey) {
    throw new Error("Error");
  }
  const signContent = sortedQuery(params, { skip: ["sign", "sign_type"] });
  const sign = params.sign;
  if (!sign) return false;
  return crypto.createVerify("RSA-SHA256").update(signContent, "utf8").verify(publicKey, sign, "base64");
}

app.get("/api/config", (_req, res) => {
  const db = loadDb();
  const settings = getAppSettings(db);
  const activeImageProvider = settings.yunwuEnabled && effectiveYunwuKey(db)
    ? "yunwu"
    : settings.apiyiEnabled && effectiveAPIYiKey(db)
      ? "apiyi"
      : effectiveOpenAIKey(db)
        ? "openai"
        : "";
  res.json({
    hasOpenAIKey: Boolean(effectiveOpenAIKey(db)),
    hasGeminiKey: Boolean(effectiveGeminiKey(db)),
    hasAPIYiKey: Boolean(effectiveAPIYiKey(db)),
    hasYunwuKey: Boolean(effectiveYunwuKey(db)),
    apiyiEnabled: Boolean(settings.apiyiEnabled),
    yunwuEnabled: Boolean(settings.yunwuEnabled),
    activeImageProvider,
    realOpenAIImagesEnabled: effectiveRealOpenAIImages(db),
    defaultImageModel: normalizeImageModelId(settings.defaultImageModel || DEFAULT_IMAGE_MODEL),
    defaultAnalysisModel: settings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL,
    modelOptions: MODEL_OPTIONS,
    analysisModelOptions: ANALYSIS_MODEL_OPTIONS,
    creditRules: CREDIT_RULES,
    payment: getPaymentConfigStatus(),
    verification: getVerificationConfigStatus(settings),
    support: {
      wechat: settings.supportWechat || "",
      wechatQrUrl: settings.supportWechatQrUrl || "",
      onlineReply: Boolean(settings.supportOnlineReply),
      welcome: settings.supportWelcome || ""
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "lamps studio",
    publicBaseUrl: PUBLIC_BASE_URL,
    time: new Date().toISOString()
  });
});

app.post("/api/auth/send-code", async (req, res) => {
  const accountInfo = parsePublicAuthAccount(req.body?.account || req.body?.phone || req.body?.email);
  if (!accountInfo) {
    res.status(400).json({ error: "请输入正确的手机号或邮箱" });
    return;
  }
  const db = loadDb();
  if (db.users[accountInfo.account]?.passwordHash) {
    res.status(409).json({ error: "该账号已注册，请直接登录" });
    return;
  }
  const existingCode = db.verificationCodes?.[accountInfo.account];
  if (existingCode?.sentAt && Date.now() - Number(existingCode.sentAt) < 60 * 1000) {
    res.status(429).json({ error: "验证码已发送，请 60 秒后再试" });
    return;
  }
  const settings = getAppSettings(db);
  const code = makeVerificationCode();
  try {
    await sendRegistrationCode(settings, accountInfo, code);
    storeVerificationCode(db, accountInfo.account, accountInfo.type, code);
    saveDb(db);
    res.json({ ok: true, channel: accountInfo.type, expiresIn: 600 });
  } catch (error) {
    void 0;
  }
});

app.post("/api/auth/register", (req, res) => {
  const accountInfo = parsePublicAuthAccount(req.body?.account || req.body?.phone || req.body?.email);
  const password = String(req.body?.password || "");
  const code = String(req.body?.code || "").trim();
  if (!accountInfo) {
    res.status(400).json({ error: "请输入正确的手机号或邮箱" });
    return;
  }
  if (password.length < 6) {
    void 0;
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "请输入 6 位验证码" });
    return;
  }

  const db = loadDb();
  const existing = db.users[accountInfo.account];
  if (existing?.passwordHash) {
    res.status(409).json({ error: "该账号已注册，请直接登录" });
    return;
  }

  try {
    assertVerificationCode(db, accountInfo.account, code);
  } catch (error) {
    saveDb(db);
    res.status(400).json({ error: error instanceof Error ? error.message : "楠岃瘉鐮佷笉姝ｇ‘" });
    return;
  }

  const { salt, hash } = makePasswordHash(password);
  db.users[accountInfo.account] = {
    ...(existing || {}),
    account: accountInfo.account,
    username: "",
    phone: accountInfo.phone,
    email: accountInfo.email,
    role: "user",
    name: accountInfo.type === "phone" ? `灯具商家 ${accountInfo.phone.slice(-4)}` : `灯具商家 ${accountInfo.email.split("@")[0]}`,
    balance: Number(existing?.balance || 0),
    passwordSalt: salt,
    passwordHash: hash,
    createdAt: existing?.createdAt || new Date().toISOString()
  };

  const token = makeToken();
  db.sessions[token] = accountInfo.account;
  saveDb(db);
  res.json({ token, user: publicUser(db.users[accountInfo.account]) });
});

app.post("/api/auth/login", (req, res) => {
  const account = normalizeLoginId(req.body?.account || req.body?.phone || req.body?.email);
  const password = String(req.body?.password || "");
  const db = loadDb();
  const user = db.users[account];
  if (!user || !verifyPassword(password, user)) {
    void 0;
    return;
  }

  const token = makeToken();
  db.sessions[token] = account;
  saveDb(db);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/account", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/account/ledger", requireAuth, (req, res) => {
  const account = userAccount(req.user);
  const payments = (req.db.payments || [])
    .filter((payment) => (payment.account || payment.phone) === account)
    .slice(0, 80)
    .map(publicPayment);
  const consumption = (req.db.jobs || [])
    .filter((job) => job.account === account)
    .slice(0, 80)
    .map(publicConsumption);
  const apiKeyLeases = ensureLeaseStore(req.db)
    .filter((lease) => lease.account === account)
    .slice(0, 60)
    .map(publicLease);
  const totals = {
    paidRecharge: payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.creditAmount || 0), 0),
    pendingRecharge: payments.filter((payment) => payment.status === "pending").reduce((sum, payment) => sum + Number(payment.creditAmount || 0), 0),
    consumed: consumption.reduce((sum, item) => sum + Number(item.credits || 0), 0),
    activeLeaseCredits: apiKeyLeases
      .filter((lease) => lease.status === "active")
      .reduce((sum, lease) => sum + Number(lease.remainingCredits || 0), 0)
  };
  res.json({ user: publicUser(req.user), totals, payments, consumption, apiKeyLeases });
});

app.get("/api/account/generation-history", requireAuth, (req, res) => {
  const account = userAccount(req.user);
  if (pruneAccountGeneratedImageCache(req.db, account)) saveDb(req.db);
  res.json({ history: accountGenerationHistory(req.db, account), limits: GENERATION_HISTORY_LIMITS, user: publicUser(req.user) });
});

app.post("/api/system/select-directory", requireAuth, async (req, res) => {
  try {
    const directory = await selectDirectoryWithSystemDialog(req.body?.directory || DEFAULT_EXPORT_DIR);
    res.json({ directory });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "选择保存路径失败" });
  }
});

app.post("/api/credits/estimate", requireAuth, (req, res) => {
  const settings = req.body?.settings || {};
  const layout = String(req.body?.layout || req.body?.requirement || "");
  const counts = wallLampDetailSuiteRequested(settings, layout)
    ? wallLampFullDetailCounts(req.body?.counts || {})
    : smallLampDetailSuiteRequested(settings, layout)
    ? smallLampFullDetailCounts(req.body?.counts || {})
    : normalizeCounts(req.body?.counts || {});
  res.json({ estimate: creditEstimate(counts, settings), user: publicUser(req.user) });
});

app.get("/api/admin/dashboard", requireAdmin, (req, res) => {
  const users = Object.values(req.db.users)
    .map((user) => publicUser(user))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const userAccounts = users.filter((user) => user.role !== "admin");
  const payments = (req.db.payments || []).slice(0, 80).map(publicPayment);
  const consumption = (req.db.jobs || []).slice(0, 80).map(publicConsumption);
  const apiKeyLeases = ensureLeaseStore(req.db).slice(0, 80).map(publicLease);
  const stats = {
    totalUsers: userAccounts.length,
    totalBalance: userAccounts.reduce((sum, user) => sum + Number(user.balance || 0), 0),
    paidRecharge: payments
      .filter((payment) => payment.status === "paid")
      .reduce((sum, payment) => sum + Number(payment.creditAmount || 0), 0),
    totalConsumed: (req.db.jobs || []).reduce((sum, job) => sum + Number(job.credits || 0), 0),
    consumptionCount: req.db.jobs.length,
    activeApiKeys: apiKeyLeases.filter((lease) => lease.status === "active").length,
    activeModelLeases: apiKeyLeases.filter((lease) => lease.status === "active").length,
    openSupport: req.db.supportMessages.filter((message) => message.status !== "replied").length
  };
  res.json({ stats, users, payments, consumption, apiKeyLeases });
});

app.post("/api/admin/users/:account/balance", requireAdmin, (req, res) => {
  const account = normalizeLoginId(req.params.account);
  const user = req.db.users[account];
  if (!user || user.role === "admin") {
    void 0;
    return;
  }
  const mode = req.body?.mode === "add" ? "add" : "set";
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount)) {
    res.status(400).json({ error: "请输入正确的积分数字" });
    return;
  }
  const nextBalance = mode === "add" ? Number(user.balance || 0) + amount : amount;
  // Admin balance edits should not pre-bind credits to the default model.
  user.balance = Math.max(0, Math.round(nextBalance * 100) / 100);
  saveDb(req.db);
  res.json({ user: publicUser(user) });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  const settings = getAppSettings(req.db);
  const verification = getVerificationConfigStatus(settings);
  const modelChannels = allModelChannels(req.db).map(publicModelChannel);
  const activeImageProvider = settings.yunwuEnabled && effectiveYunwuKey(req.db)
    ? "yunwu"
    : settings.apiyiEnabled && effectiveAPIYiKey(req.db)
      ? "apiyi"
      : effectiveOpenAIKey(req.db)
        ? "openai"
        : "";
  res.json({
    settings: {
      hasOpenAIKey: Boolean(settings.openaiApiKey),
      openAIKeyMasked: maskSecret(settings.openaiApiKey || ""),
      hasGeminiKey: Boolean(settings.geminiApiKey),
      geminiKeyMasked: maskSecret(settings.geminiApiKey || ""),
      hasAPIYiKey: Boolean(settings.apiyiApiKey),
      apiyiKeyMasked: maskSecret(settings.apiyiApiKey || ""),
      apiyiBaseUrl: settings.apiyiBaseUrl || DEFAULT_APIYI_BASE_URL,
      apiyiEnabled: Boolean(settings.apiyiEnabled),
      hasYunwuKey: Boolean(settings.yunwuApiKey || process.env.YUNWU_API_KEY || process.env.YUNWU_KEY),
      yunwuKeyMasked: maskSecret(settings.yunwuApiKey || process.env.YUNWU_API_KEY || process.env.YUNWU_KEY || ""),
      yunwuBaseUrl: settings.yunwuBaseUrl || DEFAULT_YUNWU_BASE_URL,
      yunwuEnabled: Boolean(settings.yunwuEnabled),
      activeImageProvider,
      hasSub2APIAdminToken: Boolean(settings.sub2apiAdminToken || process.env.SUB2API_ADMIN_TOKEN),
      sub2apiAdminTokenMasked: maskSecret(settings.sub2apiAdminToken || process.env.SUB2API_ADMIN_TOKEN || ""),
      sub2apiBaseUrl: settings.sub2apiBaseUrl || DEFAULT_SUB2API_BASE_URL,
      sub2apiDashboardPath: settings.sub2apiDashboardPath || DEFAULT_SUB2API_ADMIN_PATH,
      sub2apiDashboardUrl: (() => {
        try {
          return effectiveSub2APIDashboardUrl(req.db);
        } catch {
          return "";
        }
      })(),
      sub2apiEnabled: Boolean(settings.sub2apiEnabled),
      realOpenAIImages: Boolean(settings.realOpenAIImages),
      defaultImageModel: normalizeImageModelId(settings.defaultImageModel || DEFAULT_IMAGE_MODEL),
      defaultAnalysisModel: settings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL,
      supportWechat: settings.supportWechat || "",
      supportWechatQrUrl: settings.supportWechatQrUrl || "",
      supportOnlineReply: Boolean(settings.supportOnlineReply),
      supportWelcome: settings.supportWelcome || "",
      verification,
      smsAccessKeyIdMasked: maskSecret(settings.smsAccessKeyId || ""),
      smsAccessKeySecretMasked: maskSecret(settings.smsAccessKeySecret || ""),
      smsSignName: settings.smsSignName || "",
      smsTemplateCode: settings.smsTemplateCode || "",
      smtpHost: settings.smtpHost || "",
      smtpPort: settings.smtpPort || "",
      smtpSecure: Boolean(settings.smtpSecure),
      smtpUserMasked: maskSecret(settings.smtpUser || ""),
      smtpFrom: settings.smtpFrom || "",
      modelChannels,
      modelChannelCapacity: {
        analysis: modelChannels.filter((channel) => channel.enabled && modelChannelSupportsPurpose(channel, "analysis")).reduce((sum, channel) => sum + Number(channel.maxConcurrency || 0), 0),
        generation: modelChannels.filter((channel) => channel.enabled && modelChannelSupportsPurpose(channel, "generation")).reduce((sum, channel) => sum + Number(channel.maxConcurrency || 0), 0)
      }
    }
  });
});

app.post("/api/admin/settings", requireAdmin, (req, res) => {
  const settings = getAppSettings(req.db);
  if (typeof req.body?.openaiApiKey === "string" && req.body.openaiApiKey.trim()) {
    settings.openaiApiKey = req.body.openaiApiKey.trim();
  }
  if (typeof req.body?.geminiApiKey === "string" && req.body.geminiApiKey.trim()) {
    settings.geminiApiKey = req.body.geminiApiKey.trim();
  }
  const apiyiToken = String(req.body?.apiyiToken || req.body?.apiyiApiKey || "").trim();
  if (apiyiToken) {
    settings.apiyiApiKey = apiyiToken;
    settings.apiyiEnabled = true;
    settings.realOpenAIImages = true;
  }
  if (typeof req.body?.apiyiBaseUrl === "string" && req.body.apiyiBaseUrl.trim()) {
    settings.apiyiBaseUrl = req.body.apiyiBaseUrl.trim().replace(/\/+$/, "");
  }
  const yunwuToken = String(req.body?.yunwuToken || req.body?.yunwuApiKey || "").trim();
  if (yunwuToken) {
    settings.yunwuApiKey = yunwuToken;
    settings.yunwuEnabled = true;
    settings.realOpenAIImages = true;
  }
  if (typeof req.body?.yunwuBaseUrl === "string" && req.body.yunwuBaseUrl.trim()) {
    settings.yunwuBaseUrl = normalizeOpenAICompatibleBaseUrl(req.body.yunwuBaseUrl.trim(), DEFAULT_YUNWU_BASE_URL);
  }
  if (req.body?.clearOpenAIKey === true) {
    settings.openaiApiKey = "";
  }
  if (req.body?.clearGeminiKey === true) {
    settings.geminiApiKey = "";
  }
  if (req.body?.clearAPIYiKey === true) {
    settings.apiyiApiKey = "";
  }
  if (req.body?.clearYunwuKey === true) {
    settings.yunwuApiKey = "";
  }
  if (typeof req.body?.apiyiEnabled === "boolean") settings.apiyiEnabled = req.body.apiyiEnabled;
  if (typeof req.body?.yunwuEnabled === "boolean") settings.yunwuEnabled = req.body.yunwuEnabled;
  if (typeof req.body?.imageProvider === "string") {
    const imageProvider = req.body.imageProvider.trim().toLowerCase();
    if (imageProvider === "yunwu") {
      settings.yunwuEnabled = true;
      settings.apiyiEnabled = false;
    } else if (imageProvider === "apiyi") {
      settings.apiyiEnabled = true;
      settings.yunwuEnabled = false;
    } else if (imageProvider === "openai") {
      settings.apiyiEnabled = false;
      settings.yunwuEnabled = false;
    }
  }
  if (settings.yunwuEnabled && (settings.yunwuApiKey || process.env.YUNWU_API_KEY || process.env.YUNWU_KEY)) {
    settings.apiyiEnabled = false;
    settings.realOpenAIImages = true;
  }
  if (typeof req.body?.sub2apiBaseUrl === "string") {
    const nextSub2APIBaseUrl = req.body.sub2apiBaseUrl.trim();
    settings.sub2apiBaseUrl = nextSub2APIBaseUrl ? normalizeHttpBaseUrl(nextSub2APIBaseUrl) : "";
  }
  if (typeof req.body?.sub2apiAdminToken === "string" && req.body.sub2apiAdminToken.trim()) {
    settings.sub2apiAdminToken = req.body.sub2apiAdminToken.trim();
  }
  if (typeof req.body?.sub2apiDashboardPath === "string") {
    settings.sub2apiDashboardPath = normalizeUrlPath(req.body.sub2apiDashboardPath, DEFAULT_SUB2API_ADMIN_PATH);
  }
  if (req.body?.clearSub2APIAdminToken === true) {
    settings.sub2apiAdminToken = "";
  }
  if (typeof req.body?.sub2apiEnabled === "boolean") settings.sub2apiEnabled = req.body.sub2apiEnabled;
  if (typeof req.body?.realOpenAIImages === "boolean") settings.realOpenAIImages = req.body.realOpenAIImages;
  if (typeof req.body?.defaultImageModel === "string" && req.body.defaultImageModel.trim()) {
    settings.defaultImageModel = normalizeImageModelId(req.body.defaultImageModel);
  }
  if (typeof req.body?.defaultAnalysisModel === "string" && req.body.defaultAnalysisModel.trim()) {
    const requestedAnalysisModel = req.body.defaultAnalysisModel.trim();
    settings.defaultAnalysisModel = isSupportedAnalysisModel(requestedAnalysisModel)
      ? requestedAnalysisModel
      : DEFAULT_ANALYSIS_MODEL;
  }
  if (typeof req.body?.supportWechat === "string") settings.supportWechat = req.body.supportWechat.trim();
  if (typeof req.body?.supportWechatQrUrl === "string") settings.supportWechatQrUrl = req.body.supportWechatQrUrl.trim();
  if (typeof req.body?.supportOnlineReply === "boolean") settings.supportOnlineReply = req.body.supportOnlineReply;
  if (typeof req.body?.supportWelcome === "string") settings.supportWelcome = req.body.supportWelcome.trim();
  if (typeof req.body?.smsAccessKeyId === "string" && req.body.smsAccessKeyId.trim()) {
    settings.smsAccessKeyId = req.body.smsAccessKeyId.trim();
  }
  if (typeof req.body?.smsAccessKeySecret === "string" && req.body.smsAccessKeySecret.trim()) {
    settings.smsAccessKeySecret = req.body.smsAccessKeySecret.trim();
  }
  if (typeof req.body?.smsSignName === "string") settings.smsSignName = req.body.smsSignName.trim();
  if (typeof req.body?.smsTemplateCode === "string") settings.smsTemplateCode = req.body.smsTemplateCode.trim();
  if (typeof req.body?.smtpHost === "string") settings.smtpHost = req.body.smtpHost.trim();
  if (typeof req.body?.smtpPort === "string" || typeof req.body?.smtpPort === "number") {
    settings.smtpPort = String(req.body.smtpPort).trim();
  }
  if (typeof req.body?.smtpSecure === "boolean") settings.smtpSecure = req.body.smtpSecure;
  if (typeof req.body?.smtpUser === "string" && req.body.smtpUser.trim()) settings.smtpUser = req.body.smtpUser.trim();
  if (typeof req.body?.smtpPass === "string" && req.body.smtpPass.trim()) settings.smtpPass = req.body.smtpPass;
  if (typeof req.body?.smtpFrom === "string") settings.smtpFrom = req.body.smtpFrom.trim();
  if (Array.isArray(req.body?.modelChannels)) {
    settings.modelChannels = normalizeAdminModelChannels(req.body.modelChannels, settings.modelChannels || []);
  }
  saveDb(req.db);
  res.json({ ok: true });
});

app.get("/api/admin/sub2api/status", requireAdmin, (req, res) => {
  const settings = getAppSettings(req.db);
  let dashboardUrl = "";
  try {
    dashboardUrl = effectiveSub2APIDashboardUrl(req.db);
  } catch {
    dashboardUrl = "";
  }
  res.json({
    sub2api: {
      enabled: Boolean(settings.sub2apiEnabled),
      baseUrl: settings.sub2apiBaseUrl || DEFAULT_SUB2API_BASE_URL,
      hasAdminToken: Boolean(settings.sub2apiAdminToken || process.env.SUB2API_ADMIN_TOKEN),
      adminTokenMasked: maskSecret(settings.sub2apiAdminToken || process.env.SUB2API_ADMIN_TOKEN || ""),
      dashboardPath: settings.sub2apiDashboardPath || DEFAULT_SUB2API_ADMIN_PATH,
      dashboardUrl
    }
  });
});

app.post("/api/admin/sub2api/test", requireAdmin, async (req, res) => {
  try {
    const result = await probeSub2API(req.db);
    res.json({ ok: Boolean(result.ok), result });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Sub2API 连接测试失败" });
  }
});

app.get("/api/support/config", (_req, res) => {
  const db = loadDb();
  const settings = getAppSettings(db);
  res.json({
    support: {
      wechat: settings.supportWechat || "",
      wechatQrUrl: settings.supportWechatQrUrl || "",
      onlineReply: Boolean(settings.supportOnlineReply),
      welcome: settings.supportWelcome || ""
    }
  });
});

app.get("/api/support/messages", requireAuth, (req, res) => {
  const account = req.user.account || req.user.phone || req.user.username;
  const messages =
    req.user.role === "admin"
      ? req.db.supportMessages
      : req.db.supportMessages.filter((message) => message.account === account);
  res.json({ messages: messages.slice(0, 80) });
});

app.post("/api/support/messages", requireAuth, (req, res) => {
  const text = String(req.body?.message || "").trim();
  if (!text) {
    void 0;
    return;
  }
  const account = req.user.account || req.user.phone || req.user.username;
  const message = {
    id: `S${Date.now()}${crypto.randomBytes(3).toString("hex")}`,
    account,
    name: req.user.name || account,
    role: req.user.role || "user",
    message: text.slice(0, 1000),
    reply: "",
    status: "open",
    createdAt: new Date().toISOString(),
    repliedAt: ""
  };
  req.db.supportMessages.unshift(message);
  req.db.supportMessages = req.db.supportMessages.slice(0, 300);
  saveDb(req.db);
  res.json({ message });
});

app.post("/api/admin/support/messages/:id/reply", requireAdmin, (req, res) => {
  const reply = String(req.body?.reply || "").trim();
  const message = req.db.supportMessages.find((item) => item.id === req.params.id);
  if (!message) {
    void 0;
    return;
  }
  if (!reply) {
    void 0;
    return;
  }
  message.reply = reply.slice(0, 1000);
  message.status = "replied";
  message.repliedAt = new Date().toISOString();
  saveDb(req.db);
  res.json({ message });
});

app.post("/api/payments/create", requireAuth, async (req, res) => {
  const provider = String(req.body?.provider || "");
  const amount = normalizeRechargeAmount(req.body?.amount);
  if (!["wechat", "alipay"].includes(provider)) {
    res.status(400).json({ error: "请选择微信支付或支付宝支付" });
    return;
  }

  const payment = createPaymentRecord(req.db, req.user, provider, amount);
  try {
    if (provider === "wechat") {
      await createWechatNativePayment(payment);
    } else {
      await createAlipayPrecreatePayment(payment);
    }
    saveDb(req.db);
    res.json({
      payment: {
        id: payment.id,
        provider: payment.provider,
        amount: payment.amount,
        creditAmount: payment.creditAmount,
        status: payment.status,
        qrDataUrl: payment.qrDataUrl,
        payUrl: payment.payUrl,
        createdAt: payment.createdAt
      },
      user: publicUser(req.user)
    });
  } catch (error) {
    payment.status = "create_failed";
    payment.error = error instanceof Error ? error.message : "创建支付订单失败";
    saveDb(req.db);
    res.status(400).json({ error: payment.error });
  }
});

app.get("/api/payments/:id", requireAuth, (req, res) => {
  const payment = findPayment(req.db, req.params.id);
  const account = req.user.account || req.user.phone || req.user.username;
  if (!payment || (payment.account || payment.phone) !== account) {
    res.status(404).json({ error: "充值订单不存在" });
    return;
  }
  res.json({
    payment: {
      id: payment.id,
      provider: payment.provider,
      amount: payment.amount,
      creditAmount: payment.creditAmount,
      status: payment.status,
      qrDataUrl: payment.qrDataUrl,
      payUrl: payment.payUrl,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt
    },
    user: publicUser(req.user)
  });
});

app.post("/api/payments/wechat/notify", (req, res) => {
  try {
    if (!verifyWechatNotifySignature(req)) {
      res.status(401).json({ code: "FAIL", message: "invalid signature" });
      return;
    }
    const decrypted = decryptWechatResource(req.body.resource);
    if (decrypted.trade_state === "SUCCESS") {
      const db = loadDb();
      markPaymentPaid(db, decrypted.out_trade_no, decrypted.amount?.total, decrypted.transaction_id, decrypted);
      saveDb(db);
    }
    res.status(200).json({ code: "SUCCESS", message: "鎴愬姛" });
  } catch (error) {
    res.status(500).json({ code: "FAIL", message: error instanceof Error ? error.message : "notify failed" });
  }
});

app.post("/api/payments/alipay/notify", (req, res) => {
  try {
    if (!verifyAlipayNotify(req.body)) {
      res.status(401).send("fail");
      return;
    }
    if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(req.body.trade_status)) {
      const db = loadDb();
      const paidCents = Math.round(Number(req.body.total_amount || 0) * 100);
      markPaymentPaid(db, req.body.out_trade_no, paidCents, req.body.trade_no, req.body);
      saveDb(db);
    }
    res.send("success");
  } catch {
    res.status(500).send("fail");
  }
});

app.post("/api/recharge", requireAuth, (_req, res) => {
  void 0;
});

app.post("/api/images/save-as", requireAuth, async (req, res) => {
  try {
    const { bytes, extension } = await imageBytesFromUrl(req.body?.imageUrl);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}_${safeFilePart(req.body?.category, "image")}_${safeFilePart(req.body?.title, "result")}.${extension}`;
    const filePath = await selectSaveFileWithSystemDialog({
      initialDirectory: req.body?.directory || DEFAULT_EXPORT_DIR,
      filename,
      extension
    });
    if (!filePath) {
      res.json({ filePath: "" });
      return;
    }
    const savedPath = writeImageBytesAs({ bytes, filePath });
    res.json({ filePath: savedPath, directory: path.dirname(savedPath) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "保存图片失败" });
  }
});

app.post("/api/images/save", requireAuth, async (req, res) => {
  try {
    const filePath = await saveImageFile({
      imageUrl: req.body?.imageUrl,
      directory: req.body?.directory,
      title: req.body?.title,
      category: req.body?.category
    });
    res.json({ filePath });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "保存图片失败" });
  }
});

app.post("/api/images/save-batch", requireAuth, async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 30) : [];
    if (!images.length) {
      res.status(400).json({ error: "没有可保存的图片" });
      return;
    }
    const saved = [];
    const failed = [];
    for (const item of images) {
      try {
        const filePath = await saveImageFile({
          imageUrl: item?.imageUrl,
          directory: req.body?.directory,
          title: item?.title || `生成图 ${Number(item?.index || 0) + 1}`,
          category: item?.category || "image"
        });
        saved.push({ index: Number(item?.index || saved.length), filePath });
      } catch (error) {
        failed.push({
          index: Number(item?.index || failed.length),
          error: error instanceof Error ? error.message : "保存失败"
        });
      }
    }
    res.json({ saved, failed });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "批量保存失败" });
  }
});

function stripBackendPromptLines(prompt = "") {
  const text = String(prompt || "").replace(/\\n/g, "\n").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .filter((block) => {
      const value = block.trim();
      if (!value) return false;
      if (/^后端隐藏|^Backend hidden|^Hidden generation/i.test(value)) return false;
      return true;
    })
    .join("\n\n")
    .trim();
}

function simpleVariationPrompt(category = "", variationIndex = 1) {
  const label = categoryLabel(category);
  return `变化：这是第 ${Math.max(1, Number(variationIndex || 1))} 张${label}，构图和表达要与同组其它图片有区分，但产品主体必须一致。`;
}

function taskBoundaryVisibleLine(category = "", options = {}) {
  const allowPlannedText = Boolean(options.allowPlannedText);
  const map = {
    main: "图片类型边界：主图只展示完整产品主体，背景干净，不要混入详情页卖点排版、场景长图或随机文字。",
    selling: allowPlannedText
      ? "图片类型边界：卖点图只突出一个购买理由，背景简洁可留白；允许规划好的短中文卖点、功能标签和必要箭头标注，不要混入完整场景图、细节拼版、实拍到货图或随机乱码。"
      : "图片类型边界：卖点图只突出一个购买理由，背景简洁可留白；不要混入完整场景图、细节拼版、实拍到货图或随机文字。",
    function: "图片类型边界：功能图必须是图文功能说明版式，可使用大标题、编号、圆角卡片、短中文说明和必要对比画面；不要做完整场景图、普通卖点单图、实拍到货图或随机乱码。",
    scene: `图片类型边界：场景图要展示真实空间和安装关系；${SINGLE_SCENE_IMAGE_LOCK} 不要做卖点海报、细节拼版或随机文字。`,
    detail: allowPlannedText
      ? "图片类型边界：细节图只展示结构、材质、发光面或安装细节；允许规划好的短中文细节说明、材质标签和必要指示线，不要做完整空间场景或随机乱码。"
      : "图片类型边界：细节图只展示结构、材质、发光面或安装细节；不要做完整空间场景或随机文字。",
    real: "图片类型边界：实拍图要像真实拍摄，保持自然光影和可信质感；不要做海报排版或随机文字。"
  };
  return map[category] || "图片类型边界：只完成当前图片类型，不要混入其它类型表达或随机文字。";
}

function ensureConsistencyInPrompt(prompt, options = {}) {
  const text = stripBackendPromptLines(prompt);
  const category = resolveShotTask({
    category: options.category,
    title: options.title,
    prompt: text
  });
  const variationIndex = Number(options.variationIndex) > 0 ? Number(options.variationIndex) : 1;
  const chunks = [text].filter(Boolean);
  const joined = () => chunks.join("\n");
  if (!joined().includes("变化")) chunks.push(simpleVariationPrompt(category, variationIndex));
  if (!joined().includes("图片类型边界")) chunks.push(taskBoundaryVisibleLine(category, options));
  return chunks.filter(Boolean).join("\n\n");
}

function normalizeShotPromptOverrides(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => ({
      index: Number.isInteger(item?.index) ? item.index : index,
      id: String(item?.id || ""),
      category: String(item?.category || ""),
      prompt: String(item?.prompt || "").trim()
    }))
    .filter((item) => item.prompt);
}

function totalCountFromServerCounts(counts = {}) {
  return SHOT_CATEGORY_KEYS.reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
}

function applyShotPromptOverrides(plan, overrides, options = {}) {
  const templateReferenceCount = Number(options.templateReferenceCount || 0);
  const productWorkspace = isProductWorkspaceSettings(options.settings || {});
  const gptDesignSpecPlan = isGptProductDesignPlan(plan) || isGptDesignSpecSettings(options.settings || {});
  const profile = plan?.profile || {};
  if (!plan?.shots?.length || templateReferenceCount > 0) return plan;
  const normalized = normalizeShotPromptOverrides(overrides);
  if (!normalized.length) return plan;
  const byId = new Map(normalized.filter((item) => item.id).map((item) => [item.id, item]));
  const byIndex = new Map(normalized.map((item) => [item.index, item]));
  plan.shots = plan.shots.map((shot, index) => {
    const override = byId.get(shot.id) || byIndex.get(index);
    if (!override?.prompt) return shot;
    const category = resolveShotTask({ ...shot, category: override.category || shot.category, prompt: override.prompt });
    const prompt = gptDesignSpecPlan
      ? String(override.prompt || "").trim()
      : productWorkspace
      ? normalizeProductVisiblePrompt(override.prompt, category)
      : ensureConsistencyInPrompt(override.prompt, {
          templateReferenceCount,
          category,
          variationIndex: shotVariationIndex(shot, index)
        });
    return {
      ...shot,
      prompt,
      generationPrompt: gptDesignSpecPlan
        ? gptDesignSpecGenerationPrompt(prompt, plan.designSpec || {}, profile)
        : productWorkspace
        ? generationPromptForShotPrompt(prompt, { profile, category, settings: options.settings || {}, shot: { ...shot, prompt } })
        : shot.generationPrompt || ""
    };
  });
  return plan;
}

function normalizeClientGenerationPlan(value, { counts, settings, templateReferenceCount = 0 } = {}) {
  if (!value || !Array.isArray(value.shots) || !value.shots.length) return null;
  const expectedCount = totalCountFromServerCounts(counts || {});
  if (expectedCount > 0 && value.shots.length !== expectedCount) return null;
  const productWorkspace = isProductWorkspaceSettings(settings);
  const gptDesignSpecPlan = isGptProductDesignPlan(value) || isGptDesignSpecSettings(settings);
  const directSwap = Boolean(settings?.styleCloneMode && templateReferenceCount && (!settings.similarMode || settings.similarMode === "none"));
  const styleSimilar = Boolean(settings?.styleCloneMode && templateReferenceCount && settings.similarMode && settings.similarMode !== "none");
  const shots = value.shots
    .map((shot, index) => {
      const category = styleSimilar ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask(shot);
      const mergedShotForDirectSwap = {
        ...shot,
        referenceTarget:
          shot.referenceTarget && typeof shot.referenceTarget === "object"
            ? shot.referenceTarget
            : shot.referenceAnalysis && typeof shot.referenceAnalysis === "object"
              ? shot.referenceAnalysis
              : null
      };
      const prompt = directSwap
        ? directSwapVisiblePrompt(mergedShotForDirectSwap, value.profile || {}, settings)
        : styleSimilar
          ? ensureConsistencyInPrompt(styleSimilarVisiblePrompt({ ...mergedShotForDirectSwap, category }, settings, value.profile || {}, "", shot.prompt), {
              templateReferenceCount,
              category,
              title: shot.title,
              variationIndex: shotVariationIndex(shot, index),
              allowPlannedText: styleSimilarAllowsPlannedText(settings)
            })
          : gptDesignSpecPlan
            ? String(shot.prompt || "").trim()
            : productWorkspace
              ? normalizeProductVisiblePrompt(shot.prompt || "", category)
              : ensureConsistencyInPrompt(shot.prompt || "", {
                  templateReferenceCount,
                  category,
                  title: shot.title,
                  variationIndex: shotVariationIndex(shot, index)
                });
      const textOverlay = productWorkspace && settingsRequestNoVisibleText(settings) && !isCriticalDetailTextShot(shot, category)
        ? undefined
        : attachTextOverlayTheme(shot.textOverlay, value.profile || {}, { category, settings }) || undefined;
      const textRenderMode = textRenderModeForShot({ ...shot, category, textOverlay }, category, settings);
      const generationPrompt = gptDesignSpecPlan
        ? gptDesignSpecGenerationPrompt(prompt, value.designSpec || {}, value.profile || {})
        : productWorkspace
          ? generationPromptForShotPrompt(prompt, {
              profile: value.profile || {},
              category,
              settings,
              shot: { ...shot, prompt, textOverlay, textRenderMode }
            })
          : String(shot.generationPrompt || "").trim();
      return {
        id: String(shot.id || `${category}-${index + 1}`),
        category,
        title: String(
          directSwap
            ? directSwapTitleFromTarget(shot, mergedShotForDirectSwap, index)
            : styleSimilar
              ? styleSimilarTitle(settings.similarMode, index)
              : shot.title || categoryInstruction(category, index + 1, value.profile || {}, settings || {})
        ).trim(),
        description: String(
          directSwap
            ? isInfographicReferenceTarget(mergedShotForDirectSwap)
              ? ""
              : ""
            : styleSimilar
              ? styleSimilarDescription(settings.similarMode)
              : shot.description || ""
        ).trim(),
        ratio: String(shot.ratio || settings?.ratio || "3:4 绔栫増"),
        referenceIndex: Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : index,
        referenceTarget: mergedShotForDirectSwap.referenceTarget,
        userRevisionPrompt: String(shot.userRevisionPrompt || "").trim(),
        prompt,
        generationPrompt,
        textOverlay,
        textRenderMode,
        promptRoute: {
          ...(shot.promptRoute || {}),
          source: gptDesignSpecPlan ? "gpt-design-spec-plan" : styleSimilar ? "style-similar" : shot.promptRoute?.source || "client-confirmed",
          category,
          label: categoryLabel(category),
          planMode: gptDesignSpecPlan ? GPT_PRODUCT_PLAN_MODE : shot.promptRoute?.planMode
        },
        planMode: gptDesignSpecPlan ? GPT_PRODUCT_PLAN_MODE : shot.planMode,
        imageUrl: "",
        status: ""
      };
    })
    .filter((shot) => shot.prompt);
  if (productWorkspace && !gptDesignSpecPlan && productPlanUsesDetailNarrative(counts || {}, settings || {}) && !planHasDetailMethodologyNarrative({ shots })) {
    return null;
  }
  if (!shots.length) return null;
  return {
    profile: value.profile || {},
    designSpec: value.designSpec || buildDesignSpec(value.profile || {}, settings || {}, counts || normalizeCounts(), templateReferenceCount),
    analysis: value.analysis || {},
    promptDispatch: value.promptDispatch || value.analysis?.promptDispatch || {},
    counts,
    settings: gptDesignSpecPlan ? { ...(settings || {}), productPlanMode: GPT_PRODUCT_PLAN_MODE } : settings,
    shots
  };
}

function collagePromptFromSettings(settings = {}, layout = "", fileCount = 0) {
  const collageSettings = { ...settings, collageUserPrompt: layout || settings?.collageUserPrompt || "", collageSourceCount: fileCount || settings?.collageSourceCount || 0 };
  return [
    directCollagePrompt(collageSettings.collageUserPrompt, collageSettings, { sourceCount: fileCount }),
    collageDirectHardLockPrompt(collageSettings)
  ].filter(Boolean).join("\n\n");
}

function normalizeCollagePromptWriterOutput(prompt, fallbackPrompt = "") {
  const text = stripBackendPromptLines(prompt).replace(/\\n/g, "\n").trim();
  const fallback = fallbackPrompt || collageConversationPrompt({}, {});
  if (!text) return fallback;
  const compactHardLock =
    `Hard rules: place all uploaded products on one continuous warm light-gray background (${COLLAGE_BACKGROUND_SPEC}) unless the user explicitly requested another background; no added style, no different background colors, no panels/cards/grids/borders/text; preserve each product independently.`;
  const mustMentionLightGray = /warm light[-\s]?gray|light[-\s]?gray|light grey|浅灰|灰色|#e8e8e2|232,232,226/i.test(text);
  const mustMentionNoStyle = /no (decorative )?style|not a style/i.test(text);
  const mustMentionSingleBackground = /single continuous|same background|one.*background/i.test(text);
  if (!mustMentionLightGray || !mustMentionNoStyle || !mustMentionSingleBackground) {
    return [compactHardLock, text].filter(Boolean).join("\n\n");
  }
  return text;
}

async function writeCollagePromptWithGeminiVision({
  files = [],
  settings = {},
  fallbackPrompt = "",
  model,
  apiKey,
  baseUrl = "",
  providerName = "Gemini",
  useBearerAuth = false
}) {
  if (!apiKey || !files.length) return null;
  const prompt = [
    "You are the prompt-writing recognition model for a lamp collage tool.",
    "Look at all uploaded images. Treat each image as a separate lamp product that must appear independently in the final image.",
    "The downstream image model will receive these same uploaded product images together with your prompt, so refer to them as uploaded/input/source images instead of inventing new products.",
    "Write one concise executable image-generation prompt in JSON only.",
    "The prompt must say: put all uploaded products on one continuous light-gray background; do not add style; do not use different background colors; do not create panels, cards, grid cells, borders, separators, room scenes, poster graphics, or text; preserve each lamp product faithfully.",
    "If the user wrote a prompt, rewrite the final prompt according to the user's request, but keep the hard rules: one light-gray background, no added style, no different backgrounds, no text, no product fusion.",
    `User prompt: ${String(settings.collageUserPrompt || "").trim() || "(none)"}`,
    `Output ratio: ${settings.ratio || "1:1"}`,
    'Return JSON: {"prompt":"..."}'
  ].join("\n");
  const parts = [
    { text: prompt },
    ...files.slice(0, 8).flatMap((file, index) => [
      { text: `Uploaded product image ${index + 1}:` },
      {
        inlineData: {
          mimeType: file.mimetype || "image/png",
          data: file.buffer.toString("base64")
        }
      }
    ])
  ];
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.25,
        responseMimeType: "application/json"
      }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${providerName} collage prompt writer failed: HTTP ${response.status}`));
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = parseJsonFromText(text);
  return normalizeCollagePromptWriterOutput(parsed?.prompt || text, fallbackPrompt);
}

async function resolveCollageGenerationPrompt({
  db,
  files = [],
  settings = {},
  requestPrompt = "",
  modelOption = {},
  geminiChannel = {}
}) {
  const fallbackPrompt = collageConversationPrompt(settings, {
    fileCount: files.length,
    ratio: settings.ratio,
    userPrompt: settings.collageUserPrompt || requestPrompt
  });
  const appSettings = getAppSettings(db);
  const analysisModel = resolveAnalysisModel(appSettings.defaultAnalysisModel || DEFAULT_ANALYSIS_MODEL);
  const selectedGeminiModel = modelOption.provider === "gemini" ? modelOption.apiModel : "";
  const candidateModels = [selectedGeminiModel, analysisModel.id]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  let lastError = null;
  for (const model of candidateModels) {
    try {
      const prompt = await runWithModelChannelRetry(db, {
        purpose: "analysis",
        modelId: model,
        providerKind: "gemini",
        modelOption: { id: model, apiModel: model, provider: "gemini" }
      }, async (channel) => {
        const resolved = modelChannelGemini(channel);
        return writeCollagePromptWithGeminiVision({
          files,
          settings,
          fallbackPrompt,
          model,
          apiKey: resolved.apiKey,
          baseUrl: resolved.baseUrl,
          providerName: resolved.providerName,
          useBearerAuth: resolved.useBearerAuth
        });
      });
      if (prompt) return { prompt, source: "model-pool-vision-prompt", model };
    } catch (error) {
      lastError = error;
    }
    if (!geminiChannel.apiKey) break;
    try {
      const prompt = await writeCollagePromptWithGeminiVision({
        files,
        settings,
        fallbackPrompt,
        model,
        apiKey: geminiChannel.apiKey,
        baseUrl: geminiChannel.baseUrl,
        providerName: geminiChannel.providerName,
        useBearerAuth: geminiChannel.useBearerAuth
      });
      if (prompt) return { prompt, source: `${geminiChannel.providerName || "Gemini"}-vision-prompt`, model };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    prompt: fallbackPrompt,
    source: "local-collage-conversation",
    model: "",
    warning: lastError instanceof Error ? lastError.message : ""
  };
}

function buildCollageGenerationPlan({ settings = {}, counts = normalizeCounts(), layout = "", files = [] } = {}) {
  const prompt = collageConversationPrompt(settings, {
    fileCount: files.length,
    ratio: settings.ratio,
    userPrompt: layout || settings.collageUserPrompt || ""
  });
  const collageCounts = { main: 0, selling: 1, function: 0, scene: 0, detail: 0, real: 0, ...counts, selling: 1 };
  return {
    profile: {},
    designSpec: buildDesignSpec({}, settings, collageCounts, 0),
    analysis: { source: "collage-template", warning: "" },
    promptDispatch: { source: "collage-template", warning: "" },
    counts: collageCounts,
    settings,
    shots: [
      {
        id: "lamp-collage-room-labels",
        category: "selling",
        title: "",
        description: "",
        ratio: String(settings.ratio || "1:1 方图"),
        referenceIndex: 0,
        prompt,
        promptRoute: { source: "collage-template", category: "selling", label: "拼图" },
        imageUrl: "",
        status: ""
      }
    ]
  };
}

app.post("/api/jobs/product-suite/shot", requireAuth, suiteUpload, async (req, res) => {
  const files = req.files?.photos || [];
  const templateReferences = req.files?.templateReferences || [];
  if (!files.length) {
    res.status(400).json({ error: "请至少上传 1 张产品图" });
    return;
  }

  const settings = safeJson(req.body.settings, {});
  const product = safeJson(req.body.product, {});
  const requestProfile = applySelectedLampCategory(inferProductProfile(product, files), settings);
  if (isCollageTemplateSettings(settings)) {
    settings.collageSourceCount = Math.max(0, Math.min(6, Number(settings.collageSourceCount || files.length) || files.length));
  }
  const mode = String(settings.mode || "demo");
  const appSettings = getAppSettings(req.db);
  const requestedModelId = settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL;
  const modelOption = resolveModel(requestedModelId);
  if (mode === "api" && !findModel(requestedModelId)) {
    res.status(400).json({ error: `Unknown image model: ${requestedModelId}` });
    return;
  }
  const cost = singleImageCreditEstimate(settings);
  const credits = cost.credits;
  const shotInput = safeJson(req.body.shot, {});
  const gptDesignSpecShot = isGptProductDesignShot(shotInput, settings);
  let prompt = gptDesignSpecShot
    ? String(req.body.prompt || "").trim()
    : isProductWorkspaceSettings(settings)
    ? normalizeProductVisiblePrompt(req.body.prompt, shotInput.category)
    : ensureConsistencyInPrompt(req.body.prompt, {
        templateReferenceCount: templateReferences.length,
        category: shotInput.category,
        title: shotInput.title,
        variationIndex: shotVariationIndex(shotInput, 0),
        allowPlannedText: styleSimilarAllowsPlannedText(settings)
      });
  if (!prompt.trim()) {
    void 0;
    return;
  }
  const shotInputCategory = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask(shotInput);
  const allowSmallLampHeroOverlay = isProductWorkspaceSettings(settings)
    && isSmallLampGeneration(requestProfile, settings)
    && !isCollageTemplateSettings(settings)
    && ["hero-atmosphere", "core-advantages"].includes(String(shotInput.promptRoute?.sequenceSlot || shotInput.sequenceSlot || ""));
  const disableSmallLampDetailOverlay = isProductWorkspaceSettings(settings)
    && isSmallLampGeneration(requestProfile, settings)
    && !isCollageTemplateSettings(settings)
    && (shotInput.promptRoute?.source === "small-lamp-detail-strategy" || shotInput.promptRoute?.sequenceSlot)
    && !allowSmallLampHeroOverlay
    && !isCriticalDetailTextShot(shotInput, shotInputCategory);
  const productWorkspaceNoText = isProductWorkspaceSettings(settings) && settingsRequestNoVisibleText(settings) && !isCriticalDetailTextShot(shotInput, shotInputCategory);
  const shouldRewriteProductModelTextPrompt = isProductWorkspaceSettings(settings) && (
    Boolean(shotInput.textOverlay) ||
    productWorkspaceNoText ||
    /模型直接排版|文字由生图模型直接绘制/.test(String(shotInput.generationPrompt || ""))
  );
  const existingGenerationPrompt = String(shotInput.generationPrompt || "").trim();
  const shotTextOverlay = gptDesignSpecShot || productWorkspaceNoText || disableSmallLampDetailOverlay
    ? undefined
    : attachTextOverlayTheme(shotInput.textOverlay, requestProfile, { category: shotInput.category, settings }) || undefined;
  const shotTextRenderMode = gptDesignSpecShot ? "" : textRenderModeForShot({ ...shotInput, category: shotInputCategory, textOverlay: shotTextOverlay }, shotInputCategory, settings);
  const generationPrompt = gptDesignSpecShot
    ? gptDesignSpecGenerationPrompt(prompt, shotInput.designSpec || {}, requestProfile) || existingGenerationPrompt || prompt
    : isProductWorkspaceSettings(settings)
    ? (!shouldRewriteProductModelTextPrompt && !disableSmallLampDetailOverlay ? existingGenerationPrompt : "") || generationPromptForShotPrompt(prompt, {
        profile: requestProfile,
        category: shotInput.category,
        settings,
        shot: { ...shotInput, prompt, textOverlay: shotTextOverlay, textRenderMode: shotTextRenderMode }
      })
    : "";

  const geminiKey = effectiveGeminiKey(req.db);
  const apiyiKey = effectiveAPIYiKey(req.db);
  const yunwuKey = effectiveYunwuKey(req.db);
  const openAIChannel = openAICompatibleImageChannel(req.db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const openAICompatibleKey = openAIChannel.apiKey;
  const openAICompatibleBaseUrl = openAIChannel.baseUrl;
  const openAICompatibleName = openAIChannel.providerName;
  const geminiChannel = geminiGenerationChannel(req.db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const generationModelOption = modelOption;

  if (mode !== "api" || !effectiveRealOpenAIImages(req.db)) {
    void 0;
    return;
  }
  const hasPooledGenerationChannel = hasConfiguredModelChannel(req.db, {
    purpose: "generation",
    modelId: generationModelOption.id,
    modelOption: generationModelOption,
    providerKind: generationModelOption.provider === "openai" ? "openai-compatible" : "gemini"
  });
  if (generationModelOption.provider === "openai" && !openAICompatibleKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `Gemini-compatible API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }

  const chargeable = req.user.role !== "admin";
  if (chargeable && Number(req.user.balance || 0) < credits) {
    res.status(402).json({ error: USER_BALANCE_ERROR_MESSAGE, needCredits: credits, balance: req.user.balance });
    return;
  }
  if (lowConfidenceProductGenerationBlocked(settings, shotInput.analysis)) {
    void 0;
    return;
  }
  const cleanThenComposeCollage = isCleanThenComposeCollage(settings);
  const singleCallRetouchComposeCollage = isSingleCallRetouchComposeCollage(settings);
  if (isCollageTemplateSettings(settings)) {
    settings.collageResolvedPrompt = prompt;
    settings.collagePipelineUsed = cleanThenComposeCollage ? "clean-then-compose" : "single-call-retouch-compose";
  }
  let collagePromptMeta = null;
  if (isCollageTemplateSettings(settings) && !cleanThenComposeCollage && !singleCallRetouchComposeCollage) {
    try {
      collagePromptMeta = await resolveCollageGenerationPrompt({
        db: req.db,
        files: files.slice(0, 6),
        settings,
        requestPrompt: prompt,
        modelOption: generationModelOption,
        geminiChannel
      });
    } catch (error) {
      console.error("[product-suite/shot] collage prompt failed:", error);
      void 0;
      return;
    }
    prompt = collagePromptMeta.prompt;
    settings.collageResolvedPrompt = prompt;
    settings.collagePromptSource = collagePromptMeta.source;
    settings.collagePromptModel = collagePromptMeta.model;
  }
  const modelLease = ensureUserModelLease(req.db, req.user, generationModelOption.id, credits);
  const singleJobId = `shot_${Date.now()}`;
  const generationProviderName = generationModelOption.provider === "gemini" ? geminiChannel.providerName : openAICompatibleName;
  const shotReferenceIndex = Number.isFinite(Number(shotInput.referenceIndex))
    ? Number(shotInput.referenceIndex)
    : Number.isFinite(Number(shotInput.variationIndex))
      ? Math.max(0, Number(shotInput.variationIndex) - 1)
      : 0;
  const generationFiles = generationInputFiles(files, settings, templateReferences, shotInput, shotReferenceIndex);

  try {
    const shotStartedAt = Date.now();
    const singleShotGenerationContext = {
      account: req.user.account || req.user.phone || req.user.username,
      jobId: singleJobId,
      shotId: shotInput.id || "single-shot",
      shotCategory: shotInput.category || "",
      maxAttempts: 1,
      maxChannelAttempts: 1,
      maxActualApiAttempts: Math.max(1, Math.min(3, Number(settings.maxActualApiAttempts || settings.generationApiAttemptLimit || 3) || 3)),
      retryDelaysMs: []
    };
    let shotForGeneration = {
      ...shotInput,
      prompt,
      generationPrompt,
      textOverlay: shotTextOverlay,
      textRenderMode: shotTextRenderMode,
      ratio: shotInput.ratio || settings.ratio,
      category: shotInputCategory
    };
    const directGenerationArgs = {
      db: req.db,
      generationFiles,
      modelOption: generationModelOption,
      settings,
      geminiKey: geminiChannel.apiKey,
      geminiBaseUrl: geminiChannel.baseUrl,
      geminiProviderName: geminiChannel.providerName,
      geminiUseBearerAuth: geminiChannel.useBearerAuth,
      openAICompatibleKey,
      openAICompatibleBaseUrl,
      openAICompatibleName,
      profile: requestProfile,
      generationContext: singleShotGenerationContext
    };
    let generationResult = cleanThenComposeCollage
      ? await generateCatalogCollageImage({
          db: req.db,
          files: files.slice(0, 6),
          settings,
          modelOption: generationModelOption,
          geminiKey: geminiChannel.apiKey,
          geminiBaseUrl: geminiChannel.baseUrl,
          geminiProviderName: geminiChannel.providerName,
          geminiUseBearerAuth: geminiChannel.useBearerAuth,
          openAICompatibleKey,
          openAICompatibleBaseUrl,
          openAICompatibleName
        })
      : isCollageTemplateSettings(settings)
        ? await generateDirectCollageImage({
            db: req.db,
            files: files.slice(0, 6),
            generationFiles,
            settings,
            shot: shotForGeneration,
            modelOption: generationModelOption,
            geminiKey: geminiChannel.apiKey,
            geminiBaseUrl: geminiChannel.baseUrl,
            geminiProviderName: geminiChannel.providerName,
            geminiUseBearerAuth: geminiChannel.useBearerAuth,
            openAICompatibleKey,
            openAICompatibleBaseUrl,
            openAICompatibleName,
            profile: requestProfile
          })
        : await generateImageForShotDirect({
          shot: shotForGeneration,
          ...directGenerationArgs
        });
    if (!generationResult?.imageUrl) {
      throw new Error(noGeneratedImageMessage(generationModelOption.provider === "openai" ? openAICompatibleName : geminiChannel.providerName, generationModelOption));
    }
    let textQa = modelDirectTextQaResult({ imageUrl: generationResult.imageUrl, shot: shotForGeneration, settings });
    let textFallback = "";
    if (!cleanThenComposeCollage && !isCollageTemplateSettings(settings)) {
      const fallback = await maybeUseSvgTextFallback({
        generationResult,
        generationArgs: directGenerationArgs,
        shot: shotForGeneration,
        settings,
        profile: requestProfile
      });
      generationResult = fallback.generationResult;
      shotForGeneration = fallback.shot;
      textQa = fallback.textQa;
      textFallback = fallback.textFallback;
    }
    const collageHasLabels = isCollageTemplateSettings(settings)
      ? collageVisibleLabels({ ...settings, collageSourceCount: files.length }).length > 0
      : false;
    const variantTitle = shotForGeneration.title || shotInput.title || "generated-shot";
    const variantCategory = isCollageTemplateSettings(settings) ? "collage" : shotForGeneration.category || "image";
    const rawFinalImageUrl = isCollageTemplateSettings(settings)
      ? collageHasLabels
        ? generationResult.textImageUrl || generationResult.imageUrl
        : generationResult.noTextImageUrl || generationResult.imageUrl
      : generationResult.imageUrl;
    let finalImageUrl = "";
    let textImageUrl = generationResult.textImageUrl || "";
    let noTextImageUrl = generationResult.noTextImageUrl || "";
    let overlayApplied = Boolean(textImageUrl && noTextImageUrl && textImageUrl !== noTextImageUrl);
    let persistedTextMode = generationPromptTextMode(generationResult?.promptDebug?.textMode || "", shotForGeneration) || shotForGeneration.textRenderMode || "";
    if (isCollageTemplateSettings(settings)) {
      finalImageUrl = await persistGeneratedImageUrl(rawFinalImageUrl, {
        title: variantTitle,
        category: variantCategory
      });
      const persistVariant = async (imageUrl = "", category = "collage") => {
        if (!imageUrl) return "";
        if (imageUrl === rawFinalImageUrl) return finalImageUrl;
        return persistGeneratedImageUrl(imageUrl, { title: variantTitle, category });
      };
      if (textImageUrl && noTextImageUrl && textImageUrl === noTextImageUrl) {
        const persisted = await persistVariant(noTextImageUrl, "collage-no-text");
        textImageUrl = collageHasLabels ? persisted : "";
        noTextImageUrl = persisted;
      } else {
        textImageUrl = await persistVariant(textImageUrl, "collage-labels");
        noTextImageUrl = await persistVariant(noTextImageUrl, "collage-no-text");
      }
    } else {
      const persisted = await persistGeneratedShotImage({
        imageUrl: rawFinalImageUrl,
        shot: shotForGeneration,
        settings,
        title: variantTitle,
        category: variantCategory
      });
      finalImageUrl = persisted.imageUrl;
      textImageUrl = persisted.textImageUrl;
      noTextImageUrl = persisted.noTextImageUrl;
      overlayApplied = Boolean(persisted.overlayApplied);
      persistedTextMode = persisted.textMode || persistedTextMode;
    }
    const generationDebug = {
      ...(generationResult.promptDebug || {}),
      attempts: 1,
      actualApiAttempts: singleShotGenerationContext.actualApiAttempts || 0,
      channelAttempts: singleShotGenerationContext.actualChannelAttempts || 0,
      channelId: singleShotGenerationContext.lastChannelId || "",
      channelProvider: singleShotGenerationContext.lastChannelProvider || "",
      channelProviderName: singleShotGenerationContext.lastChannelProviderName || "",
      maxActualApiAttempts: singleShotGenerationContext.maxActualApiAttempts || 0,
      elapsedMs: Date.now() - shotStartedAt,
      provider: generationProviderName || "API",
      overlayApplied,
      textMode: persistedTextMode || generationResult?.promptDebug?.textMode || shotForGeneration.textRenderMode || "no-text",
      textQa,
      textFallback
    };

    if (chargeable) {
      req.user.balance = Number(req.user.balance || 0) - credits;
      consumeUserModelLease(modelLease, credits);
    }
    const shot = {
      ...shotInput,
      prompt,
      generationPrompt: shotForGeneration.generationPrompt || generationPrompt,
      textOverlay: shotForGeneration.textOverlay || shotTextOverlay,
      textRenderMode: shotForGeneration.textRenderMode,
      promptRoute: shotForGeneration.promptRoute || shotInput.promptRoute || {},
      promptMeta: collagePromptMeta || undefined,
      imageUrl: finalImageUrl,
      textImageUrl,
      noTextImageUrl,
      collagePipelineUsed: generationResult.collagePipelineUsed || settings.collagePipelineUsed || "",
      collageFallbackReason: generationResult.collageFallbackReason || "",
      generationDebug,
      status: "done",
      regeneratedAt: new Date().toISOString()
    };
    const job = {
      id: singleJobId,
      account: req.user.account || req.user.phone || req.user.username,
      status: "completed",
      mode,
      settings,
      credits: chargeable ? credits : 0,
      estimatedCredits: credits,
      cost,
      counts: {
        selling: shot.category === "selling" ? 1 : 0,
        function: shot.category === "function" ? 1 : 0,
        scene: shot.category === "scene" ? 1 : 0,
        detail: shot.category === "detail" ? 1 : 0,
        real: shot.category === "real" ? 1 : 0
      },
      model: generationModelOption,
      generationInput: generationInputSummary(generationFiles),
      apiKeyLease: modelLease ? publicLease(modelLease) : null,
      createdAt: new Date().toISOString(),
      shots: [shot],
      templateReferenceCount: templateReferences.length
    };
    req.db.jobs.unshift(job);
    pruneAccountGeneratedImageCache(req.db, job.account, generationWorkspaceKey(job));
    saveDb(req.db);
    res.json({ shot, user: publicUser(req.user), cost, model: generationModelOption });
  } catch (error) {
    console.error("[product-suite/shot] generation failed:", error);
    res.status(502).json({ error: userFriendlyGenerationError(error, "生图接口", req.user) });
  }
});

app.post("/api/jobs/style-text-edit", requireAuth, suiteUpload, async (req, res) => {
  const editBase = req.files?.editBase?.[0];
  const textRegion = req.files?.textRegion?.[0];
  if (!editBase) {
    void 0;
    return;
  }

  const settings = {
    ...safeJson(req.body.settings, {}),
    styleCloneMode: true,
    styleTextEditMode: true
  };
  const similarMode = String(settings.similarMode || "");
  if (!["selling", "detail"].includes(similarMode)) {
    void 0;
    return;
  }
  const textEditPrompt = String(req.body.textEditPrompt || "").trim();
  if (!textEditPrompt) {
    void 0;
    return;
  }

  const mode = String(settings.mode || "api");
  const appSettings = getAppSettings(req.db);
  const requestedModelId = settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL;
  const modelOption = resolveModel(requestedModelId);
  if (mode === "api" && !findModel(requestedModelId)) {
    res.status(400).json({ error: `Unknown image model: ${requestedModelId}` });
    return;
  }
  if (mode !== "api" || !effectiveRealOpenAIImages(req.db)) {
    void 0;
    return;
  }

  const geminiKey = effectiveGeminiKey(req.db);
  const apiyiKey = effectiveAPIYiKey(req.db);
  const yunwuKey = effectiveYunwuKey(req.db);
  const openAIChannel = openAICompatibleImageChannel(req.db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const openAICompatibleKey = openAIChannel.apiKey;
  const openAICompatibleBaseUrl = openAIChannel.baseUrl;
  const openAICompatibleName = openAIChannel.providerName;
  const geminiChannel = geminiGenerationChannel(req.db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const generationModelOption = modelOption;

  const hasPooledGenerationChannel = hasConfiguredModelChannel(req.db, {
    purpose: "generation",
    modelId: generationModelOption.id,
    modelOption: generationModelOption,
    providerKind: generationModelOption.provider === "openai" ? "openai-compatible" : "gemini"
  });
  if (generationModelOption.provider === "openai" && !openAICompatibleKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `Gemini-compatible API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }

  const cost = singleImageCreditEstimate(settings);
  const credits = cost.credits;
  const chargeable = req.user.role !== "admin";
  if (chargeable && Number(req.user.balance || 0) < credits) {
    res.status(402).json({ error: USER_BALANCE_ERROR_MESSAGE, needCredits: credits, balance: req.user.balance });
    return;
  }
  const modelLease = ensureUserModelLease(req.db, req.user, generationModelOption.id, credits);

  const shotInput = safeJson(req.body.shot, {});
  const shotForEdit = {
    ...shotInput,
    category: styleSimilarCategoryFromMode(similarMode),
    ratio: shotInput.ratio || settings.ratio,
    textRevisionPrompt: textEditPrompt,
    textRevisionRegion: shotInput.textRevisionRegion || null
  };
  const prompt = styleTextEditPrompt(textEditPrompt, shotForEdit, settings);
  const generationFiles = [
    {
      ...editBase,
      inputRole: "text-edit-base",
      inputIndex: 1,
      originalname: editBase.originalname || "generated-result.png"
    }
  ];
  if (textRegion) {
    generationFiles.push({
      ...textRegion,
      inputRole: "selected-text-region",
      inputIndex: 2,
      originalname: textRegion.originalname || "selected-text-region.png"
    });
  }

  try {
    const rawImageUrl = await generateImageForShot({
      prompt,
      files: generationFiles,
      modelOption: generationModelOption,
      ratio: shotForEdit.ratio || settings.ratio,
      clarity: settings.clarity,
      geminiKey: geminiChannel.apiKey,
      geminiBaseUrl: geminiChannel.baseUrl,
      geminiProviderName: geminiChannel.providerName,
      geminiUseBearerAuth: geminiChannel.useBearerAuth,
      openAICompatibleKey,
      openAICompatibleBaseUrl,
      openAICompatibleName,
      settings,
      generationContext: {
        db: req.db,
        account: req.user.account || req.user.phone || req.user.username,
        jobId: `text_edit_${Date.now()}`,
        shotId: shotForEdit.id || "text-edit",
        shotCategory: shotForEdit.category || "style-edit"
      }
    });
    const imageUrl = await persistGeneratedImageUrl(rawImageUrl, {
      title: shotForEdit.title || shotInput.title || "style-text-edit",
      category: shotForEdit.category || "style-edit"
    });

    if (chargeable) {
      req.user.balance = Number(req.user.balance || 0) - credits;
      consumeUserModelLease(modelLease, credits);
    }
    const shot = {
      ...shotForEdit,
      prompt: shotInput.prompt || "",
      imageUrl,
      status: "done",
      textEditedAt: new Date().toISOString()
    };
    const job = {
      id: `text_edit_${Date.now()}`,
      account: req.user.account || req.user.phone || req.user.username,
      status: "completed",
      mode,
      settings,
      credits: chargeable ? credits : 0,
      estimatedCredits: credits,
      cost,
      counts: { selling: similarMode === "selling" ? 1 : 0, detail: similarMode === "detail" ? 1 : 0 },
      model: generationModelOption,
      generationInput: generationInputSummary(generationFiles),
      apiKeyLease: modelLease ? publicLease(modelLease) : null,
      createdAt: new Date().toISOString(),
      shots: [shot],
      templateReferenceCount: 0
    };
    req.db.jobs.unshift(job);
    pruneAccountGeneratedImageCache(req.db, job.account, generationWorkspaceKey(job));
    saveDb(req.db);
    res.json({ shot, user: publicUser(req.user), cost, model: generationModelOption });
  } catch (error) {
    res.status(502).json({ error: userFriendlyGenerationError(error, generationModelOption.provider === "gemini" ? geminiChannel.providerName : openAICompatibleName, req.user) });
  }
});

app.post("/api/analyze-product", requireAuth, suiteUpload, async (req, res) => {
  const files = req.files?.photos || [];
  const templateReferences = req.files?.templateReferences || [];
  if (!files.length) {
    res.status(400).json({ error: "请至少上传 1 张产品图" });
    return;
  }
  const product = safeJson(req.body.product, {});
  const settings = safeJson(req.body.settings, {});
  const layout = String(req.body.layout || "");
  let counts = normalizeCounts(safeJson(req.body.counts, {}));
  if (!isProductWorkspaceSettings(settings) && wallLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = wallLampFullDetailCounts(counts);
  } else if (!isProductWorkspaceSettings(settings) && smallLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = smallLampFullDetailCounts(counts);
  } else if (!isProductWorkspaceSettings(settings) && largeLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = largeLampFullDetailCounts(counts);
  }
  const promptMode = String(req.body.promptMode || "");
  try {
    const plan = await buildAnalyzedSuitePlan({
      db: req.db,
      product,
      files,
      counts,
      layout,
      settings,
      templateReferences,
      promptMode
    });
    res.json({ ...plan });
  } catch (error) {
    console.error("[analyze-product] failed:", error);
    res.status(502).json({ error: userFriendlyServiceError(error, req.user, "真实灯具识别服务不可用") });
  }
});

app.post("/api/jobs/product-suite/stream", requireAuth, suiteUpload, async (req, res) => {
  const files = req.files?.photos || [];
  const templateReferences = req.files?.templateReferences || [];
  if (!files.length) {
    res.status(400).json({ error: "请至少上传 1 张产品图" });
    return;
  }

  let counts = normalizeCounts(safeJson(req.body.counts, {}));
  const product = safeJson(req.body.product, {});
  const settings = safeJson(req.body.settings, {});
  const layout = String(req.body.layout || "");
  if (!isProductWorkspaceSettings(settings) && wallLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = wallLampFullDetailCounts(counts);
  } else if (!isProductWorkspaceSettings(settings) && smallLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = smallLampFullDetailCounts(counts);
  } else if (!isProductWorkspaceSettings(settings) && largeLampDetailSuiteRequested(settings, layout || product.requirement || "")) {
    counts = largeLampFullDetailCounts(counts);
  }
  const clientPlan = normalizeClientGenerationPlan(safeJson(req.body.plan, null), {
    counts,
    settings,
    templateReferenceCount: templateReferences.length
  });
  const clientPlanSource = clientPlan?.analysis?.source || clientPlan?.promptDispatch?.source || "";
  const reusableClientPlan = clientPlan && !isLocalRecognitionFallbackSource(clientPlanSource) ? clientPlan : null;
  const shotPrompts = safeJson(req.body.shotPrompts, []);
  const mode = String(settings.mode || "demo");
  const appSettings = getAppSettings(req.db);
  const requestedModelId = settings.model || appSettings.defaultImageModel || DEFAULT_IMAGE_MODEL;
  const modelOption = resolveModel(requestedModelId);
  if (mode === "api" && !findModel(requestedModelId)) {
    res.status(400).json({ error: `Unknown image model: ${requestedModelId}` });
    return;
  }
  const cost = creditEstimate(counts, settings);
  const credits = cost.credits;
  const geminiKey = effectiveGeminiKey(req.db);
  const apiyiKey = effectiveAPIYiKey(req.db);
  const yunwuKey = effectiveYunwuKey(req.db);
  const openAIChannel = openAICompatibleImageChannel(req.db);
  const useAPIYi = Boolean(appSettings.apiyiEnabled && apiyiKey);
  const useYunwu = Boolean(appSettings.yunwuEnabled && yunwuKey);
  const openAICompatibleKey = openAIChannel.apiKey;
  const openAICompatibleBaseUrl = openAIChannel.baseUrl;
  const openAICompatibleName = openAIChannel.providerName;
  const geminiChannel = geminiGenerationChannel(req.db, { geminiKey, apiyiKey, useAPIYi, yunwuKey, useYunwu });
  const generationModelOption = modelOption;

  if (mode !== "api" || !effectiveRealOpenAIImages(req.db)) {
    void 0;
    return;
  }
  const hasPooledGenerationChannel = hasConfiguredModelChannel(req.db, {
    purpose: "generation",
    modelId: generationModelOption.id,
    modelOption: generationModelOption,
    providerKind: generationModelOption.provider === "openai" ? "openai-compatible" : "gemini"
  });
  if (generationModelOption.provider === "openai" && !openAICompatibleKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey && !hasPooledGenerationChannel) {
    res.status(400).json({
      error: `Gemini-compatible API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }

  const chargeable = req.user.role !== "admin";
  if (chargeable && Number(req.user.balance || 0) < credits) {
    res.status(402).json({ error: USER_BALANCE_ERROR_MESSAGE, needCredits: credits, balance: req.user.balance });
    return;
  }
  let basePlan = null;
  try {
    basePlan = reusableClientPlan || (isCollageTemplateSettings(settings)
      ? buildCollageGenerationPlan({ settings, counts, layout, files })
      : await buildAnalyzedSuitePlan({ db: req.db, product, files, counts, layout, settings, templateReferences }));
    if (lowConfidenceProductGenerationBlocked(settings, basePlan.analysis)) {
      void 0;
      return;
    }
  } catch (error) {
    console.error("[product-suite/stream] planning failed:", error);
    res.status(502).json({ error: userFriendlyServiceError(error, req.user, "真实灯具识别服务不可用") });
    return;
  }
  const modelLease = ensureUserModelLease(req.db, req.user, generationModelOption.id, credits);
  const plan = applyShotPromptOverrides(
    basePlan,
    shotPrompts,
    { templateReferenceCount: templateReferences.length, settings }
  );
  const totalShotCount = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const gptDesignSpecPlan = isGptProductDesignPlan(plan) || isGptDesignSpecSettings(settings);
  if (!gptDesignSpecPlan) {
    plan.profile = gateSmallLampSpecEvidence(enhanceSmallLampProfileFromHints(
      applyLargeLampProfileFromHints(
        applySelectedLampCategory(mergeProfileProduct(inferProductProfile(product, files), plan.profile || {}), settings),
        layout,
        product,
        settings
      ),
      layout,
      product,
      settings
    ), product, layout);
  }
  const localProductFallbackPlan = !gptDesignSpecPlan && isProductWorkspaceSettings(settings) && /^local-product/.test(String(plan.analysis?.source || plan.promptDispatch?.source || ""));
  if (localProductFallbackPlan && isSmallLampProfile(plan.profile, settings) && !/small-lamp-detail-strategy/.test(String(plan.analysis?.source || plan.promptDispatch?.warning || ""))) {
    const rewritten = applySmallLampDetailStrategy({
      shots: plan.shots || [],
      profile: plan.profile,
      counts,
      settings,
      files,
      userRequirement: layout
    });
    if (rewritten.applied) {
      plan.shots = rewritten.shots;
      plan.analysis = {
        ...(plan.analysis || {}),
        source: "small-lamp-detail-strategy",
        warning: [plan.analysis?.warning, "通用识别结果已按小灯提示兜底重写生成脚本"].filter(Boolean).join("；")
      };
      plan.promptDispatch = {
        ...(plan.promptDispatch || {}),
        source: "small-lamp-detail-strategy",
        warning: "small-lamp-detail-strategy"
      };
    }
  }
  if (localProductFallbackPlan && isLargeLampProfile(plan.profile, settings) && !isSmallLampProfile(plan.profile, settings) && !/large-lamp-detail-strategy/.test(String(plan.analysis?.source || plan.promptDispatch?.warning || ""))) {
    const rewritten = applyLargeLampDetailStrategy({
      shots: plan.shots || [],
      profile: plan.profile,
      counts,
      settings,
      userRequirement: layout
    });
    if (rewritten.applied) {
      plan.shots = rewritten.shots;
      plan.analysis = {
        ...(plan.analysis || {}),
        source: "large-lamp-detail-strategy",
        warning: [plan.analysis?.warning, "通用识别结果已按大灯提示兜底重写生成脚本"].filter(Boolean).join("；")
      };
      plan.promptDispatch = {
        ...(plan.promptDispatch || {}),
        source: "large-lamp-detail-strategy",
        warning: "large-lamp-detail-strategy"
      };
    }
  }
  if (localProductFallbackPlan && isWallLampProfile(plan.profile, settings) && !isSmallLampProfile(plan.profile, settings) && !isLargeLampProfile(plan.profile, settings) && !/wall-lamp-detail-strategy/.test(String(plan.analysis?.source || plan.promptDispatch?.warning || ""))) {
    const rewritten = applyWallLampDetailStrategy({
      shots: plan.shots || [],
      profile: plan.profile,
      counts,
      settings,
      userRequirement: layout
    });
    if (rewritten.applied) {
      plan.shots = rewritten.shots;
      plan.analysis = {
        ...(plan.analysis || {}),
        source: "wall-lamp-detail-strategy",
        warning: [plan.analysis?.warning, "通用识别结果已按壁灯提示兜底重写生成脚本"].filter(Boolean).join("；")
      };
      plan.promptDispatch = {
        ...(plan.promptDispatch || {}),
        source: "wall-lamp-detail-strategy",
        warning: "wall-lamp-detail-strategy"
      };
    }
  }
  const generationFiles = generationInputFiles(files, settings, templateReferences);
  const generationProviderName = generationModelOption.provider === "gemini" ? geminiChannel.providerName : openAICompatibleName;
  const concurrentJobs = generationConcurrency({ ...settings, totalShotCount }, generationProviderName);
  const jobId = `job_${Date.now()}`;
  const account = req.user.account || req.user.phone || req.user.username;
  const startedJob = {
    id: jobId,
    account,
    status: mode === "api" ? "generating" : "completed",
    mode,
    settings,
    credits: 0,
    estimatedCredits: credits,
    cost,
    counts,
    layout,
    model: generationModelOption,
    generationInput: generationInputSummary(generationFiles),
    apiKeyLease: modelLease ? publicLease(modelLease) : null,
    createdAt: new Date().toISOString(),
    ...plan
  };

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  writeJsonLine(res, { type: "plan", plan: startedJob });
  const stopHeartbeat = startJsonLineHeartbeat(res, { jobId });

  try {
    if (mode === "api") {
      let transientBatchFailures = 0;
      const maxShotAttempts = generationShotMaxAttempts(settings);
      const shotAttempts = new Array(startedJob.shots.length).fill(0);
      const maxActualApiAttemptsPerShot = Math.max(1, Math.min(3, Number(settings.maxActualApiAttempts || settings.generationApiAttemptLimit || 3) || 3));
      const shotActualApiAttempts = new Array(startedJob.shots.length).fill(0);
      let round = 0;
      let fatalBatchError = null;
      const pendingIndexes = () => startedJob.shots
        .map((shot, index) => ({ shot, index }))
        .filter(({ shot, index }) =>
          !shot.imageUrl &&
          shot.status !== "done" &&
          shotAttempts[index] < maxShotAttempts &&
          shotActualApiAttempts[index] < maxActualApiAttemptsPerShot
        )
        .map(({ index }) => index);

      while (!fatalBatchError) {
        const pending = pendingIndexes();
        if (!pending.length) break;
        round += 1;
        const firstRoundConcurrencyCap = concurrentJobs;
        const roundConcurrency = round > 1 || transientBatchFailures >= 2
          ? 1
          : Math.max(1, Math.min(concurrentJobs, firstRoundConcurrencyCap, pending.length));
        if (round > 1 || transientBatchFailures >= 2) {
          const waitMs = generationRoundPauseMs(round, transientBatchFailures);
          console.warn(`[product-suite/stream] reliable retry round job=${jobId} round=${round} pending=${pending.length} concurrency=${roundConcurrency} wait=${waitMs}ms transientFailures=${transientBatchFailures}`);
          writeJsonLine(res, { type: "batch-retry", round, pending: pending.length, concurrency: roundConcurrency, waitMs });
          await delay(waitMs);
        }

        await runWithConcurrency(pending, roundConcurrency, async (index) => {
          if (fatalBatchError) return;
          const shot = startedJob.shots[index];
          shotAttempts[index] += 1;
          const attempt = shotAttempts[index];
          const shotStartedAt = Date.now();
          if (attempt > 1) {
            writeJsonLine(res, {
              type: "shot-retry",
              index,
              total: startedJob.shots.length,
              id: shot.id,
              title: shot.title,
              attempt,
              maxAttempts: maxShotAttempts
            });
          }
          writeJsonLine(res, { type: "shot-start", index, total: startedJob.shots.length, id: shot.id, title: shot.title, attempt, maxAttempts: maxShotAttempts });
          let shotGenerationContext = null;
          try {
            const shotGenerationFiles = generationInputFiles(files, settings, templateReferences, shot, index);
            shotGenerationContext = {
              jobId,
              account,
              shotId: shot.id || `shot-${index + 1}`,
              shotCategory: shot.category || "",
              maxAttempts: 1,
              maxChannelAttempts: 1,
              actualApiAttempts: shotActualApiAttempts[index] || 0,
              maxActualApiAttempts: maxActualApiAttemptsPerShot,
              retryDelaysMs: []
            };
            let shotForGeneration = shot;
            const directGenerationArgs = {
              db: req.db,
              generationFiles: shotGenerationFiles,
              modelOption: generationModelOption,
              settings,
              geminiKey: geminiChannel.apiKey,
              geminiBaseUrl: geminiChannel.baseUrl,
              geminiProviderName: geminiChannel.providerName,
              geminiUseBearerAuth: geminiChannel.useBearerAuth,
              openAICompatibleKey,
              openAICompatibleBaseUrl,
              openAICompatibleName,
              profile: startedJob.profile || {},
              generationContext: shotGenerationContext
            };
            let generationResult = await generateImageForShotDirect({
              shot: shotForGeneration,
              ...directGenerationArgs
            });
            const fallback = await maybeUseSvgTextFallback({
              generationResult,
              generationArgs: directGenerationArgs,
              shot: shotForGeneration,
              settings,
              profile: startedJob.profile || {}
            });
            generationResult = fallback.generationResult;
            shotForGeneration = fallback.shot;
            const shotTitle = shot.title || `shot-${index + 1}`;
            const shotCategory = shot.category || "image";
            let overlayApplied = false;
            let persistedTextMode = generationResult?.promptDebug?.textMode || shotForGeneration.textRenderMode || "";
            if (isCollageTemplateSettings(settings)) {
              const rawImageUrl = await applyCollageLabelOverlay(generationResult.imageUrl, {
                ...settings,
                collageSourceCount: files.length
              });
              shot.imageUrl = await persistGeneratedImageUrl(rawImageUrl, {
                title: shotTitle,
                category: shotCategory
              });
            } else {
              const persisted = await persistGeneratedShotImage({
                imageUrl: generationResult.imageUrl,
                shot: shotForGeneration,
                settings,
                title: shotTitle,
                category: shotCategory
              });
              shot.imageUrl = persisted.imageUrl;
              shot.textImageUrl = persisted.textImageUrl;
              shot.noTextImageUrl = persisted.noTextImageUrl;
              overlayApplied = Boolean(persisted.overlayApplied);
              persistedTextMode = persisted.textMode || persistedTextMode;
            }
            shot.generationPrompt = shotForGeneration.generationPrompt || shot.generationPrompt;
            shot.textOverlay = shotForGeneration.textOverlay || shot.textOverlay;
            shot.textRenderMode = shotForGeneration.textRenderMode || shot.textRenderMode;
            shot.status = "done";
            shot.error = "";
            shot.generationAttempts = attempt;
            shot.generationDebug = {
              ...(generationResult.promptDebug || {}),
              attempts: attempt,
              actualApiAttempts: shotGenerationContext.actualApiAttempts || 0,
              channelAttempts: shotGenerationContext.actualChannelAttempts || 0,
              channelId: shotGenerationContext.lastChannelId || "",
              channelProvider: shotGenerationContext.lastChannelProvider || "",
              channelProviderName: shotGenerationContext.lastChannelProviderName || "",
              maxActualApiAttempts: shotGenerationContext.maxActualApiAttempts || 0,
              elapsedMs: Date.now() - shotStartedAt,
              provider: generationProviderName || "API",
              overlayApplied,
              textMode: persistedTextMode || generationResult?.promptDebug?.textMode || shotForGeneration.textRenderMode || "no-text",
              textQa: fallback.textQa,
              textFallback: fallback.textFallback
            };
            shotActualApiAttempts[index] = shotGenerationContext.actualApiAttempts || shotActualApiAttempts[index] || 0;
            transientBatchFailures = 0;
            console.info(
              `[product-suite/stream] shot ok: job=${jobId} shot=${shot.id || `shot-${index + 1}`} attempt=${attempt}/${maxShotAttempts} promptChars=${shot.generationDebug.promptChars || 0} elapsed=${shot.generationDebug.elapsedMs}ms textMode=${shot.generationDebug.textMode || "-"} overlayApplied=${shot.generationDebug.overlayApplied ? "yes" : "no"} channel=${shot.generationDebug.channelId || "-"} provider=${shot.generationDebug.channelProviderName || shot.generationDebug.provider || "API"} modules=${(shot.generationDebug.modules || []).join(",")}`
            );
            writeJsonLine(res, { type: "shot", index, total: startedJob.shots.length, shot, attempt, maxAttempts: maxShotAttempts });
          } catch (error) {
            const message = userFriendlyGenerationError(
              error,
              generationProviderName,
              req.user
            );
            const retryable = shouldRetryGenerationShot(error, attempt, maxShotAttempts);
            const fatal = isFatalGenerationError(error);
            if (fatal && !isGenerationAttemptBudgetError(error)) fatalBatchError = error;
            shot.status = "failed";
            shot.error = message;
            shot.generationAttempts = attempt;
            shot.generationDebug = {
              attempts: attempt,
              elapsedMs: Date.now() - shotStartedAt,
              provider: generationProviderName || "API",
              retryable,
              fatal,
              actualApiAttempts: shotGenerationContext?.actualApiAttempts || 0,
              channelAttempts: shotGenerationContext?.actualChannelAttempts || 0,
              maxActualApiAttempts: shotGenerationContext?.maxActualApiAttempts || 0,
              errorStatus: generationErrorStatus(error) || 0,
              errorMessage: message
            };
            shotActualApiAttempts[index] = shotGenerationContext?.actualApiAttempts || shotActualApiAttempts[index] || 0;
            if (isTransientGenerationError(error)) transientBatchFailures += 1;
            else transientBatchFailures = 0;
            console.error(
              `[product-suite/stream] shot failed: job=${jobId} shot=${shot.id || `shot-${index + 1}`} category=${shot.category || "-"} provider=${generationProviderName || "API"} attempt=${attempt}/${maxShotAttempts} retryable=${retryable} fatal=${fatal} transient=${isTransientGenerationError(error)} message=${message}`
            );
            writeJsonLine(res, { type: "shot-error", index, total: startedJob.shots.length, id: shot.id, error: message, attempt, maxAttempts: maxShotAttempts, retryable, willRetry: retryable && !fatal });
          }
        });
      }
      if (fatalBatchError) {
        const message = userFriendlyGenerationError(fatalBatchError, generationProviderName, req.user);
        startedJob.shots.forEach((shot, index) => {
          if (shot.status === "done" || shot.imageUrl) return;
          shot.status = "failed";
          shot.error = shot.error || message;
          shot.generationAttempts = shotAttempts[index] || 0;
        });
      }
    }

    const stats = shotResultStats(startedJob.shots);
    const chargedCredits = chargeable ? completedShotCreditCharge(cost, stats.done || 0) : 0;
    if (chargeable) {
      req.user.balance = Number(req.user.balance || 0) - chargedCredits;
      consumeUserModelLease(modelLease, chargedCredits);
    }
    const missingCount = Math.max(0, Number(stats.total || startedJob.shots.length || 0) - Number(stats.done || 0));
    const notFilledMessage = missingCount
      ? `生成未补齐：已完成 ${Number(stats.done || 0)}/${Number(stats.total || startedJob.shots.length || 0)} 张。${firstShotError(startedJob.shots, "部分图片多次重试后仍未返回可用图片。")}`
      : "";
    const job = {
      ...startedJob,
      status: missingCount ? "failed" : "completed",
      error: notFilledMessage,
      credits: chargedCredits,
      apiKeyLease: modelLease ? publicLease(modelLease) : null,
      shotStats: stats,
      completedAt: new Date().toISOString()
    };
    req.db.jobs.unshift(job);
    pruneAccountGeneratedImageCache(req.db, job.account, generationWorkspaceKey(job));
    saveDb(req.db);
    writeJsonLine(res, missingCount ? { type: "error", error: notFilledMessage, job, user: publicUser(req.user) } : { type: "complete", job, user: publicUser(req.user) });
    stopHeartbeat();
    res.end();
  } catch (error) {
    const job = {
      ...startedJob,
      status: "failed",
      error: userFriendlyServiceError(error, req.user, "生成失败"),
      completedAt: new Date().toISOString()
    };
    req.db.jobs.unshift(job);
    pruneAccountGeneratedImageCache(req.db, job.account, generationWorkspaceKey(job));
    saveDb(req.db);
    writeJsonLine(res, { type: "error", error: job.error, job, user: publicUser(req.user) });
    stopHeartbeat();
    res.end();
  }
});

app.get("/api/jobs/:id", requireAuth, (req, res) => {
  const job = req.db.jobs.find((item) => item.id === req.params.id);
  if (!job) {
    void 0;
    return;
  }
  res.json({ job });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function loadHttpsOptions() {
  if (!HTTPS_ENABLED) return null;
  try {
    return {
      key: fs.readFileSync(HTTPS_KEY_PATH),
      cert: fs.readFileSync(HTTPS_CERT_PATH)
    };
  } catch (error) {
    console.warn(
      `[https] LAMPS_HTTPS=1 but certificate files could not be loaded; falling back to HTTP. key=${HTTPS_KEY_PATH} cert=${HTTPS_CERT_PATH} error=${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  }
}

const httpsOptions = loadHttpsOptions();
const protocol = httpsOptions ? "https" : "http";
const server = httpsOptions ? https.createServer(httpsOptions, app) : app;

export {
  compactGenerationPrompt,
  detectPromptConflicts,
  applyLargeLampDetailStrategy,
  applySmallLampDetailStrategy,
  applyWallLampDetailStrategy,
  fallbackSmallLampProfileForLongDetailSuite,
  generationConcurrency,
  generationPromptDebug,
  generationInputRoleInstruction,
  generationInputRolePrompt,
  generationShotMaxAttempts,
  gateSmallLampSpecEvidence,
  openAIQuality,
  isFatalGenerationError,
  isTransientGenerationError,
  remainingGenerationApiAttempts,
  recognitionRequestPrompt,
  gptProductPlanTargets,
  productDesignSpecPlanRequestPrompt,
  promptWithinCharacterLimit,
  normalizeGptProductDynamicPrompt,
  gptDesignSpecGenerationPrompt,
  gptProductConsistencyBrief,
  productPlanRequestPrompt,
  productPlanTargetShots,
  normalizeProductPlanResult,
  buildLocalProductMethodologyPlan,
  buildProductWorkspaceDetailPlanFromRecognition,
  planHasDetailMethodologyNarrative,
  sanitizeRecognitionProfile,
  applyLargeLampProfileFromHints,
  applySelectedLampCategory,
  enhanceSmallLampProfileFromHints,
  smallLampDetailSequenceCatalog,
  wallLampDetailSequenceCatalog,
  smallLampProfileAudit,
  smallLampSanitizeEvidenceText,
  smallLampTrustedSellingText,
  productWorkspaceConsistencyPrompt,
  suiteStoryboardHiddenPrompt,
  applySuiteStoryboardStrategy,
  hiddenGenerationPrompt,
  textOverlayTheme,
  modelDirectHeroCoverArtDirection,
  repairDetailCoverPromptIfNeeded,
  shotTextOverlaySvgNodes,
  modelDirectTextQaResult,
  shouldRunSpatialLensVisualQa,
  localOverlayFallbackShot,
  textRenderModeForShot,
  largeLampGenerationPromptFromPlan,
  smallLampGenerationPromptFromPlan,
  wallLampGenerationPromptFromPlan
};

if (process.env.LAMPS_SKIP_SERVER_LISTEN !== "1") {
  server.listen(PORT, HOST, () => {
    console.log(`Lamp AI Commerce Web running at ${protocol}://localhost:${PORT}`);
    if (HOST === "0.0.0.0" || HOST === "::") {
      const lanUrls = Object.values(os.networkInterfaces())
        .flat()
        .filter((item) => item && item.family === "IPv4" && !item.internal)
        .map((item) => `${protocol}://${item.address}:${PORT}`);
      if (lanUrls.length) console.log(`LAN clients should open ${lanUrls.join(" or ")}`);
    }
  });
}
