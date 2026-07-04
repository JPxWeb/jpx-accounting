import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { resetApiState } from "./test-helpers";

const receiptFixture = path.join(__dirname, "..", "fixtures", "receipt.jpg");

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
  // pick a real file on /capture, which saves a local draft and fire-and-forget
  // promotes it into evidence, creating a voucher + review through the ledger
  // (the review queue is the only path to a posted voucher).
  await page.goto("/capture");
  await page.getByTestId("capture-file-input").setInputFiles(receiptFixture);
  // Promotion removes the local draft only after createEvidence succeeds, so the
  // archive row + empty drafts table prove the evidence + review were created
  // server-side.
  await expect(page.getByTestId("evidence-row")).toHaveCount(2);
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
  // The camera tile opens the OS camera/file dialog, which Playwright cannot drive —
  // feed the hidden input directly (same code path as a real capture).
  await page.getByTestId("capture-sheet-camera-input").setInputFiles(receiptFixture);
  await expect(page.getByTestId("draft-notice")).toContainText("Camera draft saved");
});

test("home screen passes WCAG 2.2 AA accessibility checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  await expectAccessible(page);
});
