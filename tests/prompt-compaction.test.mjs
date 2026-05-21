import test from "node:test";
import assert from "node:assert/strict";

process.env.LAMPS_SKIP_SERVER_LISTEN = "1";

const {
  applyLargeLampDetailStrategy,
  applySmallLampDetailStrategy,
  applyWallLampDetailStrategy,
  applySuiteStoryboardStrategy,
  compactGenerationPrompt,
  detectPromptConflicts,
  enhanceSmallLampProfileFromHints,
  fallbackSmallLampProfileForLongDetailSuite,
  generationConcurrency,
  generationPromptDebug,
  generationInputRoleInstruction,
  generationInputRolePrompt,
  generationShotMaxAttempts,
  gateSmallLampSpecEvidence,
  isFatalGenerationError,
  isTransientGenerationError,
  remainingGenerationApiAttempts,
  smallLampDetailSequenceCatalog,
  smallLampProfileAudit,
  smallLampSanitizeEvidenceText,
  smallLampTrustedSellingText,
  productWorkspaceConsistencyPrompt,
  suiteStoryboardHiddenPrompt,
  hiddenGenerationPrompt,
  textOverlayTheme,
  modelDirectHeroCoverArtDirection,
  repairDetailCoverPromptIfNeeded,
  shotTextOverlaySvgNodes,
  localOverlayFallbackShot,
  modelDirectTextQaResult,
  shouldRunSpatialLensVisualQa,
  openAIQuality,
  textRenderModeForShot,
  recognitionRequestPrompt,
  productDesignSpecPlanRequestPrompt,
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
  largeLampGenerationPromptFromPlan,
  smallLampGenerationPromptFromPlan,
  wallLampGenerationPromptFromPlan,
  wallLampDetailSequenceCatalog
} = await import("../server.js");

function assertSpatialBriefContract(text) {
  assert.match(text, /场景[：:]/);
  assert.match(text, /视角[：:]/);
  assert.match(text, /机位角度[：:]|机位[：:]/);
  assert.match(text, /灯具比例[：:]/);
  assert.match(text, /画面参照[：:]/);
}

function assertNoNearSceneWords(text) {
  assert.doesNotMatch(text, /微距|局部特写|产品特写|大特写|贴脸|近景大头|近景|贴近天花|低角度仰拍|只拍灯体|主体占满画面|大头灯/);
}

function planPromptText(plan) {
  return (plan.shots || []).map((shot) => [shot.prompt, shot.generationPrompt].filter(Boolean).join("\n")).join("\n\n");
}

test("openai image quality maps clarity without crashing gpt image generation", () => {
  assert.equal(openAIQuality("1k"), "medium");
  assert.equal(openAIQuality("2k"), "medium");
  assert.equal(openAIQuality("4k"), "high");
  assert.equal(openAIQuality("unknown"), "medium");
  assert.equal(openAIQuality(), "medium");
});

test("spatial lens visual qa stays disabled even when requested", () => {
  const shot = { category: "scene", promptRoute: { sequenceSlot: "scene-context" } };
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };

  assert.equal(shouldRunSpatialLensVisualQa(shot, "scene", settings), false);
  assert.equal(shouldRunSpatialLensVisualQa(shot, "scene", { ...settings, spatialLensVisualQa: true }), false);
  assert.equal(shouldRunSpatialLensVisualQa(shot, "scene", { ...settings, spatialLensVisualQa: true, disableSpatialLensVisualQa: true }), false);
});

test("commerce detail hero overlay renders readable supported title layout", () => {
  const light = shotTextOverlaySvgNodes({
    template: "commerce-detail-hero",
    title: "温润光境",
    subtitle: "让空间更有层次",
    tone: "light"
  }, { width: 1024, height: 1365 });
  const panel = shotTextOverlaySvgNodes({
    template: "commerce-detail-hero",
    title: "温润光境",
    subtitle: "让空间更有层次",
    tone: "light",
    panel: "soft-gradient"
  }, { width: 1024, height: 1365 });
  const old = shotTextOverlaySvgNodes({
    template: "editorial-hero-title",
    title: "温润光境",
    subtitle: "让空间更有层次",
    tone: "light"
  }, { width: 1024, height: 1365 });
  const dark = shotTextOverlaySvgNodes({
    template: "commerce-detail-hero",
    title: "静谧光影",
    subtitle: "柔和照明",
    tone: "dark"
  }, { width: 1024, height: 1365 });

  const lightFont = Number(light.match(/font-size="(\d+)"/)?.[1] || 0);
  const oldFont = Number(old.match(/font-size="(\d+)"/)?.[1] || 0);
  assert.doesNotMatch(light, /linearGradient|<rect/);
  assert.match(light, /commerceHeroTextShadow/);
  assert.match(light, /paint-order="stroke"/);
  assert.match(light, /温润光境/);
  assert.match(light, /让空间更有层次/);
  assert.equal(/text-anchor="middle"|padStart|01|02/.test(light), false);
  assert.ok(lightFont > oldFont, `commerce title ${lightFont} should be larger than old title ${oldFont}`);
  assert.match(panel, /linearGradient/);
  assert.match(panel, /stop-opacity="0\.58"/);
  assert.match(dark, /#fffaf1/);
  assert.doesNotMatch(dark, /linearGradient/);
});

test("model-direct commerce hero gives one reference title and autonomous layout", () => {
  const title = "\u8f7b\u6cd5\u5f0f\u6676\u900f";
  const subtitle = "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f";
  const merged = "\u8f7b\u6cd5\u5f0f\u6676\u900f\u7a7a\u95f4\u4e3b\u706f";
  const prompt = largeLampGenerationPromptFromPlan("\u4efb\u52a1\uff1a\u9996\u5c4f", {
    category: "scene",
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: { lampChannel: "large", mountFamily: "chandelier", lampType: "\u540a\u706f" },
    shot: {
      category: "scene",
      promptRoute: { sequenceSlot: "hero-main-space" },
      textRenderMode: "model-direct",
      textOverlay: { template: "commerce-detail-hero", title, subtitle, labels: [] }
    }
  });

  assert.match(prompt, new RegExp(merged));
  assert.doesNotMatch(prompt, new RegExp(`\u300c${title}\u300d.*\u300c${subtitle}\u300d`, "s"));
  assert.match(prompt, /首图：全幅电商详情页封面设计稿/);
  assert.match(prompt, /只生成1行简体中文短标题/);
  assert.match(prompt, /6-12字/);
  assert.match(prompt, /底部白条.*顶部白条.*侧边白条.*独立标题栏.*纯白文字区.*模板海报白块.*粗黑大字/s);
  assert.match(prompt, /文字区域不超过画面高度10%-14%/);
  assert.doesNotMatch(prompt, /不生成副标题[\s\S]*「.*」[\s\S]*标签/);
});

test("commerce hero copy dedupes style words before model-direct text planning", () => {
  const result = applyLargeLampDetailStrategy({
    shots: [{ id: "scene-1", category: "scene", prompt: "\u8be6\u60c5\u9996\u5c4f" }],
    counts: { scene: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "large",
      mountFamily: "chandelier",
      scaleClass: "large",
      lampType: "\u540a\u706f",
      lampSubtype: "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f",
      style: "\u8f7b\u6cd5\u5f0f",
      visualStrategy: {
        productStyle: "\u8f7b\u6cd5\u5f0f\u6676\u900f\u7a7a\u95f4\u4e3b\u706f",
        moodKeywords: "\u6676\u900f\u3001\u8f7b\u76c8"
      }
    }
  });
  const shot = result.shots[0];
  const overlay = shot.textOverlay || {};

  assert.equal(overlay.title, "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f");
  assert.doesNotMatch(overlay.subtitle || "", /\u8f7b\u6cd5\u5f0f|\u7a7a\u95f4\u4e3b\u706f|\u540a\u706f/);
  assert.doesNotMatch(`${overlay.title}${overlay.subtitle}`, /\u8f7b\u6cd5\u5f0f.*\u8f7b\u6cd5\u5f0f/);
  assert.match(shot.generationPrompt, /\u8f7b\u6cd5\u5f0f\u6676\u900f\u7a7a\u95f4\u4e3b\u706f|\u8f7b\u6cd5\u5f0f\u6676\u900f\u8f7b\u76c8\u7a7a\u95f4/);
});

test("recognition prompt asks for split hero copy fields without repeated placeholders", () => {
  const prompt = recognitionRequestPrompt({}, "");
  const planPrompt = productPlanRequestPrompt({ product: {}, counts: { scene: 1 }, settings: { imageScope: "detail" } });

  for (const text of [prompt, planPrompt]) {
    assert.match(text, /style \u53ea\u5199\u98ce\u683c\u8bcd/);
    assert.match(text, /lampSubtype \u53ea\u5199\u706f\u5177\u7c7b\u578b/);
    assert.match(text, /productStyle.*\u98ce\u683c\+\u6838\u5fc3\u8d28\u611f\/\u6750\u8d28\+\u706f\u5177\u7c7b\u578b/);
    assert.match(text, /moodKeywords.*\u4e0d\u5f97\u91cd\u590d\u98ce\u683c\u8bcd\u3001\u706f\u5177\u7c7b\u578b/);
    assert.match(text, /\u4e0d\u8981\u5199\u201c\u7535\u5546\u5546\u54c1\u56fe\u201d\u201c\u73b0\u4ee3\u5546\u7528\u4ea7\u54c1\u56fe\u201d\u201c\u8ba9\u7a7a\u95f4\u66f4\u6709\u5c42\u6b21\u201d/);
  }
  assert.match(planPrompt, /单一灯型通道/);
  assert.match(planPrompt, /通道防混禁令/);
  assert.match(planPrompt, /sequenceSlot=detail-cover/);
  assert.match(planPrompt, /provided-lamp-detail-method-v1/);
  assert.match(planPrompt, /学习方法论，不复制参考内容/);
  assert.match(planPrompt, /文字排版/);
  assert.match(planPrompt, /风格举一反三/);
  assert.match(planPrompt, /第 1 张.*全幅电商详情页封面设计稿/);
  assert.match(planPrompt, /detail-cover prompt.*1 行 6-12 字/);
  assert.match(planPrompt, /首图与场景图输出契约/);
  assert.match(planPrompt, /detail-cover prompt.*场景.*视角.*机位角度.*灯具比例.*画面参照/s);
  assert.match(planPrompt, /category=scene.*场景.*视角.*机位角度.*灯具比例.*画面参照/s);
  assert.match(planPrompt, /空间完整性优先/);
  assert.match(planPrompt, /画面先生成地面、墙面、家具和空间纵深/);
  assert.match(planPrompt, /第 2 张.*真实比例场景图/);
  assert.match(planPrompt, /第 3 张.*核心功能图/);
});

test("recognition request prompt stays profile-only and does not ask the model to plan shots", () => {
  const prompt = recognitionRequestPrompt({}, "胡桃木吊灯详情页");

  assert.match(prompt, /产品识别模型/);
  assert.match(prompt, /lampChannel/);
  assert.match(prompt, /visualStrategy/);
  assert.doesNotMatch(prompt, /targetShots|\"shots\"|每张目标图|图片规划模型|提示词规划模型/);
});

test("product workspace detail planning starts with cover scene and function narrative slots", () => {
  const settings = { imageScope: "detail" };

  assert.deepEqual(productPlanTargetShots({ scene: 1 }, settings).map((shot) => shot.sequenceSlot), [
    "detail-cover"
  ]);
  assert.deepEqual(productPlanTargetShots({ scene: 2 }, settings).map((shot) => shot.sequenceSlot), [
    "detail-cover",
    "scene-context"
  ]);
  assert.deepEqual(productPlanTargetShots({ scene: 3 }, settings).map((shot) => shot.sequenceSlot), [
    "detail-cover",
    "scene-context",
    "function-core"
  ]);

  const many = productPlanTargetShots({ selling: 2, scene: 3, detail: 1, function: 1 }, settings);
  assert.deepEqual(many.slice(0, 3).map((shot) => shot.sequenceSlot), [
    "detail-cover",
    "scene-context",
    "function-core"
  ]);
  assert.deepEqual(many.slice(0, 3).map((shot) => shot.visualDialect), [
    "cover-spatial-hero",
    "real-scale-scene",
    "single-function-layout"
  ]);
  assert.equal(many[0].methodologyId, "provided-lamp-detail-method-v1");
  assert.deepEqual(many.slice(0, 3).map((shot) => shot.category), ["main", "scene", "function"]);
  assert.equal(many.length, 7);
  assert.ok(many.slice(3).some((shot) => /^selling-point-/.test(shot.sequenceSlot)));
  assert.ok(many.slice(3).some((shot) => shot.sequenceSlot === "material-detail"));
});

test("local product fallback still uses detail methodology narrative instead of suite storyboard", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const plan = buildLocalProductMethodologyPlan({
    productName: "胡桃木吊灯",
    lampType: "吊灯",
    lampSubtype: "三头餐吊灯",
    material: "胡桃木+金属",
    colorPalette: "木色、黑色、暖白光",
    requirement: "生成灯具详情图组"
  }, [], { main: 0, selling: 2, function: 2, scene: 3, detail: 2, real: 1 }, settings, "生成灯具详情图组");

  assert.equal(plan.source, "detail-methodology-fallback");
  assert.equal(planHasDetailMethodologyNarrative(plan), true);
  assert.deepEqual(plan.shots.slice(0, 3).map((shot) => shot.promptRoute.sequenceSlot), [
    "detail-cover",
    "scene-context",
    "function-core"
  ]);
  assert.deepEqual(plan.shots.slice(0, 3).map((shot) => shot.category), ["main", "scene", "function"]);
  assert.equal(plan.shots.some((shot) => shot.promptRoute.source === "suite-storyboard"), false);
  assert.equal(plan.shots.every((shot) => shot.promptRoute.methodologyId === "provided-lamp-detail-method-v1"), true);
  assert.match(plan.shots[0].prompt, /详情页首图|封面主视觉|全幅电商详情页封面|材质|光影/);
  assert.match(plan.shots[1].prompt, /完整客厅|完整住宅|真实比例|中远景|房间尺度/);
  assert.match(plan.shots[2].prompt, /核心功能图|只讲一个|不要做八大功能合集/);
  assert.doesNotMatch(plan.shots[1].prompt, /走廊灯阵|复制成走廊灯阵/);
});

test("product workspace detail planner builds large-lamp prompts from recognized profile", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const plan = buildProductWorkspaceDetailPlanFromRecognition({
    product: { requirement: "生成胡桃木餐吊灯完整详情页" },
    recognizedProduct: {
      productName: "胡桃木餐吊灯",
      lampType: "吊灯",
      lampSubtype: "三头餐厅吊灯",
      lampChannel: "large",
      mountFamily: "chandelier",
      scaleClass: "large",
      material: "胡桃木灯臂与黑色金属吊线",
      colorPalette: "胡桃木色、哑黑金属、暖白光",
      visibleParts: "木质横向灯臂、圆形灯罩、黑色吊线、吸顶盘",
      structureKeywords: "三头横向灯臂、吊线、吸顶盘",
      style: "现代日式",
      visualStrategy: {
        productStyle: "现代日式胡桃木餐厅吊灯",
        suitableVisualStyle: "温润自然家居详情页",
        styleKeywords: "木质、克制、温润",
        moodKeywords: "安静、暖意",
        lightingEffect: "柔和下照暖光",
        colorSystem: "胡桃木色、暖白、浅灰",
        visualLanguage: "自然材质特写和完整餐厅空间",
        decorativeElements: "木餐桌、亚麻软装",
        recommendedView: "餐桌外侧中远景",
        hardConstraints: "保留三头灯臂和黑色吊线"
      }
    },
    counts: { scene: 2, function: 1, selling: 1, detail: 1 },
    settings,
    analysis: { source: "unit-vision", model: "unit-model" }
  });
  const text = planPromptText(plan);

  assert.equal(plan.promptDispatch.source, "detail-methodology-planner");
  assert.equal(plan.analysis.source, "unit-vision-detail-methodology");
  assert.equal(plan.profile.lampChannel, "large");
  assert.equal(plan.profile.mountFamily, "chandelier");
  assert.equal(planHasDetailMethodologyNarrative(plan), true);
  assert.ok(plan.shots.every((shot) => shot.promptRoute?.source === "detail-methodology-planner"));
  assert.match(text, /胡桃木餐吊灯|胡桃木灯臂|黑色金属|暖白光|三头横向灯臂|现代日式|柔和下照暖光/);
  assert.doesNotMatch(text, /筒灯|射灯|轨道灯|开孔|面环|深杯|小体量灯位/);
});

