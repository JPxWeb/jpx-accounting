import { expect, test } from "@playwright/test";

import { activateControl, resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

/**
 * KFR master verification item 2 (never written until the post-review fix
 * wave): the RC25 EU reverse-charge posting shape end to end, through the real
 * review path — the branch's most statutorily consequential new shape, whose
 * only coverage was unit tests.
 *
 * Capture (the demo seed's single AI-suggested review) → edit → RC25 → confirm
 * the derived VAT/gross → approve → the four posted lines in the journal → the
 * VAT card's declaration boxes.
 *
 * Buttons are activated via `activateControl`: pointer click on desktop,
 * trusted keyboard on mobile (the Pixel 7 visual-viewport quirk — see the
 * helper's doc comment). Amounts render as "1 000,00 SEK" (sv-SE, currency
 * code), so assertions match whitespace-tolerantly on the digits.
 */

/** The seeded voucher's description — every line of the posting carries it. */
const SEED_VOUCHER_DESCRIPTION = "OpenAI subscription invoice";

/** Foreign supplier's net price; the 25 % is self-assessed on top of it. */
const NET = /1\s?000,00/;
const VAT = /250,00/;

test("RC25 review path posts the four reverse-charge lines and self-assesses the VAT", async ({ page, isMobile }) => {
  // --- the VAT card BEFORE the approval: no reverse-charge output yet -------
  await page.goto("/reports");
  await expect(page.getByTestId("vat-preparation")).toBeVisible();
  // Third cell of a box row is the amount (box / label / amount) — asserted on
  // the CELL, since "250,00" would satisfy a row-level contains("0,00").
  const boxAmount = (box: string) => page.locator(`[data-testid="vat-box-row"][data-box="${box}"] td`).nth(2);
  await expect(boxAmount("30")).toHaveText(/^0,00\s?SEK$/);
  // Box 49 carries the demo seed's own input VAT, so pin the CHANGE (an RC25
  // approval must net to zero) rather than a bare 0 the seed cannot produce.
  const box49Before = await page.getByTestId("vat-box-49").textContent();

  // --- review → edit → RC25 ------------------------------------------------
  await page.goto("/today?view=queue");
  await expect(page.getByTestId("review-card")).toHaveCount(1);
  await activateControl(page.getByTestId("review-edit"), isMobile);
  await expect(page.getByTestId("review-edit-sheet")).toBeVisible();

  // 6540 IT-tjänster is the seeded suggestion; the reverse charge is what the
  // reviewer corrects (a foreign supplier charges no Swedish VAT).
  await page.getByTestId("edit-account").selectOption("6540");
  await page.getByTestId("edit-vat-code").selectOption("RC25");
  // The RC25 hint explains the self-assessment; its presence is what tells the
  // reviewer the amounts below changed meaning.
  await expect(page.getByTestId("edit-rc25-hint")).toBeVisible();

  // Under omvänd skattskyldighet the invoice total IS the net: typing the net
  // derives 25 % VAT and the synthetic gross the posting shape reads.
  await page.getByTestId("edit-net").fill("1000");
  await expect(page.getByTestId("edit-vat")).toHaveValue("250");
  await expect(page.getByTestId("edit-gross")).toHaveValue("1250");
  await expect(page.getByTestId("edit-amount-error")).toHaveCount(0);

  await activateControl(page.getByTestId("edit-submit"), isMobile);
  await expect(page.getByTestId("review-edit-sheet")).toHaveCount(0);
  await expect(page.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

  // --- the four posted lines ----------------------------------------------
  await page.goto("/books");
  const journal = page.getByTestId("journal-view");
  await expect(journal).toBeVisible();
  const rows = journal.locator("tbody tr").filter({ hasText: SEED_VOUCHER_DESCRIPTION });
  await expect(rows).toHaveCount(4);

  // Column order: date / voucher / account / description / debit / credit.
  const debitOf = (row: ReturnType<typeof rows.filter>) => row.locator("td").nth(4);
  const creditOf = (row: ReturnType<typeof rows.filter>) => row.locator("td").nth(5);

  // 1. Cost debit — the NET price only: the VAT is not part of the supplier's bill.
  const costRow = rows.filter({ hasText: "6540" });
  await expect(costRow).toHaveCount(1);
  await expect(debitOf(costRow)).toHaveText(NET);

  // 2. 2645 debit — the deductible self-assessed input VAT.
  const inputVatRow = rows.filter({ hasText: "2645" });
  await expect(inputVatRow).toHaveCount(1);
  await expect(debitOf(inputVatRow)).toHaveText(VAT);

  // 3. 2614 credit — the self-assessed OUTPUT liability, same amount.
  const outputVatRow = rows.filter({ hasText: "2614" });
  await expect(outputVatRow).toHaveCount(1);
  await expect(creditOf(outputVatRow)).toHaveText(VAT);

  // 4. Settlement credit — the NET again (the cash that actually leaves), so
  //    the VAT nets to zero cash impact. A gross credit here would be the
  //    classic reverse-charge error.
  const settlementRow = rows.filter({ hasText: "1930" });
  await expect(settlementRow).toHaveCount(1);
  await expect(creditOf(settlementRow)).toHaveText(NET);

  // --- the declaration -----------------------------------------------------
  await page.goto("/reports");
  await expect(page.getByTestId("vat-preparation")).toBeVisible();
  // Box 30: utgående moms on the purchase — the self-assessed 250 kr.
  await expect(boxAmount("30")).toHaveText(/^250,00\s?SEK$/);
  // Box 21: the EU-services purchase base, derived as box 30 ÷ 25 % = 1 000.
  await expect(boxAmount("21")).toHaveText(NET);
  // Box 20 stays empty — EU GOODS are a different box and are not modeled.
  await expect(boxAmount("20")).toHaveText(/^0,00\s?SEK$/);
  // Box 49 unchanged: the same 250 kr rides box 30 (owed) and box 48
  // (deducted), so a deductible reverse charge is cash-neutral in the return.
  await expect(page.getByTestId("vat-box-49")).toHaveText(box49Before ?? "");
});
