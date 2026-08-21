import { expect, test } from "@playwright/test";

import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

// Buttons are activated via `activateControl`: pointer click on desktop,
// trusted keyboard on mobile — see the helper's doc comment for the Pixel 7
// visual-viewport emulation quirk that strands pointer clicks.

/** The demo seed's single curated review — everything else in the queue is ours. */
const SEED_REVIEW_TITLE = "Approve AI subscription posting";

const MANUAL_DESCRIPTION = "Kontorsmaterial, kontant";

/**
 * The Playwright context carries no `NEXT_LOCALE` cookie, so next-intl serves
 * the `en` catalog (`apps/web/i18n/request.ts`) and `common.draftVoucher`
 * renders as "Draft" — NOT the raw Swedish sentinel.
 */
const DRAFT_CHIP_LABEL = "Draft";

/**
 * Everything a draft may display where a posted number belongs: the translated
 * chip above, plus the raw `DRAFT_VOUCHER_NUMBER` sentinel E.1 keeps out of
 * the UI. A posted voucher must match neither.
 */
const DRAFT_LABELS = [DRAFT_CHIP_LABEL, "Utkast"];

/**
 * Posted vouchers mint `V-<n>` at APPROVAL time (KFR E.1), numbered off the
 * workspace's posted-voucher count. The first approval after a reset is
 * `V-1001` today, but the seed is free to change — pin the SHAPE, not the n.
 * The anchored form is for whole-cell text; `ANY_VOUCHER_NUMBER` for
 * `toContainText`, which regex-matches an element's ENTIRE text content.
 */
const POSTED_VOUCHER_NUMBER = /^V-\d{4}$/;
const ANY_VOUCHER_NUMBER = /V-\d{4}/;

/**
 * A date inside the CURRENT month: the journal defaults to the current-month
 * period scope (`use-period-scope.ts`), so a hardcoded calendar date would
 * silently drop out of the default window the moment the month rolls over.
 */
function currentMonthDate() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { bookedAt: `${month}-10`, period: month };
}