test("product workspace detail planner builds small-lamp prompts without large-lamp terms", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const plan = buildProductWorkspaceDetailPlanFromRecognition({
    product: { requirement: "白色深杯筒灯详情页" },
    recognizedProduct: {
      productName: "白色深杯筒灯",
      lampType: "筒灯",
      lampSubtype: "嵌入式防眩筒灯",
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      scaleClass: "small",
      installSurface: "ceiling",
      material: "白色烤漆铝材",
      colorPalette: "哑光白、柔和暖白光",
      visibleParts: "白色面环、深杯反光杯、小发光口",
      structureKeywords: "嵌入式安装、圆形面环、深杯防眩",
      visualStrategy: {
        productStyle: "极简白色防眩筒灯",
        suitableVisualStyle: "干净理性照明详情页",
        styleKeywords: "极简、洁净、专业",
        moodKeywords: "清爽、安静",
        lightingEffect: "低眩柔和下照",
        colorSystem: "白色、浅灰、暖白光",
        visualLanguage: "天花小体量灯位与局部结构说明",
        recommendedView: "走廊或客厅中远景",
        hardConstraints: "保留白色面环和深杯小发光口"
      }
    },
    counts: { scene: 2, function: 1, detail: 1 },
    settings,
    analysis: { source: "unit-vision", model: "unit-model" }
  });
  const text = planPromptText(plan);

  assert.equal(plan.profile.lampChannel, "small");
  assert.equal(plan.profile.mountFamily, "recessed-downlight");
  assert.equal(planHasDetailMethodologyNarrative(plan), true);
  assert.match(text, /白色深杯筒灯|白色面环|深杯反光杯|小发光口|低眩柔和下照|天花小体量灯位/);
  assert.doesNotMatch(text, /完整主灯|一盏\/一套主灯|大型吸顶灯|吊灯|吊线|吊杆|主灯占画面|大体量/);
});

test("product workspace detail planner builds wall-lamp prompts without ceiling lamp contamination", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const plan = buildProductWorkspaceDetailPlanFromRecognition({
    product: { requirement: "床头壁灯详情页" },
    recognizedProduct: {
      productName: "黄铜床头壁灯",
      lampType: "壁灯",
      lampSubtype: "床头阅读壁灯",
      lampChannel: "wall",
      mountFamily: "wall",
      installSurface: "wall",
      material: "拉丝黄铜与奶白玻璃",
      colorPalette: "黄铜金、奶白、暖光",
      visibleParts: "圆形墙面底座、短灯臂、奶白玻璃灯罩",
      structureKeywords: "墙面底座、灯臂、壁装接触面",
      visualStrategy: {
        productStyle: "轻复古黄铜床头壁灯",
        suitableVisualStyle: "卧室氛围详情页",
        styleKeywords: "复古、温润、精致",
        moodKeywords: "柔和、安定",
        lightingEffect: "床头暖光氛围",
        colorSystem: "黄铜金、奶白、暖灰",
        visualLanguage: "完整墙面关系和床头生活场景",
        recommendedView: "床头侧面中远景",
        hardConstraints: "保留圆形墙面底座和短灯臂"
      }
    },
    counts: { scene: 2, function: 1, detail: 1 },
    settings,
    analysis: { source: "unit-vision", model: "unit-model" }
  });
  const text = planPromptText(plan);

  assert.equal(plan.profile.lampChannel, "wall");
  assert.equal(plan.profile.mountFamily, "wall");
  assert.equal(planHasDetailMethodologyNarrative(plan), true);
  assert.match(text, /黄铜床头壁灯|圆形墙面底座|短灯臂|奶白玻璃灯罩|床头暖光氛围|完整墙面关系/);
  assert.doesNotMatch(text, /天花灯位|筒灯|射灯|轨道灯|吊灯|主灯|嵌入式开孔/);
});

test("detail cover and scene fallback prompts use explicit non-closeup spatial lenses", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const cases = [
    buildLocalProductMethodologyPlan({
      productName: "胡桃木吊灯",
      lampType: "吊灯",
      lampSubtype: "餐厅吊灯",
      lampChannel: "large",
      mountFamily: "chandelier",
      material: "胡桃木+金属"
    }, [], { scene: 2, function: 1 }, settings, "生成灯具详情图组"),
    buildLocalProductMethodologyPlan({
      productName: "白色深杯筒灯",
      lampType: "筒灯",
      lampSubtype: "嵌入式筒灯",
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      visibleParts: "白色面环、深杯、小发光口"
    }, [], { scene: 2, function: 1 }, settings, "嵌入式筒灯详情图组"),
    buildLocalProductMethodologyPlan({
      productName: "金属床头壁灯",
      lampType: "壁灯",
      lampSubtype: "床头壁灯",
      lampChannel: "wall",
      mountFamily: "wall",
      installSurface: "wall",
      visibleParts: "墙面底座、灯臂、灯罩"
    }, [], { scene: 2, function: 1 }, settings, "壁灯详情图组")
  ];

  for (const plan of cases) {
    const cover = plan.shots.find((shot) => shot.promptRoute?.sequenceSlot === "detail-cover");
    const scene = plan.shots.find((shot) => shot.promptRoute?.sequenceSlot === "scene-context");
    for (const shot of [cover, scene]) {
      assert.ok(shot, "expected cover and scene shots");
      assertSpatialBriefContract(shot.prompt);
      assert.match(shot.prompt, /中远景|完整.*空间|平视/);
      assert.match(shot.prompt, /真实比例|灯具比例|房间尺度/);
      assertNoNearSceneWords(shot.prompt);
    }
  }
});

test("final cover and scene generation prompts keep non-closeup spatial lens locks", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const large = buildLocalProductMethodologyPlan({
    productName: "胡桃木吊灯",
    lampType: "吊灯",
    lampSubtype: "餐厅吊灯",
    lampChannel: "large",
    mountFamily: "chandelier"
  }, [], { scene: 2, function: 1 }, settings, "生成灯具详情图组");
  const small = buildLocalProductMethodologyPlan({
    productName: "白色深杯筒灯",
    lampType: "筒灯",
    lampSubtype: "嵌入式筒灯",
    lampChannel: "small",
    mountFamily: "recessed-downlight"
  }, [], { scene: 2, function: 1 }, settings, "嵌入式筒灯详情图组");
  const wall = buildLocalProductMethodologyPlan({
    productName: "金属床头壁灯",
    lampType: "壁灯",
    lampSubtype: "床头壁灯",
    lampChannel: "wall",
    mountFamily: "wall",
    installSurface: "wall"
  }, [], { scene: 2, function: 1 }, settings, "壁灯详情图组");

  const prompts = [
    largeLampGenerationPromptFromPlan(large.shots[0].prompt, { profile: large.product, category: large.shots[0].category, settings, shot: large.shots[0] }),
    largeLampGenerationPromptFromPlan(large.shots[1].prompt, { profile: large.product, category: large.shots[1].category, settings, shot: large.shots[1] }),
    smallLampGenerationPromptFromPlan(small.shots[1].prompt, { profile: small.product, category: small.shots[1].category, settings, shot: small.shots[1] }),
    wallLampGenerationPromptFromPlan(wall.shots[1].prompt, { profile: wall.product, category: wall.shots[1].category, settings, shot: wall.shots[1] })
  ];

  for (const prompt of prompts) {
    assertSpatialBriefContract(prompt);
    assert.match(prompt, /首图封面镜头|中远景空间镜头锁|场景镜头|场景[：:].*机位角度/s);
    assert.match(prompt, /房间优先判定/);
    assert.match(prompt, /中远景|完整.*空间|平视/);
    assertNoNearSceneWords(prompt);
  }
});

test("hidden generation guard blocks old spatial prompts from becoming lamp-first images", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    productName: "环形吊灯",
    lampType: "吊灯",
    lampSubtype: "餐厅吊灯",
    lampChannel: "large",
    mountFamily: "chandelier"
  };
  const prompt = hiddenGenerationPrompt("完整餐厅空间，吊灯清晰居中展示。", {
    shot: { category: "scene", promptRoute: { sequenceSlot: "scene-context" } },
    settings,
    profile,
    modelOption: { id: "gpt-image-2", apiModel: "gpt-image-2", provider: "openai" }
  });

  assert.match(prompt, /房间优先判定/);
  assert.match(prompt, /完整外轮廓高≤18%/);
  assert.match(prompt, /下缘≤画面高度35%/);
});

