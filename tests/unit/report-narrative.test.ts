import assert from "node:assert/strict";
import { test } from "node:test";

import type { StatementGroup } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import { bas2026, buildReportPack, findCoaAccount, initialLedgerLines } from "@jpx-accounting/domain";
import type { NarrativeFact } from "@jpx-accounting/reporting";
import { buildKpis, buildReportNarrative } from "@jpx-accounting/reporting";

const line = (overrides: Partial<LedgerLine> & Pick<LedgerLine, "accountNumber" | "debit" | "credit">): LedgerLine => ({
  voucherId: "v1",
  accountName: findCoaAccount(bas2026, overrides.accountNumber)?.name ?? overrides.accountNumber,
  description: "Test line",
  vatCode: "NA",
  bookedAt: "2026-07-10T10:00:00.000Z",
  deductible: false,
  ...overrides,
});

const purchase = (voucherId: string, accountNumber: string, amount: number, bookedAt: string): LedgerLine[] => [
  line({ voucherId, accountNumber, debit: amount, credit: 0, bookedAt }),
  line({ voucherId, accountNumber: "1930", debit: 0, credit: amount, bookedAt }),
];

const julySale = (): LedgerLine[] => [
  line({ voucherId: "v_sale", accountNumber: "1930", debit: 1250, credit: 0, bookedAt: "2026-07-15T10:00:00.000Z" }),
  line({ voucherId: "v_sale", accountNumber: "3001", debit: 0, credit: 1000, bookedAt: "2026-07-15T10:00:00.000Z" }),
  line({ voucherId: "v_sale", accountNumber: "2610", debit: 0, credit: 250, bookedAt: "2026-07-15T10:00:00.000Z" }),
];

/**
 * Two-period fixture (June previous, July current):
 * June:  6540 −400.
 * July:  6540 −1000, 5610 −300, sale 3001 +1000 with output VAT 250.
 * → period result −300 (prev −400), mover 6540 delta −600, cash −400 → −450, box 49 = 250.
 */
const twoPeriodPack = () =>
  buildReportPack(
    [
      ...purchase("v_jun", "6540", 400, "2026-06-10T10:00:00.000Z"),
      ...purchase("v_jul_a", "6540", 1000, "2026-07-10T10:00:00.000Z"),
      ...purchase("v_jul_b", "5610", 300, "2026-07-12T10:00:00.000Z"),
      ...julySale(),
    ],
    { periodToken: "2026-07", fiscalYearStart: "01-01" },
  );

/** Seed lines are booked "now" — derive the period from the seed itself so the test never races the wall clock. */
const seedPack = () => {
  const lines = initialLedgerLines();
  const seedDay = lines[0]!.bookedAt.slice(0, 10);
  return buildReportPack(lines, { periodToken: seedDay.slice(0, 7), fiscalYearStart: "01-01", today: seedDay });
};

const factOf = <Id extends NarrativeFact["id"]>(facts: NarrativeFact[], id: Id): Extract<NarrativeFact, { id: Id }> => {
  const fact = facts.find((entry) => entry.id === id);
  assert.ok(fact, `expected a "${id}" fact`);
  return fact as Extract<NarrativeFact, { id: Id }>;
};

const statementLine = (groups: StatementGroup[], account: string) =>
  groups.flatMap((group) => group.lines).find((entry) => entry.accountNumber === account);

test("facts arrive in deterministic order: period-result, biggest-mover, cash-delta, vat-position", () => {
  assert.deepEqual(
    buildReportNarrative(twoPeriodPack()).map((fact) => fact.id),
    ["period-result", "biggest-mover", "cash-delta", "vat-position"],
  );
  assert.deepEqual(
    buildReportNarrative(seedPack()).map((fact) => fact.id),
    ["period-result", "biggest-mover", "cash-delta", "vat-position"],
  );
});

test("period-result, cash-delta and vat-position values are copied from the pack (reconciliation guard)", () => {
  const pack = twoPeriodPack();
  const facts = buildReportNarrative(pack);

  const periodResult = factOf(facts, "period-result");
  assert.equal(periodResult.amount, pack.profitLoss.periodResult);
  assert.equal(periodResult.previousAmount, pack.previousProfitLoss?.periodResult);
  assert.deepEqual(periodResult, { id: "period-result", amount: -300, previousAmount: -400, delta: 100 });

  const cashDelta = factOf(facts, "cash-delta");
  assert.equal(cashDelta.opening, pack.cashBridge.opening);
  assert.equal(cashDelta.closing, pack.cashBridge.closing);
  assert.deepEqual(cashDelta, { id: "cash-delta", opening: -400, closing: -450, delta: -50 });

  const vatPosition = factOf(facts, "vat-position");
  assert.equal(vatPosition.amount, pack.vatReturn.find((entry) => entry.box === "49")?.amount);
  assert.deepEqual(vatPosition, { id: "vat-position", amount: 250, box: "49" });
});

