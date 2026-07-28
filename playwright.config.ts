import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  webServer: {
    command:
      "mkdir -p .tmp && LOCAL_DB_PATH=file:.tmp/playwright-full-flow.db pnpm exec tsx scripts/seed-local.ts && LOCAL_DB_PATH=file:.tmp/playwright-full-flow.db ADMIN_PASSWORD=local-dev-password EXPERT_PASSWORD=local-dev-password SUPERADMIN_PASSWORD=local-dev-password pnpm dev --port 3101",
    url: "http://127.0.0.1:3101/login",
    timeout: 120_000,
    reuseExistingServer: false,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3101",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