test("integrated product plan rejects closeup cover or scene prompts", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const seed = buildLocalProductMethodologyPlan({
    productName: "胡桃木吊灯",
    lampType: "吊灯",
    lampSubtype: "餐厅吊灯",
    lampChannel: "large",
    mountFamily: "chandelier"
  }, [], { scene: 2, function: 1 }, settings, "生成灯具详情图组");
  const validCoverPrompt = [
    "详情页首图/全幅电商详情页封面设计稿：胡桃木吊灯在温润家居空间中建立第一眼质感。",
    "场景：完整餐厅空间；视角：房间入口正常人眼平视中远景；机位角度：24-35mm轻微斜侧；灯具比例：一盏/一套真实主灯比例，外轮廓高10%-16%，最高18%；画面参照：地面、餐桌椅、墙面、窗/门洞、天花挂点。",
    "文字策略：只生成1行6-12字简体中文短标题，标题融入自然负空间，文字区域不超过画面高度10%-14%，避开底部白条、顶部白条、侧边白条、独立标题栏、纯白文字区、模板海报白块和粗黑大字；材质光影高级。"
  ].join("");
  const validScenePrompt = [
    "真实比例场景图：胡桃木吊灯放入完整餐厅空间。",
    "场景：完整餐厅空间；视角：餐桌外侧正常人眼平视中远景；机位角度：24-35mm轻微斜侧；灯具比例：一盏/一套真实主灯比例，外轮廓高10%-16%，最高18%；画面参照：地面、餐桌椅、墙面、窗/门洞、天花挂点。"
  ].join("");
  const validFunctionPrompt = "核心功能图：只讲一个照明功能卖点，画面用简体中文标题、短说明和光效示意组织，功能主题是柔和照明，结构和照明关系清楚。";
  const baseShots = seed.shots.map((shot, index) => ({
    id: shot.id,
    category: shot.category,
    title: shot.title,
    description: shot.description,
    prompt: index === 0 ? validCoverPrompt : index === 1 ? validScenePrompt : validFunctionPrompt
  }));

  assert.throws(() => normalizeProductPlanResult({
    profile: seed.product,
    shots: baseShots.map((shot, index) => index === 0 ? { ...shot, prompt: `${shot.prompt}\n近景大头展示灯体。` } : shot)
  }, { product: seed.product, counts: { scene: 2, function: 1 }, settings }), /近景或特写/);

  assert.throws(() => normalizeProductPlanResult({
    profile: seed.product,
    shots: baseShots.map((shot, index) => index === 1 ? { ...shot, prompt: `${shot.prompt}\n产品特写，只拍灯体。` } : shot)
  }, { product: seed.product, counts: { scene: 2, function: 1 }, settings }), /近景或特写/);

  assert.throws(() => normalizeProductPlanResult({
    profile: seed.product,
    shots: baseShots.map((shot, index) => index === 1 ? { ...shot, prompt: shot.prompt.replace("外轮廓高10%-16%，最高18%", "高30%，主体巨大") } : shot)
  }, { product: seed.product, counts: { scene: 2, function: 1 }, settings }), /灯具过大|压屏|近景或特写/);
});

test("large lamp hints prevent local detail fallback from becoming small lamp route", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = applyLargeLampProfileFromHints({
    productName: "灯具产品",
    lampType: "灯具",
    lampSubtype: "灯具",
    lampChannel: "generic",
    mountFamily: "generic"
  }, "灯具类目：吊灯，餐厅主灯", {}, settings);

  assert.equal(profile.lampChannel, "large");
  assert.equal(profile.mountFamily, "chandelier");
  assert.equal(profile.scaleClass, "large");

  const plan = buildLocalProductMethodologyPlan(profile, [], { scene: 2, function: 1 }, settings, "灯具类目：吊灯，餐厅主灯");
  assert.equal(plan.product.lampChannel, "large");
  assert.equal(plan.product.mountFamily, "chandelier");
  assert.equal(planHasDetailMethodologyNarrative(plan), true);
  assert.match(plan.shots[1].prompt, /一盏\/一套真实比例主灯|真实比例主灯|真实主灯比例/);
  assert.doesNotMatch(plan.shots[1].prompt, /小体量灯位|嵌入|轨道射灯|筒灯/);
});

test("wall and small selected categories are not promoted to large by negative hints", () => {
  const wall = applyLargeLampProfileFromHints({
    productName: "壁灯产品",
    lampType: "壁灯",
    lampSubtype: "壁灯",
    lampChannel: "wall",
    mountFamily: "wall"
  }, "壁灯，禁止天花主灯和小灯灯位", {}, {
    lampCategory: "wall",
    lampCategoryLabel: "壁灯",
    lampCategoryHint: "壁灯，墙面安装关系，禁止天花主灯和小灯灯位"
  });
  assert.equal(wall.lampChannel, "wall");
  assert.equal(wall.mountFamily, "wall");
  const enhancedWall = enhanceSmallLampProfileFromHints(wall, "壁灯，禁止天花主灯和小灯灯位", {}, {
    lampCategory: "wall",
    lampCategoryLabel: "壁灯",
    lampCategoryHint: "壁灯，墙面安装关系，禁止天花主灯和小灯灯位"
  });
  assert.equal(enhancedWall.lampChannel, "wall");
  assert.equal(enhancedWall.mountFamily, "wall");

  const small = applyLargeLampProfileFromHints({
    productName: "筒灯产品",
    lampType: "嵌入式筒灯",
    lampSubtype: "嵌入式筒灯",
    lampChannel: "small",
    mountFamily: "recessed-downlight"
  }, "小灯，禁止吊灯和完整主灯比例", {}, {
    lampCategory: "recessed-downlight",
    lampCategoryLabel: "嵌入式筒灯",
    lampCategoryHint: "小灯，禁止吊灯和完整主灯比例"
  });
  assert.equal(small.lampChannel, "small");
  assert.equal(small.mountFamily, "recessed-downlight");
});

test("selected lamp category presets steer recognition and gpt design planning", () => {
  const product = {
    lampCategory: "spotlight",
    lampCategoryLabel: "射灯",
    lampCategoryHint: "重点照明射灯，保留灯头、灯杯和转轴结构"
  };
  const settings = {
    imageScope: "detail",
    productPlanMode: "gpt-design-spec-v1",
    lampCategory: "spotlight",
    lampCategoryLabel: "射灯",
    lampCategoryHint: "重点照明射灯，保留灯头、灯杯和转轴结构"
  };
  const recognized = applySelectedLampCategory({
    productName: "灯具产品",
    lampType: "筒灯",
    lampSubtype: "嵌入式筒灯",
    lampChannel: "small",
    mountFamily: "recessed-downlight"
  }, settings);
  const recognitionPrompt = recognitionRequestPrompt(product, "");
  const planningPrompt = productDesignSpecPlanRequestPrompt({
    product,
    counts: { main: 1, scene: 1 },
    settings
  });

  assert.equal(recognized.lampType, "射灯");
  assert.equal(recognized.lampSubtype, "射灯");
  assert.equal(recognized.mountFamily, "spotlight");
  assert.match(recognitionPrompt, /已选择灯具类目：射灯/);
  assert.match(recognitionPrompt, /以该预设为优先类目/);
  assert.match(planningPrompt, /前端预设灯具种类：射灯/);
  assert.match(planningPrompt, /产品定位：用一句话说明灯具类别/);
  assert.match(planningPrompt, /视觉基调/);
  assert.match(planningPrompt, /组图结构/);
  assert.match(planningPrompt, /产品一致性/);
  assert.match(planningPrompt, /电商详情页模块海报/);
  assert.match(planningPrompt, /销售任务/);
  assert.match(planningPrompt, /标题方向/);
  assert.match(planningPrompt, /画面结构/);
  assert.match(planningPrompt, /将该嵌入式射灯\/筒灯真实嵌入石膏板天花板/);
  assert.doesNotMatch(planningPrompt, /关键组件：列出|细节特征：记录|主体结构：描述整体外形/);
});

test("detail methodology hero and function shots keep model-direct text metadata", () => {
  const settings = { imageScope: "detail" };
  const coverShot = {
    category: "main",
    promptRoute: {
      sequenceSlot: "detail-cover",
      methodologyId: "provided-lamp-detail-method-v1",
      visualDialect: "cover-spatial-hero"
    },
    textRenderMode: "model-direct"
  };
  const functionShot = {
    category: "function",
    promptRoute: {
      sequenceSlot: "function-core",
      methodologyId: "provided-lamp-detail-method-v1",
      visualDialect: "single-function-layout"
    },
    textRenderMode: "model-direct"
  };

  assert.equal(textRenderModeForShot(coverShot, "main", settings), "model-direct");
  assert.equal(textRenderModeForShot(functionShot, "function", settings), "model-direct");

  const debug = generationPromptDebug("详情页首图，空间化主视觉，规划好的简体中文标题。", {
    shot: coverShot,
    settings,
    profile: { lampChannel: "large", mountFamily: "chandelier", lampType: "吊灯", scaleClass: "large" }
  });
  assert.equal(debug.methodologyId, "provided-lamp-detail-method-v1");
  assert.equal(debug.visualDialect, "cover-spatial-hero");
  assert.equal(debug.modules.includes("detail-methodology"), true);
  assert.equal(debug.modules.includes("no-visible-text"), false);
});

test("recognition profile normalization dedupes hero style subtype and mood words", () => {
  const profile = sanitizeRecognitionProfile({
    lampType: "\u540a\u706f",
    lampSubtype: "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f",
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    style: "\u8f7b\u6cd5\u5f0f",
    visualStrategy: {
      productStyle: "\u8f7b\u6cd5\u5f0f\u6676\u900f / \u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f",
      moodKeywords: "\u8f7b\u6cd5\u5f0f\u6676\u900f\u3001\u7a7a\u95f4\u4e3b\u706f\u3001\u8ba9\u7a7a\u95f4\u66f4\u6709\u5c42\u6b21"
    }
  });

  assert.equal(profile.style, "\u8f7b\u6cd5\u5f0f");
  assert.equal(profile.lampSubtype, "\u7a7a\u95f4\u4e3b\u706f");
  assert.doesNotMatch(profile.visualStrategy.moodKeywords, /\u8f7b\u6cd5\u5f0f|\u7a7a\u95f4\u4e3b\u706f|\u8ba9\u7a7a\u95f4\u66f4\u6709\u5c42\u6b21/);
  assert.match(profile.visualStrategy.productStyle, /\u8f7b\u6cd5\u5f0f.*\u6676\u900f.*\u7a7a\u95f4\u4e3b\u706f/);
});

test("commerce hero prompt consumes one clean visible line without downstream field rules", () => {
  const prompt = largeLampGenerationPromptFromPlan("\u4efb\u52a1\uff1a\u9996\u5c4f", {
    category: "scene",
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "large",
      mountFamily: "chandelier",
      scaleClass: "large",
      lampType: "\u540a\u706f",
      lampSubtype: "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f",
      style: "\u8f7b\u6cd5\u5f0f",
      visualStrategy: { moodKeywords: "\u6676\u900f" }
    },
    shot: {
      category: "scene",
      promptRoute: { sequenceSlot: "hero-main-space" },
      textRenderMode: "model-direct",
      textOverlay: {
        template: "commerce-detail-hero",
        title: "\u8f7b\u6cd5\u5f0f\u7a7a\u95f4\u4e3b\u706f",
        subtitle: "\u6676\u900f",
        labels: []
      }
    }
  });

  assert.match(prompt, /首图：全幅电商详情页封面设计稿/);
  assert.match(prompt, /\u300c\u8f7b\u6cd5\u5f0f\u6676\u900f\u7a7a\u95f4\u4e3b\u706f\u300d/);
  assert.doesNotMatch(prompt, /\u4e3b\/\u526f\u6807\u9898|\u6807\u7b7e\/\u6807\u6ce8|title|subtitle|labels/i);
  assert.match(prompt, /禁副标题\/标签\/长句/);
});

