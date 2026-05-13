import { expect, type Page, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

function captureButton(page: Page) {
  return test.info().project.name.includes("mobile")
    ? page.getByTestId("capture-open-mobile")
    : page.getByTestId("capture-open-desktop");
}

test("today screen loads with review card and demo banner", async ({ page }) => {
  await page.goto("/today");

  await expect(
    page.getByRole("heading", { name: /Review-ready bookkeeping, shaped for the phone first/i }),
  ).toBeVisible();
  await expect(page.getByTestId("runtime-mode-banner")).toContainText("Demo mode is active");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  if (test.info().project.name.includes("mobile")) {
    await expect(page.getByTestId("mobile-dock")).toBeVisible();
    await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  } else {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
    await expect(page.getByTestId("mobile-dock")).toBeHidden();
  }
});

test("today screen supports per-card approval and local draft capture", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByTestId("review-card")).toHaveCount(1);

  // Use the per-card accept action instead of the old approve-first button
  await page.getByTestId("review-accept").first().click();
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

  await captureButton(page).click();
  await expect(page.getByTestId("capture-sheet")).toBeVisible();
  await page.getByTestId("capture-mode-camera").click();
  await expect(page.getByTestId("draft-notice")).toContainText("Camera draft saved locally");
});

test("today screen per-card reject marks review as rejected", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("review-reject").first().click();
  await expect(page.getByTestId("review-status").filter({ hasText: "rejected" })).toHaveCount(1);
});

test("status filter narrows queue and updates URL", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByTestId("review-filters")).toBeVisible();

  // Click the "Approved" filter toggle
  await page.getByRole("button", { name: /^Approved$/i }).click();
  await expect(page).toHaveURL(/status=approved/);
});

test("today screen passes WCAG 2.2 AA accessibility checks", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  await expectAccessible(page);
});
