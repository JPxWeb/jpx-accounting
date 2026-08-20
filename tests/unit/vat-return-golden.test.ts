import assert from "node:assert/strict";
import { test } from "node:test";

import { vatReturnBoxSchema } from "@jpx-accounting/contracts";
import type { LedgerLine } from "@jpx-accounting/domain";
import { buildVatReturnBoxes, swedishVatRegime } from "@jpx-accounting/domain";

/**
 * KFR Phase C (D4) golden fixture: one small ledger exercising every real
 * VAT-return box computation added in this phase — a native domestic
 * expense, an RC25 (EU-service reverse charge) purchase, EU-service
 * revenue (box 39), non-EU export-service revenue (box 40), and a
 * SIE-imported domestic sale whose lines are forced vatCode:"NA"
 * (readiness gap G5). Every box in the regime is pinned, incl. the box 49
 * identity and whole-kronor truncation of fractional öre amounts (see
 * `toWholeKronor` in `vat/boxes.ts`).
 */

const ledger: LedgerLine[] = [
  // V1 — native domestic expense, 25 % VAT, fully deductible.
  {
    voucherId: "v1",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    description: "Domestic IT services invoice",
    debit: 861.72,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-03-01",
    deductible: true,
  },
  {
    voucherId: "v1",
    accountNumber: "2641",
    accountName: "Debiterad ingående moms",
    description: "Input VAT",
    debit: 215.43,
    credit: 0,
    vatCode: "VAT25",
    bookedAt: "2026-03-01",
    deductible: true,
  },
  {
    voucherId: "v1",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Payment",
    debit: 0,
    credit: 1077.15,
    vatCode: "NA",
    bookedAt: "2026-03-01",
    deductible: false,
  },

  // V2 — RC25 reverse-charge EU-service purchase (Google/Microsoft/
  // Anthropic pattern): cost debit, 2645 debit (RC input VAT), 2614
  // credit (RC output VAT), settlement credit. 25 %, base 743.60.
  {
    voucherId: "v2",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    description: "EU SaaS subscription (reverse charge)",
    debit: 743.6,
    credit: 0,
    vatCode: "RC25",
    bookedAt: "2026-03-05",
    deductible: true,
  },
  {
    voucherId: "v2",
    accountNumber: "2645",
    accountName: "Beräknad ingående moms på förvärv",
    description: "RC input VAT",
    debit: 185.9,
    credit: 0,
    vatCode: "RC25",
    bookedAt: "2026-03-05",
    deductible: true,
  },
  {
    voucherId: "v2",
    accountNumber: "2614",
    accountName: "Utgående moms omvänd skattskyldighet, 25 %",
    description: "RC output VAT",
    debit: 0,
    credit: 185.9,
    vatCode: "RC25",
    bookedAt: "2026-03-05",
    deductible: false,
  },
  {
    voucherId: "v2",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Payment",
    debit: 0,
    credit: 743.6,
    vatCode: "NA",
    bookedAt: "2026-03-05",
    deductible: false,
  },

  // V3 — non-EU export-service revenue (box 40), VAT0.
  {
    voucherId: "v3",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Invoice paid",
    debit: 4000,
    credit: 0,
    vatCode: "NA",
    bookedAt: "2026-03-10",
    deductible: false,
  },
  {
    voucherId: "v3",
    accountNumber: "3305",
    accountName: "Försäljning tjänster till land utanför EU",
    description: "Consulting — Norway client",
    debit: 0,
    credit: 4000,
    vatCode: "VAT0",
    bookedAt: "2026-03-10",
    deductible: false,
  },

  // V4 — EU B2B service revenue (box 39), VAT0.
  {
    voucherId: "v4",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "Invoice paid",
    debit: 2500.45,
    credit: 0,
    vatCode: "NA",
    bookedAt: "2026-03-12",
    deductible: false,
  },
  {
    voucherId: "v4",
    accountNumber: "3308",
    accountName: "Försäljning tjänster till annat EU-land",
    description: "Consulting — EU business client",
    debit: 0,
    credit: 2500.45,
    vatCode: "VAT0",
    bookedAt: "2026-03-12",
    deductible: false,
  },

  // V5 — SIE-imported domestic 25 % sale: EVERY line forced vatCode:"NA"
  // by `planSieImport` (store.ts). Box 05 must still catch it via the
  // co-voucher 2610 output-VAT line (G5 fix, Task C4).
  {
    voucherId: "sie_A_1",
    accountNumber: "1930",
    accountName: "Företagskonto",
    description: "SIE A 1",
    debit: 1257.0,
    credit: 0,
    vatCode: "NA",
    bookedAt: "2026-03-15",
    deductible: false,
  },
  {
    voucherId: "sie_A_1",
    accountNumber: "3001",
    accountName: "Försäljning inom Sverige 25 %",
    description: "SIE A 1",
    debit: 0,
    credit: 1005.6,
    vatCode: "NA",
    bookedAt: "2026-03-15",
    deductible: false,
  },
  {
    voucherId: "sie_A_1",
    accountNumber: "2610",
    accountName: "Utgående moms 25 %",
    description: "SIE A 1",
    debit: 0,
    credit: 251.4,
    vatCode: "NA",
    bookedAt: "2026-03-15",
    deductible: false,
  },
];