test("text overlay theme maps visual strategy to stable style tokens", () => {
  const warm = textOverlayTheme({
    lampSubtype: "筒灯",
    targetSpace: "家居客厅",
    visualStrategy: {
      productStyle: "温暖住宅氛围",
      moodKeywords: "柔和、温馨"
    }
  });
  const tech = textOverlayTheme({
    lampSubtype: "线性灯",
    visualStrategy: {
      productStyle: "极简科技办公",
      colorSystem: "冷白、干净"
    }
  });
  const fallback = textOverlayTheme({ lampSubtype: "灯具" });

  assert.equal(warm.themeKey, "warm-home");
  assert.equal(tech.themeKey, "clean-tech");
  assert.equal(fallback.themeKey, "default-commerce");
  assert.ok(warm.theme.titleFill);
  assert.ok(tech.theme.lineFill);
});

test("model-direct hero cover art direction maps visual strategy to cover families", () => {
  assert.equal(modelDirectHeroCoverArtDirection({
    lampSubtype: "彩色多臂吊灯",
    colorPalette: "红、黄、绿、蓝彩色灯罩",
    visualStrategy: { productStyle: "复古彩色编辑感吊灯" }
  }).family, "color-editorial");
  assert.equal(modelDirectHeroCoverArtDirection({
    lampSubtype: "水晶吊灯",
    material: "透明水晶和金属",
    visualStrategy: { moodKeywords: "晶透轻奢" }
  }).family, "crystal-luxury");
  assert.equal(modelDirectHeroCoverArtDirection({
    lampSubtype: "线性灯",
    style: "极简科技办公",
    colorPalette: "冷白、浅灰"
  }).family, "clean-tech");
  assert.equal(modelDirectHeroCoverArtDirection({
    lampSubtype: "金属吊灯",
    material: "哑黑拉丝金属"
  }).family, "dark-premium");
  assert.equal(modelDirectHeroCoverArtDirection({
    lampSubtype: "木质壁灯",
    material: "原木",
    targetSpace: "温润家居卧室"
  }).family, "warm-home");
});

test("detail cover prompt repair upgrades generic short cover into model-short-title design brief", () => {
  const repaired = repairDetailCoverPromptIfNeeded("详情页首图，留出标题层级，背景干净。", {
    target: { category: "main", sequenceSlot: "detail-cover", visualDialect: "cover-spatial-hero" },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      productName: "彩色多臂吊灯",
      lampType: "吊灯",
      lampSubtype: "彩色多臂吊灯",
      colorPalette: "红、黄、绿、蓝彩色灯罩",
      visualStrategy: { productStyle: "复古彩色编辑感吊灯", lightingEffect: "柔和发光球泡" }
    }
  });

  assert.match(repaired, /全幅电商详情页封面设计稿/);
  assert.match(repaired, /只生成1行简体中文短标题/);
  assert.match(repaired, /6-12字/);
  assert.match(repaired, /风格族=color-editorial/);
  assert.match(repaired, /底部白条.*顶部白条.*侧边白条.*独立标题栏.*纯白文字区.*模板海报白块.*粗黑大字/s);
  assert.match(repaired, /文字区域不超过画面高度10%-14%/);
  assert.doesNotMatch(repaired, /留出标题层级|短副标题|少量标签/);
});

