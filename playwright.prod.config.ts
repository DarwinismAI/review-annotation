/**
 * Production smoke config — points at the deployed URL, no local dev server.
 * Use: BASE_URL=https://<host> npx playwright test --config=playwright.prod.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "https://expert-review-vn.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.prod\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
