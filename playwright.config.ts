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
      command: "pnpm --filter @jpx-accounting/api exec tsx src/index.ts",
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: false,
      env: {
        ACCOUNTING_RUNTIME_MODE: "demo",
        ALLOW_TEST_RESET: "true",
        PORT: "3201",
      },
    },
    {
      command: "pnpm --filter @jpx-accounting/web exec next start --hostname 127.0.0.1 --port 3200",
      url: `${baseURL}/today`,
      reuseExistingServer: false,
      env: {
        ACCOUNTING_API_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE: "demo",
        NEXT_PUBLIC_API_BASE_URL: "/api-proxy",
        NEXT_PUBLIC_DISABLE_SW: "true",
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