test("themed text overlay changes SVG typography without breaking legacy overlay", () => {
  const themed = shotTextOverlaySvgNodes({
    template: "feature-cards",
    title: "核心优势",
    subtitle: "真实材质",
    labels: ["柔和光斑", "安装稳定"],
    themeKey: "clean-tech",
    theme: textOverlayTheme({
      visualStrategy: { productStyle: "极简科技办公" }
    }).theme
  }, { width: 1024, height: 1024 });
  const legacy = shotTextOverlaySvgNodes({
    template: "feature-cards",
    title: "核心优势",
    subtitle: "真实材质",
    labels: ["柔和光斑", "安装稳定"]
  }, { width: 1024, height: 1024 });

  assert.match(themed, /#2f7dd3|#1f5f99|#c8d7e8/);
  assert.match(themed, /font-weight="700"|font-weight="650"/);
  assert.match(legacy, /#9c8f7a|#e4ddd2/);
});

test("commerce hero atmosphere title keeps complete Chinese phrase endings", () => {
  const result = applySmallLampDetailStrategy({
    shots: [
      { id: "scene-1", category: "scene", prompt: "详情首图" },
      { id: "selling-1", category: "selling", prompt: "卖点图" }
    ],
    counts: { main: 0, selling: 1, function: 0, scene: 1, detail: 0, real: 0 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      installSurface: "ceiling",
      lampType: "筒灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "窄边面环、发光口",
      visualStrategy: {
        moodKeywords: "干净克制的家居质感"
      },
      lightUse: "氛围照明"
    }
  });

  const title = result.shots[0].textOverlay?.title || "";
  assert.equal(result.shots[0].textOverlay?.template, "commerce-detail-hero");
  assert.equal(title, "现代精致小灯");
  assert.match(result.shots[0].textOverlay?.subtitle || "", /克制家居质感/);
  assert.doesNotMatch(title, /家居质$/);
});

test("commerce hero copy rejects layout strategy words as visible title", () => {
  const result = applySmallLampDetailStrategy({
    shots: [
      { id: "scene-1", category: "scene", prompt: "详情首图" },
      { id: "selling-1", category: "selling", prompt: "卖点图" }
    ],
    counts: { main: 0, selling: 1, function: 0, scene: 1, detail: 0, real: 0 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "surface-downlight",
      installSurface: "ceiling",
      lampType: "筒灯",
      lampSubtype: "明装筒灯",
      visibleParts: "灯体、发光面",
      visualStrategy: {
        moodKeywords: "干净留白"
      },
      lightUse: "基础照明"
    }
  });

  const overlay = result.shots[0].textOverlay || {};
  assert.equal(overlay.template, "commerce-detail-hero");
  assert.doesNotMatch(overlay.title || "", /干净留白|基础照明/);
  assert.doesNotMatch(overlay.subtitle || "", /干净留白|基础照明/);
});

test("commerce hero copy names the concrete visual atmosphere", () => {
  const result = applyLargeLampDetailStrategy({
    shots: [{ id: "scene-1", category: "scene", prompt: "详情首屏" }],
    counts: { scene: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "large",
      mountFamily: "chandelier",
      scaleClass: "large",
      lampType: "吊灯",
      lampSubtype: "艺术吊灯",
      targetSpace: "客餐厅家装空间",
      lightUse: "氛围照明为主",
      visualStrategy: {
        productStyle: "花朵褶皱、轻盈、艺术吊灯",
        suitableVisualStyle: "轻法式家装商品图",
        moodKeywords: "温暖、治愈、安静、柔光氛围"
      }
    }
  });

  const overlay = result.shots[0].textOverlay || {};
  assert.equal(overlay.template, "commerce-detail-hero");
  assert.equal(overlay.panel, "none");
  assert.equal(overlay.title, "轻法式艺术吊灯");
  assert.match(overlay.subtitle || "", /花影|治愈|客餐厅/);
  assert.doesNotMatch(`${overlay.title}${overlay.subtitle}`, /柔光氛围|氛围照明|照明为主/);
});

test("compactGenerationPrompt removes repeated policy blocks and reports conflicts", () => {
  const repeated = [
    "生成详情页功能图，文字内容：标题：核心优势；标签：柔和光斑。",
    "中国市场输出：画面内如需文字，只能使用简体中文；不得出现繁体字、繁简混用、任何英文字母、英文单词、拼音、英文缩写、乱码、水印、价格或品牌标志。",
    "中国市场输出：画面内如需文字，只能使用简体中文；不得出现繁体字、繁简混用、任何英文字母、英文单词、拼音、英文缩写、乱码、水印、价格或品牌标志。",
    "本图不需要可见文字；不要生成中英文标题、标签、说明、界面元素、装饰字母、水印、价格或品牌标志。",
    "本图不需要可见文字；不要生成中英文标题、标签、说明、界面元素、装饰字母、水印、价格或品牌标志。"
  ].join("\n\n");

  const result = compactGenerationPrompt(repeated, {
    shot: { category: "function", prompt: repeated },
    settings: { imageScope: "detail" },
    profile: {}
  });

  assert.ok(result.meta.dedupedBlocks.length >= 2);
  assert.ok(result.meta.conflictWarnings.includes("text-policy-conflict"));
  assert.equal((result.prompt.match(/中国市场输出/g) || []).length, 1);
  assert.equal((result.prompt.match(/本图不需要可见文字/g) || []).length, 0);
  assert.ok(result.prompt.length < repeated.length);
});

test("compactGenerationPrompt keeps scene prompt out of infographic layout conflicts", () => {
  const prompt = [
    "场景图必须是一张完整连续的真实空间照片感画面；不要拼图、四宫格、多宫格、分屏、画中画、详情页拼版、信息图版式或多张样图合集。",
    "画面提示：完整连续真实客厅空间，中远景，小灯按真实比例安装。",
    "功能图文版式，四宫格参数表，信息图版式。"
  ].join("\n");

  const result = compactGenerationPrompt(prompt, {
    shot: { category: "scene", prompt },
    settings: { imageScope: "detail" },
    profile: {}
  });

  assert.ok(result.meta.conflictWarnings.includes("scene-vs-infographic-conflict"));
  assert.equal(/功能图文版式|四宫格参数表|信息图版式/.test(result.prompt), false);
});

test("compactGenerationPrompt removes whole-prompt text tug-of-war for product workspace", () => {
  const prompt = [
    "本张任务：详情首屏，文字内容：标题：柔和光感；标签：显色好。",
    "上传产品图主体锁（最高优先级）：最终画面里的灯具必须来自用户上传产品图，保留原图主体的轮廓、比例、颜色、材质、发光面、灯杯/灯罩/连接件和可见安装结构；画面风格、场景、版式和文字都不能改变产品款式。",
    "中国市场输出：画面内如需文字，只能使用简体中文；不得出现繁体字、繁简混用、任何英文字母、英文单词、拼音、英文缩写、乱码、水印、价格或品牌标志。",
    "文字：无。",
    "文字内容：标题：柔和光感；标签：显色好。"
  ].join("\n");

  const result = compactGenerationPrompt(prompt, {
    shot: {
      category: "scene",
      textOverlay: { template: "commerce-detail-hero", title: "柔和光感", subtitle: "居家氛围" },
      prompt
    },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: { lampChannel: "small", mountFamily: "surface-downlight", lampType: "小灯", lampSubtype: "明装筒灯" }
  });

  assert.ok(result.meta.conflictWarnings.includes("text-policy-conflict"));
  assert.equal(result.meta.allowText, false);
  assert.match(result.prompt, /文字：无/);
  assert.equal(/文字内容：标题|标签：显色好/.test(result.prompt), false);
});

test("retry policy caps product shot attempts and distinguishes transient/fatal errors", () => {
  assert.equal(generationShotMaxAttempts({}), 3);
  assert.equal(generationShotMaxAttempts({ generationShotMaxAttempts: 8 }), 3);
  assert.equal(remainingGenerationApiAttempts({ maxActualApiAttempts: 3, actualApiAttempts: 2 }), 1);

  const transient = new Error("Bad gateway");
  transient.status = 502;
  assert.equal(isTransientGenerationError(transient), true);
  assert.equal(isFatalGenerationError(transient), false);

  const fatal = new Error("invalid api key");
  fatal.status = 401;
  assert.equal(isFatalGenerationError(fatal), true);
});

test("small lamp visible copy removes unconfirmed metrics and planning residue", () => {
  const profile = {
    lampSubtype: "明装筒灯",
    sellingPoint: "深杯防眩（UGR≤6 文案方向）、小巧灯体（灯高约5.9cm 文案方向）、金属拉丝、明装贴顶"
  };

  const text = smallLampTrustedSellingText(profile);

  assert.equal(/UGR|5\.9|灯高|文案/.test(text), false);
  assert.ok(text.includes("金属拉丝"));
  assert.ok(text.includes("明装贴顶"));
});

test("small lamp visible copy keeps explicitly provided metrics", () => {
  const profile = {
    colorTemperature: "3000K/4000K",
    ugr: "≤6",
    sellingPoint: "深杯防眩、UGR≤6、色温3000K/4000K、明装贴顶"
  };

  const text = smallLampSanitizeEvidenceText(profile.sellingPoint, profile, { maxItems: 6, maxLength: 12 });

  assert.ok(text.includes("深杯防眩"));
  assert.ok(text.includes("色温3000"));
  assert.ok(text.includes("明装贴顶"));
});

test("small lamp hint fallback promotes generic profile into detail strategy profile", () => {
  const profile = enhanceSmallLampProfileFromHints(
    {
      productName: "灯具产品",
      lampType: "灯具",
      lampSubtype: "灯具",
      lampChannel: "generic",
      mountFamily: "generic"
    },
    "根据上传产品图识别这款小型明装深杯灯具，生成13张详情页",
    {}
  );

  assert.equal(profile.lampChannel, "small");
  assert.equal(profile.mountFamily, "surface-downlight");
  assert.equal(profile.lampSubtype, "明装小筒灯");
  assert.equal(/UGR|5\.9|功率|电压/.test(profile.sellingPoint), false);
});

test("explicit surface small lamp hint overrides wall-light contamination", () => {
  const profile = enhanceSmallLampProfileFromHints(
    {
      productName: "金属可调壁灯/床头阅读灯（带圆形底座）",
      lampType: "wall light",
      lampSubtype: "adjustable spotlight wall light",
      lampChannel: "wall",
      mountFamily: "wall",
      installSurface: "wall",
      installationMethod: "壁装固定（圆形底座）",
      visibleParts: "圆形底座、立柱支架、可调灯头、侧面旋钮、外露电线、金属连接臂",
      structureKeywords: "壁装,圆形底座,可调灯头,金属拉丝,外露电线"
    },
    "明装小灯，生成灯具详情图组",
    { requirement: "明装小灯" },
    { imageScope: "detail", workspaceStrategyVersion: 1 }
  );

  assert.equal(profile.lampChannel, "small");
  assert.equal(profile.mountFamily, "surface-downlight");
  assert.equal(profile.installSurface, "ceiling");
  assert.match(profile.visibleParts, /贴顶|发光口/);
  assert.equal(/壁灯|wall|圆形底座|立柱支架|旋钮|外露电线|连接臂|床头|阅读灯/.test([
    profile.productName,
    profile.lampSubtype,
    profile.installationMethod,
    profile.visibleParts,
    profile.structureKeywords,
    profile.visualStrategy?.hardConstraints
  ].join(" ")), false);
});

test("product detail suites use configured Yunwu concurrency", () => {
  assert.equal(generationConcurrency({ imageScope: "detail", workspaceStrategyVersion: 1, totalShotCount: 13 }, "云雾 API"), 5);
  assert.equal(generationConcurrency({ imageScope: "detail", workspaceStrategyVersion: 1, totalShotCount: 4 }, "云雾 API"), 5);
});

test("generic long detail fallback no longer enters small lamp channel without evidence", () => {
  const profile = fallbackSmallLampProfileForLongDetailSuite({
    productName: "灯具产品",
    lampType: "灯具",
    lampSubtype: "灯具",
    lampChannel: "generic",
    mountFamily: "generic"
  });

  assert.equal(profile.lampChannel, "generic");
  assert.equal(profile.mountFamily, "generic");
  assert.equal(/UGR|RG0|功率|电压|5\.9/.test(profile.sellingPoint), false);
});

test("small lamp spec gate removes model-only metrics but keeps user-provided specs", () => {
  const modelOnly = gateSmallLampSpecEvidence({
    lampChannel: "small",
    mountFamily: "surface-downlight",
    lampType: "小灯",
    lampSubtype: "明装筒灯",
    sellingPoint: "深杯防眩，UGR≤6，高显指≥98，低蓝光护眼RG0",
    ugr: "≤6",
    cri: "≥98",
    rgLevel: "RG0"
  }, {}, "");

  assert.equal(modelOnly.ugr, "");
  assert.equal(modelOnly.cri, "");
  assert.equal(modelOnly.rgLevel, "");
  assert.equal(/UGR|RG0|98/.test(modelOnly.sellingPoint), false);

  const userProvided = gateSmallLampSpecEvidence({
    lampChannel: "small",
    mountFamily: "surface-downlight",
    lampType: "小灯",
    lampSubtype: "明装筒灯",
    sellingPoint: "UGR≤6，高显指≥98",
    ugr: "≤6",
    cri: "≥98"
  }, { ugr: "≤6", cri: "≥98" }, "");

  assert.equal(userProvided.ugr, "≤6");
  assert.equal(userProvided.cri, "≥98");
});

test("small lamp residential detail sequence starts with text-capable home atmosphere and limits close-ups", () => {
  const sequence = smallLampDetailSequenceCatalog();
  assert.equal(sequence.length, 13);
  assert.equal(sequence[0].id, "hero-atmosphere");
  assert.equal(sequence[0].category, "scene");
  assert.match(sequence[0].allowedText, /舒适光感|精致小灯/);
  assert.ok(sequence.filter((slot) => slot.category === "detail").length <= 2);
  assert.ok(sequence.filter((slot) => slot.category === "scene").length >= 5);
  assert.equal(sequence.some((slot) => /商业|展厅|办公|酒店|零售|柜台/.test(`${slot.title}${slot.visualGoal}${slot.composition}${slot.contentClaim}`)), false);
});

test("small lamp detail strategy rewrites 13 shots into residential storyboard", () => {
  const shots = Array.from({ length: 13 }, (_, index) => ({
    id: `shot-${index + 1}`,
    category: index % 3 === 0 ? "detail" : "selling",
    prompt: "生成小灯详情页"
  }));
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    lampChannel: "small",
    mountFamily: "surface-downlight",
    lampType: "小灯",
    lampSubtype: "明装筒灯",
    material: "银色拉丝金属"
  };
  const result = applySmallLampDetailStrategy({
    shots,
    counts: { selling: 13 },
    settings,
    profile
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 13);
  assert.equal(result.shots[0].promptRoute.sequenceSlot, "hero-atmosphere");
  assert.equal(result.shots[0].category, "scene");
  assert.equal(result.shots[0].textOverlay?.template, "commerce-detail-hero");
  assert.equal(/金属微光|克制光感/.test(result.shots[0].textOverlay?.title || ""), false);
  assert.equal(result.shots[4].textOverlay?.template, "advantage-editorial");
  assert.match(result.shots[4].generationPrompt, /模型直接生成规划好的简体中文/);
  assert.equal(result.shots[1].promptRoute.sequenceSlot, "living-room-scene");
  assert.equal(result.shots[1].category, "scene");
  assert.equal(result.shots[2].promptRoute.sequenceSlot, "product-mood");
  assert.equal(result.shots[2].category, "main");
  assert.equal(/文字内容：无/.test(result.shots[0].prompt), false);
  assert.match(result.shots[0].prompt, /文字内容：标题：/);
  assert.equal(/文字内容：标题：金属微光|文字内容：标题：克制光感/.test(result.shots[0].prompt), false);
  assert.match(result.shots[0].generationPrompt, /首图：全幅电商详情页封面设计稿/);
  assert.match(result.shots[0].generationPrompt, /主体数量：1个清晰小灯位/);
  assert.match(result.shots[0].generationPrompt, /体积：单灯≤画面宽2%/);
  assert.match(result.shots[0].generationPrompt, /镜头角度：入口视角平视中远景/);
  assert.match(result.shots[0].generationPrompt, /安装\/出光角度：明装贴顶垂直下照/);
  assert.match(result.shots[0].generationPrompt, /主体上限：≤3个可辨认小灯主体/);
  assert.match(result.shots[0].generationPrompt, /不做放大产品主体/);
  assert.equal(/套图视觉系统|整体主题|用户补充/.test(result.shots[0].prompt), false);
  assert.match(result.shots[0].prompt, /主体数量：1个清晰小灯位|不做放大产品主体/);
  assert.ok(result.shots[0].prompt.length < 260);
  assert.ok(result.shots.every((shot) => /主体上限：≤3个/.test(shot.prompt) && /镜头角度：/.test(shot.prompt) && /安装\/出光角度：/.test(shot.prompt)));
  assert.match(result.shots.find((shot) => shot.promptRoute?.sequenceSlot === "living-room-scene")?.generationPrompt || "", /主体数量：1-2个灯位/);
  assert.match(result.shots.find((shot) => shot.promptRoute?.sequenceSlot === "corridor-scene")?.generationPrompt || "", /主体数量：2-3个灯位/);
  assert.equal((result.shots[0].generationPrompt.match(/画面宽2%/g) || []).length, 1);
  assert.doesNotMatch(result.shots[0].generationPrompt, /画面宽3%-4%|画面宽4%|场景比例锁|房间优先判定/);
  const styleLocks = result.shots.map((shot) => (shot.generationPrompt.match(/套图风格锁[^\n]+/) || [""])[0]);
  assert.ok(styleLocks.every(Boolean));
  assert.equal(new Set(styleLocks).size, 1);
  assert.match(styleLocks[0], /金属微光|银黑金属/);
  const sceneFocusLines = result.shots
    .filter((shot) => shot.category === "scene")
    .map((shot) => (shot.generationPrompt.match(/重点：[^\n]+/) || [""])[0]);
  assert.ok(sceneFocusLines.every((line) => /空间|光感|光斑|居住|灯位比例|尺度/.test(line)));
  assert.equal(sceneFocusLines.some((line) => /灯杯|面环|发光口|顶部贴顶接触面|底部发光口/.test(line)), false);
  assert.equal(/整套视觉统一规则/.test(result.shots[0].generationPrompt), false);
  assert.equal(/文字：无/.test(result.shots[2].generationPrompt), true);
  assert.equal(/UGR|RG0|FPF|显指|商业空间|展厅|办公|酒店|零售/.test(result.shots[0].generationPrompt), false);
  assert.ok(result.shots.filter((shot) => shot.category === "detail").length <= 2);
  assert.equal(result.shots.some((shot) => /商业空间|展厅|办公|酒店|零售|柜台/.test(`${shot.prompt}\n${shot.generationPrompt}`)), false);
  assert.ok(result.shots[0].generationPrompt.length < 660);
});

test("small lamp full detail counts with main image still uses residential detail strategy", () => {
  const shots = Array.from({ length: 13 }, (_, index) => ({
    id: `shot-${index + 1}`,
    category: index === 0 ? "main" : "scene",
    prompt: "生成小灯完整详情页"
  }));
  const result = applySmallLampDetailStrategy({
    shots,
    counts: { main: 1, selling: 1, function: 2, scene: 4, detail: 3, real: 2 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      lampType: "小灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "白色面环、深杯、小发光口"
    }
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 13);
  assert.equal(result.shots[0].promptRoute.source, "small-lamp-detail-strategy");
  assert.equal(result.shots[0].promptRoute.sequenceSlot, "hero-atmosphere");
  assert.match(result.shots[0].generationPrompt, /天花.*12%-18%/);
  assert.match(result.shots[0].generationPrompt, /平视/);
  assert.equal(result.shots.some((shot) => /商业空间|展厅|办公|酒店|零售|柜台/.test(`${shot.prompt}\n${shot.generationPrompt}`)), false);
});

test("small lamp short mixed detail plans do not fall back to suite storyboard", () => {
  const result = applySmallLampDetailStrategy({
    shots: [
      { id: "main-1", category: "main", prompt: "生成小灯主图" },
      { id: "scene-1", category: "scene", prompt: "生成小灯场景图" },
      { id: "detail-1", category: "detail", prompt: "生成小灯细节图" }
    ],
    counts: { main: 1, scene: 1, detail: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "surface-downlight",
      lampType: "小灯",
      lampSubtype: "明装筒灯",
      visibleParts: "短圆柱灯体、黑色深杯、小发光口"
    }
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 3);
  assert.equal(result.shots.every((shot) => shot.promptRoute?.source === "small-lamp-detail-strategy"), true);
  assert.equal(result.shots.some((shot) => shot.promptRoute?.source === "suite-storyboard"), false);
  assert.equal(result.shots.some((shot) => /商业|展厅|办公|酒店|零售|柜台/.test(`${shot.prompt}\n${shot.generationPrompt}`)), false);
});

test("small lamp pure main request is not expanded into detail storyboard", () => {
  const result = applySmallLampDetailStrategy({
    shots: [{ id: "main-1", category: "main", prompt: "生成小灯主图" }],
    counts: { main: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "surface-downlight",
      lampType: "小灯",
      lampSubtype: "明装筒灯"
    }
  });

  assert.equal(result.applied, false);
});

test("generic small lamp detail-suite wording honors selected short count", () => {
  const result = applySmallLampDetailStrategy({
    shots: [
      { id: "selling-1", category: "selling", prompt: "生成灯具详情图组" },
      { id: "function-1", category: "function", prompt: "生成灯具详情图组" },
      { id: "scene-1", category: "scene", prompt: "生成灯具详情图组" },
      { id: "detail-1", category: "detail", prompt: "生成灯具详情图组" },
      { id: "real-1", category: "real", prompt: "生成灯具详情图组" }
    ],
    counts: { selling: 1, function: 1, scene: 1, detail: 1, real: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    userRequirement: "生成灯具详情图组",
    profile: {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      lampType: "小灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "金属圆形面环、深杯、中央透镜、弹簧卡扣、电源线、黑色散热器",
      material: "金属+塑料（散热器）"
    }
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 5);
  assert.deepEqual(result.shots.map((shot) => shot.promptRoute.sequenceSlot), [
    "hero-atmosphere",
    "core-advantages",
    "material-closeup",
    "anti-glare-cup",
    "product-shoot"
  ]);
  assert.equal(/用户补充：生成灯具详情图组/.test(result.shots[0].prompt), false);
  assert.equal(result.shots.some((shot) => /商业空间|展厅|办公|酒店|零售|柜台|店铺/.test(`${shot.prompt}\n${shot.generationPrompt}`)), false);
  const earlyPrompts = result.shots.slice(0, 5).map((shot) => shot.generationPrompt).join("\n");
  assert.equal(/电源线|黑色散热器|金属\+塑料（散热器）/.test(earlyPrompts), false);
  assert.equal(/弹簧卡扣/.test(earlyPrompts), false);
});

test("explicit 13-shot small lamp request expands short counts to complete chain", () => {
  const result = applySmallLampDetailStrategy({
    shots: [
      { id: "selling-1", category: "selling", prompt: "生成灯具详情图组" },
      { id: "function-1", category: "function", prompt: "生成灯具详情图组" },
      { id: "scene-1", category: "scene", prompt: "生成灯具详情图组" },
      { id: "detail-1", category: "detail", prompt: "生成灯具详情图组" },
      { id: "real-1", category: "real", prompt: "生成灯具详情图组" }
    ],
    counts: { selling: 1, function: 1, scene: 1, detail: 1, real: 1 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    userRequirement: "生成13张灯具详情图组",
    profile: {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      lampType: "小灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "金属圆形面环、深杯、中央透镜、弹簧卡扣、电源线、黑色散热器",
      material: "金属+塑料（散热器）"
    }
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 13);
  assert.deepEqual(result.shots.slice(0, 6).map((shot) => shot.promptRoute.sequenceSlot), [
    "hero-atmosphere",
    "living-room-scene",
    "product-mood",
    "bedroom-study-scene",
    "core-advantages",
    "anti-glare-cup"
  ]);
  assert.equal(/用户补充：生成13张灯具详情图组/.test(result.shots[0].prompt), false);
  assert.equal(result.shots.some((shot) => /商业空间|展厅|办公|酒店|零售|柜台|店铺/.test(`${shot.prompt}\n${shot.generationPrompt}`)), false);
});

test("suite storyboard scene hidden prompt prevents low ceiling and commercial drift", () => {
  const prompt = suiteStoryboardHiddenPrompt({
    category: "scene",
    title: "场景图 1 · 客餐厅应用",
    promptRoute: {
      suiteSlot: "living-scene",
      suiteRole: "展示家居主场景",
      suiteFocus: "真实空间尺度和自然照明氛围",
      suiteComposition: "客厅或餐厅完整连续空间"
    }
  });

  assert.match(prompt, /住宅平视构图硬锁/);
  assert.match(prompt, /12%-18%/);
  assert.match(prompt, /30%-40%/);
  assert.match(prompt, /只做住宅家装空间/);
  assert.equal(/商业|展厅|办公|酒店|零售|柜台/.test(prompt), false);
});

test("generic short detail suites always start with a detail cover shot", () => {
  const result = applySuiteStoryboardStrategy({
    shots: [
      { id: "selling-1", category: "selling", title: "卖点图 1", prompt: "产品核心卖点" },
      { id: "function-1", category: "function", title: "功能图 1", prompt: "功能总览" },
      { id: "scene-1", category: "scene", title: "场景图 1", prompt: "家装场景" }
    ],
    counts: { main: 0, selling: 1, function: 1, scene: 1, detail: 0, real: 0 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "generic",
      mountFamily: "generic",
      productName: "金属装饰灯",
      material: "银色拉丝金属",
      visibleParts: "金属灯体、发光面、侧面旋钮"
    },
    userRequirement: "生成灯具详情图组"
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots[0].promptRoute?.suiteSlot, "detail-cover");
  assert.equal(result.shots[0].textOverlay?.template, "commerce-detail-hero");
  assert.match(result.shots[0].title, /详情 1/);
  assert.match(result.shots[0].prompt, /详情页封面首图/);
  assert.equal(/本张是/.test(result.shots[0].prompt), false);
});

test("wall lamp detail strategy rewrites 13 shots into varied premium narrative", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    productName: "金属可调壁灯",
    lampChannel: "wall",
    mountFamily: "wall",
    installSurface: "wall",
    lampType: "壁灯",
    lampSubtype: "床头壁灯",
    visibleParts: "圆形墙面底座、金属灯臂、可调灯头、磨砂发光面",
    material: "银色拉丝金属",
    sellingPoint: "墙面氛围照明、可调阅读光、金属质感"
  };
  const result = applyWallLampDetailStrategy({
    shots: Array.from({ length: 13 }, (_, index) => ({
      id: `wall-${index + 1}`,
      category: index === 0 ? "scene" : "selling",
      prompt: "生成13张壁灯详情图组"
    })),
    counts: { main: 1, selling: 2, function: 2, scene: 4, detail: 3, real: 1 },
    settings,
    profile,
    userRequirement: "生成13张壁灯详情图组"
  });

  assert.equal(result.applied, true);
  assert.equal(result.shots.length, 13);
  assert.equal(wallLampDetailSequenceCatalog().length, 13);
  assert.equal(result.shots.every((shot) => shot.promptRoute?.source === "wall-lamp-detail-strategy"), true);
  assert.equal(result.shots[0].promptRoute.sequenceSlot, "wall-hero-atmosphere");
  assert.equal(result.shots[0].category, "scene");
  assert.equal(result.shots[0].textOverlay?.template, "commerce-detail-hero");
  assert.match(result.shots[0].generationPrompt, /首图：全幅电商详情页封面设计稿/);
  assert.doesNotMatch(result.shots[0].textOverlay?.title || "", /金属微光|克制光感/);

  const scaleBands = result.shots.map((shot) => shot.promptRoute?.scaleBand).filter(Boolean);
  const cameraAngles = result.shots.map((shot) => shot.promptRoute?.cameraAngle).filter(Boolean);
  assert.equal(scaleBands.length, 13);
  assert.equal(cameraAngles.length, 13);
  for (let index = 1; index < result.shots.length; index += 1) {
    const sameCamera = result.shots[index].promptRoute.cameraAngle === result.shots[index - 1].promptRoute.cameraAngle;
    const sameDistance = result.shots[index].promptRoute.distanceClass === result.shots[index - 1].promptRoute.distanceClass;
    assert.equal(sameCamera && sameDistance, false);
  }
  const closeupRuns = result.shots.reduce((runs, shot) => {
    const last = runs[runs.length - 1] || [];
    if (shot.promptRoute.distanceClass === "close") {
      if (last[0]?.promptRoute?.distanceClass === "close") last.push(shot);
      else runs.push([shot]);
    }
    return runs;
  }, []);
  assert.ok(closeupRuns.every((run) => run.length <= 2));
  assert.ok(result.shots.filter((shot) => shot.category === "scene").every((shot) => /完整|中远景|墙面|空间|地面|门洞|床头|走廊/.test(shot.generationPrompt)));
});

test("wall lamp final prompts stay compact and avoid generic small or large residues", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    productName: "金属可调壁灯",
    lampChannel: "wall",
    mountFamily: "wall",
    installSurface: "wall",
    lampType: "壁灯",
    lampSubtype: "床头壁灯",
    visibleParts: "圆形墙面底座、金属灯臂、可调灯头、磨砂发光面",
    material: "银色拉丝金属",
    sellingPoint: "墙面氛围照明、可调阅读光、金属质感"
  };
  const plan = applyWallLampDetailStrategy({
    shots: Array.from({ length: 13 }, (_, index) => ({
      id: `wall-${index + 1}`,
      category: "scene",
      prompt: "生成13张壁灯详情图组"
    })),
    counts: { scene: 13 },
    settings,
    profile,
    userRequirement: "生成13张壁灯详情图组"
  });

  assert.equal(plan.applied, true);
  for (const shot of plan.shots) {
    const compacted = compactGenerationPrompt(
      hiddenGenerationPrompt(shot.generationPrompt, {
        shot,
        settings,
        profile,
        modelOption: { id: "nanobanana2-pro", apiModel: "nanobanana2-pro" }
      }),
      { shot, settings, profile }
    );
    const prompt = compacted.prompt;

    assert.ok(prompt.length < 900, `${shot.promptRoute?.sequenceSlot || shot.id} prompt length ${prompt.length}`);
    assert.equal(compacted.meta.conflictWarnings.includes("mount-family-mixed"), false);
    assert.match(prompt, /主体守门/);
    assert.equal(/小灯灯位|大灯主灯|完整主灯|吊灯|轨道|suite-storyboard|套图脚本锁|商品图策略|bbox|referenceTarget|scaleHint/.test(prompt), false);
    if (shot.promptRoute?.sequenceSlot === "wall-hero-atmosphere") {
      assert.equal(shot.textOverlay?.template, "commerce-detail-hero");
      assert.match(prompt, /文字守门/);
      assert.doesNotMatch(prompt, /底图不要生成任何可见文字|后置高级简体中文标题/);
    }
    if (shot.category === "scene") {
      assert.match(prompt, /完整住宅墙面|家具|门洞|床头|走廊|地面|真实比例壁灯/);
      assert.equal(/产品近景/.test(prompt), false);
    }
  }
});

test("small lamp final generation prompt stays compact for nanobanana/pro style models", () => {
  const profile = {
    lampChannel: "small",
    mountFamily: "recessed-downlight",
    lampType: "小灯",
    lampSubtype: "嵌入式筒灯",
    visibleParts: "白色面环、深杯、小发光口",
    material: "白色喷涂金属"
  };
  const shot = {
    category: "scene",
    title: "场景图 1 · 家装氛围首屏",
    promptRoute: { sequenceSlot: "hero-atmosphere" }
  };
  const visible = smallLampGenerationPromptFromPlan(
    [
      "本张任务：家装氛围首屏：家装空间氛围首屏，无文字，无参数，只建立居住光感和产品气质",
      "画面提示：真实住宅空间封面图，正常人眼平视中远景，天花只占画面上方 12%-18%，下方 30%-40% 能看到地面/地毯/家具底部，空间有舒展层高、完整墙面、窗/门洞和家具尺度；小灯按真实比例安装，灯具服务空间氛围，不做卖点海报、参数页、卡片或天花近景",
      "展示重点：家装空间里的舒适光感、真实安装比例、墙面/地面光斑和居住氛围",
      "文字内容：无"
    ].join("\n"),
    { profile, category: "scene", shot }
  );
  const finalPrompt = hiddenGenerationPrompt(visible, {
    shot,
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile,
    modelOption: { id: "nanobanana2-pro", apiModel: "nanobanana2-pro" }
  });
  const compacted = compactGenerationPrompt(finalPrompt, {
    shot,
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile
  });

  assert.ok(visible.length < 420);
  assert.ok(compacted.prompt.length < 760);
  assert.match(compacted.prompt, /主体守门/);
  assert.match(compacted.prompt, /文字：无/);
  assert.equal(/模型直接排版|bbox|referenceTarget|scaleHint/.test(compacted.prompt), false);
  assert.equal(/套图视觉系统|整套视觉统一规则|category-boundary|商业|展厅|办公|酒店|零售|柜台|bbox|referenceTarget|scaleHint/.test(compacted.prompt), false);
});

test("small lamp detail final prompts stay on dedicated route across mount families", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profiles = [
    {
      lampChannel: "small",
      mountFamily: "surface-downlight",
      lampType: "小灯",
      lampSubtype: "明装筒灯",
      visibleParts: "短圆柱灯体、黑色深杯、小发光口",
      material: "银色拉丝金属"
    },
    {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      lampType: "小灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "白色面环、深杯、小发光口",
      material: "白色喷涂金属"
    },
    {
      lampChannel: "small",
      mountFamily: "track-spotlight",
      lampType: "小灯",
      lampSubtype: "轨道射灯",
      visibleParts: "细窄导轨、小灯头、转轴连接",
      material: "黑色喷涂金属"
    }
  ];

  for (const profile of profiles) {
    const shots = Array.from({ length: 13 }, (_, index) => ({
      id: `shot-${index + 1}`,
      category: index === 0 ? "main" : "scene",
      prompt: "生成小灯完整详情页"
    }));
    const plan = applySmallLampDetailStrategy({
      shots,
      counts: { main: 1, selling: 1, function: 2, scene: 4, detail: 3, real: 2 },
      settings,
      profile
    });
    assert.equal(plan.applied, true);
    assert.equal(plan.shots.every((shot) => shot.promptRoute?.source === "small-lamp-detail-strategy"), true);

    for (const shot of plan.shots) {
      const prompt = compactGenerationPrompt(
        hiddenGenerationPrompt(shot.generationPrompt, {
          shot,
          settings,
          profile,
          modelOption: { id: "nanobanana2-pro", apiModel: "nanobanana2-pro" }
        }),
        { shot, settings, profile }
      ).prompt;
      assert.ok(prompt.length < 800, `${profile.mountFamily} ${shot.promptRoute?.sequenceSlot || shot.title || shot.id} prompt length ${prompt.length}`);
      assert.equal(/suite-storyboard|商业|展厅|办公|酒店|零售|柜台|YINGSHU|普瑞|UGR≤6|RG0|FPF|显指≥98/.test(prompt), false);
    }
  }
});

test("recessed small lamp detail prompts front-load embedded quantity and angle rules", () => {
  const shots = Array.from({ length: 13 }, (_, index) => ({
    id: `shot-${index + 1}`,
    category: "scene",
    prompt: "生成嵌入式小灯家装详情页"
  }));
  const result = applySmallLampDetailStrategy({
    shots,
    counts: { scene: 13 },
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 },
    profile: {
      lampChannel: "small",
      mountFamily: "recessed-downlight",
      lampType: "小灯",
      lampSubtype: "嵌入式筒灯",
      visibleParts: "白色面环、深杯、小发光口"
    }
  });

  const spatialShots = result.shots.filter((shot) => /hero-atmosphere|living-room-scene|corridor-scene|bedroom-study-scene/.test(String(shot.promptRoute?.sequenceSlot || "")));
  assert.ok(spatialShots.length >= 4);
  for (const shot of spatialShots) {
    if (shot.promptRoute?.sequenceSlot === "hero-atmosphere") {
      assert.match(shot.generationPrompt, /主体数量：1个清晰小灯位/);
      assert.match(shot.generationPrompt, /体积：单灯≤画面宽2%/);
    } else if (shot.promptRoute?.sequenceSlot === "corridor-scene") {
      assert.match(shot.generationPrompt, /主体数量：2-3个灯位/);
      assert.match(shot.generationPrompt, /体积：单灯≤画面宽3%/);
    } else {
      assert.match(shot.generationPrompt, /主体数量：1-2个灯位/);
      assert.match(shot.generationPrompt, /体积：单灯≤画面宽3%/);
    }
    assert.match(shot.generationPrompt, /镜头角度：/);
    assert.match(shot.generationPrompt, /安装\/出光角度：嵌入式垂直下照/);
    assert.match(shot.generationPrompt, /主体上限：≤3个可辨认小灯主体/);
    assert.match(shot.generationPrompt, /只露面环\/深杯\/灯杯\/小发光口/);
    assert.match(shot.generationPrompt, /灯杯|深杯|发光口/);
    assert.equal(/再(?:缩小|小)\s*25%|再收小\s*25%|45%-50%|画面宽3%-4%|画面宽4%|场景比例锁/.test(shot.generationPrompt), false);
    assert.equal(/贴顶安装|明装圆柱|贴顶圆柱|完整外露筒身|顶部贴顶接触面|顶部接触天花/.test(shot.generationPrompt), false);
  }
  const productMood = result.shots.find((shot) => shot.promptRoute?.sequenceSlot === "product-mood");
  assert.equal(productMood.category, "main");
  assert.match(productMood.generationPrompt, /文字：无/);
  assert.equal(/弹簧卡扣|电源线|散热鳍片/.test(productMood.generationPrompt), false);
  assert.match(productMood.generationPrompt, /文字：无/);
});

test("recessed small lamp consistency lock does not forbid embedded products", () => {
  const profile = {
    lampChannel: "small",
    mountFamily: "recessed-downlight",
    lampType: "小灯",
    lampSubtype: "嵌入式射灯",
    visibleParts: "白色面环、深杯灯杯、小发光口",
    material: "白色喷涂金属"
  };

  const prompt = productWorkspaceConsistencyPrompt("scene", profile, { imageScope: "detail", workspaceStrategyVersion: 1 });

  assert.match(prompt, /嵌入式筒灯\/射灯结构硬锁/);
  assert.match(prompt, /灯体主体隐藏在吊顶内/);
  assert.match(prompt, /不得把嵌入式筒灯\/射灯改成明装筒灯/);
  assert.equal(/不得把小灯改成嵌入式/.test(prompt), false);
});

test("embedded spotlight wording routes through recessed downlight planning", () => {
  const profile = sanitizeRecognitionProfile({
    lampChannel: "small",
    mountFamily: "generic",
    lampType: "小灯",
    lampSubtype: "嵌入式射灯",
    visibleParts: "圆形面环、深杯灯杯、小发光口"
  });
  const planPrompt = productPlanRequestPrompt({
    product: { requirement: "嵌入式射灯详情页" },
    counts: { scene: 1, detail: 1 },
    layout: "嵌入式射灯详情页",
    settings: { imageScope: "detail", workspaceStrategyVersion: 1 }
  });

  assert.equal(profile.mountFamily, "recessed-downlight");
  assert.match(planPrompt, /嵌入式射灯.*recessed-downlight|recessed-downlight.*嵌入式射灯/s);
  assert.match(planPrompt, /只露面环、深杯\/灯杯、小发光口和聚光光斑/);
  assert.match(planPrompt, /不写明装贴顶圆柱、外露筒身、外露转轴或轨道结构/);
});

test("small lamp prompt conflict detector ignores negative mount-family clauses", () => {
  const prompt = [
    "明装筒灯结构硬锁：整灯是短小贴顶圆柱，完整灯体外露，顶部整面贴合天花。",
    "明装筒灯绝对禁止：嵌入式开孔面环、轨道连接件、转轴和支架。",
    "天花不开孔，不齐平嵌入，不只露面环。"
  ].join("\n");
  assert.equal(detectPromptConflicts(prompt, { category: "scene", allowText: false }).includes("mount-family-mixed"), false);
});

test("small lamp audit reports blocked reference-template specs", () => {
  const profile = {
    lampChannel: "small",
    mountFamily: "surface-downlight",
    lampType: "小灯",
    lampSubtype: "明装筒灯",
    sellingPoint: "UGR≤6、显指≥98、RG0、银色拉丝",
    ugr: "≤6",
    cri: "≥98",
    rgLevel: "RG0"
  };
  const audit = smallLampProfileAudit(profile, {}, "参考图含 YINGSHU、普瑞芯片、UGR≤6、RG0、FPF≤0.05%");
  assert.ok(audit.warnings.includes("reference-template-text-not-used-as-spec-evidence"));
  assert.ok(audit.blockedTerms.includes("ugr"));
  assert.ok(audit.blockedTerms.includes("cri"));
  assert.ok(audit.blockedTerms.includes("rg"));
});

test("product support inputs are constrained as references, not extra subjects", () => {
  const instruction = generationInputRoleInstruction(
    { inputRole: "product-support", originalname: "side-view.png" },
    1,
    { settings: { imageScope: "detail" } }
  );

  assert.match(instruction, /补充角度\/结构参考/);
  assert.match(instruction, /不要.*第二个可见主体/);
  assert.doesNotMatch(instruction, /保留这只灯作为自己的产品主体/);

  const prompt = generationInputRolePrompt(
    [
      { inputRole: "primary-product", originalname: "front.png" },
      { inputRole: "product-support", originalname: "side-view.png" }
    ],
    { imageScope: "detail" }
  );

  assert.match(prompt, /输入图片角色/);
  assert.match(prompt, /输入图 2 是同一款灯具的补充角度\/结构参考/);
});

test("generic product workspace prompt locks uploaded product identity", () => {
  const prompt = productWorkspaceConsistencyPrompt("function", {
    productName: "灯具产品",
    lampType: "灯具",
    lampSubtype: "灯具",
    lampChannel: "generic",
    mountFamily: "generic",
    requiredStructures: "产品图中真实可见的灯体轮廓、发光面和真实比例",
    forbiddenStructures: "产品图里没有的电源线、驱动盒、弹簧卡扣、散热器"
  }, { imageScope: "detail", workspaceStrategyVersion: 1 });

  assert.match(prompt, /上传产品图主体锁（最高优先级）/);
  assert.match(prompt, /识别兜底锁/);
  assert.match(prompt, /禁止把主体换成白色嵌入筒灯、带电源线筒灯/);
  assert.match(prompt, /不得新增上传图没有的电源线、驱动盒、弹簧卡扣、散热器/);
});

test("gpt design spec image prompt uses fixed reference-first consistency brief", () => {
  const finalPrompt = gptDesignSpecGenerationPrompt(
    "场景图：安装在现代客厅天花，展示柔和光效。",
    { consistencyBrief: "生图一致性简版：保持哑黑圆筒灯体、银灰深杯和外置驱动盒。" },
    { productName: "测试灯具" }
  );
  const planningPrompt = productDesignSpecPlanRequestPrompt({
    product: {},
    counts: { main: 1, details: 1 },
    settings: { model: "gpt-image-2", clarity: "2K 高清", ratio: "3:4 竖版" }
  });

  assert.equal(finalPrompt.includes(gptProductConsistencyBrief()), true);
  assert.match(finalPrompt, /以参考产品图为准/);
  assert.match(finalPrompt, /当前图片任务：场景图/);
  assert.doesNotMatch(finalPrompt, /哑黑圆筒|银灰深杯|外置驱动盒/);
  assert.match(planningPrompt.split("\n")[0], /整体设计规范和可直接用于生图模型的动态 Prompt/);
  assert.doesNotMatch(planningPrompt.split("\n")[0], /生图一致性简版/);
  assert.match(planningPrompt, /designSummaryText/);
  assert.match(planningPrompt, /设计大纲简版/);
  assert.match(planningPrompt, /5-7 行/);
  assert.match(planningPrompt, /不要返回 consistencyBrief/);
});

test("gpt design spec formal layout keeps editable prompt fields while varying layout types", () => {
  const planningPrompt = productDesignSpecPlanRequestPrompt({
    product: {},
    counts: { main: 1, scene: 1, detail: 1, function: 1 },
    settings: {
      imageScope: "detail",
      productPlanMode: "gpt-design-spec-v1",
      promptVariant: "layout-v2"
    }
  });

  assert.match(planningPrompt, /Prompt版本=正式版/);
  assert.match(planningPrompt, /正式版 Prompt 规划/);
  assert.match(planningPrompt, /版式类型池/);
  assert.match(planningPrompt, /全幅主视觉型/);
  assert.match(planningPrompt, /避免连续两张使用同一版式/);
  assert.match(planningPrompt, /销售任务、标题方向、版式类型、画面结构、视觉要求、产品要求/);
  assert.match(planningPrompt, /产品要求：产品外观以参考图为准/);
  assert.match(planningPrompt, /组图变化策略/);
  assert.match(planningPrompt, /不要所有图片都写成/);
  assert.doesNotMatch(planningPrompt, /画面结构：顶部标题区，中部主视觉，底部卖点卡\/对比条\/说明区\/参数卡之一/);
});

test("gpt design spec recessed ceiling prompts append plasterboard install requirement", () => {
  const profile = {
    productName: "嵌入式射灯",
    lampType: "射灯",
    lampSubtype: "嵌入式射灯",
    mountFamily: "recessed-downlight"
  };
  const ceilingPrompt = gptDesignSpecGenerationPrompt(
    "为该产品生成一张【精准聚光功能页】电商详情页模块海报。销售任务：证明重点照明效果。标题方向：重点照明更有层次。画面结构：顶部标题区，中部天花照明场景，底部卖点卡。视觉要求：现代家居质感。产品要求：产品外观以参考图为准。",
    {},
    profile
  );
  const detailPrompt = gptDesignSpecGenerationPrompt(
    "为该产品生成一张【材质细节证明页】电商详情页模块海报。销售任务：展示面环质感。标题方向：金属质感真实可见。画面结构：顶部标题区，中部灯杯微距特写，底部材质说明区。视觉要求：干净细节光影。产品要求：产品外观以参考图为准。",
    {},
    profile
  );

  assert.match(ceilingPrompt, /将该嵌入式射灯真实嵌入石膏板天花板/);
  assert.match(ceilingPrompt, /产品安装要求/);
  assert.doesNotMatch(detailPrompt, /石膏板天花板/);
});

test("product workspace prompt repairs unusable large lamp type labels", () => {
  const prompt = productWorkspaceConsistencyPrompt("scene", {
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "??/??",
    lampSubtype: "??/??",
    visibleParts: "glass shade, rods, canopy",
    structureKeywords: "glass shade rods canopy"
  }, { imageScope: "detail", workspaceStrategyVersion: 1 });

  assert.equal(prompt.includes("??/??"), false);
  assert.match(prompt, /\u5927\u706f\/\u540a\u706f/);
});

test("large lamp detail strategy takes over detail suites without touching small lamp route", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const largeShots = [
    { id: "selling-1", category: "selling", prompt: "生成大灯详情图组" },
    { id: "function-1", category: "function", prompt: "生成大灯详情图组" },
    { id: "scene-1", category: "scene", prompt: "生成大灯详情图组" },
    { id: "detail-1", category: "detail", prompt: "生成大灯详情图组" },
    { id: "real-1", category: "real", prompt: "生成大灯详情图组" }
  ];
  const largePlan = applyLargeLampDetailStrategy({
    shots: largeShots,
    counts: { selling: 1, function: 1, scene: 1, detail: 1, real: 1 },
    settings,
    profile: {
      productName: "云朵吊灯",
      lampChannel: "large",
      mountFamily: "chandelier",
      scaleClass: "large",
      lampType: "大灯",
      lampSubtype: "吊灯",
      visibleParts: "白色玻璃灯罩、金属灯臂、吸顶盘、吊线",
      material: "玻璃灯罩和金属灯体"
    }
  });

  assert.equal(largePlan.applied, true);
  assert.equal(largePlan.shots.every((shot) => shot.promptRoute?.source === "large-lamp-detail-strategy"), true);
  assert.equal(largePlan.shots[0].category, "scene");
  assert.match(largePlan.shots[0].generationPrompt, /一盏\/一套大灯|真实比例主灯/);
  assert.match(largePlan.shots[0].generationPrompt, /大灯单主体组锁/);
  assert.match(largePlan.shots[0].generationPrompt, /前景一套背景一套/);

  const smallPlan = applySmallLampDetailStrategy({
    shots: [{ id: "scene-1", category: "scene", prompt: "生成小灯详情图组" }],
    counts: { scene: 1 },
    settings,
    profile: {
      lampChannel: "small",
      mountFamily: "surface-downlight",
      lampType: "小灯",
      lampSubtype: "明装筒灯"
    }
  });
  assert.equal(smallPlan.applied, true);
  assert.equal(smallPlan.shots.every((shot) => shot.promptRoute?.source === "small-lamp-detail-strategy"), true);
});

test("large lamp final prompts stay compact and avoid generic or small-lamp residue", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    productName: "云朵吊灯",
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "大灯",
    lampSubtype: "吊灯",
    visibleParts: "白色玻璃灯罩、金属灯臂、吸顶盘、吊线",
    material: "玻璃灯罩和金属灯体",
    sellingPoint: "柔和主照明、云朵造型、空间氛围"
  };
  const plan = applyLargeLampDetailStrategy({
    shots: Array.from({ length: 5 }, (_, index) => ({
      id: `shot-${index + 1}`,
      category: index === 0 ? "scene" : "selling",
      prompt: "生成大灯详情图组"
    })),
    counts: { scene: 1, selling: 2, function: 1, detail: 1 },
    settings,
    profile
  });

  for (const shot of plan.shots) {
    const compacted = compactGenerationPrompt(
      hiddenGenerationPrompt(shot.generationPrompt, {
        shot,
        settings,
        profile,
        modelOption: { id: "nanobanana2-pro", apiModel: "nanobanana2-pro" }
      }),
      { shot, settings, profile }
    );
    const prompt = compacted.prompt;

    assert.ok(prompt.length < 980, `${shot.promptRoute?.sequenceSlot || shot.id} prompt length ${prompt.length}`);
    assert.equal(compacted.meta.conflictWarnings.includes("mount-family-mixed"), false);
    assert.match(prompt, /主体守门/);
    assert.equal(/小灯|灯位缩小|再收小|商品图策略|suite-storyboard|灯具生成通道|bbox|referenceTarget|scaleHint/.test(prompt), false);
    if (shot.promptRoute?.sequenceSlot === "hero-main-space") {
      assert.match(prompt, /文字守门/);
      assert.doesNotMatch(prompt, /底图不要生成任何可见文字|后置简体中文排版/);
      assert.equal(shot.textOverlay?.template, "commerce-detail-hero");
      assert.equal(/金属微光|克制光感/.test(shot.textOverlay?.title || ""), false);
      assert.match(prompt, /主灯空间首屏|完整房间尺度|真实主灯比例/);
      assert.equal(/视觉中心|空间中心|完整主灯体量|空间焦点|强调灯体尺度/.test(prompt), false);
    }
    if (shot.category === "scene") {
      assert.match(prompt, /主灯|房间|空间|真实/);
      assert.equal(/多个同款主灯/.test(prompt), false);
    }
  }
});

