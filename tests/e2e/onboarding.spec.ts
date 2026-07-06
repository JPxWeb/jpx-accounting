import { expect, test, type Page } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { resetApiState } from "./test-helpers";

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
  await page.getByTestId("onboarding-show-me-around").click({ force: isMobile });

  await expectTourTooltip(page);
  await expect(page.getByTestId("onboarding-tour-tooltip")).toContainText(/getting-started checklist/i);

  await page.getByRole("button", { name: "Skip tour" }).click();
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

  await page.getByTestId("getting-started-guide-capture").click({ force: isMobile });
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
  await page.getByTestId("onboarding-replay-orientation").click({ force: isMobile });
  await expect(page).toHaveURL(/\/today/, { timeout: 15_000 });
  await expectTourTooltip(page);
});
