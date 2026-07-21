import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3200";
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // 1 retry on CI, not 2: a systematic failure (e.g. a 45s click timeout) at
  // 3 attempts × both projects is how E2E runs ballooned to ~76 minutes and
  // hundreds of MB of artifacts. One retry still absorbs genuine one-off flake.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  // EXPLICIT copy of Playwright's default screenshot template (verified against
  // playwright 1.58.2 worker/testInfo.js) so the platform-suffix contract is
  // visible instead of implicit: `{-snapshotSuffix}` defaults to
  // `process.platform`, which is why every baseline in
  // tests/e2e/visual-regression.spec.ts-snapshots/ ends in `-win32` or `-linux`.
  // Baselines are PER-PLATFORM: win32 files are captured on Windows dev
  // machines, linux files inside the pinned Playwright Docker image so ubuntu
  // CI compares against real baselines (see scripts/visual-baselines.md).
  // Don't remove the suffix or the two platforms would fight over one file.
  snapshotPathTemplate:
    "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{-snapshotSuffix}{ext}",
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
    // Keep the failing FIRST attempt's trace too (on-first-retry only captured
    // the retry); traces embed screenshots + DOM snapshots, so they replace
    // video as the CI debugging artifact at a fraction of the size.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Video off on CI: a timing-out spec records its full 45s per attempt,
    // which is what blew the uploaded playwright-report to hundreds of MB.
    // Locally videos stay for headed-less debugging DX.
    video: process.env.CI ? "off" : "retain-on-failure",
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
