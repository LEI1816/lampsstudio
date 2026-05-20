const DEFAULT_SAVE_DIRECTORY = "D:\\codex\\lamps studio\\exports";
const legacySaveDirectory = localStorage.getItem("lamp_save_directory") || DEFAULT_SAVE_DIRECTORY;
const initialSaveDirectory = (key) => localStorage.getItem(`lamp_save_directory_${key}`) || legacySaveDirectory;
const initialSaveDirectoryChosen = (key) => localStorage.getItem(`lamp_save_directory_chosen_${key}`) === "1";
const initialSingleSaveDirectory = (key) => localStorage.getItem(`lamp_single_save_directory_${key}`) || initialSaveDirectory(key);
const USER_BALANCE_ERROR_MESSAGE = "余额不足，请先充值";
const ADMIN_UPSTREAM_QUOTA_ERROR_MESSAGE = "模型/API 服务账户额度不足，请检查后台配置的服务余额或更换 API Key";
const PRODUCT_VISIBLE_SUBJECT_LOCK = "以产品图为唯一灯具主体，保留外形、材质、颜色和安装结构，不改款、不加不存在部件。";
const PRODUCT_VISIBLE_TEXT_LOCK = "仅使用少量清晰简体中文标注，不要英文、拼音、乱码、品牌标志、水印或价格。";

function friendlyGenerationErrorMessage(value = "") {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (lower.includes("http 502") || lower.includes("bad gateway") || text.includes("502") || text.includes("网关")) {
    return "生图接口繁忙或网关异常，可重试本张。";
  }
  if (lower.includes("timed out") || lower.includes("timeout") || text.includes("超时") || text.includes("排队")) {
    return "生图接口排队或响应超时，可重试本张。";
  }
  return text || "生成失败，可重试本张。";
}

const state = {
  token: localStorage.getItem("lamp_token") || "",
  authMode: "login",
  authChannel: "phone",
  user: null,
  files: [],
  productFiles: [],
  styleFiles: [],
  collageFiles: [],
  templateReferenceFiles: [],
  similarMode: "none",
  imageScope: "detail",
  config: null,
  plan: null,
  workspacePlans: {
    product: null,
    style: null
  },
  workspaceModels: {
    product: "",
    style: "",
    templates: ""
  },
  workspaceClarities: {
    product: "",
    style: "",
    templates: ""
  },
  speed: "turbo",
  paymentProvider: "wechat",
  paymentPoll: null,
  workflow: { completed: new Set(), active: null },
  workspaceWorkflow: {
    product: { completed: new Set(), active: null },
    style: { completed: new Set(), active: null },
    templates: { completed: new Set(), active: null }
  },
  adminView: "workspace",
  adminDashboard: null,
  adminUserSearch: "",
  personalCenter: null,
  personalTab: "consumption",
  activeTool: "product",
  lastEstimate: null,
  templateApplied: false,
  activeTemplate: "",
  templateGroup: "",
  collageShot: null,
  collageGenerating: false,
  workspaceRuntime: {
    product: { busy: false, generating: false, singleGenerating: new Set(), batchSaving: false, statusText: "", statusIsError: false, generationJobId: "", workflow: { completed: new Set(), active: null } },
    style: { busy: false, generating: false, singleGenerating: new Set(), batchSaving: false, statusText: "", statusIsError: false, generationJobId: "", workflow: { completed: new Set(), active: null } },
    templates: { busy: false, generating: false, singleGenerating: new Set(), batchSaving: false, statusText: "", statusIsError: false, generationJobId: "", workflow: { completed: new Set(), active: null } }
  },
  collageProductNames: [],
  generationHistory: {
    product: [],
    style: [],
    templates: []
  },
  saveDirectories: {
    product: initialSaveDirectory("product"),
    style: initialSaveDirectory("style"),
    templates: initialSaveDirectory("templates")
  },
  saveDirectoryChosen: {
    product: initialSaveDirectoryChosen("product"),
    style: initialSaveDirectoryChosen("style"),
    templates: initialSaveDirectoryChosen("templates")
  },
  singleSaveDirectories: {
    product: initialSingleSaveDirectory("product"),
    style: initialSingleSaveDirectory("style"),
    templates: initialSingleSaveDirectory("templates")
  },
  saveDirectoryHandles: {
    product: null,
    style: null,
    templates: null
  },
  saveDirectory: initialSaveDirectory("product"),
  busy: false,
  requirementAutoFilled: false,
  requirementSyncTimer: null,
  pendingAnalysisOptions: null,
  analysisRevision: 0,
  generating: false,
  singleGenerating: new Set(),
  batchSaving: false,
  generationTool: "",
  lightboxStyleIndex: -1,
  lightboxTextTarget: null,
  lightboxTextDragStart: null
};

const GENERATION_HISTORY_LIMITS = {
  product: 15,
  style: 10,
  templates: 10
};

function generationHistoryLimit(key = "product") {
  return GENERATION_HISTORY_LIMITS[key] || GENERATION_HISTORY_LIMITS.product;
}

const $ = (id) => document.getElementById(id);
const els = new Proxy(
  {},
  {
    get(target, key) {
      if (typeof key !== "string") return target[key];
      if (!(key in target)) target[key] = $(key);
      return target[key];
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    }
  }
);

function normalizeToolKey(tool = state.activeTool) {
  return tool === "style" || tool === "templates" ? tool : "product";
}

function createWorkspaceRuntime() {
  return {
    busy: false,
    generating: false,
    singleGenerating: new Set(),
    batchSaving: false,
    statusText: "",
    statusIsError: false,
    generationJobId: "",
    workflow: { completed: new Set(), active: null }
  };
}

function workspaceRuntime(tool = state.activeTool) {
  const key = normalizeToolKey(tool);
  if (!state.workspaceRuntime || typeof state.workspaceRuntime !== "object") state.workspaceRuntime = {};
  if (!state.workspaceRuntime[key]) state.workspaceRuntime[key] = createWorkspaceRuntime();
  if (!(state.workspaceRuntime[key].singleGenerating instanceof Set)) {
    state.workspaceRuntime[key].singleGenerating = new Set(state.workspaceRuntime[key].singleGenerating || []);
  }
  if (!state.workspaceRuntime[key].workflow || typeof state.workspaceRuntime[key].workflow !== "object") {
    state.workspaceRuntime[key].workflow = { completed: new Set(), active: null };
  }
  if (!(state.workspaceRuntime[key].workflow.completed instanceof Set)) {
    state.workspaceRuntime[key].workflow.completed = new Set(state.workspaceRuntime[key].workflow.completed || []);
  }
  return state.workspaceRuntime[key];
}

function toolBusy(tool = state.activeTool) {
  return Boolean(workspaceRuntime(tool).busy);
}

function toolGenerating(tool = state.activeTool) {
  return Boolean(workspaceRuntime(tool).generating);
}

function toolSingleGenerating(tool = state.activeTool) {
  return workspaceRuntime(tool).singleGenerating;
}

function setWorkspaceStatus(text = "", { tool = state.activeTool, isError = false } = {}) {
  const runtime = workspaceRuntime(tool);
  runtime.statusText = String(text || "");
  runtime.statusIsError = Boolean(isError);
  if (tool === state.activeTool && els.statusText) {
    els.statusText.textContent = runtime.statusText;
    els.statusText.classList.toggle("is-error-text", runtime.statusIsError);
  }
}

function renderWorkspaceStatus(tool = state.activeTool) {
  const runtime = workspaceRuntime(tool);
  if (!els.statusText || !runtime.statusText) return;
  els.statusText.textContent = runtime.statusText;
  els.statusText.classList.toggle("is-error-text", runtime.statusIsError);
}

Object.defineProperties(state, {
  busy: {
    get() {
      return workspaceRuntime().busy;
    },
    set(value) {
      workspaceRuntime().busy = Boolean(value);
    }
  },
  generating: {
    get() {
      return workspaceRuntime().generating;
    },
    set(value) {
      workspaceRuntime().generating = Boolean(value);
    }
  },
  singleGenerating: {
    get() {
      return workspaceRuntime().singleGenerating;
    },
    set(value) {
      workspaceRuntime().singleGenerating = value instanceof Set ? value : new Set(value || []);
    }
  },
  batchSaving: {
    get() {
      return workspaceRuntime().batchSaving;
    },
    set(value) {
      workspaceRuntime().batchSaving = Boolean(value);
    }
  },
  collageGenerating: {
    get() {
      return workspaceRuntime("templates").generating;
    },
    set(value) {
      workspaceRuntime("templates").generating = Boolean(value);
    }
  }
});

function workspaceFileKey(tool = state.activeTool) {
  if (tool === "style") return "styleFiles";
  if (tool === "templates") return "collageFiles";
  return "productFiles";
}

function workspaceFiles(tool = state.activeTool) {
  const key = workspaceFileKey(tool);
  if (!Array.isArray(state[key])) state[key] = [];
  return state[key];
}

function activateWorkspaceFiles(tool = state.activeTool) {
  state.files = workspaceFiles(tool);
  if (tool === "templates") normalizeCollageProductNames();
  return state.files;
}

function setWorkspaceFiles(files, tool = state.activeTool) {
  const key = workspaceFileKey(tool);
  state[key] = Array.from(files || []).slice(0, 6);
  state.files = state[key];
  if (tool === "templates") normalizeCollageProductNames();
  return state.files;
}

function workspacePlanKey(tool = state.activeTool) {
  if (tool === "product") return "product";
  if (tool === "style") return "style";
  return "";
}

function workspaceSettingKey(tool = state.activeTool) {
  if (tool === "style") return "style";
  if (tool === "templates") return "templates";
  return "product";
}

function ensureWorkspacePlans() {
  if (!state.workspacePlans || typeof state.workspacePlans !== "object") {
    state.workspacePlans = { product: null, style: null };
  }
  if (!("product" in state.workspacePlans)) state.workspacePlans.product = null;
  if (!("style" in state.workspacePlans)) state.workspacePlans.style = null;
}

function persistWorkspacePlan(tool = state.activeTool) {
  ensureWorkspacePlans();
  const key = workspacePlanKey(tool);
  if (key) state.workspacePlans[key] = state.plan || null;
}

function restoreWorkspacePlan(tool = state.activeTool) {
  ensureWorkspacePlans();
  const key = workspacePlanKey(tool);
  state.plan = key ? state.workspacePlans[key] || null : null;
  return state.plan;
}

function setWorkspacePlan(plan, tool = state.activeTool) {
  ensureWorkspacePlans();
  const key = workspacePlanKey(tool);
  if (key) state.workspacePlans[key] = plan || null;
  if (tool === state.activeTool) state.plan = plan || null;
  return plan || null;
}

function clearWorkspacePlan(tool = state.activeTool) {
  return setWorkspacePlan(null, tool);
}

function getWorkspacePlan(tool = state.activeTool) {
  ensureWorkspacePlans();
  const key = workspacePlanKey(tool);
  return tool === state.activeTool ? state.plan : key ? state.workspacePlans[key] || null : null;
}

function workspaceWorkflow(tool = state.activeTool) {
  const runtime = workspaceRuntime(tool);
  const workflow = runtime.workflow || { completed: new Set(), active: null };
  if (!(workflow.completed instanceof Set)) workflow.completed = new Set(workflow.completed || []);
  runtime.workflow = workflow;
  return workflow;
}

function restoreWorkspaceWorkflow(tool = state.activeTool) {
  const workflow = workspaceWorkflow(tool);
  state.workflow = {
    completed: new Set(workflow.completed || []),
    active: workflow.active ?? null
  };
  renderStepper();
  return state.workflow;
}

function setWorkspaceWorkflow({ completed = [], active = null } = {}, tool = state.activeTool) {
  const workflow = workspaceWorkflow(tool);
  workflow.completed = new Set(completed || []);
  workflow.active = active;
  if (tool === state.activeTool) {
    state.workflow = {
      completed: new Set(workflow.completed),
      active: workflow.active
    };
    renderStepper();
  }
  return workflow;
}

const SHOT_CATEGORY_META = {
  main: { label: "主图", hint: "展示产品主体和整体造型" },
  selling: { label: "卖点图", hint: "突出核心卖点、功能和使用价值" },
  function: { label: "功能图", hint: "图文展示功能、材质、护眼光感和使用优势" },
  scene: { label: "场景图", hint: "展示真实空间、安装关系和光影氛围" },
  detail: { label: "细节图", hint: "展示结构、材质、工艺和局部特征" },
  real: { label: "实拍图", hint: "模拟真实拍摄质感和自然环境" },
  collage: { label: "拼图", hint: "多产品统一画布展示" },
  default: { label: "图片", hint: "按当前提示词生成图片" }
};

const DEFAULT_MAIN_REQUIREMENT =
  "可留空：AI 会根据上传产品图生成电商主图提示词；也可输入白底、轻场景、风格和卖点。";

const DEFAULT_DETAIL_REQUIREMENT =
  "可留空：AI 会根据上传产品图生成详情图组提示词；也可输入卖点、功能图、场景、风格和特殊要求。";

function categoryMeta(category = "") {
  return SHOT_CATEGORY_META[String(category || "").trim()] || SHOT_CATEGORY_META.default;
}

function shotCategoryMeta(category = "") {
  return categoryMeta(category);
}

const SHOT_DISPLAY_TYPE_BY_SLOT = {
  "detail-cover": "详情页封面主视觉",
  "hero-main-space": "主灯空间首屏",
  "hero-atmosphere": "家装氛围首屏",
  "wall-hero-atmosphere": "墙面氛围首屏",
  "scene-context": "真实比例场景图",
  "function-core": "核心功能图",
  "product-display": "产品展示图",
  "selling-point-1": "卖点图",
  "selling-point-2": "卖点图",
  "core-reason": "核心卖点图",
  "material-value": "材质卖点图",
  "light-value": "光效卖点图",
  "design-value": "风格卖点图",
  "feature-overview": "功能总览图",
  "control-method": "控制方式图",
  "lighting-function": "光效功能图",
  "structure-function": "结构功能图",
  "install-function": "安装/结构图",
  "application-scene": "应用场景图",
  "application-scene-alt": "空间变化场景图",
  "living-scene": "客餐厅场景图",
  "bedroom-scene": "卧室/书房场景图",
  "corridor-scene": "玄关/走廊场景图",
  "entry-scene": "入户家装场景图",
  "cabinet-scene": "柜体/局部场景图",
  "living-room-scene": "客厅场景图",
  "emitter-detail": "发光面细节图",
  "material-detail": "材质细节图",
  "wall-material-detail": "材质细节图",
  "install-detail": "安装/结构图",
  "beam-detail": "光斑细节图",
  "dimension-params": "尺寸规格图",
  "studio-real": "棚拍实拍图",
  "arrival-real": "到货实拍图",
  "installed-real": "安装后实拍图",
  "real-display": "实拍展示图"
};

function shotDisplayTypeLabel(shot = {}, index = 0) {
  const route = shot.promptRoute || {};
  const slot = String(route.sequenceSlot || route.suiteSlot || route.pageRole || shot.sequenceSlot || shot.id || "").trim();
  if (SHOT_DISPLAY_TYPE_BY_SLOT[slot]) return SHOT_DISPLAY_TYPE_BY_SLOT[slot];
  if (/detail-cover|cover-spatial-hero|首图|首屏|封面/i.test(slot)) return "详情页封面主视觉";
  if (/scene|space|room|corridor|entry|cabinet|kitchen|bedroom|living|dining|玄关|走廊|卧室|客厅|餐厅/i.test(slot)) return "真实比例场景图";
  if (/function|feature|control|lighting|structure|install|advantage|core|功能|结构|安装|光效/i.test(slot)) return "功能图";
  if (/selling|value|reason|卖点|优势/i.test(slot)) return "卖点图";
  if (/material|emitter|beam|detail|close|材质|细节|光斑/i.test(slot)) return "细节图";
  if (/real|studio|arrival|installed|实拍/i.test(slot)) return "实拍展示图";
  return shotCategoryMeta(shot.category).label || `图片 ${index + 1}`;
}

const LAMP_DETAIL_TEMPLATE_PROMPT = [
  "生成灯具详情图组。",
  "严格以上传产品图为唯一主体，保持灯具结构、材质、颜色和比例不变。",
  "默认生成卖点图、功能图、场景图、细节图、实拍图五类内容。",
  "卖点图突出购买理由、核心卖点和使用价值。",
  "功能图使用图文版式展示护眼光感、均匀透光、材质稳定、安装结构等真实功能优势。",
  "场景图必须是一张完整连续的真实空间画面，有自然光影和清晰安装关系，不要拼图、四宫格、多宫格或分屏。",
  "细节图重点展示灯杯、发光面、材质纹理和结构工艺。",
  "实拍图要像真实手机或相机拍摄，避免海报感。",
  "不要改变灯具款式，不要新增产品图里没有的部件。",
  "所有图片保持电商商品图质感，画面干净、主体清楚、适合详情页使用。"
].join("\n");

const COLLAGE_BACKGROUND_HEX = "#e8e8e2";
const COLLAGE_BACKGROUND_RGB = "232,232,226";
const COLLAGE_BACKGROUND_SPEC = `${COLLAGE_BACKGROUND_HEX} / RGB ${COLLAGE_BACKGROUND_RGB}`;

const LAMP_COLLAGE_TEMPLATE_PROMPT = [
  "生成产品集合拼图。",
  "把上传的多张灯具产品图抠出主体，精修成商用产品图后放在同一张连续暖浅灰画布上。",
  `用户未指定背景时，默认背景为统一暖浅灰：${COLLAGE_BACKGROUND_SPEC}，不要保留原图背景。`,
  "保持每个产品的真实轮廓、比例、材质、颜色、发光面和安装结构。",
  "不要做室内场景、墙面、地面、植物、门窗、分区卡片、边框、表格、拼贴照片、海报装饰或不同背景块。",
  "产品之间留出均匀呼吸感，整体像高端产品目录页。",
  "如果填写名称标签，生成模型不要直接画文字，也不要画标签底座、圆角框、胶囊框或占位框。",
  "如果没有填写名称标签，最终画面必须无文字、无品牌标志、无水印。",
  "输出一张完整拼图，适合电商详情页或产品系列展示。"
].join("\n");

const CREATION_TEMPLATES = [
  {
    id: "lamp-collage-room-labels",
    group: "collage",
    name: "产品集合拼图",
    tag: "拼图",
    scope: "detail",
    quantity: "1",
    ratio: "1:1 方图",
    clarity: "2k",
    similarMode: "none",
    counts: { main: 0, selling: 1, function: 0, scene: 0, detail: 0, real: 0 },
    summary: "多张灯具统一放到一张暖灰底产品集合图里，可由系统后置添加名称标签。",
    strategy: "适合系列灯具、套装展示和详情页集合图。",
    prompt: LAMP_COLLAGE_TEMPLATE_PROMPT
  },
  {
    id: "lamp-detail-suite",
    group: "suite",
    name: "详情图组",
    tag: "13 张",
    scope: "detail",
    quantity: "13",
    ratio: "3:4 竖版",
    clarity: "2k",
    similarMode: "none",
    counts: { main: 0, selling: 2, function: 2, scene: 4, detail: 3, real: 2 },
    summary: "按电商详情页节奏生成卖点、功能、场景、细节和实拍图。",
    strategy: "含 2 张卖点、2 张功能、4 张场景、3 张细节、2 张实拍，可编辑每张提示词。",
    prompt: LAMP_DETAIL_TEMPLATE_PROMPT
  },
  {
    id: "main-click-clean",
    group: "main",
    name: "主图模板",
    tag: "主图",
    scope: "main",
    quantity: "3",
    ratio: "1:1 方图",
    clarity: "2k",
    similarMode: "none",
    counts: { main: 3, selling: 0, function: 0, scene: 0, detail: 0, real: 0 },
    summary: "生成干净、有点击感的电商主图。",
    strategy: "默认 3 张主图方向，突出主体轮廓、质感和第一眼吸引力。",
    prompt: [
      "生成灯具电商主图。",
      "严格保持上传产品图的灯具结构、比例、颜色和材质。",
      "画面干净高级，主体清晰，背景简洁，可适度增加光影氛围。",
      "默认生成 3 张不同构图的主图方案。"
    ].join("\n")
  }
];

function creationTemplateMeta(id = state.activeTemplate) {
  return CREATION_TEMPLATES.find((item) => item.id === id) || null;
}

