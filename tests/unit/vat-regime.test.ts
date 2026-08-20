import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerLine, VatRegime } from "@jpx-accounting/domain";
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

/**
 * The canonical KFR D3 reverse-charge posting (`buildPostingLines` "rc25"
 * shape, pinned in tests/unit/posting-balance.test.ts): net 1000 to the
 * supplier, 250 self-assessed both ways, no VAT in the settlement leg.
 */
const rc25PurchaseLines = (): LedgerLine[] => [
  line({ voucherId: "rc1", accountNumber: "6540", debit: 1000, credit: 0, vatCode: "RC25" }),
  line({ voucherId: "rc1", accountNumber: "2645", debit: 250, credit: 0, vatCode: "RC25" }),
  line({ voucherId: "rc1", accountNumber: "2614", debit: 0, credit: 250, vatCode: "RC25", deductible: false }),
  line({ voucherId: "rc1", accountNumber: "1930", debit: 0, credit: 1000, vatCode: "NA", deductible: false }),
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
  const boxAccounts = swedishVatRegime.boxes.flatMap((def) => def.accounts ?? []);
  const regimeAccounts = [
    ...swedishVatRegime.accounts.input,
    ...Object.values(swedishVatRegime.accounts.outputByRate),
    ...Object.values(swedishVatRegime.accounts.reverseChargeOutputByRate),
    swedishVatRegime.accounts.settlement,
    ...boxAccounts,
  ];
  for (const number of regimeAccounts) {
    assert.ok(findCoaAccount(bas2026, number), `regime account ${number} missing from bas-2026`);
  }
});

