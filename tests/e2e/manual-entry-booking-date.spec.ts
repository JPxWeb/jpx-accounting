import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

/**
 * Regression pin for a defect caught in the KFR E.4 review.
 *
 * A future `bookedAt` is not merely cosmetic: it lands in
 * `voucherFields.transactionDate`, and at approval `deriveBookedAt` SILENTLY
 * discards any candidate that post-dates the decision and books the entry on
 * the approval day instead. Nothing in the review card shows the substituted
 * date, and a manual-origin review has no Edit action to repair it — a
 * preparer's intentional back/forward date would be laundered into "today".
 *
 * `planManualVoucher` therefore refuses it with 422 (same policy as R13's
 * edited-bookedAt guard), and this pins the client mirror of that gate: the
 * refusal must be visible BEFORE submit, not as a toast afterwards.
 *
 * Kept out of `manual-entry.spec.ts` so that file stays the untouched
 * acceptance contract landed in E.3.
 */
test("a future booking date blocks submit and names the reason", async ({ page }) => {
  await page.goto("/books?view=manual-entry");
  await expect(page.getByTestId("manual-entry-view")).toBeVisible();

  await page.getByTestId("manual-entry-description").fill("Framtida datum");
  await page.getByTestId("manual-entry-account-0").fill("6110");
  await page.getByTestId("manual-entry-debit-0").fill("100");
  await page.getByTestId("manual-entry-account-1").fill("1930");
  await page.getByTestId("manual-entry-credit-1").fill("100");

  // Balanced and complete, on the field's default (today) => submittable.
  await expect(page.getByTestId("manual-entry-submit")).toBeEnabled();

  // A year out — comfortably past the one-day timezone-skew slack the domain
  // guard allows. Local calendar parts, never toISOString().
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const future = [
    nextYear.getFullYear(),
    String(nextYear.getMonth() + 1).padStart(2, "0"),
    String(nextYear.getDate()).padStart(2, "0"),
  ].join("-");
  await page.getByTestId("manual-entry-booked-at").fill(future);

  await expect(page.getByTestId("manual-entry-submit")).toBeDisabled();
  // The `en` catalog is what a cookie-less Playwright context gets.
  await expect(page.getByText("The booking date cannot be in the future.")).toBeVisible();
});