const LAMP_TEMPLATE_SHOTS = [
  {
    category: "selling",
    title: "卖点 1 · 防眩结构",
    description: "展示防眩深杯和舒适光感。",
    prompt: [
      "围绕灯具防眩结构生成卖点图，突出光线柔和、不刺眼。",
      "主体保持与产品图一致，可加入简洁箭头或局部放大区域。",
      "画面干净，不要品牌标志，不要虚构产品结构。"
    ].join("\\n")
  },
  {
    category: "selling",
    title: "卖点 2 · 光效表现",
    description: "展示光束、照明范围和氛围。",
    prompt: [
      "围绕灯具光效生成卖点图，展示照射范围、光斑和空间氛围。",
      "保持产品结构真实，光线表现自然高级。",
      "不要品牌标志，不要多余复杂文字。"
    ].join("\\n")
  },
  {
    category: "function",
    title: "功能 1 · 四宫格痛点",
    description: "用四宫格图文说明常见痛点和产品优势。",
    prompt: [
      "生成四宫格功能痛点图：顶部大黑标题，下方 2x2 圆角图片卡片。",
      "每格叠加白色大编号和短中文文案，围绕护眼光感、均匀透光、材质稳定和安装结构表达。",
      "文字短句清晰，不要虚构品牌、认证、进口芯片、专利、价格、品牌标志或水印。"
    ].join("\\n")
  },
  {
    category: "scene",
    title: "场景 1 · 客厅空间",
    description: "展示客厅安装效果和整体氛围。",
    prompt: [
      "把灯具放入真实客厅空间，展示安装位置、照明范围和软装搭配。",
      "空间干净现代，光影自然，产品比例真实。",
      "这是一张完整连续的单场景画面，不要拼图、四宫格、多宫格或分屏。",
      "不要品牌标志，不要改变灯具款式。"
    ].join("\\n")
  },
  {
    category: "scene",
    title: "场景 2 · 餐厅空间",
    description: "展示餐桌、岛台或用餐区照明。",
    prompt: [
      "把灯具放入餐厅或岛台空间，突出餐桌区域照明和温馨氛围。",
      "保持灯具安装关系合理，比例自然。",
      "这是一张完整连续的单场景画面，不要拼图、四宫格、多宫格或分屏。",
      "不要品牌标志，不要虚构灯具部件。"
    ].join("\\n")
  },
  {
    category: "scene",
    title: "场景 3 · 卧室/走廊",
    description: "展示柔和辅助照明。",
    prompt: [
      "把灯具放入卧室、走廊或玄关空间，展示柔和辅助照明。",
      "画面舒适安静，灯具主体清晰，安装位置可信。",
      "这是一张完整连续的单场景画面，不要拼图、四宫格、多宫格或分屏。",
      "不要品牌标志，不要改变产品结构。"
    ].join("\\n")
  },
  {
    category: "scene",
    title: "场景 4 · 商业/展厅",
    description: "展示商业空间照明质感。",
    prompt: [
      "把灯具放入商业空间、展厅或精品店，展示高级照明效果。",
      "空间整洁，光线层次清楚，产品比例真实。",
      "这是一张完整连续的单场景画面，不要拼图、四宫格、多宫格或分屏。",
      "不要品牌标志，不要添加产品图没有的部件。"
    ].join("\\n")
  },
  {
    category: "function",
    title: "功能 2 · 多卡片优势",
    description: "用多卡片版式展示结构和功能优势。",
    prompt: [
      "生成功能优势图：顶部大标题，上方横向圆角横幅展示核心结构或发光部件，下方多张圆角功能卡片。",
      "使用简体中文标题和短说明，突出护眼光感、均匀透光、材质稳定、安装结构等真实优势。",
      "版式干净高级，不要虚构认证、品牌、进口芯片、专利、价格、品牌标志或水印。"
    ].join("\\n")
  },
  {
    category: "detail",
    title: "细节 1 · 发光面/灯杯",
    description: "近距离展示核心发光结构。",
    prompt: [
      "生成灯具发光面、灯杯或透光结构的近景细节图。",
      "材质、纹理和边缘要清楚，保持真实结构。",
      "不要品牌标志，不要改变灯体。"
    ].join("\\n")
  },
  {
    category: "detail",
    title: "细节 2 · 材质/边缘",
    description: "展示外壳、金属或表面工艺。",
    prompt: [
      "生成外壳材质、金属边缘、玻璃或亚克力表面的细节特写。",
      "光泽自然，质感高级，产品结构不变。",
      "不要品牌标志，不要虚构细节。"
    ].join("\\n")
  },
  {
    category: "detail",
    title: "细节 3 · 安装/结构",
    description: "展示底座、卡扣、轨道或安装部位。",
    prompt: [
      "生成安装结构或关键连接部位的细节图，突出稳固、简洁和可安装性。",
      "结构必须来自产品图，不要新增不存在的零件。",
      "不要品牌标志。"
    ].join("\\n")
  },
  {
    category: "real",
    title: "实拍 1 · 到货质感",
    description: "像真实手机拍摄的产品图。",
    prompt: [
      "生成真实手机或相机拍摄感的产品实拍图，背景简洁自然。",
      "保留产品真实质感、比例和轻微自然阴影。",
      "不要品牌标志，不要过度海报化。"
    ].join("\\n")
  },
  {
    category: "real",
    title: "实拍 2 · 安装实景",
    description: "展示真实安装后的使用状态。",
    prompt: [
      "生成真实安装场景下的灯具实拍图，体现自然透视和环境光。",
      "产品款式、材质、结构必须与上传图一致。",
      "不要品牌标志，不要增加不属于产品的部件。"
    ].join("\\n")
  }
];
function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const { timeoutMs = 0, timeoutMessage = "请求超时，请稍后重试。", ...fetchOptions } = options;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const response = await fetch(path, {
      ...fetchOptions,
      signal: controller?.signal || fetchOptions.signal,
      headers: {
        ...(fetchOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
        ...(fetchOptions.headers || {})
      }
    }).catch((error) => {
      if (error?.name === "AbortError") throw new Error(timeoutMessage);
      throw error;
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
    return payload;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encodeSvgDataUrl(svg = "") {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function overlayCanvasSizeFromShot(shot = {}) {
  const match = String(shot.ratio || "").match(/(\d+)\s*:\s*(\d+)/);
  if (!match) return { width: 1024, height: 1024 };
  const rw = Math.max(1, Number(match[1]) || 1);
  const rh = Math.max(1, Number(match[2]) || 1);
  const longSide = 1365;
  if (rh >= rw) return { width: Math.round(longSide * (rw / rh)), height: longSide };
  return { width: longSide, height: Math.round(longSide * (rh / rw)) };
}

function localOverlayTextLines(text = "", maxChars = 14) {
  const value = String(text || "").trim().slice(0, maxChars * 2);
  if (!value) return [];
  if (value.length <= maxChars) return [value];
  return [value.slice(0, maxChars), value.slice(maxChars, maxChars * 2)].filter(Boolean);
}

function localSvgTextBlock({ lines = [], x = 0, y = 0, size = 28, fill = "#202020", weight = 500, anchor = "start", lineGap = 1.32, fontFamily = "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif" } = {}) {
  return lines.map((line, index) => {
    const dy = index === 0 ? 0 : size * lineGap;
    return `<text x="${Math.round(x)}" y="${Math.round(y + dy)}" text-anchor="${anchor}" fill="${escapeHtml(fill)}" font-size="${Math.round(size)}" font-weight="${weight}" font-family="${escapeHtml(fontFamily)}">${escapeHtml(line)}</text>`;
  }).join("");
}

function localFittedTextSize(text = "", size = 42, maxWidth = 320, minSize = 28) {
  const cjkCount = (String(text || "").match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = Math.max(0, String(text || "").length - cjkCount);
  const estimatedWidth = cjkCount * size + otherCount * size * 0.56;
  if (!estimatedWidth || estimatedWidth <= maxWidth) return size;
  return clampNumber(Math.floor(size * (maxWidth / estimatedWidth)), minSize, size);
}

function localColorWithOpacity(color = "#ffffff", opacity = 1) {
  const value = String(color || "#ffffff").trim();
  const alpha = clampNumber(opacity, 0, 1);
  if (/^rgba?\(/i.test(value) || alpha >= 0.995) return value;
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return value;
  const int = parseInt(match[1], 16);
  return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`;
}

const localTextOverlayBaseCache = new Map();
const localTextOverlayPending = new Set();

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("无法读取底图"));
    reader.readAsDataURL(blob);
  });
}

async function inlineImageUrlForLocalOverlay(imageUrl = "") {
  if (!imageUrl || imageUrl.startsWith("data:")) return imageUrl;
  if (localTextOverlayBaseCache.has(imageUrl)) return localTextOverlayBaseCache.get(imageUrl);
  const response = await fetch(imageUrl, { headers: authHeaders() });
  if (!response.ok) throw new Error(`底图读取失败：${response.status}`);
  const dataUrl = await blobToDataUrl(await response.blob());
  localTextOverlayBaseCache.set(imageUrl, dataUrl);
  return dataUrl;
}

function scheduleLocalTextOverlayBaseLoad(plan = state.plan, shot = {}) {
  const sourceUrl = shot?.noTextImageUrl || "";
  if (!sourceUrl || sourceUrl.startsWith("data:") || localTextOverlayPending.has(sourceUrl) || localTextOverlayBaseCache.has(sourceUrl)) return;
  localTextOverlayPending.add(sourceUrl);
  inlineImageUrlForLocalOverlay(sourceUrl)
    .then(() => {
      localTextOverlayPending.delete(sourceUrl);
      if (plan === state.plan || plan === getWorkspacePlan(state.activeTool)) {
        renderPlan(plan);
      }
    })
    .catch(() => {
      localTextOverlayPending.delete(sourceUrl);
    });
}

function localShotTextOverlaySvgNodes(overlay = {}, { width = 1024, height = 1024 } = {}) {
  const theme = overlay.theme && typeof overlay.theme === "object" ? overlay.theme : null;
  if (!theme) return "";
  const template = String(overlay.template || "corner-title");
  const base = Math.min(width, height);
  const marginX = Math.round(width * 0.075);
  const marginY = Math.round(height * 0.075);
  const fontFamily = theme.fontFamily || "Noto Sans SC, Microsoft YaHei, PingFang SC, Arial, sans-serif";
  const title = String(overlay.title || "产品亮点").trim().slice(0, 12);
  const subtitle = String(overlay.subtitle || "").trim().slice(0, 14);
  const labels = Array.isArray(overlay.labels) ? overlay.labels.map((item) => String(item || "").trim().slice(0, 8)).filter(Boolean) : [];
  const titleFill = overlay.tone === "dark" ? (theme.darkTitleFill || "#fffaf1") : (theme.titleFill || "#111111");
  const subtitleFill = overlay.tone === "dark" ? (theme.darkSubtitleFill || "#e4dacb") : (theme.subtitleFill || "#4d4942");
  const lineFill = theme.lineFill || "#9c8f7a";
  const panel = localColorWithOpacity(theme.cardFill || theme.panelFill || "#ffffff", theme.cardOpacity ?? theme.panelOpacity ?? 0.72);
  const titleSize = Math.max(30, Math.round(base * 0.046 * (theme.titleScale || 1)));
  const subSize = Math.max(16, Math.round(base * 0.019 * (theme.subtitleScale || 1)));
  const labelSize = Math.max(16, Math.round(base * 0.019 * (theme.labelScale || 1)));

  if (template === "commerce-detail-hero") {
    const hasPanel = String(overlay.panel || "none") !== "none";
    const panelX = Math.round(width * 0.055);
    const panelY = Math.round(height * 0.58);
    const panelW = Math.round(width * 0.62);
    const panelH = Math.round(base * 0.24);
    const padX = Math.round(base * 0.048);
    const textX = panelX + (hasPanel ? padX : Math.round(base * 0.028));
    const titleY = panelY + Math.round(panelH * 0.44);
    const heroTitleSize = localFittedTextSize(title, clampNumber(Math.round(base * 0.052 * (theme.titleScale || 1)), 34, 72), Math.round(panelW - padX * 1.35), Math.max(28, Math.round(base * 0.04 * (theme.titleScale || 1))));
    const heroSubSize = clampNumber(Math.round(base * 0.021 * (theme.subtitleScale || 1)), 16, 30);
    const darkTone = overlay.tone === "dark";
    const panelColor = darkTone ? (theme.darkPanelFill || "#080808") : (theme.panelFill || "#ffffff");
    const shadowId = "localCommerceHeroTextShadow";
    const textAttrs = hasPanel ? "" : ` filter="url(#${shadowId})" paint-order="stroke" stroke="${darkTone ? "#000000" : "#ffffff"}" stroke-opacity="${darkTone ? "0.18" : "0.28"}" stroke-width="${Math.max(1, Math.round(base * 0.0018))}"`;
    return [
      "<defs>",
      hasPanel ? `<linearGradient id="localCommerceHeroPanel" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${escapeHtml(panelColor)}" stop-opacity="${theme.panelOpacity ?? 0.58}"/><stop offset="72%" stop-color="${escapeHtml(panelColor)}" stop-opacity="${theme.panelEndOpacity ?? 0.1}"/><stop offset="100%" stop-color="${escapeHtml(panelColor)}" stop-opacity="0"/></linearGradient>` : "",
      !hasPanel ? `<filter id="${shadowId}" x="-20%" y="-40%" width="150%" height="190%"><feDropShadow dx="0" dy="${Math.max(1, Math.round(base * 0.003))}" stdDeviation="${Math.max(1, Math.round(base * 0.004))}" flood-color="${darkTone ? "#000000" : "#ffffff"}" flood-opacity="${darkTone ? "0.42" : "0.68"}"/></filter>` : "",
      "</defs>",
      hasPanel ? `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${Math.round(base * 0.006 * (theme.radiusScale || 1))}" fill="url(#localCommerceHeroPanel)"/>` : "",
      !hasPanel ? `<line x1="${textX}" y1="${titleY - Math.round(heroTitleSize * 1.05)}" x2="${textX + Math.round(width * 0.11)}" y2="${titleY - Math.round(heroTitleSize * 1.05)}" stroke="${escapeHtml(titleFill)}" stroke-width="${Math.max(1, Math.round(base * 0.0016))}" opacity="0.55"/>` : "",
      `<text x="${textX}" y="${titleY}" fill="${escapeHtml(titleFill)}" font-size="${heroTitleSize}" font-weight="${theme.titleWeight || 620}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}"${textAttrs}>${escapeHtml(title)}</text>`,
      subtitle ? `<text x="${textX}" y="${titleY + Math.round(heroTitleSize * 0.78)}" fill="${escapeHtml(subtitleFill)}" font-size="${heroSubSize}" font-weight="${theme.bodyWeight || 430}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}"${textAttrs}>${escapeHtml(subtitle)}</text>` : ""
    ].filter(Boolean).join("");
  }

  if (template === "advantage-editorial") {
    const panelX = Math.round(width * 0.5);
    const panelW = width - panelX;
    const pad = Math.round(base * 0.07);
    const top = Math.round(height * 0.115);
    const gridTop = Math.round(height * 0.36);
    const gridW = panelW - pad * 2;
    const gridH = Math.round(height * 0.34);
    const darkTitle = theme.darkTitleFill || titleFill;
    const darkSub = theme.darkSubtitleFill || subtitleFill;
    const darkPanel = theme.darkPanelFill || "#050505";
    const labelSizeAdv = clampNumber(Math.round(base * 0.022 * (theme.labelScale || 1)), 16, 30);
    const indexSize = clampNumber(Math.round(base * 0.014), 11, 18);
    const cells = labels.slice(0, 4).map((label, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = panelX + pad + col * Math.round(gridW / 2);
      const y = gridTop + row * Math.round(gridH / 2);
      const w = Math.round(gridW / 2) - Math.round(base * 0.025);
      return [
        `<text x="${x}" y="${y + Math.round(indexSize * 1.1)}" fill="${escapeHtml(darkSub)}" font-size="${indexSize}" font-weight="${theme.bodyWeight || 500}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}">${String(index + 1).padStart(2, "0")}</text>`,
        `<line x1="${x}" y1="${y + Math.round(indexSize * 2)}" x2="${x + w}" y2="${y + Math.round(indexSize * 2)}" stroke="${escapeHtml(lineFill)}" stroke-width="${Math.max(1, Math.round(base * 0.001))}" opacity="0.48"/>`,
        `<text x="${x}" y="${y + Math.round(indexSize * 2) + Math.round(labelSizeAdv * 1.55)}" fill="${escapeHtml(darkTitle)}" font-size="${labelSizeAdv}" font-weight="${theme.labelWeight || 500}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}">${escapeHtml(label)}</text>`
      ].join("");
    }).join("");
    return [
      `<rect x="${panelX}" y="0" width="${panelW}" height="${height}" fill="${escapeHtml(darkPanel)}" opacity="${theme.cardOpacity ?? 0.76}"/>`,
      `<line x1="${panelX}" y1="${Math.round(height * 0.08)}" x2="${panelX}" y2="${Math.round(height * 0.92)}" stroke="${escapeHtml(lineFill)}" stroke-width="${Math.max(1, Math.round(base * 0.001))}" opacity="0.32"/>`,
      `<text x="${panelX + pad}" y="${top}" fill="${escapeHtml(darkTitle)}" font-size="${clampNumber(Math.round(base * 0.04 * (theme.titleScale || 1)), 28, 52)}" font-weight="${theme.titleWeight || 600}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}">${escapeHtml(title)}</text>`,
      subtitle ? `<text x="${panelX + pad}" y="${top + Math.round(base * 0.052)}" fill="${escapeHtml(darkSub)}" font-size="${clampNumber(Math.round(base * 0.018 * (theme.subtitleScale || 1)), 14, 24)}" font-weight="${theme.bodyWeight || 400}" letter-spacing="${theme.letterSpacing ?? 0}" font-family="${escapeHtml(fontFamily)}">${escapeHtml(subtitle)}</text>` : "",
      cells
    ].filter(Boolean).join("");
  }

  if (template === "feature-cards") {
    const cardWidth = Math.round(width * 0.34);
    const cardHeight = Math.round(base * 0.062);
    const gap = Math.round(base * 0.018);
    const cards = labels.slice(0, 4).map((label, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = marginX + col * (cardWidth + gap);
      const y = Math.round(height * 0.64) + row * (cardHeight + gap);
      return `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${Math.round(base * 0.008 * (theme.radiusScale || 1))}" fill="${escapeHtml(panel)}" stroke="${escapeHtml(theme.cardStroke || "#e4ddd2")}" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/><circle cx="${x + Math.round(cardHeight * 0.46)}" cy="${y + Math.round(cardHeight * 0.5)}" r="${Math.round(cardHeight * 0.16)}" fill="${escapeHtml(lineFill)}" opacity="0.9"/>${localSvgTextBlock({ lines: [label], x: x + Math.round(cardHeight * 0.82), y: y + Math.round(cardHeight * 0.57), size: labelSize, fill: titleFill, weight: theme.labelWeight || 600, fontFamily })}`;
    }).join("");
    return [
      `<line x1="${marginX}" y1="${marginY - Math.round(base * 0.022)}" x2="${marginX + Math.round(width * 0.14)}" y2="${marginY - Math.round(base * 0.022)}" stroke="${escapeHtml(lineFill)}" stroke-width="${Math.max(2, Math.round(base * 0.003))}"/>`,
      localSvgTextBlock({ lines: localOverlayTextLines(title, 10), x: marginX, y: marginY + titleSize, size: titleSize, fill: titleFill, weight: theme.titleWeight || 700, fontFamily }),
      subtitle ? localSvgTextBlock({ lines: [subtitle], x: marginX, y: marginY + titleSize + Math.round(base * 0.038), size: subSize, fill: subtitleFill, weight: theme.bodyWeight || 500, fontFamily }) : "",
      cards
    ].join("");
  }

  if (template === "detail-callout") {
    const x = Math.round(width * 0.64);
    const y = Math.round(height * 0.12);
    const label = labels[0] || title;
    const label2 = labels[1] || "";
    return [
      `<line x1="${x - Math.round(width * 0.16)}" y1="${y + Math.round(base * 0.18)}" x2="${x + Math.round(width * 0.02)}" y2="${y + Math.round(base * 0.06)}" stroke="${escapeHtml(lineFill)}" stroke-width="${Math.max(1, Math.round(base * 0.0015))}" opacity="0.8"/>`,
      `<circle cx="${x - Math.round(width * 0.16)}" cy="${y + Math.round(base * 0.18)}" r="${Math.max(3, Math.round(base * 0.004))}" fill="${escapeHtml(lineFill)}"/>`,
      `<rect x="${x}" y="${y}" width="${Math.round(width * 0.27)}" height="${Math.round(base * 0.12)}" rx="${Math.round(base * 0.006 * (theme.radiusScale || 1))}" fill="${escapeHtml(panel)}" stroke="${escapeHtml(theme.cardStroke || "#e4ddd2")}" stroke-width="${Math.max(1, Math.round(base * 0.0012))}"/>`,
      localSvgTextBlock({ lines: [title], x: x + Math.round(base * 0.024), y: y + Math.round(base * 0.044), size: Math.max(22, Math.round(base * 0.028 * (theme.titleScale || 1))), fill: titleFill, weight: theme.titleWeight || 700, fontFamily }),
      localSvgTextBlock({ lines: [label, label2].filter(Boolean), x: x + Math.round(base * 0.024), y: y + Math.round(base * 0.083), size: labelSize, fill: subtitleFill, weight: theme.bodyWeight || 500, lineGap: 1.22, fontFamily })
    ].join("");
  }

  return [
    `<line x1="${marginX}" y1="${marginY - Math.round(base * 0.022)}" x2="${marginX + Math.round(width * 0.16)}" y2="${marginY - Math.round(base * 0.022)}" stroke="${escapeHtml(lineFill)}" stroke-width="${Math.max(2, Math.round(base * 0.003))}"/>`,
    localSvgTextBlock({ lines: localOverlayTextLines(title, 10), x: marginX, y: marginY + titleSize, size: titleSize, fill: titleFill, weight: theme.titleWeight || 700, fontFamily }),
    subtitle ? localSvgTextBlock({ lines: [subtitle], x: marginX, y: marginY + titleSize + Math.round(base * 0.04), size: subSize, fill: subtitleFill, weight: theme.bodyWeight || 500, fontFamily }) : "",
    labels.slice(0, 2).map((label, index) => {
      const y = marginY + titleSize + Math.round(base * 0.082) + index * Math.round(base * 0.038);
      return `<circle cx="${marginX + Math.round(base * 0.009)}" cy="${y - Math.round(labelSize * 0.28)}" r="${Math.max(3, Math.round(base * 0.004))}" fill="${escapeHtml(lineFill)}"/>${localSvgTextBlock({ lines: [label], x: marginX + Math.round(base * 0.026), y, size: labelSize, fill: titleFill, weight: theme.labelWeight || 550, fontFamily })}`;
    }).join("")
  ].join("");
}

function renderLocalTextOverlayImage(baseImageUrl = "", shot = {}) {
  if (!baseImageUrl || !shot?.textOverlay?.theme) return "";
  const { width, height } = overlayCanvasSizeFromShot(shot);
  const overlayNodes = localShotTextOverlaySvgNodes(shot.textOverlay, { width, height });
  if (!overlayNodes) return "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${escapeHtml(baseImageUrl)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`,
    overlayNodes,
    "</svg>"
  ].join("");
  return encodeSvgDataUrl(svg);
}

function refreshPlanTextOverlayPreviews(plan = state.plan) {
  if (normalizeToolKey(state.activeTool) === "product") return;
  (plan?.shots || []).forEach((shot) => {
    const key = shot?.textOverlay?.themeKey || shot?.textOverlay?.theme?.key || "";
    if (!shot?.noTextImageUrl || !shot?.textOverlay?.theme || !key) return;
    const overlayKey = `${key}:${shot.noTextImageUrl}`;
    if (shot.localTextOverlayThemeKey === overlayKey && shot.imageUrl) return;
    const inlineBase = shot.noTextImageUrl.startsWith("data:")
      ? shot.noTextImageUrl
      : localTextOverlayBaseCache.get(shot.noTextImageUrl);
    if (!inlineBase) {
      if (shot.imageUrl?.startsWith("data:image/svg+xml")) shot.imageUrl = shot.noTextImageUrl;
      scheduleLocalTextOverlayBaseLoad(plan, shot);
      return;
    }
    const rendered = renderLocalTextOverlayImage(inlineBase, shot);
    if (!rendered) return;
    shot.textImageUrl = rendered;
    shot.imageUrl = rendered;
    shot.localTextOverlayThemeKey = overlayKey;
  });
}

function isPhone(value) {
  return /^1\d{10}$/.test(String(value || "").trim());
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function setAuthMode(mode) {
  const previousMode = state.authMode;
  state.authMode = mode;
  els.loginTab.classList.toggle("is-active", mode === "login");
  els.registerTab.classList.toggle("is-active", mode === "register");
  els.registerMethods.hidden = mode !== "register";
  els.authCodeRow.hidden = mode !== "register";
  els.authSubtitle.textContent =
    mode === "login" ? "使用手机号或邮箱登录" : "选择手机号注册或邮箱注册，验证码会发送到对应账号";
  els.authSubmit.textContent = mode === "login" ? "登录" : "完成注册";
  els.authPassword.setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  if (previousMode !== mode) {
    els.authPassword.value = "";
  }
  if (mode === "login") {
    els.authAccountLabel.textContent = "手机号 / 邮箱";
    els.authPhone.placeholder = "请输入手机号或邮箱";
  } else {
    setAuthChannel(state.authChannel);
  }
}

function setAuthChannel(channel) {
  state.authChannel = channel === "email" ? "email" : "phone";
  els.registerMethods.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authChannel === state.authChannel);
  });
  if (state.authMode !== "register") return;
  els.authAccountLabel.textContent = state.authChannel === "phone" ? "手机号" : "邮箱";
  els.authPhone.placeholder = state.authChannel === "phone" ? "请输入 11 位手机号" : "请输入邮箱地址";
  els.authPhone.value = "";
  els.authCode.value = "";
}

function showAuth() {
  els.authView.hidden = false;
  els.appView.hidden = true;
  els.adminPanel.hidden = true;
  els.workspaceTabs.hidden = true;
  els.plannerLayout.hidden = false;
  if (els.adminNavButton) els.adminNavButton.hidden = true;
}

function showApp() {
  els.authView.hidden = true;
  els.appView.hidden = false;
  renderAccount();
  refreshCost();
  renderEmptyPlan();
  renderGenerationHistory();
  void loadAccountGenerationHistory();
  if (state.user?.role === "admin") {
    if (els.adminNavButton) els.adminNavButton.hidden = false;
    state.adminView = "workspace";
    syncWorkspaceShell();
    void loadAdminSettings();
    void loadAdminDashboard();
    void loadAdminSupportMessages();
  } else {
    if (els.adminNavButton) els.adminNavButton.hidden = true;
    els.workspaceTabs.hidden = true;
    els.adminPanel.hidden = true;
    els.plannerLayout.hidden = false;
    syncWorkspaceShell();
  }
}

function renderAccount() {
  if (!state.user) return;
  const label = state.user.role === "admin" ? "管理员" : `余额 ${state.user.balance} 积分`;
  els.balanceText.textContent = label;
  if (els.adminNavButton) els.adminNavButton.hidden = state.user.role !== "admin";
}

function ledgerDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

async function loadPersonalCenter() {
  if (!state.user || !els.personalCenterSummary) return;
  els.personalCenterSummary.innerHTML = `
    <div><strong>${escapeHtml(state.user.balance || 0)} 积分</strong><span>当前余额</span></div>
    <div><strong>读取中</strong><span>累计充值</span></div>
    <div><strong>读取中</strong><span>累计消费</span></div>
  `;
  els.personalCenterList.innerHTML = '<p class="muted-line">正在读取账号记录...</p>';
  try {
    const payload = await api("/api/account/ledger");
    state.personalCenter = payload;
    if (payload.user) {
      state.user = payload.user;
      renderAccount();
    }
    renderPersonalCenter();
  } catch (error) {
    els.personalCenterList.innerHTML = `<p class="muted-line is-error-text">${escapeHtml(error.message)}</p>`;
  }
}

function renderPersonalCenter() {
  const payload = state.personalCenter || {};
  const totals = payload.totals || {};
  const user = payload.user || state.user || {};
  els.personalCenterSummary.innerHTML = [
    [`${user.balance || 0} 积分`, "当前余额"],
    [`${totals.paidRecharge || 0} 积分`, "累计充值"],
    [`${totals.consumed || 0} 积分`, "累计消费"]
  ]
    .map(([value, label]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");

  document.querySelectorAll("[data-personal-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.personalTab === state.personalTab);
  });

  if (state.personalTab === "payments") {
    renderPersonalRows(
      payload.payments || [],
      (payment) => `
        <strong>${payment.provider === "wechat" ? "微信支付" : "支付宝支付"} · ${escapeHtml(payment.statusText || payment.status || "-")}</strong>
        <span>+${escapeHtml(payment.creditAmount || payment.amount || 0)} 积分</span>
        <small>${escapeHtml(payment.id || "")}${payment.paidAt ? ` · 到账 ${escapeHtml(ledgerDate(payment.paidAt))}` : ""}</small>
      `
    );
    return;
  }

  if (state.personalTab === "leases") {
    renderPersonalRows(
      payload.apiKeyLeases || [],
      (lease) => `
        <strong>${escapeHtml(lease.modelLabel || lease.modelId || "模型额度")}</strong>
        <span>${escapeHtml(lease.remainingCredits || 0)} / ${escapeHtml(lease.totalCredits || 0)} 积分</span>
        <small>${escapeHtml(lease.status || "-")} · ${escapeHtml(lease.keyMasked || "-")}</small>
      `
    );
    return;
  }

  renderPersonalRows(
    payload.consumption || [],
    (item) => `
      <strong>${escapeHtml(item.type || "作图消费")} · ${escapeHtml(item.statusText || item.status || "-")}</strong>
      <span>-${escapeHtml(item.credits || 0)} 积分</span>
      <small>${escapeHtml(item.model || "-")} · ${escapeHtml(item.totalImages || 0)} 张${item.apiKeyLease ? ` · ${escapeHtml(item.apiKeyLease)}` : ""}</small>
    `
  );
}

function renderPersonalRows(rows, render) {
  if (!rows.length) {
    els.personalCenterList.innerHTML = '<p class="muted-line">暂无记录。</p>';
    return;
  }
  els.personalCenterList.innerHTML = rows
    .slice(0, 60)
    .map((row) => `<article>${render(row)}<small>${escapeHtml(ledgerDate(row.createdAt || row.paidAt))}</small></article>`)
    .join("");
}

function setAdminView(view) {
  setActiveTool(view === "admin" ? "admin" : "product");
}

async function handleAuthSubmit() {
  const account = els.authPhone.value.trim();
  const password = els.authPassword.value;
  if (state.authMode === "login" && !account) {
    markAuthError("请输入手机号或邮箱");
    return;
  }
  if (state.authMode === "register") {
    if (state.authChannel === "phone" && !isPhone(account)) {
      markAuthError("请输入 11 位中国大陆手机号");
      return;
    }
    if (state.authChannel === "email" && !isEmail(account)) {
      markAuthError("请输入正确的邮箱地址");
      return;
    }
    if (!/^\d{6}$/.test(els.authCode.value.trim())) {
      markAuthError("请输入 6 位验证码");
      return;
    }
  }
  if (password.length < 6) {
    markAuthError("密码至少 6 位");
    return;
  }

  els.authSubmit.disabled = true;
  els.authSubmit.textContent = state.authMode === "login" ? "登录中..." : "注册中...";
  try {
    const payload = await api(state.authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ account, password, code: els.authCode.value.trim() })
    });
    state.token = payload.token;
    state.user = payload.user;
    state.generationHistory = { product: [], style: [], templates: [] };
    state.workspacePlans = { product: null, style: null };
    state.plan = null;
    localStorage.setItem("lamp_token", state.token);
    showApp();
  } catch (error) {
    markAuthError(error.message);
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = state.authMode === "login" ? "登录" : "完成注册";
  }
}

async function sendRegisterCode() {
  const account = els.authPhone.value.trim();
  if (state.authChannel === "phone" && !isPhone(account)) {
    markAuthError("请输入 11 位中国大陆手机号");
    return;
  }
  if (state.authChannel === "email" && !isEmail(account)) {
    markAuthError("请输入正确的邮箱地址");
    return;
  }
  els.sendCodeButton.disabled = true;
  els.sendCodeButton.textContent = "发送中...";
  try {
    await api("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ account })
    });
    let seconds = 60;
    els.sendCodeButton.textContent = `${seconds}s`;
    const timer = window.setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        window.clearInterval(timer);
        els.sendCodeButton.disabled = false;
        els.sendCodeButton.textContent = "发送验证码";
      } else {
        els.sendCodeButton.textContent = `${seconds}s`;
      }
    }, 1000);
    markAuthError("验证码已发送，请查收", false);
  } catch (error) {
    els.sendCodeButton.disabled = false;
    els.sendCodeButton.textContent = "发送验证码";
    markAuthError(error.message);
  }
}

function markAuthError(message, isError = true) {
  els.authSubtitle.textContent = message;
  els.authSubtitle.classList.toggle("is-error-text", isError);
  window.setTimeout(() => {
    els.authSubtitle.classList.remove("is-error-text");
    els.authSubtitle.textContent =
      state.authMode === "login" ? "使用手机号或邮箱登录" : "选择手机号注册或邮箱注册，验证码会发送到对应账号";
  }, 2600);
}

async function restoreSession() {
  if (!state.token) {
    showAuth();
    return;
  }
  try {
    const payload = await api("/api/account");
    state.user = payload.user;
    showApp();
  } catch {
    state.token = "";
    localStorage.removeItem("lamp_token");
    showAuth();
  }
}

function modelOptionsHtml(value = "") {
  const options = state.config?.modelOptions || [
    { id: "nano-banana-2", label: "Nano Banana 2" },
    { id: "gpt-image-2", label: "GPT Image-2" }
  ];
  return options
    .map((model) => `<option value="${model.id}" ${model.id === value ? "selected" : ""}>${escapeHtml(model.label)}</option>`)
    .join("");
}

function imageModelMeta(value = els.modelSelect?.value || "") {
  const options = state.config?.modelOptions || [
    { id: "nano-banana-2", label: "Nano Banana 2", provider: "gemini", badge: "快" },
    { id: "gpt-image-2", label: "GPT Image-2", provider: "openai", badge: "新" }
  ];
  return options.find((model) => model.id === value) || options[0] || { id: value, label: value || "未选择模型" };
}

function defaultImageModelValue() {
  return state.config?.defaultImageModel || "nano-banana-2";
}

function modelSelectForTool(tool = state.activeTool) {
  if (tool === "style") return els.styleModelSelect;
  if (tool === "templates") return els.collageModelSelect;
  return els.modelSelect;
}

function claritySelectForTool(tool = state.activeTool) {
  if (tool === "style") return els.styleClaritySelect;
  if (tool === "templates") return els.collageClaritySelect;
  return els.claritySelect;
}

function selectedImageModelValue(tool = state.activeTool) {
  const key = workspaceSettingKey(tool);
  const select = modelSelectForTool(tool);
  return state.workspaceModels?.[key] || select?.value || defaultImageModelValue();
}

function setWorkspaceModel(tool = state.activeTool, value = "") {
  const key = workspaceSettingKey(tool);
  const nextValue = value || selectedImageModelValue(tool) || defaultImageModelValue();
  if (!state.workspaceModels) state.workspaceModels = { product: "", style: "", templates: "" };
  state.workspaceModels[key] = nextValue;
  const select = modelSelectForTool(tool);
  if (select) select.value = nextValue;
  return nextValue;
}

function syncImageModelControls(value = selectedImageModelValue(), tool = state.activeTool) {
  return setWorkspaceModel(tool, value);
}

function selectedClarityValue(tool = state.activeTool) {
  const key = workspaceSettingKey(tool);
  const select = claritySelectForTool(tool);
  return state.workspaceClarities?.[key] || select?.value || "2k";
}

function setWorkspaceClarity(tool = state.activeTool, value = "") {
  const key = workspaceSettingKey(tool);
  const nextValue = value || selectedClarityValue(tool) || "2k";
  if (!state.workspaceClarities) state.workspaceClarities = { product: "", style: "", templates: "" };
  state.workspaceClarities[key] = nextValue;
  const select = claritySelectForTool(tool);
  if (select) select.value = nextValue;
  return nextValue;
}

function clarityMeta(value = selectedClarityValue()) {
  const rules = state.config?.creditRules || {};
  return rules.clarity?.[value] || {
    label: value === "1k" ? "1K 快速" : value === "4k" ? "4K 高清" : "2K 高清",
    multiplier: value === "4k" ? 1.6 : value === "1k" ? 0.8 : 1
  };
}

function renderStyleModelHint() {
  if (!els.styleModelHint) return;
  const model = imageModelMeta(selectedImageModelValue());
  const clarity = clarityMeta(els.styleClaritySelect?.value || selectedClarityValue());
  const provider = model.provider === "gemini" ? "Gemini / Nano Banana 通道" : model.provider === "openai" ? "OpenAI 图像通道" : "后台配置通道";
  const speed =
    model.id === "nano-banana-pro"
      ? "更适合复杂透视和高稳定换主体"
      : model.id === "nano-banana-2"
        ? "适合快速图生图和批量参考生成"
        : model.id === "gpt-image-2"
          ? "适合主图、海报和商品图编辑"
          : "按后台模型能力生成";
  els.styleModelHint.textContent = `${model.label} · ${clarity.label} · ${provider} · ${speed}`;
}

function syncStyleModelSelect() {
  setWorkspaceModel("product", selectedImageModelValue("product"));
  setWorkspaceModel("style", selectedImageModelValue("style"));
  setWorkspaceModel("templates", selectedImageModelValue("templates"));
  setWorkspaceClarity("product", selectedClarityValue("product"));
  setWorkspaceClarity("style", selectedClarityValue("style"));
  setWorkspaceClarity("templates", selectedClarityValue("templates"));
  renderStyleModelHint();
}

function analysisModelOptionsHtml(value = "") {
  const options = state.config?.analysisModelOptions || [
    { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    { id: "gpt-5.2", label: "GPT-5.2" },
    { id: "gpt-5.2-pro", label: "GPT-5.2 Pro" },
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "gpt-5-nano", label: "GPT-5 Nano" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "deepseek-chat", label: "DeepSeek Chat" }
  ];
  return options
    .map((model) => `<option value="${model.id}" ${model.id === value ? "selected" : ""}>${escapeHtml(model.label)}</option>`)
    .join("");
}

function renderModelOptions() {
  const defaultId = state.config?.defaultImageModel || "nano-banana-2";
  const analysisId = state.config?.defaultAnalysisModel || "gpt-5.2";
  els.modelSelect.innerHTML = modelOptionsHtml(selectedImageModelValue("product") || defaultId);
  if (els.styleModelSelect) els.styleModelSelect.innerHTML = modelOptionsHtml(selectedImageModelValue("style") || defaultId);
  if (els.collageModelSelect) els.collageModelSelect.innerHTML = modelOptionsHtml(selectedImageModelValue("templates") || defaultId);
  els.adminDefaultImageModel.innerHTML = modelOptionsHtml(defaultId);
  els.adminDefaultAnalysisModel.innerHTML = analysisModelOptionsHtml(analysisId);
  syncStyleModelSelect();
}

function renderAdminHealth(settings = {}) {
  if (!els.adminHealthGrid) return;
  const activeImageChannel = settings.hasYunwuKey && settings.yunwuEnabled
    ? "云雾 API"
    : settings.hasAPIYiKey && settings.apiyiEnabled !== false
      ? "API易"
      : settings.hasOpenAIKey
        ? "OpenAI"
        : "未配置";
  const activeProviderLabels = {
    yunwu: "云雾 API",
    apiyi: "API易",
    openai: "OpenAI"
  };
  const activeProviderLabel = activeProviderLabels[settings.activeImageProvider] || activeImageChannel;
  const analysisOptions = state.config?.analysisModelOptions || [];
  const analysisLabel =
    analysisOptions.find((model) => model.id === settings.defaultAnalysisModel)?.label ||
    settings.defaultAnalysisModel ||
    "未设置";
  const imageKeySummary = [
    settings.hasYunwuKey ? "云雾已配" : "云雾未配",
    settings.hasAPIYiKey ? "API易已配" : "API易未配",
    settings.hasOpenAIKey ? "OpenAI已配" : "OpenAI未配"
  ].join(" / ");
  const verificationSummary = [
    settings.verification?.smsReady ? "短信可用" : "短信待配",
    settings.verification?.emailReady ? "邮箱可用" : "邮箱待配"
  ].join(" / ");
  const checks = [
    {
      label: "出图通道",
      ready: activeProviderLabel !== "未配置",
      detail: activeProviderLabel
    },
    {
      label: "通道密钥",
      ready: Boolean(settings.hasYunwuKey || settings.hasAPIYiKey || settings.hasOpenAIKey),
      detail: imageKeySummary
    },
    {
      label: "Sub2API 网关",
      ready: Boolean(settings.sub2apiEnabled && settings.sub2apiBaseUrl),
      detail: settings.sub2apiBaseUrl ? `${settings.sub2apiBaseUrl}${settings.hasSub2APIAdminToken ? " / 已配置 JWT" : " / 待配置 JWT"}` : "未配置"
    },
    {
      label: "识别模型",
      ready: Boolean(settings.hasGeminiKey || settings.hasOpenAIKey || settings.hasAPIYiKey || settings.hasYunwuKey),
      detail: analysisLabel
    },
    {
      label: "验证服务",
      ready: Boolean(settings.verification?.smsReady || settings.verification?.emailReady),
      detail: verificationSummary
    },
    {
      label: "客服入口",
      ready: Boolean(settings.supportWechat || settings.supportOnlineReply),
      detail: settings.supportOnlineReply ? "在线回复已开启" : settings.supportWechat || "待配置微信"
    }
  ];
  els.adminHealthGrid.innerHTML = checks
    .map(
      (item) => `
        <article class="${item.ready ? "is-ready" : "is-missing"}">
          <span>${item.ready ? "正常" : "待配置"}</span>
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(item.detail || "")}</small>
        </article>
      `
    )
    .join("");
}

function syncAdminImageProviderToggles(preferred = "") {
  if (els.adminImageProvider && preferred && els.adminImageProvider.value !== preferred) {
    els.adminImageProvider.value = preferred;
  }
  if (preferred === "yunwu" && els.adminYunwuEnabled?.checked && els.adminAPIYiEnabled) {
    els.adminAPIYiEnabled.checked = false;
  }
  if (preferred === "apiyi" && els.adminAPIYiEnabled?.checked && els.adminYunwuEnabled) {
    els.adminYunwuEnabled.checked = false;
  }
  if (preferred === "openai") {
    if (els.adminYunwuEnabled) els.adminYunwuEnabled.checked = false;
    if (els.adminAPIYiEnabled) els.adminAPIYiEnabled.checked = false;
  }
}

function syncAdminProviderFromSelect() {
  const provider = els.adminImageProvider?.value || "";
  if (provider === "yunwu") {
    if (els.adminYunwuEnabled) els.adminYunwuEnabled.checked = true;
    if (els.adminAPIYiEnabled) els.adminAPIYiEnabled.checked = false;
  } else if (provider === "apiyi") {
    if (els.adminAPIYiEnabled) els.adminAPIYiEnabled.checked = true;
    if (els.adminYunwuEnabled) els.adminYunwuEnabled.checked = false;
  } else if (provider === "openai") {
    if (els.adminAPIYiEnabled) els.adminAPIYiEnabled.checked = false;
    if (els.adminYunwuEnabled) els.adminYunwuEnabled.checked = false;
  }
}

function renderAdminSub2APIStatus(data = {}) {
  if (!els.adminSub2APIStatus) return;
  const enabled = data.enabled !== false && Boolean(data.baseUrl || data.healthStatus);
  const adminText =
    data.adminOk === true
      ? "管理员接口可用"
      : data.hasAdminToken || data.adminStatus
        ? "管理员接口待验证"
        : "未配置管理员 JWT";
  const detail = [
    data.baseUrl || "未填写 Base URL",
    data.healthStatus ? `health ${data.healthStatus}` : "",
    data.elapsedMs ? `${data.elapsedMs}ms` : "",
    data.summary || adminText
  ]
    .filter(Boolean)
    .join(" · ");
  els.adminSub2APIStatus.classList.toggle("is-ok", Boolean(data.ok || data.adminOk));
  els.adminSub2APIStatus.classList.toggle("is-warning", !data.ok && enabled);
  els.adminSub2APIStatus.innerHTML = `
    <strong>${data.ok || data.adminOk ? "Sub2API 已连通" : enabled ? "Sub2API 待验证" : "Sub2API 未启用"}</strong>
    <span>${escapeHtml(detail)}</span>
  `;
}

