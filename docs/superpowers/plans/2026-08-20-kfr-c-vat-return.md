# KFR Phase C — VAT Return

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

**Delivers** (design D4, [`2026-08-20-kapitas-full-replacement-design.md`](../specs/2026-08-20-kapitas-full-replacement-design.md)): real computation for VAT-return boxes 21/30–32/39/40, the box 05 account-classification fix (readiness gap G5), and a golden-fixture unit test pinning the entire box set. All changes are confined to `packages/domain/src/vat/regime.ts`, `packages/domain/src/vat/boxes.ts`, and `tests/unit/`. No contract changes, no UI changes, no store changes (see Task C6 — verified, not assumed).

## Prerequisite (hard dependency on Phase B — read before starting)

Per the master's execution order, Phase B lands first and adds CoA accounts `2614`, `2645`, `2647`, `2899`, `3305` (plus `1229`, `1259`, `2126`, `2518`, `8811`; `3308` and `8910` already exist today) to `packages/domain/src/coa/bas-2026.ts`, and the `"RC25"` literal to a new `vatCodeSchema`. **Before starting Task C1, confirm** `packages/domain/src/coa/bas-2026.ts` already contains `2614`, `2645`, `2647`, `3305` — this phase's cross-registry integrity test (Task C1) and golden fixture (Task C5) will fail on missing-account assertions, not on a defect in this phase's own code, if Phase B has not landed.

This phase does **not** depend on the `vatCodeSchema`/`"RC25"` contract literal itself: `LedgerLine.vatCode` (`packages/domain/src/projections.ts`) is a plain `string`, and every box computation added here is **account-based**, not `vatCode`-based (see Task C2/C4). The golden fixture uses the string `"RC25"` only to mirror Phase B's real posting shape for realism — it is not type-checked against any enum.

## Task C1 — Regime data: reverse-charge output map, extended input accounts, new box defs

**Files:** `packages/domain/src/vat/regime.ts`, `tests/unit/vat-regime.test.ts`

**Interfaces:**

