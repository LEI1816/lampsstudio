import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
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
const analysisPlanCache = new Map();

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
  if (counts.main && !counts.selling && !counts.scene && !counts.detail && !counts.real) return "主图";
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
  const totalImages = shots.length || Number(job.counts?.main || 0) + Number(job.counts?.selling || 0) + Number(job.counts?.scene || 0) + Number(job.counts?.detail || 0) + Number(job.counts?.real || 0);
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
  return counts.main && !counts.selling && !counts.scene && !counts.detail && !counts.real ? "商品主图" : "详情图组";
}

function generationCategoryLabel(category = "") {
  const map = {
    main: "主图",
    selling: "卖点图",
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
  const keepPaths = new Set(retainedEntries.map(({ shot }) => generatedImageCachePathFromUrl(shot.imageUrl)).filter(Boolean));
  const deletedPaths = new Set();
  let mutated = false;

  entries.forEach(({ shot }) => {
    const keepPrimary = retained.has(shot);
    ["imageUrl", "textImageUrl", "noTextImageUrl"].forEach((field) => {
      const value = String(shot?.[field] || "");
      if (!value) return;
      const sameAsKeptPrimary = keepPrimary && value === String(shot.imageUrl || "");
      if (sameAsKeptPrimary) return;
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

function normalizeCounts(input = {}) {
  return {
    main: clampInt(input.main, 0, 6, 0),
    selling: clampInt(input.selling, 0, 15, 3),
    scene: clampInt(input.scene, 0, 15, 5),
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
    analysisModel: settings.analysisModel || DEFAULT_ANALYSIS_MODEL
  };
}

function analysisPlanCacheKey({ product = {}, files = [], counts = {}, layout = "", settings = {}, templateReferences = [], promptMode = "" } = {}) {
  const payload = {
    v: 3,
    product: stableJson(product),
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
  return false;
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

function apiYiIntelligenceModelCandidates(primaryModel = "", appSettings = {}) {
  return uniqueModelList([
    primaryModel || appSettings.defaultAnalysisModel
  ]);
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

function creditEstimate(counts, settings = {}) {
  const total = ["main", "selling", "scene", "detail", "real"].reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
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

const PRODUCT_CONSISTENCY_LOCK_LINES = [
  "产品一致性：以用户上传的灯具产品图为唯一主体来源，保留真实轮廓、比例、材质、颜色、发光面、吊线/吊杆/灯臂/底座/吸顶盘/安装结构。",
  "禁止改款、禁止融合多个灯具、禁止添加产品图里没有的零件，禁止把灯具变成其它品类。"
];

function sanitizeRecognitionProfile(profile = {}) {
  const functionText = String(profile.functionText || profile.function || "灯具电商产品图").trim();
  const sellingPoint = String(profile.sellingPoint || profile.sellingPoints || "清晰展示灯具外形、材质、发光面和安装结构").trim();
  return {
    productName: String(profile.productName || profile.name || "灯具产品").trim(),
    lampType: String(profile.lampType || profile.type || "灯具").trim(),
    lampSubtype: String(profile.lampSubtype || profile.subtype || "灯具").trim(),
    style: String(profile.style || "现代商用产品图").trim(),
    material: String(profile.material || "以上传图片为准").trim(),
    colorPalette: String(profile.colorPalette || profile.color || "以上传图片为准").trim(),
    functionText,
    function: functionText,
    targetSpace: String(profile.targetSpace || "电商商品图/详情页").trim(),
    installationPosition: String(profile.installationPosition || "以上传产品图可见结构为准").trim(),
    installationMethod: String(profile.installationMethod || "保留原始可见安装结构").trim(),
    lightUse: String(profile.lightUse || "装饰与功能照明").trim(),
    sellingPoint,
    sellingPoints: sellingPoint,
    structureKeywords: String(profile.structureKeywords || "灯体、发光面、安装结构、吊线、吊杆、灯臂、底座、吸顶盘").trim(),
    confidence: Number.isFinite(Number(profile.confidence)) ? Number(profile.confidence) : 0.8,
    requiresLampCategorySelection: Boolean(profile.requiresLampCategorySelection)
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

function selectedLampCategorySpec(settings = {}, product = {}) {
  const label = String(settings.lampCategoryLabel || product.lampCategoryLabel || product.lampType || "灯具").trim();
  return {
    value: String(settings.lampCategory || product.lampCategory || "auto"),
    label,
    type: String(product.lampType || "灯具"),
    subtype: String(product.lampSubtype || product.lampType || "灯具"),
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

function applySelectedLampCategory(product = {}, settings = {}) {
  if (!hasForcedLampCategory(settings, product)) return sanitizeRecognitionProfile(product);
  const spec = selectedLampCategorySpec(settings, product);
  return sanitizeRecognitionProfile({ ...product, lampType: spec.type, lampSubtype: spec.subtype || spec.type });
}

function categoryLabel(category) {
  const map = { main: "主图", selling: "卖点图", scene: "场景图", detail: "细节图", real: "实拍图", collage: "拼图" };
  return map[String(category || "")] || "图片";
}

function categoryDescription(category, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const map = {
    main: `干净展示 ${safeProfile.productName} 的完整灯具主体，适合电商首图。`,
    selling: `围绕 ${safeProfile.productName} 的一个核心卖点做清晰商品表达。`,
    scene: `把 ${safeProfile.productName} 放入真实室内空间，展示安装后的使用效果。`,
    detail: `近景展示 ${safeProfile.productName} 的材质、发光面、连接件或安装结构。`,
    real: `模拟真实拍摄质感，保留产品可信度和现场感。`,
    collage: `多张灯具主体统一白底拼装，产品互不重叠。`
  };
  return map[String(category || "")] || `生成 ${safeProfile.productName} 的电商商品图。`;
}

function categoryInstruction(category, index = 1, profile = {}, settings = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  const label = categoryLabel(category);
  const base = `${label} ${index}：`;
  const common = `主体必须是上传的 ${safeProfile.productName}，保留灯具真实外形、比例、材质、颜色、发光面、吊线/吊杆/灯臂/底座/吸顶盘/安装结构。`;
  if (category === "main") {
    return `${base}生成干净的电商主图，统一浅色或白色背景，完整展示灯具主体，构图居中，边缘自然，阴影柔和。${common}`;
  }
  if (category === "selling") {
    return `${base}围绕一个明确购买理由生成卖点图，画面要突出产品造型、材质、光效或安装优势，但不要生成随机文字、图标、价格、箭头或海报元素。${common}`;
  }
  if (category === "scene") {
    return `${base}生成真实室内场景图，让灯具按合理比例安装在适合的空间中，光照、透视、阴影自然，空间不要喧宾夺主。${common}`;
  }
  if (category === "detail") {
    return `${base}生成产品细节图，近景展示灯罩/灯臂/发光面/材质纹理/连接件/安装结构等真实细节，不能编造不存在的零件。${common}`;
  }
  if (category === "real") {
    return `${base}生成可信的实拍风格商品图，允许轻微真实拍摄质感，但产品仍要干净、清晰、可商用。${common}`;
  }
  if (category === "collage") {
    return `${base}${collageStrategyPrompt(settings)} ${common}`;
  }
  return `${base}生成灯具电商商品图。${common}`;
}

function selectedLampCategoryLabel(settings = {}, product = {}) {
  return selectedLampCategorySpec(settings, product).label;
}

function selectedLampCategoryPrompt(settings = {}, product = {}) {
  const spec = selectedLampCategorySpec(settings, product);
  return "已选择灯具类目：" + spec.label + "。生成时必须保留上传产品图里的真实结构。";
}

function selectedLampCategoryExecutionPrompt(settings = {}, product = {}) {
  return selectedLampCategoryPrompt(settings, product);
}

function styleCloneStrategy(settings = {}) {
  return {
    cloneStrength: settings.cloneStrength || "standard",
    backgroundLock: settings.backgroundLock || "standard",
    positionLock: settings.positionLock || "standard",
    styleConsistency: settings.styleConsistency || "standard"
  };
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
  return options.direct
    ? "直接替换参考图：只借用参考图的画面结构和风格方向，主体必须替换为用户上传的灯具。"
    : "相似图参考：只借用参考图的构图、氛围或表达方式，产品身份必须来自用户上传的灯具。";
}

function collageStrategyPrompt(settings = {}) {
  if (isSingleCallRetouchComposeCollage(settings)) {
    return "拼图流程：一次模型调用内完成所有上传图的灯具主体提取、精修、去背景，并放到同一个纯白方形画布中；文字标签由本地后处理叠加，不交给模型生成。";
  }
  return "拼图流程：每个上传产品保持独立主体，保留真实结构，使用统一连续背景，不要卡片、边框、分隔线、logo、水印或随机文字。";
}

function workspaceStrategyPrompt(settings = {}) {
  if (isCollageTemplateSettings(settings)) return collageStrategyPrompt(settings);
  if (settings.styleCloneMode) return styleCloneStrategyPrompt(settings, { direct: isDirectStyleCloneSettings(settings) });
  return "商品图流程：以上传灯具为唯一主体来源，生成干净、清晰、可商用的电商图片。";
}

function resolveShotTask(shot = {}) {
  const value = String(shot.category || shot.task || "").toLowerCase();
  if (["main", "selling", "scene", "detail", "real"].includes(value)) return value;
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

function referenceTargetText() {
  return "";
}

function referenceTargetConstraintPrompt() {
  return "";
}

function referenceTargetLightState() {
  return "off";
}

function styleSimilarModeLabel(mode = "") {
  const map = { scene: "相似场景图", selling: "相似卖点图", detail: "相似细节图", real: "相似实拍图", none: "直接替换" };
  return map[String(mode || "none")] || "相似参考图";
}

function styleSimilarCategoryFromMode(mode = "") {
  const value = String(mode || "").toLowerCase();
  if (["scene", "selling", "detail", "real"].includes(value)) return value;
  return "scene";
}

function styleSimilarMode(settings = {}) {
  return String(settings?.similarMode || settings?.styleSimilarMode || "").trim();
}

function isDirectStyleCloneSettings(settings = {}) {
  return Boolean(settings?.styleCloneMode && (!styleSimilarMode(settings) || styleSimilarMode(settings) === "none"));
}

function isStyleSimilarSettings(settings = {}) {
  return Boolean(styleSimilarMode(settings));
}

function selectedTemplateReference(templateReferences = [], shot = {}, shotIndex = 0) {
  if (!templateReferences.length) return null;
  const candidateIndex = Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : Number(shotIndex) || 0;
  const referenceIndex = Math.max(0, Math.min(candidateIndex, templateReferences.length - 1));
  return { file: templateReferences[referenceIndex], referenceIndex };
}

function buildPromptsFromProfile(product = {}, counts = {}, settings = {}) {
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
        prompt: [
          categoryInstruction(category, index, profile, settings),
          PRODUCT_CONSISTENCY_LOCK_LINES.join("\n")
        ].join("\n\n"),
        status: "pending",
        variationIndex: index
      });
    }
  };
  add("main", counts.main);
  add("selling", counts.selling);
  add("scene", counts.scene);
  add("detail", counts.detail);
  add("real", counts.real);
  return shots;
}

function buildLocalProductPlan(product = {}, files = [], counts = {}, settings = {}) {
  const profile = inferProductProfile(product, files);
  return { product: profile, shots: buildPromptsFromProfile(profile, counts, settings), source: "local" };
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
  return [
    "你是灯具电商图产品识别模型。请观察用户上传的灯具图片，返回 JSON，不要写解释。",
    "必须基于图片真实可见信息，不要编造图片里没有的结构。",
    "识别字段：productName, lampType, lampSubtype, style, material, colorPalette, functionText, targetSpace, installationPosition, installationMethod, lightUse, sellingPoint, structureKeywords, confidence。",
    "如果用户补充了要求，只能作为命名或偏好参考，不能覆盖图片事实。",
    `用户补充要求：${String(layout || product.requirement || "").trim() || "无"}`,
    '返回格式：{"productName":"...","lampType":"...","lampSubtype":"...","style":"...","material":"...","colorPalette":"...","functionText":"...","targetSpace":"...","installationPosition":"...","installationMethod":"...","lightUse":"...","sellingPoint":"...","structureKeywords":"...","confidence":0.8}'
  ].join("\n");
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

async function analyzeStyleCloneWithRealModel(args = {}) {
  return analyzeProductWithRealModel(args);
}

function promptPlannerRequest(plan = {}, layout = "", templateReferenceCount = 0) {
  const profile = sanitizeRecognitionProfile(plan.profile || {});
  const shots = (plan.shots || []).map((shot, index) => ({
    id: shot.id || `shot-${index + 1}`,
    category: resolveShotTask(shot),
    title: shot.title || `${categoryLabel(resolveShotTask(shot))} ${index + 1}`,
    description: shot.description || "",
    currentPrompt: shot.prompt || ""
  }));
  return [
    "你是灯具电商图提示词规划模型。请基于产品识别结果和用户上传图片，为每张目标图重写可执行生图提示词。",
    "返回 JSON，不要解释。每张图必须保留真实灯具主体、结构、材质、比例、发光面、吊线/吊杆/灯臂/底座/吸顶盘/安装结构。",
    "所有 title、description、prompt 字段都必须使用简体中文。不要输出英文提示词，不要用 image_0.png、image_1.png 这类文件名描述产品。",
    "prompt 要写给生图模型执行，但仍然必须是中文；可以包含必要的产品结构词、画面构图、光线、背景、镜头要求。",
    "禁止改款、禁止新增图片里没有的零件、禁止随机文字/logo/水印/价格/箭头/UI 元素。",
    `产品识别：${JSON.stringify(profile)}`,
    `用户要求：${String(layout || "").trim() || "无"}`,
    `参考图数量：${Number(templateReferenceCount || 0)}`,
    `目标图片：${JSON.stringify(shots)}`,
    '返回格式：{"shots":[{"id":"...","category":"main|selling|scene|detail|real","title":"中文标题","description":"中文说明","prompt":"中文生图提示词"}]}'
  ].join("\n");
}

function isMostlyEnglishPrompt(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 80 && latin > chinese * 3;
}

function chinesePromptFallback(shot = {}, category = "", layout = "", profile = {}) {
  const base = String(shot.prompt || "").trim();
  const safeCategory = category || resolveShotTask(shot);
  const fallback = [
    base || categoryInstruction(safeCategory, shotVariationIndex(shot, 0), profile),
    layout ? `用户补充要求：${layout}` : "",
    "画面要求：商业化、干净、清晰，主体完整；不要生成随机文字、logo、水印、价格、箭头或 UI 元素。"
  ].filter(Boolean).join("\n\n");
  return fallback;
}

function normalizePromptPlannerResult(payload, plan, templateReferenceCount = 0, layout = "") {
  const incoming = Array.isArray(payload?.shots) ? payload.shots : [];
  if (!incoming.length) return null;
  const byId = new Map(incoming.filter((shot) => shot?.id).map((shot) => [String(shot.id), shot]));
  const shots = (plan.shots || []).map((shot, index) => {
    const planned = byId.get(String(shot.id || "")) || incoming[index] || {};
    const category = resolveShotTask({ ...shot, category: planned.category || shot.category, prompt: planned.prompt || shot.prompt });
    const plannedPrompt = String(planned.prompt || "").trim();
    const prompt = isMostlyEnglishPrompt(plannedPrompt)
      ? chinesePromptFallback(shot, category, layout, plan.profile || {})
      : String(plannedPrompt || shot.prompt || "").trim();
    if (!prompt) return shot;
    const userLine = templateReferenceCount === 0 && layout && !prompt.includes(layout)
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
  templateReferences = []
} = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const endpoint = useBearerAuth
    ? `${String(baseUrl || "https://api.apiyi.com/v1beta").replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = useBearerAuth
    ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }
    : { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  const parts = [
    { text: promptPlannerRequest(plan, layout, templateReferenceCount) },
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

async function planPromptsWithAPIYi({ plan, layout, templateReferenceCount = 0, model, apiKey, baseUrl, providerName = "API易", files = [], templateReferences = [] } = {}) {
  if (!apiKey) throw new Error(`${providerName} API key 未配置`);
  const content = [
    { type: "text", text: promptPlannerRequest(plan, layout, templateReferenceCount) },
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
    const refined = normalizePromptPlannerResult(result, plan, templateReferenceCount, layout);
    if (!refined) return null;
    return {
      ...refined,
      promptDispatch,
      analysis: { ...(analysis || plan.analysis || {}), promptDispatch }
    };
  };

  if (geminiKey && isGeminiAnalysisModel(analysisModel)) {
    try {
      const result = await planPromptsWithGemini({ plan, layout, templateReferenceCount, model: analysisModel.id, apiKey: geminiKey, providerName: "Gemini", files, templateReferences });
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
          templateReferences
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
        templateReferences
      });
      const refined = tryNormalize(result, { source: `${geminiChannel.providerName || "Gemini"}-image-model-dispatch`, model: selectedGeminiPlanningModel, warning: "" });
      if (refined) return refined;
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (isProductWorkspaceSettings(settings)) {
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

const PRODUCT_CONSISTENCY_COMPACT_PROMPT = PRODUCT_CONSISTENCY_LOCK_LINES.join("\n");
const PRODUCT_CONSISTENCY_LOCK_PROMPT = PRODUCT_CONSISTENCY_LOCK_LINES.join("\n");
const INSTALLATION_PHYSICS_PROMPT = "安装物理规则：灯具安装方向、吊线/吊杆/底座/吸顶盘、阴影、比例和透视必须合理。";
const STYLE_SIMILAR_PHYSICS_COMPACT_PROMPT = "相似图规则：只借用参考图方向，产品身份和结构必须来自上传灯具。";
const LIGHTING_PHYSICS_PROMPT = "光照规则：灯光和阴影自然、干净、商业化，并与产品结构一致。";

function categoryBoundaryPrompt(category = "") {
  return `图片类型锁定：本张是「${categoryLabel(category)}」任务，只完成对应类型，不要混入其它图片类型的表达。`;
}

function productWorkspaceConsistencyPrompt(category = "", profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    `产品一致性要求（${categoryLabel(category)}）：`,
    `产品：${safeProfile.productName}`,
    `灯具类型：${safeProfile.lampType} / ${safeProfile.lampSubtype}`,
    `必须保留的结构：${safeProfile.structureKeywords}`,
    PRODUCT_CONSISTENCY_LOCK_LINES.join(" ")
  ].join("\n");
}

function productStrategyPrompt(settings = {}, profile = {}) {
  const safeProfile = sanitizeRecognitionProfile(profile);
  return [
    "灯具商品图策略：",
    `以用户上传图作为 ${safeProfile.productName} 的唯一身份来源。`,
    `材质/颜色：${safeProfile.material}；${safeProfile.colorPalette}。`,
    "不要添加上传产品图里不可见的零件或装饰。"
  ].join("\n");
}

function styleSimilarHiddenPrompt(settings = {}, shot = {}, profile = {}) {
  if (!isStyleSimilarSettings(settings)) return "";
  return [
    `相似图模式：${styleSimilarModeLabel(settings.similarMode)}。`,
    "参考图只用于构图/氛围/表达方式，不作为产品身份来源。",
    productWorkspaceConsistencyPrompt(resolveShotTask(shot), profile)
  ].join("\n");
}

function directSwapGenerationPrompt(shot = {}, extra = "", settings = {}) {
  return [
    String(shot.prompt || "").trim(),
    "DIRECT SUBJECT REPLACEMENT TASK.",
    "Input image 1 is the reference canvas only: keep its background, room, layout, camera angle, lighting mood, composition, crop, and visual style.",
    "Input image 2 is the replacement lamp identity source: the final visible lamp/product must come from input image 2, preserving its real shape, material, color, arms, shades, wires, base/canopy, and installation structure.",
    "Find the original lamp/product subject in input image 1 and replace that subject with the lamp from input image 2 in the same visual slot.",
    "Do not keep the original lamp/product from input image 1. Do not return input image 1 unchanged.",
    "Blend the replacement lamp naturally into the reference scene with matching perspective, scale, contact points, shadows, and lighting.",
    "Do not add extra lamps, redesign the replacement lamp, add random text, logos, watermarks, price tags, arrows, icons, or unrelated props.",
    "直接替换任务：如有参考图，保留参考画面的构图和风格，只把灯具/产品主体替换为用户上传的灯具。",
    extra,
    workspaceStrategyPrompt(settings)
  ].filter(Boolean).join("\n\n");
}

function directSwapVisiblePrompt(shot = {}) {
  if (isInfographicReferenceTarget(shot)) {
    return [
      "参考图详情版式换主体：保留参考图的海报版式、文字区域、分区、边框、箭头、图标、背景和排版节奏。",
      "只替换参考图中的灯具/产品主体槽位为用户上传的灯具，保持原槽位的角度、尺寸关系、裁切方式和视觉层级。",
      "不要重写海报文案，不要新增随机文字、logo、水印、价格或无关装饰。"
    ].join("\n");
  }
  return [
    "参考图直接换主体：保留参考图的场景、构图、镜头角度、光影、色调、空间关系和整体风格。",
    "只把参考图中的原灯具/产品主体替换为用户上传产品图里的灯具，灯具结构、材质、颜色和安装方式必须来自上传产品。",
    "不要改变参考图的背景空间，不要新增灯具零件，不要生成随机文字、logo、水印、价格或无关道具。"
  ].join("\n");
}

function styleSimilarVisiblePrompt(shot = {}, settings = {}, profile = {}, extra = "", fallbackPrompt = "") {
  return [
    fallbackPrompt || shot.prompt || "",
    `为用户上传的灯具生成一张「${styleSimilarModeLabel(settings.similarMode)}」。`,
    productWorkspaceConsistencyPrompt(resolveShotTask(shot), profile),
    extra
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
  const total = ["main", "selling", "scene", "detail", "real"].reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
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
          `结构重点：${safeProfile.structureKeywords}`
        ]
      },
      {
        title: "生成规则",
        lines: [
          PRODUCT_CONSISTENCY_LOCK_LINES.join(" "),
          templateReferenceCount ? `参考图：已上传 ${templateReferenceCount} 张，仅作构图/风格参考` : "参考图：未上传参考图，直接按产品图生成",
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
    if (cached) return cached;
  }

  const layoutOverrides = extractProfileOverridesFromLayout(layout);
  const baseProduct = applySelectedLampCategory(mergeProfileProduct(product, layoutOverrides), settings);
  const realAnalysis = settings?.styleCloneMode
    ? {
        product: inferProductProfile(baseProduct, files),
        analysis: {
          source: "style-local-plan",
          model: "",
          warning: "风格复刻跳过额外产品分析，直接使用上传产品图和参考图进入图生图。"
        }
      }
    : await analyzeProductWithRealModel({ db, product: baseProduct, files, layout, settings });
  const profile = applySelectedLampCategory(mergeProfileProduct(baseProduct, realAnalysis.product), settings);
  const userRequirement = String(product.requirement || layout || "").trim();
  const shots = buildPromptsFromProfile(profile, normalizedCounts, settings).map((shot, index) => {
    const category = resolveShotTask(shot);
    const prompt = [
      shot.prompt,
      userRequirement ? `用户补充要求：${userRequirement}` : "",
      productWorkspaceConsistencyPrompt(category, profile),
      productStrategyPrompt(settings, profile),
      workspaceStrategyPrompt(settings),
      templateReferences.length ? `参考图规则：已上传 ${templateReferences.length} 张参考图，只能在适用时借用构图、空间、光线或风格，不要把参考图里的灯具当成产品主体。` : "",
      "输出要求：画面干净，主体清晰，适合电商商品图/详情页；不要随机文字、logo、水印、价格、UI 元素、箭头或无关道具。"
    ].filter(Boolean).join("\n\n");
    return {
      ...shot,
      category,
      ratio: String(settings.ratio || shot.ratio || "3:4 竖版"),
      referenceIndex: index,
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
  const basePlan = {
    profile,
    designSpec: buildDesignSpec(profile, settings, normalizedCounts, templateReferences.length),
    analysis,
    promptDispatch: { source: "one-step-gpt-analysis", model: analysis.model || analysisModel.id, warning: "" },
    counts: normalizedCounts,
    settings,
    shots
  };
  if (isProductWorkspaceSettings(settings) || settings?.styleCloneMode) {
    const result = clonePlan(basePlan);
    if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
    return result;
  }
  const result = await dispatchShotPrompts({
    db,
    plan: basePlan,
    layout: userRequirement,
    settings,
    templateReferenceCount: templateReferences.length,
    analysis,
    files,
    templateReferences
  });
  if (usePlanCache) writeAnalysisPlanCache(cacheKey, result);
  return clonePlan(result);
}

function isCollageTemplateSettings(settings = {}) {
  return String(settings?.template || "") === "lamp-collage-room-labels";
}

function isCleanThenComposeCollage(settings = {}) {
  return false;
}

function isSingleCallRetouchComposeCollage(settings = {}) {
  return isCollageTemplateSettings(settings) && String(settings?.collagePipeline || "") === "single-call-retouch-compose";
}

function collageBackgroundSpec(settings = {}) {
  return isSingleCallRetouchComposeCollage(settings) ? "#ffffff / RGB 255,255,255" : COLLAGE_BACKGROUND_SPEC;
}

const COLLAGE_BACKGROUND_HEX = "#f0f0ee";
const COLLAGE_BACKGROUND_RGB = "240,240,238";
const COLLAGE_BACKGROUND_SPEC = `${COLLAGE_BACKGROUND_HEX} / RGB ${COLLAGE_BACKGROUND_RGB}`;

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

function collageHasExplicitBackgroundPrompt(text = "") {
  const value = String(text || "").trim();
  if (!value) return false;
  return /(背景|底色|底图|画布|灰底|白底|黑底|米色|蓝色|红色|绿色|黄色|粉色|紫色|透明|渐变|#(?:[0-9a-f]{3}){1,2}\b|rgb\s*\()/i.test(value);
}

function collageLabelLockPrompt(labels = []) {
  if (!labels.length) {
    return [
      "COLLAGE LABEL LOCK: this is a no-text collage.",
      "The final image must contain zero visible text: no Chinese, English, numbers, room names, captions, logos, watermarks, UI text, or decorative words."
    ].join("\n");
  }
  const mapping = labels.map((item) => `source image ${item.index} = \"${item.name}\"`).join("; ");
  return [
    "COLLAGE LABEL LOCK: the app will add labels after image generation; the image model must not draw any text.",
    `Allowed visible label mapping: ${mapping}.`,
    "Reserve clean empty space directly below each labeled lamp so the app can place one dark gray rounded pill label there.",
    "Do not render label text, room names, captions, logos, watermarks, UI text, decorative words, placeholder text, or any random glyphs in the generated image."
  ].join("\n");
}

function collageSlotLayoutPrompt(settings = {}) {
  const count = Math.max(2, Math.min(6, Number(settings?.collageSourceCount || 0) || 2));
  const hasLabels = collageVisibleLabels(settings).length > 0;
  const layouts = {
    2: "2 products: two balanced columns, label-safe zones below each product at about 68% canvas height.",
    3: "3 products: either one tidy row or a 2+1 rhythm; every product has a clear label-safe zone directly below it.",
    4: "4 products: two clean rows of two products, with generous vertical spacing for label-safe zones.",
    5: "5 products: two products on the top row and three products on the bottom row, like a clean catalog sheet.",
    6: "6 products: two clean rows of three products, evenly balanced with invisible slots."
  };
  return [
    "COLLAGE SLOT LAYOUT:",
    layouts[count],
    "Use invisible alignment slots only; never draw slot borders, panels, row lines, column lines, cards, or separators.",
    "Place each lamp in the upper part of its own invisible slot and keep a consistent empty gap below it.",
    hasLabels
      ? "Important: leave enough clean background directly under every labeled lamp for the app-added label pill. Do not put product parts, shadows, or decorative elements in that label-safe zone."
      : "No labels are requested, so keep the full image text-free and clean."
  ].join("\n");
}

function collageBackgroundLockPrompt(settings = {}) {
  const hasOverride = collageHasExplicitBackgroundPrompt(settings?.collageUserPrompt || settings?.userPrompt || "");
  const backgroundSpec = collageBackgroundSpec(settings);
  return [
    "COLLAGE BACKGROUND LOCK: remove every source photo background before composing.",
    hasOverride
      ? "The user explicitly requested a background direction. Follow that request, but keep it as one single continuous background across the entire image."
      : `No explicit user background request is present. Use one single continuous clean ecommerce background across the entire image: ${backgroundSpec}.`,
    "The background must be visually identical in every area, including behind labels and between products.",
    "Do not preserve original ceilings, walls, room surfaces, corner shadows, per-photo lighting, gradients, vignettes, tiles, panels, cards, borders, quadrant blocks, straight seams, row/column cell backgrounds, or separate patches."
  ].join("\n");
}

function collageConversationPrompt(settings = {}, { fileCount = 0, ratio = "", userPrompt = "" } = {}) {
  const count = Math.max(1, Number(fileCount || settings.collageSourceCount || 0) || 1);
  const labels = collageVisibleLabels(settings);
  const userText = String(userPrompt || settings.collageUserPrompt || settings.userPrompt || "").trim();
  const backgroundSpec = collageBackgroundSpec(settings);
  return [
    "Google AI Studio style image-edit conversation:",
    `Use the ${count} uploaded lamp product images as ${count} separate product sources.`,
    `Create one final ${ratio || settings.ratio || "1:1"} image by cutting out each uploaded product and placing all products on one single continuous ecommerce background: ${backgroundSpec}.`,
    "This is not a style-transfer task. Do not add a decorative style, theme, mood, room scene, lifestyle background, poster design, ad layout, props, icons, callouts, or typography.",
    "The whole canvas must use the same background everywhere. No different background colors, no per-image patches, no photo cards, no panels, no grids, no borders, no separators, no split screens, no visible seams, and no original photo backgrounds.",
    "Preserve every product independently: real silhouette, count, material, color, emitting surface, mounting structure, proportions, transparency, metal/glass/acrylic texture, and important joints. Do not merge products, redesign lamps, invent new parts, crop key structures, or change one product into another.",
    "Arrange the products like the provided target example: large cut-out lamps floating directly on the gray canvas, 5 products use 2 items on the top row and 3 items on the bottom row; 4 products use a clean 2x2 rhythm; each lamp is much larger than a thumbnail and has a dark gray rounded pill label space below it.",
    "Do not make a small-photo collage. Do not put any uploaded image inside a square photo tile. The final look should be a product collection sheet, not separate photos pasted on a page.",
    labels.length
      ? "The app may overlay user-provided labels after generation. The image model must not draw label text; only leave clean empty gray space below the corresponding products."
      : "Do not draw any text, numbers, captions, logos, watermarks, UI marks, labels, or random glyphs.",
    userText
      ? `User modification request: ${userText}. Apply it as an edit to this exact multi-product layout. If it conflicts with product fidelity, one continuous background, no extra style, or no text, keep those hard rules and apply only the non-conflicting part.`
      : "No extra user prompt was provided. Use only the simple edit intent: put the uploaded products together on the same light-gray background."
  ]
    .filter(Boolean)
    .join("\n");
}

function collageOpenCanvasLockPrompt() {
  return [
    "COLLAGE OPEN-CANVAS LAYOUT LOCK: this must be a catalog-style product collection on one open canvas, not a grid collage.",
    "Use an invisible alignment grid only for spacing: 2 products use two balanced columns; 3 products may use one row or a 2+1 rhythm; 4-6 products use two clean rows. The layout should be tidy, but the alignment slots must not be visibly drawn.",
    "Give every lamp its own clean breathing room. Scale each product by its source silhouette and aspect ratio: wide lamps may occupy wider invisible slots, tall lamps may occupy taller slots, and all products should feel visually balanced.",
    "Arrange products as balanced rows or a gentle stagger. Do not create visible equal-size rectangular cells, 2x2/2x3 panels, tile blocks, card slots, borders, or straight vertical/horizontal background seams.",
    "Paint the full background first, then place cut-out lamp products above it. Only soft product grounding shadows are allowed; shadows must not form rectangular patches. The result should feel like a clean catalog sheet, not a random scatter."
  ].join("\n");
}

function collageGenerationHiddenPrompt(settings = {}) {
  if (!isCollageTemplateSettings(settings)) return "";
  const labels = collageVisibleLabels(settings);
  const backgroundSpec = collageBackgroundSpec(settings);
  return [
    collageStrategyPrompt(settings),
    collageBackgroundLockPrompt(settings),
    collageOpenCanvasLockPrompt(),
    collageSlotLayoutPrompt(settings),
    collageLabelLockPrompt(labels),
    "",
    collageHasExplicitBackgroundPrompt(settings?.collageUserPrompt)
      ? ""
      : `Background must be fixed to ${backgroundSpec} as one continuous ecommerce canvas across the whole image. The final image must have exactly one background, not per-product patches.`,
    "",
    "",
    labels.length
      ? `User labels for local overlay only: ${labels.map((item) => `${item.index + 1}:${item.name}`).join(", ")}. Do not draw these labels in the generated image.`
      : "",
    ""
  ].join("\n");
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

function generationSpeedKey(settings = {}) {
  return "turbo";
}

function generationMaxConcurrency() {
  const configured = Number(process.env.MAX_IMAGE_GENERATION_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) return Math.max(1, Math.floor(configured));
  return 4;
}

function generationConcurrency(settings = {}) {
  const speed = generationSpeedKey(settings);
  const maxConcurrency = generationMaxConcurrency();
  let concurrency = 1;
  if (settings?.styleCloneMode) {
    if (speed === "turbo") concurrency = 4;
    else if (speed === "fast") concurrency = 3;
    else concurrency = 2;
    return Math.min(concurrency, maxConcurrency);
  }
  if (speed === "turbo") concurrency = 4;
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

function generationTimeoutMs({ clarity = "2k", styleCloneMode = false, useBearerAuth = false, attempt = 0 } = {}) {
  const clarityKey = String(clarity || "2k").toLowerCase();
  let timeout = clarityKey === "4k" ? 240000 : clarityKey === "1k" ? 120000 : 180000;
  if (styleCloneMode) timeout = clarityKey === "4k" ? 360000 : clarityKey === "1k" ? 240000 : 300000;
  if (useBearerAuth) timeout += 30000;
  return timeout + Math.max(0, Number(attempt) || 0) * 45000;
}

function isTransientGenerationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();
  return (
    name.includes("abort") ||
    message.includes("aborted") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("econnreset") ||
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
  if (isTransientGenerationError(error)) {
    return `${providerName} image generation timed out or queued for too long. Please try again.`;
  }
  return message || "Image generation failed";
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

async function fetchJsonWithGenerationRetry(endpoint, { method, headers, body, clarity, styleCloneMode, useBearerAuth, providerName }) {
  let lastError = null;
  const maxAttempts = styleCloneMode ? 1 : 2;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const timeoutMs = generationTimeoutMs({ clarity, styleCloneMode, useBearerAuth, attempt });
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

async function generateOpenAIImage({ prompt, files, modelOption, ratio, clarity, apiKey, baseUrl, providerName = "OpenAI" }) {
  if (!apiKey) {
    throw new Error(`${providerName} API key is not configured.`);
  }

  const form = new FormData();
  form.append("model", modelOption.apiModel);
  form.append("prompt", prompt);
  form.append("size", openAISize(ratio));
  form.append("quality", openAIQuality(clarity));
  form.append("background", "opaque");

  for (const file of files.slice(0, 8)) {
    const blob = new Blob([file.buffer], { type: file.mimetype || "image/png" });
    form.append("image", blob, file.originalname || "lamp.png");
  }

  const endpoint = `${String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")}/images/edits`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = apiErrorMessage(payload, `${providerName} request failed: HTTP ${response.status}`);
    throw new Error(message);
  }
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
  settings = {}
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
  const backgroundSpec = isCollageTemplate ? collageBackgroundSpec(settings) : "";
  if (!selectedFiles.length) {
    throw new Error("Missing input image for generation.");
  }
  const instructionLines = [
    String(prompt || ""),
    "The final output must use the selected aspect ratio " + outputAspectRatio + ".",
    isCollageTemplate
      ? "SINGLE-CALL COLLAGE MODE: every input image is an independent lamp product source. Extract and retouch the visible lamp subject from each input, remove original backgrounds, and place all products on one shared square ecommerce canvas: " + backgroundSpec + "."
      : isDirectStyleSwap
        ? "DIRECT STYLE CLONE MODE: input image 1 is only the reference canvas/layout/background; input image 2 is the replacement lamp identity. Replace the lamp/product in input image 1 with the lamp from input image 2. Do not return input image 1 unchanged."
        : "Use the uploaded product image as the identity source and preserve its true lamp structure.",
    isCollageTemplate
      ? "Keep one visible product from every input image. Do not drop products, merge lamps, add new parts, redesign silhouettes, create photo tiles, draw cards, draw grid lines, or add text. Labels are added locally by the app after generation."
      : isDirectStyleSwap
        ? "The final image must visibly contain the lamp from input image 2, not the original lamp from input image 1. Preserve the reference scene, perspective, crop, lighting, and background while swapping only the lamp/product subject."
        : "Do not add random text, watermarks, logos, or unrelated product parts."
  ];
  const parts = [{ text: instructionLines.filter(Boolean).join("\n") }];
  selectedFiles.forEach((file, index) => {
    const role = file.inputRole || (index === 0 ? "primary-product" : "product-source");
    const label = file.inputLabel ? " App label later: " + file.inputLabel + "." : "";
    const roleInstruction =
      isDirectStyleSwap && role === "reference-canvas"
        ? "Input image " + (index + 1) + " is the reference canvas ONLY. Preserve its background/layout/style, but do NOT preserve its lamp/product subject; that subject must be replaced."
        : isDirectStyleSwap && role === "primary-product"
          ? "Input image " + (index + 1) + " is the replacement lamp identity source. Preserve this lamp's true structure/material/color and use it to replace the reference lamp."
          : role === "style-reference"
            ? "Input image " + (index + 1) + " is a style/layout reference only. Do not copy its product identity." + label
            : "Input image " + (index + 1) + " (" + role + "): preserve this lamp as its own product subject." + label;
    parts.push({
      text: roleInstruction
    });
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
  const payload = await fetchJsonWithGenerationRetry(endpoint, {
    method: "POST",
    headers,
    clarity,
    styleCloneMode,
    useBearerAuth,
    providerName,
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
  settings = {}
}) {
  return modelOption.provider === "openai"
    ? generateOpenAIImage({
        prompt,
        files,
        modelOption,
        ratio,
        clarity,
        apiKey: openAICompatibleKey,
        baseUrl: openAICompatibleBaseUrl,
        providerName: openAICompatibleName
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
        settings
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
  const normalized = Math.max(2, Math.min(6, Number(count) || 2));
  const slots = {
    2: [
      { x: 30, y: 70 },
      { x: 70, y: 70 }
    ],
    3: [
      { x: 22, y: 72 },
      { x: 50, y: 72 },
      { x: 78, y: 72 }
    ],
    4: [
      { x: 28, y: 43 },
      { x: 72, y: 43 },
      { x: 28, y: 86 },
      { x: 72, y: 86 }
    ],
    5: [
      { x: 26, y: 43 },
      { x: 72, y: 43 },
      { x: 20, y: 86 },
      { x: 50, y: 86 },
      { x: 80, y: 86 }
    ],
    6: [
      { x: 18, y: 43 },
      { x: 50, y: 43 },
      { x: 82, y: 43 },
      { x: 18, y: 86 },
      { x: 50, y: 86 },
      { x: 82, y: 86 }
    ]
  };
  return slots[normalized] || slots[5];
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
  const slots = collageOverlaySlots(Number(settings?.collageSourceCount || labels.length || 2));
  return labels
    .map((label) => {
      const slot = slots[Math.max(0, Math.min(slots.length - 1, Number(label.index || 1) - 1))];
      return slot
        ? {
            index: label.index,
            name: label.name,
            labelCenter: { x: slot.x / 100, y: slot.y / 100 },
            confidence: 0.3
          }
        : null;
    })
    .filter(Boolean);
}

function applyCollageLabelOverlay(imageUrl = "", settings = {}, labelPositions = []) {
  const labels = collageVisibleLabels(settings);
  if (!isCollageTemplateSettings(settings) || !labels.length || !imageUrl) return imageUrl;
  const dimensions = imageDimensionsFromUrl(imageUrl) || collageCanvasSize(settings);
  const width = Math.max(1, Math.round(dimensions.width || 1024));
  const height = Math.max(1, Math.round(dimensions.height || 1024));
  const positions = normalizeCollageLabelPositions(labelPositions, labels, { width, height });
  const fallbackPositions = fallbackCollageLabelPositions(labels, settings);
  const positionByIndex = new Map([...fallbackPositions, ...positions].map((item) => [Number(item.index), item]));
  const base = Math.min(width, height);
  const maxFont = Math.round(base * 0.032);
  const labelNodes = labels
    .map((label) => {
      const position = positionByIndex.get(Number(label.index));
      const text = String(label.name || "").trim();
      if (!text || !position) return "";
      const maxPillWidth = Math.round(width * 0.22);
      const minFont = Math.max(14, Math.round(base * 0.018));
      const fontSize = clampNumber(Math.floor((maxPillWidth - base * 0.035) / Math.max(2.4, text.length * 1.02)), minFont, Math.max(minFont, maxFont));
      const pillHeight = Math.round(fontSize * 1.62);
      const pillRadius = Math.round(pillHeight / 2);
      const pillWidth = Math.max(Math.round(fontSize * 2.55), Math.min(maxPillWidth, Math.round(text.length * fontSize * 1.02 + fontSize * 1.55)));
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
      let cx = position.labelCenter ? position.labelCenter.x * width : bbox ? bbox.x + bbox.width / 2 : width / 2;
      let cy = position.labelCenter ? position.labelCenter.y * height : bbox ? bbox.y + bbox.height + gap + pillHeight / 2 : height * 0.72;
      if (bbox) {
        const belowY = bbox.y + bbox.height + gap + pillHeight / 2;
        if (!position.labelCenter || cy < bbox.y + bbox.height + pillHeight * 0.25) {
          cy = belowY;
        }
        if (cy + pillHeight / 2 > height - margin) {
          cy = bbox.y - gap - pillHeight / 2;
        }
      }
      cx = Math.round(clampNumber(cx, margin + pillWidth / 2, width - margin - pillWidth / 2));
      cy = Math.round(clampNumber(cy, margin + pillHeight / 2, height - margin - pillHeight / 2));
      const x = Math.round(cx - pillWidth / 2);
      const y = Math.round(cy - pillHeight / 2);
      return [
        `<g class="collage-label" aria-label="${escapeXml(text)}">`,
        `<rect x="${x}" y="${y}" width="${pillWidth}" height="${pillHeight}" rx="${pillRadius}" fill="#555654" opacity="0.96"/>`,
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fontSize}" font-weight="700" font-family="Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">${escapeXml(text)}</text>`,
        "</g>"
      ].join("");
    })
    .filter(Boolean)
    .join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeXml(imageUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`,
    labelNodes,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
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
  const label = collageInputLabel(settings, index);
  const resolvedPrompt = String(settings.collageResolvedPrompt || "").trim();
  const userPrompt = String(settings.collageUserPrompt || "").trim();
  return [
    "Turn this uploaded lamp image into one commercial-ready product cut-out for a square collage.",
    "Use the uploaded image as the exact product identity. Preserve the real lamp outline, material, color, emitting surface, cord/chain/rod/base/canopy/arms/mounting structure, proportions, transparency, metal/glass/acrylic texture, and visible joints.",
    "Remove the original snapshot or edited-photo background completely. Do not paste the full source photo. Extract only the lamp/product subject and clean its edges.",
    "Make the product look refined and commercial: clean lighting, natural edges, balanced contrast, soft realistic shadow, no harsh crop, and the complete product visible.",
    `Put the extracted lamp on a full-bleed, perfectly uniform matte light-gray background ${COLLAGE_BACKGROUND_SPEC}. The background color must match exactly edge to edge so it blends seamlessly when composed into the final sheet.`,
    resolvedPrompt ? `Overall collage prompt to honor where applicable: ${resolvedPrompt}` : "",
    userPrompt ? `User modification request for the final collage: ${userPrompt}. Apply only product cleanup details that do not conflict with the fixed light-gray background and product fidelity.` : "",
    "Do not redesign the lamp, invent parts, simplify the structure, change the model, or merge it with another product.",
    "Do not create a room scene, poster, panel, square card, border, grid, label, caption, logo, watermark, callout, arrow, price, icon, or any text.",
    "Do not leave a visible rectangular image boundary. The output must look like a clean product cut-out floating on the same gray background, not a photo tile.",
    "Keep the product complete and centered with breathing room.",
    label ? `The app will add the label \"${label}\" later. Leave clean empty gray background below the lamp; do not draw the label yourself.` : "No label should be drawn.",
    "Return one clean product image only."
  ].join("\n");
}

async function generateCleanCollageProductImages({
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
  const concurrency = Math.max(1, Math.min(2, files.length));
  await runWithConcurrency(files, concurrency, async (file, index) => {
    const dimensions = imageDimensions(file) || { width: 1, height: 1 };
    try {
      let cleanedUrl = "";
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
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
            }
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
        }
      }
      if (!cleanedUrl) throw lastError || new Error("model cleanup unavailable");
      results[index] = {
        imageUrl: await normalizeImageHref(cleanedUrl),
        source: "model-clean",
        originalName: file.originalname || `product-${index + 1}`,
        dimensions
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
  const fontSize = Math.max(28, Math.round(base * 0.038));
  const pillHeight = Math.round(fontSize * 1.65);
  const pillRadius = Math.round(pillHeight / 2);
  const pillWidth = Math.max(Math.round(fontSize * 2.55), Math.min(Math.round(base * 0.24), Math.round(value.length * fontSize * 1.08 + fontSize * 1.75)));
  const x = Math.round(cx - pillWidth / 2);
  const y = Math.round(cy - pillHeight / 2);
  return [
    `<g class="collage-label" aria-label="${escapeXml(value)}">`,
    `<rect x="${x}" y="${y}" width="${pillWidth}" height="${pillHeight}" rx="${pillRadius}" fill="#555654" opacity="0.96"/>`,
    `<text x="${Math.round(cx)}" y="${Math.round(cy)}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fontSize}" font-weight="700" font-family="Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif">${escapeXml(value)}</text>`,
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
    `<rect width="${width}" height="${height}" fill="${COLLAGE_BACKGROUND_HEX}"/>`,
    imageNodes,
    labelNodes,
    "</svg>"
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

async function generateCatalogCollageImage({
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
    noTextImageUrl
  };
}

function directCollagePrompt(prompt = "", settings = {}, { sourceCount = 0 } = {}) {
  const labels = collageVisibleLabels(settings);
  const count = Math.max(2, Math.min(6, Number(sourceCount || settings?.collageSourceCount || 0) || 2));
  const backgroundSpec = collageBackgroundSpec(settings);
  return [
    String(prompt || "").trim(),
    "SINGLE-CALL RETOUCH AND COMPOSE WORKFLOW:",
    `Create one square 800x800 commercial lamp product collage from the ${count} uploaded images.`,
    "The uploaded images are independent lamp product sources in upload order.",
    "For each uploaded image, internally perform this workflow: identify the main lamp product subject; extract only that lamp subject; remove the original background completely; retouch the extracted lamp into a clean commercial product cutout with clean edges, balanced exposure, refined material texture, natural highlights, soft realistic product shadow, no noise, no gray patch, and no dirty background residue; preserve the real product structure and do not redesign it; place the retouched product into its assigned invisible slot on one shared square canvas.",
    `The final image must have exactly one continuous ecommerce background across the whole canvas: ${backgroundSpec}. Do not preserve any source photo background, wall, ceiling, floor, rectangular crop, tile, card, border, panel, grid line, shadow block, or visible seam.`,
    "Products must not overlap, merge, disappear, be redesigned, or change product count. Preserve every lamp's real shape, material, color, glass/acrylic texture, emitting surface, cords, rods, arms, base, canopy, and mounting structure.",
    "Use soft natural product shadows only, and keep the products visually balanced in scale.",
    collageSlotLayoutPrompt({ ...settings, collageSourceCount: count }),
    labels.length
      ? `Do not draw any text. Leave clean empty label space below the products for these app-overlay labels: ${labels.map((item) => `image ${item.index}: "${item.name}"`).join("; ")}.`
      : "Do not draw any text, numbers, labels, captions, logos, watermarks, UI marks, or random glyphs.",
    "No room scene, no poster design, no logo, no watermark, no icons, no arrows, no price.",
    "The generated base image must be the no-text version. The app will create the text version afterward by overlaying labels."
  ]
    .filter(Boolean)
    .join("\n");
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
    `Labels by source image: ${labels.map((item) => `image ${item.index} = "${item.name}"`).join("; ")}`,
    'Return JSON only: {"labels":[{"index":1,"label":"...","bbox":{"x":0.1,"y":0.1,"width":0.2,"height":0.3},"labelCenter":{"x":0.2,"y":0.45},"confidence":0.9}]}'
  ].join("\n");
  const parts = [
    { text: prompt },
    { text: "Image 1 - final no-text collage to label:" },
    { inlineData: collageInline },
    ...sourceFiles.slice(0, labels.length).flatMap((file, index) => [
      { text: `Source product image ${index + 1}${collageInputLabel(settings, index) ? `, label "${collageInputLabel(settings, index)}"` : ""}:` },
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
  const useLocalLabelSlots = isSingleCallRetouchComposeCollage(collageSettings);
  const basePrompt = directCollagePrompt(shot.prompt || settings.collageResolvedPrompt || "", collageSettings, { sourceCount });
  const prompt = hiddenGenerationPrompt(basePrompt, {
    shot,
    templateReferenceCount: 0,
    settings: collageSettings,
    modelOption,
    profile
  });
  const generatedNoTextImageUrl = await generateImageForShot({
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
    settings: collageSettings
  });
  const noTextImageUrl = await persistGeneratedImageUrl(generatedNoTextImageUrl, {
    title: shot.title || "collage-no-text",
    category: "collage-no-text"
  });
  let labelPositions = [];
  if (collageVisibleLabels(collageSettings).length && !useLocalLabelSlots) {
    try {
      labelPositions = await analyzeCollageLabelPositionsWithGeminiVision({
        collageImageUrl: generatedNoTextImageUrl,
        sourceFiles: files.slice(0, 8),
        settings: collageSettings,
        model: modelOption.provider === "gemini" ? modelOption.apiModel : "gemini-2.5-flash",
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
    ? await persistGeneratedImageUrl(applyCollageLabelOverlay(noTextImageUrl, collageSettings, labelPositions), {
        title: shot.title || "collage-with-labels",
        category: "collage-labels"
      })
    : noTextImageUrl;
  return {
    imageUrl: textImageUrl,
    textImageUrl,
    noTextImageUrl
  };
}

function hiddenGenerationPrompt(prompt, { shot = {}, templateReferenceCount = 0, settings = {}, modelOption = {}, profile = {} } = {}) {
  const category = isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask({ ...shot, prompt });
  const categoryGuard = categoryBoundaryPrompt(category);
  const categoryLine = selectedLampCategoryPrompt(settings);
  const categoryExecution = selectedLampCategoryExecutionPrompt(settings);
  const isStyleClone = Boolean(settings?.styleCloneMode && templateReferenceCount > 0);
  const isStyleSimilar = isStyleSimilarSettings(settings);
  const isDirectSubjectSwap = isStyleClone && (!settings.similarMode || settings.similarMode === "none");
  if (isDirectSubjectSwap) {
    return directSwapGenerationPrompt(shot, "", settings);
  }
  const isCollageTemplate = isCollageTemplateSettings(settings);
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
  const isProductWorkspace = isProductWorkspaceSettings(settings);
  const productWorkspaceRule = isProductWorkspace ? productStrategyPrompt(settings, profile) : "";
  const categoryRule = isCollageTemplate ? "" : categoryLine;
  const categoryExecutionRule = isCollageTemplate || isProductWorkspace ? "" : categoryExecution;
  const productConsistencyRule =
    isProductWorkspace
      ? productWorkspaceConsistencyPrompt(category, profile)
      : isCollageTemplate
        ? ""
        : isStyleSimilar
        ? PRODUCT_CONSISTENCY_COMPACT_PROMPT
        : PRODUCT_CONSISTENCY_LOCK_PROMPT;
  const installationRule = isCollageTemplate || isProductWorkspace ? "" : isStyleSimilar ? STYLE_SIMILAR_PHYSICS_COMPACT_PROMPT : INSTALLATION_PHYSICS_PROMPT;
  const lightingRule = isCollageTemplate || isStyleSimilar || isProductWorkspace ? "" : LIGHTING_PHYSICS_PROMPT;
  const categoryBoundaryRule = isCollageTemplate ? "" : categoryGuard;
  const hidden = [
    "",
    categoryRule,
    categoryExecutionRule,
    selectedCategoryStructureLock,
    referenceRule,
    productWorkspaceRule,
    styleSimilarRule,
    collageRule,
    productConsistencyRule,
    installationRule,
    lightingRule,
    categoryBoundaryRule,
    nanoBananaRule,
    ""
  ]
    .filter(Boolean)
    .join("\n\n");
  return [String(prompt || "").trim(), hidden].filter(Boolean).join("\n\n");
}

async function generateImageForShotDirect({
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
  profile
}) {
  const inputReferenceCount = generationFiles.filter(
    (file) => file.inputRole === "layout-reference" || file.inputRole === "reference-canvas" || file.inputRole === "style-reference"
  ).length;
  const declaredReferenceCount = Number(settings?.templateReferenceCount || 0);
  const templateReferenceCount = isStyleSimilarSettings(settings)
    ? Math.max(inputReferenceCount, declaredReferenceCount)
    : inputReferenceCount;
  const directSubjectSwap = isDirectStyleCloneSettings(settings) && generationFiles.some((file) => file.inputRole === "reference-canvas");
  const firstPrompt = directSubjectSwap
    ? directSwapGenerationPrompt(shot, "", settings)
    : ensureConsistencyInPrompt(shot.prompt, {
        templateReferenceCount,
        category: shot.category,
        title: shot.title,
        variationIndex: shotVariationIndex(shot, 0)
      });
  const firstGenerationPrompt = directSubjectSwap
    ? firstPrompt
    : hiddenGenerationPrompt(firstPrompt, {
        shot,
        templateReferenceCount,
        settings,
        modelOption,
        profile
      });
  const imageUrl = await generateImageForShot({
    prompt: firstGenerationPrompt,
    files: generationFiles,
    modelOption,
    ratio: shot.ratio,
    clarity: settings.clarity,
    geminiKey,
    geminiBaseUrl,
    geminiProviderName,
    geminiUseBearerAuth,
    openAICompatibleKey,
    openAICompatibleBaseUrl,
    openAICompatibleName,
    settings
  });
  return { imageUrl };
}

function writeJsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
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
  const counts = normalizeCounts(req.body?.counts || {});
  const settings = req.body?.settings || {};
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
      smtpFrom: settings.smtpFrom || ""
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

function taskBoundaryVisibleLine(category = "") {
  const map = {
    main: "图片类型边界：主图只展示完整产品主体，背景干净，不要混入详情页卖点排版、场景长图或随机文字。",
    selling: "图片类型边界：卖点图只突出一个购买理由，背景简洁可留白；不要混入完整场景图、细节拼版、实拍到货图或随机文字。",
    scene: "图片类型边界：场景图要展示真实空间和安装关系；不要做卖点海报、细节拼版或随机文字。",
    detail: "图片类型边界：细节图只展示结构、材质、发光面或安装细节；不要做完整空间场景或随机文字。",
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
  if (!joined().includes("图片类型边界")) chunks.push(taskBoundaryVisibleLine(category));
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
  return ["main", "selling", "scene", "detail", "real"].reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
}

function applyShotPromptOverrides(plan, overrides, options = {}) {
  const templateReferenceCount = Number(options.templateReferenceCount || 0);
  if (!plan?.shots?.length || templateReferenceCount > 0) return plan;
  const normalized = normalizeShotPromptOverrides(overrides);
  if (!normalized.length) return plan;
  const byId = new Map(normalized.filter((item) => item.id).map((item) => [item.id, item]));
  const byIndex = new Map(normalized.map((item) => [item.index, item]));
  plan.shots = plan.shots.map((shot, index) => {
    const override = byId.get(shot.id) || byIndex.get(index);
    if (!override?.prompt) return shot;
    const category = resolveShotTask({ ...shot, category: override.category || shot.category, prompt: override.prompt });
    return {
      ...shot,
      prompt: ensureConsistencyInPrompt(override.prompt, {
        templateReferenceCount,
        category,
        variationIndex: shotVariationIndex(shot, index)
      })
    };
  });
  return plan;
}

function normalizeClientGenerationPlan(value, { counts, settings, templateReferenceCount = 0 } = {}) {
  if (!value || !Array.isArray(value.shots) || !value.shots.length) return null;
  const expectedCount = totalCountFromServerCounts(counts || {});
  if (expectedCount > 0 && value.shots.length !== expectedCount) return null;
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
        ? directSwapVisiblePrompt(mergedShotForDirectSwap)
        : styleSimilar
          ? ensureConsistencyInPrompt(styleSimilarVisiblePrompt({ ...mergedShotForDirectSwap, category }, settings, value.profile || {}, "", shot.prompt), {
              templateReferenceCount,
              category,
              title: shot.title,
              variationIndex: shotVariationIndex(shot, index)
            })
          : ensureConsistencyInPrompt(shot.prompt || "", {
              templateReferenceCount,
              category,
              title: shot.title,
              variationIndex: shotVariationIndex(shot, index)
            });
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
        promptRoute: {
          ...(shot.promptRoute || {}),
          source: styleSimilar ? "style-similar" : shot.promptRoute?.source || "client-confirmed",
          category,
          label: categoryLabel(category)
        },
        imageUrl: "",
        status: ""
      };
    })
    .filter((shot) => shot.prompt);
  if (!shots.length) return null;
  return {
    profile: value.profile || {},
    designSpec: value.designSpec || buildDesignSpec(value.profile || {}, settings || {}, counts || normalizeCounts(), templateReferenceCount),
    analysis: "",
    promptDispatch: "",
    counts,
    settings,
    shots
  };
}

function collagePromptFromSettings(settings = {}, layout = "", fileCount = 0) {
  const labels = collageVisibleLabels(settings);
  const hasBackgroundOverride = collageHasExplicitBackgroundPrompt(layout || settings?.collageUserPrompt || "");
  const labelLine = labels.length
    ? `User labels for local overlay only: ${labels.map((item) => `${item.index + 1}:${item.name}`).join(", ")}. Do not render label text in the generated image.`
    : "";
  return [
    collageStrategyPrompt(settings),
    collageBackgroundLockPrompt({ ...settings, collageUserPrompt: layout || settings?.collageUserPrompt || "" }),
    collageOpenCanvasLockPrompt(),
    collageLabelLockPrompt(labels),
    "",
    `This request has ${fileCount} independent lamp product images. Each input must remain an independent product subject.`,
    hasBackgroundOverride
      ? ""
      : `Fixed background: use one continuous ecommerce canvas with ${collageBackgroundSpec(settings)}. Do not keep original walls, ceilings, floors, room shadows, image patches, or local background colors.`,
    "",
    "",
    labelLine,
    "",
    layout ? `User note: ${layout}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeCollagePromptWriterOutput(prompt, fallbackPrompt = "") {
  const text = stripBackendPromptLines(prompt).replace(/\\n/g, "\n").trim();
  const fallback = fallbackPrompt || collageConversationPrompt({}, {});
  if (!text) return fallback;
  const compactHardLock =
    `Hard rules: place all uploaded products on one continuous light-gray background (${COLLAGE_BACKGROUND_SPEC}); no added style, no different background colors, no panels/cards/grids/borders/text; preserve each product independently.`;
  const mustMentionLightGray = /light[-\s]?gray|light grey|浅灰|灰色|#f0f0ee|240,240,238/i.test(text);
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
  const collageCounts = { main: 0, selling: 1, scene: 0, detail: 0, real: 0, ...counts, selling: 1 };
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
  let prompt = ensureConsistencyInPrompt(req.body.prompt, {
    templateReferenceCount: templateReferences.length,
    category: shotInput.category,
    title: shotInput.title,
    variationIndex: shotVariationIndex(shotInput, 0)
  });
  if (!prompt.trim()) {
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

  if (mode !== "api" || !effectiveRealOpenAIImages(req.db)) {
    void 0;
    return;
  }
  if (generationModelOption.provider === "openai" && !openAICompatibleKey) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey) {
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
  const shotReferenceIndex = Number.isFinite(Number(shotInput.referenceIndex))
    ? Number(shotInput.referenceIndex)
    : Number.isFinite(Number(shotInput.variationIndex))
      ? Math.max(0, Number(shotInput.variationIndex) - 1)
      : 0;
  const generationFiles = generationInputFiles(files, settings, templateReferences, shotInput, shotReferenceIndex);

  try {
    const shotForGeneration = {
      ...shotInput,
      prompt,
      ratio: shotInput.ratio || settings.ratio,
      category: isStyleSimilarSettings(settings) ? styleSimilarCategoryFromMode(settings.similarMode) : resolveShotTask(shotInput)
    };
    const generationResult = cleanThenComposeCollage
      ? await generateCatalogCollageImage({
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
            profile: inferProductProfile({}, files)
          })
        : await generateImageForShotDirect({
          db: req.db,
          shot: shotForGeneration,
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
          profile: inferProductProfile({}, files)
        });
    if (!generationResult?.imageUrl) {
      throw new Error(noGeneratedImageMessage(generationModelOption.provider === "openai" ? openAICompatibleName : geminiChannel.providerName, generationModelOption));
    }
    const collageHasLabels = isCollageTemplateSettings(settings)
      ? collageVisibleLabels({ ...settings, collageSourceCount: files.length }).length > 0
      : false;
    const rawFinalImageUrl = isCollageTemplateSettings(settings)
      ? collageHasLabels
        ? generationResult.textImageUrl || generationResult.imageUrl
        : generationResult.noTextImageUrl || generationResult.imageUrl
      : applyCollageLabelOverlay(generationResult.imageUrl, {
          ...settings,
          collageSourceCount: files.length
        });
    const finalImageUrl = await persistGeneratedImageUrl(rawFinalImageUrl, {
      title: shotForGeneration.title || shotInput.title || "generated-shot",
      category: isCollageTemplateSettings(settings) ? "collage" : shotForGeneration.category || "image"
    });

    if (chargeable) {
      req.user.balance = Number(req.user.balance || 0) - credits;
      consumeUserModelLease(modelLease, credits);
    }
    const shot = {
      ...shotInput,
      prompt,
      promptMeta: collagePromptMeta || undefined,
      imageUrl: finalImageUrl,
      textImageUrl: cleanThenComposeCollage ? (collageHasLabels ? finalImageUrl : "") : generationResult.textImageUrl,
      noTextImageUrl: cleanThenComposeCollage ? (collageHasLabels ? "" : finalImageUrl) : generationResult.noTextImageUrl,
      status: "done",
      regeneratedAt: new Date().toISOString()
    };
    const job = {
      id: `shot_${Date.now()}`,
      account: req.user.account || req.user.phone || req.user.username,
      status: "completed",
      mode,
      settings,
      credits: chargeable ? credits : 0,
      estimatedCredits: credits,
      cost,
      counts: { selling: shot.category === "selling" ? 1 : 0, scene: shot.category === "scene" ? 1 : 0, detail: shot.category === "detail" ? 1 : 0, real: shot.category === "real" ? 1 : 0 },
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

  if (generationModelOption.provider === "openai" && !openAICompatibleKey) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey) {
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
      settings
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
  const counts = normalizeCounts(safeJson(req.body.counts, {}));
  const settings = safeJson(req.body.settings, {});
  const layout = String(req.body.layout || "");
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
    res.status(502).json({ error: userFriendlyServiceError(error, req.user, "真实灯具识别或提示词规划失败") });
  }
});

app.post("/api/jobs/product-suite/stream", requireAuth, suiteUpload, async (req, res) => {
  const files = req.files?.photos || [];
  const templateReferences = req.files?.templateReferences || [];
  if (!files.length) {
    res.status(400).json({ error: "请至少上传 1 张产品图" });
    return;
  }

  const counts = normalizeCounts(safeJson(req.body.counts, {}));
  const product = safeJson(req.body.product, {});
  const settings = safeJson(req.body.settings, {});
  const layout = String(req.body.layout || "");
  const clientPlan = normalizeClientGenerationPlan(safeJson(req.body.plan, null), {
    counts,
    settings,
    templateReferenceCount: templateReferences.length
  });
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
  if (generationModelOption.provider === "openai" && !openAICompatibleKey) {
    res.status(400).json({
      error: `${modelProviderName(generationModelOption)} API key is not configured for ${generationModelOption.label}.`
    });
    return;
  }
  if (generationModelOption.provider === "gemini" && !geminiChannel.apiKey) {
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
    basePlan = clientPlan || (isCollageTemplateSettings(settings)
      ? buildCollageGenerationPlan({ settings, counts, layout, files })
      : await buildAnalyzedSuitePlan({ db: req.db, product, files, counts, layout, settings, templateReferences }));
    if (lowConfidenceProductGenerationBlocked(settings, basePlan.analysis)) {
      void 0;
      return;
    }
  } catch (error) {
    console.error("[product-suite/stream] planning failed:", error);
    res.status(502).json({ error: userFriendlyServiceError(error, req.user, "真实灯具识别或提示词规划失败") });
    return;
  }
  const modelLease = ensureUserModelLease(req.db, req.user, generationModelOption.id, credits);
  const plan = applyShotPromptOverrides(
    basePlan,
    shotPrompts,
    { templateReferenceCount: templateReferences.length }
  );
  const generationFiles = generationInputFiles(files, settings, templateReferences);
  const concurrentJobs = generationConcurrency(settings);
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

  try {
    if (mode === "api") {
      await runWithConcurrency(startedJob.shots, concurrentJobs, async (shot, index) => {
        writeJsonLine(res, { type: "shot-start", index, total: startedJob.shots.length, id: shot.id, title: shot.title });
        try {
          const shotGenerationFiles = generationInputFiles(files, settings, templateReferences, shot, index);
          const generationResult = await generateImageForShotDirect({
            db: req.db,
            shot,
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
            profile: startedJob.profile || {}
          });
          const rawImageUrl = applyCollageLabelOverlay(generationResult.imageUrl, {
            ...settings,
            collageSourceCount: files.length
          });
          shot.imageUrl = await persistGeneratedImageUrl(rawImageUrl, {
            title: shot.title || `shot-${index + 1}`,
            category: shot.category || "image"
          });
          shot.status = "done";
          writeJsonLine(res, { type: "shot", index, total: startedJob.shots.length, shot });
        } catch (error) {
          shot.status = "failed";
          const message = userFriendlyGenerationError(
            error,
            generationModelOption.provider === "gemini" ? geminiChannel.providerName : openAICompatibleName,
            req.user
          );
          console.error("[product-suite/stream] shot failed:", message);
          shot.error = message;
          writeJsonLine(res, { type: "shot-error", index, total: startedJob.shots.length, id: shot.id, error: message });
        }
      });
      const stats = shotResultStats(startedJob.shots);
      if (stats.failed && !stats.done) {
        throw new Error(firstShotError(startedJob.shots, "All images failed to generate"));
      }
    }

    const stats = shotResultStats(startedJob.shots);
    const chargedCredits = chargeable ? completedShotCreditCharge(cost, stats.done || startedJob.shots.length) : 0;
    if (chargeable) {
      req.user.balance = Number(req.user.balance || 0) - chargedCredits;
      consumeUserModelLease(modelLease, chargedCredits);
    }
    const job = {
      ...startedJob,
      status: stats.failed ? "partial" : "completed",
      credits: chargedCredits,
      apiKeyLease: modelLease ? publicLease(modelLease) : null,
      shotStats: stats,
      completedAt: new Date().toISOString()
    };
    req.db.jobs.unshift(job);
    pruneAccountGeneratedImageCache(req.db, job.account, generationWorkspaceKey(job));
    saveDb(req.db);
    writeJsonLine(res, { type: "complete", job, user: publicUser(req.user) });
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

app.listen(PORT, () => {
  console.log(`Lamp AI Commerce Web running at http://localhost:${PORT}`);
});