function focusAdminGroup(group = "") {
  const key = String(group || "").trim();
  if (!key) return;
  const section = document.querySelector(`[data-admin-group="${CSS.escape(key)}"]`);
  if (!section) return;
  if ("open" in section) section.open = true;
  if (els.adminSectionSelect && els.adminSectionSelect.value !== key) {
    els.adminSectionSelect.value = key;
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshAdminWorkspace(message = "后台数据已刷新") {
  if (state.user?.role !== "admin") return;
  const buttons = [els.adminRefreshAll, els.refreshAdminDashboard].filter(Boolean);
  buttons.forEach((button) => (button.disabled = true));
  if (els.adminQuickStatus) els.adminQuickStatus.textContent = "正在刷新后台数据...";
  try {
    await initConfig();
    await loadAdminSettings();
    await loadAdminDashboard();
    await loadAdminSupportMessages();
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = message;
  } catch (error) {
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = error.message;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

function clearAdminSecretInputs() {
  [
    els.adminOpenAIKey,
    els.adminGeminiKey,
    els.adminAPIYiKey,
    els.adminYunwuKey,
    els.adminSub2APIAdminToken,
    els.adminSmsAccessKeyId,
    els.adminSmsAccessKeySecret,
    els.adminSmtpUser,
    els.adminSmtpPass
  ]
    .filter(Boolean)
    .forEach((input) => {
      input.value = "";
    });
  if (els.adminQuickStatus) els.adminQuickStatus.textContent = "密钥输入框已清空，已保存配置不会被删除";
}

function editableModelChannels(channels = []) {
  return (channels || [])
    .filter((channel) => !channel.legacy)
    .map((channel) => ({
      id: channel.id,
      label: channel.label,
      provider: channel.provider,
      baseUrl: channel.baseUrl || "",
      apiKey: "",
      purpose: channel.purpose || "both",
      models: channel.models || ["*"],
      maxConcurrency: Number(channel.maxConcurrency || 1),
      rpm: Number(channel.rpm || 0),
      priority: Number(channel.priority || 10),
      enabled: channel.enabled !== false
    }));
}

function renderAdminModelChannels(settings = {}) {
  if (!els.adminModelChannelsJson) return;
  const channels = settings.modelChannels || [];
  els.adminModelChannelsJson.value = JSON.stringify(editableModelChannels(channels), null, 2);
  const capacity = settings.modelChannelCapacity || {};
  const active = channels.reduce((sum, channel) => sum + Number(channel.active || 0), 0);
  const total = channels.reduce((sum, channel) => sum + Number(channel.maxConcurrency || 0), 0);
  if (els.adminModelChannelsStatus) {
    els.adminModelChannelsStatus.textContent = `通道 ${channels.length} 条，并发占用 ${active}/${total}，识别槽 ${capacity.analysis || 0}，出图槽 ${capacity.generation || 0}`;
  }
}

function readAdminModelChannels() {
  if (!els.adminModelChannelsJson) return [];
  const text = els.adminModelChannelsJson.value.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("模型通道池 JSON 必须是数组");
  return parsed;
}

async function loadAdminSettings() {
  try {
    const payload = await api("/api/admin/settings");
    const settings = payload.settings || {};
    const imageChannelReady = Boolean(
      (settings.hasYunwuKey && settings.yunwuEnabled) ||
        (settings.hasAPIYiKey && settings.apiyiEnabled !== false) ||
        settings.hasOpenAIKey
    );
    const readyChecks = [
      imageChannelReady,
      settings.hasAPIYiKey || settings.hasYunwuKey || settings.hasOpenAIKey,
      settings.sub2apiEnabled && settings.sub2apiBaseUrl,
      settings.hasGeminiKey || settings.hasOpenAIKey || settings.hasAPIYiKey || settings.hasYunwuKey,
      settings.verification?.smsReady || settings.verification?.emailReady,
      settings.supportWechat || settings.supportOnlineReply
    ];
    const readyCount = readyChecks.filter(Boolean).length;
    els.adminSettingsStatus.textContent = `配置状态：${readyCount}/${readyChecks.length}`;
    renderAdminHealth(settings);
    renderAdminModelChannels(settings);
    els.adminDefaultImageModel.innerHTML = modelOptionsHtml(settings.defaultImageModel);
    els.adminDefaultAnalysisModel.innerHTML = analysisModelOptionsHtml(settings.defaultAnalysisModel);
    els.adminRealApi.checked = Boolean(settings.realOpenAIImages);
    els.adminAPIYiEnabled.checked = settings.apiyiEnabled !== false;
    els.adminAPIYiKey.placeholder = settings.apiyiKeyMasked || "留空则不修改";
    els.adminAPIYiBaseUrl.value = settings.apiyiBaseUrl || "https://api.apiyi.com/v1";
    if (els.adminYunwuEnabled) els.adminYunwuEnabled.checked = Boolean(settings.yunwuEnabled);
    if (els.adminImageProvider) els.adminImageProvider.value = settings.activeImageProvider || (settings.yunwuEnabled ? "yunwu" : settings.apiyiEnabled !== false ? "apiyi" : "openai");
    syncAdminProviderFromSelect();
    if (els.adminYunwuKey) els.adminYunwuKey.placeholder = settings.yunwuKeyMasked || "留空则不修改";
    if (els.adminYunwuBaseUrl) els.adminYunwuBaseUrl.value = settings.yunwuBaseUrl || "https://yunwu.ai/v1";
    if (els.adminSub2APIEnabled) els.adminSub2APIEnabled.checked = Boolean(settings.sub2apiEnabled);
    if (els.adminSub2APIBaseUrl) els.adminSub2APIBaseUrl.value = settings.sub2apiBaseUrl || "";
    if (els.adminSub2APIAdminToken) els.adminSub2APIAdminToken.placeholder = settings.sub2apiAdminTokenMasked || "JWT 留空则不修改";
    if (els.adminSub2APIDashboardPath) els.adminSub2APIDashboardPath.value = settings.sub2apiDashboardPath || "/admin";
    renderAdminSub2APIStatus({
      enabled: Boolean(settings.sub2apiEnabled),
      baseUrl: settings.sub2apiBaseUrl || "",
      hasAdminToken: Boolean(settings.hasSub2APIAdminToken),
      summary: settings.sub2apiDashboardUrl ? `管理入口 ${settings.sub2apiDashboardUrl}` : ""
    });
    els.adminSupportWechat.value = settings.supportWechat || "";
    els.adminSupportWechatQr.value = settings.supportWechatQrUrl || "";
    els.adminSupportWelcome.value = settings.supportWelcome || "";
    els.adminSupportOnline.checked = Boolean(settings.supportOnlineReply);
    els.adminSmsAccessKeyId.placeholder = settings.smsAccessKeyIdMasked || "留空则不修改";
    els.adminSmsAccessKeySecret.placeholder = settings.smsAccessKeySecretMasked || "留空则不修改";
    els.adminSmsSignName.value = settings.smsSignName || "";
    els.adminSmsTemplateCode.value = settings.smsTemplateCode || "";
    els.adminSmtpHost.value = settings.smtpHost || "";
    els.adminSmtpPort.value = settings.smtpPort || "";
    els.adminSmtpSecure.checked = settings.smtpSecure !== false;
    els.adminSmtpUser.placeholder = settings.smtpUserMasked || "留空则不修改";
    els.adminSmtpFrom.value = settings.smtpFrom || "";
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = "后台配置已读取";
  } catch (error) {
    els.adminSettingsStatus.textContent = error.message;
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = error.message;
  }
}

async function saveAdminSettings() {
  els.saveAdminSettings.disabled = true;
  els.adminSettingsStatus.textContent = "正在保存...";
  try {
    const yunwuToken = els.adminYunwuKey?.value.trim() || "";
    const apiyiToken = els.adminAPIYiKey.value.trim();
    const imageProvider = yunwuToken
      ? "yunwu"
      : apiyiToken
        ? "apiyi"
        : els.adminImageProvider?.value || (els.adminYunwuEnabled?.checked ? "yunwu" : els.adminAPIYiEnabled.checked ? "apiyi" : "openai");
    const preferYunwu = imageProvider === "yunwu";
    const preferAPIYi = imageProvider === "apiyi";
    await api("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        openaiApiKey: els.adminOpenAIKey.value.trim(),
        geminiApiKey: els.adminGeminiKey.value.trim(),
        apiyiApiKey: apiyiToken,
        apiyiToken,
        apiyiBaseUrl: els.adminAPIYiBaseUrl.value.trim(),
        imageProvider,
        apiyiEnabled: preferYunwu ? false : preferAPIYi,
        yunwuApiKey: yunwuToken,
        yunwuToken,
        yunwuBaseUrl: els.adminYunwuBaseUrl?.value.trim() || "",
        yunwuEnabled: preferYunwu,
        sub2apiEnabled: Boolean(els.adminSub2APIEnabled?.checked),
        sub2apiBaseUrl: els.adminSub2APIBaseUrl?.value.trim() || "",
        sub2apiAdminToken: els.adminSub2APIAdminToken?.value.trim() || "",
        sub2apiDashboardPath: els.adminSub2APIDashboardPath?.value.trim() || "/admin",
        realOpenAIImages: (apiyiToken || yunwuToken) ? true : els.adminRealApi.checked,
        defaultImageModel: els.adminDefaultImageModel.value,
        defaultAnalysisModel: els.adminDefaultAnalysisModel.value,
        supportWechat: els.adminSupportWechat.value.trim(),
        supportWechatQrUrl: els.adminSupportWechatQr.value.trim(),
        supportWelcome: els.adminSupportWelcome.value.trim(),
        supportOnlineReply: els.adminSupportOnline.checked,
        smsAccessKeyId: els.adminSmsAccessKeyId.value.trim(),
        smsAccessKeySecret: els.adminSmsAccessKeySecret.value.trim(),
        smsSignName: els.adminSmsSignName.value.trim(),
        smsTemplateCode: els.adminSmsTemplateCode.value.trim(),
        smtpHost: els.adminSmtpHost.value.trim(),
        smtpPort: els.adminSmtpPort.value.trim(),
        smtpSecure: els.adminSmtpSecure.checked,
        smtpUser: els.adminSmtpUser.value.trim(),
        smtpPass: els.adminSmtpPass.value,
        smtpFrom: els.adminSmtpFrom.value.trim(),
        modelChannels: readAdminModelChannels()
      })
    });
    els.adminOpenAIKey.value = "";
    els.adminGeminiKey.value = "";
    els.adminAPIYiKey.value = "";
    if (els.adminYunwuKey) els.adminYunwuKey.value = "";
    if (els.adminSub2APIAdminToken) els.adminSub2APIAdminToken.value = "";
    els.adminSmsAccessKeyId.value = "";
    els.adminSmsAccessKeySecret.value = "";
    els.adminSmtpUser.value = "";
    els.adminSmtpPass.value = "";
    await initConfig();
    await loadAdminSettings();
    await loadAdminDashboard();
    els.adminSettingsStatus.textContent = "管理员配置已保存";
  } catch (error) {
    els.adminSettingsStatus.textContent = error.message;
  } finally {
    els.saveAdminSettings.disabled = false;
  }
}

async function testAdminSub2APIConnection() {
  if (!els.adminTestSub2API) return;
  els.adminTestSub2API.disabled = true;
  renderAdminSub2APIStatus({
    enabled: Boolean(els.adminSub2APIEnabled?.checked),
    baseUrl: els.adminSub2APIBaseUrl?.value.trim() || "",
    summary: "正在连接 Sub2API..."
  });
  try {
    await saveAdminSettings();
    const payload = await api("/api/admin/sub2api/test", { method: "POST", body: JSON.stringify({}) });
    renderAdminSub2APIStatus(payload.result || {});
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = payload.result?.adminOk ? "Sub2API 管理接口已连通" : "Sub2API 服务已连通，管理员 JWT 待确认";
  } catch (error) {
    renderAdminSub2APIStatus({
      enabled: true,
      baseUrl: els.adminSub2APIBaseUrl?.value.trim() || "",
      summary: error.message
    });
    if (els.adminQuickStatus) els.adminQuickStatus.textContent = error.message;
  } finally {
    els.adminTestSub2API.disabled = false;
  }
}

function openAdminSub2APIConsole() {
  const baseUrl = els.adminSub2APIBaseUrl?.value.trim().replace(/\/+$/, "");
  const path = els.adminSub2APIDashboardPath?.value.trim() || "/admin";
  if (!baseUrl) {
    renderAdminSub2APIStatus({ enabled: true, summary: "请先填写 Sub2API Base URL" });
    return;
  }
  const target = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  window.open(target, "_blank", "noopener,noreferrer");
  if (els.adminQuickStatus) els.adminQuickStatus.textContent = "已打开 Sub2API 管理系统";
}

async function loadAdminSupportMessages() {
  if (state.user?.role !== "admin") return;
  try {
    const payload = await api("/api/support/messages");
    renderAdminSupportMessages(payload.messages || []);
  } catch {
    renderAdminSupportMessages([]);
  }
}

async function loadAdminDashboard() {
  if (state.user?.role !== "admin") return;
  try {
    const payload = await api("/api/admin/dashboard");
    state.adminDashboard = payload;
    renderAdminDashboard(payload);
  } catch (error) {
    els.adminStats.innerHTML = `<span class="is-error-text">${escapeHtml(error.message)}</span>`;
  }
}

function renderAdminDashboard(payload) {
  const stats = payload.stats || {};
  els.adminStats.innerHTML = [
    ["用户数", stats.totalUsers || 0],
    ["用户总余额", `${stats.totalBalance || 0} 积分`],
    ["已到账充值", `${stats.paidRecharge || 0} 积分`],
    ["生成任务", stats.consumptionCount || 0],
    ["活跃模型额度", stats.activeModelLeases ?? stats.activeApiKeys ?? 0],
    ["待回复咨询", stats.openSupport || 0]
  ]
    .map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");

  const query = String(state.adminUserSearch || "").trim().toLowerCase();
  const users = (payload.users || []).filter((user) => {
    if (!query) return true;
    return [user.account, user.phone, user.email, user.role].some((value) => String(value || "").toLowerCase().includes(query));
  });
  els.adminUsers.innerHTML = users.length
    ? `
      <table>
        <thead><tr><th>账号</th><th>角色</th><th>余额</th><th>注册时间</th><th>调整积分</th></tr></thead>
        <tbody>
          ${users
            .map(
              (user) => `
                <tr>
                  <td>${escapeHtml(user.account || user.phone)}</td>
                  <td>${user.role === "admin" ? "管理员" : "用户"}</td>
                  <td>${escapeHtml(user.balance)} 积分</td>
                  <td>${user.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}</td>
                  <td>
                    ${
                      user.role === "admin"
                        ? "不可调整"
                        : `<div class="balance-tools" data-account="${escapeHtml(user.account || user.phone)}">
                            <input type="number" value="${escapeHtml(user.balance)}" />
                            <button data-balance-mode="set" type="button">设为</button>
                            <button data-balance-mode="add" type="button">追加</button>
                          </div>`
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `
    : '<p class="muted-line">暂无用户数/p>';

  if (els.adminFinanceSummary) {
    els.adminFinanceSummary.innerHTML = [
      ["到账充值", `${stats.paidRecharge || 0} 积分`],
      ["用户余额", `${stats.totalBalance || 0} 积分`],
      ["充值记录", (payload.payments || []).length],
      ["生成任务", stats.consumptionCount || 0]
    ]
      .map(([label, value]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`)
      .join("");
  }

  els.adminPayments.innerHTML = compactRows(
    payload.payments || [],
    (payment) =>
      `<strong>${payment.provider === "wechat" ? "\u5fae\u4fe1" : "\u652f\u4ed8\u5b9d"} ${escapeHtml(payment.amount || 0)} \u5143</strong><span>${escapeHtml(
        payment.status || "-"
      )} \u00b7 ${escapeHtml(payment.phone || payment.account || "-")}</span>`
  );
  if (els.adminJobs) els.adminJobs.innerHTML = "";
  els.adminApiLeases.innerHTML = compactRows(
    payload.apiKeyLeases || [],
    (lease) => {
      const usedCredits = Math.max(0, Number(lease.totalCredits || 0) - Number(lease.remainingCredits || 0));
      return `<strong>${escapeHtml(lease.modelLabel || lease.modelId)} · ${escapeHtml(lease.account || "-")}</strong><span>${escapeHtml(
        lease.status || "-"
      )} · 已用 ${escapeHtml(Math.round(usedCredits * 100) / 100)} · 剩余 ${escapeHtml(lease.remainingCredits || 0)} / ${escapeHtml(
        lease.totalCredits || 0
      )} 积分 · ${escapeHtml(lease.lastUsedAt ? ledgerDate(lease.lastUsedAt) : ledgerDate(lease.createdAt))}</span>`;
    }
  );

  els.adminUsers.querySelectorAll("[data-balance-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tools = button.closest(".balance-tools");
      const account = tools.dataset.account;
      const amount = Number(tools.querySelector("input").value);
      button.disabled = true;
      try {
        await api(`/api/admin/users/${encodeURIComponent(account)}/balance`, {
          method: "POST",
          body: JSON.stringify({ mode: button.dataset.balanceMode, amount })
        });
        await loadAdminDashboard();
      } catch (error) {
        button.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  });
}

function compactRows(rows, render) {
  if (!rows.length) return '<p class="muted-line">暂无记录。/p>';
  return rows
    .slice(0, 8)
    .map((row) => `<article>${render(row)}<small>${row.createdAt ? new Date(row.createdAt).toLocaleString() : ""}</small></article>`)
    .join("");
}

function renderAdminSupportMessages(messages) {
  if (!messages.length) {
    els.adminSupportMessages.innerHTML = '<p class="muted-line">暂无用户咨询。/p>';
    return;
  }
  els.adminSupportMessages.innerHTML = messages
    .map(
      (item) => `
        <article class="admin-message" data-id="${item.id}">
          <p><strong>${escapeHtml(item.name || item.account)}</strong>：${escapeHtml(item.message)}</p>
          ${item.reply ? `<p><strong>已回复：</strong>${escapeHtml(item.reply)}</p>` : ""}
          <textarea placeholder="输入管理员回复>${escapeHtml(item.reply || "")}</textarea>"
          <button type="button" data-reply="${item.id}">回复</button>
        </article>
      `
    )
    .join("");
  els.adminSupportMessages.querySelectorAll("[data-reply]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".admin-message");
      const reply = card.querySelector("textarea").value.trim();
      try {
        await api(`/api/admin/support/messages/${button.dataset.reply}/reply`, {
          method: "POST",
          body: JSON.stringify({ reply })
        });
        await loadAdminSupportMessages();
      } catch (error) {
        button.textContent = error.message;
      }
    });
  });
}

function quantityToCounts(quantity) {
  const total = Number(quantity || 13);
  if (total === 4) return { selling: 1, function: 1, scene: 1, detail: 1, real: 0 };
  if (total === 8) return { selling: 2, function: 2, scene: 2, detail: 1, real: 1 };
  if (total === 10) return { selling: 2, function: 2, scene: 3, detail: 2, real: 1 };
  return { selling: 2, function: 2, scene: 4, detail: 3, real: 2 };
}

function blankCounts() {
  return { main: 0, selling: 0, function: 0, scene: 0, detail: 0, real: 0 };
}

function mainQuantityToCounts(quantity) {
  const total = Math.min(6, Math.max(1, Number(quantity || 1) || 1));
  return { ...blankCounts(), main: total };
}

function detailQuantityToCounts(quantity) {
  const total = Math.min(15, Math.max(1, Number(quantity || 13) || 13));
  const counts = blankCounts();
  const sequence = [
    "selling",
    "function",
    "scene",
    "detail",
    "real",
    "scene",
    "function",
    "detail",
    "scene",
    "selling",
    "real",
    "detail",
    "scene",
    "selling",
    "function"
  ];
  sequence.slice(0, total).forEach((category) => {
    counts[category] += 1;
  });
  return counts;
}

function currentCounts(tool = state.activeTool) {
  const key = normalizeToolKey(tool);
  const referenceCount = referenceDrivenCount();
  if (key === "style") {
    if (state.similarMode === "none") return { ...blankCounts(), scene: referenceCount };
    if (state.similarMode === "scene") return { ...blankCounts(), scene: referenceCount };
    if (state.similarMode === "selling") return { ...blankCounts(), selling: referenceCount };
    if (state.similarMode === "detail") return { ...blankCounts(), detail: referenceCount };
    if (state.similarMode === "real") return { ...blankCounts(), real: referenceCount };
  }
  if (state.imageScope === "main") return mainQuantityToCounts(els.quantitySelect.value);
  const template = creationTemplateMeta();
  if (state.templateApplied && template?.counts) return { ...blankCounts(), ...template.counts };
  return detailQuantityToCounts(els.quantitySelect.value);
}

function totalCountFromCounts(counts) {
  return ["main", "selling", "function", "scene", "detail", "real"].reduce((sum, key) => sum + Number(counts?.[key] || 0), 0);
}

function referenceDrivenCount() {
  return Math.max(1, Math.min(15, state.templateReferenceFiles.length || 1));
}

function imageScopeLabel() {
  return state.imageScope === "main" ? "主图" : "详情图组";
}

function generationActionLabel() {
  if (state.activeTool === "style") return "识别并生成";
  return state.imageScope === "main" ? "生成主图" : "生成详情图组";
}

function buildLampTemplatePreviewPlan() {
  return {
    profile: {
      productName: "待识别灯具",
      lampType: "上传手机图后自动识别",
      style: "根据产品图识别",
      material: "根据产品图识别",
      function: "详情页素材自动补全",
      targetSpace: "客厅、餐厅、卧室、玄关、软装搭配",
      installationPosition: "根据灯具类型识别可安装位置",
      installationMethod: "根据灯具结构识别安装方式",
      lightUse: "主照明、氛围照明或局部重点照明",
      sellingPoints: "外观高级感、功能优势、开灯氛围、材质工艺、安装结构、真实实拍质感"
    },
    analysis: {
      source: "template",
      warning: "灯具一键生图模板预览"
    },
    designSpec: {
      title: "产品识别与主体锁定",
      subtitle: "只围绕上传产品图生成",
      sections: [
        {
          title: "主体锁定",
          lines: [
            "上传产品图是唯一主体标准。",
            "生成时只能改变背景、场景、光线和镜头。",
            "不能改款、变形、扭曲、增删部件或画错灯具细类。"
          ]
        }
      ]
    },
    shots: LAMP_TEMPLATE_SHOTS.map((shot, index) => ({
      id: `lamp-template-${index + 1}`,
      ratio: "3:4 竖版",
      imageUrl: "",
      ...shot
    }))
  };
}

function setLampTemplateButtonApplied(applied) {
  state.templateApplied = applied;
  if (!els.applyLampTemplate) return;
  els.applyLampTemplate.classList.toggle("is-applied", applied);
  els.applyLampTemplate.disabled = !state.activeTemplate;
  els.applyLampTemplate.textContent = !state.activeTemplate ? "选择后使用" : applied ? "已使用" : "使用";
}

function selectCreationTemplate(templateId, { markApplied = false } = {}) {
  const template = creationTemplateMeta(templateId);
  if (!template) return;
  state.activeTemplate = template.id;
  state.templateGroup = template.group || "suite";
  setLampTemplateButtonApplied(markApplied);
  renderTemplateCenter();
}

function setTemplateGroup(groupId) {
  const group = TEMPLATE_GROUPS.some((item) => item.id === groupId) ? groupId : "";
  state.templateGroup = group;
  const activeTemplate = creationTemplateMeta();
  if (!activeTemplate || activeTemplate.group !== group) {
    state.activeTemplate = "";
    setLampTemplateButtonApplied(false);
  }
  renderTemplateCenter();
}

function isStandaloneTool(tool = state.activeTool) {
  return tool === "style" || tool === "templates" || tool === "admin";
}

function syncWorkspaceShell() {
  const standalone = isStandaloneTool();
  const adminPage = state.activeTool === "admin" && state.user?.role === "admin";
  if (els.heroTitle) els.heroTitle.hidden = standalone;
  if (els.stepper) els.stepper.hidden = standalone;
  if (els.workspaceTabs) {
    els.workspaceTabs.hidden = true;
  }
  if (els.adminPanel) {
    els.adminPanel.hidden = !adminPage;
  }
  if (els.plannerLayout) {
    const adminWorkspaceHidden = state.user?.role === "admin" && state.adminView !== "workspace";
    els.plannerLayout.hidden = standalone || adminWorkspaceHidden;
  }
}

function renderWorkspaceView(tool = state.activeTool) {
  const key = normalizeToolKey(tool);
  if (tool === state.activeTool) {
    restoreWorkspaceWorkflow(tool);
    if (key === "templates") {
      renderTemplateCenter();
    } else if (key === "style") {
      renderStyleClonePage();
    } else {
      const restoredPlan = getWorkspacePlan(tool);
      if (restoredPlan) renderPlan(restoredPlan);
      else renderEmptyPlan();
      refreshCost();
    }
    renderWorkspaceStatus(tool);
    renderGenerationHistory();
  }
}

function setActiveTool(tool = "product") {
  const requested = ["product", "style", "templates", "admin"].includes(tool) ? tool : "product";
  const next = requested === "admin" && state.user?.role !== "admin" ? "product" : requested;
  const previous = state.activeTool;
  persistWorkspacePlan(previous);
  state.activeTool = next;
  state.adminView = next === "admin" ? "admin" : "workspace";
  state.saveDirectory = workspaceSaveDirectory(workspaceSaveKey(next));
  syncSaveDirectoryInputs();
  activateWorkspaceFiles(next);
  restoreWorkspacePlan(next);
  restoreWorkspaceWorkflow(next);
  const appNav = els.appNav || document.querySelector(".app-nav");
  appNav?.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === next);
  });
  const stylePage = next === "style";
  const opensPanel = next === "templates";
  const adminPage = next === "admin";
  if (els.toolPanel) els.toolPanel.hidden = !opensPanel;
  if (els.toolPanel) els.toolPanel.classList.toggle("is-template-page", opensPanel);
  if (els.styleCloneWorkspace) els.styleCloneWorkspace.hidden = !stylePage;
  if (els.templateCenterPanel) els.templateCenterPanel.hidden = next !== "templates";
  syncWorkspaceShell();
  try {
    renderPreviews();
    if (adminPage) {
      els.statusText?.classList.remove("is-error-text");
      void refreshAdminWorkspace("管理页已打开");
    } else if (next === "style") {
      setSimilarMode(state.similarMode || "none", { silent: true });
      renderStyleClonePage();
      els.statusText.textContent = state.plan?.shots?.some((shot) => shot.imageUrl)
        ? "已恢复风格复刻工作区的生成结果。"
        : "风格复刻已进入换主体页面：未选择相似类型时只按参考图直接换主体。";
    } else if (next === "templates") {
      if (!state.templateGroup) state.templateGroup = "collage";
      renderTemplateCenter();
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = "拼图中心已打开：上传多张产品图后可直接生成产品集合拼图。";
    } else if (next === "product") {
      refreshCost();
      if (!workspaceRuntime(next).statusText && state.plan?.shots?.some((shot) => shot.imageUrl)) {
        els.statusText.classList.remove("is-error-text");
        els.statusText.textContent = "已恢复灯具商品图工作区的生成结果。";
      }
    }
    renderWorkspaceView(next);
  } catch (error) {
    console.error("[setActiveTool] render failed", error);
    setWorkspaceStatus(`页面切换失败：${error?.message || error}`, { tool: next, isError: true });
  }
}

function renderTemplateCenter() {
  renderCollageCenter();
}

function defaultCollageProductName(file, index) {
  return "";
}

function normalizeCollageProductNames() {
  const files = workspaceFiles("templates");
  state.collageProductNames = files.map((_, index) => {
    const value = String(state.collageProductNames[index] || "").trim();
    return /^产品图\s*\d+$/i.test(value) ? "" : value;
  });
}

function collageProductLabels() {
  normalizeCollageProductNames();
  const files = workspaceFiles("templates");
  return files.map((file, index) => {
    const name = String(state.collageProductNames[index] || "").trim();
    return { index: index + 1, name };
  });
}

function collageVisibleProductLabels() {
  return collageProductLabels().filter((item) => item.name);
}

function collageResultVersionLabel() {
  return collageVisibleProductLabels().length ? "文字版拼图" : "无字版拼图";
}

function reorderCollageFiles(fromIndex, toIndex) {
  const files = workspaceFiles("templates");
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= files.length || toIndex >= files.length) return;
  const [file] = files.splice(fromIndex, 1);
  files.splice(toIndex, 0, file);
  const names = state.collageProductNames.slice(0, files.length + 1);
  const [name = ""] = names.splice(fromIndex, 1);
  names.splice(toIndex, 0, name);
  setWorkspaceFiles(files, "templates");
  state.collageProductNames = names.slice(0, files.length);
  clearWorkspacePlan("templates");
  state.collageShot = null;
  renderCollageCenter();
  renderPreviews();
  if (els.collageStatus) els.collageStatus.textContent = "产品顺序已调整，生成时会按当前顺序排版。";
}

function selectedCollageRatio() {
  return els.collageRatioSelect?.value || "1:1 方图";
}

function selectedStyleRatio() {
  return els.styleRatioSelect?.value || "3:4 竖版";
}

function selectedRatioValue(tool = state.activeTool) {
  if (tool === "style") return selectedStyleRatio();
  if (tool === "templates") return selectedCollageRatio();
  return els.ratioSelect?.value || "3:4 竖版";
}

function styleWorkspacePrompt() {
  return els.styleRequirementInput?.value.trim() || "";
}

function collageWorkspacePrompt() {
  return els.collageRequirementInput?.value.trim() || "";
}

function activeGenerationRequirement(tool = state.activeTool) {
  const key = normalizeToolKey(tool);
  if (key === "style") return styleWorkspacePrompt();
  if (key === "templates") return collageWorkspacePrompt();
  return els.requirementInput?.value.trim() || "";
}

function renderCollageCenter() {
  if (!els.collagePreviewList) return;
  const files = workspaceFiles("templates");
  normalizeCollageProductNames();
  if (els.collageCounter) els.collageCounter.textContent = `${files.length}/6`;
  if (els.collageSavePathInput) els.collageSavePathInput.value = workspaceSaveDirectory("templates");

  els.collagePreviewList.innerHTML = files.length
    ? files
        .map(
          (file, index) => `
            <div class="collage-thumb" draggable="true" data-collage-index="${index}">
              <img src="${escapeHtml(URL.createObjectURL(file))}" alt="${escapeHtml(file.name || `产品图 ${index + 1}`)}" />
              <span>${index + 1}</span>
              <button type="button" data-collage-remove="${index}" aria-label="删除产品图">×</button>
              <label>
                <small>名称标签（选填）</small>
                <input data-collage-name="${index}" value="${escapeHtml(state.collageProductNames[index] || "")}" placeholder="不填则不出文字" />
              </label>
            </div>
          `
        )
        .join("")
    : `<div class="collage-empty">还没有产品图</div>`;

  const shot = state.collageShot;
  const hasImage = Boolean(shot?.imageUrl);
  const hasFailed = shot?.status === "failed";
  const needsReview = false;
  const versionLabel = collageResultVersionLabel();
  if (els.collageResultStatus) {
    els.collageResultStatus.textContent = state.collageGenerating ? "生成中" : hasFailed ? "生成失败" : hasImage ? versionLabel : "待生成";
    els.collageResultStatus.classList.toggle("is-done", hasImage && !hasFailed && !needsReview);
    els.collageResultStatus.classList.toggle("is-loading", state.collageGenerating);
    els.collageResultStatus.classList.toggle("is-failed", hasFailed);
    els.collageResultStatus.classList.toggle("is-warning", needsReview);
  }
  if (els.collageResultPreview) {
    els.collageResultPreview.disabled = !hasImage;
    els.collageResultPreview.innerHTML = hasImage
      ? `<img src="${escapeHtml(shot.imageUrl)}" alt="产品集合拼图生成结果" />`
      : hasFailed
        ? `<span class="collage-result-error">${escapeHtml(shot.error || "生成失败，请重试或切换模型。")}</span>`
        : `<span>${state.collageGenerating ? "正在生成拼图..." : "生成后在这里预览拼图"}</span>`;
    els.collageResultPreview.classList.toggle("has-image", hasImage);
    els.collageResultPreview.classList.toggle("is-loading", state.collageGenerating);
    els.collageResultPreview.classList.toggle("is-failed", hasFailed && !hasImage);
  }
  if (els.saveCollageButton) {
    els.saveCollageButton.disabled = !hasImage || state.collageGenerating;
  }
  if (els.generateCollageButton) {
    els.generateCollageButton.disabled = state.collageGenerating;
    els.generateCollageButton.textContent = state.collageGenerating ? "生成中..." : hasFailed || hasImage ? "重新识别并生成" : "识别并生成";
    els.generateCollageButton.classList.toggle("is-loading", state.collageGenerating);
  }
  if (els.collageCostText) {
    els.collageCostText.textContent = singleImageCreditHintText();
  }
  if (els.collageStatus && shot?.savedPath) {
    els.collageStatus.textContent = `已保存：${shot.savedPath}`;
  }
}

function requireCollageGeneratedShot(payload) {
  const shot = payload?.shot && typeof payload.shot === "object" ? payload.shot : null;
  const imageUrl = String(shot?.imageUrl || "").trim();
  if (!shot || !imageUrl) {
    throw new Error(payload?.error || "生成接口已返回，但没有拿到图片结果。请重试；如果连续出现，请在后台检查当前模型是否支持图片输出。");
  }
  return { ...shot, imageUrl };
}

function collagePrompt() {
  return collageWorkspacePrompt();
}

function collageSettings() {
  const labels = collageProductLabels();
  const files = workspaceFiles("templates");
  return {
    model: selectedImageModelValue("templates"),
    ratio: selectedCollageRatio(),
    clarity: selectedClarityValue("templates"),
    language: "无文字，纯视觉",
    speed: "turbo",
    imageScope: "detail",
    styleCloneMode: false,
    collageMode: true,
    lampCategory: "auto",
    lampCategoryLabel: "",
    lampCategoryHint: "",
    template: "lamp-collage-room-labels",
    templateName: "产品集合拼图",
    templateTag: "拼图",
    similarMode: "none",
    similarIntent: "",
    collageLabels: labels,
    collageUserPrompt: collageWorkspacePrompt(),
    collageSourceCount: files.length,
    collagePipeline: "single-call-retouch-compose",
    collageAllowSingleCall: true,
    collageLabelRendering: collageVisibleProductLabels().length ? "model" : "svg",
    collageLabelPositioning: collageVisibleProductLabels().length ? "vision" : "fixed",
    workspaceStrategyVersion: 1,
    mode: "api"
  };
}

async function generateCollage() {
  const tool = "templates";
  const runtime = workspaceRuntime(tool);
  if (runtime.generating) return;
  activateWorkspaceFiles("templates");
  const files = workspaceFiles("templates");
  if (files.length < 2) {
    els.collageStatus.textContent = "请至少上传 2 张产品图再生成拼图。";
    setWorkspaceStatus("拼图中心需要至少 2 张产品图", { tool, isError: true });
    return;
  }
  const estimate = estimateSingleImageCredits("templates");
  if (state.user?.role !== "admin" && Number(state.user?.balance || 0) < estimate.credits) {
    els.collageStatus.textContent = USER_BALANCE_ERROR_MESSAGE;
    setWorkspaceStatus(USER_BALANCE_ERROR_MESSAGE, {
      tool,
      isError: true
    });
    return;
  }
  runtime.generating = true;
  state.collageShot = null;
  setWorkspaceStatus("正在识别多张产品并直接生成拼图...", { tool });
  els.collageStatus.textContent = "识别模型正在整理最终提示词，生图模型会一次性生成整张拼图...";
  renderCollageCenter();

  const prompt = collagePrompt();
  const ratio = selectedCollageRatio();
  const form = new FormData();
  files.forEach((file) => form.append("photos", file));
  form.append("settings", JSON.stringify(collageSettings()));
  form.append(
    "shot",
    JSON.stringify({
      id: "lamp-collage-room-labels",
      category: "selling",
      title: "产品集合拼图",
      description: "多张灯具产品图生成暖灰底产品集合拼图。",
      ratio,
      referenceIndex: 0,
      variationIndex: Date.now()
    })
  );
  form.append("prompt", prompt);

  let progressTimer = 0;
  const setProgress = () => {
    if (!runtime.generating) return;
    const seconds = Math.max(1, Math.round((Date.now() - Number(state.collageStartedAt || Date.now())) / 1000));
    const message =
      seconds < 25
        ? "正在抠出产品主体并规划拼图布局..."
        : seconds < 70
          ? "正在生成统一暖灰底拼图..."
          : "生成时间稍长，正在等待图片结果返回";
    els.collageStatus.textContent = `${message}（${seconds}s）`;
    setWorkspaceStatus(`${message}（${seconds}s）`, { tool });
  };
  state.collageStartedAt = Date.now();
  progressTimer = window.setInterval(setProgress, 12000);

  try {
    const payload = await api("/api/jobs/product-suite/shot", {
      method: "POST",
      body: form
    });
    const generatedShot = requireCollageGeneratedShot(payload);
    state.user = payload.user || state.user;
    state.collageShot = {
      ...generatedShot,
      title: "产品集合拼图",
      category: "collage",
      prompt,
      status: "done"
    };
    rememberGeneratedShot(state.collageShot, "拼图中心", 0, "templates");
    renderAccount();
    const versionLabel = collageResultVersionLabel();
    setWorkspaceStatus(`${versionLabel}已生成，可预览或保存文件。`, { tool });
    els.collageStatus.textContent = `${versionLabel}已生成，可点击预览查看大图。`;
  } catch (error) {
    const message = error?.message || "拼图生成失败，请重试或切换模型。";
    state.collageShot = {
      title: "产品集合拼图",
      category: "collage",
      prompt,
      status: "failed",
      error: message,
      failedAt: new Date().toISOString()
    };
    setWorkspaceStatus(message, { tool, isError: true });
    els.collageStatus.textContent = message;
  } finally {
    if (progressTimer) window.clearInterval(progressTimer);
    state.collageStartedAt = 0;
    runtime.generating = false;
    renderCollageCenter();
    refreshCost();
  }
}

async function saveCollageImage(button = els.saveCollageButton) {
  const shot = state.collageShot;
  if (!shot?.imageUrl) return;
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "保存中...";
  }
  try {
    const payload = await saveSingleImageWithPicker({
      workspaceKey: "templates",
      button,
      imageUrl: shot.imageUrl,
      title: "产品集合拼图",
      category: "collage"
    });
    if (!payload) {
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = "已取消保存。";
      return;
    }
    state.collageShot = { ...shot, savedPath: payload.filePath };
    updateHistorySavedPath(shot.imageUrl, payload.filePath);
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = `已保存：${payload.filePath}`;
  } catch (error) {
    els.statusText.textContent = error.message;
    els.statusText.classList.add("is-error-text");
    els.collageStatus.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    renderCollageCenter();
  }
}

