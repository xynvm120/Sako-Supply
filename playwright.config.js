import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.SAKO_E2E_DATA = mkdtempSync(path.join(os.tmpdir(), "sako-e2e-"));
export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:32189",
    launchOptions: process.env.SAKO_CHROMIUM
      ? { executablePath: process.env.SAKO_CHROMIUM }
      : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:32189/api/config",
    reuseExistingServer: false,
    env: {
      PORT: "32189",
      DATA_DIR: process.env.SAKO_E2E_DATA,
      ADMIN_PASSWORD: "browser-admin-password",
    },
  },
  globalTeardown: "./test/browser-cleanup.js",
});
