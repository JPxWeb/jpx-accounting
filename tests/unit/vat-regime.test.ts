import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerLine } from "@jpx-accounting/domain";
import {
  bas2026,
  buildVat,
  buildVatReturnBoxes,
  findCoaAccount,
  getVatRegime,
  swedishVatRegime,
} from "@jpx-accounting/domain";

const line = (overrides: Partial<LedgerLine> & Pick<LedgerLine, "accountNumber" | "debit" | "credit">): LedgerLine => ({
  voucherId: "v1",
  accountName: findCoaAccount(bas2026, overrides.accountNumber)?.name ?? overrides.accountNumber,
  description: "Test line",
  vatCode: "VAT25",
  bookedAt: "2026-05-01T00:00:00.000Z",
  deductible: true,
  ...overrides,
});

const purchaseLines = (): LedgerLine[] => [
  line({ accountNumber: "6540", debit: 1000, credit: 0 }),
  line({ accountNumber: "2641", debit: 250, credit: 0 }),
  line({ accountNumber: "1930", debit: 0, credit: 1250, vatCode: "NA", deductible: false }),
];

const saleLines = (): LedgerLine[] => [
  line({ accountNumber: "1930", debit: 1250, credit: 0, vatCode: "NA", deductible: false }),
  line({ accountNumber: "3001", debit: 0, credit: 1000, deductible: false }),
  line({ accountNumber: "2610", debit: 0, credit: 250, deductible: false }),
];

test("Swedish regime rate table is exactly 25/12/6/0", () => {
  assert.deepEqual(swedishVatRegime.rates, {
    VAT25: { percent: 25 },
    VAT12: { percent: 12 },
    VAT6: { percent: 6 },
    VAT0: { percent: 0 },
  });
});

test("getVatRegime('SE') returns the Swedish regime", () => {
  assert.equal(getVatRegime("SE"), swedishVatRegime);
});

test("every regime account exists in bas-2026 (cross-registry integrity)", () => {
  const regimeAccounts = [
    ...swedishVatRegime.accounts.input,
    ...Object.values(swedishVatRegime.accounts.outputByRate),
    swedishVatRegime.accounts.settlement,
  ];
  for (const number of regimeAccounts) {
    assert.ok(findCoaAccount(bas2026, number), `regime account ${number} missing from bas-2026`);
  }
});

test("buildVat purchase-side output is byte-identical to the pre-regime behavior (regression pin)", () => {
  assert.deepEqual(buildVat(purchaseLines()), [
    { vatCode: "VAT25", baseAmount: 1250, vatAmount: 250, deductible: true },
    { vatCode: "NA", baseAmount: 1250, vatAmount: 0, deductible: false },
  ]);
});

test("buildVat recognizes output VAT on a sale", () => {
  const projections = buildVat(saleLines());
  const vat25 = projections.find((entry) => entry.vatCode === "VAT25");
  assert.equal(vat25?.vatAmount, 250);
});

test("buildVatReturnBoxes golden case: one 25 % purchase + one 25 % sale", () => {
  const boxes = buildVatReturnBoxes([...purchaseLines(), ...saleLines()]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 1000);
  assert.equal(amount("10"), 250);
  assert.equal(amount("48"), 250);
  assert.equal(amount("49"), 0);
});

test("buildVatReturnBoxes emits every regime box, reverse-charge boxes stay 0", () => {
  const boxes = buildVatReturnBoxes([...purchaseLines(), ...saleLines()]);
  assert.deepEqual(
    boxes.map((entry) => entry.box),
    swedishVatRegime.boxes.map((def) => def.box),
  );
  for (const box of ["20", "21", "30", "31", "32"]) {
    assert.equal(boxes.find((entry) => entry.box === box)?.amount, 0, `modeled-only box ${box} must stay 0 in Phase 2`);
  }
});

test("deductibility rules resolve to existing bas-2026 accounts and back-reference by id", () => {
  for (const rule of swedishVatRegime.deductibility) {
    assert.ok(rule.appliesToAccounts.length > 0);
    for (const number of rule.appliesToAccounts) {
      const account = findCoaAccount(bas2026, number);
      assert.ok(account, `deductibility account ${number} missing from bas-2026`);
      assert.equal(account.deductibilityRuleId, rule.id);
    }
  }
});
