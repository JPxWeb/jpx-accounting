import assert from "node:assert/strict";
import { test } from "node:test";

import { reportPackSchema } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import {
  bas2026,
  buildReportPack,
  findCoaAccount,
  initialLedgerLines,
  InvalidPeriodTokenError,
} from "@jpx-accounting/domain";

const line = (overrides: Partial<LedgerLine> & Pick<LedgerLine, "accountNumber" | "debit" | "credit">): LedgerLine => ({
  voucherId: "v1",
  accountName: findCoaAccount(bas2026, overrides.accountNumber)?.name ?? overrides.accountNumber,
  description: "Test line",
  vatCode: "VAT25",
  bookedAt: "2026-07-10T10:00:00.000Z",
  deductible: true,
  ...overrides,
});

const julyPurchase = (): LedgerLine[] => [
  line({ voucherId: "v_purchase", accountNumber: "6540", debit: 1000, credit: 0 }),
  line({ voucherId: "v_purchase", accountNumber: "2641", debit: 250, credit: 0 }),
  line({
    voucherId: "v_purchase",
    accountNumber: "1930",
    debit: 0,
    credit: 1250,
    vatCode: "NA",
    deductible: false,
  }),
];

const marchSale = (): LedgerLine[] => [
  line({
    voucherId: "v_sale",
    accountNumber: "1930",
    debit: 1250,
    credit: 0,
    vatCode: "NA",
    deductible: false,
    bookedAt: "2026-03-10T10:00:00.000Z",
  }),
  line({
    voucherId: "v_sale",
    accountNumber: "3001",
    debit: 0,
    credit: 1000,
    deductible: false,
    bookedAt: "2026-03-10T10:00:00.000Z",
  }),
  line({
    voucherId: "v_sale",
    accountNumber: "2610",
    debit: 0,
    credit: 250,
    deductible: false,
    bookedAt: "2026-03-10T10:00:00.000Z",
  }),
];

const vatAmount = (pack: { vatReturn: Array<{ box: string; amount: number }> }, box: string) =>
  pack.vatReturn.find((entry) => entry.box === box)?.amount;

/** Seed lines are booked "now" — derive the period from the seed itself so the test never races the wall clock. */
const seedPack = () => {
  const lines = initialLedgerLines();
  const seedDay = lines[0]!.bookedAt.slice(0, 10);
  const pack = buildReportPack(lines, { periodToken: seedDay.slice(0, 7), fiscalYearStart: "01-01", today: seedDay });
  return { lines, seedDay, pack };
};

test("seed-trio golden: P&L −1000, balanced BS, bridge 0 → −1250, boxes 48/49", () => {
  const { seedDay, pack } = seedPack();

  assert.equal(pack.period.token, seedDay.slice(0, 7));
  assert.equal(pack.period.kind, "month");
  assert.equal(pack.period.from, `${seedDay.slice(0, 7)}-01`);

  // P&L: externalCost 6540 −1000, periodResult −1000.
  const externalCost = pack.profitLoss.groups.find((group) => group.key === "externalCost");
  assert.deepEqual(externalCost?.lines, [{ accountNumber: "6540", accountName: "IT-tjänster", amount: -1000 }]);
  assert.equal(pack.profitLoss.periodResult, -1000);

  // BS: balanced with computedResult −1000.
  assert.equal(pack.balanceSheet.computedResult, -1000);
  assert.equal(pack.balanceSheet.balanced, true);
  assert.equal(pack.balanceSheet.asOf, pack.period.to);

  // Cash bridge: 0 → −1250 with drivers 6540 −1000 + 2641 −250.
  assert.deepEqual(pack.cashBridge, {
    opening: 0,
    drivers: [
      { accountNumber: "6540", accountName: "IT-tjänster", amount: -1000 },
      { accountNumber: "2641", accountName: "Debiterad ingående moms", amount: -250 },
    ],
    other: { amount: 0, accountNumbers: [] },
    closing: -1250,
  });

  // VAT boxes: 48 = 250, 49 = −250.
  assert.equal(vatAmount(pack, "48"), 250);
  assert.equal(vatAmount(pack, "49"), -250);

  // Trailing 12 months ending at the period month, cumulative closing.
  assert.equal(pack.monthly.length, 12);
  assert.equal(pack.monthly.at(-1)?.month, seedDay.slice(0, 7));
  assert.equal(pack.monthly.at(-1)?.cashClosing, -1250);

  // Month periods carry an equal-kind previous window (empty here).
  assert.ok(pack.previousPeriod);
  assert.equal(pack.previousProfitLoss?.periodResult, 0);
  assert.ok(pack.generatedAt.includes("T"));
});

