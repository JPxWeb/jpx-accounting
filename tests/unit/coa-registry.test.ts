import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoaAccountClass } from "@jpx-accounting/domain";
import { bas2026, defaultCoaTemplate, findCoaAccount, getCoaTemplate } from "@jpx-accounting/domain";

const classByFirstDigit: Record<string, CoaAccountClass> = {
  "1": "asset",
  "2": "equity-liability",
  "3": "revenue",
  "4": "materials",
  "5": "external-cost",
  "6": "external-cost",
  "7": "personnel",
  "8": "financial",
};

test("bas-2026 account numbers are unique", () => {
  const numbers = bas2026.accounts.map((account) => account.number);
  assert.equal(new Set(numbers).size, numbers.length);
});

test("bas-2026 contains exactly the 68-account SMB subset", () => {
  assert.equal(bas2026.accounts.length, 68);
});

test("every role account resolves via findCoaAccount", () => {
  const roleAccounts = [
    bas2026.roles.bank,
    bas2026.roles.cash,
    bas2026.roles.accountsReceivable,
    bas2026.roles.accountsPayable,
    bas2026.roles.inputVat,
    ...Object.values(bas2026.roles.outputVatByRate),
    bas2026.roles.vatSettlement,
    bas2026.roles.fallbackExpense,
    bas2026.roles.rounding,
  ];
  for (const number of roleAccounts) {
    assert.ok(findCoaAccount(bas2026, number), `role account ${number} missing from bas-2026`);
  }
});

test("account class matches BAS number range", () => {
  for (const account of bas2026.accounts) {
    const expected = classByFirstDigit[account.number[0]!];
    assert.equal(account.accountClass, expected, `${account.number} ${account.name}`);
  }
});

test("output VAT accounts cover every rate and the input VAT account exists", () => {
  for (const [rate, number] of Object.entries(bas2026.roles.outputVatByRate)) {
    assert.ok(findCoaAccount(bas2026, number), `output VAT account for ${rate} missing`);
  }
  assert.ok(findCoaAccount(bas2026, bas2026.roles.inputVat));
});

test("getCoaTemplate('SE') returns bas-2026 and is the default template", () => {
  assert.equal(getCoaTemplate("SE"), bas2026);
  assert.equal(getCoaTemplate("SE", "bas-2026"), bas2026);
  assert.equal(defaultCoaTemplate, bas2026);
});

test("getCoaTemplate throws on unknown template ids", () => {
  assert.throws(() => getCoaTemplate("SE", "does-not-exist"), /Unknown CoA template/);
});

test("findCoaAccount returns undefined for accounts outside the subset", () => {
  assert.equal(findCoaAccount(bas2026, "9999"), undefined);
});
