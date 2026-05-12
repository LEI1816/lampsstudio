import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const testRoot = path.join(root, ".test-data", "full-e2e");

export default async function globalTeardown() {
  const cleanupTargets = [
    path.join(testRoot, "mock-db.json"),
    path.join(testRoot, "exports"),
    path.join(testRoot, "fixtures"),
    path.join(root, "public", "generated-real-e2e")
  ];

  for (const target of cleanupTargets) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}
