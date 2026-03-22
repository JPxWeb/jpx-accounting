import { expect, test, type Page } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

function captureButton(page: Page) {
  return test.info().project.name.includes("mobile")
    ? page.getByTestId("capture-open-mobile")
    : page.getByTestId("capture-open-desktop");
}

test("home screen can add a new review item from the browser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Review-ready bookkeeping, shaped for the phone first/i })).toBeVisible();
  await expect(page.getByTestId("runtime-mode-banner")).toContainText("Demo mode is active");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  if (test.info().project.name.includes("mobile")) {
    await expect(page.getByTestId("mobile-dock")).toBeVisible();
    await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  } else {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
    await expect(page.getByTestId("mobile-dock")).toBeHidden();
  }

  await page.getByTestId("simulate-upload").click();
  await expect(page.getByTestId("review-card")).toHaveCount(2);
});

test("home screen supports approval and local draft capture", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("approve-first").click();
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

  await captureButton(page).click();
  await expect(page.getByTestId("capture-sheet")).toBeVisible();
  await page.getByTestId("capture-mode-camera").click();
  await expect(page.getByTestId("draft-notice")).toContainText("Camera draft saved locally");
});
