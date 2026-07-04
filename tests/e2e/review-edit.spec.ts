import { expect, test } from "@playwright/test";

import { expectAccessible } from "./a11y-helpers";
import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("edit sheet approves a review with a corrected account and VAT code", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("review-edit").click();
  await expect(page.getByTestId("review-edit-sheet")).toBeVisible();

  await page.getByTestId("edit-account").selectOption("6110");
  await page.getByTestId("edit-vat-code").selectOption("VAT25");
  await page.getByTestId("edit-submit").click();

  // Success closes the sheet and flips the review to approved via the shared
  // optimistic snapshot update.
  await expect(page.getByTestId("review-edit-sheet")).toHaveCount(0);
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

  // Append-only proof: the corrected account was POSTED as new journal lines —
  // the seeded suggestion (6540 IT-tjänster) was not rewritten, the decision-time
  // edit shaped what landed in the ledger.
  await page.goto("/books");
  await expect(page.getByTestId("journal-view")).toBeVisible();
  await expect(page.getByRole("cell", { name: "6110 Kontorsmateriel" })).toBeVisible();
});

test("edit sheet blocks submission while edited amounts do not add up", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("review-edit").click();
  await expect(page.getByTestId("review-edit-sheet")).toBeVisible();

  // Mirror of the domain rule: net + VAT must equal gross within 0.01.
  await page.getByTestId("edit-net").fill("100");
  await expect(page.getByTestId("edit-amount-error")).toBeVisible();
  await expect(page.getByTestId("edit-submit")).toBeDisabled();

  // Fixing the amounts clears the error and re-enables submission.
  await page.getByTestId("edit-gross").fill("125");
  await page.getByTestId("edit-vat").fill("25");
  await expect(page.getByTestId("edit-amount-error")).toHaveCount(0);
  await expect(page.getByTestId("edit-submit")).toBeEnabled();
});

test("edit sheet passes WCAG 2.2 AA accessibility checks while open", async ({ page }) => {
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-card")).toHaveCount(1);

  await page.getByTestId("review-edit").click();
  await expect(page.getByTestId("review-edit-sheet")).toBeVisible();
  await expectAccessible(page);
});
