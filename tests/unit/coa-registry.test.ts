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

test("bas-2026 contains exactly the 78-account SMB subset (68 + 10 KFR Phase B additions)", () => {
  assert.equal(bas2026.accounts.length, 78);
});

test("KFR Phase B accounts exist with the correct BAS names and classes", () => {
  const expected: Array<[string, string, CoaAccountClass]> = [
    ["1229", "Ackumulerade avskrivningar på inventarier och verktyg", "asset"],
    ["1259", "Ackumulerade avskrivningar på datorer", "asset"],
    ["2126", "Periodiseringsfond 2026", "equity-liability"],
    ["2518", "Betald F-skatt", "equity-liability"],
    ["2614", "Utgående moms omvänd skattskyldighet, 25 %", "equity-liability"],
    ["2645", "Beräknad ingående moms på förvärv från utlandet", "equity-liability"],
    ["2647", "Ingående moms omvänd skattskyldighet varor och tjänster i Sverige", "equity-liability"],
    ["2899", "Övriga kortfristiga skulder", "equity-liability"],
    ["3305", "Försäljning tjänster till land utanför EU", "revenue"],
    ["8811", "Avsättning till periodiseringsfond", "financial"],
  ];
  for (const [number, name, accountClass] of expected) {
    const account = findCoaAccount(bas2026, number);
    assert.ok(account, `account ${number} missing`);
    assert.equal(account?.name, name);
    assert.equal(account?.accountClass, accountClass);
  }
  // 8910 already existed before this phase — must not be duplicated.
  assert.equal(bas2026.accounts.filter((account) => account.number === "8910").length, 1);
});

test("reverseChargeOutput/reverseChargeInput/ownerSettlement roles resolve", () => {
  assert.ok(findCoaAccount(bas2026, bas2026.roles.reverseChargeOutput));
  assert.ok(findCoaAccount(bas2026, bas2026.roles.reverseChargeInput));
  assert.ok(findCoaAccount(bas2026, bas2026.roles.ownerSettlement));
  assert.equal(bas2026.roles.reverseChargeOutput, "2614");
  assert.equal(bas2026.roles.reverseChargeInput, "2645");
  assert.equal(bas2026.roles.ownerSettlement, "2899");
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
    bas2026.roles.reverseChargeOutput,
    bas2026.roles.reverseChargeInput,
    bas2026.roles.ownerSettlement,
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