test("regime models a rate-keyed reverse-charge output map, extended input accounts, and boxes 39/40", () => {
  assert.deepEqual(swedishVatRegime.accounts.input, ["2641", "2640", "2645", "2647"]);
  assert.deepEqual(swedishVatRegime.accounts.reverseChargeOutputByRate, { VAT25: "2614" });

  const byBox = new Map(swedishVatRegime.boxes.map((def) => [def.box, def]));
  assert.equal(byBox.get("30")?.reverseCharge, true);
  assert.equal(byBox.get("31")?.reverseCharge, true);
  assert.equal(byBox.get("32")?.reverseCharge, true);
  assert.equal(byBox.get("21")?.reverseCharge, true);
  assert.equal(byBox.get("20")?.reverseCharge, undefined, "box 20 (EU goods) is not modeled — stays plain");

  assert.deepEqual(byBox.get("39"), {
    box: "39",
    label: "Försäljning av tjänster till näringsidkare i annat EU-land",
    kind: "account-revenue",
    accounts: ["3308"],
  });
  assert.deepEqual(byBox.get("40"), {
    box: "40",
    label: "Övrig försäljning av tjänster omsatta utom landet",
    kind: "account-revenue",
    accounts: ["3305"],
  });
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

test("buildVat sees the reverse-charge OUTPUT leg, so an RC purchase is VAT-neutral instead of a pure claim", () => {
  const projections = buildVat(rc25PurchaseLines());
  const rc25 = projections.find((entry) => entry.vatCode === "RC25");
  // Pre-fix: 2614 was in no account list at all, so the projection reported
  // +250 — an RC purchase looked exactly like a deductible domestic one.
  assert.equal(rc25?.vatAmount, 0, "the self-assessed 2614 liability offsets the 2645 input claim");
});

test("buildVat leaves the undeducted reverse-charge liability visible on book-without-vat", () => {
  const projections = buildVat([
    line({ voucherId: "rc2", accountNumber: "6540", debit: 1250, credit: 0, vatCode: "RC25", deductible: false }),
    line({ voucherId: "rc2", accountNumber: "2645", debit: 0, credit: 0, vatCode: "RC25", deductible: false }),
    line({ voucherId: "rc2", accountNumber: "2614", debit: 0, credit: 250, vatCode: "RC25", deductible: false }),
    line({ voucherId: "rc2", accountNumber: "1930", debit: 0, credit: 1000, vatCode: "NA", deductible: false }),
  ]);
  const rc25 = projections.find((entry) => entry.vatCode === "RC25");
  assert.equal(rc25?.vatAmount, -250, "no input claim, but the liability is not optional — 250 to pay");
});

test("buildVatReturnBoxes golden case: one 25 % purchase + one 25 % sale", () => {
  const boxes = buildVatReturnBoxes([...purchaseLines(), ...saleLines()]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 1000);
  assert.equal(amount("10"), 250);
  assert.equal(amount("48"), 250);
  assert.equal(amount("49"), 0);
});

test("buildVatReturnBoxes emits every regime box; unmodeled-for-this-fixture boxes stay 0", () => {
  const boxes = buildVatReturnBoxes([...purchaseLines(), ...saleLines()]);
  assert.deepEqual(
    boxes.map((entry) => entry.box),
    swedishVatRegime.boxes.map((def) => def.box),
  );
  for (const box of ["20", "21", "30", "31", "32", "39", "40"]) {
    assert.equal(
      boxes.find((entry) => entry.box === box)?.amount,
      0,
      `box ${box} must stay 0 without a matching posting`,
    );
  }
});

test("boxes 30-32 are not starved by 10-12 sharing one accumulator (consumedRates regression)", () => {
  // A domestic 25 % sale (feeds box 10) AND an RC25 25 % EU-service
  // purchase (feeds box 30) in the same return: pre-fix, `consumedRates`
  // handed the VAT25 rate to whichever box hit first and zeroed the other.
  const rc25Purchase: LedgerLine[] = [
    line({ voucherId: "rc1", accountNumber: "6540", debit: 400, credit: 0, vatCode: "RC25", deductible: true }),
    line({ voucherId: "rc1", accountNumber: "2645", debit: 100, credit: 0, vatCode: "RC25", deductible: true }),
    line({ voucherId: "rc1", accountNumber: "2614", debit: 0, credit: 100, vatCode: "RC25", deductible: false }),
    line({ voucherId: "rc1", accountNumber: "1930", debit: 0, credit: 400, vatCode: "NA", deductible: false }),
  ];
  const boxes = buildVatReturnBoxes([...purchaseLines(), ...saleLines(), ...rc25Purchase]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("10"), 250, "domestic output VAT (10) from saleLines() must be unaffected");
  assert.equal(amount("30"), 100, "RC output VAT (30) must not be zeroed by box 10 claiming VAT25 first");
  assert.equal(amount("21"), 400, "box 21 base = box 30 (100, whole kronor) ÷ 0.25");
  assert.equal(
    amount("48"),
    250 + 100,
    "box 48 already picks up the RC input-VAT leg on 2645 via Task C1's input list",
  );
});

test("reverse-charge golden case: an isolated RC25 purchase fills 21/30/48 and nets 49 to zero", () => {
  const boxes = buildVatReturnBoxes(rc25PurchaseLines());
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 0, "an RC purchase is not momspliktig försäljning");
  assert.equal(amount("10"), 0, "no domestic sale — box 10 must not borrow the reverse-charge accumulator");
  assert.equal(amount("20"), 0, "EU goods stay modeled-but-zero (no goods RC accounts)");
  assert.equal(amount("21"), 1000, "purchase base = declared box 30 ÷ 25 %");
  assert.equal(amount("30"), 250);
  assert.equal(amount("48"), 250, "2645 is an input account as of Task C1");
  assert.equal(amount("49"), 0, "self-assessed liability nets against the input claim: nothing to pay");
});

test("box 21 derives from the DECLARED (truncated) box 30, not the öre-exact accumulator", () => {
  const boxes = buildVatReturnBoxes([
    line({ voucherId: "rc3", accountNumber: "6540", debit: 1003.6, credit: 0, vatCode: "RC25" }),
    line({ voucherId: "rc3", accountNumber: "2645", debit: 250.9, credit: 0, vatCode: "RC25" }),
    line({ voucherId: "rc3", accountNumber: "2614", debit: 0, credit: 250.9, vatCode: "RC25", deductible: false }),
    line({ voucherId: "rc3", accountNumber: "1930", debit: 0, credit: 1003.6, vatCode: "NA", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("30"), 250, "öretal faller bort");
  assert.equal(amount("21"), 1000, "250 ÷ 0.25 — not trunc(250.90 ÷ 0.25) = 1003");
  assert.equal(amount("48"), 250);
  assert.equal(amount("49"), 0);
});

test("box 21 sums every modeled reverse-charge rate; 30-32 each keep their own rate", () => {
  // Sweden models 25 % only today (YAGNI). Prove the per-rate loop is real by
  // handing `buildVatReturnBoxes` a regime that also maps 12 % to BAS 2624.
  const twoRateRegime: VatRegime = {
    ...swedishVatRegime,
    accounts: {
      ...swedishVatRegime.accounts,
      reverseChargeOutputByRate: { VAT25: "2614", VAT12: "2624" },
    },
  };
  const boxes = buildVatReturnBoxes(
    [
      ...rc25PurchaseLines(),
      line({ voucherId: "rc12", accountNumber: "6540", debit: 100, credit: 0, vatCode: "RC25" }),
      line({ voucherId: "rc12", accountNumber: "2645", debit: 12, credit: 0, vatCode: "RC25" }),
      line({ voucherId: "rc12", accountNumber: "2624", debit: 0, credit: 12, vatCode: "RC25", deductible: false }),
      line({ voucherId: "rc12", accountNumber: "1930", debit: 0, credit: 100, vatCode: "NA", deductible: false }),
    ],
    twoRateRegime,
  );
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("30"), 250);
  assert.equal(amount("31"), 12, "the 12 % reverse-charge box must not be starved by the 25 % one either");
  assert.equal(amount("32"), 0);
  assert.equal(amount("21"), 1100, "1000 (250 ÷ 25 %) + 100 (12 ÷ 12 %)");
  assert.equal(amount("48"), 262);
  assert.equal(amount("49"), 0, "49 = (250 + 12) − 262");
});

test("boxes 39/40 accumulate EU-service and export-service revenue account-based, independent of vatCode", () => {
  const boxes = buildVatReturnBoxes([
    // Box 39: EU B2B service revenue (3308), VAT0 — öre amount to also
    // exercise whole-kronor truncation on this box.
    line({ voucherId: "eu1", accountNumber: "1930", debit: 2500.45, credit: 0, vatCode: "NA", deductible: false }),
    line({ voucherId: "eu1", accountNumber: "3308", debit: 0, credit: 2500.45, vatCode: "VAT0", deductible: false }),
    // Box 40: non-EU export service revenue (3305), VAT0.
    line({ voucherId: "exp1", accountNumber: "1930", debit: 4000, credit: 0, vatCode: "NA", deductible: false }),
    line({ voucherId: "exp1", accountNumber: "3305", debit: 0, credit: 4000, vatCode: "VAT0", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("39"), 2500, "2500.45 truncates to whole kronor");
  assert.equal(amount("40"), 4000);
  // Neither box's revenue leaks into box 05 (VAT0, and — pre-Task-C4 —
  // box 05 is purely vatCode-gated anyway).
  assert.equal(amount("05"), 0);
});

test("boxes 39/40 count SIE-imported vatCode:'NA' turnover and net credit notes off, without touching 05/10/49", () => {
  const boxes = buildVatReturnBoxes([
    // Norway (non-EU) service export, imported from SIE: the whole voucher
    // carries vatCode "NA", so only the ACCOUNT (3305) can classify it.
    line({ voucherId: "no1", accountNumber: "1930", debit: 9000, credit: 0, vatCode: "NA", deductible: false }),
    line({ voucherId: "no1", accountNumber: "3305", debit: 0, credit: 9000, vatCode: "NA", deductible: false }),
    // Credit note against that export: debit 3305 reduces declared turnover.
    line({ voucherId: "no1cn", accountNumber: "3305", debit: 1500, credit: 0, vatCode: "NA", deductible: false }),
    line({ voucherId: "no1cn", accountNumber: "1930", debit: 0, credit: 1500, vatCode: "NA", deductible: false }),
    // EU B2B service sale (3308), also imported as "NA".
    line({ voucherId: "eu2", accountNumber: "1930", debit: 5000, credit: 0, vatCode: "NA", deductible: false }),
    line({ voucherId: "eu2", accountNumber: "3308", debit: 0, credit: 5000, vatCode: "NA", deductible: false }),
    // A plain domestic 25 % sale in the same period.
    ...saleLines(),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("39"), 5000, "vatCode 'NA' must not hide EU-service turnover from box 39");
  assert.equal(amount("40"), 7500, "9000 − 1500: credit − debit nets the credit note off");
  // The informational turnover boxes are outside the box-49 identity, and
  // the account-based arm must not bleed into the vatCode-gated box 05.
  assert.equal(amount("05"), 1000, "only the domestic sale is momspliktig försäljning");
  assert.equal(amount("10"), 250);
  assert.equal(amount("49"), 250, "49 = box 10 − box 48; 39/40 are not part of it");
});

test("an account-revenue box's total is per box: an account shared by two boxes is not double-counted", () => {
  // Sweden maps 3308→39 and 3305→40 one-to-one, so the hazard is invisible
  // on the shipped regime. Prove the accumulator is per-ACCOUNT (not
  // per-matching-box) with a regime that lists 3305 in two boxes.
  const sharedAccountRegime: VatRegime = {
    ...swedishVatRegime,
    boxes: [
      ...swedishVatRegime.boxes,
      { box: "41", label: "Hypothetical aggregate", kind: "account-revenue", accounts: ["3305"] },
    ],
  };
  const boxes = buildVatReturnBoxes(
    [
      line({ voucherId: "no2", accountNumber: "1930", debit: 4000, credit: 0, vatCode: "NA", deductible: false }),
      line({ voucherId: "no2", accountNumber: "3305", debit: 0, credit: 4000, vatCode: "NA", deductible: false }),
    ],
    sharedAccountRegime,
  );
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("40"), 4000);
  assert.equal(amount("41"), 4000, "each box reports the account once — not 8000 in both");
});

test("box 05 attributes by the LINE's vatCode: off-template revenue counts, momsfri line on a rated account does not", () => {
  assert.equal(findCoaAccount(bas2026, "3011"), undefined, "precondition: 3011 must be off-template");
  const boxes = buildVatReturnBoxes([
    // Voucher 1: off-template revenue account (SIE import / manual edit)
    // with a rated vatCode on the line — must land in box 05 via the BAS
    // 3xxx fallback.
    line({ voucherId: "v1", accountNumber: "3011", debit: 0, credit: 500, vatCode: "VAT12", deductible: false }),
    line({ voucherId: "v1", accountNumber: "2620", debit: 0, credit: 60, vatCode: "VAT12", deductible: false }),
    line({ voucherId: "v1", accountNumber: "1930", debit: 560, credit: 0, vatCode: "NA", deductible: false }),
    // Voucher 2 (its OWN voucher, no output-VAT account line anywhere in
    // it): momsfri sale booked on the normally-rated 3001 — the line's own
    // vatCode wins over the template default (VAT25), and there is no
    // co-voucher output-VAT evidence either, so it stays OUT of box 05.
    line({ voucherId: "v2", accountNumber: "3001", debit: 0, credit: 200, vatCode: "VAT0", deductible: false }),
    line({ voucherId: "v2", accountNumber: "1930", debit: 200, credit: 0, vatCode: "NA", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 500);
  assert.equal(amount("11"), 60);
});

test("box 05 also counts an imported (vatCode NA) domestic sale via its voucher's output-VAT account line (G5 regression)", () => {
  // SIE-imported voucher: `planSieImport` (store.ts) forces EVERY line to
  // vatCode:"NA". Before this fix, box 05 (vatCode-gated) missed the sale
  // base entirely while box 10 (already account-gated) still picked up
  // the VAT — an internally contradictory return. The 2610 line in the
  // SAME voucher is now sufficient account evidence.
  const boxes = buildVatReturnBoxes([
    line({ voucherId: "sie_A_1", accountNumber: "3001", debit: 0, credit: 1000, vatCode: "NA", deductible: false }),
    line({ voucherId: "sie_A_1", accountNumber: "2610", debit: 0, credit: 250, vatCode: "NA", deductible: false }),
    line({ voucherId: "sie_A_1", accountNumber: "1930", debit: 1250, credit: 0, vatCode: "NA", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 1000, "account-classification basis must catch the imported sale despite vatCode NA");
  assert.equal(amount("10"), 250, "output VAT was already account-based and is unaffected by this fix");
});

test("the account-inferred box-05 arm excludes account-revenue (39/40) accounts inside a mixed voucher", () => {
  // One imported voucher bundling a domestic rated sale (3001) with an EU
  // B2B service sale (3308), every line at vatCode "NA". The 2610 line is
  // co-voucher evidence for the DOMESTIC leg only: boxes 39/40 turnover is
  // by definition not momspliktig försäljning, so letting the new arm pull
  // 3308 into box 05 would double-declare it (and would relax the C3 pin
  // "the account-based arm must not bleed into box 05" the moment such a
  // voucher exists). Deviation from the C4 brief — see vat/boxes.ts.
  const boxes = buildVatReturnBoxes([
    line({ voucherId: "sie_B_1", accountNumber: "3001", debit: 0, credit: 800, vatCode: "NA", deductible: false }),
    line({ voucherId: "sie_B_1", accountNumber: "3308", debit: 0, credit: 200, vatCode: "NA", deductible: false }),
    line({ voucherId: "sie_B_1", accountNumber: "2610", debit: 0, credit: 200, vatCode: "NA", deductible: false }),
    line({ voucherId: "sie_B_1", accountNumber: "1930", debit: 1200, credit: 0, vatCode: "NA", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 800, "only the domestic leg — 3308 is declared in box 39, not box 05");
  assert.equal(amount("39"), 200);
  assert.equal(amount("10"), 200);
});

test("declaration boundary is whole kronor: öre truncated, box 49 derived from the truncated boxes", () => {
  // Öre-exact internals: base 103.60, output VAT 25.90, input VAT 20.95.
  const boxes = buildVatReturnBoxes([
    line({ accountNumber: "3001", debit: 0, credit: 103.6, deductible: false }),
    line({ accountNumber: "2610", debit: 0, credit: 25.9, deductible: false }),
    line({ accountNumber: "1930", debit: 129.5, credit: 0, vatCode: "NA", deductible: false }),
    line({ accountNumber: "6540", debit: 83.8, credit: 0 }),
    line({ accountNumber: "2641", debit: 20.95, credit: 0 }),
    line({ accountNumber: "1930", debit: 0, credit: 104.75, vatCode: "NA", deductible: false }),
  ]);
  for (const box of boxes) {
    assert.ok(Number.isInteger(box.amount), `box ${box.box} must be whole kronor, got ${box.amount}`);
  }
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  assert.equal(amount("05"), 103, "öretal faller bort on the sales base");
  assert.equal(amount("10"), 25);
  assert.equal(amount("48"), 20);
  // Sum consistency: box 49 comes from the DECLARED whole-krona boxes
  // (25 − 20 = 5), not from truncating the öre-exact net
  // (trunc(25.90 − 20.95) = trunc(4.95) = 4).
  assert.equal(amount("49"), 5);
});

test("whole-krona truncation is toward zero for negative declaration amounts", () => {
  // Credit-note-heavy period: negative sales base; refund-side box 49.
  const boxes = buildVatReturnBoxes([
    line({ accountNumber: "3001", debit: 100.5, credit: 0, deductible: false }),
    line({ accountNumber: "6540", debit: 402.4, credit: 0 }),
    line({ accountNumber: "2641", debit: 100.6, credit: 0 }),
    line({ accountNumber: "1930", debit: 0, credit: 603.5, vatCode: "NA", deductible: false }),
  ]);
  const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
  // "Öretal faller bort": −100.50 declares as −100 (toward zero), never −101.
  assert.equal(amount("05"), -100);
  assert.equal(amount("48"), 100);
  assert.equal(amount("49"), -100);
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