function updateQuantityOptions() {
  const current = els.quantitySelect.value;
  const options =
    state.imageScope === "main"
      ? Array.from({ length: 6 }, (_, index) => {
          const value = String(index + 1);
          return [value, `${value} 张`];
        })
      : Array.from({ length: 15 }, (_, index) => {
          const value = String(index + 1);
          return [value, `${value} 张`];
        });
  els.quantitySelect.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  els.quantitySelect.value = options.some(([value]) => value === current) ? current : options[0][0];
}

function hasManualRequirement() {
  return Boolean(els.requirementInput?.value.trim()) && !state.requirementAutoFilled;
}

function currentDefaultRequirement() {
  return state.imageScope === "main" ? DEFAULT_MAIN_REQUIREMENT : DEFAULT_DETAIL_REQUIREMENT;
}

function resetPlanForInputChange(message = "") {
  workspaceRuntime().analysisRevision = Number(workspaceRuntime().analysisRevision || 0) + 1;
  clearWorkspacePlan(state.activeTool);
  renderPromptAssist(null);
  renderEmptyPlan();
  setWorkflow({ active: state.files.length ? 1 : null });
  refreshCost();
  if (message) {
    setWorkspaceStatus(message);
  }
}

function canSyncExistingPlan() {
  return Boolean(state.files.length && state.plan?.shots?.length && !state.busy);
}

function syncPlanAfterUserChange(message = "已修改，请点击分析产品重新生成图片规划。") {
  window.clearTimeout(state.requirementSyncTimer);
  const nextMessage = state.files.length
    ? state.activeTool === "style"
      ? "已修改，请点击识别并生成。"
      : "已修改，请点击分析产品重新生成图片规划。"
    : message;
  resetPlanForInputChange(nextMessage);
}

function setImageScope(scope, { silent = false } = {}) {
  const next = scope === "main" ? "main" : "detail";
  if (state.imageScope === next) return;
  const shouldClearAutoRequirement = state.requirementAutoFilled;
  state.imageScope = next;
  setSimilarMode("none", { silent: true });
  setLampTemplateButtonApplied(false);
  document.querySelectorAll("[data-image-scope]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.imageScope === state.imageScope);
  });
  updateQuantityOptions();
  els.requirementLabelText.textContent = state.imageScope === "main" ? "主图要求" : "详情图要求";
  els.requirementInput.placeholder =
    state.imageScope === "main"
      ? "可留空：AI 会根据产品图生成电商主图提示词；也可输入白底、轻场景、风格和卖点。"
      : "可留空：AI 会根据产品图生成详情图组提示词；也可输入卖点、功能图、场景、风格和特殊要求。";
  if (shouldClearAutoRequirement) {
    els.requirementInput.value = "";
  }
  state.requirementAutoFilled = false;
  if (!silent) {
    syncPlanAfterUserChange(`已切换为${imageScopeLabel()}，请点击分析产品重新生成图片规划。`);
  }
}

function applyCreationTemplate(templateId = state.activeTemplate) {
  const template = creationTemplateMeta(templateId);
  if (!template) {
    setActiveTool("templates");
    els.statusText.textContent = "请先在拼图中心选择一个具体模板，再点击使用。";
    return;
  }
  state.activeTemplate = template.id;
  state.templateGroup = template.group || "suite";
  renderTemplateCenter();
  if (state.imageScope !== template.scope) setImageScope(template.scope, { silent: true });
  setSimilarMode(template.similarMode || "none", { silent: true });
  setLampTemplateButtonApplied(true);
  if (els.templateSelect) els.templateSelect.value = template.id;
  els.requirementInput.value = template.prompt;
  state.requirementAutoFilled = false;
  if (template.quantity) els.quantitySelect.value = template.quantity;
  if (template.ratio) els.ratioSelect.value = template.ratio;
  if (template.clarity) els.claritySelect.value = template.clarity;
  clearWorkspacePlan("product");
  refreshCost();
  if (state.files.length) {
    syncPlanAfterUserChange(`${template.name}已使用，请点击分析产品重新生成可编辑大纲。`);
    return;
  }
  if (template.id === "lamp-detail-suite") {
    state.plan = buildLampTemplatePreviewPlan();
    renderPlan(state.plan);
    setWorkflow({ active: 1 });
  } else {
    renderEmptyPlan();
  }
  els.statusText.textContent = `${template.name}已选中：上传产品图后点击分析，会按该模板生成可编辑提示词。`;
}

function handleAnalyzeClick() {
  if (!state.files.length) {
    els.statusText.textContent = "请先上传产品图。";
    els.statusText.classList.add("is-error-text");
    return;
  }
  queueAnalyzeUploadedProduct({ autofillRequirement: !hasManualRequirement() });
}

function handlePrimaryAction() {
  if (state.plan?.shots?.length && !state.busy) {
    void handleGenerate();
    return;
  }
  handleAnalyzeClick();
}

function setSimilarMode(mode, { silent = false } = {}) {
  state.similarMode = mode || "none";
  document.querySelectorAll("[data-similar-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.similarMode === state.similarMode);
  });
  renderStyleModeHint();
  if (!silent) refreshCost();
}

function styleModeMeta(mode = state.similarMode) {
  const map = {
    scene: {
      label: "相似场景图",
      intent: "参考图只用于反推空间类型、镜头角度、软装气质和开灯氛围，把上传灯具放入同类新场景/新背景。"
    },
    selling: {
      label: "相似卖点/功能图",
      intent: "参考图只用于反推信息层级、产品摆放、留白节奏和功能表达，重新生成一张同类卖点图。"
    },
    detail: {
      label: "相似细节图",
      intent: "参考图只用于反推微距角度、局部构图、材质光泽和景深关系，重新生成一张同类细节图。"
    },
    real: {
      label: "相似实拍图",
      intent: "参考图只用于反推真实拍摄感、透视、自然光影和到货质感，重新生成一张同类实拍图。"
    }
  };
  return map[mode] || {
    label: "按参考图换主体",
    intent: "不预设图片类型，直接逐张参考上传图片的构图、镜头、光影、版式和空间关系，把参考图里的原商品替换为当前灯具主体。"
  };
}

function styleModeHintText(mode = state.similarMode) {
  const map = {
    scene: "主体来自产品图，参考图只做新场景/换背景方向；可补充背景简洁度、光线冷暖、画面留白和安装关系。",
    selling: "参考图只做信息层级和卖点方向；可补充要突出的功能、文字多少、箭头标注和产品清晰度。",
    detail: "参考图只做局部角度和材质方向；可补充要放大的部位、质感、镜头远近和背景虚化程度。",
    real: "参考图只做真实拍摄感和自然光影方向；可补充拍摄角度、背景真实度、阴影强弱和产品是否保留自然瑕疵。"
  };
  return map[mode] || "直接保留参考图构图、镜头、光影和背景；可补充主体大小、位置、安装方式和保留程度。";
}

function styleRequirementPlaceholder(mode = state.similarMode) {
  const map = {
    none: "例如：主体稍微缩小，保持参考图构图和光影，不新增产品图里没有的结构。",
    scene: "例如：换成参考图同类客厅背景，镜头角度相似，画面更干净明亮，突出灯具照明范围和安装关系。",
    selling: "例如：突出产品真实卖点和使用价值，文字少一点，保留参考图留白，让产品更清晰。",
    detail: "例如：聚焦发光面、灯杯和金属质感，镜头更近，背景更柔和，不改变灯体结构。",
    real: "例如：更像真实拍摄，保留自然透视和轻微阴影，产品不要变形，不做海报排版。"
  };
  return map[mode] || map.none;
}
function renderStyleModeHint() {
  if (els.styleModeHint) els.styleModeHint.textContent = styleModeHintText();
  if (els.styleRequirementInput) els.styleRequirementInput.placeholder = styleRequirementPlaceholder();
}

function buildStyleCloneRequirement() {
  const referenceCount = state.templateReferenceFiles.length;
  const outputCount = referenceDrivenCount();
  const mode = styleModeMeta();
  const similarSpecs = {
    scene: {
      task: "主体 + 相似场景/换背景任务。",
      subject: "识别上传灯具的类型、安装结构和比例。",
      reference: "参考图只用于判断空间类型、镜头、色调和氛围方向。",
      output: "每张参考图生成一张同类新场景。"
    },
    selling: {
      task: "相似卖点/功能图任务。",
      subject: "识别上传灯具的真实结构、功能、材质和光效。",
      reference: "参考图只用于信息层级、留白和产品呈现方式。",
      output: "中文卖点按当前灯具改写。"
    },
    detail: {
      task: "相似细节图任务。",
      subject: "识别上传灯具的材质、发光面、连接件和安装细节。",
      reference: "参考图只用于局部角度、微距构图和景深方向。",
      output: "细节说明按当前灯具改写。"
    },
    real: {
      task: "相似实拍图任务。",
      subject: "识别上传灯具的真实结构、材质、颜色和安装方式。",
      reference: "参考图只用于真实拍摄感、自然光、透视和背景质感。",
      output: "生成真实拍摄感图片，不做海报排版。"
    }
  };
  const similarSpec = similarSpecs[state.similarMode];
  if (similarSpec) {
    return [
      similarSpec.task,
      `生成方式：${mode.label}。`,
      `参考图数量：${referenceCount || 0} 张；本次按参考图数量规划 ${outputCount} 张输出。`,
      `画面目标：${mode.intent}`,
      similarSpec.subject,
      similarSpec.reference,
      similarSpec.output,
      "固定产品一致性和禁区由后端隐藏规则控制。"
    ].join("\n");
  }
  return [
    "换主体风格复刻任务。",
    `复刻方式：${mode.label}。`,
    `参考图数量：${referenceCount || 0} 张；本次按参考图数量规划 ${outputCount} 张输出。`,
    `画面目标：${mode.intent}`,
    "识别上传灯具的类型、材质、安装结构、发光面和比例后再替换。",
    state.similarMode === "none"
      ? "参考图规则：按参考图直接图生图换主体，只替换参考图中的原商品主体，不改变场景、镜头、光影、版式和空间关系。"
      : "参考图规则：参考图不是固定底图，只用于反推画面类型、镜头、色调、氛围和节奏，再创建同类新图。",
    "固定产品一致性和禁区由后端隐藏规则控制。"
  ].join("\n");
}
function styleCloneAnalysisPrompt(manualPrompt = "") {
  return [buildStyleCloneRequirement(), manualPrompt ? `用户补充提示词：${manualPrompt}` : ""].filter(Boolean).join("\n\n");
}

function renderStyleSubjectPreview() {
  if (!els.styleSubjectPreview) return;
  const files = workspaceFiles("style");
  els.styleSubjectPreview.innerHTML = "";
  files.forEach((file, index) => {
    const thumb = document.createElement("div");
    thumb.className = "style-mini-thumb";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "style-thumb-view";
    view.setAttribute("aria-label", `查看产品图 ${index + 1}`);
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    view.append(img);
    view.addEventListener("click", () => {
      openImageLightbox({ title: `产品图 ${index + 1}`, imageUrl: URL.createObjectURL(file) });
    });
    const badge = document.createElement("small");
    badge.textContent = String(index + 1);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thumb-delete";
    remove.setAttribute("aria-label", "删除产品图");
    remove.textContent = "×";
    remove.addEventListener("dblclick", (event) => event.stopPropagation());
    remove.addEventListener("click", () => {
      files.splice(index, 1);
      if (state.activeTool === "style") activateWorkspaceFiles("style");
      handleStyleSubjectChanged(files.length ? "产品图已删除，请重新识别并生成。" : "产品图已清空，请上传新的灯具产品图。");
      renderPreviews();
      renderStyleClonePage();
    });
    thumb.append(view, badge, remove);
    els.styleSubjectPreview.append(thumb);
  });
  if (!files.length) {
    els.styleSubjectPreview.innerHTML = `<span class="style-empty-note">还没有主体产品图</span>`;
  }
}

function renderStyleClonePage() {
  renderStyleSubjectPreview();
  renderStyleModeHint();
  syncStyleModelSelect();
  const referenceCount = state.templateReferenceFiles.length;
  const outputCount = referenceCount ? referenceDrivenCount() : 0;
  const mode = styleModeMeta();
  const shots = state.plan?.shots || [];
  const generatedCount = shots.filter((shot) => shot.imageUrl).length || 0;
  const failedCount = shots.filter((shot) => shot.status === "failed").length || 0;
  const visibleTotal = outputCount || shots.length || referenceCount;
  const styleCard = els.styleAnalyzeButton?.closest(".style-analysis-card");
  styleCard?.classList.toggle("is-generating", Boolean(state.busy || state.generating));
  if (els.styleCloneStatus) {
    els.styleCloneStatus.textContent = state.generating
      ? `正在生成风格复刻 ${generatedCount}/${visibleTotal} 张`
      : state.busy
        ? "正在识别参考图..."
        : state.files.length && referenceCount && failedCount
          ? `已生成 ${generatedCount}/${visibleTotal} 张，${failedCount} 张失败，可重新生成失败项。`
          : state.files.length && referenceCount && generatedCount
            ? `已生成 ${generatedCount}/${visibleTotal} 张。`
            : state.files.length && referenceCount
              ? state.similarMode === "none"
                ? `已准备 ${referenceCount} 张参考图，点击后直接换主体。`
                : `已准备 ${referenceCount} 张参考图，将生成${mode.label}。`
              : "请上传产品图和参考图。";
  }
  if (els.styleAnalyzeButton) {
    els.styleAnalyzeButton.disabled = !state.files.length || !referenceCount || state.busy || state.generating;
    els.styleAnalyzeButton.classList.toggle("is-loading", Boolean(state.busy || state.generating));
    els.styleAnalyzeButton.textContent = state.generating
      ? `生成中 ${generatedCount}/${visibleTotal || referenceCount}`
      : state.busy
        ? "识别中..."
        : state.plan?.shots?.length
          ? "重新识别并生成"
          : "识别并生成";
  }
  if (els.styleCostText) {
    const credits = estimateCredits("style").credits;
    els.styleCostText.textContent = creditHintText(credits);
  }
  renderStyleCloneResults(state.plan);
}
function styleRevisionCopy(mode = state.similarMode) {
  const map = {
    none: {
      label: "换主体微调（可选）",
      placeholder: "例如：主体缩小 15%，安装在原灯具位置，保持原场景和原光影，不新增灯光。"
    },
    scene: {
      label: "场景方向补充（可选）",
      placeholder: "例如：画面更通透，保留参考图镜头高度，灯具安装关系更清楚，背景更干净。"
    },
    selling: {
      label: "卖点表达补充（可选）",
      placeholder: "例如：突出当前产品真实卖点，保留参考图留白，不要复杂文字，只让灯具更清晰。"
    },
    detail: {
      label: "细节特写补充（可选）",
      placeholder: "例如：聚焦发光面、灯杯和金属拉丝材质，镜头更近，背景虚化，保留灯体真实结构。"
    },
    real: {
      label: "实拍质感补充（可选）",
      placeholder: "例如：手机自然光实拍感，保留参考图透视，产品不要变形，不做海报排版。"
    }
  };
  return map[mode] || map.none;
}
function styleResultTextEditable(mode = state.similarMode) {
  return mode === "selling" || mode === "detail";
}

function styleResultCategoryForMode(mode = state.similarMode) {
  const map = { selling: "selling", detail: "detail", scene: "scene", real: "real" };
  return map[mode] || "";
}

function styleTextEditPlaceholder(mode = state.similarMode) {
  return mode === "detail"
    ? "例如：把标题改成「蜂窝防眩深杯」，标签改成「低眩光」「高显色」，删除多余英文。"
    : "例如：主标题改成「柔光不刺眼」，副标题改成「高显色还原家居质感」，按钮文字不要。";
}

async function imageUrlToFile(imageUrl, filename = "generated-result.png") {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("无法读取当前生成结果。");
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

async function imageRegionToFile(imageUrl, region, filename = "selected-text-region.png") {
  const image = await loadEditableImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const rect = textEditRectFromRegion(region, canvas.width, canvas.height);
  if (!rect) throw new Error("请重新框选要修改的文字区域。");
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = rect.w;
  cropCanvas.height = rect.h;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx || !cropCanvas.width || !cropCanvas.height) throw new Error("无法读取框选文字区域。");
  cropCtx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const blob = await new Promise((resolve, reject) => {
    cropCanvas.toBlob((value) => (value ? resolve(value) : reject(new Error("无法生成框选文字区域截图。"))), "image/png");
  });
  return new File([blob], filename, { type: "image/png" });
}

function extractTextReplacementInstruction(prompt = "") {
  const value = String(prompt || "").trim();
  if (!value) return "";
  if (/^(删除|去掉|移除|不要|清除)\b/.test(value)) return "";
  const quoted = value.match(/[“”"「」『』]([^“”"「」『』]+)[“”"「」『』]/);
  if (quoted?.[1]) return quoted[1].trim();
  const keyword = value.match(/(?:改成|改为|换成|替换成|变成|文字为|内容为)\s*[:：]?\s*(.+)$/);
  return (keyword?.[1] || value).trim();
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function colorDistance(a, b) {
  if (!a || !b) return 0;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function rgbaCss(color, alpha = 1) {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
}

function averageColor(samples, fallback = { r: 245, g: 245, b: 245 }) {
  if (!samples.length) return fallback;
  const total = samples.reduce(
    (sum, color) => ({
      r: sum.r + color.r,
      g: sum.g + color.g,
      b: sum.b + color.b
    }),
    { r: 0, g: 0, b: 0 }
  );
  return { r: total.r / samples.length, g: total.g / samples.length, b: total.b / samples.length };
}

function pixelAt(imageData, x, y) {
  const safeX = clampNumber(Math.round(x), 0, imageData.width - 1);
  const safeY = clampNumber(Math.round(y), 0, imageData.height - 1);
  const index = (safeY * imageData.width + safeX) * 4;
  return {
    r: imageData.data[index],
    g: imageData.data[index + 1],
    b: imageData.data[index + 2],
    a: imageData.data[index + 3]
  };
}

function dominantColor(samples, fallback = { r: 245, g: 245, b: 245 }) {
  if (!samples.length) return fallback;
  const buckets = new Map();
  for (const color of samples) {
    if (!color || color.a < 10) continue;
    const key = `${Math.round(color.r / 16)},${Math.round(color.g / 16)},${Math.round(color.b / 16)}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += color.r;
    bucket.g += color.g;
    bucket.b += color.b;
    buckets.set(key, bucket);
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best
    ? { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count }
    : averageColor(samples, fallback);
}

function loadEditableImage(imageUrl) {
  return new Promise(async (resolve, reject) => {
    const image = new Image();
    let objectUrl = "";
    image.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取当前图片，已切换为智能改字重试。"));
    };
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("fetch failed");
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      image.src = objectUrl;
    } catch (_error) {
      image.crossOrigin = "anonymous";
      image.src = imageUrl;
    }
  });
}

function textEditRectFromRegion(region, width, height) {
  const target = normalizedLightboxTextRegion(region);
  if (!target) return null;
  const x = Math.round((target.xPercent / 100) * width);
  const y = Math.round((target.yPercent / 100) * height);
  const w = Math.round((target.widthPercent / 100) * width);
  const h = Math.round((target.heightPercent / 100) * height);
  if (w < 4 || h < 4) return null;
  return { x, y, w, h };
}

function textEditRegionFromRect(rect, width, height) {
  if (!rect || !width || !height) return null;
  return normalizedLightboxTextRegion({
    xPercent: (rect.x / width) * 100,
    yPercent: (rect.y / height) * 100,
    widthPercent: (rect.w / width) * 100,
    heightPercent: (rect.h / height) * 100,
    centerXPercent: ((rect.x + rect.w / 2) / width) * 100,
    centerYPercent: ((rect.y + rect.h / 2) / height) * 100
  });
}

function expandRect(rect, pad, width, height) {
  const x = clampNumber(rect.x - pad, 0, width - 1);
  const y = clampNumber(rect.y - pad, 0, height - 1);
  return {
    x,
    y,
    w: Math.max(1, Math.min(width - x, rect.w + pad * 2)),
    h: Math.max(1, Math.min(height - y, rect.h + pad * 2))
  };
}

function regionsOverlapAmount(a, b) {
  const first = normalizedLightboxTextRegion(a);
  const second = normalizedLightboxTextRegion(b);
  if (!first || !second) return 0;
  const left = Math.max(first.xPercent, second.xPercent);
  const top = Math.max(first.yPercent, second.yPercent);
  const right = Math.min(first.xPercent + first.widthPercent, second.xPercent + second.widthPercent);
  const bottom = Math.min(first.yPercent + first.heightPercent, second.yPercent + second.heightPercent);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const smaller = Math.min(first.widthPercent * first.heightPercent, second.widthPercent * second.heightPercent);
  return overlap / Math.max(1, smaller);
}

function sampleTextEditBackground(imageData, rect) {
  const width = imageData.width;
  const height = imageData.height;
  const margin = Math.max(4, Math.round(Math.min(rect.w, rect.h) * 0.18));
  const samples = [];
  const step = Math.max(1, Math.round(Math.min(rect.w, rect.h) / 30));
  for (let x = rect.x; x <= rect.x + rect.w; x += step) {
    for (let offset = 1; offset <= margin; offset += Math.max(1, Math.round(margin / 5))) {
      if (rect.y - offset >= 0) samples.push(pixelAt(imageData, x, rect.y - offset));
      if (rect.y + rect.h + offset < height) samples.push(pixelAt(imageData, x, rect.y + rect.h + offset));
    }
  }
  for (let y = rect.y; y <= rect.y + rect.h; y += step) {
    for (let offset = 1; offset <= margin; offset += Math.max(1, Math.round(margin / 5))) {
      if (rect.x - offset >= 0) samples.push(pixelAt(imageData, rect.x - offset, y));
      if (rect.x + rect.w + offset < width) samples.push(pixelAt(imageData, rect.x + rect.w + offset, y));
    }
  }
  const dominant = dominantColor(samples);
  const stableSamples = samples.filter((color) => colorDistance(color, dominant) < 58);
  const stable = stableSamples.length > Math.max(8, samples.length * 0.35) ? averageColor(stableSamples, dominant) : dominant;
  const variance =
    samples.reduce((sum, color) => sum + colorDistance(color, stable), 0) / Math.max(1, samples.length);
  return { color: stable, complexity: variance };
}

function inferTextEditInkColor(imageData, rect, background) {
  const samples = [];
  const step = Math.max(1, Math.round(Math.min(rect.w, rect.h) / 45));
  for (let y = rect.y; y < rect.y + rect.h; y += step) {
    for (let x = rect.x; x < rect.x + rect.w; x += step) {
      const color = pixelAt(imageData, x, y);
      if (color.a > 10 && colorDistance(color, background) > 55) samples.push(color);
    }
  }
  if (samples.length > 4) return dominantColor(samples);
  const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
  return luminance > 145 ? { r: 23, g: 23, b: 26 } : { r: 255, g: 255, b: 255 };
}

function inferTextPixelBounds(imageData, rect, background) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rowCounts = new Array(Math.max(1, rect.h)).fill(0);
  const threshold = 52;
  let pixelCount = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const color = pixelAt(imageData, x, y);
      if (color.a > 10 && colorDistance(color, background) > threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        rowCounts[y - rect.y] += 1;
        pixelCount += 1;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  const activeRowMinimum = Math.max(2, Math.round((maxX - minX + 1) * 0.025));
  const rows = [];
  let rowStart = -1;
  let rowEnd = -1;
  rowCounts.forEach((count, index) => {
    const y = rect.y + index;
    if (count >= activeRowMinimum) {
      if (rowStart < 0) rowStart = y;
      rowEnd = y;
    } else if (rowStart >= 0) {
      if (rowEnd - rowStart >= 2) rows.push({ y: rowStart, height: rowEnd - rowStart + 1 });
      rowStart = -1;
      rowEnd = -1;
    }
  });
  if (rowStart >= 0 && rowEnd - rowStart >= 2) rows.push({ y: rowStart, height: rowEnd - rowStart + 1 });
  const mergedRows = [];
  for (const row of rows) {
    const previous = mergedRows[mergedRows.length - 1];
    if (previous && row.y - (previous.y + previous.height) <= 3) {
      previous.height = row.y + row.height - previous.y;
    } else {
      mergedRows.push({ ...row });
    }
  }
  const usableRows = mergedRows.length ? mergedRows : [{ y: minY, height: maxY - minY + 1 }];
  const rowHeights = usableRows.map((row) => row.height).sort((a, b) => a - b);
  const medianRowHeight = rowHeights[Math.floor(rowHeights.length / 2)] || maxY - minY + 1;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    rows: usableRows,
    rowHeight: medianRowHeight,
    pixelCount
  };
}

function wrapTextForCanvas(ctx, text, maxWidth) {
  const rawLines = String(text || "").split(/\r?\n/);
  const lines = [];
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      lines.push("");
      continue;
    }
    const units = /\s/.test(line) ? line.split(/(\s+)/).filter(Boolean) : Array.from(line);
    let current = "";
    for (const unit of units) {
      const next = current ? current + unit : unit;
      if (ctx.measureText(next).width <= maxWidth || !current) {
        current = next;
      } else {
        lines.push(current.trimEnd());
        current = unit.trimStart();
      }
    }
    if (current) lines.push(current.trimEnd());
  }
  return lines;
}

function fitTextEditLayout(ctx, replacementText, rect, textBounds) {
  const inset = Math.max(2, Math.round(Math.min(rect.w, rect.h) * 0.08));
  const maxWidth = Math.max(12, rect.w - inset * 2);
  const maxHeight = Math.max(12, rect.h - inset * 2);
  const estimated = textBounds?.rowHeight
    ? Math.max(10, Math.min(rect.h * 0.72, textBounds.rowHeight / 0.78))
    : Math.max(10, Math.min(rect.h * 0.62, rect.w / Math.max(3, Array.from(replacementText).length) * 1.55));
  for (let size = Math.round(estimated); size >= 9; size -= 1) {
    ctx.font = `800 ${size}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
    const lines = wrapTextForCanvas(ctx, replacementText, maxWidth);
    const lineHeight = Math.round(size * 1.22);
    if (lines.length * lineHeight <= maxHeight && lines.every((line) => ctx.measureText(line).width <= maxWidth + 1)) {
      return { fontSize: size, lineHeight, lines, inset };
    }
  }
  const fontSize = 9;
  ctx.font = `800 ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
  return { fontSize, lineHeight: 11, lines: wrapTextForCanvas(ctx, replacementText, maxWidth), inset };
}

function fillTextEditBackground(ctx, imageData, rect, background) {
  const pad = Math.max(3, Math.round(Math.min(rect.w, rect.h) * 0.14));
  const erase = {
    x: clampNumber(rect.x - pad, 0, imageData.width - 1),
    y: clampNumber(rect.y - pad, 0, imageData.height - 1),
    w: clampNumber(rect.w + pad * 2, 1, imageData.width),
    h: clampNumber(rect.h + pad * 2, 1, imageData.height)
  };
  if (erase.x + erase.w > imageData.width) erase.w = imageData.width - erase.x;
  if (erase.y + erase.h > imageData.height) erase.h = imageData.height - erase.y;

  const patch = ctx.createImageData(erase.w, erase.h);
  for (let py = 0; py < erase.h; py += 1) {
    for (let px = 0; px < erase.w; px += 1) {
      const x = erase.x + px;
      const y = erase.y + py;
      const top = erase.y > 0 ? pixelAt(imageData, x, erase.y - 1) : background;
      const bottom = erase.y + erase.h < imageData.height ? pixelAt(imageData, x, erase.y + erase.h) : background;
      const left = erase.x > 0 ? pixelAt(imageData, erase.x - 1, y) : background;
      const right = erase.x + erase.w < imageData.width ? pixelAt(imageData, erase.x + erase.w, y) : background;
      const v = erase.h <= 1 ? 0 : py / (erase.h - 1);
      const u = erase.w <= 1 ? 0 : px / (erase.w - 1);
      const vertical = {
        r: top.r * (1 - v) + bottom.r * v,
        g: top.g * (1 - v) + bottom.g * v,
        b: top.b * (1 - v) + bottom.b * v
      };
      const horizontal = {
        r: left.r * (1 - u) + right.r * u,
        g: left.g * (1 - u) + right.g * u,
        b: left.b * (1 - u) + right.b * u
      };
      const mixed = {
        r: (vertical.r + horizontal.r + background.r) / 3,
        g: (vertical.g + horizontal.g + background.g) / 3,
        b: (vertical.b + horizontal.b + background.b) / 3
      };
      const index = (py * erase.w + px) * 4;
      patch.data[index] = Math.round(mixed.r);
      patch.data[index + 1] = Math.round(mixed.g);
      patch.data[index + 2] = Math.round(mixed.b);
      patch.data[index + 3] = 255;
    }
  }
  ctx.putImageData(patch, erase.x, erase.y);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = rgbaCss(background);
  ctx.fillRect(erase.x, erase.y, erase.w, erase.h);
  ctx.restore();
  return erase;
}

async function renderLocalStyleTextEditLegacy({ imageUrl, region, textEditPrompt }) {
  const replacementText = extractTextReplacementInstruction(textEditPrompt);
  const image = await loadEditableImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) throw new Error("无法创建快速改字画布。");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const rect = textEditRectFromRegion(region, canvas.width, canvas.height);
  if (!rect) throw new Error("请重新框选要修改的文字区域。");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const background = sampleTextEditBackground(imageData, rect);
  const ink = inferTextEditInkColor(imageData, rect, background.color);
  const textBounds = inferTextPixelBounds(imageData, rect, background.color);
  fillTextEditBackground(ctx, imageData, rect, background.color);

  if (replacementText) {
    const layout = fitTextEditLayout(ctx, replacementText, rect, textBounds);
    ctx.save();
    ctx.font = `800 ${layout.fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
    ctx.fillStyle = rgbaCss(ink);
    ctx.textBaseline = "top";
    const leftInset = textBounds
      ? clampNumber(textBounds.minX - rect.x, layout.inset, Math.max(layout.inset, rect.w - layout.inset))
      : layout.inset;
    const textCenter = textBounds ? (textBounds.minX + textBounds.maxX) / 2 : rect.x + rect.w / 2;
    const leftAligned = !textBounds || textBounds.minX - rect.x < rect.w * 0.22;
    ctx.textAlign = leftAligned ? "left" : "center";
    const x = leftAligned ? rect.x + leftInset : textCenter;
    const contentHeight = layout.lines.length * layout.lineHeight;
    const y = textBounds
      ? clampNumber(textBounds.minY, rect.y + layout.inset, rect.y + rect.h - contentHeight)
      : rect.y + Math.max(layout.inset, Math.round((rect.h - contentHeight) / 2));
    layout.lines.forEach((line, lineIndex) => {
      ctx.fillText(line, x, y + lineIndex * layout.lineHeight);
    });
    ctx.restore();
  }

  return {
    imageUrl: canvas.toDataURL("image/png"),
    method: background.complexity > 42 ? "fast-gradient" : "fast-solid",
    replacementText
  };
}

function drawStyleTextLayer(ctx, layer, canvasWidth, canvasHeight) {
  if (!layer?.text) return;
  const rect = textEditRectFromRegion(layer.region, canvasWidth, canvasHeight);
  if (!rect) return;
  const fontSize = Math.max(8, Math.round(Number(layer.fontSizePx || 18)));
  const lineHeight = Math.max(fontSize, Math.round(Number(layer.lineHeightPx || fontSize * 1.22)));
  const inset = Math.max(0, Math.round(Number(layer.insetPx || 0)));
  ctx.save();
  ctx.font = `${Number(layer.fontWeight || 800)} ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif`;
  ctx.fillStyle = layer.color || "#17171a";
  ctx.textBaseline = "top";
  ctx.textAlign = layer.align || "left";
  const maxWidth = Math.max(12, rect.w - inset * 2);
  const lines = wrapTextForCanvas(ctx, layer.text, maxWidth);
  const x = layer.align === "center" ? rect.x + rect.w / 2 : rect.x + inset;
  const y = rect.y + inset;
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, x, y + lineIndex * lineHeight);
  });
  ctx.restore();
}