test("large lamp three-shot keeps key hero and core reason model text while removing oversized selling wording", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1, language: "无文字，纯视觉" };
  const profile = {
    productName: "多环交错吊灯",
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "吊灯",
    lampSubtype: "多环LED吊灯",
    visibleParts: "圆形吸顶盘、多根吊线、多圈环形灯体、环形发光带",
    sellingPoint: "多环交错立体造型，点亮后层次感强"
  };
  const plan = applyLargeLampDetailStrategy({
    shots: [
      { id: "selling-1", category: "selling", prompt: "生成大灯详情图组" },
      { id: "function-1", category: "function", prompt: "生成大灯详情图组" },
      { id: "scene-1", category: "scene", prompt: "生成大灯详情图组" }
    ],
    counts: { selling: 1, function: 1, scene: 1 },
    settings,
    profile,
    userRequirement: "生成灯具详情图组\n灯具类目：多环LED吊灯。\n严格保持产品图主体结构、材质、颜色和比例。\n画面干净真实，适合电商详情页直接使用。"
  });

  assert.equal(plan.applied, true);
  assert.equal(plan.shots.length, 3);
  assert.deepEqual(plan.shots.map((shot) => shot.promptRoute.sequenceSlot), ["hero-main-space", "product-mood", "core-reason"]);
  assert.equal(plan.shots[0].textOverlay?.template, "commerce-detail-hero");
  assert.equal(plan.shots[0].textRenderMode, "model-direct");
  assert.match(plan.shots[0].generationPrompt, /首图：全幅电商详情页封面设计稿/);
  assert.doesNotMatch(plan.shots[0].generationPrompt, /底图不要生成任何可见文字|后置简体中文排版/);
  assert.equal(plan.shots[1].textOverlay, undefined);
  assert.equal(plan.shots[1].textRenderMode, "no-text");
  assert.ok(plan.shots[2].textOverlay);
  assert.equal(plan.shots[2].textRenderMode, "model-direct");
  assert.doesNotMatch(plan.shots[2].generationPrompt, /底图不要生成任何可见文字|后置简体中文排版/);

  const coreReason = plan.shots.find((shot) => shot.promptRoute.sequenceSlot === "core-reason");
  assert.ok(coreReason);
  assert.doesNotMatch(coreReason.generationPrompt, /完整主灯或半空间主视觉/);
  assert.match(coreReason.generationPrompt, /完整可售卖主灯|主体不得裁切/);
  assert.match(coreReason.generationPrompt, /28%-42%/);
  assert.match(coreReason.generationPrompt, /不超过45%/);
});

