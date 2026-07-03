import { expect, test, type Page } from "@playwright/test";

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

test("home screen can add a new review item from the browser", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Keep the next accounting decision obvious/i })).toBeVisible();
  await expect(page.getByTestId("runtime-mode-pill")).toContainText("Demo");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  if (test.info().project.name.includes("mobile")) {
    await expect(page.getByTestId("mobile-dock")).toBeVisible();
    await expect(page.getByTestId("desktop-navigation")).toBeHidden();
  } else {
    await expect(page.getByTestId("desktop-navigation")).toBeVisible();
    await expect(page.getByTestId("mobile-dock")).toBeHidden();
  }

  // The way to add a review item from the browser is the capture journey:
  // quick-add draft on /capture, promote it to evidence, which creates a
  // voucher + review through the ledger (the review queue is the only
  // path to a posted voucher).
  await page.goto("/capture");
  await page.getByTestId("quick-add-upload").click();
  await expect(page.getByTestId("draft-row").first()).toBeVisible();
  await page.getByTestId("draft-promote").first().click();
  // Promote removes the local draft only after createEvidence succeeds, so an
  // empty drafts table proves the evidence + review were created server-side.
  await expect(page.getByTestId("draft-row")).toHaveCount(0);

  await page.goto("/today");
  await expect(page.getByTestId("review-card")).toHaveCount(2);
});

test("home screen supports approval and local draft capture", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("review-accept").first().click();
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

  await captureButton(page).click();
  await expect(page.getByTestId("capture-sheet")).toBeVisible();
  await page.getByTestId("capture-mode-camera").click();
  await expect(page.getByTestId("draft-notice")).toContainText("Camera draft saved");
});

test("home screen passes WCAG 2.2 AA accessibility checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  await expectAccessible(page);
});