async function composeStyleTextLayerImage({ cleanImageUrl, layer }) {
  const image = await loadEditableImage(cleanImageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) throw new Error("无法创建文字图层画布。");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  drawStyleTextLayer(ctx, layer, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function renderLocalStyleTextEdit({ imageUrl, cleanImageUrl = "", existingLayer = null, region, textEditPrompt }) {
  const replacementText = extractTextReplacementInstruction(textEditPrompt);
  const canReuseLayer =
    cleanImageUrl &&
    existingLayer?.region &&
    regionsOverlapAmount(region, existingLayer.region) > 0.35;
  if (canReuseLayer) {
    const layer = {
      ...existingLayer,
      text: replacementText,
      originalPrompt: textEditPrompt
    };
    return {
      imageUrl: await composeStyleTextLayerImage({ cleanImageUrl, layer }),
      cleanImageUrl,
      textLayer: layer,
      normalizedRegion: normalizedLightboxTextRegion(layer.region),
      method: "text-layer",
      replacementText
    };
  }

  const image = await loadEditableImage(imageUrl);
  const cleanCanvas = document.createElement("canvas");
  cleanCanvas.width = image.naturalWidth || image.width;
  cleanCanvas.height = image.naturalHeight || image.height;
  const cleanCtx = cleanCanvas.getContext("2d", { willReadFrequently: true });
  if (!cleanCtx || !cleanCanvas.width || !cleanCanvas.height) throw new Error("无法创建快速改字画布。");
  cleanCtx.drawImage(image, 0, 0, cleanCanvas.width, cleanCanvas.height);
  const selectedRect = textEditRectFromRegion(region, cleanCanvas.width, cleanCanvas.height);
  if (!selectedRect) throw new Error("请重新框选要修改的文字区域。");
  const imageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
  const background = sampleTextEditBackground(imageData, selectedRect);
  const ink = inferTextEditInkColor(imageData, selectedRect, background.color);
  const textBounds = inferTextPixelBounds(imageData, selectedRect, background.color);
  const shrinkPad = textBounds ? Math.max(3, Math.round(textBounds.rowHeight * 0.28)) : 0;
  const textRect = textBounds
    ? expandRect(
        {
          x: textBounds.minX,
          y: textBounds.minY,
          w: textBounds.width,
          h: textBounds.height
        },
        shrinkPad,
        cleanCanvas.width,
        cleanCanvas.height
      )
    : selectedRect;
  const normalizedRegion = textEditRegionFromRect(textRect, cleanCanvas.width, cleanCanvas.height);
  const cleanImageData = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
  fillTextEditBackground(cleanCtx, cleanImageData, textRect, background.color);
  const cleanResultUrl = cleanCanvas.toDataURL("image/png");

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = cleanCanvas.width;
  previewCanvas.height = cleanCanvas.height;
  const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
  previewCtx.drawImage(cleanCanvas, 0, 0);

  const layout = replacementText ? fitTextEditLayout(previewCtx, replacementText, textRect, textBounds) : null;
  const leftAligned = !textBounds || textBounds.minX - selectedRect.x < selectedRect.w * 0.22;
  const contentHeight = layout ? layout.lines.length * layout.lineHeight : 0;
  const yOffset = layout
    ? textBounds
      ? clampNumber(textBounds.minY - textRect.y, layout.inset, Math.max(layout.inset, textRect.h - contentHeight))
      : Math.max(layout.inset, Math.round((textRect.h - contentHeight) / 2))
    : 0;
  const leftInset = layout
    ? textBounds
      ? clampNumber(textBounds.minX - textRect.x, layout.inset, Math.max(layout.inset, textRect.w - layout.inset))
      : layout.inset
    : 0;
  const layerRect = yOffset
    ? { ...textRect, y: textRect.y + yOffset, h: Math.max(layout?.lineHeight || 12, textRect.h - yOffset) }
    : textRect;
  const layer = {
    text: replacementText,
    region: textEditRegionFromRect(layerRect, previewCanvas.width, previewCanvas.height),
    fontSizePx: layout?.fontSize || Math.max(10, Math.round(textRect.h * 0.5)),
    lineHeightPx: layout?.lineHeight || Math.max(12, Math.round(textRect.h * 0.6)),
    fontWeight: 800,
    color: rgbaCss(ink),
    align: leftAligned ? "left" : "center",
    insetPx: leftAligned ? leftInset : 0,
    originalPrompt: textEditPrompt
  };
  drawStyleTextLayer(previewCtx, layer, previewCanvas.width, previewCanvas.height);

  return {
    imageUrl: previewCanvas.toDataURL("image/png"),
    cleanImageUrl: cleanResultUrl,
    textLayer: layer,
    normalizedRegion: normalizedLightboxTextRegion(layer.region),
    method: background.complexity > 42 ? "text-layer-gradient" : "text-layer-solid",
    replacementText
  };
}

function renderStyleCloneResults(plan = state.plan) {
  if (!els.stylePreviewGrid) return;
  renderBatchTools();
  if (plan?.analyzing) {
    els.stylePreviewGrid.innerHTML = `<div class="style-result-empty">正在准备产品图和参考图...</div>`;
    return;
  }
  const shots = plan?.shots || [];
  if (!state.templateReferenceFiles.length) {
    els.stylePreviewGrid.innerHTML = `<div class="style-result-empty">上传参考图后，这里会显示${state.similarMode === "none" ? "换主体" : "相似图"}生成结果</div>`;
    return;
  }
  els.stylePreviewGrid.innerHTML = state.templateReferenceFiles
    .map((file, index) => {
      const shot = shots[index] || {};
      const referenceUrl = URL.createObjectURL(file);
      const generatedUrl = shot.imageUrl || "";
      const slotClass = [
        "style-generated-slot",
        generatedUrl ? "has-image" : "",
        shot.status === "generating" ? "is-generating" : "",
        shot.status === "failed" ? "is-failed" : ""
      ]
        .filter(Boolean)
        .join(" ");
      const status = generatedUrl ? "已完成" : shot.status === "generating" ? "生成中..." : shot.status === "failed" ? "生成失败" : shots.length ? "待生成" : "待生成";
      const referenceIndex = Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) + 1 : index + 1;
      const statusClass = generatedUrl ? "is-done" : shot.status === "failed" ? "is-failed" : shot.status === "generating" ? "is-loading" : "";
      const revisionValue = shot.userRevisionPrompt || "";
      const revisionCopy = styleRevisionCopy();
      const generatedPane = generatedUrl
        ? `
          <div class="style-image-shell">
            <button class="style-image-button" data-style-preview-index="${index}" type="button" title="查看生成结果">
              <img src="${escapeHtml(generatedUrl)}" alt="生成相似 ${index + 1}" />
            </button>
            ${
              styleResultTextEditable()
                ? `<button class="style-direct-text-edit" data-style-text-prompt-shot="${index}" type="button" title="框选大图上的文字区域再修改">框选改字</button>`
                : ""
            }
          </div>
        `
        : shot.status === "failed"
          ? `<em class="style-result-placeholder is-failed">${escapeHtml(shot.error || "生成失败，可重新生成这一张")}</em>`
          : `<em class="style-result-placeholder ${shot.status === "generating" ? "is-generating" : ""}">${
              shot.status === "generating"
                ? "正在生成..."
                : state.similarMode === "none"
                  ? "生成后只替换该参考图中的原商品主体"
                  : state.similarMode === "scene"
                    ? "生成后会按产品主体生成相似场景/换背景"
                    : "生成后会按参考图方向重新生成同类相似图"
            }</em>`;
      const actions = generatedUrl
        ? `
          <small class="style-result-cost credit-hint is-compact">${escapeHtml(singleImageCreditHintText())}</small>
          <div class="style-result-button-row">
            <button data-style-preview-action="${index}" type="button">查看图片</button>
            <button data-style-regenerate-shot="${index}" type="button">重新生成</button>
            <button data-style-save-shot="${index}" type="button">保存文件</button>
          </div>
        `
        : shot.status === "failed"
          ? `
            <small class="style-result-cost credit-hint is-compact">${escapeHtml(singleImageCreditHintText())}</small>
            <div class="style-result-button-row is-single">
              <button data-style-regenerate-shot="${index}" type="button">重新生成</button>
            </div>
          `
          : "";
      return `
        <article class="style-preview-item">
          <div class="style-result-head">
            <strong>参考图 ${index + 1}</strong>
            <span class="style-result-status ${statusClass}">${escapeHtml(status)}</span>
          </div>
          <div class="style-compare-row">
            <div class="style-compare-pane">
              <small>原参考图</small>
              <button class="style-image-button style-reference-button" data-style-reference-index="${index}" type="button" title="查看参考图">
                <img src="${escapeHtml(referenceUrl)}" alt="参考图 ${index + 1}" />
              </button>
            </div>
            <div class="${slotClass} style-compare-pane">
              <small>使用参考图 ${referenceIndex}</small>
              ${generatedPane}
            </div>
          </div>
          <div class="style-result-footer">
            <span>绑定输出 ${index + 1}</span>
            ${actions ? `<div class="style-result-actions">${actions}</div>` : ""}
          </div>
          <label class="style-prompt-editor">
            <span>${escapeHtml(revisionCopy.label)}</span>
            <textarea data-style-shot-prompt="${index}" rows="3" placeholder="${escapeHtml(revisionCopy.placeholder)}">${escapeHtml(revisionValue)}</textarea>
          </label>
          ${shot.savedPath ? `
            <div class="style-result-meta">
              <small class="style-save-result">${escapeHtml(shot.savedPath)}</small>
            </div>
          ` : ""}
        </article>
      `;
    })
    .join("");
  bindStylePreviewActions();
}

function bindStylePreviewActions() {
  if (!els.stylePreviewGrid) return;
  els.stylePreviewGrid.querySelectorAll("[data-style-shot-prompt]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const shot = state.plan?.shots?.[Number(textarea.dataset.styleShotPrompt)];
      if (shot) shot.userRevisionPrompt = textarea.value.trim();
    });
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-preview-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.stylePreviewIndex);
      const shot = state.plan?.shots?.[index];
      if (shot?.imageUrl) openImageLightbox(shot, { styleIndex: index });
    });
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-preview-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.stylePreviewAction);
      const shot = state.plan?.shots?.[index];
      if (shot?.imageUrl) openImageLightbox(shot, { styleIndex: index });
    });
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-regenerate-shot]").forEach((button) => {
    button.addEventListener("click", () => regenerateShot(Number(button.dataset.styleRegenerateShot), button));
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-text-prompt-shot]").forEach((button) => {
    button.addEventListener("click", () => promptStyleResultTextEdit(Number(button.dataset.styleTextPromptShot), button));
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-reference-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.styleReferenceIndex);
      const file = state.templateReferenceFiles[index];
      if (!file) return;
      openImageLightbox({ title: `参考图 ${index + 1}`, imageUrl: URL.createObjectURL(file) });
    });
  });
  els.stylePreviewGrid.querySelectorAll("[data-style-save-shot]").forEach((button) => {
    button.addEventListener("click", () => saveGeneratedImage(Number(button.dataset.styleSaveShot), button));
  });
}

function prepareStyleCloneAnalysis({ auto = false, runNow = false } = {}) {
  renderStyleClonePage();
  const manualPrompt = styleWorkspacePrompt();
  if (!state.files.length) {
    els.statusText.textContent = "请先上传产品图。";
    els.statusText.classList.add("is-error-text");
    return Promise.resolve(false);
  }
  if (!state.templateReferenceFiles.length) {
    els.statusText.textContent = "请先上传参考图，未选相似类型时会按参考图数量直接换主体。";
    els.statusText.classList.add("is-error-text");
    return Promise.resolve(false);
  }
  state.requirementAutoFilled = false;
  clearWorkspacePlan("style");
  renderEmptyPlan();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = auto ? "产品图或参考图已变化，正在更新生成规划..." : "正在根据产品图和参考图准备生成...";
  if (!runNow) {
    els.statusText.textContent = "产品图和参考图已准备好，点击识别并生成后会直接出图。";
  }
  const layoutOverride = styleCloneAnalysisPrompt(manualPrompt);
  const options = {
    autofillRequirement: false,
    manualRequirementSync: true,
    layoutOverride,
    productRequirementOverride: layoutOverride
  };
  if (runNow) return analyzeUploadedProduct(options).then(() => Boolean(getWorkspacePlan("style")?.shots?.length));
  return Promise.resolve(true);
}

async function handleStylePreviewAction() {
  const runtime = workspaceRuntime("style");
  if (runtime.busy || runtime.generating) return;
  const ready = await prepareStyleCloneAnalysis({ runNow: true });
  const plan = getWorkspacePlan("style");
  if (!ready || !plan?.shots?.length) return;
  if (plan?.shots?.length && !runtime.busy && !runtime.generating) {
    setWorkspaceStatus("3/3 识别完成，正在提交并发生成任务...", { tool: "style" });
    await handleGenerate({ tool: "style" });
    return;
  }
}

function handleStyleSubjectChanged(message = "主体已变化，请重新识别并生成。") {
  renderStyleClonePage();
  if (state.activeTool !== "style") return;
  clearWorkspacePlan("style");
  renderEmptyPlan();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = message;
  if (state.files.length && state.templateReferenceFiles.length) {
    els.statusText.textContent = "产品图和参考图已准备好，点击识别并生成后会自动运行。";
  }
}

function handleStyleModelChanged() {
  const modelValue = setWorkspaceModel("style", els.styleModelSelect?.value || selectedImageModelValue("style"));
  refreshCost();
  if (state.activeTool !== "style") return;
  clearWorkspacePlan("style");
  renderEmptyPlan();
  renderStyleClonePage();
  const model = imageModelMeta(modelValue);
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent =
    state.files.length && state.templateReferenceFiles.length
      ? `已切换到 ${model.label}，下一次识别并生成会按该模型实时调用。`
      : `已切换到 ${model.label}，上传产品图和参考图后即可识别并生成。`;
}

function handleStyleClarityChanged() {
  setWorkspaceClarity("style", els.styleClaritySelect?.value || selectedClarityValue("style"));
  renderStyleModelHint();
  refreshCost();
  if (state.activeTool !== "style") return;
  const clarity = clarityMeta();
  renderStyleClonePage();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = state.plan?.shots?.length
    ? `已切换为 ${clarity.label}，下一次识别并生成或重新生成会按该清晰度出图。`
    : `已切换为 ${clarity.label}，下一次识别并生成会按该清晰度出图。`;
}

function handleStyleRatioChanged() {
  if (state.activeTool !== "style") return;
  clearWorkspacePlan("style");
  renderEmptyPlan();
  renderStyleClonePage();
  refreshCost();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = `风格复刻比例已切换为 ${selectedStyleRatio()}，下一次识别并生成会按该比例出图。`;
}

function handleCollageClarityChanged() {
  setWorkspaceClarity("templates", els.collageClaritySelect?.value || selectedClarityValue("templates"));
  renderStyleModelHint();
  refreshCost();
  if (state.activeTool !== "templates") return;
  const clarity = clarityMeta();
  renderCollageCenter();
  if (els.collageStatus) {
    els.collageStatus.textContent = state.collageShot?.imageUrl
      ? `已切换为 ${clarity.label}，可重新识别并生成。`
      : `已切换为 ${clarity.label}，点击识别并生成后生效。`;
  }
}

function handleCollageModelChanged() {
  const modelValue = setWorkspaceModel("templates", els.collageModelSelect?.value || selectedImageModelValue("templates"));
  refreshCost();
  if (state.activeTool !== "templates") return;
  const model = imageModelMeta(modelValue);
  state.collageShot = null;
  renderCollageCenter();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = `拼图模型已切换为 ${model.label}，请重新识别并生成。`;
  if (els.collageStatus) {
    els.collageStatus.textContent = `当前模型：${model.label}，点击识别并生成后生效。`;
  }
}

function handleCollageRatioChanged() {
  if (state.activeTool !== "templates") return;
  state.collageShot = null;
  renderCollageCenter();
  if (els.collageStatus) {
    els.collageStatus.textContent = `已切换为 ${selectedCollageRatio()}，下一次识别并生成会按该比例出图。`;
  }
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = `拼图比例已切换为 ${selectedCollageRatio()}。`;
}

function applySimilarMode(mode) {
  if (state.activeTool === "style" && state.similarMode === mode) {
    setSimilarMode("none");
    clearWorkspacePlan("style");
    renderEmptyPlan();
    renderStyleClonePage();
    if (state.files.length && state.templateReferenceFiles.length) {
      els.statusText.textContent = styleModeHintText("none");
    }
    return;
  }
  if (mode === "none") {
    setSimilarMode("none");
    state.requirementAutoFilled = false;
    clearWorkspacePlan("style");
    renderEmptyPlan();
    renderStyleClonePage();
    if (state.activeTool === "style" && state.files.length && state.templateReferenceFiles.length) {
      els.statusText.textContent = styleModeHintText("none");
    }
    return;
  }
  const copy = {
    scene: "相似场景图/换背景：主体来自产品图，参考图只作为空间类型、镜头、色调、软装和氛围方向，重新生成一张完整连续的同类新场景，不保留原完整场景，不做拼图或分屏。",
    selling: "相似卖点/功能图：参考图只作为信息层级、留白和视觉节奏方向，重新生成一张同类卖点图，不保留原版面。",
    detail: "相似细节图：参考图只作为微距角度、材质表现和景深方向，重新生成一张同类细节图，不保留原画面。",
    real: "相似实拍图：参考图只作为真实拍摄感、自然光影和透视方向，重新生成一张同类实拍图，不保留原场景。"
  }[mode];
  if (!copy) return;
  setSimilarMode(mode);
  state.requirementAutoFilled = false;
  clearWorkspacePlan("style");
  renderEmptyPlan();
  renderStyleClonePage();
  if (!state.templateReferenceFiles.length) {
    els.statusText.textContent = `${styleModeHintText(mode)} 请先上传参考图。`;
  } else {
    els.statusText.textContent = styleModeHintText(mode);
  }
  if (state.activeTool === "style" && state.files.length && state.templateReferenceFiles.length) {
    els.statusText.textContent = `${styleModeHintText(mode)} 点击识别并生成后会自动调用模型。`;
  } else if (state.files.length) {
    syncPlanAfterUserChange("相似图模式已启用，请点击分析产品重新生成对应大纲。");
  }
}

function handleTemplateReferenceFiles(files) {
  const incoming = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  if (!incoming.length) return;
  state.templateReferenceFiles = [...state.templateReferenceFiles, ...incoming].slice(0, 4);
  renderTemplateReferencePreview();
  renderStyleClonePage();
  if (state.activeTool === "style" && state.files.length) {
    clearWorkspacePlan("style");
    renderEmptyPlan();
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = "参考图已上传，点击识别并生成后会自动开始运行。";
    return;
  }
  if (state.files.length) syncPlanAfterUserChange("参考图已上传，请点击分析产品重新生成图片规划。");
}

function renderTemplateReferencePreview() {
  els.templateReferencePreview.innerHTML = "";
  if (!state.templateReferenceFiles.length) {
    return;
  }
  state.templateReferenceFiles.forEach((file, index) => {
    const thumb = document.createElement("div");
    thumb.className = "template-ref-thumb";
    const view = document.createElement("button");
    view.type = "button";
    view.className = "template-ref-view";
    view.setAttribute("aria-label", `查看参考图 ${index + 1}`);
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    view.append(img);
    view.addEventListener("click", () => {
      openImageLightbox({ title: `参考图 ${index + 1}`, imageUrl: URL.createObjectURL(file) });
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thumb-delete";
    remove.setAttribute("aria-label", "删除参考图");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.templateReferenceFiles.splice(index, 1);
      renderTemplateReferencePreview();
      renderStyleClonePage();
      if (state.activeTool === "style") {
        handleStyleSubjectChanged(state.templateReferenceFiles.length ? "参考图已变更，请重新识别并生成。" : "参考图已清空，请上传新的参考图。");
      } else if (state.files.length) syncPlanAfterUserChange("参考图已变更，请点击分析产品重新生成图片规划。");
    });
    thumb.append(view, remove);
    els.templateReferencePreview.append(thumb);
  });
}

function appendTemplateReferenceFiles(form) {
  state.templateReferenceFiles.forEach((file) => form.append("templateReferences", file));
}

function styleRevisionForShot(index, shot = {}) {
  const editor = els.stylePreviewGrid?.querySelector(`[data-style-shot-prompt="${index}"]`);
  const revision = (editor?.value || shot.userRevisionPrompt || "").trim();
  if (shot) shot.userRevisionPrompt = revision;
  return revision;
}

function productPromptAllowsText(category = "") {
  return ["selling", "function", "detail"].includes(String(category || "").toLowerCase());
}

function stripProductPromptRules(prompt = "") {
  let text = String(prompt || "").replace(/\\n/g, "\n").trim();
  if (!text) return "";
  text = text
    .replaceAll(PRODUCT_VISIBLE_SUBJECT_LOCK, "")
    .replaceAll(PRODUCT_VISIBLE_TEXT_LOCK, "")
    .replaceAll("仅使用少量清晰中文标注，不要乱码、logo、水印或价格。", "")
    .replaceAll("中国市场输出：画面内如需文字，只能使用简体中文；不得出现任何英文字母、英文单词、拼音、英文缩写、乱码、水印、价格或品牌标志。", "")
    .replaceAll("本图不需要可见文字；不要生成中英文标题、标签、说明、界面元素、装饰字母、水印、价格或品牌标志。", "")
    .replaceAll("场景图必须是一张完整连续的真实空间照片感画面；不要拼图、四宫格、多宫格、分屏、画中画、详情页拼版、信息图版式或多张样图合集。", "")
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
    .join("\n")
    .trim();
}

function structuredPromptLine(prompt = "", label = "") {
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(prompt || "").match(new RegExp(`(?:^|\\n)\\s*(?:•\\s*)?${escaped}[：:]\\s*([^\\n]+)`, "i"));
  return (match?.[1] || "").trim();
}

function structuredPromptTextLines(prompt = "") {
  const inline = structuredPromptLine(prompt, "文字内容");
  if (inline && inline !== "无") return inline.replace(/(?:主标题|副标题|说明文字|标题|短文案方向|短文案|标签|标注)[：:]/g, "").trim();
  const lines = String(prompt || "").split(/\n+/);
  const start = lines.findIndex((line) => /文字内容（使用/.test(line));
  if (start < 0) return "";
  const result = [];
  for (const line of lines.slice(start + 1)) {
    if (/^特殊要求[：:]/.test(line.trim())) break;
    const text = line.replace(/^•\s*/, "").replace(/^(主标题|副标题|说明文字|标题|短文案方向|短文案|标签|标注)[：:]\s*/, "").trim();
    if (text && text !== "无") result.push(text);
  }
  return result.join("；") || "无";
}

function commerceHeroOverlayTextForShot(shot = {}) {
  if (shot?.textOverlay?.template !== "commerce-detail-hero") return "";
  return [shot.textOverlay.title, shot.textOverlay.subtitle]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("；");
}

function compactStructuredPrompt(prompt = "", shot = {}) {
  const title = (structuredPromptLine(prompt, "本张任务").replace(/[：:].*$/, "") || (String(prompt || "").match(/(?:^|\n)\s*图\d+[：:]\s*([^\n]+)/)?.[1] || "")).trim();
  const claim = structuredPromptLine(prompt, "本张内容认领");
  const goal = structuredPromptLine(prompt, "设计目标");
  const theme = structuredPromptLine(prompt, "整体主题") || structuredPromptLine(prompt, "页面设计方向");
  const image = structuredPromptLine(prompt, "画面提示") || structuredPromptLine(prompt, "页面构图");
  const focus = structuredPromptLine(prompt, "展示重点");
  const task = [title, claim || goal].filter(Boolean).join("：") || goal || title;
  const imageLine = [image, focus ? `重点表现${focus}` : ""].filter(Boolean).join("；");
  const overlayText = commerceHeroOverlayTextForShot(shot);
  return [
    theme ? `整体主题：${theme}` : "",
    task ? `本张任务：${task}` : "",
    imageLine ? `画面提示：${imageLine}` : "",
    overlayText ? `首图文案：${overlayText}` : `文字内容：${structuredPromptTextLines(prompt) || "无"}`
  ].filter(Boolean).join("\n");
}

function productPromptWithShortLock(prompt = "", category = "", shot = {}) {
  const stripped = stripProductPromptRules(prompt);
  const isStructuredPlan = /整体主题[：:]|本张任务[：:]|画面提示[：:]|产品复杂结构判定[：:]|图中图元素[：:]|内容要素[：:]|文字内容(?:（使用)?/.test(stripped);
  if (isStructuredPlan) return compactStructuredPrompt(stripped, shot) || stripped;
  const body = stripped.replace(/\s+/g, " ").replace(/\s*([，。；：、])\s*/g, "$1").trim();
  if (!body) return "";
  const bodySentence = /[。！？.!?]$/.test(body) ? body : `${body}。`;
  return bodySentence;
}

function editablePromptForShot(index, shot = {}, tool = state.activeTool) {
  const planEditor = els.planList?.querySelector(`[data-shot-prompt="${index}"]`);
  const basePrompt = (planEditor?.value || shot.prompt || "").trim();
  const prompt = normalizeToolKey(tool) === "product"
    ? productPromptWithShortLock(basePrompt, shot.category, shot)
    : basePrompt;
  const revision = normalizeToolKey(tool) === "style" ? styleRevisionForShot(index, shot) : "";
  return revision ? `${prompt}\n用户修改要求：${revision}` : prompt;
}

function collectShotPromptOverrides(tool = state.activeTool, plan = getWorkspacePlan(tool) || state.plan) {
  const shots = plan?.shots || [];
  return shots
    .map((shot, index) => {
      const prompt = editablePromptForShot(index, shot, tool);
      return {
        index,
        id: shot.id || "",
        category: shot.category || "",
        prompt,
        userRevisionPrompt: shot.userRevisionPrompt || ""
      };
    })
    .filter((item) => item.prompt);
}

function buildGenerationPlanPayload(tool = state.activeTool, plan = getWorkspacePlan(tool) || state.plan) {
  const activePlan = plan || {};
  return {
    profile: activePlan.profile || {},
    designSpec: activePlan.designSpec || {},
    analysis: activePlan.analysis || {},
    promptDispatch: activePlan.promptDispatch || activePlan.analysis?.promptDispatch || {},
    shots: (activePlan.shots || []).map((shot, index) => {
      const prompt = editablePromptForShot(index, shot, tool);
      return {
        id: shot.id || `shot-${index + 1}`,
        category: shot.category || "",
        title: shot.title || `图片 ${index + 1}`,
        description: shot.description || "",
        ratio: normalizeToolKey(tool) === "style" ? selectedStyleRatio() : shot.ratio || selectedRatioValue(tool),
        referenceIndex: Number.isInteger(shot.referenceIndex) ? shot.referenceIndex : index,
        referenceTarget: shot.referenceTarget || shot.referenceAnalysis || null,
        promptRoute: shot.promptRoute || {},
        prompt,
        generationPrompt: shot.generationPrompt || "",
        textOverlay: shot.textOverlay || null,
        textImageUrl: shot.textImageUrl || "",
        noTextImageUrl: shot.noTextImageUrl || "",
        userRevisionPrompt: shot.userRevisionPrompt || ""
      };
    })
  };
}

function selectControlValue(control, fallback = "") {
  return control?.value || fallback;
}

function styleCloneStrategySettings() {
  return {
    cloneStrength: selectControlValue(els.styleCloneStrengthSelect, "balanced"),
    backgroundLock: selectControlValue(els.styleBackgroundLockSelect, "protect"),
    positionLock: selectControlValue(els.stylePositionLockSelect, "strict"),
    styleConsistency: selectControlValue(els.styleConsistencySelect, "strict")
  };
}

function styleCloneLanguageSetting(mode = state.similarMode) {
  return ["selling", "detail"].includes(String(mode || "").toLowerCase())
    ? "简体中文卖点/细节标注文字"
    : "无文字，纯视觉";
}

function getSettings(tool = state.activeTool) {
  const key = normalizeToolKey(tool);
  const template = key === "product" && state.templateApplied ? creationTemplateMeta() : null;
  const similarIntents = {
    scene: "生成相似场景图/换背景：主体来自产品图，参考图只做空间构图、镜头角度、灯光氛围和软装搭配方向，重新生成一张完整连续的同类新场景，不做拼图或分屏。",
    selling: "生成相似卖点/功能图：参考图只做信息结构、留白和产品呈现方式方向，重新生成同类卖点图。",
    detail: "生成相似细节图：参考图只做微距角度、材质呈现和局部构图方向，重新生成同类细节图。",
    real: "生成相似实拍图：参考图只做真实拍摄感、背景、光线和透视方向，重新生成同类实拍图。"
  };
  return {
    model: selectedImageModelValue(key),
    ratio: selectedRatioValue(key),
    clarity: selectedClarityValue(key),
    language: key === "style" ? styleCloneLanguageSetting() : "无文字，纯视觉",
    speed: "turbo",
    imageScope: key === "style" || key === "templates" ? "detail" : state.imageScope,
    styleCloneMode: key === "style",
    lampCategory: "auto",
    lampCategoryLabel: "",
    lampCategoryHint: "",
    template: template?.id || "",
    templateName: template?.name || "",
    templateTag: template?.tag || "",
    templateSummary: template?.summary || "",
    templateStrategy: template?.strategy || "",
    templatePrompt: template?.prompt || "",
    templateReferenceCount: state.templateReferenceFiles.length,
    similarMode: state.similarMode,
    similarIntent: similarIntents[state.similarMode] || "",
    noFallbackMode: key === "style",
    styleCloneStrategy: styleCloneStrategySettings(),
    workspaceStrategyVersion: 1,
    mode: key === "product" || key === "style" || state.config?.realOpenAIImagesEnabled ? "api" : "demo"
  };
}

function productPayload(tool = state.activeTool, plan = getWorkspacePlan(tool) || state.plan) {
  const profile = plan?.profile || {};
  return {
    requirement: activeGenerationRequirement(tool),
    lampCategory: "auto",
    lampCategoryLabel: "",
    lampCategoryHint: "",
    productName: profile.productName || "",
    lampType: profile.lampType || "",
    lampSubtype: profile.lampSubtype || "",
    style: profile.style || "",
    material: profile.material || "",
    color: profile.color || "",
    function: profile.function || "",
    targetSpace: profile.targetSpace || "",
    installationPosition: profile.installationPosition || "",
    installationMethod: profile.installationMethod || "",
    lampChannel: profile.lampChannel || "",
    mountFamily: profile.mountFamily || "",
    installSurface: profile.installSurface || "",
    visibleParts: profile.visibleParts || "",
    scaleClass: profile.scaleClass || "",
    lightUse: profile.lightUse || "",
    beamAngle: profileSupportsBeamOpening(profile) ? profile.beamAngle || "" : "",
    openingSize: profileSupportsBeamOpening(profile) ? profile.openingSize || "" : "",
    structureKeywords: profile.structureKeywords || "",
    sellingPoints: profile.sellingPoints || "",
    visualStrategy: profile.visualStrategy || {}
  };
}

function profileValue(value, fallback = "待识别") {
  return String(value || "").trim() || fallback;
}

function countSummaryText() {
  const counts = currentCounts();
  const groups = [
    ["主图", counts.main],
    ["卖点图", counts.selling],
    ["功能图", counts.function],
    ["场景图", counts.scene],
    ["细节图", counts.detail],
    ["实拍图", counts.real]
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => `${count} 张${label}`);
  return groups.length ? groups.join("、") : "未选择数量";
}

function activeCountEntries(counts = currentCounts()) {
  return [
    { key: "main", label: "主图", count: Number(counts.main || 0) },
    { key: "selling", label: "卖点图", count: Number(counts.selling || 0) },
    { key: "function", label: "功能图", count: Number(counts.function || 0) },
    { key: "scene", label: "场景图", count: Number(counts.scene || 0) },
    { key: "detail", label: "细节图", count: Number(counts.detail || 0) },
    { key: "real", label: "实拍图", count: Number(counts.real || 0) }
  ].filter((item) => item.count > 0);
}

function primaryCountEntry(counts = currentCounts()) {
  return activeCountEntries(counts)[0] || (state.imageScope === "main" ? { key: "main", label: "主图", count: 1 } : { key: "selling", label: "卖点图", count: 1 });
}

function singleRequirementLines(taskKey, categoryLabel) {
  const map = {
    main: ["生成灯具电商主图", `灯具类目：${categoryLabel}。`, "严格保持产品图主体结构、材质、颜色和比例。", "背景简洁高级，突出产品轮廓和点击率。"],
    selling: ["生成灯具卖点图", `灯具类目：${categoryLabel}。`, "突出核心卖点、结构优势和照明价值。", "版式干净，避免堆叠文字，不虚构产品结构。"],
    function: ["生成灯具功能图", `灯具类目：${categoryLabel}。`, "使用图文功能版式展示护眼光感、均匀透光、材质稳定或安装结构。", "中文短句清晰，不虚构品牌、认证、专利或价格。"],
    scene: ["生成灯具场景图", `灯具类目：${categoryLabel}。`, "放入一张完整连续的真实空间，展示安装关系、光线范围和氛围。", "不要拼图、四宫格、多宫格或分屏；保持空间合理，产品比例真实。"],
    detail: ["生成灯具细节图", `灯具类目：${categoryLabel}。`, "聚焦发光面、灯杯、材质、安装结构或工艺细节。", "细节清晰，不能改变产品结构。"],
    real: ["生成灯具实拍图", `灯具类目：${categoryLabel}。`, "呈现真实拍摄质感、自然透视和轻微阴影。", "不要海报化，不要新增不存在的部件。"]
  };
  return map[taskKey] || map.selling;
}

function similarRequirementText() {
  const copy = {
    scene: "相似场景图/换背景：主体来自产品图，参考图只做空间构图、镜头角度、灯光氛围和软装搭配方向，输出一张完整连续的新场景。",
    selling: "相似卖点/功能图：参考图只做信息结构、留白和产品呈现方式方向。",
    detail: "相似细节图：参考图只做微距角度、材质呈现和局部构图方向。",
    real: "相似实拍图：参考图只做真实拍摄感、背景、光线和透视方向。"
  };
  return copy[state.similarMode] || "";
}

function buildRequirementFromRecognition(plan) {
  const profile = plan?.profile || {};
  const categoryLabel = profile.lampSubtype || profile.lampType || "智能识别";
  const counts = currentCounts();
  const total = totalCountFromCounts(counts);
  if (total <= 1) {
    return singleRequirementLines(primaryCountEntry(counts).key, categoryLabel).filter(Boolean).join("\n");
  }
  if (state.imageScope === "main") {
    return [
      "生成灯具电商主图组",
      `灯具类目：${categoryLabel}。`,
      "严格保持产品图主体结构、材质、颜色和比例。",
      "每张主图都要有不同构图或光影方向，适合电商首图测试。"
    ].join("\n");
  }
  return [
    "生成灯具详情图组",
    `灯具类目：${categoryLabel}。`,
    "严格保持产品图主体结构、材质、颜色和比例。",
    "画面干净真实，适合电商详情页直接使用。",
    similarRequirementText()
  ].filter(Boolean).join("\n");
}
function fillRequirementFromRecognition(plan) {
  els.requirementInput.value = buildRequirementFromRecognition(plan);
  state.requirementAutoFilled = true;
}

function queueAnalyzeUploadedProduct(options = {}) {
  if (!state.files.length) return;
  if (state.busy) {
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = "正在分析中。本次修改不会自动重新分析，完成后请按当前设置重新点击分析产品。";
    return;
  }
  void analyzeUploadedProduct(options);
}

function scheduleRequirementSync(message = "要求已修改，请点击分析产品重新生成图片规划。") {
  window.clearTimeout(state.requirementSyncTimer);
  if (!state.files.length) return;
  resetPlanForInputChange(message);
}

function estimateCredits(tool = state.activeTool) {
  const counts = currentCounts(tool);
  const total = totalCountFromCounts(counts);
  const rules = state.config?.creditRules || {};
  const clarity = clarityMeta(selectedClarityValue(tool));
  const speed = rules.speed?.turbo || { label: "极速", multiplier: 0.75 };
  const modelMultiplier = rules.model?.[selectedImageModelValue(tool)] || 1;
  const planningFee = Number(rules.planningFee || 0);
  const baseImageCredits = Number(rules.baseImageCredits || 12);
  const clarityMultiplier = Number(clarity.multiplier || 1);
  const perImageCredits = Math.ceil(baseImageCredits * clarityMultiplier * speed.multiplier * modelMultiplier);
  const imageCredits = total * perImageCredits;
  return {
    credits: planningFee + imageCredits,
    totalImages: total,
    breakdown: {
      planningFee,
      clarity: clarity.label,
      baseImageCredits,
      clarityMultiplier,
      speed: speed.label,
      speedMultiplier: speed.multiplier,
      modelMultiplier,
      perImageCredits,
      imageCredits
    }
  };
}

