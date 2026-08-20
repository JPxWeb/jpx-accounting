# KFR Phase B — Posting Engine

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

**Delivers:** manual N-line journal entries through the review gate (D2), and a generalized `buildPostingLines` supporting a configurable settlement account, the `RC25` EU reverse-charge shape, and revenue-direction postings (D3). CoA additions for the new roles. Migration `0009`.

**Two facts this plan corrects relative to the master/readiness docs (read before executing):**

1. **`vatCodeSchema` does not exist yet** in `packages/contracts/src/index.ts`. The master's "add literal `RC25`" phrasing assumes a pre-existing schema; there is none — `vatCode` fields today are typed `z.string()` and validated at runtime via `validEditVatCodes(regime)` in `packages/domain/src/store-shared.ts`. Task 1 **creates** `vatCodeSchema` (the client-selectable vocabulary: `VAT25|VAT12|VAT6|VAT0|NA|RC25`) and uses it only for the new `manualVoucherLineSchema.vatCode`. It must **not** replace `accountingSuggestionSchema.vatCode` (still `z.string()`) — that field legitimately carries the system-only `"VAT-REVIEW"` blocked-marker (`packages/domain/src/rules.ts:139`), which is outside the selectable vocabulary by design.
2. **Account `8910` ("Skatt som belastar årets resultat") already exists** in `packages/domain/src/coa/bas-2026.ts` (line 176). The readiness spec's G1/D4 list double-counts it. Task 3 adds the other 10 accounts only and explicitly does not touch 8910.

Two further findings surfaced while tracing the exact ripple of `voucherSchema.evidencePacketId` → `.nullable()`, folded into Task 2 below (not called out separately in the master): five test fixtures construct `Voucher` object literals directly (they will fail `typecheck` once `origin` is required), and two non-test call sites (`packages/reporting/src/observations.ts`, `apps/web/components/reports/voucher-link.tsx`) call `Map<string, X>.get()` with what becomes a `string | null` key.

---

## Task 1 — Contracts: vatCodeSchema, manual voucher schemas, settlement/direction fields, voucher origin

**Files:** `packages/contracts/src/index.ts`

**Interfaces:**

```ts
export const vatCodeSchema = z.enum(["VAT25", "VAT12", "VAT6", "VAT0", "NA", "RC25"]);
export type VatCode = z.infer<typeof vatCodeSchema>;

export const manualVoucherLineSchema = z.object({...}).refine(...);
export type ManualVoucherLine = z.infer<typeof manualVoucherLineSchema>;

export const manualVoucherInputSchema = z.object({...}).superRefine(...);
export type ManualVoucherInput = z.infer<typeof manualVoucherInputSchema>;

export const manualVoucherResultSchema = z.object({ voucherId: z.string(), reviewId: z.string() });
export type ManualVoucherResult = z.infer<typeof manualVoucherResultSchema>;
```

