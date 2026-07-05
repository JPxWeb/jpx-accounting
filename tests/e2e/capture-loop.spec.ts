import fs from "node:fs";
import path from "node:path";

import { deriveDeterministicExtraction, today } from "@jpx-accounting/domain";
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

/**
 * THE real capture loop (Phase 3 exit gate, plan Task 3.11):
 * file → hashed upload → deterministic extraction persisted → review → approve
 * → journal lines. Every number is cross-checked against the API so the UI is
 * proven to render the persisted truth, not a coincidence.
 */
const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";
const receiptFixture = path.join(__dirname, "..", "fixtures", "receipt.jpg");

function expectedFieldsForFixture() {
  const sizeBytes = fs.statSync(receiptFixture).size;
  const fields = deriveDeterministicExtraction({ filename: "receipt.jpg", sizeBytes }, today());
  const value = (key: string) => fields.find((field) => field.key === key)?.value;
  return {
    supplier: value("supplierName")!,
    gross: Number.parseFloat(value("grossAmount")!),
    net: Number.parseFloat(value("netAmount")!),
  };
}

/** Money renders via Intl (sv-SE/SEK by default); normalize NBSP variants for text asserts. */
function formatSek(value: number) {
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", currencyDisplay: "code" })
    .format(value)
    .replace(/[  ]/g, " ");
}

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("a captured file flows extraction → review → approval → journal, and the seed stays pinned", async ({
  page,
  request,
}) => {
  const expected = expectedFieldsForFixture();

  // 1. Capture: feed the hidden input (the OS dialog is not drivable) — the
  //    draft auto-promotes through initUpload → PUT → createEvidence → extract.
  await page.goto("/capture");
  await page.getByTestId("capture-file-input").setInputFiles(receiptFixture);
  const newRow = page.getByTestId("evidence-row").filter({ hasText: "receipt.jpg" });
  await expect(newRow).toHaveCount(1);
  await expect(page.getByTestId("draft-row")).toHaveCount(0);

  // 2. Evidence detail: preview renders, extracted fields show the
  //    deterministic (non-1249) values.
  await newRow.getByTestId("evidence-open").click();
  await expect(page).toHaveURL(/\/capture\/evidence\//);
  const evidenceId = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("evidence-preview")).toBeVisible();
  const fieldsTable = page.getByTestId("evidence-extracted-fields");
  await expect(fieldsTable).toContainText(expected.supplier);

  // Cross-check persistence against the API (not just the UI).
  const context = await (await request.get(`${apiBaseUrl}/api/evidence/${evidenceId}`)).json();
  expect(context.voucher.voucherFields.grossAmount).toBe(expected.gross);
  expect(context.voucher.voucherFields.grossAmount).not.toBe(1249);
  expect(context.review).toBeTruthy();

  // 3. Review deep-link: the focused card shows the SAME gross through Money.
  await page.getByTestId("evidence-open-review").click();
  await expect(page).toHaveURL(/\/today\?review=/);
  const focusedCard = page.getByTestId("review-card").filter({ hasText: expected.supplier });
  await expect(focusedCard).toHaveCount(1);
  const cardText = ((await focusedCard.textContent()) ?? "").replace(/[  ]/g, " ");
  expect(cardText).toContain(formatSek(expected.gross));

  // 4. Approve → the journal gains exactly the 3 posted lines for this voucher,
  //    with the expense line equal to the derived net amount.
  await focusedCard.getByTestId("review-accept").click();
  await expect(focusedCard.getByTestId("review-status")).toContainText("approved");

  const journal = await (await request.get(`${apiBaseUrl}/api/reports/journal`)).json();
  const lines = (journal.journal ?? journal).filter(
    (line: { voucherId: string }) => line.voucherId === context.voucher.id,
  );
  expect(lines).toHaveLength(3);
  const expenseLine = lines.find((line: { debit: number }) => Math.abs(line.debit - expected.net) < 0.01);
  expect(expenseLine).toBeTruthy();

  // 5. Seed stability pin: the seeded demo review still carries the canned 1249.
  const workspace = await (await request.get(`${apiBaseUrl}/api/workspace`)).json();
  const seeded = workspace.vouchers.find((voucher: { id: string }) => voucher.id !== context.voucher.id);
  expect(seeded.voucherFields.grossAmount).toBe(1249);
});