function estimateSingleImageCredits(tool = state.activeTool) {
  const rules = state.config?.creditRules || {};
  const clarity = clarityMeta(selectedClarityValue(tool));
  const speed = rules.speed?.turbo || { label: "极速", multiplier: 0.75 };
  const modelMultiplier = rules.model?.[selectedImageModelValue(tool)] || 1;
  const baseImageCredits = Number(rules.baseImageCredits || 12);
  const clarityMultiplier = Number(clarity.multiplier || 1);
  const unitCredits = Math.ceil(baseImageCredits * clarityMultiplier * speed.multiplier * modelMultiplier);
  const totalImages = 1;
  const credits = unitCredits * totalImages;
  return {
    credits,
    totalImages,
    breakdown: {
      baseImageCredits,
      clarity: clarity.label,
      clarityMultiplier,
      speed: speed.label,
      modelMultiplier,
      unitCredits
    }
  };
}

function creditHintText(credits) {
  const value = Number.isFinite(Number(credits)) ? Number(credits) : "--";
  return `本次消耗 ${value} 积分`;
}

function singleImageCreditHintText() {
  return creditHintText(estimateSingleImageCredits().credits);
}

function failedRetryCreditHintText() {
  const failedCount = (state.plan?.shots || []).filter((shot) => shot.status === "failed").length;
  const credits = estimateSingleImageCredits().credits * failedCount;
  return creditHintText(credits);
}

function refreshCost() {
  const estimate = estimateCredits();
  state.lastEstimate = estimate;
  const balance = Number(state.user?.balance || 0);
  if (els.costText) {
    els.costText.textContent = creditHintText(estimate.credits);
  }
  if (els.analyzeButton) {
    const readyToGenerate = Boolean(state.plan?.shots?.length && !state.busy);
    els.analyzeButton.classList.toggle("is-generate-ready", readyToGenerate);
    els.analyzeButton.disabled =
      !state.files.length ||
      state.busy ||
      state.generating ||
      (readyToGenerate && state.user?.role !== "admin" && balance < estimate.credits);
    els.analyzeButton.textContent = state.generating
      ? "生成中..."
      : state.busy
        ? "分析中..."
        : readyToGenerate
          ? generationActionLabel()
          : "分析产品";
  }
  if (els.generateButton) els.generateButton.disabled = true;
}

function renderStepper() {
  const steps = Array.from(els.stepper.querySelectorAll(".step"));
  steps.forEach((step, index) => {
    const number = index + 1;
    const done = state.workflow.completed.has(number);
    const active = state.workflow.active === number && !done;
    step.classList.toggle("is-done", done);
    step.classList.toggle("is-active", active);
    step.querySelector("span").textContent = done ? "✓" : String(number);
  });
}

function setWorkflow({ completed = [], active = null } = {}, tool = state.activeTool) {
  setWorkspaceWorkflow({ completed, active }, tool);
}

function readFiles(files) {
  const incoming = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  if (!incoming.length) return;
  const tool = state.activeTool === "style" ? "style" : state.activeTool === "templates" ? "templates" : "product";
  const currentFiles = workspaceFiles(tool);
  const accepted = incoming.slice(0, Math.max(0, 6 - currentFiles.length));
  if (!accepted.length) {
    els.statusText?.classList.add("is-error-text");
    if (els.statusText) els.statusText.textContent = "当前工作区最多上传 6 张产品图。";
    return;
  }
  const startIndex = currentFiles.length;
  if (tool === "templates") {
    const incomingNames = accepted.map(() => "");
    state.collageProductNames = [...state.collageProductNames, ...incomingNames].slice(0, startIndex + accepted.length);
  }
  setWorkspaceFiles([...currentFiles, ...accepted], tool);
  clearWorkspacePlan(tool);
  if (tool === "templates") state.collageShot = null;
  renderPreviews();
  if (tool === "style") {
    handleStyleSubjectChanged("产品图已上传，上传参考图后点击识别并生成开始运行。");
  } else if (tool === "templates") {
    renderCollageCenter();
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = "产品图已加入拼图中心，可继续上传或直接识别并生成。";
    if (els.collageStatus) els.collageStatus.textContent = "产品图已更新，点击识别并生成开始制作。";
  } else {
    resetPlanForInputChange("产品图已上传，请选择主图/详情图、数量和模型后点击分析产品。");
  }
}

function renderPreviews() {
  const files = workspaceFiles("product");
  els.photoCounter.textContent = `${files.length}/6`;
  els.previewList.innerHTML = "";
  files.forEach((file, index) => {
    const thumb = document.createElement("div");
    thumb.className = "photo-thumb";
    thumb.title = "双击放大";
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "button");
    thumb.setAttribute("aria-label", `双击放大产品图 ${index + 1}`);
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    const badge = document.createElement("small");
    badge.textContent = String(index + 1);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "删除图片");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      files.splice(index, 1);
      if (state.activeTool === "product") activateWorkspaceFiles("product");
      clearWorkspacePlan("product");
      renderPreviews();
      if (files.length) {
      resetPlanForInputChange("产品图已变更，请重新点击分析产品。");
      } else {
        clearWorkspacePlan("product");
        state.requirementAutoFilled = false;
        setWorkflow();
        renderEmptyPlan();
      }
    });
    thumb.addEventListener("dblclick", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      openImageLightbox({ title: `产品图 ${index + 1}`, imageUrl: img.src });
    });
    thumb.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      openImageLightbox({ title: `产品图 ${index + 1}`, imageUrl: img.src });
    });
    thumb.append(img, badge, remove);
    els.previewList.append(thumb);
  });

  const add = document.createElement("label");
  add.id = "dropZone";
  add.className = "photo-add";
  add.setAttribute("for", "photoInput");
  add.innerHTML = `
    <input id="photoInput" type="file" accept="image/*" multiple />
    <span class="upload-symbol">+</span>
    <strong>${files.length ? "继续上传" : "点击或拖拽上传"}</strong>
    <em>多图上传时建议仅上传必要的视角或 SKU 图，图片不是越多越好</em>
  `;
  els.previewList.append(add);
  wireDropZone();
  renderStyleSubjectPreview();
  renderCollageCenter();
}

async function analyzeUploadedProduct({
  autofillRequirement = false,
  manualRequirementSync = false,
  layoutOverride = null,
  productRequirementOverride = null
} = {}) {
  const tool = normalizeToolKey(state.activeTool);
  const runtime = workspaceRuntime(tool);
  const files = workspaceFiles(tool).slice();
  if (!files.length || runtime.busy) return;
  const visiblePromptBeforeAnalyze = els.requirementInput.value.trim();
  const effectivePromptBeforeAnalyze =
    typeof layoutOverride === "string" ? layoutOverride.trim() : visiblePromptBeforeAnalyze;
  const manualPromptBeforeAnalyze = Boolean(effectivePromptBeforeAnalyze) && !state.requirementAutoFilled;
  const shouldAutofillRequirement = Boolean(autofillRequirement && !manualPromptBeforeAnalyze);
  const previousPlan = getWorkspacePlan(tool);
  const requestCounts = currentCounts(tool);
  const requestSettings = getSettings(tool);
  runtime.analysisRevision = Number(runtime.analysisRevision || 0) + 1;
  const requestRevision = runtime.analysisRevision;
  runtime.busy = true;
  setWorkspacePlan({ analyzing: true }, tool);
  if (tool === state.activeTool) state.plan = getWorkspacePlan(tool);
  if (tool === "style" && state.activeTool === "style") renderStyleClonePage();
  setWorkflow({ completed: [1], active: 2 }, tool);
  setWorkspaceStatus(
    tool === "style"
      ? "1/3 正在识别产品主体、灯具类型和参考图灯位..."
      : manualRequirementSync
        ? "AI 正在按当前要求重新生成作图大纲..."
        : `AI 正在分析产品并规划 ${imageScopeLabel()}...`,
    { tool }
  );
  if (tool === state.activeTool) renderPlan({ analyzing: true });
  if (!manualRequirementSync) {
    const productImageCount = files.length;
    const outputShotCount = totalCountFromCounts(requestCounts);
    setWorkspaceStatus(
      tool === "style"
        ? `1/3 正在识别 ${productImageCount} 张产品图，并并行分析参考图灯位...`
        : `真实模型识别 ${productImageCount} 张产品图主体，并展开 ${outputShotCount} 张图片提示词...`,
      { tool }
    );
  }
  const form = new FormData();
  files.forEach((file) => form.append("photos", file));
  appendTemplateReferenceFiles(form);
  const product = productPayload(tool, previousPlan);
  if (typeof productRequirementOverride === "string") {
    product.requirement = productRequirementOverride.trim();
  } else if (!manualPromptBeforeAnalyze) {
    product.requirement = "";
  } else {
    product.requirement = effectivePromptBeforeAnalyze;
  }
  form.append("product", JSON.stringify(product));
  form.append("counts", JSON.stringify(requestCounts));
  form.append("settings", JSON.stringify(requestSettings));
  form.append("layout", manualPromptBeforeAnalyze ? effectivePromptBeforeAnalyze : "");
  form.append("promptMode", manualPromptBeforeAnalyze ? "optimize" : "generate");

  try {
    const payload = await api("/api/analyze-product", { method: "POST", body: form });
    if (requestRevision !== Number(runtime.analysisRevision || 0)) return;
    setWorkspacePlan(payload, tool);
    if (tool === state.activeTool) state.plan = payload;
    if (shouldAutofillRequirement && tool === state.activeTool) {
      fillRequirementFromRecognition(payload);
    }
    if (tool === state.activeTool) renderPlan(payload);
    if (payload.analysis?.cacheHit) {
      setWorkspaceStatus(
        payload.analysis.cacheMessage || (tool === "style" ? "2/3 已复用上次风格复刻识别结果，准备开始生成。" : "已复用上次识别规划结果，可直接继续生成。"),
        { tool }
      );
    } else if (manualRequirementSync) {
      const profile = payload.profile || {};
      setWorkspaceStatus(
        tool === "style"
          ? `2/3 已完成风格复刻识别：${profile.lampSubtype || profile.lampType || profile.style || "待识别"}，准备开始生成。`
          : `已按当前组图要求同步：${profile.style || "待识别"} / ${profile.material || "待识别"} / ${
              profile.function || "待识别"
            }`,
        { tool }
      );
    }
    setWorkflow({ completed: [1, 2], active: 3 }, tool);
  } catch (error) {
    if (requestRevision !== Number(runtime.analysisRevision || 0)) return;
    setWorkflow({ completed: [1], active: 2 }, tool);
    setWorkspaceStatus(error.message, { tool, isError: true });
  } finally {
    runtime.busy = false;
    refreshCost();
    if (tool === "style" && state.activeTool === "style") renderStyleClonePage();
    state.pendingAnalysisOptions = null;
  }
}

function renderEmptyPlan() {
  if (state.templateApplied && !state.files.length && creationTemplateMeta()?.id === "lamp-detail-suite") {
    state.plan = buildLampTemplatePreviewPlan();
    renderPlan(state.plan);
    return;
  }
  renderPlan({
    empty: true,
    profile: {
      style: "待识别",
      material: "待识别",
      function: "待识别",
      sellingPoints: "上传后自动识别并拓展"
    },
    designSpec: {
      title: "整体设计规范",
      subtitle: "所有图片遵循的统一视觉标准",
      sections: [
        { title: "AI 识别结果", lines: ["上传产品图后，系统会识别灯具类目、结构、材质、适合的视觉风格、氛围光影、色彩系统和硬性保真约束。"] },
        { title: "图片规划", lines: ["系统会根据识别到的视觉策略与生成张数，规划主图、卖点图、功能图、场景图、细节图和实拍图。"] }
      ]
    },
    shots: []
  });
}

function renderPromptAssist(plan) {
  void plan;
}

function applyOptimizedRequirement() {
  return;
}

function profileSupportsBeamOpening(profile = {}) {
  const primaryType = String(profile.lampType || "").trim();
  const mountFamily = String(profile.mountFamily || "").trim();
  if (/downlight|spotlight|track/.test(mountFamily)) return true;
  const allText = [
    profile.lampType,
    profile.lampSubtype,
    profile.productName,
    profile.installationMethod,
    profile.structureKeywords,
    profile.visibleParts
  ]
    .filter(Boolean)
    .join(" ");
  if (/(吊灯|吸顶灯|壁灯|台灯|落地灯|线性灯|灯带|柜灯|户外灯|轨道灯)/.test(primaryType)) return false;
  return /(射灯|筒灯)/.test(primaryType) || (!primaryType && /(射灯|筒灯|斗胆灯)/.test(allText));
}

function renderProfileRow(label, value, fallback = "待识别") {
  const text = String(value || "").trim();
  if (!text && fallback === "") return "";
  return `<p><strong>${escapeHtml(label)}</strong>${escapeHtml(text || fallback)}</p>`;
}

function profileVisualValue(value = "") {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("、");
  if (value && typeof value === "object") return Object.values(value).map((item) => String(item || "").trim()).filter(Boolean).join("、");
  const text = String(value || "").trim();
  if (!text || text === "以上传图真实结构和材质为准" || text === "待识别" || text === "现代商用产品图") return "";
  if (/^根据产品|^按产品图识别|^忽略产品图背景色/.test(text)) return "";
  return text;
}

function isSmallLampDisplayProfile(profile = {}) {
  const mountFamily = String(profile.mountFamily || "").trim();
  const channel = String(profile.lampChannel || "").trim();
  return channel === "small" || ["recessed-downlight", "surface-downlight", "spotlight", "track-spotlight", "track"].includes(mountFamily);
}

function compactProfileVisualStrategy(profile = {}) {
  const strategy = profile.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {};
  if (!isSmallLampDisplayProfile(profile) && !Object.keys(strategy).length) return null;
  const style = [
    profileVisualValue(strategy.suitableVisualStyle),
    profileVisualValue(strategy.productStyle || profile.style),
    profileVisualValue(strategy.styleKeywords)
  ].filter(Boolean).slice(0, 3).join("、");
  const mood = [
    profileVisualValue(strategy.moodKeywords),
    profileVisualValue(strategy.lightingEffect)
  ].filter(Boolean).slice(0, 2).join("；");
  const visual = [
    profileVisualValue(strategy.colorSystem || profile.colorPalette || profile.color),
    profileVisualValue(strategy.visualLanguage),
    profileVisualValue(strategy.decorativeElements)
  ].filter(Boolean).slice(0, 3).join("；");
  const view = profileVisualValue(strategy.recommendedView);
  const hard = profileVisualValue(strategy.hardConstraints || profile.hardConstraints);
  return { style, mood, visual, view, hard };
}

function renderVisualStrategySection(profile = {}) {
  const visual = compactProfileVisualStrategy(profile);
  if (!visual) return "";
  return `
    <section class="spec-section">
      <h4>视觉策略</h4>
      ${renderProfileRow("风格方向", visual.style, "按产品图识别")}
      ${renderProfileRow("氛围光影", visual.mood, "按产品图识别")}
      ${renderProfileRow("色彩画面", visual.visual, "按产品图识别")}
      ${renderProfileRow("推荐视角", visual.view, "")}
      ${renderProfileRow("硬性保真", visual.hard, "上传图真实结构和材质不可改变")}
    </section>
  `;
}

function visualStrategyObject(profile = {}) {
  return profile.visualStrategy && typeof profile.visualStrategy === "object" ? profile.visualStrategy : {};
}

function visualSpecValue(value = "", fallback = "按产品图识别") {
  return profileVisualValue(value) || fallback;
}

function splitSpecItems(value = "", fallback = []) {
  const text = profileVisualValue(value);
  const items = text
    ? text.split(/[；;、\n]+/).map((item) => item.trim()).filter(Boolean)
    : [];
  return (items.length ? items : fallback).slice(0, 6);
}

function renderSpecBullets(items = []) {
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderOverallDesignSpec(profile = {}, options = {}) {
  const strategy = visualStrategyObject(profile);
  const settings = options.settings || {};
  const resolutionLabel = clarityMeta(settings.clarity || selectedClarityValue()).label;
  const keywords = visualSpecValue(
    [strategy.styleKeywords, strategy.suitableVisualStyle, strategy.productStyle || profile.style].map(profileVisualValue).filter(Boolean).join("、"),
    profile.style || "按产品图识别"
  );
  const moodText = splitSpecItems(strategy.moodKeywords, ["按产品定位识别专业、可靠、高级、温馨或纯净等氛围"]).join("、");
  const lighting = visualSpecValue(strategy.lightingEffect, "按产品发光口、材质和应用场景识别光影效果");
  const colorSystem = visualSpecValue(strategy.colorSystem || profile.colorPalette || profile.color, "忽略产品图背景色，只按产品本体材质、颜色和发光口识别主色、辅助色和点缀色");
  const decorative = visualSpecValue(strategy.decorativeElements, "按产品风格识别装饰元素");
  const visualLanguage = visualSpecValue(strategy.visualLanguage, "按产品风格识别版式、镜头和图形语言");
  const hardItems = splitSpecItems(strategy.hardConstraints || profile.hardConstraints, [
    "严格还原上传图可见产品结构、材质、颜色和安装关系",
    profile.structureKeywords || "保留识别到的关键结构与表面质感"
  ]);
  return `
    <section class="spec-section">
      <h4>整体设计规范</h4>
      <blockquote>渲染图像时，严禁将字体名、hex 色值、章节标题词、字段标签词在画面中呈现。</blockquote>
      <blockquote>严格还原参考图中产品的所有细节、文字和色彩，不做任何修改。产品本体、各组件、表面及质感必须与参考图完全一致。</blockquote>
      <blockquote>所有图片必须遵循以下统一规范，确保视觉连贯性。</blockquote>
    </section>
    <section class="spec-section">
      <h4>视觉风格</h4>
      <p><strong>关键词：</strong>${escapeHtml(keywords)}</p>
      <p><strong>氛围营造：</strong></p>
      <ul>
        <li>情绪关键词：${escapeHtml(moodText)}</li>
        <li>光影效果：${escapeHtml(lighting)}</li>
      </ul>
    </section>
    <section class="spec-section">
      <h4>色彩系统</h4>
      <p><strong>主色调：</strong>${escapeHtml(colorSystem)}</p>
      <p><strong>辅助色：</strong>${escapeHtml(profile.material || "按产品材质识别")}</p>
      <p><strong>点缀色：</strong>${escapeHtml(profile.lightUse || "按灯光色温和画面氛围识别")}</p>
    </section>
    <section class="spec-section">
      <h4>字体系统</h4>
      <p><strong>标题字体：</strong>黑体（如思源黑体 Bold）</p>
      <p><strong>正文字体：</strong>等线体（如思源黑体 Regular）</p>
      <p><strong>主标题字色：</strong>#1A1A1A</p>
      <p><strong>副标题字色：</strong>#4A4A4A</p>
      <p><strong>说明文字字色：</strong>#666666</p>
    </section>
    <section class="spec-section">
      <h4>视觉语言</h4>
      <p><strong>装饰元素：</strong>${escapeHtml(decorative)}</p>
      <p><strong>图标风格：</strong>${escapeHtml(visualLanguage)}</p>
    </section>
    <section class="spec-section">
      <h4>品质要求</h4>
      <ul>
        <li>分辨率：${escapeHtml(resolutionLabel)}</li>
        <li>真实感：超写实/照片级</li>
      </ul>
    </section>
    <section class="spec-section">
      <h4>用户特殊要求（最高优先级 / 硬性约束）</h4>
      <ul>
        ${renderSpecBullets(hardItems)}
      </ul>
    </section>
  `;
}

function isMostlyEnglishPromptText(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin > 80 && latin > chinese * 3;
}

function planAllowsStyleText(plan = {}) {
  const settings = plan.settings || {};
  const mode = String(settings.similarMode || state.similarMode || "").toLowerCase();
  return Boolean(settings.styleCloneMode && ["selling", "detail"].includes(mode));
}

function chinesePromptFromShot(shot = {}, index = 0, options = {}) {
  const category = shot.category || "selling";
  const meta = shotCategoryMeta(category);
  const title = shot.title || `${meta.label} ${index + 1}`;
  const description = shot.description || meta.hint || "生成灯具电商商品图";
  return [
    `${title}：${description}`,
    "必须以上传的灯具产品图为唯一主体来源，保留真实外形、比例、材质、颜色、发光面和产品图可见安装结构。",
    "画面要商业化、干净、清晰，主体完整，光影自然，适合电商商品图或详情页使用。",
    "禁止改款、禁止融合多个灯具、禁止新增产品图里没有的零件。",
    options.allowPlannedText
      ? "需要渲染规划好的少量简体中文卖点/细节标注文字和必要指示线；不要生成英文、拼音、乱码、品牌标志、水印、价格或无关界面元素。"
      : "不要生成随机文字、英文、拼音、品牌标志、水印、价格、箭头、图标或界面元素。"
  ].join("\n");
}

function normalizeVisiblePlanPrompts(plan = {}) {
  if (!Array.isArray(plan.shots)) return plan;
  const allowPlannedText = planAllowsStyleText(plan);
  plan.shots = plan.shots.map((shot, index) => {
    if (normalizeToolKey(state.activeTool) === "product") {
      return {
        ...shot,
        prompt: productPromptWithShortLock(shot?.prompt || "", shot?.category || "")
      };
    }
    if (!isMostlyEnglishPromptText(shot?.prompt || "")) return shot;
    return {
      ...shot,
      prompt: chinesePromptFromShot(shot, index, { allowPlannedText }),
      promptRoute: {
        ...(shot.promptRoute || {}),
        warning: "模型返回了英文提示词，已自动恢复为中文可编辑提示词。"
      }
    };
  });
  return plan;
}

function renderPlan(plan) {
  normalizeVisiblePlanPrompts(plan);
  refreshPlanTextOverlayPreviews(plan);
  const profile = plan.profile || {};
  const spec = plan.designSpec || {};
  const shots = plan.shots || [];
  const analysis = plan.analysis || {};
  renderPromptAssist(plan);
  renderStyleCloneResults(plan);
  const generatedCount = shots.filter((shot) => shot.imageUrl).length;
  els.statusText.classList.remove("is-error-text");
  if (plan.empty) {
    els.statusText.textContent = "上传产品图并点击分析开始";
    els.specTitle.textContent = "生成结果";
    els.specSubtitle.textContent = "上传产品图并填写要求后点击分析产品开始";
    els.planCount.textContent = "";
    els.specBody.innerHTML = `
      <div class="result-empty-state">
        <div class="result-empty-icon">+</div>
        <p>上传产品图并填写要求<br />点击“分析产品”开始</p>
      </div>
    `;
    els.planList.innerHTML = "";
    return;
  }
  if (plan.analyzing) {
    els.statusText.textContent = "正在分析产品并制定图片大纲...";
    els.specTitle.textContent = "分析中...";
    els.specSubtitle.textContent = "正在分析产品并生成可编辑的作图规划";
    els.planCount.textContent = "";
    els.specBody.innerHTML = `
      <div class="analysis-loading-state">
        <strong>正在拆解产品特征和作图任务</strong>
        <span></span>
        <p>系统会先识别灯具类型、安装结构和卖点，再按 ${escapeHtml(imageScopeLabel())} 与张数生成独立提示词。</p>
      </div>
    `;
    els.planList.innerHTML = "";
    return;
  }
  const sourceText = analysis.source === "gemini" ? `Gemini 识别：${analysis.model}` : analysis.warning || "模型识别状态";
  const dispatch = plan.promptDispatch || analysis.promptDispatch || {};
  const dispatchText =
    dispatch.source === "gemini-dispatch"
      ? " · Gemini 已完成单张提示词调度"
      : dispatch.source === "apiyi-dispatch"
        ? " · API易已完成单张提示词调度"
        : " · 已完成单张任务调度";
  const modelText = plan.model?.label ? ` · 出图模型：${plan.model.label}` : "";
  const visualSummary = compactProfileVisualStrategy(profile);
  const recognizedText = visualSummary?.style
    ? `${profile.lampSubtype || profile.lampType || "灯具"} / ${visualSummary.style}`
    : `${profile.style || "待识别"} / ${profile.material || "待识别"} / ${profile.function || "待识别"}`;
  els.statusText.textContent = `已识别：${recognizedText} · ${sourceText}${dispatchText}${modelText}`;
  els.specTitle.textContent = "整体设计规范";
  els.specSubtitle.textContent = "所有图片遵循的统一视觉标准";
  els.planCount.textContent = generatedCount
    ? `已生成 ${generatedCount}/${shots.length} 张，按分类预览结果`
    : `共 ${shots.length} 张图片，已按作图类别分发独立提示词`;

  if (isSmallLampDetailSequencePlan(shots)) {
    els.planCount.textContent = generatedCount
      ? `已生成 ${generatedCount}/${shots.length} 张，按详情页顺序预览`
      : `共 ${shots.length} 张图片，按详情页顺序规划`;
  }
  els.specBody.innerHTML = renderOverallDesignSpec(profile, { settings: plan.settings || {} });
  els.planList.innerHTML = renderGroupedPlanItems(shots);
  wirePlanToggles();
}

function renderShotPreview(shot, index) {
  if (shot.imageUrl) {
    return `
      <button class="plan-preview is-ready" type="button" data-preview-index="${index}" title="双击放大">
        <img src="${escapeHtml(shot.imageUrl)}" alt="${escapeHtml(shot.title || `生成图 ${index + 1}`)}" loading="eager" decoding="async" />
        <span>双击放大</span>
      </button>
    `;
  }
  if (shot.status === "generating") return '<div class="plan-preview is-generating"><span>生成中</span></div>';
  if (shot.status === "failed") return '<div class="plan-preview is-failed"><span>生成失败</span></div>';
  return '<div class="plan-preview"><span>生成后预览</span></div>';
}

function renderShotActions(shot, index) {
  if (shot.status === "generating" || state.singleGenerating?.has(index)) {
    return `
      <div class="plan-result-actions">
        <span class="result-action-stack">
          <small class="credit-hint is-compact">正在生成，请稍候</small>
          <button type="button" disabled>生成中...</button>
        </span>
      </div>
    `;
  }
  const regenerateText = shot.imageUrl || shot.status === "failed" ? "重新生成" : "生成这一张";
  return `
    <div class="plan-result-actions">
      <span class="result-action-stack">
        <small class="credit-hint is-compact">${escapeHtml(singleImageCreditHintText())}</small>
        <button data-regenerate-shot="${index}" type="button">${regenerateText}</button>
      </span>
      ${shot.imageUrl ? `<button data-save-shot="${index}" type="button">保存文件</button>` : ""}
      <span class="saved-path-text">${escapeHtml(shot.savedPath || "")}</span>
    </div>
  `;
}

function qualityStats(shots = state.plan?.shots || []) {
  const generated = shots.filter((shot) => shot.imageUrl);
  const failed = shots.filter((shot) => shot.status === "failed");
  return { generated: generated.length, failed: failed.length, total: shots.length };
}

function renderBatchTools() {
  const stats = qualityStats(state.plan?.shots || []);
  if (els.styleBatchSaveButton) {
    els.styleBatchSaveButton.disabled = state.batchSaving || !stats.generated;
    els.styleBatchSaveButton.textContent = state.batchSaving ? "保存中..." : stats.generated ? `批量保存 ${stats.generated} 张` : "批量保存";
  }
  if (els.styleRetryFailedButton) {
    els.styleRetryFailedButton.disabled = !stats.failed || state.busy || state.generating;
    els.styleRetryFailedButton.textContent = stats.failed ? `重新生成失败项 ${stats.failed} 张` : "重新生成失败项";
  }
  if (els.styleRetryCostText) {
    els.styleRetryCostText.hidden = !stats.failed;
    els.styleRetryCostText.textContent = failedRetryCreditHintText();
  }
  if (els.styleQualitySummary) {
    els.styleQualitySummary.textContent = "";
    els.styleQualitySummary.hidden = true;
  }
}

function renderPlanItem(shot, index) {
  const category = shotCategoryMeta(shot.category);
  const displayType = shotDisplayTypeLabel(shot, index);
  return `
    <article class="plan-item ${shot.imageUrl ? "has-generated-image" : ""}">
      ${renderShotPreview(shot, index)}
      <div class="plan-index">${index + 1}</div>
      <div class="plan-copy">
        <h4>${escapeHtml(shot.title || `图片 ${index + 1}`)} <span>↕</span></h4>
        <p>${escapeHtml(displayType)}</p>
        <small>${escapeHtml(category.label)} · ${shot.imageUrl ? "双击图片放大预览" : shot.status === "generating" ? "正在生成，完成后会自动显示" : escapeHtml(category.hint)}</small>
        ${shot.status === "failed" && shot.error ? `<small class="is-error-text">${escapeHtml(friendlyGenerationErrorMessage(shot.error))}</small>` : ""}
        ${renderShotActions(shot, index)}
      </div>
      <button class="plan-toggle" type="button" aria-expanded="false" aria-label="展开完整提示词">↕</button>
      <div class="plan-prompt" hidden>
        <label>
          <span>可修改这张图的画面提示词（固定约束已隐藏）</span>
          <textarea data-shot-prompt="${index}" rows="6">${escapeHtml(shot.prompt || "")}</textarea>
        </label>
      </div>
    </article>
  `;
}

function renderGroupedPlanItems(shots) {
  if (isSmallLampDetailSequencePlan(shots)) return renderSequentialPlanItems(shots);
  const indexedShots = shots.map((shot, index) => ({ ...shot, displayIndex: index + 1 }));
  return ["main", "selling", "function", "scene", "detail", "real"]
    .map((category) => {
      const groupShots = indexedShots.filter((shot) => shot.category === category);
      if (!groupShots.length) return "";
      const meta = categoryMeta(category);
      const readyCount = groupShots.filter((shot) => shot.imageUrl).length;
      return `
        <section class="plan-group">
          <div class="plan-group-head">
            <strong>${escapeHtml(meta.label)}</strong>
        <span>${readyCount ? `已生成 ${readyCount}/${groupShots.length}` : `${groupShots.length} 张 · ${escapeHtml(meta.hint)}`}</span>
          </div>
          <div class="plan-group-list">
            ${groupShots.map((shot) => renderPlanItem(shot, shot.displayIndex - 1)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function isSmallLampDetailSequencePlan(shots = []) {
  return Array.isArray(shots) && shots.some((shot) => {
    const route = shot?.promptRoute || {};
    return route.source === "small-lamp-detail-strategy" || Boolean(route.sequenceSlot);
  });
}

function renderSequentialPlanItems(shots = []) {
  const readyCount = shots.filter((shot) => shot.imageUrl).length;
  return `
    <section class="plan-group plan-group-sequential">
      <div class="plan-group-head">
        <strong>详情页套图</strong>
        <span>${readyCount ? `已生成 ${readyCount}/${shots.length}` : `${shots.length} 张 · 按页面叙事顺序预览`}</span>
      </div>
      <div class="plan-group-list">
        ${shots.map((shot, index) => renderPlanItem(shot, index)).join("")}
      </div>
    </section>
  `;
}

function wirePlanToggles() {
  els.planList.querySelectorAll(".plan-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest(".plan-item");
      const prompt = item?.querySelector(".plan-prompt");
      if (!item || !prompt) return;
      const open = !item.classList.contains("is-open");
      item.classList.toggle("is-open", open);
      prompt.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });
  });
  els.planList.querySelectorAll("[data-shot-prompt]").forEach((editor) => {
    editor.addEventListener("input", () => {
      const shot = state.plan?.shots?.[Number(editor.dataset.shotPrompt)];
      if (shot) shot.prompt = editor.value;
    });
  });
  wirePlanImageActions();
}

function wirePlanImageActions() {
  els.planList.querySelectorAll("[data-preview-index]").forEach((button) => {
    button.addEventListener("dblclick", () => {
      const shot = state.plan?.shots?.[Number(button.dataset.previewIndex)];
      if (shot?.imageUrl) openImageLightbox(shot);
    });
  });
  els.planList.querySelectorAll("[data-regenerate-shot]").forEach((button) => {
    button.addEventListener("click", () => regenerateShot(Number(button.dataset.regenerateShot), button));
  });
  els.planList.querySelectorAll("[data-save-shot]").forEach((button) => {
    button.addEventListener("click", () => saveGeneratedImage(Number(button.dataset.saveShot), button));
  });
}

function openImageLightbox(shot, options = {}) {
  els.imageLightboxTitle.textContent = shot.title || "生成结果预览";
  els.imageLightboxImage.src = shot.imageUrl;
  state.lightboxStyleIndex = Number.isFinite(Number(options.styleIndex)) ? Number(options.styleIndex) : -1;
  state.lightboxTextDragStart = null;
  const canEditText =
    state.lightboxStyleIndex >= 0 &&
    state.activeTool === "style" &&
    styleResultTextEditable() &&
    Boolean(state.plan?.shots?.[state.lightboxStyleIndex]?.imageUrl);
  if (els.imageLightboxTextEditor) {
    els.imageLightboxTextEditor.hidden = !canEditText;
  }
  if (els.imageLightboxTextInput) {
    const editShot = canEditText ? state.plan?.shots?.[state.lightboxStyleIndex] : null;
    els.imageLightboxTextInput.value = editShot?.textRevisionPrompt || "";
    els.imageLightboxTextInput.placeholder = styleTextEditPlaceholder();
  }
  state.lightboxTextTarget = canEditText ? state.plan?.shots?.[state.lightboxStyleIndex]?.textRevisionRegion || null : null;
  updateLightboxTextHint();
  if (els.imageLightboxTextCost) {
    els.imageLightboxTextCost.textContent = singleImageCreditHintText();
  }
  if (els.imageLightboxTextButton && canEditText) {
    els.imageLightboxTextButton.textContent = "应用文字修改";
  }
  renderLightboxTextTarget();
  els.imageLightbox.hidden = false;
  if (options.editText) {
    window.requestAnimationFrame(() => els.imageLightboxTextInput?.focus());
  }
}

function closeImageLightbox() {
  els.imageLightbox.hidden = true;
  els.imageLightboxImage.removeAttribute("src");
  state.lightboxStyleIndex = -1;
  state.lightboxTextTarget = null;
  state.lightboxTextDragStart = null;
  if (els.imageLightboxTextEditor) els.imageLightboxTextEditor.hidden = true;
  if (els.imageLightboxTextInput) els.imageLightboxTextInput.value = "";
  renderLightboxTextTarget();
}

function normalizedLightboxTextRegion(region = null) {
  if (!region) return null;
  const x = Number(region.xPercent);
  const y = Number(region.yPercent);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Number(region.widthPercent);
  const height = Number(region.heightPercent);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const safeWidth = Math.round(Math.min(100, Math.max(1, width)) * 10) / 10;
    const safeHeight = Math.round(Math.min(100, Math.max(1, height)) * 10) / 10;
    const safeX = Math.round(Math.min(100 - safeWidth, Math.max(0, x)) * 10) / 10;
    const safeY = Math.round(Math.min(100 - safeHeight, Math.max(0, y)) * 10) / 10;
    const centerX = Number(region.centerXPercent ?? safeX + safeWidth / 2);
    const centerY = Number(region.centerYPercent ?? safeY + safeHeight / 2);
    return {
      xPercent: safeX,
      yPercent: safeY,
      widthPercent: safeWidth,
      heightPercent: safeHeight,
      centerXPercent: Math.round(Math.min(100, Math.max(0, Number.isFinite(centerX) ? centerX : safeX + safeWidth / 2)) * 10) / 10,
      centerYPercent: Math.round(Math.min(100, Math.max(0, Number.isFinite(centerY) ? centerY : safeY + safeHeight / 2)) * 10) / 10
    };
  }
  const boxWidth = 12;
  const boxHeight = 8;
  return {
    xPercent: Math.round(Math.min(100 - boxWidth, Math.max(0, x - boxWidth / 2)) * 10) / 10,
    yPercent: Math.round(Math.min(100 - boxHeight, Math.max(0, y - boxHeight / 2)) * 10) / 10,
    widthPercent: boxWidth,
    heightPercent: boxHeight,
    centerXPercent: Math.round(x * 10) / 10,
    centerYPercent: Math.round(y * 10) / 10
  };
}

function lightboxTextRegionSummary(region = state.lightboxTextTarget) {
  const target = normalizedLightboxTextRegion(region);
  if (!target) return "";
  return `已框选文字区域：左 ${target.xPercent}%，上 ${target.yPercent}%，宽 ${target.widthPercent}%，高 ${target.heightPercent}%。`;
}

function updateLightboxTextHint() {
  if (!els.imageLightboxTextHint) return;
  if (state.lightboxStyleIndex < 0 || els.imageLightboxTextEditor?.hidden) {
    els.imageLightboxTextHint.textContent = "";
    return;
  }
  els.imageLightboxTextHint.textContent =
    lightboxTextRegionSummary() || "先在大图上拖拽框选要改的文字区域，再输入替换内容。";
}

function renderLightboxTextTarget() {
  if (!els.imageLightboxTarget) return;
  const target = normalizedLightboxTextRegion(state.lightboxTextTarget);
  if (!target || state.lightboxStyleIndex < 0 || els.imageLightboxTextEditor?.hidden) {
    els.imageLightboxTarget.hidden = true;
    return;
  }
  els.imageLightboxTarget.hidden = false;
  els.imageLightboxTarget.style.left = `${target.xPercent}%`;
  els.imageLightboxTarget.style.top = `${target.yPercent}%`;
  els.imageLightboxTarget.style.width = `${target.widthPercent}%`;
  els.imageLightboxTarget.style.height = `${target.heightPercent}%`;
}

function lightboxPointFromEvent(event) {
  if (state.lightboxStyleIndex < 0 || els.imageLightboxTextEditor?.hidden) return;
  const rect = els.imageLightboxImage.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const xPercent = Math.round(Math.min(100, Math.max(0, (x / rect.width) * 100)) * 10) / 10;
  const yPercent = Math.round(Math.min(100, Math.max(0, (y / rect.height) * 100)) * 10) / 10;
  return { xPercent, yPercent };
}

function lightboxSelectionFromPoints(start, end) {
  if (!start || !end) return null;
  let left = Math.min(start.xPercent, end.xPercent);
  let top = Math.min(start.yPercent, end.yPercent);
  let width = Math.abs(end.xPercent - start.xPercent);
  let height = Math.abs(end.yPercent - start.yPercent);
  if (width < 2.5 && height < 2.5) {
    width = 12;
    height = 8;
    left = start.xPercent - width / 2;
    top = start.yPercent - height / 2;
  }
  left = Math.min(100 - width, Math.max(0, left));
  top = Math.min(100 - height, Math.max(0, top));
  return normalizedLightboxTextRegion({
    xPercent: left,
    yPercent: top,
    widthPercent: width,
    heightPercent: height,
    centerXPercent: left + width / 2,
    centerYPercent: top + height / 2
  });
}

function setLightboxTextRegion(region) {
  const target = normalizedLightboxTextRegion(region);
  if (!target) return;
  state.lightboxTextTarget = target;
  const shot = state.plan?.shots?.[state.lightboxStyleIndex];
  if (shot) shot.textRevisionRegion = state.lightboxTextTarget;
  updateLightboxTextHint();
  renderLightboxTextTarget();
}

function handleLightboxSelectionStart(event) {
  if (event.button !== 0) return;
  const point = lightboxPointFromEvent(event);
  if (!point) return;
  event.preventDefault();
  state.lightboxTextDragStart = point;
  els.imageLightboxImageWrap?.classList.add("is-selecting");
  els.imageLightboxImageWrap?.setPointerCapture?.(event.pointerId);
  setLightboxTextRegion(lightboxSelectionFromPoints(point, point));
}

function handleLightboxSelectionMove(event) {
  if (!state.lightboxTextDragStart) return;
  const point = lightboxPointFromEvent(event);
  if (!point) return;
  event.preventDefault();
  setLightboxTextRegion(lightboxSelectionFromPoints(state.lightboxTextDragStart, point));
}

function handleLightboxSelectionEnd(event) {
  if (!state.lightboxTextDragStart) return;
  const point = lightboxPointFromEvent(event) || state.lightboxTextDragStart;
  event.preventDefault();
  setLightboxTextRegion(lightboxSelectionFromPoints(state.lightboxTextDragStart, point));
  state.lightboxTextDragStart = null;
  els.imageLightboxImageWrap?.classList.remove("is-selecting");
  els.imageLightboxImageWrap?.releasePointerCapture?.(event.pointerId);
  els.imageLightboxTextInput?.focus();
}

function handleLightboxSelectionCancel(event) {
  state.lightboxTextDragStart = null;
  els.imageLightboxImageWrap?.classList.remove("is-selecting");
  if (event?.pointerId !== undefined) {
    els.imageLightboxImageWrap?.releasePointerCapture?.(event.pointerId);
  }
}

function workspaceHistoryKey(tool = state.activeTool) {
  if (tool === "style") return "style";
  if (tool === "templates") return "templates";
  return "product";
}

function workspaceHistoryLabel(key = workspaceHistoryKey()) {
  if (key === "style") return "风格复刻";
  if (key === "templates") return "拼图中心";
  return "灯具商品图";
}

function normalizeLegacyChineseText(text = "") {
  if (typeof text !== "string" || !text) return text;
  const legacyStyle = "\u690b\u5ea2\u724c\u6838\u6f36\u5d76\u9352";
  const legacyViewLarge = "\u93cc\u30e7\u6e45\u6f9a\u5ba7\u6d58";
  const legacyView = "\u93cc\u30e7\u6e45";
  return text
    .replaceAll(legacyStyle, "风格复刻")
    .replaceAll(legacyViewLarge, "查看大图")
    .replaceAll(legacyView, "查看");
}

function ensureGenerationHistory() {
  if (!state.generationHistory || Array.isArray(state.generationHistory)) {
    state.generationHistory = { product: [], style: [], templates: [] };
  }
  ["product", "style", "templates"].forEach((key) => {
    if (!Array.isArray(state.generationHistory[key])) state.generationHistory[key] = [];
    state.generationHistory[key] = state.generationHistory[key]
      .filter((item) => item?.imageUrl)
      .map((item) => ({
        ...item,
        source: normalizeLegacyChineseText(item.source),
        title: normalizeLegacyChineseText(item.title),
        categoryLabel: normalizeLegacyChineseText(item.categoryLabel)
      }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, generationHistoryLimit(key));
  });
}

function workspaceHistory(key = workspaceHistoryKey()) {
  ensureGenerationHistory();
  return state.generationHistory[key] || state.generationHistory.product;
}

function applyGenerationHistory(history = {}) {
  state.generationHistory = {
    product: Array.isArray(history.product) ? history.product : [],
    style: Array.isArray(history.style) ? history.style : [],
    templates: Array.isArray(history.templates) ? history.templates : []
  };
  ensureGenerationHistory();
  renderGenerationHistory();
}

async function loadAccountGenerationHistory() {
  if (!state.token || !state.user) return;
  try {
    const payload = await api("/api/account/generation-history");
    applyGenerationHistory(payload.history || {});
  } catch {
    ensureGenerationHistory();
    renderGenerationHistory();
  }
}

function currentGenerationSource() {
  return generationSourceForTool(state.activeTool);
}

function generationSourceForTool(tool = state.activeTool) {
  if (tool === "style") return "风格复刻";
  if (tool === "templates") return "拼图中心";
  return state.imageScope === "main" ? "商品主图" : "详情图组";
}

function shortHash(text = "") {
  const value = String(text || "");
  if (!value) return "empty";
  const step = Math.max(1, Math.floor(value.length / 2048));
  let hash = 0;
  for (let index = 0; index < value.length; index += step) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `${value.length}-${hash.toString(36)}`;
}

function generatedShotKey(shot, source, index = 0) {
  return [source, shot.id || `shot-${index + 1}`, shot.category || "image", shortHash(shot.imageUrl)].join(":");
}

function categoryLabelForHistory(category) {
  if (category === "collage") return "拼图";
  return categoryMeta(category).label;
}

function rememberGeneratedShot(shot, source = currentGenerationSource(), index = 0, workspaceKey = workspaceHistoryKey()) {
  if (!shot?.imageUrl) return;
  const history = workspaceHistory(workspaceKey);
  const key = generatedShotKey(shot, source, index);
  const existing = history.find((item) => item.key === key);
  const item = {
    key,
    workspaceKey,
    source,
    title: shot.title || `${source} ${index + 1}`,
    category: shot.category || "image",
    categoryLabel: categoryLabelForHistory(shot.category),
    imageUrl: shot.imageUrl,
    prompt: shot.prompt || "",
    savedPath: shot.savedPath || "",
    createdAt: existing?.createdAt || Date.now()
  };
  if (existing) {
    Object.assign(existing, item);
  } else {
    history.unshift(item);
  }
  state.generationHistory[workspaceKey] = history
    .filter((entry) => entry?.imageUrl)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, generationHistoryLimit(workspaceKey));
  renderGenerationHistory();
}

function rememberGeneratedShots(shots = [], source = currentGenerationSource(), workspaceKey = workspaceHistoryKey()) {
  shots.forEach((shot, index) => rememberGeneratedShot(shot, source, index, workspaceKey));
}

function updateHistorySavedPath(imageUrl, savedPath) {
  if (!imageUrl || !savedPath) return;
  ensureGenerationHistory();
  Object.values(state.generationHistory).forEach((history) => {
    history.forEach((item) => {
      if (item.imageUrl === imageUrl) item.savedPath = savedPath;
    });
  });
  renderGenerationHistory();
}

function activeSavePathInput() {
  return savePathInputForWorkspace(workspaceSaveKey());
}

function workspaceSaveKey(tool = state.activeTool) {
  return workspaceSettingKey(tool);
}

function savePathInputForWorkspace(key = workspaceSaveKey()) {
  if (key === "style") return els.styleSavePathInput;
  if (key === "templates") return els.collageSavePathInput;
  return els.savePathInput;
}

function workspaceSaveLabel(key = workspaceSaveKey()) {
  if (key === "style") return "风格复刻";
  if (key === "templates") return "拼图中心";
  return "灯具商品图";
}

function workspaceSaveDirectory(key = workspaceSaveKey()) {
  if (!state.saveDirectories || typeof state.saveDirectories !== "object") {
    state.saveDirectories = { product: legacySaveDirectory, style: legacySaveDirectory, templates: legacySaveDirectory };
  }
  return state.saveDirectories[key] || legacySaveDirectory;
}

function setWorkspaceSaveDirectory(directory, key = workspaceSaveKey(), { markChosen = true } = {}) {
  const next = String(directory || "").trim();
  if (!next) return "";
  state.saveDirectories[key] = next;
  if (!state.saveDirectoryChosen || typeof state.saveDirectoryChosen !== "object") state.saveDirectoryChosen = {};
  if (markChosen) state.saveDirectoryChosen[key] = true;
  if (key === workspaceSaveKey()) state.saveDirectory = next;
  localStorage.setItem(`lamp_save_directory_${key}`, next);
  if (markChosen) localStorage.setItem(`lamp_save_directory_chosen_${key}`, "1");
  localStorage.setItem("lamp_save_directory", next);
  const input = savePathInputForWorkspace(key);
  if (input) input.value = next;
  return next;
}

function syncSaveDirectory(directory, key = workspaceSaveKey()) {
  return setWorkspaceSaveDirectory(directory, key);
}

function syncSaveDirectoryInputs() {
  if (els.savePathInput) els.savePathInput.value = workspaceSaveDirectory("product");
  if (els.styleSavePathInput) els.styleSavePathInput.value = workspaceSaveDirectory("style");
  if (els.collageSavePathInput) els.collageSavePathInput.value = workspaceSingleSaveDirectory("templates");
  state.saveDirectory = workspaceSaveDirectory(workspaceSaveKey());
}

function workspaceSingleSaveDirectory(key = workspaceSaveKey()) {
  if (!state.singleSaveDirectories || typeof state.singleSaveDirectories !== "object") {
    state.singleSaveDirectories = { product: workspaceSaveDirectory("product"), style: workspaceSaveDirectory("style"), templates: workspaceSaveDirectory("templates") };
  }
  return state.singleSaveDirectories[key] || workspaceSaveDirectory(key);
}

function setWorkspaceSingleSaveDirectory(directory, key = workspaceSaveKey()) {
  const next = String(directory || "").trim();
  if (!next) return "";
  if (!state.singleSaveDirectories || typeof state.singleSaveDirectories !== "object") state.singleSaveDirectories = {};
  state.singleSaveDirectories[key] = next;
  localStorage.setItem(`lamp_single_save_directory_${key}`, next);
  if (key === "templates" && els.collageSavePathInput) els.collageSavePathInput.value = next;
  return next;
}

function safeFilePartClient(value, fallback = "image") {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return cleaned || fallback;
}

function extensionFromMimeType(mimeType = "image/png") {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("svg")) return "svg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  return "png";
}

function generatedImageFilename({ title, category, extension = "png" }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}_${safeFilePartClient(category, "image")}_${safeFilePartClient(title, "result")}.${extension}`;
}

async function imageBlobFromUrl(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`读取图片失败：HTTP ${response.status}`);
  const blob = await response.blob();
  return { blob, extension: extensionFromMimeType(blob.type) };
}

function canUseBrowserSaveFilePicker() {
  return Boolean(window.isSecureContext && typeof window.showSaveFilePicker === "function");
}

function canUseBrowserDirectoryPicker() {
  return Boolean(window.isSecureContext && typeof window.showDirectoryPicker === "function");
}

function browserSaveUnsupportedMessage() {
  if (!window.isSecureContext) {
    return "当前访问方式不支持本机另存为窗口。请使用 HTTPS 测试地址（例如 https://lamps.local:4192）重新打开后再保存。";
  }
  return "当前浏览器不支持本机另存为窗口。请使用新版 Chrome 或 Edge 访问 HTTPS 测试地址。";
}

async function ensureDirectoryWritePermission(directoryHandle) {
  if (!directoryHandle) return false;
  if (typeof directoryHandle.queryPermission === "function") {
    const current = await directoryHandle.queryPermission({ mode: "readwrite" });
    if (current === "granted") return true;
  }
  if (typeof directoryHandle.requestPermission === "function") {
    return (await directoryHandle.requestPermission({ mode: "readwrite" })) === "granted";
  }
  return true;
}

function openSaveHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lamps-studio-save-handles", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("directories");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机保存授权缓存"));
  });
}