- [ ] Write the failing test first. Create `tests/unit/contracts-manual-voucher.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";

  import {
    manualVoucherInputSchema,
    manualVoucherResultSchema,
    reviewDecisionEditSchema,
    vatCodeSchema,
    voucherSchema,
    accountingSuggestionSchema,
  } from "@jpx-accounting/contracts";

  test("vatCodeSchema accepts the rated codes, NA, and RC25", () => {
    for (const code of ["VAT25", "VAT12", "VAT6", "VAT0", "NA", "RC25"]) {
      assert.equal(vatCodeSchema.parse(code), code);
    }
    assert.throws(() => vatCodeSchema.parse("VAT-REVIEW"));
  });

  test("manualVoucherInputSchema accepts a balanced 2-line entry and rejects an unbalanced one", () => {
    const balanced = manualVoucherInputSchema.parse({
      description: "Utlägg för kontorsmaterial",
      bookedAt: "2026-03-15",
      lines: [
        { accountNumber: "6110", debit: 100, credit: 0 },
        { accountNumber: "2899", debit: 0, credit: 100 },
      ],
    });
    assert.equal(balanced.lines[0]?.vatCode, "NA", "vatCode defaults to NA");

    assert.throws(() =>
      manualVoucherInputSchema.parse({
        description: "Unbalanced",
        bookedAt: "2026-03-15",
        lines: [
          { accountNumber: "6110", debit: 100, credit: 0 },
          { accountNumber: "2899", debit: 0, credit: 50 },
        ],
      }),
    );
  });

  test("manualVoucherLineSchema rejects a line with both debit and credit set, or neither", () => {
    assert.throws(() =>
      manualVoucherInputSchema.shape.lines.element.parse({ accountNumber: "1930", debit: 10, credit: 10 }),
    );
    assert.throws(() =>
      manualVoucherInputSchema.shape.lines.element.parse({ accountNumber: "1930", debit: 0, credit: 0 }),
    );
  });

  test("manualVoucherResultSchema shape", () => {
    assert.deepEqual(manualVoucherResultSchema.parse({ voucherId: "v1", reviewId: "r1" }), {
      voucherId: "v1",
      reviewId: "r1",
    });
  });

  test("reviewDecisionEditSchema accepts an optional 4-digit settlementAccountNumber", () => {
    const parsed = reviewDecisionEditSchema.parse({
      accountNumber: "6110",
      vatCode: "VAT25",
      settlementAccountNumber: "2899",
    });
    assert.equal(parsed.settlementAccountNumber, "2899");
    assert.throws(() =>
      reviewDecisionEditSchema.parse({ accountNumber: "6110", vatCode: "VAT25", settlementAccountNumber: "89" }),
    );
  });

  test("accountingSuggestionSchema accepts optional direction and manual lines", () => {
    const parsed = accountingSuggestionSchema.parse({
      id: "s1",
      voucherId: "v1",
      accountNumber: "3305",
      accountName: "Försäljning tjänster till land utanför EU",
      vatCode: "VAT0",
      confidence: 1,
      reasoning: "manual",
      citations: [],
      ruleHits: [],
      direction: "revenue",
      lines: [{ accountNumber: "3305", debit: 0, credit: 100, vatCode: "VAT0" }],
    });
    assert.equal(parsed.direction, "revenue");
    assert.equal(parsed.lines?.[0]?.credit, 100);
  });

  test("voucherSchema accepts a null evidencePacketId and defaults origin to capture", () => {
    const parsed = voucherSchema.parse({
      id: "v1",
      organizationId: "o",
      workspaceId: "w",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK" },
      createdAt: "2026-03-15T00:00:00.000Z",
      createdBy: "u",
    });
    assert.equal(parsed.evidencePacketId, null);
    assert.equal(parsed.origin, "capture");
  });
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/contracts-manual-voucher.test.ts` — expect failures (`vatCodeSchema`/`manualVoucherInputSchema`/etc. are not exported; `settlementAccountNumber`/`direction`/`lines`/`origin` are unknown keys stripped or `evidencePacketId: null` fails the current `z.string()`).
- [ ] Implement. In `packages/contracts/src/index.ts`, right after `export const accountingMethodSchema = z.enum(["invoice", "cash"]);` (line 9), insert:

  ```ts
  /**
   * VAT code vocabulary for CLIENT-SELECTABLE postings (KFR Phase B / D3):
   * reviewer edits and manual voucher lines. Deliberately narrower than every
   * value the system can carry — "VAT-REVIEW" is the system's blocked-marker
   * assigned by `buildDeterministicSuggestion` when a voucher is rule-blocked
   * (packages/domain/src/rules.ts) and is NEVER a posting choice, so it is
   * excluded here on purpose. `accountingSuggestionSchema.vatCode` stays
   * `z.string()` for that reason — do not tighten it to this schema.
   */
  export const vatCodeSchema = z.enum(["VAT25", "VAT12", "VAT6", "VAT0", "NA", "RC25"]);
  export type VatCode = z.infer<typeof vatCodeSchema>;
  ```

  Immediately before `export const accountingSuggestionSchema = z.object({` (currently line 133), insert:

  ```ts
  /**
   * One line of a manual N-line journal entry (KFR Phase B / D2). Exactly one
   * of debit/credit must be positive — never both, never neither.
   */
  export const manualVoucherLineSchema = z
    .object({
      accountNumber: z.string().regex(/^\d{4}$/),
      debit: z.number().nonnegative(),
      credit: z.number().nonnegative(),
      vatCode: vatCodeSchema.default("NA"),
    })
    .refine((line) => line.debit > 0 !== line.credit > 0, {
      message: "Exactly one of debit or credit must be greater than 0.",
      path: ["debit"],
    });
  export type ManualVoucherLine = z.infer<typeof manualVoucherLineSchema>;
  ```

  Then change `accountingSuggestionSchema` to add `direction` and `lines`:

  ```ts
  export const accountingSuggestionSchema = z.object({
    id: z.string(),
    voucherId: z.string(),
    accountNumber: z.string(),
    accountName: z.string(),
    vatCode: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    kind: suggestionKindSchema.default("recommendation"),
    citations: z.array(citationSchema),
    ruleHits: z.array(ruleHitSchema),
    /** Absent = expense (KFR D3). Explicit "revenue" wins over account-class inference in buildPostingLines. */
    direction: z.enum(["expense", "revenue"]).optional(),
    /**
     * Verbatim posting lines for a manual-origin voucher's suggestion (KFR
     * Phase B / D2). Present ONLY when the owning voucher's `origin` is
     * "manual" — approval posts these lines unchanged, bypassing
     * `buildPostingLines` (see `planReviewDecision`). Absent for every
     * capture/import-origin suggestion.
     */
    lines: z.array(manualVoucherLineSchema).optional(),
  });
  ```

  In `reviewDecisionEditSchema` (currently lines 487-513), add the new field right after `bookedAt` (before the closing `});`):

  ```ts
    /**
     * Settlement account override (KFR D3): replaces the hardcoded bank credit
     * in `buildPostingLines` — e.g. 2899 (utlägg) or 1630 (skattekonto)
     * instead of the default 1930. Must exist in the CoA (validated in
     * `resolveReviewDecisionEdit`, same rigor as `accountNumber`). Absent =
     * `coa.roles.bank`.
     */
    settlementAccountNumber: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  ```

  Change `voucherSchema` (currently lines 119-131):

  ```ts
  export const voucherSchema = z.object({
    id: z.string(),
    organizationId: z.string(),
    workspaceId: z.string(),
    evidencePacketId: z.string().nullable(),
    voucherNumber: z.string(),
    status: reviewStatusSchema,
    accountingMethod: accountingMethodSchema,
    extractedFields: z.array(extractedFieldSchema),
    voucherFields: voucherFieldSchema,
    createdAt: z.string(),
    createdBy: z.string(),
    /** capture = evidence-driven (default, existing rows backfill via this default); manual = KFR D2; import = SIE (reserved, KFR Phase D). */
    origin: z.enum(["capture", "manual", "import"]).default("capture"),
  });
  ```

  Immediately after `reviewDecisionInputSchema` (currently lines 516-519), insert:

  ```ts
  /**
   * `POST /api/vouchers/manual` request body (KFR Phase B / D2). Balanced to
   * within 0.005 at the wire boundary; `LedgerStore.createManualVoucher`
   * additionally requires exact-öre balance (`postingImbalanceOre`) before any
   * mutation — the ±0.005 tolerance here only lets legitimate float noise
   * through, not real imbalances.
   */
  export const manualVoucherInputSchema = z
    .object({
      description: z.string().min(1).max(200),
      bookedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lines: z.array(manualVoucherLineSchema).min(2).max(100),
      /**
       * Forward-compat only in this phase: accepted but NOT yet attached.
       * `createManualVoucher` always creates the voucher with
       * `evidencePacketId: null` (see interface contract) — Phase D's
       * `evidenceComposeInputSchema.targetVoucherId` attach flow is the
       * mechanism that will consume this field.
       */
      evidenceIds: z.array(z.string()).optional(),
    })
    .superRefine((value, ctx) => {
      const debit = value.lines.reduce((sum, line) => sum + line.debit, 0);
      const credit = value.lines.reduce((sum, line) => sum + line.credit, 0);
      if (Math.abs(debit - credit) > 0.005) {
        ctx.addIssue({
          code: "custom",
          message: `Manual voucher lines do not balance: Σdebit (${debit}) must equal Σcredit (${credit}) within 0.005.`,
          path: ["lines"],
        });
      }
    });
  export type ManualVoucherInput = z.infer<typeof manualVoucherInputSchema>;

  export const manualVoucherResultSchema = z.object({
    voucherId: z.string(),
    reviewId: z.string(),
  });
  export type ManualVoucherResult = z.infer<typeof manualVoucherResultSchema>;
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/contracts-manual-voucher.test.ts` — expect pass.
- [ ] Run `corepack pnpm typecheck` — expect failures in the ripple sites (Task 2 fixes them). Confirm the failures are exactly: `tests/unit/ai-core-runtime.test.ts`, `tests/unit/compliance.test.ts`, `tests/unit/observations.test.ts`, `tests/unit/posting-balance.test.ts`, `tests/unit/simulation.test.ts` (missing `origin`), `packages/reporting/src/observations.ts` + `apps/web/components/reports/voucher-link.tsx` (`Map.get(string | null)`), `packages/persistence-postgres/src/store.ts` (`VoucherRow.evidence_packet_id: string` too narrow, `rowToVoucher` missing `origin`).
- [ ] Commit:

  ```
  feat(contracts): add vatCodeSchema, manual voucher schemas, settlement/direction fields, voucher origin

  KFR Phase B (D2/D3): the client-selectable VAT vocabulary, manual N-line
  entry request/result shapes, a settlement-account override on review edits,
  a direction hint on suggestions, and voucher.origin/nullable evidencePacketId
  for vouchers created without evidence.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 2 — Fix the nullable/origin ripple (keep typecheck green before behavior changes)

**Files:** `tests/unit/ai-core-runtime.test.ts`, `tests/unit/compliance.test.ts`, `tests/unit/observations.test.ts`, `tests/unit/posting-balance.test.ts`, `tests/unit/simulation.test.ts`, `packages/reporting/src/observations.ts`, `apps/web/components/reports/voucher-link.tsx`, `packages/persistence-postgres/src/store.ts`

No new tests in this task — it is a pure type-fallout fix from Task 1, verified by `typecheck`.

- [ ] In each of the five test fixture files, add `origin: "capture",` to the `Voucher`-typed object literal (all five use direct/return-typed `Voucher` literals, not `as Voucher` casts, so TS structurally requires the new field):
  - `tests/unit/ai-core-runtime.test.ts` — inside `voucherFixture()`, after `evidencePacketId: "packet_test_1",` add `origin: "capture",`.
  - `tests/unit/compliance.test.ts` — inside `voucherFixture()`, after `evidencePacketId: "p1",` add `origin: "capture",`.
  - `tests/unit/observations.test.ts` — inside `makeVoucher()`, after `evidencePacketId: input.packetId,` add `origin: "capture",`.
  - `tests/unit/posting-balance.test.ts` — inside `voucherFixture()`, after `evidencePacketId: "p",` add `origin: "capture",`.
  - `tests/unit/simulation.test.ts` — inside `voucherFixture()`, after `evidencePacketId: "p",` add `origin: "capture",`.
- [ ] In `tests/unit/observations.test.ts`, fix the now-too-narrow helper call at line 345 (`packet(id: string, ...)` vs. `voucher.evidencePacketId: string | null`):
  ```ts
  // before
  packets: vouchers.map((voucher) => packet(voucher.evidencePacketId, ["evidence_x"])),
  // after
  packets: vouchers.map((voucher) => packet(voucher.evidencePacketId!, ["evidence_x"])),
  ```
  (Non-null assertion is safe here: every voucher in this fixture is built by `makeVoucher`, which always supplies a real packet id.)
- [ ] In `packages/reporting/src/observations.ts`, guard the nullable key at line 247:
  ```ts
  // before
  const packet = packetsById.get(voucher.evidencePacketId);
  // after
  const packet = voucher.evidencePacketId ? packetsById.get(voucher.evidencePacketId) : undefined;
  ```
  (Behavior-preserving: a manual voucher's `null` id already couldn't match any real packet id, so this keeps `detectMissingEvidence` flagging manual-origin vouchers exactly like it already flags any voucher with an unresolvable packet — refining that heuristic per-origin is out of this phase's scope.)
- [ ] In `apps/web/components/reports/voucher-link.tsx`, guard the same pattern at line 38:
  ```ts
  // before
  const packet = voucher ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  // after
  const packet = voucher?.evidencePacketId ? lookup.packetsById.get(voucher.evidencePacketId) : undefined;
  ```
- [ ] In `packages/persistence-postgres/src/store.ts`:
  - Change the `VoucherRow` type (around line 178-190): `evidence_packet_id: string;` → `evidence_packet_id: string | null;`, and add `origin: string;` as a new field.
  - In `rowToVoucher` (around line 262-276), add `origin: row.origin as Voucher["origin"],` to the returned object.
  - Add `origin` to every `ledger.vouchers` SELECT column list. All six occurrences share the exact same two-line substring — replace it everywhere in the file in one pass:
    ```
    accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
    ```
    →
    ```
    accounting_method, status, voucher_fields, extracted_fields, created_by, created_at, origin
    ```
  - In the `createEvidence` INSERT into `ledger.vouchers` (around line 691-717), add the `origin` column and value:
    ```sql
    INSERT INTO ledger.vouchers (
      id, organization_id, workspace_id, evidence_packet_id, voucher_number,
      accounting_method, status, voucher_fields, extracted_fields, created_by,
      created_at, origin
    ) VALUES (
      ${voucher.id}, ${voucher.organizationId}, ${voucher.workspaceId}, ${voucher.evidencePacketId},
      ${voucher.voucherNumber}, ${voucher.accountingMethod}, ${voucher.status},
      ${tx.json(voucher.voucherFields as Parameters<typeof tx.json>[0])},
      ${tx.json(voucher.extractedFields as unknown as Parameters<typeof tx.json>[0])},
      ${voucher.createdBy}, ${voucher.createdAt}, ${voucher.origin}
    )
    ```
- [ ] Also update `packages/domain/src/store-planning.ts`'s `planEvidenceCreate` voucher literal (around line 161-173) to add `origin: "capture",` (same reason as the test fixtures — `Voucher` is now stricter).
- [ ] Run `corepack pnpm typecheck` — expect pass (0 errors).
- [ ] Run `corepack pnpm exec tsx --test tests/unit/*.test.ts` — expect the full existing suite still green (no behavior changed yet, only types/columns threaded through).
- [ ] Commit:

  ```
  fix(types): thread voucher.origin and nullable evidencePacketId through existing call sites

  Voucher.origin became a required field (with a zod default) and
  evidencePacketId became nullable in the previous commit; this closes every
  resulting TS gap with no behavior change: capture-flow vouchers keep
  origin "capture" and a real evidencePacketId everywhere.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 3 — CoA: new accounts + reverse-charge/owner-settlement roles

**Files:** `packages/domain/src/coa/bas-2026.ts`, `packages/domain/src/coa/types.ts`, `tests/unit/coa-registry.test.ts`

**Interfaces:**

```ts
export type CoaRoleMap = {
  // ...existing fields unchanged...
  reverseChargeOutput: string;
  reverseChargeInput: string;
  ownerSettlement: string;
};
```

- [ ] Write the failing test first. Extend `tests/unit/coa-registry.test.ts`:

  ```ts
  test("bas-2026 contains exactly the 78-account SMB subset (68 + 10 KFR Phase B additions)", () => {
    assert.equal(bas2026.accounts.length, 78);
  });

  test("KFR Phase B accounts exist with the correct BAS names and classes", () => {
    const expected: Array<[string, string, CoaAccountClass]> = [
      ["1229", "Ackumulerade avskrivningar på inventarier och verktyg", "asset"],
      ["1259", "Ackumulerade avskrivningar på datorer", "asset"],
      ["2126", "Periodiseringsfond 2016", "equity-liability"],
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
    assert.equal(bas2026.accounts.filter((a) => a.number === "8910").length, 1);
  });

  test("reverseChargeOutput/reverseChargeInput/ownerSettlement roles resolve", () => {
    assert.ok(findCoaAccount(bas2026, bas2026.roles.reverseChargeOutput));
    assert.ok(findCoaAccount(bas2026, bas2026.roles.reverseChargeInput));
    assert.ok(findCoaAccount(bas2026, bas2026.roles.ownerSettlement));
    assert.equal(bas2026.roles.reverseChargeOutput, "2614");
    assert.equal(bas2026.roles.reverseChargeInput, "2645");
    assert.equal(bas2026.roles.ownerSettlement, "2899");
  });
  ```

  Also update the existing pinned test at line 24 (`assert.equal(bas2026.accounts.length, 68)` → `78`, adjust its title) and add the three new roles to the `roleAccounts` array in `"every role account resolves via findCoaAccount"` (line ~28-38):

  ```ts
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
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/coa-registry.test.ts` — expect failures (accounts missing, roles missing, old length pin at 68 now fails on the count assertion you haven't changed yet — change it in the same edit as above so the file is internally consistent before running).
- [ ] Implement. In `packages/domain/src/coa/types.ts`, extend `CoaRoleMap`:
  ```ts
  export type CoaRoleMap = {
    bank: string;
    cash: string;
    accountsReceivable: string;
    accountsPayable: string;
    inputVat: string;
    outputVatByRate: Record<"VAT25" | "VAT12" | "VAT6", string>;
    vatSettlement: string;
    fallbackExpense: string;
    rounding: string;
    /** KFR D3: self-assessed output VAT liability on an EU reverse-charge service purchase. */
    reverseChargeOutput: string;
    /** KFR D3: self-assessed deductible input VAT on the same purchase. */
    reverseChargeInput: string;
    /** KFR D2: default non-bank settlement account for owner-paid utlägg. */
    ownerSettlement: string;
  };
  ```
  In `packages/domain/src/coa/bas-2026.ts`, insert the 10 new accounts in their BAS-number-ordered positions and update the two comment/header lines:
  ```ts
  // header comment: "BAS 2026 — 68-account Swedish SMB subset" → "BAS 2026 — 78-account Swedish SMB subset (58 original + 10 KFR Phase B reverse-charge/year-end additions)"
  ```
  ```ts
  // after "1250" Datorer, before "1510" Kundfordringar:
  { number: "1229", name: "Ackumulerade avskrivningar på inventarier och verktyg", accountClass: "asset", defaultVatCode: "NA" },
  { number: "1259", name: "Ackumulerade avskrivningar på datorer", accountClass: "asset", defaultVatCode: "NA" },
  ```
  ```ts
  // after "2099" Årets resultat, before "2440" Leverantörsskulder:
  { number: "2126", name: "Periodiseringsfond 2016", accountClass: "equity-liability", defaultVatCode: "NA" },
  ```
  ```ts
  // after "2510" Skatteskulder, before "2610" Utgående moms 25 %:
  { number: "2518", name: "Betald F-skatt", accountClass: "equity-liability", defaultVatCode: "NA" },
  ```
  ```ts
  // after "2641" Debiterad ingående moms, before "2650" Redovisningskonto för moms:
  { number: "2645", name: "Beräknad ingående moms på förvärv från utlandet", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2647", name: "Ingående moms omvänd skattskyldighet varor och tjänster i Sverige", accountClass: "equity-liability", defaultVatCode: "NA" },
  { number: "2614", name: "Utgående moms omvänd skattskyldighet, 25 %", accountClass: "equity-liability", defaultVatCode: "NA" },
  ```
  (Numeric BAS ordering is cosmetic only — group with the other VAT-technical accounts near 2610-2650; exact array position does not affect behavior.)
  ```ts
  // after "2731" Avräkning lagstadgade sociala avgifter, before "2890" Övriga kortfristiga skulder:
  { number: "2899", name: "Övriga kortfristiga skulder", accountClass: "equity-liability", defaultVatCode: "NA" },
  ```
  ```ts
  // after "3308" Försäljning tjänster till annat EU-land, before "3740" Öres- och kronutjämning:
  { number: "3305", name: "Försäljning tjänster till land utanför EU", accountClass: "revenue", defaultVatCode: "VAT0" },
  ```
  ```ts
  // after "8410" Räntekostnader för långfristiga skulder, before "8910" (existing) Skatt som belastar årets resultat:
  { number: "8811", name: "Avsättning till periodiseringsfond", accountClass: "financial", defaultVatCode: "NA" },
  ```
  Update `roles`:
  ```ts
  roles: {
    bank: "1930",
    cash: "1910",
    accountsReceivable: "1510",
    accountsPayable: "2440",
    inputVat: "2641",
    outputVatByRate: { VAT25: "2610", VAT12: "2620", VAT6: "2630" },
    vatSettlement: "2650",
    fallbackExpense: "6991",
    rounding: "3740",
    reverseChargeOutput: "2614",
    reverseChargeInput: "2645",
    ownerSettlement: "2899",
  },
  ```
- [ ] Run: `corepack pnpm exec tsx --test tests/unit/coa-registry.test.ts` — expect pass.
- [ ] Run: `corepack pnpm exec tsx --test tests/unit/vat-regime.test.ts tests/unit/report-statements.test.ts tests/unit/report-pack.test.ts` — these iterate `bas2026.accounts`/classify by first digit; expect pass unchanged (new accounts all match `CLASS_BY_FIRST_DIGIT`).
- [ ] Commit:

  ```
  feat(coa): add KFR Phase B year-end/reverse-charge accounts and roles

  1229, 1259, 2126, 2518, 2614, 2645, 2647, 2899, 3305, 8811 join the BAS
  2026 subset (8910 already existed — not duplicated); CoaRoleMap gains
  reverseChargeOutput/reverseChargeInput/ownerSettlement for the D3 posting
  shapes.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 4 — `buildPostingLines` generalization + settlement validation (store-shared.ts)

**Files:** `packages/domain/src/store-shared.ts`, `tests/unit/posting-balance.test.ts`

**Interfaces:**

```ts
export function buildPostingLines(
  voucher: Voucher,
  suggestion: AccountingSuggestion,
  action: "approve" | "book-without-vat",
  occurredAt: string,
  coa?: CoaTemplate,
  options?: { settlementAccountNumber?: string },
): LedgerLine[];

export function buildManualPostingLines(
  voucher: Voucher,
  lines: ManualVoucherLine[],
  occurredAt: string,
  coa?: CoaTemplate,
): LedgerLine[];

export function resolveReviewDecisionEdit(
  voucher: Voucher,
  suggestion: AccountingSuggestion | undefined,
  edited: ReviewDecisionEdit,
  coa?: CoaTemplate,
): {
  effectiveSuggestion: AccountingSuggestion | undefined;
  effectiveVoucher: Voucher;
  effectiveSettlementAccountNumber: string | undefined;
};

export class InvalidManualVoucherError extends Error {
  readonly issues: string[];
}
```

- [ ] Write the failing tests first. `tests/unit/posting-balance.test.ts` currently imports `assertBalancedPosting, buildPostingLines, buildVat, buildVatReturnBoxes, InvalidReviewEditError, postingImbalanceOre, UnbalancedPostingError` from `@jpx-accounting/domain` — add `resolveReviewDecisionEdit` to that same import list (it does not need `AccountingSuggestion`/`Voucher` type imports added; both are already imported from `@jpx-accounting/contracts`). Add to `tests/unit/posting-balance.test.ts` (after the existing `buildPostingLines` tests):

  ```ts
  test("buildPostingLines settlement override credits the given account instead of the default bank role", () => {
    const lines = buildPostingLines(
      voucherFixture({ grossAmount: 500, netAmount: 400, vatAmount: 100 }),
      suggestionFixture(),
      "approve",
      "2026-05-01T00:00:00.000Z",
      undefined,
      { settlementAccountNumber: "2899" },
    );
    const settlement = lines[2];
    assert.ok(settlement);
    assert.equal(settlement.accountNumber, "2899");
    assert.equal(settlement.credit, 500);
    assert.equal(postingImbalanceOre(lines), 0);
  });

  test("buildPostingLines RC25 shape posts a balanced 4-line reverse-charge entry", () => {
    const rc25Suggestion: AccountingSuggestion = { ...suggestionFixture(), vatCode: "RC25" };
    const lines = buildPostingLines(
      voucherFixture({ grossAmount: 1250, netAmount: 1000, vatAmount: 250 }),
      rc25Suggestion,
      "approve",
      "2026-05-01T00:00:00.000Z",
    );
    assert.equal(lines.length, 4);
    const [cost, rcInput, rcOutput, settlement] = lines;
    assert.ok(cost && rcInput && rcOutput && settlement);
    assert.equal(cost.accountNumber, "6540");
    assert.equal(cost.debit, 1000);
    assert.equal(rcInput.accountNumber, "2645");
    assert.equal(rcInput.debit, 250);
    assert.equal(rcOutput.accountNumber, "2614");
    assert.equal(rcOutput.credit, 250);
    assert.equal(settlement.accountNumber, "1930");
    assert.equal(settlement.credit, 1000, "settlement carries only the net price — no VAT changes hands");
    assert.equal(postingImbalanceOre(lines), 0);
  });

  test("buildPostingLines RC25 book-without-vat folds the undeducted VAT into the cost line but still self-assesses the output liability", () => {
    const rc25Suggestion: AccountingSuggestion = { ...suggestionFixture(), vatCode: "RC25" };
    const lines = buildPostingLines(
      voucherFixture({ grossAmount: 1250, netAmount: 1000, vatAmount: 250 }),
      rc25Suggestion,
      "book-without-vat",
      "2026-05-01T00:00:00.000Z",
    );
    const [cost, rcInput, rcOutput, settlement] = lines;
    assert.ok(cost && rcInput && rcOutput && settlement);
    assert.equal(cost.debit, 1250, "no VAT deduction claimed: full amount lands on the cost line");
    assert.equal(rcInput.debit, 0);
    assert.equal(rcOutput.credit, 250, "the self-assessed liability is not optional");
    assert.equal(settlement.credit, 1000);
    assert.equal(postingImbalanceOre(lines), 0);
  });

  test("buildPostingLines revenue direction posts a 2-line entry with no VAT line", () => {
    const revenueSuggestion: AccountingSuggestion = {
      ...suggestionFixture(),
      accountNumber: "3305",
      accountName: "Försäljning tjänster till land utanför EU",
      vatCode: "VAT0",
      direction: "revenue",
    };
    const lines = buildPostingLines(
      voucherFixture({ grossAmount: 5000, netAmount: 5000, vatAmount: 0 }),
      revenueSuggestion,
      "approve",
      "2026-05-01T00:00:00.000Z",
    );
    assert.equal(lines.length, 2);
    const [settlement, revenue] = lines;
    assert.ok(settlement && revenue);
    assert.equal(settlement.accountNumber, "1930");
    assert.equal(settlement.debit, 5000);
    assert.equal(revenue.accountNumber, "3305");
    assert.equal(revenue.credit, 5000);
    assert.equal(postingImbalanceOre(lines), 0);
  });

  test("buildPostingLines infers revenue direction from the resolved account class when suggestion.direction is absent", () => {
    const revenueSuggestion: AccountingSuggestion = {
      ...suggestionFixture(),
      accountNumber: "3305",
      accountName: "Försäljning tjänster till land utanför EU",
      vatCode: "VAT0",
    };
    const lines = buildPostingLines(
      voucherFixture({ grossAmount: 5000, netAmount: 5000, vatAmount: 0 }),
      revenueSuggestion,
      "approve",
      "2026-05-01T00:00:00.000Z",
    );
    assert.equal(lines.length, 2, "classifyAccountNumber(3305) = revenue even without an explicit direction");
  });

  test("resolveReviewDecisionEdit rejects an unknown settlementAccountNumber and threads a valid one through", () => {
    const voucher = voucherFixture({ grossAmount: 500, netAmount: 400, vatAmount: 100 });
    assert.throws(
      () =>
        resolveReviewDecisionEdit(voucher, suggestionFixture(), {
          accountNumber: "6110",
          vatCode: "VAT25",
          settlementAccountNumber: "9999",
        }),
      (error: unknown) => error instanceof InvalidReviewEditError,
    );
    const resolved = resolveReviewDecisionEdit(voucher, suggestionFixture(), {
      accountNumber: "6110",
      vatCode: "VAT25",
      settlementAccountNumber: "2899",
    });
    assert.equal(resolved.effectiveSettlementAccountNumber, "2899");
  });
  ```

  (Add `buildManualPostingLines`/`InvalidManualVoucherError` imports and tests in Task 5's file since they need `ManualVoucherLine` fixtures alongside the planner tests.)

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/posting-balance.test.ts` — expect failures (settlement override ignored, RC25 still produces the old 3-line shape with `vatCode: "RC25"` routed through the generic input-VAT account, revenue direction not recognized, `resolveReviewDecisionEdit` accepts any `settlementAccountNumber` silently, `effectiveSettlementAccountNumber` undefined on the type).
- [ ] Implement. In `packages/domain/src/store-shared.ts`:
  - Add `classifyAccountNumber` to the existing CoA import: `import { classifyAccountNumber, defaultCoaTemplate, findCoaAccount } from "./coa/registry";`.
  - Add `ManualVoucherLine` to the type import from `@jpx-accounting/contracts`.
  - Add a new error class next to `InvalidReviewEditError`:
    ```ts
    /**
     * Thrown when a manual voucher's lines fail the exact-öre balance check
     * inside `planManualVoucher` (the wire schema only enforces ±0.005 —
     * legitimate float noise, not a real imbalance). Client-correctable, so
     * this is a 422 like `InvalidReviewEditError`, never the catch-all 500
     * `UnbalancedPostingError` uses for internal invariant violations.
     */
    export class InvalidManualVoucherError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "InvalidManualVoucherError";
      }
    }
    ```
  - In `resolveReviewDecisionEdit`, add the settlement validation and extend the return shape:

    ```ts
    export function resolveReviewDecisionEdit(
      voucher: Voucher,
      suggestion: AccountingSuggestion | undefined,
      edited: ReviewDecisionEdit,
      coa: CoaTemplate = defaultCoaTemplate,
    ): {
      effectiveSuggestion: AccountingSuggestion | undefined;
      effectiveVoucher: Voucher;
      effectiveSettlementAccountNumber: string | undefined;
    } {
      const issues: string[] = [];
      const registryAccount = findCoaAccount(coa, edited.accountNumber);
      if (!registryAccount) {
        issues.push(
          `Edited accountNumber (${edited.accountNumber}) does not exist in the ${coa.id} chart of accounts.`,
        );
      }
      const vatVocabulary = validEditVatCodes(getVatRegime(coa.country));
      if (!vatVocabulary.has(edited.vatCode)) {
        issues.push(
          `Edited vatCode (${edited.vatCode}) is not in the VAT regime vocabulary (${[...vatVocabulary].join(", ")}).`,
        );
      }
      // KFR D3: an edited settlement account (2899 utlägg, 1630 skattekonto, …
      // instead of the default 1930 bank) must be a real CoA entry — same
      // rigor as accountNumber above.
      if (edited.settlementAccountNumber !== undefined && !findCoaAccount(coa, edited.settlementAccountNumber)) {
        issues.push(
          `Edited settlementAccountNumber (${edited.settlementAccountNumber}) does not exist in the ${coa.id} chart of accounts.`,
        );
      }
      // ...(anyAmountGiven / bookedAt blocks unchanged)...
      if (issues.length > 0 || !registryAccount) {
        throw new InvalidReviewEditError(issues);
      }

      const effectiveSuggestion = suggestion
        ? {
            ...suggestion,
            accountNumber: edited.accountNumber,
            accountName: registryAccount.name,
            vatCode: edited.vatCode,
          }
        : undefined;

      // ...(amountOverrides / bookedAtOverride / effectiveVoucher unchanged)...

      return {
        effectiveSuggestion,
        effectiveVoucher,
        effectiveSettlementAccountNumber: edited.settlementAccountNumber,
      };
    }
    ```

    (Keep every unchanged block verbatim — only the settlement `issues.push` and the final `return` differ from the current implementation.)

  - Add a private shape resolver just above `buildPostingLines`:
    ```ts
    /** KFR D3 shape selection: RC25 wins outright; otherwise direction (explicit or inferred from account class) picks expense vs. revenue. */
    function resolvePostingShape(suggestion: AccountingSuggestion, coa: CoaTemplate): "expense" | "rc25" | "revenue" {
      if (suggestion.vatCode === "RC25") return "rc25";
      const direction =
        suggestion.direction ??
        (classifyAccountNumber(suggestion.accountNumber, coa) === "revenue" ? "revenue" : "expense");
      return direction === "revenue" ? "revenue" : "expense";
    }
    ```
  - Replace the entire body of `buildPostingLines` with:

    ```ts
    export function buildPostingLines(
      voucher: Voucher,
      suggestion: AccountingSuggestion,
      action: "approve" | "book-without-vat",
      occurredAt: string,
      coa: CoaTemplate = defaultCoaTemplate,
      options?: { settlementAccountNumber?: string },
    ): LedgerLine[] {
      const fields = voucher.voucherFields;
      const bookedAt = deriveBookedAt(fields, occurredAt);
      const description = fields.description ?? "Reviewed voucher";
      const settlementAccountNumber = options?.settlementAccountNumber ?? coa.roles.bank;
      const settlementAccountName = findCoaAccount(coa, settlementAccountNumber)?.name ?? settlementAccountNumber;
      const shape = resolvePostingShape(suggestion, coa);

      if (shape === "revenue") {
        // D3(c): VAT0/export revenue — debit settlement, credit revenue, no VAT line.
        const amount = fields.grossAmount ?? fields.netAmount ?? 0;
        const lines: LedgerLine[] = [
          {
            voucherId: voucher.id,
            accountNumber: settlementAccountNumber,
            accountName: settlementAccountName,
            description,
            debit: amount,
            credit: 0,
            vatCode: "NA",
            bookedAt,
            deductible: false,
          },
          {
            voucherId: voucher.id,
            accountNumber: suggestion.accountNumber,
            accountName: suggestion.accountName,
            description,
            debit: 0,
            credit: amount,
            vatCode: suggestion.vatCode,
            bookedAt,
            deductible: false,
          },
        ];
        return assertBalancedPosting(lines, `voucher ${voucher.id}`);
      }

      // Non-deductible input VAT (book-without-vat) is part of the cost under
      // Swedish rules: claim 0 VAT and debit the full gross to the cost account.
      const vatAmount = action === "book-without-vat" ? 0 : (fields.vatAmount ?? 0);
      const grossAmount = fields.grossAmount ?? round2((fields.netAmount ?? 0) + vatAmount);
      const netAmount = round2(grossAmount - vatAmount);

      if (shape === "rc25") {
        // D3(b): EU reverse-charge service purchase. Self-assessed VAT nets to
        // zero cash impact; the settlement leg only ever carries the NET price
        // — the foreign supplier never charges Swedish VAT.
        const inputAccount = coa.roles.reverseChargeInput;
        const outputAccount = coa.roles.reverseChargeOutput;
        const costDebit = action === "book-without-vat" ? netAmount + vatAmount : netAmount;
        const inputVatDebit = action === "book-without-vat" ? 0 : vatAmount;
        const lines: LedgerLine[] = [
          {
            voucherId: voucher.id,
            accountNumber: suggestion.accountNumber,
            accountName: suggestion.accountName,
            description,
            debit: costDebit,
            credit: 0,
            vatCode: "RC25",
            bookedAt,
            deductible: action !== "book-without-vat",
          },
          {
            voucherId: voucher.id,
            accountNumber: inputAccount,
            accountName: findCoaAccount(coa, inputAccount)?.name ?? inputAccount,
            description: `${description} VAT (omvänd skattskyldighet)`,
            debit: inputVatDebit,
            credit: 0,
            vatCode: "RC25",
            bookedAt,
            deductible: action !== "book-without-vat",
          },
          {
            voucherId: voucher.id,
            accountNumber: outputAccount,
            accountName: findCoaAccount(coa, outputAccount)?.name ?? outputAccount,
            description: `${description} VAT (omvänd skattskyldighet)`,
            debit: 0,
            credit: vatAmount,
            vatCode: "RC25",
            bookedAt,
            deductible: false,
          },
          {
            voucherId: voucher.id,
            accountNumber: settlementAccountNumber,
            accountName: settlementAccountName,
            description,
            debit: 0,
            credit: netAmount,
            vatCode: "NA",
            bookedAt,
            deductible: false,
          },
        ];
        return assertBalancedPosting(lines, `voucher ${voucher.id}`);
      }

      // shape === "expense": the original 3-line shape, generalized to a configurable settlement account.
      const lines: LedgerLine[] = [
        {
          voucherId: voucher.id,
          accountNumber: suggestion.accountNumber,
          accountName: suggestion.accountName,
          description,
          debit: netAmount,
          credit: 0,
          vatCode: suggestion.vatCode,
          bookedAt,
          deductible: action !== "book-without-vat",
        },
        {
          voucherId: voucher.id,
          accountNumber: coa.roles.inputVat,
          accountName: findCoaAccount(coa, coa.roles.inputVat)?.name ?? coa.roles.inputVat,
          description: `${description} VAT`,
          debit: vatAmount,
          credit: 0,
          vatCode: suggestion.vatCode,
          bookedAt,
          deductible: action !== "book-without-vat",
        },
        {
          voucherId: voucher.id,
          accountNumber: settlementAccountNumber,
          accountName: settlementAccountName,
          description,
          debit: 0,
          credit: grossAmount,
          vatCode: "NA",
          bookedAt,
          deductible: false,
        },
      ];
      return assertBalancedPosting(lines, `voucher ${voucher.id}`);
    }

    /**
     * Post a manual voucher's lines VERBATIM (KFR D2) — no shape inference, no
     * amount derivation. `deductible` is uniformly `false`: Phase B does not
     * infer per-line VAT deductibility for hand-entered lines (same documented
     * limitation `planSieImport` already carries for imported lines).
     */
    export function buildManualPostingLines(
      voucher: Voucher,
      lines: ManualVoucherLine[],
      occurredAt: string,
      coa: CoaTemplate = defaultCoaTemplate,
    ): LedgerLine[] {
      const bookedAt = deriveBookedAt(voucher.voucherFields, occurredAt);
      const description = voucher.voucherFields.description ?? "Manual entry";
      return assertBalancedPosting(
        lines.map((line) => ({
          voucherId: voucher.id,
          accountNumber: line.accountNumber,
          accountName: findCoaAccount(coa, line.accountNumber)?.name ?? `Konto ${line.accountNumber}`,
          description,
          debit: line.debit,
          credit: line.credit,
          vatCode: line.vatCode,
          bookedAt,
          deductible: false,
        })),
        `manual voucher ${voucher.id}`,
      );
    }
    ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/posting-balance.test.ts` — expect pass, including every pre-existing test in the file (the expense shape is byte-identical when `options` is omitted).
- [ ] Run `corepack pnpm typecheck` — expect pass.
- [ ] Commit:

  ```
  feat(domain): generalize buildPostingLines to settlement/RC25/revenue shapes

  D3: a configurable settlement account (default coa.roles.bank), the RC25
  four-line EU reverse-charge shape (2645 debit / 2614 credit, self-assessed
  and cash-neutral), and a two-line revenue shape with no VAT line. Adds
  buildManualPostingLines for verbatim manual-voucher posting (D2) and
  InvalidManualVoucherError for its exact-öre balance guard.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 5 — `planReviewDecision` manual bypass + `planManualVoucher` (store-planning.ts)

