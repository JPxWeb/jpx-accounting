import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerLine } from "@jpx-accounting/domain";
import {
  bas2026,
  buildBalanceSheet,
  buildCashBridge,
  buildMonthlySeries,
  buildProfitLoss,
  classifyAccountNumber,
  findCoaAccount,
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

const JULY = { from: "2026-07-01", to: "2026-07-31" };

/** Seed-trio-shaped purchase: 6540 −1000, 2641 −250, bank −1250 cash. */
const purchaseLines = (bookedAt = "2026-07-10T10:00:00.000Z", voucherId = "v_purchase"): LedgerLine[] => [
  line({ voucherId, accountNumber: "6540", debit: 1000, credit: 0, bookedAt }),
  line({ voucherId, accountNumber: "2641", debit: 250, credit: 0, bookedAt }),
  line({ voucherId, accountNumber: "1930", debit: 0, credit: 1250, vatCode: "NA", deductible: false, bookedAt }),
];

const saleLines = (bookedAt = "2026-07-10T10:00:00.000Z", voucherId = "v_sale"): LedgerLine[] => [
  line({ voucherId, accountNumber: "1930", debit: 1250, credit: 0, vatCode: "NA", deductible: false, bookedAt }),
  line({ voucherId, accountNumber: "3001", debit: 0, credit: 1000, deductible: false, bookedAt }),
  line({ voucherId, accountNumber: "2610", debit: 0, credit: 250, deductible: false, bookedAt }),
];

test("classifyAccountNumber uses the template first", () => {
  assert.equal(classifyAccountNumber("6540"), "external-cost");
  assert.equal(classifyAccountNumber("1930"), "asset");
  assert.equal(classifyAccountNumber("3001"), "revenue");
});

test("classifyAccountNumber falls back to the BAS first-digit range for out-of-template accounts", () => {
  assert.equal(findCoaAccount(bas2026, "4711"), undefined);
  assert.equal(classifyAccountNumber("4711"), "materials");
  assert.equal(classifyAccountNumber("5999"), "external-cost");
  assert.equal(classifyAccountNumber("7999"), "personnel");
  assert.equal(classifyAccountNumber("8123"), "financial");
});

test("classifyAccountNumber excludes non-numeric and out-of-range accounts", () => {
  assert.equal(classifyAccountNumber("ABC"), undefined);
  assert.equal(classifyAccountNumber(""), undefined);
  assert.equal(classifyAccountNumber("1A30"), undefined);
  assert.equal(classifyAccountNumber("9999"), undefined);
  assert.equal(classifyAccountNumber("0100"), undefined);
});

test("buildProfitLoss seed-trio golden: externalCost 6540 −1000, periodResult −1000", () => {
  const pnl = buildProfitLoss(purchaseLines(), JULY);

  assert.deepEqual(pnl.period, JULY);
  assert.deepEqual(
    pnl.groups.map((group) => group.key),
    ["revenue", "materials", "externalCost", "personnel", "financial"],
  );

  const externalCost = pnl.groups.find((group) => group.key === "externalCost");
  assert.deepEqual(externalCost?.lines, [{ accountNumber: "6540", accountName: "IT-tjänster", amount: -1000 }]);
  assert.equal(externalCost?.total, -1000);

  for (const key of ["revenue", "materials", "personnel", "financial"] as const) {
    const group = pnl.groups.find((candidate) => candidate.key === key);
    assert.deepEqual(group?.lines, [], `${key} must be empty`);
    assert.equal(group?.total, 0, `${key} total must be 0`);
  }

  assert.equal(pnl.operatingResult, -1000);
  assert.equal(pnl.financialNet, 0);
  assert.equal(pnl.periodResult, -1000);
});

test("buildProfitLoss synthetic sale flips signs: revenue +1000, periodResult +1000", () => {
  const pnl = buildProfitLoss(saleLines(), JULY);
  const revenue = pnl.groups.find((group) => group.key === "revenue");
  assert.deepEqual(revenue?.lines, [
    { accountNumber: "3001", accountName: "Försäljning inom Sverige 25 %", amount: 1000 },
  ]);
  assert.equal(pnl.operatingResult, 1000);
  assert.equal(pnl.periodResult, 1000);
});

test("buildProfitLoss filters to the period window", () => {
  const lines = [...purchaseLines(), ...purchaseLines("2026-06-10T10:00:00.000Z", "v_june")];
  const pnl = buildProfitLoss(lines, JULY);
  assert.equal(pnl.periodResult, -1000);
});

test("buildBalanceSheet seed-trio golden: balanced with computedResult −1000", () => {
  const sheet = buildBalanceSheet(purchaseLines(), "2026-07-31");

  assert.equal(sheet.asOf, "2026-07-31");
  assert.equal(sheet.assets.key, "assets");
  assert.deepEqual(sheet.assets.lines, [{ accountNumber: "1930", accountName: "Företagskonto", amount: -1250 }]);
  assert.equal(sheet.assets.total, -1250);

  assert.equal(sheet.equityAndLiabilities.key, "equityAndLiabilities");
  assert.deepEqual(sheet.equityAndLiabilities.lines, [
    { accountNumber: "2641", accountName: "Debiterad ingående moms", amount: -250 },
  ]);
  assert.equal(sheet.equityAndLiabilities.total, -250);

  assert.equal(sheet.computedResult, -1000);
  assert.equal(sheet.balanced, true);
});

test("buildBalanceSheet is cumulative up to asOf, and flags an unbalanced ledger", () => {
  // June lines still count on a July balance sheet.
  const cumulative = buildBalanceSheet(purchaseLines("2026-06-10T10:00:00.000Z"), "2026-07-31");
  assert.equal(cumulative.assets.total, -1250);
  assert.equal(cumulative.balanced, true);

  // Dropping the 2641 line breaks the accounting identity by 250.
  const broken = buildBalanceSheet(
    purchaseLines().filter((entry) => entry.accountNumber !== "2641"),
    "2026-07-31",
  );
  assert.equal(broken.balanced, false);
});

test("buildCashBridge seed-trio golden: 0 → −1250 with drivers 6540 −1000 and 2641 −250", () => {
  const bridge = buildCashBridge(purchaseLines(), JULY);
  assert.deepEqual(bridge, {
    opening: 0,
    drivers: [
      { accountNumber: "6540", accountName: "IT-tjänster", amount: -1000 },
      { accountNumber: "2641", accountName: "Debiterad ingående moms", amount: -250 },
    ],
    other: { amount: 0, accountNumbers: [] },
    closing: -1250,
  });
});

test("buildCashBridge opening picks up pre-period cash and closing matches the independent 19xx balance", () => {
  const lines = [...saleLines("2026-06-10T10:00:00.000Z"), ...purchaseLines()];
  const bridge = buildCashBridge(lines, JULY);

  assert.equal(bridge.opening, 1250);
  assert.equal(bridge.closing, 0);

  // Invariant: closing MUST equal the independent 19xx balance at `to`.
  const independent = lines
    .filter((entry) => entry.accountNumber.startsWith("19") && entry.bookedAt.slice(0, 10) <= JULY.to)
    .reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
  assert.equal(bridge.closing, independent);

  const driverSum = bridge.drivers.reduce((sum, driver) => sum + driver.amount, 0);
  assert.ok(Math.abs(bridge.opening + driverSum + bridge.other.amount - bridge.closing) <= 0.005);
});

test("buildCashBridge skips non-cash vouchers (zero cash delta)", () => {
  const depreciation = [
    line({ voucherId: "v_dep", accountNumber: "7832", debit: 500, credit: 0, vatCode: "NA" }),
    line({ voucherId: "v_dep", accountNumber: "1220", debit: 0, credit: 500, vatCode: "NA" }),
  ];
  const bridge = buildCashBridge([...purchaseLines(), ...depreciation], JULY);

  assert.equal(bridge.drivers.length, 2);
  assert.ok(!bridge.drivers.some((driver) => driver.accountNumber === "7832"));
  assert.deepEqual(bridge.other, { amount: 0, accountNumbers: [] });
  assert.equal(bridge.closing, -1250);
});

test("buildCashBridge caps drivers at 4 and folds the rest into other, keeping the invariant", () => {
  const voucherId = "v_multi";
  const costs = ["5010", "5410", "5460", "5910", "6110", "6212"];
  const lines = [
    line({ voucherId, accountNumber: "1930", debit: 0, credit: 600, vatCode: "NA" }),
    ...costs.map((accountNumber) => line({ voucherId, accountNumber, debit: 100, credit: 0 })),
  ];
  const bridge = buildCashBridge(lines, JULY);

  assert.deepEqual(
    bridge.drivers.map((driver) => driver.accountNumber),
    ["5010", "5410", "5460", "5910"],
  );
  assert.deepEqual(bridge.other, { amount: -200, accountNumbers: ["6110", "6212"] });
  assert.equal(bridge.closing, -600);

  const driverSum = bridge.drivers.reduce((sum, driver) => sum + driver.amount, 0);
  assert.equal(bridge.opening + driverSum + bridge.other.amount, bridge.closing);
});

test("buildCashBridge attributes proportionally to |debit − credit| across counterpart lines", () => {
  const voucherId = "v_prop";
  const lines = [
    line({ voucherId, accountNumber: "1930", debit: 0, credit: 1000, vatCode: "NA" }),
    line({ voucherId, accountNumber: "4000", debit: 750, credit: 0 }),
    line({ voucherId, accountNumber: "5010", debit: 250, credit: 0 }),
  ];
  const bridge = buildCashBridge(lines, JULY);
  assert.deepEqual(bridge.drivers, [
    { accountNumber: "4000", accountName: "Inköp av varor från Sverige", amount: -750 },
    { accountNumber: "5010", accountName: "Lokalhyra", amount: -250 },
  ]);
});

test("buildMonthlySeries reports per-month flows with a CUMULATIVE cash closing", () => {
  const lines = [
    // April history before the series start must roll into the closing balance.
    line({ voucherId: "v_apr", accountNumber: "1930", debit: 100, credit: 0, bookedAt: "2026-04-10T10:00:00.000Z" }),
    line({ voucherId: "v_apr", accountNumber: "3001", debit: 0, credit: 100, bookedAt: "2026-04-10T10:00:00.000Z" }),
    ...saleLines("2026-05-10T10:00:00.000Z"),
    ...purchaseLines("2026-06-10T10:00:00.000Z"),
  ];
  // Sale is 1250 in, 1000 revenue; purchase is 1250 out, −1000 result.
  const series = buildMonthlySeries(lines, "2026-06", 2);
  assert.deepEqual(series, [
    { month: "2026-05", cashIn: 1250, cashOut: 0, cashClosing: 1350, revenue: 1000, result: 1000 },
    { month: "2026-06", cashIn: 0, cashOut: 1250, cashClosing: 100, revenue: 0, result: -1000 },
  ]);
});

test("buildMonthlySeries defaults to a trailing 12 months and wraps the year boundary", () => {
  const series = buildMonthlySeries([], "2026-06");
  assert.equal(series.length, 12);
  assert.equal(series[0]?.month, "2025-07");
  assert.equal(series.at(-1)?.month, "2026-06");

  const wrapped = buildMonthlySeries([], "2026-01", 3);
  assert.deepEqual(
    wrapped.map((point) => point.month),
    ["2025-11", "2025-12", "2026-01"],
  );
});

test("buildMonthlySeries rejects malformed end months", () => {
  assert.throws(() => buildMonthlySeries([], "garbage"), /Invalid endMonth/);
});
