import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const databaseRoot = resolve(".e2e");
mkdirSync(databaseRoot, { recursive: true });
const databasePath = resolve(databaseRoot, `phrase-bank-${process.pid}.sqlite`);
process.env.PHRASE_E2E_DB_PATH = databasePath;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: "./tests/e2e/globalSetup.ts",
  use: {
    baseURL: "http://127.0.0.1:4175",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 4175",
    url: "http://127.0.0.1:4175/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { ...process.env, PHRASE_DB_PATH: databasePath, APP_GIT_SHA: "e2e", PHRASE_COOKIE_SECURE: "false", PHRASE_TTS_ENABLED: "false", PHRASE_SCENARIO_AI_ENABLED: "false" },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