test("biggest-mover math on the two-period fixture: largest |current − previous| across cost groups", () => {
  const pack = twoPeriodPack();
  const mover = factOf(buildReportNarrative(pack), "biggest-mover");

  // 6540 moved −400 → −1000 (|Δ| 600) and beats 5610's 0 → −300 (|Δ| 300).
  assert.deepEqual(mover, {
    id: "biggest-mover",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    amount: -1000,
    previousAmount: -400,
    delta: -600,
  });

  // Reconciliation guard: both amounts are literally the pack's statement-line values.
  assert.equal(mover.amount, statementLine(pack.profitLoss.groups, "6540")?.amount);
  assert.equal(mover.previousAmount, statementLine(pack.previousProfitLoss!.groups, "6540")?.amount);
  assert.equal(mover.accountName, statementLine(pack.profitLoss.groups, "6540")?.accountName);
});

test("biggest-mover counts an absent previous line as 0 and breaks ties to the lowest account number", () => {
  const pack = buildReportPack(
    [
      ...purchase("v_tie_a", "6540", 500, "2026-07-10T10:00:00.000Z"),
      ...purchase("v_tie_b", "5610", 500, "2026-07-11T10:00:00.000Z"),
    ],
    { periodToken: "2026-07", fiscalYearStart: "01-01" },
  );
  const mover = factOf(buildReportNarrative(pack), "biggest-mover");
  assert.equal(mover.accountNumber, "5610");
  assert.equal(mover.previousAmount, 0);
  assert.equal(mover.delta, -500);
});

test("biggest-mover is omitted without a previous window (`all`), and period-result carries no delta", () => {
  const pack = buildReportPack(purchase("v_all", "6540", 1000, "2026-07-10T10:00:00.000Z"), {
    periodToken: "all",
    fiscalYearStart: "01-01",
  });
  const facts = buildReportNarrative(pack);
  assert.deepEqual(
    facts.map((fact) => fact.id),
    ["period-result", "cash-delta", "vat-position"],
  );
  const periodResult = factOf(facts, "period-result");
  assert.equal(periodResult.previousAmount, undefined);
  assert.equal(periodResult.delta, undefined);
});

test("biggest-mover is omitted without cost movement — revenue movement never qualifies", () => {
  const pack = buildReportPack(
    [
      ...purchase("v_jun", "6540", 1000, "2026-06-10T10:00:00.000Z"),
      ...purchase("v_jul", "6540", 1000, "2026-07-10T10:00:00.000Z"),
      ...julySale(),
    ],
    { periodToken: "2026-07", fiscalYearStart: "01-01" },
  );
  const facts = buildReportNarrative(pack);
  assert.ok(!facts.some((fact) => fact.id === "biggest-mover"));
  // The revenue swing still shows up where it belongs: in the period result.
  assert.equal(factOf(facts, "period-result").delta, 1000);
});

test("buildKpis copies pack values and monthly sparklines (reconciliation guard)", () => {
  const pack = twoPeriodPack();
  const kpis = buildKpis(pack);

  assert.equal(kpis.result, pack.profitLoss.periodResult);
  assert.equal(kpis.cash, pack.cashBridge.closing);
  assert.equal(kpis.revenue, pack.profitLoss.groups.find((group) => group.key === "revenue")?.total);
  assert.equal(kpis.vat, pack.vatReturn.find((entry) => entry.box === "49")?.amount);
  assert.deepEqual(
    { result: kpis.result, cash: kpis.cash, revenue: kpis.revenue, vat: kpis.vat },
    { result: -300, cash: -450, revenue: 1000, vat: 250 },
  );

  assert.deepEqual(
    kpis.sparklines.result,
    pack.monthly.map((point) => point.result),
  );
  assert.deepEqual(
    kpis.sparklines.cash,
    pack.monthly.map((point) => point.cashClosing),
  );
  assert.deepEqual(
    kpis.sparklines.revenue,
    pack.monthly.map((point) => point.revenue),
  );
  assert.equal(kpis.sparklines.result.length, 12);
});

test("buildKpis seed golden: result −1000, cash −1250, revenue 0, vat −250 (finding 8)", () => {
  const kpis = buildKpis(seedPack());
  assert.equal(kpis.result, -1000);
  assert.equal(kpis.cash, -1250);
  assert.equal(kpis.revenue, 0);
  assert.equal(kpis.vat, -250);
  assert.equal(kpis.sparklines.cash.at(-1), -1250);
});
