import { expect, test, type Page } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { installConsoleGuard } from "./console-guard";
import { activateControl, resetApiState } from "./test-helpers";

async function clearOnboardingStorage(page: Page) {
  await page.evaluate(() => localStorage.removeItem("jpx.accounting.onboarding.v1"));
}

async function scrollGettingStartedIntoView(page: Page) {
  await page.locator('[data-tour="getting-started-widget"]').scrollIntoViewIfNeeded();
}

async function expectTourTooltip(page: Page) {
  await expect(page.getByTestId("onboarding-tour-tooltip")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("getting started can launch the orientation tour", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/today");
  await clearOnboardingStorage(page);
  await scrollGettingStartedIntoView(page);

  await expect(page.getByTestId("onboarding-show-me-around")).toBeVisible();
  await activateControl(page.getByTestId("onboarding-show-me-around"), isMobile);

  await expectTourTooltip(page);
  await expect(page.getByTestId("onboarding-tour-tooltip")).toContainText(/getting-started checklist/i);

  await activateControl(page.getByRole("button", { name: "Skip tour" }), isMobile);
  await expect(page.getByTestId("onboarding-tour-tooltip")).toHaveCount(0);

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem("jpx.accounting.onboarding.v1");
        if (!raw) return true;
        return !raw.includes("app-orientation");
      }),
    )
    .toBe(true);
});

test("capture guide navigates and highlights capture targets", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/today");
  await clearOnboardingStorage(page);
  await scrollGettingStartedIntoView(page);

  await activateControl(page.getByTestId("getting-started-guide-capture"), isMobile);
  await expect(page).toHaveURL(/\/capture$/, { timeout: 15_000 });
  await expectTourTooltip(page);
  await expect(page.locator('[data-tour="capture-dropzone"]')).toBeVisible();

  await expectAccessible(page);
});

test("review-gate tour targets exist in demo queue", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.locator('[data-tour="today-view-queue"]')).toBeVisible();
  await expect(page.locator('[data-tour="review-card"]').first()).toBeVisible();
  await expect(page.locator('[data-tour="review-accept"]').first()).toBeVisible();
});

test("review queue shows keyboard shortcut strip in demo", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.locator('[data-tour="review-hotkeys-strip"]')).toBeVisible();
});

test("settings about can replay onboarding", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  await page.goto("/settings/about");
  await clearOnboardingStorage(page);

  await page.getByTestId("onboarding-replay").scrollIntoViewIfNeeded();
  await activateControl(page.getByTestId("onboarding-replay-orientation"), isMobile);
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
  await expectTourTooltip(page);
});

/**
 * Regression for OnboardingProvider + useSyncExternalStore: a populated
 * `jpx.accounting.onboarding.v1` key used to allocate a fresh object every
 * getSnapshot() call and infinite-loop the shell. Seed BEFORE navigation —
 * empty storage masks the bug (EMPTY_STATE is referentially stable).
 * Console guard fails the test on update-depth / getServerSnapshot warnings.
 */
test("pre-seeded onboarding storage keeps shell hydrating", async ({ page }, testInfo) => {
  const isMobile = testInfo.project.name === "mobile-chromium";
  const guard = await installConsoleGuard(page);
  const seededState = {
    schemaVersion: 1,
    completedTours: ["app-orientation", "capture-flow"],
    lastStartedAt: "2026-07-06T12:00:00.000Z",
    dismissedAt: "2026-07-06T12:05:00.000Z",
  };

  await page.addInitScript((state) => {
    localStorage.setItem("jpx.accounting.onboarding.v1", JSON.stringify(state));
  }, seededState);

  await page.goto("/today");

  const nav = isMobile ? page.getByTestId("mobile-dock") : page.getByTestId("desktop-navigation-links");
  await expect(nav).toBeVisible();

  for (const label of ["Today", "Capture", "Books", "Reports", "Settings"] as const) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  await expect(page.getByTestId("dashboard-canvas")).toBeVisible();
  await expect(page.getByText(/This page couldn.?t load/i)).toHaveCount(0);
  // Settle past hydration + client store swap so late uSES warnings surface.
  await expect(page.getByTestId("widget-integrity")).toBeVisible();
  guard.assertClean();
});