test("cash bridge closing equals the independent 19xx balance at the period's `to`", () => {
  const { lines, pack } = seedPack();
  const independent = lines
    .filter((entry) => entry.accountNumber.startsWith("19") && entry.bookedAt.slice(0, 10) <= pack.period.to)
    .reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
  assert.equal(pack.cashBridge.closing, independent);

  const driverSum = pack.cashBridge.drivers.reduce((sum, driver) => sum + driver.amount, 0);
  assert.ok(
    Math.abs(pack.cashBridge.opening + driverSum + pack.cashBridge.other.amount - pack.cashBridge.closing) <= 0.005,
  );
});

test("VAT boxes and statements are computed over the SELECTED window only", () => {
  const lines = [...julyPurchase(), ...marchSale()];
  const fiscalYearStart = "01-01";

  const march = buildReportPack(lines, { periodToken: "2026-03", fiscalYearStart });
  assert.equal(march.profitLoss.periodResult, 1000);
  assert.equal(vatAmount(march, "05"), 1000);
  assert.equal(vatAmount(march, "10"), 250);
  assert.equal(vatAmount(march, "48"), 0);
  assert.equal(vatAmount(march, "49"), 250);
  assert.equal(march.balanceSheet.asOf, "2026-03-31");
  assert.equal(march.balanceSheet.assets.total, 1250);
  assert.equal(march.balanceSheet.computedResult, 1000);
  assert.equal(march.balanceSheet.balanced, true);

  const july = buildReportPack(lines, { periodToken: "2026-07", fiscalYearStart });
  assert.equal(july.profitLoss.periodResult, -1000);
  assert.equal(vatAmount(july, "48"), 250);
  assert.equal(vatAmount(july, "49"), -250);
  // Cumulative as-of July: the March sale and July purchase net to zero.
  assert.equal(july.balanceSheet.assets.total, 0);
  assert.equal(july.balanceSheet.computedResult, 0);
  assert.equal(july.balanceSheet.balanced, true);
});

test("the `all` sentinel has no previous window and no previous P&L", () => {
  const pack = buildReportPack(julyPurchase(), { periodToken: "all", fiscalYearStart: "01-01" });
  assert.equal(pack.period.kind, "all");
  assert.equal(pack.period.from, "1900-01-01");
  assert.equal(pack.previousPeriod, undefined);
  assert.equal(pack.previousProfitLoss, undefined);
  assert.equal(pack.profitLoss.periodResult, -1000);
});

test("reportPackSchema round-trips the built pack unchanged", () => {
  const { pack } = seedPack();
  assert.deepEqual(reportPackSchema.parse(pack), pack);

  const allPack = buildReportPack(julyPurchase(), { periodToken: "all", fiscalYearStart: "01-01" });
  assert.deepEqual(reportPackSchema.parse(allPack), allPack);
});

test("invalid period tokens propagate InvalidPeriodTokenError from buildReportPack", () => {
  assert.throws(
    () => buildReportPack(julyPurchase(), { periodToken: "bogus", fiscalYearStart: "01-01" }),
    InvalidPeriodTokenError,
  );
});
