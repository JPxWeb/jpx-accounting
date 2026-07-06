import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3200";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
    },
  },
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm --filter @jpx-accounting/api exec tsx src/index.ts",
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: false,
      env: {
        ACCOUNTING_RUNTIME_MODE: "demo",
        ALLOW_TEST_RESET: "true",
        PORT: "3201",
      },
    },
    {
      command: "corepack pnpm --filter @jpx-accounting/web exec next start --hostname 127.0.0.1 --port 3200",
      url: baseURL,
      reuseExistingServer: false,
      env: {
        // NEXT_PUBLIC_* values are inlined at BUILD time (see the build:e2e
        // script) — setting them here would have no effect on the client.
        ACCOUNTING_API_BASE_URL: apiBaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