**Files:** `packages/domain/src/store-planning.ts`, `tests/unit/store-planning.test.ts`

**Interfaces:**

```ts
export type ManualVoucherPlan = { voucher: Voucher; review: ReviewTask; events: PlannedEvent[] };

export function planManualVoucher(
  input: ManualVoucherInput & { actorId: string },
  ctx: { voucherIndex: number; now?: string; organizationId: string; workspaceId: string },
): ManualVoucherPlan;
```

> **Cross-phase seam (Fable review 2026-08-20):** the `ctx.voucherIndex`-based intake numbering below is a deliberate INTERMEDIATE state. Phase E Task E.1 moves ALL numbering to posting time: it deletes `voucherIndex`, plans vouchers with the `DRAFT_VOUCHER_NUMBER` (`"Utkast"`) sentinel, and assigns `V-<n>` in `planReviewDecision`'s posting branch — explicitly including `planManualVoucher` and this task's test pins (`"V-1004"` becomes the sentinel). Do not "fix" that here; just be aware the pin is temporary.

- [ ] Write the failing test first. `tests/unit/store-planning.test.ts` imports domain planners from the **relative source path** `../../packages/domain/src/store-planning.ts` (not the `@jpx-accounting/domain` package alias) — add `planManualVoucher` to that existing import list, and add a **new** import line for `InvalidManualVoucherError` from `@jpx-accounting/domain` (it lives in `store-shared.ts`, re-exported by the domain package barrel):

  ```ts
  import {
    AUTO_DETECTED_ALERT_KINDS,
    planComplianceMerge,
    planEvidenceCreate,
    planExtractionRefresh,
    planManualVoucher,
    planReviewDecision,
  } from "../../packages/domain/src/store-planning.ts";
  import { InvalidManualVoucherError } from "@jpx-accounting/domain";
  ```

  Add to `tests/unit/store-planning.test.ts`:

  ```ts
  describe("planManualVoucher", () => {
    const input = {
      actorId: "user:x",
      description: "Utlägg för kontorsmaterial",
      bookedAt: "2026-03-20",
      lines: [
        { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" as const },
        { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" as const },
      ],
    };
    const ctx = {
      voucherIndex: 3,
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      now: "2026-03-20T09:00:00.000Z",
    };

    it("creates a needs-review voucher with origin manual, no evidence packet, and verbatim lines on the suggestion", () => {
      const plan = planManualVoucher(input, ctx);
      assert.equal(plan.voucher.origin, "manual");
      assert.equal(plan.voucher.evidencePacketId, null);
      assert.equal(plan.voucher.status, "needs-review");
      assert.equal(plan.voucher.voucherNumber, "V-1004");
      assert.equal(plan.review.status, "needs-review");
      assert.deepEqual(plan.review.suggestion?.lines, input.lines);
      assert.equal(plan.events.map((e) => e.eventType).join(","), "VoucherCreated,SuggestionGenerated");
    });

    it("rejects lines that fail the exact-öre balance check", () => {
      const skewed = {
        ...input,
        lines: [
          { accountNumber: "6110", debit: 100.003, credit: 0, vatCode: "NA" as const },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" as const },
        ],
      };
      assert.throws(
        () => planManualVoucher(skewed, ctx),
        (error: unknown) => error instanceof InvalidManualVoucherError,
      );
    });
  });
  ```

  Also extend the existing `describe("planReviewDecision", ...)` block (line 93) with:

  ```ts
  it("bypasses buildPostingLines for a manual-origin voucher and posts its lines verbatim", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: null,
      voucherNumber: "V-1001",
      status: "needs-review",
      accountingMethod: "invoice",
      extractedFields: [],
      voucherFields: { currency: "SEK", description: "Utlägg", transactionDate: "2026-03-20" },
      createdAt: "2026-03-20T09:00:00.000Z",
      createdBy: "user:x",
      origin: "manual",
    } as Voucher;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review V-1001",
      status: "needs-review",
      suggestedAction: "Approve the manual entry.",
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6110",
        accountName: "Kontorsmateriel",
        vatCode: "NA",
        confidence: 1,
        reasoning: "manual",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: [
          { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" },
          { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
        ],
      },
      provenanceTimeline: [],
    } as ReviewTask;

    // A client-supplied edit must be ignored, not applied or rejected.
    const plan = planReviewDecision(review, voucher, "approve", {
      actorId: "user:x",
      edited: { accountNumber: "9999", vatCode: "VAT25" },
    });
    assert.equal(plan.kind, "apply");
    if (plan.kind !== "apply") throw new Error("unreachable");
    assert.equal(plan.lines?.length, 2);
    assert.equal(plan.lines?.[0]?.accountNumber, "6110");
    assert.equal(plan.lines?.[0]?.debit, 100);
    assert.equal(plan.lines?.[1]?.accountNumber, "2899");
    assert.equal(plan.updatedReview.provenanceTimeline.at(-1)?.label, "Review approved", "not 'Approved with edits'");
  });
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/store-planning.test.ts` — expect failures (`planManualVoucher` doesn't exist; the manual-origin test currently throws `InvalidReviewEditError` because `resolveReviewDecisionEdit(voucher, ..., {accountNumber:"9999",...})` runs and 9999 isn't in the CoA).
- [ ] Implement. In `packages/domain/src/store-planning.ts`:
  - Add `postingImbalanceOre` to the import from `./posting-invariants` (new import line: `import { postingImbalanceOre } from "./posting-invariants";`).
  - Add `ManualVoucherLine`, `ManualVoucherInput`, `ManualVoucherResult` to the `@jpx-accounting/contracts` type import.
  - Add `InvalidManualVoucherError`, `buildManualPostingLines` to the `./store-shared` import.
  - Add the new planner (near `planEvidenceCreate`):

    ```ts
    export type ManualVoucherPlan = { voucher: Voucher; review: ReviewTask; events: PlannedEvent[] };

    /**
     * Pure re-entrant planner for `createManualVoucher` (KFR Phase B / D2).
     * Mirrors `planEvidenceCreate`'s shape but skips evidence/packet entirely:
     * the voucher is `origin: "manual"` with `evidencePacketId: null`, and its
     * review's suggestion carries the verbatim lines the reviewer typed —
     * `planReviewDecision` detects `voucher.origin === "manual"` and posts
     * them unchanged at approval time (buildManualPostingLines).
     */
    export function planManualVoucher(
      input: ManualVoucherInput & { actorId: string },
      ctx: { voucherIndex: number; now?: string; organizationId: string; workspaceId: string },
    ): ManualVoucherPlan {
      // Exact-öre gate BEFORE any id/event is derived: the wire schema only
      // enforces ±0.005 (float noise tolerance), not the real invariant.
      const imbalance = postingImbalanceOre(input.lines);
      if (imbalance !== 0) {
        throw new InvalidManualVoucherError(
          `Manual voucher lines do not balance to the öre (Σdebit − Σcredit = ${(imbalance / 100).toFixed(2)} kr).`,
        );
      }

      const actorId = input.actorId;
      const createdAt = ctx.now ?? nowIso();
      const voucherId = createId("voucher");
      const firstLine = input.lines[0]!;
      const firstAccount = findCoaAccount(defaultCoaTemplate, firstLine.accountNumber);

      const voucher: Voucher = {
        id: voucherId,
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId,
        evidencePacketId: null,
        voucherNumber: `V-${ctx.voucherIndex + 1001}`,
        status: "needs-review",
        // Manual entries carry no cash/invoice distinction — "invoice" is a
        // fixed, documented default (the schema requires a value).
        accountingMethod: "invoice",
        extractedFields: [],
        voucherFields: {
          description: input.description,
          transactionDate: input.bookedAt,
          currency: "SEK",
        },
        createdAt,
        createdBy: actorId,
        origin: "manual",
      };

      const suggestion: AccountingSuggestion = {
        id: createId("sug"),
        voucherId,
        accountNumber: firstLine.accountNumber,
        accountName: firstAccount?.name ?? `Konto ${firstLine.accountNumber}`,
        vatCode: firstLine.vatCode,
        confidence: 1,
        reasoning: "Manual journal entry — lines entered directly by a reviewer.",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
        lines: input.lines,
      };

      const review: ReviewTask = {
        id: createId("review"),
        voucherId,
        title: `Review ${voucher.voucherNumber}`,
        status: "needs-review",
        suggestedAction: "Approve the manual entry.",
        suggestion,
        provenanceTimeline: [
          { id: createId("step"), label: "Manual entry created", timestamp: createdAt, actor: actorId },
        ],
      };

      const events: PlannedEvent[] = [
        {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          aggregateType: "voucher",
          aggregateId: voucherId,
          eventType: "VoucherCreated",
          actorId,
          occurredAt: createdAt,
          payload: voucher as unknown as Record<string, unknown>,
        },
        {
          organizationId: ctx.organizationId,
          workspaceId: ctx.workspaceId,
          aggregateType: "review",
          aggregateId: review.id,
          eventType: "SuggestionGenerated",
          actorId,
          occurredAt: createdAt,
          payload: suggestion as unknown as Record<string, unknown>,
        },
      ];

      return { voucher, review, events };
    }
    ```

  - In `planReviewDecision`, change the edit-resolution and posting-line sections:
    ```ts
    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    // KFR D2: manual-origin vouchers bypass edit resolution and
    // buildPostingLines entirely — approval always posts the lines exactly as
    // authored. A client-supplied `edited` payload is silently ignored (not
    // an error — just inapplicable) rather than validated against a
    // single-account suggestion shape that doesn't describe a manual entry.
    const isManual = voucher.origin === "manual";
    const edited = action !== "reject" && !isManual ? input.edited : undefined;
    let postingSuggestion = review.suggestion;
    let postingVoucher = voucher;
    let settlementAccountNumber: string | undefined;
    if (edited) {
      const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
      postingSuggestion = resolved.effectiveSuggestion;
      postingVoucher = resolved.effectiveVoucher;
      settlementAccountNumber = resolved.effectiveSettlementAccountNumber;
    }
    ```
    ```ts
    let lines: LedgerLine[] | undefined;
    if (action !== "reject") {
      if (isManual) {
        const manualLines = postingSuggestion?.lines;
        if (!manualLines) {
          throw new Error(
            `Manual-origin voucher ${voucher.id} has a review with no verbatim lines (invariant violation).`,
          );
        }
        lines = buildManualPostingLines(voucher, manualLines, occurredAt);
      } else if (postingSuggestion) {
        lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt, undefined, {
          settlementAccountNumber,
        });
      }
    }
    if (lines) {
      events.push({
        organizationId: updatedVoucher.organizationId,
        workspaceId: updatedVoucher.workspaceId,
        aggregateType: "ledger",
        aggregateId: updatedVoucher.id,
        eventType: "PostedToLedger",
        actorId,
        occurredAt,
        payload: { action, suggestion: postingSuggestion, lines },
      });
    }
    ```
    (This replaces the current `if (action !== "reject" && postingSuggestion) { lines = buildPostingLines(...); events.push(...) }` block — everything else in the function is unchanged.)

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/store-planning.test.ts` — expect pass.
- [ ] Run `corepack pnpm typecheck` — expect pass.
- [ ] Commit:

  ```
  feat(domain): planManualVoucher + manual-origin bypass in planReviewDecision

  D2: a new pure planner mirrors planEvidenceCreate for manual N-line entries
  (origin "manual", evidencePacketId null, verbatim lines on the suggestion);
  planReviewDecision now detects manual-origin vouchers and posts those lines
  unchanged, ignoring any edited payload instead of validating it against a
  single-account suggestion shape.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 6 — `simulateApprovals` manual-lines awareness (small correctness fix, not in the master's literal list)

**Files:** `packages/domain/src/simulation.ts`, `tests/unit/simulation.test.ts`

Found while tracing the manual-voucher review path: `simulateApprovals` calls `buildPostingLines(voucher, suggestion, ...)` unconditionally for every review with a suggestion. For a manual-origin review, `suggestion.lines` is set but `buildPostingLines` doesn't know about it and would fabricate a single-account expense posting instead of the real lines — a wrong simulation preview. Fixing proactively since it is a direct, cheap consequence of this phase's `AccountingSuggestion.lines` addition.

- [ ] Write the failing test first. Add to `tests/unit/simulation.test.ts`:
  ```ts
  test("simulateApprovals uses a manual-origin review's verbatim lines instead of buildPostingLines", () => {
    const voucher = { ...voucherFixture("m1"), origin: "manual" as const, evidencePacketId: null };
    const manualSuggestion: AccountingSuggestion = {
      ...suggestionFixture("m1"),
      accountNumber: "6110",
      vatCode: "NA",
      lines: [
        { accountNumber: "6110", debit: 250, credit: 0, vatCode: "NA" },
        { accountNumber: "2899", debit: 0, credit: 250, vatCode: "NA" },
      ],
    };
    const review = {
      id: "rm1",
      voucherId: "m1",
      title: "t",
      status: "needs-review" as const,
      suggestedAction: "a",
      suggestion: manualSuggestion,
      provenanceTimeline: [],
    };
    const { balanceDelta } = simulateApprovals([review], [manualSuggestion], [voucher], "approve");
    const byAccount = new Map(balanceDelta.map((d) => [d.accountNumber, d]));
    assert.equal(byAccount.get("6110")?.deltaDebit, 250);
    assert.equal(byAccount.get("2899")?.deltaCredit, 250);
    // The old behavior would have fabricated a 3-line expense posting against
    // whatever voucherFields carries (1249/999.2/249.8 in this fixture) — assert it's gone.
    assert.equal(byAccount.get("1930"), undefined, "no fabricated bank leg for a manual-origin review");
  });
  ```
- [ ] Run: `corepack pnpm exec tsx --test tests/unit/simulation.test.ts` — expect failure (simulateApprovals still calls `buildPostingLines`, producing a fabricated 3-line posting).
- [ ] Implement. In `packages/domain/src/simulation.ts`, import `buildManualPostingLines` alongside `buildPostingLines` and change the loop body:
  ```ts
  for (const review of reviews) {
    const voucher = vouchersById.get(review.voucherId);
    const suggestion = suggestionsByVoucher.get(review.voucherId) ?? review.suggestion;
    if (!voucher || !suggestion) continue;
    const effectiveAction: "approve" | "book-without-vat" = action === "reject" ? "approve" : action;
    const lines =
      voucher.origin === "manual" && suggestion.lines
        ? buildManualPostingLines(voucher, suggestion.lines, voucher.createdAt, coa)
        : buildPostingLines(voucher, suggestion, effectiveAction, voucher.createdAt, coa);
    for (const line of lines) {
      // ...unchanged...
    }
  }
  ```
- [ ] Run: `corepack pnpm exec tsx --test tests/unit/simulation.test.ts` — expect pass, plus every pre-existing test in the file unchanged.
- [ ] Commit:

  ```
  fix(domain): simulateApprovals uses verbatim lines for manual-origin reviews

  buildPostingLines can't describe a manual N-line entry (single accountNumber
  input); simulating one produced a fabricated expense posting instead of a
  preview of what approval will actually post.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 7 — `MemoryLedgerStore.createManualVoucher`

**Files:** `packages/domain/src/store.ts`, `tests/unit/ledger-store.test.ts`

**Interfaces:**

```ts
// LedgerStore interface addition:
createManualVoucher(input: ManualVoucherInput & { actorId: string }): Promise<ManualVoucherResult>;
```

- [ ] Write the failing test first. Add to `tests/unit/ledger-store.test.ts`:

  ```ts
  test("MemoryLedgerStore.createManualVoucher creates a review, then approve posts the verbatim lines", async () => {
    const store = new MemoryLedgerStore();
    const journalBefore = (await store.getReports()).journal.length;
    const feedBefore = (await store.getReviewFeed()).length;

    const result = await store.createManualVoucher({
      actorId: "user_founder",
      description: "Utlägg för kontorsmaterial",
      bookedAt: "2026-03-20",
      lines: [
        { accountNumber: "6110", debit: 250, credit: 0, vatCode: "NA" },
        { accountNumber: "2899", debit: 0, credit: 250, vatCode: "NA" },
      ],
    });

    const feed = await store.getReviewFeed();
    assert.equal(feed.length, feedBefore + 1);
    const review = feed.find((r) => r.id === result.reviewId);
    assert.ok(review);
    assert.equal(review.status, "needs-review");
    assert.deepEqual(
      review.suggestion?.lines?.map((l) => l.accountNumber),
      ["6110", "2899"],
    );

    const snapshot = await store.getSnapshot();
    const voucher = snapshot.vouchers.find((v) => v.id === result.voucherId);
    assert.ok(voucher);
    assert.equal(voucher.origin, "manual");
    assert.equal(voucher.evidencePacketId, null);

    const decided = await store.applyReviewDecision(result.reviewId, "approve", { actorId: "user_founder" });
    assert.equal(decided?.status, "approved");

    const journal = (await store.getReports()).journal;
    assert.equal(journal.length, journalBefore + 2, "verbatim 2-line manual entry, not a fabricated 3-line expense");
    const [cost, settlement] = journal.slice(-2);
    assert.ok(cost && settlement);
    assert.equal(cost.accountNumber, "6110");
    assert.equal(cost.debit, 250);
    assert.equal(settlement.accountNumber, "2899");
    assert.equal(settlement.credit, 250);
    assert.equal(cost.bookedAt.slice(0, 10), "2026-03-20");
  });

  test("MemoryLedgerStore.createManualVoucher rejects an exact-öre-unbalanced entry before any mutation", async () => {
    const store = new MemoryLedgerStore();
    const eventsBefore = (await store.getEvents()).length;
    await assert.rejects(
      () =>
        store.createManualVoucher({
          actorId: "user_founder",
          description: "Bad entry",
          bookedAt: "2026-03-20",
          lines: [
            { accountNumber: "6110", debit: 100.01, credit: 0, vatCode: "NA" },
            { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
          ],
        }),
      (error: unknown) => error instanceof InvalidManualVoucherError,
    );
    assert.equal((await store.getEvents()).length, eventsBefore, "no events appended on rejection");
  });
  ```

  Add `InvalidManualVoucherError` to the file's existing `@jpx-accounting/domain` import.

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/ledger-store.test.ts` — expect failure (`store.createManualVoucher is not a function`).
- [ ] Implement. In `packages/domain/src/store.ts`:
  - Add `ManualVoucherInput`, `ManualVoucherResult` to the `@jpx-accounting/contracts` type import.
  - Add `planManualVoucher` to the `./store-planning` import.
  - Add the method to the `LedgerStore` interface (after `importSie`):
    ```ts
    /**
     * Create a manual N-line journal entry (KFR Phase B / D2): a Voucher
     * (`origin: "manual"`, `evidencePacketId: null`) plus a ReviewTask
     * (`needs-review`) whose suggestion carries the verbatim lines. Approval
     * posts those lines unchanged — the review queue stays the only path to a
     * posted voucher, same invariant as every other posting route. Throws
     * `InvalidManualVoucherError` (→ HTTP 422) before any mutation when the
     * lines don't balance to the exact öre.
     */
    createManualVoucher(input: ManualVoucherInput & { actorId: string }): Promise<ManualVoucherResult>;
    ```
  - Implement it on `MemoryLedgerStore` (near `importSie`):

    ```ts
    async createManualVoucher(input: ManualVoucherInput & { actorId: string }): Promise<ManualVoucherResult> {
      const plan = planManualVoucher(input, {
        voucherIndex: this.vouchers.size,
        organizationId: defaultOrganizationId,
        workspaceId: defaultWorkspaceId,
      });

      this.vouchers.set(plan.voucher.id, plan.voucher);
      this.reviews.set(plan.review.id, plan.review);
      this.suggestions.set(plan.voucher.id, plan.review.suggestion!);
      this.voucherIdToReviewId.set(plan.voucher.id, plan.review.id);

      for (const event of plan.events) {
        this.appendEvent(event);
      }

      return { voucherId: plan.voucher.id, reviewId: plan.review.id };
    }
    ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/ledger-store.test.ts` — expect pass.
- [ ] Run `corepack pnpm typecheck` — expect pass (`PostgresLedgerStore` will fail to satisfy `LedgerStore` until Task 9 — if typecheck fails only on `packages/persistence-postgres`, that's expected at this point; proceed to Task 9 before the next full `pnpm check`).
- [ ] Commit:

  ```
  feat(domain): MemoryLedgerStore.createManualVoucher

  LedgerStore gains createManualVoucher (KFR Phase B / D2): wraps
  planManualVoucher, persists the voucher/review read models, and appends the
  planned VoucherCreated + SuggestionGenerated events — approval later posts
  the verbatim lines via the manual-origin bypass in planReviewDecision.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 8 — Migration `0009_manual_vouchers.sql`

**Files:** `infra/supabase/migrations/0009_manual_vouchers.sql`, `scripts/db-migrations.mts`, `tests/integration/schema-contract.test.ts`

- [ ] Write the failing test first (requires a `jpx_test_*` DB — this step only asserts, it does not need the DB running yet to write it). Extend `tests/integration/schema-contract.test.ts`:
  ```ts
  // in "migration history records every checked-in migration..." — no change needed, discoverMigrationFiles picks up 0009 automatically once the file exists.
  ```
  Change `assert.ok(files.length >= 8, ...)` to:
  ```ts
  assert.ok(files.length >= 9, "expected migrations 0001–0009 (or more) on disk");
  ```
  Add `"manual-vouchers-schema"` to the `for (const required of [...])` capability list (after `"evidence-dedupe-index"`).
- [ ] Run: `corepack pnpm db:test` — expect failure (`manual-vouchers-schema` assertion name never runs; `files.length >= 9` fails until the file exists).
- [ ] Implement. Create `infra/supabase/migrations/0009_manual_vouchers.sql`:

  ```sql
  -- 0009_manual_vouchers.sql — manual N-line journal entries go through the
  -- review gate (KFR Phase B / D2).
  --
  -- ledger.vouchers.evidence_packet_id becomes nullable: a manual voucher has
  -- no evidence packet at creation time (Phase D's evidenceComposeInputSchema
  -- targetVoucherId later lets a user attach one after the fact). The
  -- existing FK to ledger.evidence_packets(id) already tolerates NULL — FK
  -- constraints never fire on a NULL value, so no FK change is needed.
  --
  -- ledger.vouchers.origin distinguishes how a voucher was created: 'capture'
  -- (the existing evidence-driven flow, DEFAULT so every pre-existing row
  -- backfills correctly on this ADD COLUMN), 'manual' (this phase), 'import'
  -- (SIE — reserved for KFR Phase D, when importSie starts materializing
  -- voucher rows for imported vouchers).
  --
  -- Idempotency: DROP NOT NULL is a no-op when already nullable (safe to
  -- replay); ADD COLUMN IF NOT EXISTS and the DO-block CHECK guard (Rule 18)
  -- make the rest of the file replay clean on partial environments.

  alter table ledger.vouchers
    alter column evidence_packet_id drop not null;

  alter table ledger.vouchers
    add column if not exists origin text not null default 'capture';

  do $$ begin
    alter table ledger.vouchers
      add constraint ledger_vouchers_origin_check
      check (origin in ('capture', 'manual', 'import'));
  exception when duplicate_object then null;
  end $$;
  ```

  Add a capability assertion in `scripts/db-migrations.mts`, right after the `evidence-dedupe-index` block (before `return results;`):

  ```ts
  results.push(
    await safeCheck("manual-vouchers-schema", async () => {
      const originColumn = await getColumnInfo(sql, "ledger", "vouchers", "origin");
      const nullableRows = await sql<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'ledger' and table_name = 'vouchers' and column_name = 'evidence_packet_id'
      `;
      const packetNullable = nullableRows[0]?.is_nullable === "YES";
      const hasOriginCheck = await constraintExists(sql, "ledger", "vouchers", "ledger_vouchers_origin_check", "c");
      const pass = Boolean(originColumn) && packetNullable && hasOriginCheck;
      return {
        name: "manual-vouchers-schema",
        pass,
        detail: pass
          ? "ledger.vouchers.evidence_packet_id is nullable and origin + its CHECK constraint are present."
          : `ledger.vouchers evidence_packet_id nullable=${packetNullable}, origin column=${Boolean(originColumn)}, origin check=${hasOriginCheck}.`,
        ...(pass ? {} : { remediation: "Apply migration 0009_manual_vouchers.sql." }),
      };
    }),
  );
  ```

- [ ] Run: `corepack pnpm db:test` — expect pass (creates/migrates/drops a throwaway `jpx_test_*` DB; requires Docker per `scripts/integration-db.md` — if Docker is unavailable in this environment, run `corepack pnpm db:up && corepack pnpm db:migrate` and inspect the printed capability assertions manually instead).
- [ ] Commit:

  ```
  feat(db): migration 0009 — nullable evidence_packet_id + voucher origin

  Manual vouchers (KFR Phase B / D2) have no evidence packet at creation
  time; origin distinguishes capture/manual/import provenance. Adds the
  matching db-migrations.mts capability assertion and schema-contract pin.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 9 — `PostgresLedgerStore.createManualVoucher` + store parity

**Files:** `packages/persistence-postgres/src/store.ts`, `tests/integration/helpers/ledger-store-conformance.ts`, `tests/integration/ledger-store-conformance.test.ts` (no edit needed — scenarios run automatically)

**Interfaces:** same `createManualVoucher` signature as Task 7, implemented against Postgres inside the existing advisory-lock transaction pattern.

- [ ] Write the failing test first. Add a new scenario to `tests/integration/helpers/ledger-store-conformance.ts` (add the import `postingImbalanceOre` is not needed; reuse existing style):

  ```ts
  export async function scenarioManualVoucherLifecycle(h: ConformanceHarness): Promise<ConformanceOutcome> {
    const journalBefore = (await h.store.getReports()).journal.length;
    const feedBefore = (await h.store.getReviewFeed()).length;

    const result = await h.store.createManualVoucher({
      actorId: h.actorId,
      description: "Manual conformance entry",
      bookedAt: "2026-03-20",
      lines: [
        { accountNumber: "6991", debit: 100, credit: 0, vatCode: "NA" },
        { accountNumber: "2899", debit: 0, credit: 100, vatCode: "NA" },
      ],
    });

    const feedAfterCreate = await h.store.getReviewFeed();
    const feedIncludesReview = feedAfterCreate.some((review) => review.id === result.reviewId);
    const snapshot = await h.store.getSnapshot();
    const voucher = snapshot.vouchers.find((v) => v.id === result.voucherId);

    const decided = await h.store.applyReviewDecision(result.reviewId, "approve", { actorId: h.actorId });
    const journalAfter = (await h.store.getReports()).journal.length;
    const postedLines = (await h.store.getReports({ from: "2026-03-20", to: "2026-03-20" })).journal.filter(
      (entry) => entry.voucherId === result.voucherId,
    );

    return {
      feedDelta: feedAfterCreate.length - feedBefore,
      feedIncludesReview,
      voucherOrigin: voucher?.origin ?? null,
      voucherEvidencePacketId: voucher ? voucher.evidencePacketId : "voucher-missing",
      voucherStatus: voucher?.status ?? null,
      decidedStatus: decided?.status ?? null,
      journalDelta: journalAfter - journalBefore,
      postedLineCount: postedLines.length,
      postedAccounts: postedLines.map((line) => [
        line.accountNumber,
        normalizeNumber(line.debit),
        normalizeNumber(line.credit),
      ]),
    };
  }
  ```

  Add it to `CONFORMANCE_SCENARIOS`:

  ```ts
  { name: "manual voucher lifecycle", run: scenarioManualVoucherLifecycle },
  ```

  This single addition makes `tests/integration/ledger-store-conformance.test.ts` run it three ways automatically: `MemoryLedgerStore conformance: manual voucher lifecycle`, `PostgresLedgerStore conformance: manual voucher lifecycle`, `Memory/Postgres parity: manual voucher lifecycle` — no edits needed to the `.test.ts` file itself.

- [ ] Run: `corepack pnpm db:test` — expect the Memory variant to pass (Task 7 already lands `MemoryLedgerStore.createManualVoucher`) and the Postgres + parity variants to fail (`store.createManualVoucher is not a function` on `PostgresLedgerStore`). If Docker/Postgres is unavailable, confirm via `corepack pnpm exec tsx --test tests/integration/ledger-store-conformance.test.ts` that the gate correctly skips the Postgres variants (`{ skip: skipPostgres }`) rather than silently passing.
- [ ] Implement. In `packages/persistence-postgres/src/store.ts`:
  - Add `ManualVoucherInput`, `ManualVoucherResult` to the `@jpx-accounting/contracts` type import.
  - Add `planManualVoucher` to the `@jpx-accounting/domain` import list.
  - Implement the method (near `importSie`), following the exact `withChainForkRetry` + `lockWorkspaceTail` pattern every other appender uses:

    ```ts
    async createManualVoucher(input: ManualVoucherInput & { actorId: string }): Promise<ManualVoucherResult> {
      return this.withChainForkRetry(() =>
        this.client.begin(async (tx) => {
          const tailHash = await this.lockWorkspaceTail(tx);

          const voucherCountRows = await tx<{ count: string }[]>`
            SELECT COUNT(*)::text AS count
            FROM ledger.vouchers
            WHERE organization_id = ${this.defaults.organizationId}
              AND workspace_id = ${this.defaults.workspaceId}
          `;
          const voucherCount = Number(voucherCountRows[0]?.count ?? "0");
          const plan = planManualVoucher(input, {
            voucherIndex: voucherCount,
            organizationId: this.defaults.organizationId,
            workspaceId: this.defaults.workspaceId,
          });
          const { voucher, review } = plan;
          const suggestion = review.suggestion!;

          await tx`
            INSERT INTO ledger.vouchers (
              id, organization_id, workspace_id, evidence_packet_id, voucher_number,
              accounting_method, status, voucher_fields, extracted_fields, created_by,
              created_at, origin
            ) VALUES (
              ${voucher.id}, ${voucher.organizationId}, ${voucher.workspaceId}, ${voucher.evidencePacketId},
              ${voucher.voucherNumber}, ${voucher.accountingMethod}, ${voucher.status},
              ${tx.json(voucher.voucherFields as Parameters<typeof tx.json>[0])},
              ${tx.json(voucher.extractedFields as unknown as Parameters<typeof tx.json>[0])},
              ${voucher.createdBy}, ${voucher.createdAt}, ${voucher.origin}
            )
          `;

          await tx`
            INSERT INTO ledger.review_tasks (
              id, organization_id, workspace_id, voucher_id, status, blocked_reason,
              suggested_action, suggestion, provenance_timeline, title, created_at
            ) VALUES (
              ${review.id}, ${this.defaults.organizationId}, ${this.defaults.workspaceId}, ${review.voucherId},
              ${review.status}, ${review.blockedReason ?? null}, ${review.suggestedAction},
              ${tx.json(suggestion as unknown as Parameters<typeof tx.json>[0])},
              ${tx.json(review.provenanceTimeline as unknown as Parameters<typeof tx.json>[0])},
              ${review.title}, ${voucher.createdAt}
            )
          `;

          let prev = tailHash;
          for (const event of plan.events) {
            const appended = await this.appendEvent(tx, { ...event, payload: event.payload as unknown as Record<string, unknown> }, prev);
            prev = appended.eventHash;
          }

          return { voucherId: voucher.id, reviewId: review.id };
        }),
      );
    }
    ```

- [ ] Run: `corepack pnpm db:test` — expect all three `manual voucher lifecycle` variants to pass, including the Memory/Postgres parity diff.
- [ ] Run `corepack pnpm typecheck` — expect pass (`PostgresLedgerStore` now fully satisfies `LedgerStore` again).
- [ ] Commit:

  ```
  feat(persistence-postgres): PostgresLedgerStore.createManualVoucher

  Store parity with MemoryLedgerStore (CONVENTIONS Rule 11): same
  planManualVoucher plan, inserted inside the standard advisory-lock +
  chain-fork-retry transaction every other appender uses. Adds the shared
  conformance scenario so Memory/Postgres agree structurally.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 10 — API: `POST /api/vouchers/manual`

**Files:** `services/api/src/app.ts`, `tests/unit/api-runtime.test.ts`

**Interfaces:**

```ts
app.post("/api/vouchers/manual", jsonValidated(manualVoucherInputSchema), handler); // → 201 manualVoucherResultSchema
```

- [ ] Write the failing test first. `tests/unit/api-runtime.test.ts` already exports a `createTestApiApp(runtimeMode, overrides)` helper (line 16) and every existing route test in the file calls `app.request("http://localhost/api/...")` — reuse both verbatim. Add:

  ```ts
  test("POST /api/vouchers/manual creates a voucher + review and rejects an unbalanced payload with 400", async () => {
    const app = createTestApiApp("demo");
    const ok = await app.request("http://localhost/api/vouchers/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Utlägg för kontorsmaterial",
        bookedAt: "2026-03-20",
        lines: [
          { accountNumber: "6110", debit: 250, credit: 0 },
          { accountNumber: "2899", debit: 0, credit: 250 },
        ],
      }),
    });
    assert.equal(ok.status, 201);
    const body = await ok.json();
    assert.ok(body.voucherId);
    assert.ok(body.reviewId);

    const bad = await app.request("http://localhost/api/vouchers/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Bad",
        bookedAt: "2026-03-20",
        lines: [{ accountNumber: "6110", debit: 250, credit: 0 }],
      }),
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.code, "validation_error");
  });
  ```

- [ ] Run: `corepack pnpm exec tsx --test tests/unit/api-runtime.test.ts` — expect 404 (route doesn't exist yet).
- [ ] Implement. In `services/api/src/app.ts`:
  - Add `manualVoucherInputSchema` to the `@jpx-accounting/contracts` import list.
  - Add `InvalidManualVoucherError` to the `@jpx-accounting/domain` import list.
  - Register the route (near the other `/api/vouchers/*` and `/api/reviews/*` routes, after `POST /api/vouchers/:id/suggest`):
    ```ts
    app.post("/api/vouchers/manual", jsonValidated(manualVoucherInputSchema), async (context) => {
      const input = context.req.valid("json");
      const result = await currentStore.createManualVoucher({ ...input, actorId: deriveActorId(context) });
      return context.json(result, 201);
    });
    ```
  - Add the error mapping in `app.onError`, next to the `InvalidReviewEditError` branch:
    ```ts
    if (error instanceof InvalidManualVoucherError) {
      // Well-formed JSON but exact-öre-unbalanced lines → 422 (Rule 16), same
      // family as InvalidReviewEditError.
      return jsonError(c, error.message, runtimeMode, 422, { code: "invalid_manual_voucher" });
    }
    ```
- [ ] Run: `corepack pnpm exec tsx --test tests/unit/api-runtime.test.ts` — expect pass.
- [ ] Run `corepack pnpm check` — expect fully green (lint, format, typecheck ×2, unit tests, build).
- [ ] Commit:

  ```
  feat(api): POST /api/vouchers/manual

  Registers the manual-entry route behind jsonValidated(manualVoucherInputSchema),
  inheriting the existing mutation middleware stack (body limit, rate limiter,
  JWT when configured) with no route-specific duplication. Maps
  InvalidManualVoucherError to the same 422 family as InvalidReviewEditError.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 11 — Review-edit sheet: settlement account + RC25 (backend acceptance only; the manual-entry form itself is Phase E)

**Files:** `apps/web/components/today/review-edit-sheet.tsx`, `apps/web/messages/sv.json`, `apps/web/messages/en.json`

- [ ] Write the failing test first. This is a presentational form change without existing unit-test coverage of its own (the file has no colocated unit test — it's covered by E2E specs that are out of this phase's scope per the master's E2E note). Skip straight to a manual acceptance check instead of a new automated test: after implementing, run `corepack pnpm typecheck` (catches prop/type errors) and visually confirm via `corepack pnpm dev:web` that the two new fields render and submit correctly. (If a `tests/unit/review-edit-sheet.test.ts`-style component test convention exists elsewhere in the repo, mirror it — grep first; none was found for this specific component.)
- [ ] Implement. In `apps/web/components/today/review-edit-sheet.tsx`:
  - Extend `VAT_CODES`:
    ```ts
    const VAT_CODES = ["VAT25", "VAT12", "VAT6", "VAT0", "RC25", "NA"] as const;
    ```
  - Add a settlement-account option list and state, right after the `vatCode` state:
    ```ts
    const SETTLEMENT_ACCOUNTS = ["1930", "2899", "1630"] as const;
    const [settlementAccountNumber, setSettlementAccountNumber] = useState<string>(() => defaultCoaTemplate.roles.bank);
    ```
  - In `handleSubmit`, add it to the `edited` payload only when changed from the default:
    ```ts
    const edited: ReviewDecisionEdit = {
      accountNumber,
      accountName,
      vatCode,
      ...(amountsChanged && gross !== undefined && net !== undefined && vat !== undefined
        ? { grossAmount: gross, netAmount: net, vatAmount: vat }
        : {}),
      ...(bookedAtChanged ? { bookedAt: bookedAtInput } : {}),
      ...(settlementAccountNumber !== defaultCoaTemplate.roles.bank ? { settlementAccountNumber } : {}),
    };
    ```
  - Add the select control in the form grid, after the VAT-code select block:
    ```tsx
    <div>
      <label htmlFor="review-edit-settlement" className="text-eyebrow block">
        {t("settlementAccountLabel")}
      </label>
      <select
        id="review-edit-settlement"
        data-testid="edit-settlement-account"
        value={settlementAccountNumber}
        onChange={(event) => setSettlementAccountNumber(event.target.value)}
        className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
      >
        {SETTLEMENT_ACCOUNTS.map((number) => (
          <option key={number} value={number}>
            {number} — {findCoaAccount(defaultCoaTemplate, number)?.name ?? number}
          </option>
        ))}
      </select>
    </div>
    ```
- [ ] Add the new i18n key to `apps/web/messages/sv.json` (`today.editSheet`, after `"vatCodeLabel"`):
  ```json
  "settlementAccountLabel": "Motkonto (betalning)",
  ```
  And `apps/web/messages/en.json`:
  ```json
  "settlementAccountLabel": "Settlement account",
  ```
- [ ] Run `corepack pnpm typecheck` and `corepack pnpm lint` — expect pass.
- [ ] Run `corepack pnpm exec tsx --test tests/unit/*.test.ts` — expect the full suite still green (no unit test touches this component directly, but `local-data-registry.test.ts` and i18n-key-coverage-style tests, if any, should still pass — check for a message-completeness test and re-run it specifically if one exists: `grep -rl "messages/sv.json" tests/unit`).
- [ ] Commit:

  ```
  feat(web): review-edit sheet gets a settlement-account select and RC25

  Backend acceptance for D3's settlement override and reverse-charge VAT
  code, surfaced on the existing review-edit sheet (the full manual-entry
  form is Phase E). Settlement defaults to 1930 and is only sent when
  changed, keeping untouched approvals byte-identical.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Verification (end of phase)

- [ ] `corepack pnpm check` — lint, format:check, typecheck, typecheck:tests, unit tests, build all green.
- [ ] `corepack pnpm db:test` — full Postgres conformance suite green, including the three `manual voucher lifecycle` variants and the `manual-vouchers-schema` capability assertion.
- [ ] Manually exercise `POST /api/vouchers/manual` against a demo-mode `pnpm dev` instance (curl or the review-edit sheet's settlement field) and confirm the created review appears in `/today?view=queue`, approving it posts the verbatim lines, and `GET /api/reports/journal` shows them dated to the requested `bookedAt`.

## Summary of deviations from the master's literal interface contract (with reasons)

1. **`vatCodeSchema` is newly created**, not modified — it did not exist in contracts before this phase (see header note). Used only for `manualVoucherLineSchema.vatCode`; `accountingSuggestionSchema.vatCode` and `reviewDecisionEditSchema.vatCode` deliberately stay `z.string()` because `"VAT-REVIEW"` (a legitimate system-only value on suggestions) is outside the new enum.
2. **`accountingSuggestionSchema` gains a `lines` field** (not listed in the master's contract, which only mentions `direction`). This is how "whose suggestion carries the verbatim lines" (master's own wording for `createManualVoucher`) is implemented — there was no other schema-compliant place to carry an arbitrary `LedgerLine`-shaped array for a manual voucher between creation and approval. Persisted in the existing `ledger.review_tasks.suggestion` jsonb column — no new migration column needed for it.
3. **New `InvalidManualVoucherError`** (not in the master's list) — a client-correctable exact-öre balance violation needs its own 422, distinct from the invariant-violation `UnbalancedPostingError` (which intentionally has no dedicated `app.onError` branch and surfaces as 500).
4. **Task 6 (`simulateApprovals` fix)** is not requested by the master but is a direct, otherwise-silent correctness bug introduced by `AccountingSuggestion.lines` — fixed proactively.
5. **8910 is not re-added** to the CoA (see header note — it already exists); only 10 of the master's listed 11 accounts are new.
6. **2126 keeps the real BAS name "Periodiseringsfond 2016"** rather than a generic "Periodiseringsfond" — see the note below; flagging this rather than inventing a fictitious account name.

## Current-code facts that contradict the readiness spec

- **`vatCodeSchema` does not exist** (see header). The readiness spec and master both phrase the RC25 addition as if extending a pre-existing schema.
- **Account 8910 already exists** in `bas-2026.ts` — the G1/D4 CoA addition list in the readiness spec double-counts it.
- **BAS account 2126 is year-locked**: the real, current BAS chart names it "Periodiseringsfond 2016" — periodiseringsfond accounts are allocated one number per tax year (permanently, since a fund must be reversed within six years), so 2126 is NOT a generic "current year's tax allocation reserve" account. Booking JPx's actual FY1/FY2 periodiseringsfond will need whichever account number the CURRENT tax year maps to (likely in the low 2130s by FY2025/2026) — a business-process fact for whoever books the real close entry, not a Phase B blocker (Phase B only needs the account to exist and resolve through `findCoaAccount`/`8811`'s appropriation counterpart). Flagged here since neither the master nor the readiness spec mentions this.
- **`Voucher.evidencePacketId` → nullable ripple is larger than the master's phrasing implies**: five test fixture files and two non-test call sites (`packages/reporting/src/observations.ts`, `apps/web/components/reports/voucher-link.tsx`) needed updates to keep `pnpm typecheck` green — none of this is mentioned in the master or design/readiness docs. See Task 2.