- `VatRegime.accounts` gains `reverseChargeOutputByRate: Partial<Record<Exclude<VatRateId, "VAT0">, string>>`.
- `VatRegime.accounts.input` extends `["2641", "2640"]` → `["2641", "2640", "2645", "2647"]`.
- `VatBoxDef` gains `reverseCharge?: boolean` (boxes 21/30/31/32 read the reverse-charge account map instead of the domestic one) and `accounts?: string[]` (new `"account-revenue"` box kind, implemented in Task C3).
- `VatBoxKind` gains `"account-revenue"`.
- `swedishVatRegime.boxes` gains box `39` (`accounts: ["3308"]`) and box `40` (`accounts: ["3305"]`), inserted between `32` and `48` (matches Skatteverket's real form ordering).

This task only touches `regime.ts` — `boxes.ts` is untouched here. That is safe: `buildVatReturnBoxes`'s `switch` has no exhaustiveness check, so a `def.kind` of `"account-revenue"` (a brand-new literal after this task) simply falls through with `amount` at its initialized `0`, and the function's final `return regime.boxes.map(...)` already emits one row per box regardless of kind. This lets the box-count/box-id assertions below go green immediately, with zero `boxes.ts` changes — a deliberately free, low-risk verification of the new regime shape before any computation logic changes.

- [ ] Write the failing tests in `tests/unit/vat-regime.test.ts` (add after the existing `"every regime account exists in bas-2026"` test):

  ```ts
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
  ```

  Update the existing `"every regime account exists in bas-2026 (cross-registry integrity)"` test to cover the new account surfaces:

  ```ts
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
  ```

  Rename and extend the existing `"buildVatReturnBoxes emits every regime box, reverse-charge boxes stay 0"` test to also cover 39/40 (this passes with ZERO `boxes.ts` changes, per the note above — it is a regime-shape/box-count check, not a computation check):

  ```ts
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
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected fail: the new `"regime models..."` test throws `AssertionError` on `swedishVatRegime.accounts.input` (`["2641","2640"]` vs the expected 4-element array) and on `reverseChargeOutputByRate` (`undefined` vs `{VAT25:"2614"}`) — `regime.ts` has not changed yet. The renamed `"emits every regime box"` test also fails: `boxes.map(box)` does not include `"39"`/`"40"` yet (11 ids vs the new 13-id expectation). The cross-registry test either passes vacuously (if Phase B's accounts already exist) or fails on a missing-account assertion (if Phase B hasn't landed) — confirm which per the Prerequisite above before proceeding.

- [ ] Implement in `packages/domain/src/vat/regime.ts`. Replace the file from `export type VatBoxKind` through the end of the `swedishVatRegime` object literal:

  ```ts
  export type VatBoxKind = "sales-base" | "output-vat" | "purchase-base" | "input-vat" | "net" | "account-revenue";

  export type VatBoxDef = {
    box: string;
    label: string;
    kind: VatBoxKind;
    rate?: VatRateId;
    /**
     * `output-vat` boxes 30–32 and `purchase-base` box 21 read the
     * REVERSE-CHARGE account map (`accounts.reverseChargeOutputByRate`)
     * instead of the domestic one (`accounts.outputByRate`) — KFR Phase C
     * (D4): this is what stops boxes 30–32 sharing (and being starved by)
     * 10–12's accumulator.
     */
    reverseCharge?: boolean;
    /** `account-revenue` only: accounts whose credit − debit sums into this box. */
    accounts?: string[];
  };

  export type VatRegime = {
    country: CountryCode;
    rates: Record<VatRateId, { percent: 25 | 12 | 6 | 0 }>;
    accounts: {
      input: string[];
      outputByRate: Record<Exclude<VatRateId, "VAT0">, string>;
      /**
       * Reverse-charge OUTPUT VAT accounts, keyed by rate (KFR Phase C / D4).
       * Partial: only 25 % (account 2614) is modeled today — JPx's EU
       * service purchases (Google/Microsoft/Anthropic) are all 25 %. Feeds
       * boxes 30–32 independently of `outputByRate` (10–12) and box 21's
       * derived purchase base.
       */
      reverseChargeOutputByRate: Partial<Record<Exclude<VatRateId, "VAT0">, string>>;
      settlement: string;
    };
    boxes: VatBoxDef[];
    deductibility: DeductibilityRule[];
  };

  /**
   * Swedish standard momsdeklaration subset, bounded to current features.
   * Box 20 (EU GOODS reverse charge) stays modeled-but-zero — no goods RC
   * accounts exist (YAGNI: JPx has no EU goods purchases). Boxes 21/30–32
   * (EU SERVICES reverse charge) and 39/40 (EU/export SERVICE revenue) are
   * real accumulators as of KFR Phase C (D4) — see `vat/boxes.ts`.
   * Deductibility rules are data only in Phase 2 — enforcement lands with
   * the real rule engine later.
   */
  export const swedishVatRegime: VatRegime = {
    country: "SE",
    rates: {
      VAT25: { percent: 25 },
      VAT12: { percent: 12 },
      VAT6: { percent: 6 },
      VAT0: { percent: 0 },
    },
    accounts: {
      input: ["2641", "2640", "2645", "2647"],
      outputByRate: { VAT25: "2610", VAT12: "2620", VAT6: "2630" },
      reverseChargeOutputByRate: { VAT25: "2614" },
      settlement: "2650",
    },
    boxes: [
      { box: "05", label: "Momspliktig försäljning", kind: "sales-base" },
      { box: "10", label: "Utgående moms 25 %", kind: "output-vat", rate: "VAT25" },
      { box: "11", label: "Utgående moms 12 %", kind: "output-vat", rate: "VAT12" },
      { box: "12", label: "Utgående moms 6 %", kind: "output-vat", rate: "VAT6" },
      { box: "20", label: "Inköp av varor från annat EU-land", kind: "purchase-base" },
      { box: "21", label: "Inköp av tjänster från annat EU-land", kind: "purchase-base", reverseCharge: true },
      { box: "30", label: "Utgående moms på inköp 25 %", kind: "output-vat", rate: "VAT25", reverseCharge: true },
      { box: "31", label: "Utgående moms på inköp 12 %", kind: "output-vat", rate: "VAT12", reverseCharge: true },
      { box: "32", label: "Utgående moms på inköp 6 %", kind: "output-vat", rate: "VAT6", reverseCharge: true },
      {
        box: "39",
        label: "Försäljning av tjänster till näringsidkare i annat EU-land",
        kind: "account-revenue",
        accounts: ["3308"],
      },
      {
        box: "40",
        label: "Övrig försäljning av tjänster omsatta utom landet",
        kind: "account-revenue",
        accounts: ["3305"],
      },
      { box: "48", label: "Ingående moms att dra av", kind: "input-vat" },
      { box: "49", label: "Moms att betala eller få tillbaka", kind: "net" },
    ],
    deductibility: [
      {
        id: "representation-meal",
        label: "Representation meals",
        appliesToAccounts: ["6071", "6072"],
        vatDeductionBaseCapSek: 300,
        perPerson: true,
        incomeTaxDeductible: false,
        source: "Skatteverket — moms vid representation (underlag max 300 kr per person och tillfälle)",
      },
      {
        id: "passenger-car",
        label: "Passenger car leasing",
        appliesToAccounts: ["5610", "5615"],
        vatDeductibleShare: 0.5,
        incomeTaxDeductible: true,
        source: "Skatteverket — avdrag för moms på leasing av personbil (50 %)",
      },
    ],
  };
  ```

  (The file's leading import, `VatRateId`/`VatDirection` types, `regimesByCountry`, and `getVatRegime` are unchanged.)

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected: all tests pass, including the new and renamed ones above.
- [ ] `corepack pnpm typecheck` (the regime type widening and the new `VatBoxDef` fields must typecheck across `packages/domain`; `boxes.ts`'s untouched `switch` must still compile against the wider `VatBoxKind`).
- [ ] Commit:

  ```
  feat(vat): regime data for reverse-charge output map + boxes 39/40 (KFR Phase C)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Task C2 — Kill the `consumedRates` starvation: independent 30–32 accumulator + box 21

**Files:** `packages/domain/src/vat/boxes.ts`, `tests/unit/vat-regime.test.ts`

**Interfaces:** `buildVatReturnBoxes(lines, regime)` — signature unchanged; internal accumulation gains a second (reverse-charge) output-VAT map, used for `reverseCharge: true` box defs, plus a box-21 purchase-base derivation. The `consumedRates` de-duplication `Set` is deleted entirely — it is no longer needed once 10–12 and 30–32 read from separate maps. Box 05 and the `"account-revenue"` case are **not** touched in this task (Tasks C3/C4).

- [ ] Write the failing regression test in `tests/unit/vat-regime.test.ts` (add near the other `buildVatReturnBoxes` tests):

  ```ts
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
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected fail: `amount("30")` is `0` (not `100`) — `consumedRates` already claimed `VAT25` for box 10 by the time the loop reaches box 30 (they share one rate and one accumulator pre-fix). `amount("21")` is `0` (not `400`) — the `"purchase-base"` case is hardcoded to `0`. `amount("10")` (`250`) and `amount("48")` (`350`) **already pass** at this point — box 48 already benefits from Task C1's extended `accounts.input` list (`2645` is already summed by the pre-existing input-account loop, which never used `consumedRates`), and box 10 was never affected by the starvation bug (only the box sharing its rate _after_ it in iteration order was).

- [ ] Implement in `packages/domain/src/vat/boxes.ts`. Replace `buildVatReturnBoxes` (the whole function, from its doc comment through the closing brace) with:

  ```ts
  /**
   * Map posted ledger lines onto the regime's VAT-return box subset.
   *
   * Computed boxes (KFR Phase C / D4 — see
   * docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md):
   *  - 05 sales base: a revenue-class line counts when its own `vatCode` is
   *    rated (the account-classification fix for imported vatCode:"NA"
   *    sales — readiness gap G5 — lands in Task C4).
   *  - 10–12 domestic output VAT: account-keyed off `outputByRate`, its own
   *    map.
   *  - 30–32 reverse-charge output VAT: account-keyed off
   *    `reverseChargeOutputByRate`, ITS OWN map — no longer shares (and is
   *    no longer starved by) the 10–12 accumulator.
   *  - 21 EU-services purchase base: derived from the TRUNCATED box-30
   *    family, per rate, base = RC output VAT ÷ rate (box30 / 0.25 today).
   *    Box 20 (EU goods) stays 0 — no goods reverse-charge accounts
   *    modeled (YAGNI).
   *  - 48 input VAT: account-keyed off `accounts.input` (now also covers
   *    the reverse-charge input legs 2645/2647 alongside 2641/2640, from
   *    Task C1).
   *  - 49 net = (10+11+12) + (30+31+32) − 48, computed FROM the truncated
   *    component boxes — not truncated from the öre-exact net — matching
   *    how Skatteverket derives it.
   *  - 39/40 (account-based EU/export service revenue) land in Task C3.
   *
   * All box amounts are whole kronor (see `toWholeKronor`); internal ledger
   * lines and other projections (`buildVat`) stay öre-exact.
   */
  export function buildVatReturnBoxes(
    lines: LedgerLine[],
    regime: VatRegime = swedishVatRegime,
  ): Array<{ box: string; label: string; amount: number }> {
    const coa = getCoaTemplate(regime.country);
    const accountByRate = new Map<VatRateId, string>(
      (Object.entries(regime.accounts.outputByRate) as Array<[VatRateId, string]>).map(([rate, number]) => [
        rate,
        number,
      ]),
    );
    const rcAccountByRate = new Map<VatRateId, string>(
      (Object.entries(regime.accounts.reverseChargeOutputByRate) as Array<[VatRateId, string]>).map(
        ([rate, number]) => [rate, number],
      ),
    );

    let salesBase = 0;
    let inputVat = 0;
    const outputVatByRate = new Map<VatRateId, number>();
    const rcOutputVatByRate = new Map<VatRateId, number>();

    for (const line of lines) {
      if (regime.accounts.input.includes(line.accountNumber)) {
        inputVat += line.debit - line.credit;
        continue;
      }
      for (const [rate, accountNumber] of accountByRate) {
        if (line.accountNumber === accountNumber) {
          outputVatByRate.set(rate, (outputVatByRate.get(rate) ?? 0) + line.credit - line.debit);
        }
      }
      for (const [rate, accountNumber] of rcAccountByRate) {
        if (line.accountNumber === accountNumber) {
          rcOutputVatByRate.set(rate, (rcOutputVatByRate.get(rate) ?? 0) + line.credit - line.debit);
        }
      }
      // Box 05: the line's actual vatCode decides ratedness (readiness gap
      // G5 — imported vatCode:"NA" sales are NOT yet covered here; that
      // lands in Task C4, which adds a second, account-based arm).
      if (RATED_VAT_CODES.has(line.vatCode) && classifyAccountNumber(line.accountNumber, coa) === "revenue") {
        salesBase += line.credit - line.debit;
      }
    }

    const wholeSalesBase = toWholeKronor(salesBase);
    const wholeInputVat = toWholeKronor(inputVat);
    const wholeOutputVatByRate = new Map<VatRateId, number>(
      [...outputVatByRate].map(([rate, amount]) => [rate, toWholeKronor(amount)]),
    );
    const wholeRcOutputVatByRate = new Map<VatRateId, number>(
      [...rcOutputVatByRate].map(([rate, amount]) => [rate, toWholeKronor(amount)]),
    );
    const totalOutputVat = [...wholeOutputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);
    const totalRcOutputVat = [...wholeRcOutputVatByRate.values()].reduce((sum, amount) => sum + amount, 0);

    // Box 21: base = Σ (truncated box-30-family amount ÷ rate), per rate
    // that has a reverse-charge account modeled. Derived from the DECLARED
    // (whole-kronor) box 30 family, not the öre-exact accumulator — same
    // derive-from-declared-boxes discipline as box 49.
    let purchaseBaseServices = 0;
    for (const [rate, amount] of wholeRcOutputVatByRate) {
      const percent = regime.rates[rate].percent;
      if (percent > 0) purchaseBaseServices += amount / (percent / 100);
    }
    const wholePurchaseBaseServices = toWholeKronor(purchaseBaseServices);

    return regime.boxes.map((def) => {
      let amount = 0;
      switch (def.kind) {
        case "sales-base":
          amount = wholeSalesBase;
          break;
        case "output-vat":
          if (def.rate) {
            amount = (def.reverseCharge ? wholeRcOutputVatByRate : wholeOutputVatByRate).get(def.rate) ?? 0;
          }
          break;
        case "purchase-base":
          amount = def.reverseCharge ? wholePurchaseBaseServices : 0;
          break;
        case "input-vat":
          amount = wholeInputVat;
          break;
        case "net":
          amount = totalOutputVat + totalRcOutputVat - wholeInputVat;
          break;
        // "account-revenue" (boxes 39/40) has no case yet — falls through
        // with amount 0. Task C3 adds it.
      }
      return { box: def.box, label: def.label, amount };
    });
  }
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected: all tests pass, including the new starvation regression.
- [ ] `corepack pnpm exec tsx --test tests/unit/posting-balance.test.ts` (uses `buildVatReturnBoxes` for the box-48 book-without-vat assertion — must stay green; that fixture posts no RC/domestic-output-VAT lines, so boxes 05/21/30/39/40 are all 0, unaffected by this rewrite).
- [ ] `corepack pnpm typecheck`.
- [ ] Commit:

  ```
  fix(vat): boxes 30-32 no longer starved by 10-12's shared accumulator; compute box 21 (KFR Phase C, G1)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Task C3 — Boxes 39/40: account-based EU/export service revenue

**Files:** `packages/domain/src/vat/boxes.ts`, `tests/unit/vat-regime.test.ts`

**Interfaces:** `buildVatReturnBoxes` gains the `"account-revenue"` switch case and its accumulator. Box 05 is untouched (Task C4).

- [ ] Write the failing test in `tests/unit/vat-regime.test.ts`:

  ```ts
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
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected fail: `amount("39")` and `amount("40")` are both `0` (not `2500`/`4000`) — the `switch` has no `"account-revenue"` case yet, so `amount` stays at its initialized `0` regardless of the 3308/3305 postings.

- [ ] Implement in `packages/domain/src/vat/boxes.ts`. Three small edits to the function landed in Task C2:
  1. Add an accumulator next to `outputVatByRate`/`rcOutputVatByRate`:

     ```ts
     const outputVatByRate = new Map<VatRateId, number>();
     const rcOutputVatByRate = new Map<VatRateId, number>();
     const accountRevenueTotals = new Map<string, number>();
     ```

  2. Inside the per-line `for` loop, after the `rcAccountByRate` block and before the box-05 `if`, add:

     ```ts
     for (const def of regime.boxes) {
       if (def.kind === "account-revenue" && def.accounts?.includes(line.accountNumber)) {
         accountRevenueTotals.set(
           line.accountNumber,
           (accountRevenueTotals.get(line.accountNumber) ?? 0) + line.credit - line.debit,
         );
       }
     }
     ```

  3. Replace the trailing comment-only case in the `switch` with a real case:

     ```ts
         case "account-revenue":
           amount = toWholeKronor(
             (def.accounts ?? []).reduce(
               (sum, accountNumber) => sum + (accountRevenueTotals.get(accountNumber) ?? 0),
               0,
             ),
           );
           break;
     ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected: all tests pass, including the new box 39/40 test.
- [ ] `corepack pnpm typecheck`.
- [ ] Commit:

  ```
  feat(vat): compute boxes 39/40 — account-based EU/export service revenue (KFR Phase C)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Task C4 — Box 05: account-classification fix for imported (`vatCode:"NA"`) sales (G5)

**Files:** `packages/domain/src/vat/boxes.ts`, `tests/unit/vat-regime.test.ts`

**Interfaces:** `buildVatReturnBoxes`'s box-05 gate becomes `RATED_VAT_CODES.has(line.vatCode) || voucherHasDomesticOutputVat.has(line.voucherId)` — a revenue-class line counts toward box 05 when EITHER its own `vatCode` is rated OR its voucher carries a domestic output-VAT account line (2610/2620/2630), inferred from a first pass over `lines` grouped by `voucherId`.

This is the readiness-gap G5 fix: `planSieImport` (`packages/domain/src/store.ts:221-236`) forces every imported line's `vatCode` to `"NA"`, so a migrated domestic rated sale currently shows output VAT (box 10, account-gated) without a matching sales base (box 05, vatCode-gated) — an internally contradictory return. Account evidence from the SAME voucher (the 2610/2620/2630 line the sale was originally booked with) resolves it without needing to touch the SIE importer itself.

- [ ] Rewrite the existing `"box 05 attributes by the LINE's vatCode"` test in `tests/unit/vat-regime.test.ts`, giving its two logically-separate transactions distinct `voucherId`s (a required fixture-hygiene fix — its `line()` helper currently defaults every line to the same `voucherId: "v1"`, which the new voucher-grouped gate would otherwise misread as one transaction), and add the new G5 regression test right after it:

  ```ts
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
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected fail: the new G5 regression test — `amount("05")` is `0` (not `1000`), since box 05 is still purely `vatCode`-gated and every line in the fixture carries `"NA"`. The rewritten `"off-template"` test already passes at this point (box 05 is voucherId-agnostic pre-fix, so the `voucherId` rewrite is a no-op for its result either way) — it is rewritten now specifically so it does **not** regress once the fix below lands (see rationale above the test).

- [ ] Implement in `packages/domain/src/vat/boxes.ts`. Two edits to the function landed in Tasks C2/C3:
  1. After computing `accountByRate` (and before the per-line loop), add the domestic-output-account set and a first pass over `lines`:

     ```ts
     const domesticOutputAccounts = new Set(accountByRate.values());

     // Pass 1: which vouchers carry a domestic output-VAT account line at
     // all (any rate) — the box 05 fallback below reads this, not the
     // line's own vatCode, when that vatCode is silent (SIE imports; G5).
     const voucherHasDomesticOutputVat = new Set<string>();
     for (const line of lines) {
       if (domesticOutputAccounts.has(line.accountNumber) && line.credit - line.debit !== 0) {
         voucherHasDomesticOutputVat.add(line.voucherId);
       }
     }
     ```

  2. Replace the box-05 `if` inside the main per-line loop:

     ```ts
     // Box 05 (G5 fix): rated by the line's OWN vatCode, OR inferred from a
     // matching domestic output-VAT account line in the SAME voucher.
     const ratedForSalesBase = RATED_VAT_CODES.has(line.vatCode) || voucherHasDomesticOutputVat.has(line.voucherId);
     if (ratedForSalesBase && classifyAccountNumber(line.accountNumber, coa) === "revenue") {
       salesBase += line.credit - line.debit;
     }
     ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts`. Expected: all tests pass, including both the rewritten and the new G5 test.
- [ ] `corepack pnpm check` (full gate — lint/format/typecheck ×2/unit/build — Tasks C1–C4 together complete the domain-side change set for D4's box computation).
- [ ] Commit:

  ```
  fix(vat): box 05 account-classification basis catches imported vatCode:NA sales (KFR Phase C, G5)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Task C5 — Golden-fixture unit test: the whole return, one small ledger

**Files:** `tests/unit/vat-return-golden.test.ts` (new)

- [ ] Create `tests/unit/vat-return-golden.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";

  import { vatReturnBoxSchema } from "@jpx-accounting/contracts";
  import type { LedgerLine } from "@jpx-accounting/domain";
  import { buildVatReturnBoxes } from "@jpx-accounting/domain";

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

  test("golden ledger balances to the öre, voucher by voucher (fixture sanity)", () => {
    const byVoucher = new Map<string, LedgerLine[]>();
    for (const line of ledger) {
      byVoucher.set(line.voucherId, [...(byVoucher.get(line.voucherId) ?? []), line]);
    }
    for (const [voucherId, lines] of byVoucher) {
      const debit = lines.reduce((sum, l) => sum + Math.round(l.debit * 100), 0);
      const credit = lines.reduce((sum, l) => sum + Math.round(l.credit * 100), 0);
      assert.equal(debit, credit, `voucher ${voucherId} must balance to the öre`);
    }
  });

  test("golden VAT return: every box pinned, incl. the 49 identity and whole-kronor truncation", () => {
    const boxes = buildVatReturnBoxes(ledger);
    const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;

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
  });

  test("boxes 30-32 remain independently non-zero alongside 10-12 in the same return (starvation regression)", () => {
    const boxes = buildVatReturnBoxes(ledger);
    const amount = (box: string) => boxes.find((entry) => entry.box === box)?.amount;
    assert.equal(amount("10"), 251, "domestic output VAT (10) must not be zeroed by the RC box computation");
    assert.equal(amount("30"), 185, "RC output VAT (30) must not be starved by 10 claiming the VAT25 rate first");
  });

  test("every box in the golden return satisfies the unchanged wire contract (39/40 need no schema change)", () => {
    const boxes = buildVatReturnBoxes(ledger);
    for (const box of boxes) {
      assert.doesNotThrow(() => vatReturnBoxSchema.parse(box));
    }
  });
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-return-golden.test.ts`. Expected: green on first run — Tasks C1–C4 are already landed and independently tested by this point, so this file's role is a cross-checking golden pin, not a new red state. If any assertion fails, treat it as a fixture/expected-value arithmetic error (re-derive by hand from the worked comments above) before suspecting the production code, since every box kind already has its own passing unit test from C1–C4.
- [ ] Run the full unit suite to confirm nothing else regressed: `corepack pnpm exec tsx --test 'tests/unit/**/*.test.ts'`.
- [ ] `corepack pnpm check`.
- [ ] Commit:

  ```
  test(vat): golden-fixture VAT return — pins every box incl. 49 identity and öre truncation (KFR Phase C)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

## Task C6 — Contract and UI verification (no source changes expected)

**Files:** none changed (verification only) — `packages/contracts/src/index.ts` (read), `apps/web/components/reports/vat-return-table.tsx` (read), `tests/e2e/visual-regression.spec.ts` (read + action noted)

This task confirms the two "if applicable" items from the phase brief resolve to **no-ops**, and flags the one follow-up action that is NOT a no-op (visual re-baseline).

- [ ] Confirm `vatReturnBoxSchema` (`packages/contracts/src/index.ts:340-344`) is:

  ```ts
  export const vatReturnBoxSchema = z.object({
    box: z.string(),
    label: z.string(),
    amount: z.number(),
  });
  ```

  `box` is an unconstrained string, not a literal-id enum — new ids `"39"`/`"40"` parse without any contract change. This is asserted executably in Task C5's last test (`vatReturnBoxSchema.parse(box)` over the whole golden return, including boxes 39/40). **No edit needed** to `packages/contracts/src/index.ts`.

- [ ] Confirm `apps/web/components/reports/vat-return-table.tsx` renders `boxes.map((box) => ...)` generically — box `label` comes from the server-computed regime data (Swedish statutory wording baked into `vat/regime.ts`), not from `next-intl` messages. The component's own `t()` calls (`reports.vat.title`, `.description`, `.headerBox`, `.headerLabel`, `.headerAmount`, `.toPay`, `.toRefund`) are page chrome, unrelated to individual box labels, and already exist in both `apps/web/messages/sv.json` and `en.json`. **No edit needed** to the component or either messages file — box labels are deliberately NOT an i18n surface (see the `vatReturnBoxSchema` doc comment in contracts: "labels come from the VAT regime data").

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts tests/unit/vat-return-golden.test.ts tests/unit/posting-balance.test.ts tests/unit/report-pack.test.ts` — confirm the reports-pack pipeline (`packages/domain/src/reports/pack.ts` → `buildVatReturnBoxes`) still composes cleanly with the new box count (11 → 13 rows).

- [ ] **Flag, do not execute here**: `/reports` is one of the 20 screens in `tests/e2e/visual-regression.spec.ts`'s baseline set (`SCREENS` array, `{ name: "reports", path: "/reports", readySelector: '[data-testid="cash-bridge"] svg' }`). Adding boxes 39/40 grows the momsdeklaration table from 11 to 13 rows, changing the reports screen's rendered height and therefore its pixel baseline in both themes and both platform suffixes (`-win32`/`-linux`). This phase's commits do not re-baseline — that is deliberately deferred to whoever runs Phase C's E2E pass (or the master's post-all-phases verification step 2), per `scripts/visual-baselines.md`: run `pnpm build:e2e && pnpm test:e2e:visual`, expect `reports-light`/`reports-dark` diffs (and no others), review the diff images, then `pnpm test:e2e:visual:update`.

- [ ] No commit for this task (verification only, no source changes).

## Summary of what this phase does NOT touch (by design, confirmed above)

- `packages/contracts/src/index.ts` — `vatReturnBoxSchema` needed no change.
- `apps/web/components/reports/vat-return-table.tsx` and `apps/web/messages/{sv,en}.json` — box labels are server-baked Swedish text, not an i18n surface.
- `packages/domain/src/projections.ts` `buildVat()` — the master's interface contract scopes VAT changes to `vat/regime.ts` + `vat/boxes.ts` only; `buildVat` (grouped by `vatCode`, used for the VAT projection cards / simulation deltas elsewhere) is untouched and still has no reverse-charge or account-revenue awareness. This is a deliberate scope boundary, not an oversight — flagged here so a later phase doesn't assume `buildVat` already reflects RC/export splits.
- `packages/domain/src/simulation.ts` — `simulateApprovals`'s `isVatLine` check reads `regime.accounts.input`, so it automatically (and correctly) picks up `2645`/`2647` once Task C1 lands, with no code change needed there. Noted for awareness, not an action item.
- Any store (`MemoryLedgerStore`/`PostgresLedgerStore`) — box computation is a pure function over already-posted `LedgerLine[]`; nothing here changes how lines are produced (that is Phase B's `buildPostingLines`/RC25 shape).