test("large lamp key text uses model-direct and non-key explicit text can fall back to local overlay", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1, language: "简体中文卖点/细节标注文字" };
  const profile = {
    productName: "多环交错吊灯",
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "吊灯",
    lampSubtype: "多环LED吊灯",
    visibleParts: "圆形吸顶盘、多根吊线、多圈环形灯体、环形发光带",
    sellingPoint: "多环交错立体造型，点亮后层次感强"
  };
  const plan = applyLargeLampDetailStrategy({
    shots: [
      { id: "selling-1", category: "selling", prompt: "生成大灯详情图组" },
      { id: "function-1", category: "function", prompt: "生成大灯详情图组" },
      { id: "scene-1", category: "scene", prompt: "生成大灯详情图组" }
    ],
    counts: { selling: 1, function: 1, scene: 1 },
    settings,
    profile
  });

  const textShots = plan.shots.filter((shot) => shot.textOverlay);
  assert.ok(textShots.length >= 2);
  for (const shot of textShots) {
    const textMode = textRenderModeForShot(shot, shot.category, settings);
    const compacted = compactGenerationPrompt(
      hiddenGenerationPrompt(shot.generationPrompt, {
        shot,
        settings,
        profile,
        modelOption: { id: "nano-banana-2", apiModel: "nano-banana-2" }
      }),
      { shot, settings, profile }
    );
    if (textMode === "model-direct") {
      assert.match(compacted.prompt, /文字守门/);
      assert.doesNotMatch(compacted.prompt, /底图不要生成任何可见文字|后置简体中文排版/);
    } else {
      assert.match(compacted.prompt, /文字守门/);
      assert.doesNotMatch(compacted.prompt, /模型直接生成规划好的简体中文|文字由生图模型直接绘制/);
    }
  }
});

