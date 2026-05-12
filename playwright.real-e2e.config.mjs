import { defineConfig } from "playwright/test";
import path from "node:path";

const PORT = Number(process.env.REAL_E2E_PORT || 4292);
const baseURL = process.env.REAL_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const root = process.cwd();
const testRoot = path.join(root, ".test-data", "full-e2e");

export default defineConfig({
  testDir: "./tests/real-e2e",
  timeout: 30 * 60 * 1000,
  expect: {
    timeout: 20 * 1000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(testRoot, "reports", "playwright-results.json") }],
    ["html", { outputFolder: path.join(testRoot, "reports", "html"), open: "never" }]
  ],
  outputDir: path.join(testRoot, "reports", "artifacts"),
  use: {
    baseURL,
    actionTimeout: 20 * 1000,
    navigationTimeout: 45 * 1000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "node server.js",
    url: `${baseURL}/api/health`,
    timeout: 90 * 1000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(PORT),
      LAMPS_DB_PATH: path.join(".test-data", "full-e2e", "mock-db.json"),
      LAMPS_EXPORT_DIR: path.join(".test-data", "full-e2e", "exports"),
      LAMPS_GENERATED_IMAGE_DIR: path.join("public", "generated-real-e2e")
    }
  },
  globalTeardown: "./tests/real-e2e/teardown.mjs"
});