/** Öre-exact double-entry check, in integer öre — no float tolerance needed. */
function assertVoucherBalance(lines: LedgerLine[]): void {
  const byVoucher = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    byVoucher.set(line.voucherId, [...(byVoucher.get(line.voucherId) ?? []), line]);
  }
  for (const [voucherId, voucherLines] of byVoucher) {
    const debit = voucherLines.reduce((sum, l) => sum + Math.round(l.debit * 100), 0);
    const credit = voucherLines.reduce((sum, l) => sum + Math.round(l.credit * 100), 0);
    assert.equal(debit, credit, `voucher ${voucherId} must balance to the öre`);
  }
}

const amountReader = (boxes: Array<{ box: string; amount: number }>) => (box: string) =>
  boxes.find((entry) => entry.box === box)?.amount;

test("golden ledger balances to the öre, voucher by voucher (fixture sanity)", () => {
  assertVoucherBalance(ledger);
});

test("golden VAT return: every box pinned, incl. the 49 identity and whole-kronor truncation", () => {
  const boxes = buildVatReturnBoxes(ledger);
  const amount = amountReader(boxes);

  // Exhaustiveness: the assertions below cover the regime's box set in
  // full. If a future box is added to the regime this fails first, so no
  // box can silently go unpinned by this golden fixture.
  assert.deepEqual(
    boxes.map((entry) => entry.box),
    ["05", "10", "11", "12", "20", "21", "30", "31", "32", "39", "40", "48", "49"],
  );
  assert.deepEqual(
    boxes.map((entry) => entry.box),
    swedishVatRegime.boxes.map((def) => def.box),
    "the golden fixture must pin exactly the regime's declared box set",
  );

  for (const box of boxes) {
    assert.ok(Number.isInteger(box.amount), `box ${box.box} must be whole kronor, got ${box.amount}`);
  }

  // 05 — imported sale (G5 fix): 1005.60 truncates to 1005. Export/EU
  // service revenue (VAT0, boxes 39/40) never contributes here.
  assert.equal(amount("05"), 1005);
  // 10 — domestic 25 % output VAT: 251.40 truncates to 251.
  assert.equal(amount("10"), 251);
  assert.equal(amount("11"), 0);
  assert.equal(amount("12"), 0);
  // 20 — EU goods reverse charge: not modeled, stays 0.
  assert.equal(amount("20"), 0);
  // 21 — EU-services purchase base: box 30 (185, whole kronor) ÷ 0.25 = 740.
  assert.equal(amount("21"), 740);
  // 30 — RC output VAT 25 %: 185.90 truncates to 185.
  assert.equal(amount("30"), 185);
  assert.equal(amount("31"), 0);
  assert.equal(amount("32"), 0);
  // 39 — EU B2B service revenue: 2500.45 truncates to 2500.
  assert.equal(amount("39"), 2500);
  // 40 — non-EU export service revenue: 4000 (no fractional part).
  assert.equal(amount("40"), 4000);
  // 48 — input VAT: 215.43 (2641) + 185.90 (2645, RC input) = 401.33 → 401.
  assert.equal(amount("48"), 401);
  // 49 = 10+11+12+30+31+32 − 48 = 251 + 185 − 401 = 35, over the DECLARED
  // (whole-krona) boxes — never the öre-exact net.
  assert.equal(amount("49"), 35);
  assert.equal(
    amount("49"),
    (amount("10") ?? 0) +
      (amount("11") ?? 0) +
      (amount("12") ?? 0) +
      (amount("30") ?? 0) +
      (amount("31") ?? 0) +
      (amount("32") ?? 0) -
      (amount("48") ?? 0),
    "box 49 identity must hold over the declared boxes",
  );
  // …and boxes 05/21/39/40 are informational: they must NOT leak into 49.
  // The identity above already excludes them arithmetically (05 + 39 + 40
  // alone is 7505), this states the intent.
  assert.notEqual(amount("39"), 0, "the fixture must actually load box 39, or the exclusion above proves nothing");
  assert.notEqual(amount("40"), 0, "the fixture must actually load box 40, or the exclusion above proves nothing");
});

