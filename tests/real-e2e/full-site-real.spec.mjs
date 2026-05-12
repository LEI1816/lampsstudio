import { test, expect } from "playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const testRoot = path.join(root, ".test-data", "full-e2e");
const reportDir = path.join(testRoot, "reports");
const fixtureDir = path.join(testRoot, "fixtures");
const dbPath = path.join(testRoot, "mock-db.json");

const fixtures = {
  lampA: path.join(fixtureDir, "lamp-a.png"),
  lampB: path.join(fixtureDir, "lamp-b.png"),
  reference: path.join(fixtureDir, "lamp-reference.png")
};

const summary = {
  startedAt: new Date().toISOString(),
  apiChecks: [],
  frontend: {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    serverErrors: []
  },
  modelResults: [],
  db: {
    beforeBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    afterBytes: 0
  }
};

function reportPath(name) {
  fs.mkdirSync(reportDir, { recursive: true });
  return path.join(reportDir, name);
}

function writeSummary() {
  summary.finishedAt = new Date().toISOString();
  summary.db.afterBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  fs.writeFileSync(reportPath("real-e2e-summary.json"), JSON.stringify(summary, null, 2));
}

async function login(request, account, password = "guanliyuan123") {
  const response = await request.post("/api/auth/login", {
    data: { account, password },
    timeout: 30 * 1000
  });
  const payload = await response.json().catch(() => ({}));
  expect(response.ok(), `login failed for ${account}: ${JSON.stringify(payload)}`).toBeTruthy();
  return payload.token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function checkedJson(response, label) {
  const payload = await response.json().catch(() => ({}));
  summary.apiChecks.push({ label, status: response.status(), ok: response.ok() });
  expect(response.ok(), `${label} failed: ${JSON.stringify(payload)}`).toBeTruthy();
  return payload;
}

function pngFile(filePath, name = path.basename(filePath)) {
  return {
    name,
    mimeType: "image/png",
    buffer: fs.readFileSync(filePath)
  };
}

function generationSettings(modelId, extra = {}) {
  return {
    model: modelId,
    ratio: "1:1 方图",
    clarity: "1k",
    language: "无文字，纯视觉",
    speed: "turbo",
    imageScope: "detail",
    styleCloneMode: false,
    lampCategory: "auto",
    lampCategoryLabel: "",
    lampCategoryHint: "",
    templateReferenceCount: 0,
    similarMode: "none",
    noFallbackMode: false,
    workspaceStrategyVersion: 1,
    mode: "api",
    ...extra
  };
}

async function assertImageReachable(request, imageUrl, label) {
  expect(imageUrl, `${label} returned an empty imageUrl`).toBeTruthy();
  if (/^data:image\//i.test(imageUrl)) return;
  if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("/")) {
    throw new Error(`${label} returned a non-web imageUrl: ${imageUrl}`);
  }
  const response = await request.get(imageUrl, { timeout: 30 * 1000 });
  expect(response.ok(), `${label} image is not reachable: ${imageUrl} (${response.status()})`).toBeTruthy();
}

async function generateOneShot(request, token, model) {
  const started = Date.now();
  const result = {
    modelId: model.id,
    modelLabel: model.label,
    provider: model.provider,
    ok: false,
    durationMs: 0,
    imageUrl: "",
    status: 0,
    error: ""
  };

  try {
    const response = await request.post("/api/jobs/product-suite/shot", {
      headers: authHeaders(token),
      timeout: 180 * 1000,
      multipart: {
        photos: pngFile(fixtures.lampA),
        settings: JSON.stringify(generationSettings(model.id)),
        shot: JSON.stringify({
          id: `real-e2e-${model.id}`,
          category: "selling",
          title: `Real E2E ${model.label}`,
          description: "One real model generation for full-site E2E coverage.",
          ratio: "1:1 方图",
          referenceIndex: 0,
          variationIndex: 1,
          analysis: {}
        }),
        prompt: [
          "Generate one clean ecommerce product image for the uploaded lamp.",
          "Keep the lamp structure, color, material, and proportions faithful to the source image.",
          "Use a simple premium background, no visible text, no logo, no watermark."
        ].join("\n")
      }
    });
    const payload = await response.json().catch(() => ({}));
    result.status = response.status();
    if (!response.ok()) {
      result.error = payload.error || `HTTP ${response.status()}`;
      return result;
    }
    result.imageUrl = payload.shot?.imageUrl || "";
    await assertImageReachable(request, result.imageUrl, model.id);
    result.ok = true;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    result.durationMs = Date.now() - started;
    summary.modelResults.push(result);
  }
}

async function loginInBrowser(page, account) {
  await page.goto("/");
  await page.locator("#authPhone").fill(account);
  await page.locator("#authPassword").fill("guanliyuan123");
  await page.locator("#authSubmit").click();
  await expect(page.locator("#appView")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  writeSummary();
});

test.beforeEach(async ({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") {
      summary.frontend.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    summary.frontend.pageErrors.push(error.message);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    summary.frontend.requestFailures.push({
      url: request.url(),
      method: request.method(),
      errorText: failure?.errorText || ""
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      summary.frontend.serverErrors.push({
        url: response.url(),
        status: response.status()
      });
    }
  });
});

test("auth password is not shared between login and register tabs", async ({ page }) => {
  await page.goto("/");
  await page.locator("#authPassword").fill("login-password");
  await page.locator("#registerTab").click();
  await expect(page.locator("#authPassword")).toHaveValue("");

  await page.locator("#authPassword").fill("register-password");
  await page.locator("#loginTab").click();
  await expect(page.locator("#authPassword")).toHaveValue("");
});

test("site APIs, account surfaces, admin, payment, and support are wired", async ({ page, request }) => {
  await checkedJson(await request.get("/api/health"), "health");
  const config = await checkedJson(await request.get("/api/config"), "config");
  expect(config.realOpenAIImagesEnabled, "real image generation must be enabled in the isolated test database").toBeTruthy();
  expect(config.modelOptions?.length, "modelOptions must be exposed").toBeGreaterThan(0);

  const userToken = await login(request, "17891112627");
  await checkedJson(await request.get("/api/account", { headers: authHeaders(userToken) }), "account");
  await checkedJson(await request.get("/api/account/ledger", { headers: authHeaders(userToken) }), "ledger");
  await checkedJson(
    await request.post("/api/credits/estimate", {
      headers: authHeaders(userToken),
      data: { counts: { selling: 1 }, settings: generationSettings(config.modelOptions[0].id) }
    }),
    "credits estimate"
  );

  const paymentResponse = await request.post("/api/payments/create", {
    headers: authHeaders(userToken),
    data: { provider: "wechat", amount: 50 },
    timeout: 45 * 1000
  });
  const paymentPayload = await paymentResponse.json().catch(() => ({}));
  summary.apiChecks.push({
    label: "payment create",
    status: paymentResponse.status(),
    ok: paymentResponse.ok(),
    explicitError: paymentPayload.error || ""
  });
  expect(paymentResponse.status(), `payment create should return a handled response: ${JSON.stringify(paymentPayload)}`).toBeLessThan(500);

  await checkedJson(
    await request.post("/api/support/messages", {
      headers: authHeaders(userToken),
      data: { message: `real-e2e support ping ${Date.now()}` }
    }),
    "support message create"
  );

  const adminToken = await login(request, "guanliyuan");
  await checkedJson(await request.get("/api/admin/dashboard", { headers: authHeaders(adminToken) }), "admin dashboard");
  await checkedJson(await request.get("/api/admin/settings", { headers: authHeaders(adminToken) }), "admin settings");

  await loginInBrowser(page, "17891112627");
  await expect(page.locator("#adminNavButton")).toBeHidden();
  await page.locator("#openPersonalCenter").click();
  await expect(page.locator("#personalCenterModal")).toBeVisible();
  await page.locator('[data-personal-tab="payments"]').click();
  await page.locator('[data-personal-tab="leases"]').click();
  await page.locator("#closePersonalCenter").click();

  await page.locator("#openRecharge").click();
  await expect(page.locator("#rechargeModal")).toBeVisible();
  await page.locator('[data-provider="alipay"]').click();
  await page.locator('[data-amount="100"]').click();
  await page.locator("#closeRecharge").click();

  await page.locator(".support-button").first().click();
  await expect(page.locator("#supportPanel")).toBeVisible();
  await page.locator("#supportMessageInput").fill(`browser support ping ${Date.now()}`);
  await page.locator("#sendSupportMessage").click();
  await page.locator("#closeSupport").click();

  await page.locator("#logoutButton").click();
  await loginInBrowser(page, "guanliyuan");
  await expect(page.locator("#adminNavButton")).toBeVisible();
  await page.locator("#adminNavButton").click();
  await expect(page.locator("#adminPanel")).toBeVisible();
  await expect(page.locator("#adminHealthGrid")).not.toBeEmpty();
  await page.locator("#adminSectionSelect").selectOption("models");
  await page.locator("#adminRefreshAll").click();
});

test("front-end workspaces accept uploads and expose real generation controls", async ({ page }) => {
  await loginInBrowser(page, "guanliyuan");

  await page.setInputFiles("#photoInput", fixtures.lampA);
  await expect(page.locator("#previewList img")).toHaveCount(1);
  await page.locator('[data-image-scope="main"]').click();
  await page.locator("#quantitySelect").selectOption("1");
  await page.locator("#ratioSelect").selectOption({ index: 0 });
  await page.locator("#claritySelect").selectOption("1k");
  await expect(page.locator("#analyzeButton")).toBeEnabled();

  await page.locator('[data-tool="style"]').click();
  await page.setInputFiles("#styleSubjectInput", fixtures.lampA);
  await page.setInputFiles("#templateReferenceInput", fixtures.reference);
  await expect(page.locator("#styleSubjectPreview img")).toHaveCount(1);
  await expect(page.locator("#templateReferencePreview img")).toHaveCount(1);
  await page.locator('[data-similar-mode="scene"]').click();
  await page.locator("#styleRatioSelect").selectOption({ index: 0 });
  await page.locator("#styleClaritySelect").selectOption("1k");
  await expect(page.locator("#styleAnalyzeButton")).toBeEnabled();

  await page.locator('[data-tool="templates"]').click();
  await page.setInputFiles("#collagePhotoInput", [fixtures.lampA, fixtures.lampB]);
  await expect(page.locator("#collagePreviewList img")).toHaveCount(2);
  await page.locator("#collagePreviewList input").first().fill("客厅");
  await page.locator("#collagePreviewList input").nth(1).fill("");
  await page.locator("#collageRatioSelect").selectOption({ index: 0 });
  await page.locator("#collageClaritySelect").selectOption("1k");
  await expect(page.locator("#generateCollageButton")).toBeEnabled();

  expect(summary.frontend.consoleErrors, "browser console errors").toEqual([]);
  expect(summary.frontend.pageErrors, "page errors").toEqual([]);
  expect(summary.frontend.requestFailures, "browser request failures").toEqual([]);
  expect(summary.frontend.serverErrors, "5xx browser responses").toEqual([]);
});

test("each configured image model can perform one real generation", async ({ request }) => {
  const adminToken = await login(request, "guanliyuan");
  const config = await checkedJson(await request.get("/api/config"), "config for model matrix");
  const models = config.modelOptions || [];
  expect(models.length, "model matrix must not be empty").toBeGreaterThan(0);

  for (const model of models) {
    await generateOneShot(request, adminToken, model);
  }

  const failed = summary.modelResults.filter((item) => !item.ok);
  expect(failed, `real model failures:\n${JSON.stringify(failed, null, 2)}`).toEqual([]);
});