test("model-direct text QA is disabled and no longer forces local overlay fallback", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1, forceModelDirectTextQaFail: true };
  const profile = {
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "吊灯",
    lampSubtype: "多环LED吊灯"
  };
  const shot = {
    category: "scene",
    prompt: "生成大灯详情首屏",
    promptRoute: { sequenceSlot: "hero-main-space" },
    textOverlay: { template: "commerce-detail-hero", title: "现代吊灯", subtitle: "多环光影" },
    textRenderMode: "model-direct"
  };
  assert.equal(modelDirectTextQaResult({ imageUrl: "data:image/png;base64,AA==", shot, settings }).status, "skip");
  const fallback = localOverlayFallbackShot(shot, profile, settings);
  assert.equal(fallback.textRenderMode, "local-overlay");
  assert.match(fallback.generationPrompt, /底图不要生成任何可见文字|后置简体中文排版/);
  assert.doesNotMatch(fallback.generationPrompt, /模型直接生成规划好的简体中文/);
});

test("large lamp forbidden structures do not exclude visible chandelier suspension", () => {
  const settings = { imageScope: "detail", workspaceStrategyVersion: 1 };
  const profile = {
    productName: "多环交错吊灯",
    lampChannel: "large",
    mountFamily: "chandelier",
    scaleClass: "large",
    lampType: "吊灯",
    lampSubtype: "多环吊灯",
    visibleParts: "圆形吸顶盘、多根吊线、多环灯体、环形发光罩",
    requiredStructures: "圆形吸顶盘、多根吊线、多环灯体",
    forbiddenStructures: "产品图里没有的电源线、驱动盒、弹簧卡扣、散热器、吊线、吊杆、链条、灯臂、底盘、轨道、开孔或装饰零件"
  };
  const plan = applyLargeLampDetailStrategy({
    shots: [{ id: "scene-1", category: "scene", prompt: "生成大灯详情图组" }],
    counts: { scene: 1 },
    settings,
    profile
  });
  const prompt = compactGenerationPrompt(
    hiddenGenerationPrompt(plan.shots[0].generationPrompt, {
      shot: plan.shots[0],
      settings,
      profile,
      modelOption: { id: "nanobanana2-pro", apiModel: "nanobanana2-pro" }
    }),
    { shot: plan.shots[0], settings, profile }
  ).prompt;

  const excludeLine = prompt.match(/排除：[^\n]+/)?.[0] || "";
  assert.doesNotMatch(excludeLine, /吊线|吊杆|链条|底盘/);
  assert.match(prompt, /主体守门/);
  assert.match(prompt, /同一吸顶盘、同一组吊线和同一安装中心/);
  assert.match(prompt, /禁止前景一套背景一套/);
});