test("golden return truncates each box at the declaration boundary, and derives 21 from the DECLARED box 30", () => {
  const boxes = buildVatReturnBoxes(ledger);
  const amount = amountReader(boxes);

  // Every box whose öre-exact accumulator has a fractional part must have
  // lost those öre ("öretal faller bort"), not rounded them up.
  const truncated: Array<[string, number, number]> = [
    // [box, öre-exact accumulator, declared whole kronor]
    ["05", 1005.6, 1005],
    ["10", 251.4, 251],
    ["30", 185.9, 185],
    ["39", 2500.45, 2500],
    ["48", 215.43 + 185.9, 401],
  ];
  for (const [box, exact, declared] of truncated) {
    assert.notEqual(exact, declared, `box ${box} fixture must carry öre, or it exercises no truncation at all`);
    assert.equal(declared, Math.trunc(exact), `box ${box} expectation must be the truncation of its accumulator`);
    assert.equal(amount(box), declared, `box ${box} must drop its öre`);
  }
  // Boxes 05 and 30 carry öre ≥ 50, so rounding would round them UP —
  // they are the pair that proves "truncate", not "round to nearest".
  assert.equal(Math.round(1005.6), 1006);
  assert.equal(amount("05"), 1005, "box 05 must truncate 1005.60 down, not round it up to 1006");
  assert.equal(Math.round(185.9), 186);
  assert.equal(amount("30"), 185, "box 30 must truncate 185.90 down, not round it up to 186");
  // Box 40's accumulator is already whole — the control case.
  assert.equal(amount("40"), 4000);

  // Box 21 is derived from the TRUNCATED box 30 (185 ÷ 0.25 = 740), not
  // from the öre-exact 185.90 (which would give 743.60 → 743).
  assert.equal(amount("21"), 740);
  assert.notEqual(amount("21"), Math.trunc(185.9 / 0.25), "box 21 must not be derived from the öre-exact box-30 sum");
});

test("box 49 sums the TRUNCATED components — not the truncation of the öre-exact net", () => {
  // The golden ledger's 49 happens to agree under both readings (35), so
  // this second, minimal fixture separates them: declared 100 − 50 = 50,
  // while truncating the öre-exact net 100.60 − 50.70 = 49.90 gives 49.
  const truncationSensitive: LedgerLine[] = [
    // Domestic 25 % sale: base 402.40, output VAT 100.60.
    {
      voucherId: "t1",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description: "Sale settled",
      debit: 503,
      credit: 0,
      vatCode: "NA",
      bookedAt: "2026-03-20",
      deductible: false,
    },
    {
      voucherId: "t1",
      accountNumber: "3001",
      accountName: "Försäljning inom Sverige 25 %",
      description: "Domestic sale",
      debit: 0,
      credit: 402.4,
      vatCode: "VAT25",
      bookedAt: "2026-03-20",
      deductible: false,
    },
    {
      voucherId: "t1",
      accountNumber: "2610",
      accountName: "Utgående moms 25 %",
      description: "Output VAT",
      debit: 0,
      credit: 100.6,
      vatCode: "VAT25",
      bookedAt: "2026-03-20",
      deductible: false,
    },
    // Domestic 25 % expense: base 202.80, input VAT 50.70.
    {
      voucherId: "t2",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      description: "Domestic expense",
      debit: 202.8,
      credit: 0,
      vatCode: "VAT25",
      bookedAt: "2026-03-21",
      deductible: true,
    },
    {
      voucherId: "t2",
      accountNumber: "2641",
      accountName: "Debiterad ingående moms",
      description: "Input VAT",
      debit: 50.7,
      credit: 0,
      vatCode: "VAT25",
      bookedAt: "2026-03-21",
      deductible: true,
    },
    {
      voucherId: "t2",
      accountNumber: "1930",
      accountName: "Företagskonto",
      description: "Payment",
      debit: 0,
      credit: 253.5,
      vatCode: "NA",
      bookedAt: "2026-03-21",
      deductible: false,
    },
  ];

  assertVoucherBalance(truncationSensitive);
  const boxes = buildVatReturnBoxes(truncationSensitive);
  const amount = amountReader(boxes);

  assert.equal(amount("05"), 402, "sales base 402.40 → 402");
  assert.equal(amount("10"), 100, "output VAT 100.60 → 100");
  assert.equal(amount("48"), 50, "input VAT 50.70 → 50");
  assert.equal(Math.trunc(100.6 - 50.7), 49, "the öre-exact net truncates to 49 — the reading we must NOT use");
  assert.equal(amount("49"), 50, "box 49 = declared 10 − declared 48 = 100 − 50");
  assert.equal(
    amount("49"),
    (amount("10") ?? 0) - (amount("48") ?? 0),
    "box 49 identity must hold over the declared boxes here too",
  );
});

test("boxes 30-32 remain independently non-zero alongside 10-12 in the same return (starvation regression)", () => {
  const boxes = buildVatReturnBoxes(ledger);
  const amount = amountReader(boxes);
  assert.equal(amount("10"), 251, "domestic output VAT (10) must not be zeroed by the RC box computation");
  assert.equal(amount("30"), 185, "RC output VAT (30) must not be starved by 10 claiming the VAT25 rate first");
});

test("every box in the golden return satisfies the unchanged wire contract (39/40 need no schema change)", () => {
  const boxes = buildVatReturnBoxes(ledger);
  for (const box of boxes) {
    assert.doesNotThrow(() => vatReturnBoxSchema.parse(box));
    // Zod strips unknown keys, so a round-trip deep-equal also proves the
    // engine emits exactly the contract's shape — no extra, no missing.
    assert.deepEqual(vatReturnBoxSchema.parse(box), box);
    assert.ok(box.label.length > 0, `box ${box.box} must carry its regime label`);
  }
});