async function rememberDirectoryHandle(key, directoryHandle) {
  if (!directoryHandle || !window.isSecureContext || !window.indexedDB) return;
  const db = await openSaveHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("directories", "readwrite");
    tx.objectStore("directories").put(directoryHandle, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("保存本机文件夹授权失败"));
  });
  db.close();
}

async function readRememberedDirectoryHandle(key) {
  if (!window.isSecureContext || !window.indexedDB) return null;
  const db = await openSaveHandleDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction("directories", "readonly");
    const request = tx.objectStore("directories").get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("读取本机文件夹授权失败"));
  }).catch(() => null);
  db.close();
  return handle;
}

async function saveImageWithBrowserFilePicker({ imageUrl, title, category, workspaceKey }) {
  const filename = generatedImageFilename({ title, category, extension: "png" });
  const pickerOptions = {
    id: `lamps-studio-${workspaceKey}`,
    suggestedName: filename,
    startIn: "desktop",
    types: [
      {
        description: "图片文件",
        accept: {
          "image/png": [".png"],
          "image/svg+xml": [".svg"],
          "image/jpeg": [".jpg", ".jpeg"],
          "image/webp": [".webp"],
          "image/gif": [".gif"]
        }
      }
    ]
  };
  const fileHandle = await window.showSaveFilePicker(pickerOptions);
  const { blob } = await imageBlobFromUrl(imageUrl);
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { filePath: `已保存：${fileHandle.name || filename}`, displayPath: fileHandle.name || filename };
}

async function downloadImageToClient({ imageUrl, title, category }) {
  const { blob, extension } = await imageBlobFromUrl(imageUrl);
  const filename = generatedImageFilename({ title, category, extension });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  return { filePath: `已下载到本机：${filename}`, displayPath: filename, downloaded: true };
}

async function saveImageToDirectoryHandle({ directoryHandle, imageUrl, title, category }) {
  const canWriteDirectory = await ensureDirectoryWritePermission(directoryHandle).catch(() => false);
  if (!canWriteDirectory) throw new Error("没有获得保存文件夹写入权限，请重新选择保存路径。");
  const { blob, extension } = await imageBlobFromUrl(imageUrl);
  const filename = generatedImageFilename({ title, category, extension });
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  const filePath = `${directoryHandle.name || "Selected folder"}\\${filename}`;
  return { filePath, displayPath: filePath };
}

async function workspaceDirectoryHandle(workspaceKey) {
  let directoryHandle = state.saveDirectoryHandles?.[workspaceKey] || null;
  if (!directoryHandle) {
    directoryHandle = await readRememberedDirectoryHandle(workspaceKey);
    if (directoryHandle) {
      if (!state.saveDirectoryHandles || typeof state.saveDirectoryHandles !== "object") state.saveDirectoryHandles = {};
      state.saveDirectoryHandles[workspaceKey] = directoryHandle;
    }
  }
  return directoryHandle;
}

async function saveSingleImageWithPicker({ imageUrl, title, category, workspaceKey = workspaceSaveKey(), button = null }) {
  if (canUseBrowserDirectoryPicker()) {
    const directoryHandle = await workspaceDirectoryHandle(workspaceKey);
    if (directoryHandle) {
      return saveImageToDirectoryHandle({ directoryHandle, imageUrl, title, category });
    }
  }
  if (canUseBrowserSaveFilePicker()) {
    try {
      return await saveImageWithBrowserFilePicker({ imageUrl, title, category, workspaceKey });
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw error;
    }
  }
  return downloadImageToClient({ imageUrl, title, category });
}