test("manual entry posts a balanced 2-line voucher through the review gate", async ({ page, isMobile }) => {
  const { bookedAt, period } = currentMonthDate();

  await page.goto("/books");
  // Asserted before activating so a missing entry point fails fast and by
  // name, instead of burning the whole test timeout inside `click()`'s auto-wait.
  await expect(page.getByTestId("books-new-manual-entry")).toBeVisible();
  await activateControl(page.getByTestId("books-new-manual-entry"), isMobile);
  await expect(page).toHaveURL(/view=manual-entry/);
  await expect(page.getByTestId("manual-entry-view")).toBeVisible();

  await page.getByTestId("manual-entry-description").fill(MANUAL_DESCRIPTION);
  await page.getByTestId("manual-entry-booked-at").fill(bookedAt);

  await page.getByTestId("manual-entry-account-0").fill("6110");
  await page.getByTestId("manual-entry-debit-0").fill("100");
  await page.getByTestId("manual-entry-account-1").fill("1930");
  await page.getByTestId("manual-entry-credit-1").fill("100");

  // Live öre-exact diff indicator reads zero once both legs match. Amounts are
  // formatted with the workspace profile locale (sv-SE), hence the decimal comma.
  await expect(page.getByTestId("manual-entry-diff")).toHaveText(/0,00/);
  await expect(page.getByTestId("manual-entry-submit")).toBeEnabled();

  await activateControl(page.getByTestId("manual-entry-submit"), isMobile);

  // Success resets the form (rows collapse back to two blanks).
  await expect(page.getByTestId("manual-entry-account-0")).toHaveValue("");

  // "AI suggests, never mutates" / D2: the entry lands in the review queue and
  // NOTHING is in the ledger until a human approves it.
  await page.goto(`/books?period=${period}`);
  const journal = page.getByTestId("journal-view");
  await expect(journal).toBeVisible();
  await expect(journal).not.toContainText(MANUAL_DESCRIPTION);

  await page.goto("/today?view=queue");
  const cards = page.getByTestId("review-card");
  // The demo seed always contributes exactly one review — the manual entry is
  // whichever OTHER card exists.
  const manualCard = cards.filter({ hasNotText: SEED_REVIEW_TITLE });
  await expect(manualCard).toHaveCount(1);

  // E.1: an unposted voucher wears the translated Draft chip; no number is
  // burned until it posts.
  await expect(manualCard).toContainText(DRAFT_CHIP_LABEL);
  await expect(manualCard).not.toContainText(ANY_VOUCHER_NUMBER);

  // Phase-B controller ruling: a manual-origin review offers approve/reject
  // ONLY. There is no AI suggestion to correct (the lines ARE the entry) and
  // no VAT leg to drop, so Edit and book-without-vat must not render.
  await expect(manualCard.getByTestId("review-accept")).toBeVisible();
  await expect(manualCard.getByTestId("review-reject")).toBeVisible();
  await expect(manualCard.getByTestId("review-edit")).toHaveCount(0);
  await expect(manualCard.getByTestId("review-book-without-vat")).toHaveCount(0);

  // The captured (AI-suggested) seed review keeps the full action set — the
  // trimming above is manual-origin scoped, not a global removal.
  const seedCard = cards.filter({ hasText: SEED_REVIEW_TITLE });
  await expect(seedCard.getByTestId("review-edit")).toBeVisible();
  await expect(seedCard.getByTestId("review-book-without-vat")).toBeVisible();

  await activateControl(manualCard.getByTestId("review-accept"), isMobile);
  await expect(manualCard.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);
  // E.1 again: approval mints the number and retitles the draft-derived review.
  await expect(manualCard).toContainText(ANY_VOUCHER_NUMBER);

  // Verbatim lines, no fabricated VAT leg: exactly the two rows we entered.
  await page.goto(`/books?period=${period}`);
  await expect(journal).toBeVisible();
  const manualRows = journal.locator("tbody tr").filter({ hasText: MANUAL_DESCRIPTION });
  await expect(manualRows).toHaveCount(2);
  await expect(manualRows.filter({ hasText: "6110" })).toHaveCount(1);
  await expect(manualRows.filter({ hasText: "1930" })).toHaveCount(1);

  // Column order is date / voucher / account / description / debit / credit.
  const voucherCell = manualRows.first().locator("td").nth(1);
  const voucherNumber = (await voucherCell.innerText()).trim();
  expect(voucherNumber).toMatch(POSTED_VOUCHER_NUMBER);
  expect(DRAFT_LABELS).not.toContain(voucherNumber);
});

test("manual entry blocks submission while debits and credits do not balance", async ({ page }) => {
  await page.goto("/books?view=manual-entry");
  await expect(page.getByTestId("manual-entry-view")).toBeVisible();

  await page.getByTestId("manual-entry-description").fill("Obalanserad post");
  await page.getByTestId("manual-entry-account-0").fill("6110");
  await page.getByTestId("manual-entry-debit-0").fill("100");
  await page.getByTestId("manual-entry-account-1").fill("1930");
  await page.getByTestId("manual-entry-credit-1").fill("50");

  await expect(page.getByTestId("manual-entry-submit")).toBeDisabled();

  await page.getByTestId("manual-entry-credit-1").fill("100");
  await expect(page.getByTestId("manual-entry-submit")).toBeEnabled();
});

test("manual entry supports adding and removing rows, with a floor of two", async ({ page, isMobile }) => {
  await page.goto("/books?view=manual-entry");
  await expect(page.getByTestId("manual-entry-row-0")).toBeVisible();
  await expect(page.getByTestId("manual-entry-row-1")).toBeVisible();
  await expect(page.getByTestId("manual-entry-remove-row-0")).toBeDisabled();

  await activateControl(page.getByTestId("manual-entry-add-row"), isMobile);
  await expect(page.getByTestId("manual-entry-row-2")).toBeVisible();
  await expect(page.getByTestId("manual-entry-remove-row-0")).toBeEnabled();

  await activateControl(page.getByTestId("manual-entry-remove-row-2"), isMobile);
  await expect(page.getByTestId("manual-entry-row-2")).toHaveCount(0);
});