async function chooseWorkspaceSaveDirectory(key = workspaceSaveKey(), button = null) {
  {
    const originalText = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.textContent = "选择中...";
    }
    try {
      if (!canUseBrowserDirectoryPicker()) {
        const message = "当前访问方式不能直接选择本机文件夹；保存时会下载到当前用户电脑。";
        if (els.statusText) {
          els.statusText.classList.remove("is-error-text");
          els.statusText.textContent = "当前访问方式不支持选择本地文件夹；保存时会使用浏览器保存窗口或下载。";
        }
        if (els.statusText) els.statusText.textContent = message;
        return "";
      }
      const directoryHandle = await window.showDirectoryPicker({
        id: `lamps-studio-${key}`,
        mode: "readwrite"
      });
      if (!state.saveDirectoryHandles || typeof state.saveDirectoryHandles !== "object") state.saveDirectoryHandles = {};
      state.saveDirectoryHandles[key] = directoryHandle;
      await rememberDirectoryHandle(key, directoryHandle).catch(() => {});
      setWorkspaceSaveDirectory(directoryHandle.name || "Browser selected folder", key);
      if (els.statusText) {
        els.statusText.classList.remove("is-error-text");
        els.statusText.textContent = `${workspaceSaveLabel(key)}保存路径已设为本机文件夹：${directoryHandle.name || ""}`;
      }
      return directoryHandle.name || "";
    } catch (error) {
      if (error?.name !== "AbortError" && els.statusText) {
        els.statusText.textContent = error.message || "选择保存路径失败";
        els.statusText.classList.add("is-error-text");
      }
      return "";
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "选择中...";
  }
  try {
    const payload = await api("#client-directory-picker-disabled", {
      method: "POST",
      body: JSON.stringify({
        directory: workspaceSaveDirectory(key),
        workspace: key
      })
    });
    const directory = String(payload.directory || "").trim();
    if (!directory) return "";
    setWorkspaceSaveDirectory(directory, key);
    if (els.statusText) {
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = `${workspaceSaveLabel(key)}保存路径已设置：${directory}`;
    }
    return directory;
  } catch (error) {
    const fallback = window.prompt(`${workspaceSaveLabel(key)}保存路径`, workspaceSaveDirectory(key));
    const directory = String(fallback || "").trim();
    if (!directory) {
      if (els.statusText) {
        els.statusText.classList.remove("is-error-text");
        els.statusText.textContent = "已取消选择保存路径。";
      }
      return "";
    }
    setWorkspaceSaveDirectory(directory, key);
    if (els.statusText) {
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = `${workspaceSaveLabel(key)}保存路径已设置：${directory}`;
    }
    return directory;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function ensureWorkspaceSaveDirectory(key = workspaceSaveKey(), button = null) {
  const directory = workspaceSaveDirectory(key);
  const hasChosenPath = Boolean(state.saveDirectoryChosen?.[key]);
  if (directory && hasChosenPath) return directory;
  return chooseWorkspaceSaveDirectory(key, button);
}

function renderGenerationHistory() {
  if (!els.generationHistoryPanel || !els.generationHistoryList) return;
  const shouldHide = !state.token || state.activeTool === "admin" || (state.user?.role === "admin" && state.adminView === "admin");
  els.generationHistoryPanel.hidden = shouldHide;
  if (shouldHide) return;

  const key = workspaceHistoryKey();
  const label = workspaceHistoryLabel(key);
  const history = workspaceHistory(key);
  const count = history.length;
  const limit = generationHistoryLimit(key);
  if (els.generationHistoryTitle) els.generationHistoryTitle.textContent = `${label}生成记录`;
  if (els.clearGenerationHistory) els.clearGenerationHistory.textContent = "刷新记录";
  if (els.generationHistorySummary) {
    els.generationHistorySummary.textContent = count
      ? `${label} 显示当前账号最新 ${count}/${limit} 条记录，刷新页面后会自动恢复。`
      : `${label} 当前还没有生成记录；生成成功后会按账号保留最新 ${limit} 条。`;
  }
  if (!count) {
    els.generationHistoryList.innerHTML = `
      <div class="generation-history-empty">
        <strong>${escapeHtml(label)}还没有生成记录</strong>
        <span>这个区域只显示当前账号在本工作区做过的图，刷新页面也会自动恢复。</span>
      </div>
    `;
    return;
  }

  els.generationHistoryList.innerHTML = history
    .map(
      (item, index) => `
        <article class="generation-history-card">
          <button class="generation-history-image" data-history-view="${index}" type="button" title="查看大图">
            <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />
          </button>
          <div class="generation-history-copy">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.source)} · ${escapeHtml(item.categoryLabel)} · ${new Date(item.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })}</span>
            </div>
            <div class="generation-history-actions">
              <button data-history-view="${index}" type="button">查看</button>
              <button data-history-save="${index}" type="button">保存</button>
            </div>
            ${item.savedPath ? `<small>${escapeHtml(item.savedPath)}</small>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

async function saveHistoryImage(index, button) {
  const item = workspaceHistory()[index];
  if (!item?.imageUrl) return;
  const workspaceKey = item.workspaceKey || workspaceSaveKey();
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "保存中...";
  }
  try {
    const payload = await saveSingleImageWithPicker({
      workspaceKey,
      button,
      imageUrl: item.imageUrl,
      title: item.title,
      category: item.category || "image"
    });
    if (!payload) {
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = "已取消保存。";
      return;
    }
    item.savedPath = payload.filePath;
    updateHistorySavedPath(item.imageUrl, payload.filePath);
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = `已保存：${payload.filePath}`;
  } catch (error) {
    els.statusText.textContent = error.message;
    els.statusText.classList.add("is-error-text");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
    renderGenerationHistory();
  }
}

async function saveGeneratedImage(index, button) {
  const shot = state.plan?.shots?.[index];
  if (!shot?.imageUrl) return;
  const workspaceKey = workspaceSaveKey();
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "保存中...";
  try {
    const payload = await saveSingleImageWithPicker({
      workspaceKey,
      button,
      imageUrl: shot.imageUrl,
      title: shot.title || `生成图 ${index + 1}`,
      category: shot.category || "image"
    });
    if (!payload) {
      els.statusText.classList.remove("is-error-text");
      els.statusText.textContent = "已取消保存。";
      return;
    }
    shot.savedPath = payload.filePath;
    updateHistorySavedPath(shot.imageUrl, payload.filePath);
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = `已保存：${payload.filePath}`;
    if (state.activeTool === "style") {
      renderStyleClonePage();
    } else {
      renderPlan(state.plan);
    }
  } catch (error) {
    els.statusText.textContent = error.message;
    els.statusText.classList.add("is-error-text");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function saveGeneratedImagesInBrowser({ images, workspaceKey }) {
  if (!canUseBrowserDirectoryPicker()) {
    const saved = [];
    const failed = [];
    for (const item of images) {
      try {
        const result = await downloadImageToClient({
          imageUrl: item.imageUrl,
          title: item.title || `image ${Number(item.index || 0) + 1}`,
          category: item.category || "image"
        });
        saved.push({ index: Number(item.index || saved.length), filePath: result.filePath });
        await new Promise((resolve) => setTimeout(resolve, 160));
      } catch (error) {
        failed.push({
          index: Number(item.index || failed.length),
          error: error instanceof Error ? error.message : "下载失败"
        });
      }
    }
    return {
      saved,
      failed,
      directory: "当前用户浏览器下载目录",
      downloaded: true
    };
  }
  let directoryHandle = state.saveDirectoryHandles?.[workspaceKey] || null;
  if (!directoryHandle) {
    directoryHandle = await readRememberedDirectoryHandle(workspaceKey);
    if (directoryHandle) {
      if (!state.saveDirectoryHandles || typeof state.saveDirectoryHandles !== "object") state.saveDirectoryHandles = {};
      state.saveDirectoryHandles[workspaceKey] = directoryHandle;
    }
  }
  if (!directoryHandle) {
    await chooseWorkspaceSaveDirectory(workspaceKey);
    directoryHandle = state.saveDirectoryHandles?.[workspaceKey] || null;
  }
  if (!directoryHandle) return { saved: [], failed: [], directory: "", canceled: true };
  const canWriteDirectory = await ensureDirectoryWritePermission(directoryHandle).catch(() => false);
  if (!canWriteDirectory) throw new Error("没有获得保存文件夹写入权限，请重新选择保存路径。");
  const saved = [];
  const failed = [];
  for (const item of images) {
    try {
      const result = await saveImageToDirectoryHandle({
        directoryHandle,
        imageUrl: item.imageUrl,
        title: item.title || `image ${Number(item.index || 0) + 1}`,
        category: item.category || "image"
      });
      saved.push({ index: Number(item.index || saved.length), filePath: result.filePath });
    } catch (error) {
      failed.push({
        index: Number(item.index || failed.length),
        error: error instanceof Error ? error.message : "保存失败"
      });
    }
  }
  return {
    saved,
    failed,
    directory: directoryHandle.name || "Selected folder"
  };
}

async function saveAllGeneratedImages() {
  const tool = normalizeToolKey(state.activeTool);
  const runtime = workspaceRuntime(tool);
  const plan = getWorkspacePlan(tool) || state.plan;
  const images = (plan?.shots || [])
    .map((shot, index) => ({
      index,
      imageUrl: shot.imageUrl,
      title: shot.title || `生成图 ${index + 1}`,
      category: shot.category || "image"
    }))
    .filter((item) => item.imageUrl);
  if (!images.length || runtime.batchSaving) return;
  const workspaceKey = workspaceSaveKey();
  const directoryInput = savePathInputForWorkspace(workspaceKey);
  const directory = setWorkspaceSaveDirectory(directoryInput?.value.trim() || workspaceSaveDirectory(workspaceKey), workspaceKey, { markChosen: false });
  runtime.batchSaving = true;
  renderBatchTools();
  try {
    const payload = await saveGeneratedImagesInBrowser({ images, workspaceKey });
    if (payload.canceled) {
      setWorkspaceStatus("已取消选择保存文件夹。", { tool });
      return;
    }
    (payload.saved || []).forEach((item) => {
      const shot = plan?.shots?.[Number(item.index)];
      if (shot) {
        shot.savedPath = item.filePath;
        updateHistorySavedPath(shot.imageUrl, item.filePath);
      }
    });
    setWorkspacePlan(plan, tool);
    if (tool === state.activeTool) renderPlan(plan);
    setWorkspaceStatus(`已批量保存 ${(payload.saved || []).length} 张到：${payload.directory || directory}`, { tool });
  } catch (error) {
    setWorkspaceStatus(error.message, { tool, isError: true });
  } finally {
    runtime.batchSaving = false;
    renderBatchTools();
  }
}

async function retryFailedShots() {
  const failed = (state.plan?.shots || [])
    .map((shot, index) => ({ shot, index }))
    .filter((item) => item.shot.status === "failed");
  if (!failed.length || state.busy || state.generating) return;
  for (const item of failed) {
    const button = els.planList.querySelector(`[data-regenerate-shot="${item.index}"]`);
    await regenerateShot(item.index, button, { skipConfirm: true });
  }
}

function promptStyleResultTextEdit(index, button) {
  if (!styleResultTextEditable()) {
    els.statusText.textContent = "只有相似卖点/功能图和相似细节图支持框选改字。";
    els.statusText.classList.add("is-error-text");
    return;
  }
  const shot = state.plan?.shots?.[index];
  if (!shot?.imageUrl) return;
  openImageLightbox(shot, { styleIndex: index, editText: true });
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = "在大图上拖拽框选要改的文字区域，再输入要替换成什么。";
}

async function editStyleResultText(index, button) {
  if (!styleResultTextEditable()) {
    els.statusText.textContent = "只有相似卖点/功能图和相似细节图支持框选修改生成图文字。";
    els.statusText.classList.add("is-error-text");
    return;
  }
  const shot = state.plan?.shots?.[index];
  if (!shot?.imageUrl) return;
  const textEditPrompt = String(shot.textRevisionPrompt || "").trim();
  if (!textEditPrompt) {
    els.statusText.textContent = "请先填写要把生成图里的文字改成什么。";
    els.statusText.classList.add("is-error-text");
    return;
  }
  const selectedTextRegion = normalizedLightboxTextRegion(shot.textRevisionRegion);
  if (!selectedTextRegion) {
    els.statusText.textContent = "请先在生成图上框选要修改的文字区域。";
    els.statusText.classList.add("is-error-text");
    return;
  }
  shot.textRevisionRegion = selectedTextRegion;
  const originalImageUrl = shot.imageUrl;
  const originalText = button?.textContent || "";
  const estimate = estimateSingleImageCredits();
  if (state.user?.role !== "admin" && Number(state.user?.balance || 0) < estimate.credits) {
    els.statusText.textContent = USER_BALANCE_ERROR_MESSAGE;
    els.statusText.classList.add("is-error-text");
    return;
  }
  shot.status = "generating";
  if (button) {
    button.disabled = true;
    button.textContent = "生成中...";
  }
  renderStyleClonePage();
  els.statusText.classList.remove("is-error-text");
  els.statusText.textContent = `正在识别框选文字并调用模型修改：${shot.title || `图片 ${index + 1}`}`;

  try {
    const [editBase, textRegion] = await Promise.all([
      imageUrlToFile(originalImageUrl, `style-text-edit-${index + 1}.png`),
      imageRegionToFile(originalImageUrl, selectedTextRegion, `style-text-region-${index + 1}.png`)
    ]);
    const settings = { ...getSettings("style"), styleTextEditMode: true, mode: "api" };
    const form = new FormData();
    form.append("editBase", editBase);
    form.append("textRegion", textRegion);
    form.append("settings", JSON.stringify(settings));
    form.append(
      "shot",
      JSON.stringify({
        id: shot.id || `shot-${index + 1}`,
        category: shot.category || styleResultCategoryForMode(),
        title: shot.title || `图片 ${index + 1}`,
        description: shot.description || "",
        ratio: selectedStyleRatio(),
        prompt: shot.prompt || "",
        textRevisionPrompt: textEditPrompt,
        textRevisionRegion: selectedTextRegion,
        variationIndex: shot.variationIndex || index + 1
      })
    );
    form.append("textEditPrompt", textEditPrompt);

    const payload = await api("/api/jobs/style-text-edit", { method: "POST", body: form });
    state.user = payload.user || state.user;
    state.plan.shots[index] = {
      ...shot,
      ...payload.shot,
      prompt: shot.prompt,
      imageUrl: payload.shot?.imageUrl || originalImageUrl,
      previousImageUrl: originalImageUrl,
      textRevisionPrompt,
      textRevisionRegion: normalizedLightboxTextRegion(payload.shot?.textRevisionRegion || selectedTextRegion),
      status: "done"
    };
    rememberGeneratedShot(state.plan.shots[index], currentGenerationSource(), index);
    renderAccount();
    refreshCost();
    renderPlan(state.plan);
    renderStyleClonePage();
    if (state.lightboxStyleIndex === index && !els.imageLightbox.hidden) {
      els.imageLightboxImage.src = state.plan.shots[index].imageUrl;
      if (els.imageLightboxTextInput) els.imageLightboxTextInput.value = textRevisionPrompt;
      state.lightboxTextTarget = state.plan.shots[index].textRevisionRegion || null;
      updateLightboxTextHint();
      renderLightboxTextTarget();
    }
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = `已修改文字：${state.plan.shots[index].title || `图片 ${index + 1}`}`;
  } catch (error) {
    shot.imageUrl = originalImageUrl;
    shot.status = "done";
    renderStyleClonePage();
    els.statusText.textContent = error.message;
    els.statusText.classList.add("is-error-text");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function regenerateShot(index, button, { skipConfirm = false } = {}) {
  const tool = normalizeToolKey(state.activeTool);
  const runtime = workspaceRuntime(tool);
  const files = workspaceFiles(tool).slice();
  const plan = getWorkspacePlan(tool) || state.plan;
  if (!files.length) {
    setWorkspaceStatus("请先上传产品图。", { tool, isError: true });
    return;
  }
  const shot = plan?.shots?.[index];
  if (!shot) return;
  if (shot.status === "generating" || runtime.singleGenerating?.has(index)) {
    setWorkspaceStatus("这张图正在生成中，请等待结果返回后再操作。", { tool, isError: true });
    return;
  }
  const prompt = editablePromptForShot(index, shot, tool);
  if (!prompt) {
    setWorkspaceStatus("请先填写这张图的提示词。", { tool, isError: true });
    return;
  }
  const estimate = estimateSingleImageCredits(tool);
  if (state.user?.role !== "admin" && Number(state.user?.balance || 0) < estimate.credits) {
    setWorkspaceStatus(USER_BALANCE_ERROR_MESSAGE, {
      tool,
      isError: true
    });
    return;
  }
  shot.prompt = prompt;
  shot.status = "generating";
  runtime.singleGenerating.add(index);
  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "生成中...";
  }
  setWorkspaceStatus(`正在重新生成：${shot.title || `图片 ${index + 1}`}`, { tool });

  const form = new FormData();
  files.forEach((file) => form.append("photos", file));
  appendTemplateReferenceFiles(form);
  form.append("settings", JSON.stringify(getSettings(tool)));
  form.append(
    "shot",
    JSON.stringify({
      id: shot.id || `shot-${index + 1}`,
      category: shot.category || "",
      title: shot.title || `图片 ${index + 1}`,
      description: shot.description || "",
      ratio: tool === "style" ? selectedStyleRatio() : shot.ratio || selectedRatioValue(tool),
      referenceIndex: Number.isFinite(Number(shot.referenceIndex)) ? Number(shot.referenceIndex) : index,
      referenceTarget: shot.referenceTarget || null,
      referenceAnalysis: shot.referenceAnalysis || null,
      promptRoute: shot.promptRoute || {},
      textOverlay: shot.textOverlay || null,
      analysis: plan?.analysis || {},
      userRevisionPrompt: shot.userRevisionPrompt || "",
      variationIndex: shot.variationIndex || index + 1
    })
  );
  form.append("prompt", prompt);

  try {
    const payload = await api("/api/jobs/product-suite/shot", { method: "POST", body: form });
    state.user = payload.user || state.user;
    plan.shots[index] = {
      ...shot,
      ...payload.shot,
      prompt: payload.shot?.prompt || prompt,
      status: "done"
    };
    setWorkspacePlan(plan, tool);
    rememberGeneratedShot(plan.shots[index], generationSourceForTool(tool), index, workspaceHistoryKey(tool));
    renderAccount();
    refreshCost();
    if (tool === state.activeTool) renderPlan(plan);
    if (tool === "style" && state.activeTool === "style") renderStyleClonePage();
    setWorkspaceStatus(`已重新生成：${plan.shots[index].title || `图片 ${index + 1}`}`, { tool });
  } catch (error) {
    const message = friendlyGenerationErrorMessage(error.message);
    shot.status = shot.imageUrl ? "done" : "failed";
    shot.error = message;
    setWorkspacePlan(plan, tool);
    if (tool === state.activeTool) renderPlan(plan);
    if (tool === "style" && state.activeTool === "style") renderStyleClonePage();
    setWorkspaceStatus(message, { tool, isError: true });
  } finally {
    runtime.singleGenerating?.delete(index);
    if (tool === state.activeTool) {
      renderPlan(plan);
      if (tool === "style") renderStyleClonePage();
    }
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function handleGenerate({ tool = state.activeTool } = {}) {
  const generationTool = normalizeToolKey(tool);
  const runtime = workspaceRuntime(generationTool);
  const files = workspaceFiles(generationTool).slice();
  const plan = getWorkspacePlan(generationTool) || state.plan;
  if (runtime.generating) return;
  if (!files.length) {
    setWorkspaceStatus("请先上传产品图。", { tool: generationTool, isError: true });
    return;
  }
  if (!plan?.shots?.length) {
    setWorkspaceStatus("请先点击分析产品，确认生成大纲后再生成。", { tool: generationTool, isError: true });
    return;
  }
  const requestCounts = currentCounts(generationTool);
  const requestSettings = getSettings(generationTool);
  const estimate = estimateCredits(generationTool);
  if (state.user?.role !== "admin" && Number(state.user?.balance || 0) < estimate.credits) {
    setWorkspaceStatus(USER_BALANCE_ERROR_MESSAGE, {
      tool: generationTool,
      isError: true
    });
    return;
  }
  const generationHistoryKey = workspaceHistoryKey(generationTool);
  const generationSource = generationSourceForTool(generationTool);
  setWorkspacePlan(plan, generationTool);
  runtime.generating = true;
  runtime.generationJobId = `job_${Date.now()}`;
  setWorkspaceStatus(generationTool === "style" ? "3/3 正在提交风格复刻并发生成任务..." : "正在提交生成任务...", { tool: generationTool });
  refreshCost();
  if (generationTool === "style" && state.activeTool === "style") renderStyleClonePage();
  setWorkflow({ completed: [1, 2, 3], active: 4 }, generationTool);
  const form = new FormData();
  files.forEach((file) => form.append("photos", file));
  appendTemplateReferenceFiles(form);
  form.append("product", JSON.stringify(productPayload(generationTool, plan)));
  form.append("counts", JSON.stringify(requestCounts));
  form.append("settings", JSON.stringify(requestSettings));
  form.append("layout", activeGenerationRequirement(generationTool));
  form.append("plan", JSON.stringify(buildGenerationPlanPayload(generationTool, plan)));
  form.append("shotPrompts", JSON.stringify(collectShotPromptOverrides(generationTool, plan)));

  try {
    await streamProductSuite(form, { tool: generationTool, historyKey: generationHistoryKey, source: generationSource });
  } catch (error) {
    setWorkflow({ completed: [1, 2], active: 3 }, generationTool);
    setWorkspaceStatus(error.message, { tool: generationTool, isError: true });
  } finally {
    runtime.generating = false;
    runtime.generationJobId = "";
    runtime.singleGenerating?.clear();
    refreshCost();
    if (generationTool === "style" && state.activeTool === "style") renderStyleClonePage();
  }
}

async function streamProductSuite(form, context = {}) {
  const response = await fetch("/api/jobs/product-suite/stream", {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  if (!response.body) {
    const payload = await response.json();
        handleGenerationEvent({ type: "complete", ...payload }, context);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      handleGenerationEvent(JSON.parse(line), context);
    }
  }
  if (buffer.trim()) handleGenerationEvent(JSON.parse(buffer), context);
}

function handleGenerationEvent(event, context = {}) {
  const tool = normalizeToolKey(context.tool || state.activeTool);
  const runtime = workspaceRuntime(tool);
  const historyKey = context.historyKey || workspaceHistoryKey(tool);
  const source = context.source || generationSourceForTool(tool);
  const activeTarget = tool === state.activeTool;
  const planForTool = () => getWorkspacePlan(tool);
  const setPlanForTool = (plan) => setWorkspacePlan(plan, tool);
  const renderTargetPlan = (plan) => {
    if (!activeTarget) return;
    renderPlan(plan);
    if (tool === "style") renderStyleClonePage();
  };
  if (event.type === "plan") {
    setPlanForTool(event.plan);
    renderTargetPlan(event.plan);
    setWorkspaceStatus(tool === "style" ? "3/3 已完成识别和任务调度，开始并发生图..." : "已完成单张任务调度，开始逐张生成...", { tool });
    return;
  }
  if (event.type === "batch-retry") {
    setWorkspaceStatus(`正在补生成剩余 ${event.pending || 0} 张，已降并发重试...`, { tool });
    return;
  }
  if (event.type === "shot-retry") {
    const plan = planForTool();
    const shot = plan?.shots?.[event.index];
    if (shot) {
      shot.status = "generating";
      shot.generationAttempts = event.attempt || shot.generationAttempts || 1;
      runtime.singleGenerating?.add(event.index);
      setPlanForTool(plan);
      renderTargetPlan(plan);
    }
    setWorkspaceStatus(`正在补生成第 ${event.index + 1}/${event.total} 张，第 ${event.attempt || 2}/${event.maxAttempts || "-"} 次尝试`, { tool });
    return;
  }
  if (event.type === "shot-start") {
    const plan = planForTool();
    const shot = plan?.shots?.[event.index];
    if (shot) {
      shot.status = "generating";
      shot.generationAttempts = event.attempt || shot.generationAttempts || 1;
      runtime.singleGenerating?.add(event.index);
      setPlanForTool(plan);
      renderTargetPlan(plan);
    }
    setWorkspaceStatus(
      event.attempt && event.attempt > 1
        ? `正在补生成第 ${event.index + 1}/${event.total} 张，第 ${event.attempt}/${event.maxAttempts || "-"} 次尝试`
        : `正在生成第 ${event.index + 1}/${event.total} 张：${event.title}`,
      { tool }
    );
    return;
  }
  if (event.type === "shot") {
    const plan = planForTool();
    const shot = plan?.shots?.[event.index];
    runtime.singleGenerating?.delete(event.index);
    if (shot) {
      plan.shots[event.index] = { ...shot, ...event.shot, status: "done" };
      setPlanForTool(plan);
      rememberGeneratedShot(plan.shots[event.index], source, event.index, historyKey);
      renderTargetPlan(plan);
    }
    setWorkspaceStatus(`已生成第 ${event.index + 1}/${event.total} 张，可在对应分类预览`, { tool });
    return;
  }
  if (event.type === "shot-error") {
    const plan = planForTool();
    const shot = plan?.shots?.[event.index];
    if (!event.willRetry) runtime.singleGenerating?.delete(event.index);
    const message = friendlyGenerationErrorMessage(event.error || "生成失败");
    if (shot) {
      shot.status = event.willRetry ? "generating" : "failed";
      shot.error = message;
      shot.generationAttempts = event.attempt || shot.generationAttempts || 1;
      setPlanForTool(plan);
      renderTargetPlan(plan);
    }
    const directMessage = message === USER_BALANCE_ERROR_MESSAGE || message === ADMIN_UPSTREAM_QUOTA_ERROR_MESSAGE;
    setWorkspaceStatus(
      event.willRetry
        ? `第 ${event.index + 1} 张本次生成失败，正在自动补生成：${message}`
        : directMessage ? message : `第 ${event.index + 1} 张生成失败：${message}`,
      { tool, isError: !event.willRetry }
    );
    return;
  }
  if (event.type === "complete") {
    runtime.singleGenerating?.clear();
    runtime.generating = false;
    state.user = event.user || state.user;
    const completedPlan = event.job || planForTool();
    setPlanForTool(completedPlan);
    rememberGeneratedShots(completedPlan?.shots || [], source, historyKey);
    renderAccount();
    renderTargetPlan(completedPlan);
    setWorkflow({ completed: [1, 2, 3, 4, 5] }, tool);
    const stats = completedPlan?.shotStats || {};
    const failedShots = (completedPlan?.shots || []).filter((shot) => shot.status === "failed" || shot.error);
    if (Number(stats.failed || 0) > 0 || failedShots.length) {
      const firstError = failedShots.find((shot) => shot.error)?.error || "生成失败，未返回图片。";
      setWorkspaceStatus(
        Number(stats.done || 0) > 0 ? `部分生成成功，失败原因：${firstError}` : firstError,
        { tool, isError: true }
      );
      return;
    }
    setWorkspaceStatus(
      tool === "style" ? "风格复刻生成已完成，可回到风格复刻区域查看结果。" : "详情图组已生成完成，可在图片规划中按分类预览",
      { tool }
    );
    return;
  }
  if (event.type === "error") {
    runtime.singleGenerating?.clear();
    runtime.generating = false;
    if (event.job) {
      state.user = event.user || state.user;
      setPlanForTool(event.job);
      renderAccount();
      renderTargetPlan(event.job);
    }
    throw new Error(event.error || "生成失败");
  }
}

async function openSupportPanel() {
  els.supportPanel.hidden = false;
  try {
    const payload = await api("/api/support/config", { headers: {} });
    renderSupportConfig(payload.support || {});
  } catch {
    renderSupportConfig({});
  }
  if (state.token) await loadSupportThread();
}

function renderSupportConfig(support) {
  els.supportWelcome.textContent = support.welcome || "您好，这里是 lamps studio 客服。";
  els.supportWechatText.textContent = support.wechat || "管理员暂未配置";
  if (support.wechatQrUrl) {
    els.supportWechatQr.src = support.wechatQrUrl;
    els.supportWechatQr.hidden = false;
  } else {
    els.supportWechatQr.hidden = true;
  }
}

async function loadSupportThread() {
  try {
    const payload = await api("/api/support/messages");
    const messages = payload.messages || [];
    els.supportThread.innerHTML = messages.length
      ? messages
          .map(
            (item) => `
              <div class="support-bubble"><small>我 · ${new Date(item.createdAt).toLocaleString()}</small>${escapeHtml(item.message)}</div>
              ${item.reply ? `<div class="support-bubble reply"><small>管理员回复</small>${escapeHtml(item.reply)}</div>` : ""}
            `
          )
          .join("")
      : '<div class="support-bubble">还没有咨询记录，可以直接留言。</div>';
  } catch {
    els.supportThread.innerHTML = '<div class="support-bubble">登录后可以在线留言，或复制管理员配置的微信添加。</div>';
  }
}

async function sendSupportMessage() {
  if (!state.token) {
    els.supportThread.innerHTML = '<div class="support-bubble">请先登录后再发送在线咨询。</div>';
    return;
  }
  const message = els.supportMessageInput.value.trim();
  if (!message) return;
  els.sendSupportMessage.disabled = true;
  try {
    await api("/api/support/messages", { method: "POST", body: JSON.stringify({ message }) });
    els.supportMessageInput.value = "";
    await loadSupportThread();
    if (state.user?.role === "admin") await loadAdminSupportMessages();
  } catch (error) {
    els.supportThread.innerHTML = `<div class="support-bubble">${escapeHtml(error.message)}</div>`;
  } finally {
    els.sendSupportMessage.disabled = false;
  }
}

function resetPaymentModal() {
  if (state.paymentPoll) {
    window.clearInterval(state.paymentPoll);
    state.paymentPoll = null;
  }
  els.paymentForm.hidden = false;
  els.paymentQr.hidden = true;
  els.paymentHint.textContent = "充值到账规则：1 元 = 10 积分。";
  els.paymentHint.classList.remove("is-error-text");
  els.createPaymentButton.disabled = false;
  els.createPaymentButton.textContent = "生成支付二维码";
}

async function createPaymentOrder() {
  const amount = Number(els.rechargeAmount.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    els.paymentHint.textContent = "请输入正确的充值金额。";
    els.paymentHint.classList.add("is-error-text");
    return;
  }
  els.paymentHint.classList.remove("is-error-text");
  els.createPaymentButton.disabled = true;
  els.createPaymentButton.textContent = "正在创建订单...";
  try {
    const payload = await api("/api/payments/create", {
      method: "POST",
      body: JSON.stringify({ provider: state.paymentProvider, amount })
    });
    showPaymentQr(payload.payment);
  } catch (error) {
    els.paymentHint.textContent = error.message;
    els.paymentHint.classList.add("is-error-text");
    els.createPaymentButton.disabled = false;
    els.createPaymentButton.textContent = "生成支付二维码";
  }
}

function showPaymentQr(payment) {
  els.paymentForm.hidden = true;
  els.paymentQr.hidden = false;
  els.paymentQrImage.src = payment.qrDataUrl;
  els.paymentQrTitle.textContent = `${payment.provider === "wechat" ? "微信支付" : "支付宝支付"} ${payment.amount} 元`;
  els.paymentQrStatus.textContent = "请扫码支付，到账后余额会自动刷新。";
  if (state.paymentPoll) window.clearInterval(state.paymentPoll);
  state.paymentPoll = window.setInterval(async () => {
    try {
      const payload = await api(`/api/payments/${payment.id}`);
      if (payload.payment.status === "paid") {
        window.clearInterval(state.paymentPoll);
        state.paymentPoll = null;
        state.user = payload.user;
        renderAccount();
        if (!els.personalCenterModal?.hidden) void loadPersonalCenter();
        els.paymentQrStatus.textContent = `支付成功，当前余额 ${state.user.balance} 积分。`;
      }
    } catch (error) {
      els.paymentQrStatus.textContent = error.message;
    }
  }, 2500);
}

function bindFileDropZone(zone, onFiles) {
  if (!zone || zone.dataset.dropBound === "true") return;
  zone.dataset.dropBound = "true";
  const activate = (event) => {
    event.preventDefault();
    zone.classList.add("is-dragging");
  };
  const deactivate = (event) => {
    event.preventDefault();
    zone.classList.remove("is-dragging");
  };
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, activate));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, deactivate));
  zone.addEventListener("drop", (event) => {
    const files = event.dataTransfer?.files;
    if (files?.length) onFiles(files);
  });
}

function wireDropZone() {
  const input = $("photoInput");
  const zone = $("dropZone");
  if (!input || !zone) return;
  input.addEventListener("change", (event) => readFiles(event.target.files));
  bindFileDropZone(zone, readFiles);
}

function setupInteractionFeedback() {
  if (!els.statusText) return;
  let statusTimer = 0;
  const pulse = () => {
    els.statusText.classList.remove("status-pulse");
    void els.statusText.offsetWidth;
    els.statusText.classList.add("status-pulse");
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => els.statusText.classList.remove("status-pulse"), 420);
  };
  new MutationObserver(pulse).observe(els.statusText, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function wireEvents() {
  if (els.closeBanner && els.promoBanner) {
    els.closeBanner.addEventListener("click", () => {
      els.promoBanner.hidden = true;
    });
  }
  els.loginTab.addEventListener("click", () => setAuthMode("login"));
  els.registerTab.addEventListener("click", () => setAuthMode("register"));
  els.registerMethods.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => setAuthChannel(button.dataset.authChannel));
  });
  els.authSubmit.addEventListener("click", handleAuthSubmit);
  els.sendCodeButton.addEventListener("click", sendRegisterCode);
  els.authPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void handleAuthSubmit();
  });
  els.authCode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void handleAuthSubmit();
  });
  els.forgotPassword.addEventListener("click", () => markAuthError("请用注册手机号或邮箱联系客服找回密码"));
  els.logoutButton.addEventListener("click", () => {
    state.token = "";
    state.user = null;
    state.adminView = "workspace";
    state.personalCenter = null;
    state.generationHistory = { product: [], style: [], templates: [] };
    state.workspacePlans = { product: null, style: null };
    state.plan = null;
    if (els.personalCenterModal) els.personalCenterModal.hidden = true;
    localStorage.removeItem("lamp_token");
    showAuth();
  });
  els.workspaceTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      setAdminView(button.dataset.view);
      if (button.dataset.view === "admin") {
        void loadAdminSettings();
        void loadAdminDashboard();
        void loadAdminSupportMessages();
      }
    });
  });
  els.saveAdminSettings.addEventListener("click", saveAdminSettings);
  els.adminYunwuEnabled?.addEventListener("change", () => syncAdminImageProviderToggles("yunwu"));
  els.adminAPIYiEnabled?.addEventListener("change", () => syncAdminImageProviderToggles("apiyi"));
  els.adminImageProvider?.addEventListener("change", syncAdminProviderFromSelect);
  els.refreshAdminDashboard.addEventListener("click", () => {
    void refreshAdminWorkspace("后台数据已刷新");
  });
  els.adminRefreshAll?.addEventListener("click", () => void refreshAdminWorkspace("后台数据已刷新"));
  els.adminBackWorkspace?.addEventListener("click", () => setActiveTool("product"));
  els.adminOpenSupport?.addEventListener("click", () => void openSupportPanel());
  els.adminClearSecrets?.addEventListener("click", clearAdminSecretInputs);
  els.adminSectionSelect?.addEventListener("change", () => focusAdminGroup(els.adminSectionSelect.value));
  document.querySelectorAll("[data-admin-group] > summary").forEach((summary) => {
    summary.addEventListener("click", () => {
      const group = summary.parentElement?.dataset.adminGroup || "";
      if (group && els.adminSectionSelect) els.adminSectionSelect.value = group;
    });
  });
  els.adminTestSub2API?.addEventListener("click", () => void testAdminSub2APIConnection());
  els.adminOpenSub2API?.addEventListener("click", openAdminSub2APIConsole);
  els.adminUserSearch?.addEventListener("input", () => {
    state.adminUserSearch = els.adminUserSearch.value;
    if (state.adminDashboard) renderAdminDashboard(state.adminDashboard);
  });
  document.querySelectorAll(".support-button").forEach((button) => button.addEventListener("click", openSupportPanel));
  els.closeSupport.addEventListener("click", () => {
    els.supportPanel.hidden = true;
  });
  els.supportPanel.addEventListener("click", (event) => {
    if (event.target === els.supportPanel) els.supportPanel.hidden = true;
  });
  els.copyWechat.addEventListener("click", async () => {
    const text = els.supportWechatText.textContent;
    if (text && text !== "管理员暂未配置") {
      await navigator.clipboard.writeText(text);
      els.copyWechat.textContent = "已复制";
      window.setTimeout(() => (els.copyWechat.textContent = "澶嶅埗"), 1400);
    }
  });
  els.sendSupportMessage.addEventListener("click", sendSupportMessage);
  els.openPersonalCenter?.addEventListener("click", () => {
    state.personalTab = "consumption";
    els.openPersonalCenter.classList.add("is-selected");
    els.personalCenterModal.hidden = false;
    void loadPersonalCenter();
  });
  els.closePersonalCenter?.addEventListener("click", () => {
    els.personalCenterModal.hidden = true;
    els.openPersonalCenter.classList.remove("is-selected");
  });
  els.personalCenterModal?.addEventListener("click", (event) => {
    if (event.target === els.personalCenterModal) {
      els.personalCenterModal.hidden = true;
      els.openPersonalCenter.classList.remove("is-selected");
    }
  });
  document.querySelectorAll("[data-personal-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.personalTab = button.dataset.personalTab || "consumption";
      renderPersonalCenter();
    });
  });
  els.openRecharge.addEventListener("click", () => {
    resetPaymentModal();
    els.openRecharge.classList.add("is-selected");
    els.rechargeModal.hidden = false;
  });
  els.closeRecharge.addEventListener("click", () => {
    els.rechargeModal.hidden = true;
    els.openRecharge.classList.remove("is-selected");
    resetPaymentModal();
  });
  els.rechargeModal.addEventListener("click", (event) => {
    if (event.target === els.rechargeModal) {
      els.rechargeModal.hidden = true;
      els.openRecharge.classList.remove("is-selected");
      resetPaymentModal();
    }
  });
  els.closeImageLightbox.addEventListener("click", closeImageLightbox);
  els.imageLightbox.addEventListener("click", (event) => {
    if (event.target === els.imageLightbox) closeImageLightbox();
  });
  els.imageLightboxImageWrap?.addEventListener("pointerdown", handleLightboxSelectionStart);
  els.imageLightboxImageWrap?.addEventListener("pointermove", handleLightboxSelectionMove);
  els.imageLightboxImageWrap?.addEventListener("pointerup", handleLightboxSelectionEnd);
  els.imageLightboxImageWrap?.addEventListener("pointercancel", handleLightboxSelectionCancel);
  els.imageLightboxImageWrap?.addEventListener("lostpointercapture", handleLightboxSelectionCancel);
  els.imageLightboxTextInput?.addEventListener("input", () => {
    const shot = state.plan?.shots?.[state.lightboxStyleIndex];
    if (shot) shot.textRevisionPrompt = els.imageLightboxTextInput.value.trim();
  });
  els.imageLightboxTextButton?.addEventListener("click", () => {
    const index = state.lightboxStyleIndex;
    const shot = state.plan?.shots?.[index];
    if (!shot) return;
    shot.textRevisionPrompt = els.imageLightboxTextInput.value.trim();
    shot.textRevisionRegion = normalizedLightboxTextRegion(state.lightboxTextTarget || shot.textRevisionRegion);
    void editStyleResultText(index, els.imageLightboxTextButton);
  });
  syncSaveDirectoryInputs();
  els.savePathInput.addEventListener("change", () => {
    setWorkspaceSaveDirectory(els.savePathInput.value, "product");
  });
  els.styleSavePathInput?.addEventListener("change", () => {
    setWorkspaceSaveDirectory(els.styleSavePathInput.value, "style");
  });
  els.collageSavePathInput?.addEventListener("change", () => {
    setWorkspaceSaveDirectory(els.collageSavePathInput.value, "templates");
  });
  els.chooseSavePathButton?.addEventListener("click", () => void chooseWorkspaceSaveDirectory("product", els.chooseSavePathButton));
  els.chooseStyleSavePathButton?.addEventListener("click", () => void chooseWorkspaceSaveDirectory("style", els.chooseStyleSavePathButton));
  els.chooseCollageSavePathButton?.addEventListener("click", () => void chooseWorkspaceSaveDirectory("templates", els.chooseCollageSavePathButton));
  document.querySelectorAll(".quick-amounts button").forEach((button) => {
    button.addEventListener("click", () => {
      els.rechargeAmount.value = button.dataset.amount || "100";
    });
  });
  document.querySelectorAll(".pay-methods button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".pay-methods button").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      state.paymentProvider = button.dataset.provider || "wechat";
    });
  });
  els.createPaymentButton.addEventListener("click", createPaymentOrder);
  els.backToPaymentForm.addEventListener("click", resetPaymentModal);
  const appNav = els.appNav || document.querySelector(".app-nav");
  appNav?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (!button) return;
    setActiveTool(button.dataset.tool);
  });
  els.toolPanel?.addEventListener("click", (event) => {
    if (event.target.closest("[data-tool-close]")) setActiveTool("product");
  });
  els.styleCloneWorkspace?.addEventListener("click", (event) => {
    if (event.target.closest("[data-tool-close]")) setActiveTool("product");
  });
  els.applyLampTemplate?.addEventListener("click", () => applyCreationTemplate());
  els.templateSelect?.addEventListener("change", () => {
    selectCreationTemplate(els.templateSelect.value);
  });
  els.templateGroups?.addEventListener("click", (event) => {
    const groupButton = event.target.closest("[data-template-group]");
    if (groupButton) setTemplateGroup(groupButton.dataset.templateGroup);
  });
  els.collagePhotoInput?.addEventListener("change", (event) => {
    readFiles(event.target.files);
    event.target.value = "";
  });
  bindFileDropZone(els.collageUploadZone, readFiles);
  let collageDragIndex = null;
  els.collagePreviewList?.addEventListener("dragstart", (event) => {
    const thumb = event.target.closest("[data-collage-index]");
    if (!thumb) return;
    collageDragIndex = Number(thumb.dataset.collageIndex);
    thumb.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(collageDragIndex));
  });
  els.collagePreviewList?.addEventListener("dragover", (event) => {
    const thumb = event.target.closest("[data-collage-index]");
    if (!thumb) return;
    event.preventDefault();
    thumb.classList.add("is-drop-target");
    event.dataTransfer.dropEffect = "move";
  });
  els.collagePreviewList?.addEventListener("dragleave", (event) => {
    const thumb = event.target.closest("[data-collage-index]");
    if (thumb) thumb.classList.remove("is-drop-target");
  });
  els.collagePreviewList?.addEventListener("drop", (event) => {
    const thumb = event.target.closest("[data-collage-index]");
    if (!thumb) return;
    event.preventDefault();
    const fromIndex = Number.isInteger(collageDragIndex) ? collageDragIndex : Number(event.dataTransfer.getData("text/plain"));
    const toIndex = Number(thumb.dataset.collageIndex);
    collageDragIndex = null;
    els.collagePreviewList.querySelectorAll(".collage-thumb").forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
    reorderCollageFiles(fromIndex, toIndex);
  });
  els.collagePreviewList?.addEventListener("dragend", () => {
    collageDragIndex = null;
    els.collagePreviewList.querySelectorAll(".collage-thumb").forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
  });
  els.collagePreviewList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-collage-remove]");
    if (!removeButton) return;
    const index = Number(removeButton.dataset.collageRemove);
    const files = workspaceFiles("templates");
    files.splice(index, 1);
    if (state.activeTool === "templates") activateWorkspaceFiles("templates");
    state.collageProductNames.splice(index, 1);
    clearWorkspacePlan("templates");
    state.collageShot = null;
    renderPreviews();
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = files.length ? "拼图产品图已更新，可重新生成。" : "拼图产品图已清空，请上传产品图。";
  });
  els.collagePreviewList?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-collage-name]");
    if (!input) return;
    const index = Number(input.dataset.collageName);
    state.collageProductNames[index] = input.value.trim();
    state.collageShot = null;
    if (els.collageStatus) els.collageStatus.textContent = "标签名称已更新，生成时会按当前名称标记。";
  });
  els.generateCollageButton?.addEventListener("click", () => void generateCollage());
  els.collageRatioSelect?.addEventListener("change", handleCollageRatioChanged);
  els.collageModelSelect?.addEventListener("change", handleCollageModelChanged);
  els.collageClaritySelect?.addEventListener("change", handleCollageClarityChanged);
  els.collageRequirementInput?.addEventListener("input", () => {
    state.collageShot = null;
    renderCollageCenter();
    if (els.collageStatus) els.collageStatus.textContent = "补充提示词已更新，点击识别并生成后会按当前要求出图。";
  });
  els.collageResultPreview?.addEventListener("click", (event) => {
    const variant = event.target.closest("[data-collage-variant]")?.dataset.collageVariant || "";
    if (variant === "text" && state.collageShot?.textImageUrl) {
      openImageLightbox({ ...state.collageShot, imageUrl: state.collageShot.textImageUrl, title: "Collage with labels" });
      return;
    }
    if (variant === "noText" && state.collageShot?.noTextImageUrl) {
      openImageLightbox({ ...state.collageShot, imageUrl: state.collageShot.noTextImageUrl, title: "Collage without labels" });
      return;
    }
    if (state.collageShot?.imageUrl) openImageLightbox(state.collageShot);
  });
  els.saveCollageButton?.addEventListener("click", () => void saveCollageImage());
  els.generationHistoryList?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-history-view]");
    if (viewButton) {
      const item = workspaceHistory()[Number(viewButton.dataset.historyView)];
      if (item?.imageUrl) openImageLightbox(item);
      return;
    }
    const saveButton = event.target.closest("[data-history-save]");
    if (saveButton) void saveHistoryImage(Number(saveButton.dataset.historySave), saveButton);
  });
  els.clearGenerationHistory?.addEventListener("click", () => {
    void loadAccountGenerationHistory();
  });
  els.applyOptimizedRequirement?.addEventListener("click", applyOptimizedRequirement);
  els.analyzeButton?.addEventListener("click", handlePrimaryAction);
  els.styleBatchSaveButton?.addEventListener("click", () => void saveAllGeneratedImages());
  els.styleRetryFailedButton?.addEventListener("click", () => void retryFailedShots());
  els.imageScopeTabs?.querySelectorAll("[data-image-scope]").forEach((button) => {
    button.addEventListener("click", () => setImageScope(button.dataset.imageScope));
  });
  document.querySelectorAll("[data-similar-mode]").forEach((button) => {
    button.addEventListener("click", () => applySimilarMode(button.dataset.similarMode));
  });
  els.templateList?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-template-id]");
    if (!option) return;
    selectCreationTemplate(option.dataset.templateId);
  });
  els.templateReferenceInput.addEventListener("change", (event) => {
    handleTemplateReferenceFiles(event.target.files);
    event.target.value = "";
  });
  bindFileDropZone(els.templateReferenceUploadZone, handleTemplateReferenceFiles);
  els.styleSubjectInput?.addEventListener("change", (event) => {
    readFiles(event.target.files);
    event.target.value = "";
  });
  bindFileDropZone(els.styleSubjectUploadZone, readFiles);
  els.styleAnalyzeButton?.addEventListener("click", handleStylePreviewAction);
  els.styleRequirementInput?.addEventListener("input", () => {
    if (state.activeTool !== "style") return;
    clearWorkspacePlan("style");
    renderEmptyPlan();
    renderStyleClonePage();
    els.statusText.classList.remove("is-error-text");
    els.statusText.textContent = "风格复刻提示词已更新，点击识别并生成后会按当前要求重新出图。";
  });
  [
    els.styleCloneStrengthSelect,
    els.styleBackgroundLockSelect,
    els.stylePositionLockSelect,
    els.styleConsistencySelect
  ]
    .filter(Boolean)
    .forEach((control) => {
      control.addEventListener("change", () => {
        if (state.activeTool !== "style") return;
        clearWorkspacePlan("style");
        renderEmptyPlan();
        renderStyleClonePage();
        els.statusText.classList.remove("is-error-text");
        els.statusText.textContent = "风格复刻策略已更新，点击识别并生成后会按当前限制重新出图。";
      });
    });
  els.styleModelSelect?.addEventListener("change", () => {
    handleStyleModelChanged();
  });
  els.styleRatioSelect?.addEventListener("change", handleStyleRatioChanged);
  els.styleClaritySelect?.addEventListener("change", handleStyleClarityChanged);
  [
    els.requirementInput,
    els.modelSelect,
    els.ratioSelect,
    els.claritySelect,
    els.quantitySelect
  ]
    .filter(Boolean)
    .forEach((el) => {
      el.addEventListener("change", () => {
      const isRequirement = el === els.requirementInput;
      if (el === els.modelSelect) {
        setWorkspaceModel("product", els.modelSelect.value);
      }
      if (el === els.claritySelect) {
        setWorkspaceClarity("product", els.claritySelect.value || "2k");
        renderStyleModelHint();
      }
      if (el === els.requirementInput) {
        state.requirementAutoFilled = false;
        setLampTemplateButtonApplied(false);
      }
      if (el === els.quantitySelect) {
        setLampTemplateButtonApplied(false);
      }
      refreshCost();
      syncPlanAfterUserChange(isRequirement ? "要求已修改，请点击分析产品重新生成图片规划。" : "参数已修改，请点击分析产品重新生成图片规划。");
    });
    });
  els.requirementInput.addEventListener("input", () => {
    state.requirementAutoFilled = false;
    setLampTemplateButtonApplied(false);
    if (state.plan?.shots?.length) {
      scheduleRequirementSync("要求已修改，请点击分析产品重新生成图片规划。");
    }
  });
  els.generateButton.addEventListener("click", handleGenerate);
  wireDropZone();
}

async function initConfig() {
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = {};
  }
  renderModelOptions();
}

await initConfig();
renderTemplateCenter();
wireEvents();
setupInteractionFeedback();
renderPromptAssist(null);
renderTemplateReferencePreview();
renderPreviews();
renderGenerationHistory();
renderStyleClonePage();
updateQuantityOptions();
setAuthMode("login");
setWorkflow();
refreshCost();
await restoreSession();
