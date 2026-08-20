# KFR Phase F — Tax Calendar & Corpus

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

**Delivers:** `taxDeadlineKindSchema` gains `"income-tax-return"` (INK2); `workspaceProfileSchema` gains `euTrade: boolean`; `buildTaxTimeline` models real INK2 deadlines and fixes the yearly-VAT branch that was previously computed as if EVERY yearly-moms company used the 26th-of-second-month rule (wrong for the common no-EU-trade AB case — see `docs/findings.md`, 2026-08-20 entry "Two statutory-content bugs"); a settings UI toggle for `euTrade`; and two corrected `docs/knowledge/sv` articles with the corpus rebuilt.

**Independent of B/C/D/E** (dependency notes, master plan line 22) — this phase touches `packages/contracts`, `packages/domain/src/tax/calendar.ts`, three read-only web call sites, settings UI, and the knowledge corpus. It does not touch `LedgerStore`, migrations, or VAT box computation (`vat/boxes.ts` is Phase C/D territory).

**Verified facts this plan is built from** (all confirmed by direct code inspection + a fresh date-arithmetic simulation during planning — see "Verification math" below):

- Current `packages/contracts/src/index.ts` has **neither** `euTrade` **nor** `firstFiscalYearStart` on `workspaceProfileSchema` yet (grep-confirmed 2026-08-20) — Task 1 adds `euTrade` defensively (check-then-add) in case a parallel Phase B/D run lands it first. `firstFiscalYearStart` is NOT this phase's concern (Phase D6 owns it) and is not touched here.
- `packages/domain/src/tax/calendar.ts`'s existing `TAX_DEADLINE_SOURCES["sv-vat-yearly-26"]` citation string **also carries the inverted claim** ("för helt beskattningsår **utan** EU-handel") that `docs/findings.md` flagged in the code's date logic — this is a second instance of the same bug, in the citation text, not called out explicitly in the master brief but required to fix for internal consistency (the corrected code now applies the 26th-rule when `euTrade === true`, so the citation must say so too). Fixed in Task 2.
- Only **one** other knowledge doc contains a stale amount (`docs/knowledge/sv/arsredovisning-ab.md`); a repo-wide grep for `5 000` and `förseningsavgift` across `docs/knowledge/sv` found no other hits (verified 2026-08-20).
- Live web verification (2026-08-20, two independent sources) found digital (iXBRL) annual-report filing is **not just "still voluntary"** — it becomes **mandatory for fiscal years beginning after 2025-12-31**, with first mandatory filings expected ~summer 2027 for calendar-year companies. This is MORE precise than the phase brief's literal "digital-filing-still-voluntary status" ask, and directly relevant to JPx's own FY2 (starts 2026-09-01, after the cutover) — Task 4 states both facts. Flagged as a deliberate elaboration, not a deviation from intent.

---

## Task 1 — Contracts: `income-tax-return` kind + `euTrade` flag

**Files:** `packages/contracts/src/index.ts`, `tests/unit/contracts-settings.test.ts`

**Interfaces:** `taxDeadlineKindSchema` (+1 enum literal `"income-tax-return"`), `workspaceProfileSchema` (+`euTrade: z.boolean().default(false)`), `WorkspaceProfile` type, `DEFAULT_WORKSPACE_PROFILE`.

- [ ] **Defensive check** (this field may already exist if Phase B or D landed first in actual execution order):

  ```bash
  grep -n "euTrade" packages/contracts/src/index.ts
  ```

  If this prints a match inside `workspaceProfileSchema`, skip the schema edit below and go straight to the test updates (they must pass regardless of which phase added the field).

- [ ] Write the failing tests first. Open `tests/unit/contracts-settings.test.ts` and:

  Add `taxDeadlineKindSchema` to the import block (currently lines 4–11):

  ```ts
  import {
    aiPostureSchema,
    companySettingsSchema,
    countryValidationRegistry,
    DEFAULT_AI_POSTURE,
    DEFAULT_WORKSPACE_PROFILE,
    taxDeadlineKindSchema,
    workspaceProfileSchema,
  } from "@jpx-accounting/contracts";
  ```

  Update the existing default-profile assertion (currently lines 22–30) to include `euTrade: false`:

  ```ts
  test("DEFAULT_WORKSPACE_PROFILE carries the Sweden defaults", () => {
    assert.deepEqual(DEFAULT_WORKSPACE_PROFILE, {
      country: "SE",
      locale: "sv-SE",
      currency: "SEK",
      fiscalYearStart: "01-01",
      vatPeriod: "quarterly",
      euTrade: false,
    });
  });
  ```

  Append two new tests after the existing `"vatPeriod round-trips and rejects unknown cadences"` test (after line 92):

  ```ts
  test("euTrade defaults false and round-trips through the settings schema", () => {
    assert.equal(workspaceProfileSchema.parse({}).euTrade, false);
    const parsed = companySettingsSchema.parse({ ...validBase, profile: { euTrade: true } });
    assert.equal(parsed.profile.euTrade, true);
  });

  test("taxDeadlineKindSchema includes the INK2 income-tax-return kind", () => {
    assert.deepEqual(taxDeadlineKindSchema.options, [
      "vat-return",
      "employer-declaration",
      "f-skatt",
      "annual-report",
      "income-tax-return",
    ]);
  });
  ```

- [ ] Run and confirm the new/updated assertions fail against current `main`:

  ```bash
  corepack pnpm exec tsx --test tests/unit/contracts-settings.test.ts
  ```

  Expect failures: the `DEFAULT_WORKSPACE_PROFILE` deep-equal (extra `euTrade` key expected but absent), the `euTrade` round-trip test (`.euTrade` is `undefined`), and the `taxDeadlineKindSchema.options` deep-equal (5 vs 4 entries).

- [ ] Implement in `packages/contracts/src/index.ts`. Change (line 667):

  ```ts
  export const taxDeadlineKindSchema = z.enum(["vat-return", "employer-declaration", "f-skatt", "annual-report"]);
  ```

  to:

  ```ts
  export const taxDeadlineKindSchema = z.enum([
    "vat-return",
    "employer-declaration",
    "f-skatt",
    "annual-report",
    "income-tax-return",
  ]);
  ```

  Change `workspaceProfileSchema` (lines 545–558):

  ```ts
  export const workspaceProfileSchema = z.object({
    country: countryCodeSchema.default("SE"),
    /** BCP-47; drives Intl formatting + the message catalog. */
    locale: z.string().min(2).default("sv-SE"),
    /** ISO-4217 display currency. Voucher-level multi-currency is out of scope. */
    currency: z.string().length(3).default("SEK"),
    /** MM-DD start of the fiscal year. */
    fiscalYearStart: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .default("01-01"),
    /** VAT reporting cadence — defaulted so pre-Phase-5 payloads keep parsing (no migration). */
    vatPeriod: vatPeriodSchema.default("quarterly"),
  });
  ```

  to:

  ```ts
  export const workspaceProfileSchema = z.object({
    country: countryCodeSchema.default("SE"),
    /** BCP-47; drives Intl formatting + the message catalog. */
    locale: z.string().min(2).default("sv-SE"),
    /** ISO-4217 display currency. Voucher-level multi-currency is out of scope. */
    currency: z.string().length(3).default("SEK"),
    /** MM-DD start of the fiscal year. */
    fiscalYearStart: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .default("01-01"),
    /** VAT reporting cadence — defaulted so pre-Phase-5 payloads keep parsing (no migration). */
    vatPeriod: vatPeriodSchema.default("quarterly"),
    /**
     * Bedriver EU-handel (unionsvaruhandel/unionstjänstehandel)? Selects which
     * yearly-moms deadline table `buildTaxTimeline` uses when `vatPeriod` is
     * "yearly": `true` keeps the 26th-of-second-month rule; `false` couples the
     * deadline to the income declaration instead (Skatteverket "När ska jag
     * deklarera moms" — see docs/findings.md 2026-08-20). Defaulted so
     * pre-Phase-F payloads keep parsing (no migration).
     */
    euTrade: z.boolean().default(false),
  });
  ```

  No DB migration: `organization_settings.settings` is one jsonb blob (`companySettingsSchema.parse()` on read in both `MemoryLedgerStore` and `PostgresLedgerStore` fills the default) — confirmed by inspection of `packages/domain/src/store.ts:796-805` and `packages/persistence-postgres/src/store.ts:1558-1580`; same pattern `vatPeriod` already uses. CONVENTIONS rule 1 (schema-contract sync) does not apply here — there is no dedicated column to add.

- [ ] Run again and confirm green:

  ```bash
  corepack pnpm exec tsx --test tests/unit/contracts-settings.test.ts
  ```

- [ ] Typecheck the contracts package (cheap sanity check before the wider Task 2 blast radius):

  ```bash
  corepack pnpm --filter @jpx-accounting/contracts typecheck
  ```

- [ ] Commit:

  ```
  feat(contracts): add income-tax-return deadline kind and workspace euTrade flag

  INK2 deadlines and the non-EU-trade yearly-moms branch (Phase F, calendar.ts)
  need a schema home for both. euTrade defaults false so existing payloads
  keep parsing without a migration.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 2 — `calendar.ts`: INK2 deadlines + euTrade-branched yearly VAT (atomic with every consumer)

**Files:** `packages/domain/src/tax/calendar.ts`, `tests/unit/tax-timeline.test.ts`, `apps/web/components/settings/fiscal-year-form.tsx`, `apps/web/components/dashboard/use-dashboard-data.ts`, `apps/web/components/reports/tax-timeline-row.tsx`, `apps/web/messages/sv.json`, `apps/web/messages/en.json`

**Interfaces:** `BuildTaxTimelineInput.profile` widens to `Pick<WorkspaceProfile, "vatPeriod" | "fiscalYearStart" | "euTrade">`; `buildTaxTimeline()` now also emits `kind: "income-tax-return"` rows and branches the yearly `"vat-return"` row's `dueDate`/`sourceKey` on `euTrade`; `TAX_DEADLINE_SOURCES` gains `"sv-ink2-digital"` and `"sv-vat-yearly-coupled"`, and corrects `"sv-vat-yearly-26"`'s inverted citation text.

CONVENTIONS rule 6 (atomic contract changes) applies: widening `BuildTaxTimelineInput.profile` breaks every existing literal `{ vatPeriod, fiscalYearStart }` object passed to `buildTaxTimeline` (TS excess/missing-property checking on object literals). All three `apps/web` call sites and all 14 test call sites land in **this one commit** — do not split them out, or `pnpm typecheck`/`pnpm typecheck:tests` goes red on an intermediate commit.

### 2a. Verification math (already computed during planning — do not re-derive, just confirm with the run commands below)

| Scenario                                    | fiscalYearStart   | FYE        | Rule                                         | Result                                                   |
| ------------------------------------------- | ----------------- | ---------- | -------------------------------------------- | -------------------------------------------------------- |
| INK2, jul–aug bucket                        | `09-01` (fy-2025) | 2026-08-31 | `+1y, month 4, day 1`                        | `2027-04-01` (Thursday — no shift)                       |
| INK2, sep–dec bucket                        | `01-01` (fy-2025) | 2025-12-31 | `+1y, month 8, day 1`                        | `2026-08-01` is a **Saturday** → shift +2 → `2026-08-03` |
| Yearly VAT, `euTrade:true`, jul–aug FYE     | `09-01` (fy-2025) | 2026-08-31 | 26th of 2nd month (existing rule, unchanged) | `2026-10-26` (Monday — no shift)                         |
| Yearly VAT, `euTrade:false`, jul–aug bucket | `09-01` (fy-2025) | 2026-08-31 | `+1y, month 4, day 12`                       | `2027-04-12` (Monday — no shift)                         |

### 2b. Failing tests first

- [ ] In `tests/unit/tax-timeline.test.ts`, fix the 14 existing `buildTaxTimeline` call sites so they still typecheck once `BuildTaxTimelineInput.profile` requires `euTrade`. Six `replace_all` edits cover all 14 occurrences (grep-verified counts):
  1. `{ vatPeriod: "monthly", fiscalYearStart: "01-01" }` → `{ vatPeriod: "monthly", fiscalYearStart: "01-01", euTrade: true }` (5 occurrences: lines 12, 39, 119, 132, 143)
  2. `{ vatPeriod: "quarterly", fiscalYearStart: "01-01" }` → `{ vatPeriod: "quarterly", fiscalYearStart: "01-01", euTrade: true }` (2 occurrences: lines 25, 100)
  3. `{ vatPeriod: "yearly", fiscalYearStart: "01-01" }` → `{ vatPeriod: "yearly", fiscalYearStart: "01-01", euTrade: true }` (2 occurrences: lines 52, 90 — `euTrade: true` preserves the OLD 26th-rule behavior these two pinned tests assert)
  4. `{ vatPeriod: "yearly", fiscalYearStart: "11-01" }` → `{ vatPeriod: "yearly", fiscalYearStart: "11-01", euTrade: true }` (1 occurrence: line 66, same reason)
  5. `{ vatPeriod: "quarterly", fiscalYearStart: "07-01" }` → `{ vatPeriod: "quarterly", fiscalYearStart: "07-01", euTrade: true }` (3 occurrences: lines 76, 152, 162)
  6. `{ vatPeriod: "quarterly", fiscalYearStart: "05-01" }` → `{ vatPeriod: "quarterly", fiscalYearStart: "05-01", euTrade: true }` (1 occurrence: line 182)

  (`euTrade: true` is an arbitrary but safe choice for every quarterly/monthly-profile test — the flag only affects the `vatPeriod === "yearly"` branch. The two `yearly` groups above use `true` deliberately to keep their existing pinned 26th-rule dates correct.)

- [ ] Append three new pinned tests at the end of the file (after the last existing test, `"currentVatPeriodToken quarterly is the CALENDAR quarter..."`):

  ```ts
  test("pinned: INK2 and yearly VAT (no EU trade) for FYE 2026-08-31 both land in the jul–aug digital window", () => {
    // fy-2025 with start 09-01 ends 2026-08-31 (jul–aug FYE bucket).
    const timeline = buildTaxTimeline({
      profile: { vatPeriod: "yearly", fiscalYearStart: "09-01", euTrade: false },
      today: "2027-01-01",
      horizonDays: 120,
      limit: 20,
    });
    const ink2 = byId(timeline, "tax_ink2_fy-2025");
    assert.ok(ink2, "expected the INK2 deadline in the horizon");
    assert.equal(ink2.kind, "income-tax-return");
    assert.equal(ink2.dueDate, "2027-04-01");
    assert.equal(ink2.amountRef, null);
    assert.equal(ink2.sourceKey, "sv-ink2-digital");

    const yearly = byId(timeline, "tax_vat_fy-2025");
    assert.ok(yearly, "expected the yearly VAT deadline in the horizon");
    assert.equal(yearly.dueDate, "2027-04-12");
    assert.equal(yearly.periodToken, "fy-2025");
    assert.equal(yearly.amountRef, "box49");
    assert.equal(yearly.sourceKey, "sv-vat-yearly-coupled");
  });

  test("pinned: yearly VAT keeps the 26th-rule when euTrade is true, independent of INK2", () => {
    // Same fy-2025/09-01 fiscal year as above, but euTrade:true selects the
    // OLD 26th-of-second-month rule instead — INK2 is unconditional and stays
    // at the same 2027-04-01 date either way.
    const timeline = buildTaxTimeline({
      profile: { vatPeriod: "yearly", fiscalYearStart: "09-01", euTrade: true },
      today: "2026-09-01",
      horizonDays: 250,
      limit: 25,
    });
    const yearly = byId(timeline, "tax_vat_fy-2025");
    assert.ok(yearly, "expected the yearly VAT deadline in the horizon");
    assert.equal(yearly.dueDate, "2026-10-26");
    assert.equal(yearly.sourceKey, "sv-vat-yearly-26");

    const ink2 = byId(timeline, "tax_ink2_fy-2025");
    assert.ok(ink2, "expected the INK2 deadline in the horizon");
    assert.equal(ink2.dueDate, "2027-04-01");
  });

  test("pinned: INK2 for FYE 2025-12-31 shifts from Saturday 2026-08-01 to Monday 2026-08-03", () => {
    const timeline = buildTaxTimeline({
      profile: { vatPeriod: "yearly", fiscalYearStart: "01-01", euTrade: true },
      today: "2026-06-01",
      horizonDays: 120,
      limit: 15,
    });
    const ink2 = byId(timeline, "tax_ink2_fy-2025");
    assert.ok(ink2, "expected the INK2 deadline in the horizon");
    assert.equal(ink2.kind, "income-tax-return");
    assert.equal(ink2.dueDate, "2026-08-03");
    assert.equal(ink2.amountRef, null);
  });
  ```

- [ ] Run and confirm failures (the six `replace_all` edits alone don't change behavior; `income-tax-return`/`euTrade` don't exist yet, so `byId(...)` returns `undefined` and `assert.ok` throws; the `euTrade:false` yearly-VAT date also still resolves to the old unconditional 26th-rule, not `2027-04-12`):
  ```bash
  corepack pnpm exec tsx --test tests/unit/tax-timeline.test.ts
  ```

### 2c. Implement `packages/domain/src/tax/calendar.ts`

- [ ] Update the module doc comment (lines 5–33). Replace:

  ```ts
  /**
   * Swedish statutory tax calendar (advisory pivot Phase 5, plan finding 8 —
   * verified against Skatteverket 2026-07-04). Deadlines are encoded as DATA
   * with verbatim source strings; every date is computed from LOCAL calendar
   * parts (never `toISOString().slice`).
   *
   * Scope (documented limitations):
   * - SMB rules only (turnover ≤ 40 MSEK): monthly AND quarterly moms are due
   *   the 12th of the SECOND month after the period (17th when the due month is
   *   January or August). The > 40 MSEK variant (26th of the next month) is NOT
   *   encoded.
   * - Quarterly moms periods are CALENDAR quarters (kalenderkvartal, 26 kap.
   *   skatteförfarandelagen (2011:1244)) — statutory momsredovisning periods are
   *   calendar-anchored regardless of the company's fiscal year. For broken
   *   fiscal years that are not calendar-quarter-aligned, the statutory window
   *   has no token in the unified period grammar (fiscal quarters only), so
   *   those deadline rows are date-only: no `periodToken`, `amountRef: null` —
   *   honest over approximate.
   * - Yearly moms (no EU trade): 26th of the second month after the fiscal-year
   *   end (27th when the due month is December).
   * - Arbetsgivardeklaration + debiterad preliminärskatt (F-skatt): the 12th of
   *   every month (17th in January and August).
   * - Årsredovisning (AB): in by the end of the seventh month after the
   *   fiscal-year end (ÅRL 8 kap. 3 §) — rendered as the statutory month-end
   *   date, deliberately NOT weekend-shifted (the shift is a filing grace, and
   *   showing a later date than the statute would be dishonest).
   * - Weekend shift (Saturday/Sunday → next Monday) applies to the Skatteverket
   *   declaration/payment deadlines. Public-holiday shifts are out of scope.
   */
  ```

  with:

  ```ts
  /**
   * Swedish statutory tax calendar (advisory pivot Phase 5, plan finding 8 —
   * verified against Skatteverket 2026-07-04; yearly-moms branch and INK2
   * corrected/added 2026-08-20 — see docs/findings.md). Deadlines are encoded
   * as DATA with verbatim source strings; every date is computed from LOCAL
   * calendar parts (never `toISOString().slice`).
   *
   * Scope (documented limitations):
   * - SMB rules only (turnover ≤ 40 MSEK): monthly AND quarterly moms are due
   *   the 12th of the SECOND month after the period (17th when the due month is
   *   January or August). The > 40 MSEK variant (26th of the next month) is NOT
   *   encoded.
   * - Quarterly moms periods are CALENDAR quarters (kalenderkvartal, 26 kap.
   *   skatteförfarandelagen (2011:1244)) — statutory momsredovisning periods are
   *   calendar-anchored regardless of the company's fiscal year. For broken
   *   fiscal years that are not calendar-quarter-aligned, the statutory window
   *   has no token in the unified period grammar (fiscal quarters only), so
   *   those deadline rows are date-only: no `periodToken`, `amountRef: null` —
   *   honest over approximate.
   * - Yearly moms branches on `profile.euTrade` (Skatteverket "När ska jag
   *   deklarera moms"): `true` (EU-handel, or no inkomstdeklaration filed) →
   *   the 26th of the second month after the fiscal-year end (27th when the
   *   due month is December); `false` (no EU trade, an inkomstdeklaration is
   *   filed — the common AB case) → the digital date is instead COUPLED to the
   *   income declaration, keyed by the fiscal-year-end month bucket (see
   *   `YEARLY_VAT_NON_EU_DUE_TABLE`). A prior version of this module applied
   *   the 26th-rule unconditionally, which is wrong for any non-EU-trade AB —
   *   see docs/findings.md 2026-08-20.
   * - Income tax return (INK2, aktiebolag, Skatteverket "Deklarera åt ett
   *   aktiebolag"): digital filing date keyed by the same fiscal-year-end month
   *   bucket (see `INK2_DUE_TABLE`), weekend-shifted like every other
   *   Skatteverket deadline below.
   * - Arbetsgivardeklaration + debiterad preliminärskatt (F-skatt): the 12th of
   *   every month (17th in January and August).
   * - Årsredovisning (AB): in by the end of the seventh month after the
   *   fiscal-year end (ÅRL 8 kap. 3 §) — rendered as the statutory month-end
   *   date, deliberately NOT weekend-shifted (the shift is a filing grace, and
   *   showing a later date than the statute would be dishonest).
   * - Weekend shift (Saturday/Sunday → next Monday) applies to the Skatteverket
   *   declaration/payment deadlines. Public-holiday shifts are out of scope.
   */
  ```

- [ ] Correct + extend `TAX_DEADLINE_SOURCES` (lines 35–46). Replace:

  ```ts
  export const TAX_DEADLINE_SOURCES: Record<string, string> = {
    "sv-vat-12":
      "Skatteverket: Momsdeklaration för företag med beskattningsunderlag om högst 40 miljoner kronor lämnas senast den 12:e i andra månaden efter redovisningsperiodens utgång (den 17:e i januari och augusti).",
    "sv-vat-yearly-26":
      "Skatteverket: Momsdeklaration för helt beskattningsår utan EU-handel lämnas senast den 26:e i andra månaden efter beskattningsårets utgång (den 27:e om månaden är december).",
    "sv-employer-12":
      "Skatteverket: Arbetsgivardeklaration lämnas senast den 12:e i månaden efter löneutbetalningen (den 17:e i januari och augusti).",
    "sv-fskatt-12":
      "Skatteverket: Debiterad preliminärskatt (F-skatt) ska vara bokförd på Skatteverkets konto senast den 12:e varje månad (den 17:e i januari och augusti).",
    "sv-arsredovisning-7m":
      "Årsredovisningslagen (1995:1554) 8 kap. 3 §: Årsredovisningen ska ha kommit in till Bolagsverket senast sju månader efter räkenskapsårets utgång.",
  };
  ```

  with (note `"sv-vat-yearly-26"`'s text is corrected from "utan EU-handel" to "med EU-handel" — it had the same inverted claim findings.md flagged in the code logic):

  ```ts
  export const TAX_DEADLINE_SOURCES: Record<string, string> = {
    "sv-vat-12":
      "Skatteverket: Momsdeklaration för företag med beskattningsunderlag om högst 40 miljoner kronor lämnas senast den 12:e i andra månaden efter redovisningsperiodens utgång (den 17:e i januari och augusti).",
    "sv-vat-yearly-26":
      "Skatteverket: Momsdeklaration för helt beskattningsår med EU-handel (eller utan krav på inkomstdeklaration) lämnas senast den 26:e i andra månaden efter beskattningsårets utgång (den 27:e om månaden är december).",
    "sv-vat-yearly-coupled":
      'Skatteverket ("När ska jag deklarera moms"): för helårsmoms utan EU-handel knyts deklarationstidpunkten i stället till inkomstdeklarationen — digitalt senast den 17 augusti (bokslut september–december), den 12 december (bokslut januari–april, samma år), den 17 januari (bokslut maj–juni) eller den 12 april (bokslut juli–augusti), i förekommande fall flyttat till närmast följande vardag.',
    "sv-employer-12":
      "Skatteverket: Arbetsgivardeklaration lämnas senast den 12:e i månaden efter löneutbetalningen (den 17:e i januari och augusti).",
    "sv-fskatt-12":
      "Skatteverket: Debiterad preliminärskatt (F-skatt) ska vara bokförd på Skatteverkets konto senast den 12:e varje månad (den 17:e i januari och augusti).",
    "sv-arsredovisning-7m":
      "Årsredovisningslagen (1995:1554) 8 kap. 3 §: Årsredovisningen ska ha kommit in till Bolagsverket senast sju månader efter räkenskapsårets utgång.",
    "sv-ink2-digital":
      'Skatteverket ("Deklarera åt ett aktiebolag"): digital inkomstdeklaration 2 (INK2) lämnas senast den 1 augusti (bokslut september–december), den 1 december (bokslut januari–april, samma år), den 15 januari (bokslut maj–juni) eller den 1 april (bokslut juli–augusti), i förekommande fall flyttat till närmast följande vardag.',
  };
  ```

- [ ] Add the bucketed-due-date helpers right after `twentySixthRuleDay` (currently ends line 122) and before `skatteverketDueDate` (currently starts line 124):

  ```ts
  /**
   * The fiscal-year-end month bucket Skatteverket uses for both the INK2
   * filing date and the non-EU-trade yearly-moms date — both are "coupled to
   * the income declaration": same four windows, different day-of-month tables.
   */
  type FyeMonthBucket = "sepDec" | "janApr" | "majJun" | "julAug";

  function fyeMonthBucket(month: number): FyeMonthBucket {
    if (month >= 9) return "sepDec"; // September–December
    if (month <= 4) return "janApr"; // January–April
    if (month <= 6) return "majJun"; // May–June
    return "julAug"; // July–August
  }

  /** One bucketed due date: `yearOffset` 0 keeps the fiscal-year-end's calendar year, 1 moves to the next. */
  type BucketedDueRule = { yearOffset: 0 | 1; month: number; day: number };

  /** Digital INK2 filing dates by fiscal-year-end month bucket (Skatteverket "Deklarera åt ett aktiebolag"). */
  const INK2_DUE_TABLE: Record<FyeMonthBucket, BucketedDueRule> = {
    sepDec: { yearOffset: 1, month: 8, day: 1 },
    janApr: { yearOffset: 0, month: 12, day: 1 },
    majJun: { yearOffset: 1, month: 1, day: 15 },
    julAug: { yearOffset: 1, month: 4, day: 1 },
  };

  /** Digital non-EU-trade yearly-moms dates, coupled to the INK2 windows (Skatteverket "När ska jag deklarera moms"). */
  const YEARLY_VAT_NON_EU_DUE_TABLE: Record<FyeMonthBucket, BucketedDueRule> = {
    sepDec: { yearOffset: 1, month: 8, day: 17 },
    janApr: { yearOffset: 0, month: 12, day: 12 },
    majJun: { yearOffset: 1, month: 1, day: 17 },
    julAug: { yearOffset: 1, month: 4, day: 12 },
  };

  /** Resolve a fiscal-year-end-bucketed due date from one of the tables above, weekend-shifted. */
  function bucketedDueDate(
    fyEnd: { year: number; month: number },
    table: Record<FyeMonthBucket, BucketedDueRule>,
  ): CalendarDate {
    const rule = table[fyeMonthBucket(fyEnd.month)];
    return shiftWeekendToMonday({ year: fyEnd.year + rule.yearOffset, month: rule.month, day: rule.day });
  }
  ```

- [ ] Widen `BuildTaxTimelineInput.profile` (line 199). Change:

  ```ts
  export type BuildTaxTimelineInput = {
    profile: Pick<WorkspaceProfile, "vatPeriod" | "fiscalYearStart">;
  ```

  to:

  ```ts
  export type BuildTaxTimelineInput = {
    profile: Pick<WorkspaceProfile, "vatPeriod" | "fiscalYearStart" | "euTrade">;
  ```

- [ ] Update the `buildTaxTimeline` doc comment (lines 208–214) to mention the new kind. Change:

  ```ts
  /**
   * Upcoming statutory deadlines for the workspace: next occurrences per kind
   * inside `[today, today + horizonDays]`, sorted by due date (then id for
   * determinism), bounded by `limit`. VAT deadlines carry the unified
   * `periodToken` + `amountRef: "box49"`; employer/F-skatt/annual-report are
   * date-only (`amountRef: null` — honest, plan finding 15).
   */
  ```

  to:

  ```ts
  /**
   * Upcoming statutory deadlines for the workspace: next occurrences per kind
   * inside `[today, today + horizonDays]`, sorted by due date (then id for
   * determinism), bounded by `limit`. VAT deadlines carry the unified
   * `periodToken` + `amountRef: "box49"`; employer/F-skatt/annual-report/
   * income-tax-return are date-only (`amountRef: null` — honest, plan finding 15).
   */
  ```

- [ ] Destructure `euTrade` (line 216). Change:

  ```ts
  const { vatPeriod, fiscalYearStart } = input.profile;
  ```

  to:

  ```ts
  const { vatPeriod, fiscalYearStart, euTrade } = input.profile;
  ```

- [ ] Branch the yearly-VAT block and add the INK2 emission (lines 305–315, inside the `for (let fyYear = ...)` loop, right before the `// Årsredovisning:` comment). Change:

  ```ts
  if (vatPeriod === "yearly") {
    include({
      id: `tax_vat_${fyToken}`,
      kind: "vat-return",
      dueDate: formatDay(skatteverketDueDate(fyEnd, 2, twentySixthRuleDay)),
      periodLabel: `FY ${fyYear}`,
      periodToken: fyToken,
      amountRef: "box49",
      sourceKey: "sv-vat-yearly-26",
    });
  }
  ```

  to:

  ```ts
  if (vatPeriod === "yearly") {
    include({
      id: `tax_vat_${fyToken}`,
      kind: "vat-return",
      dueDate: euTrade
        ? formatDay(skatteverketDueDate(fyEnd, 2, twentySixthRuleDay))
        : formatDay(bucketedDueDate(fyEnd, YEARLY_VAT_NON_EU_DUE_TABLE)),
      periodLabel: `FY ${fyYear}`,
      periodToken: fyToken,
      amountRef: "box49",
      sourceKey: euTrade ? "sv-vat-yearly-26" : "sv-vat-yearly-coupled",
    });
  }
  ```

  Then, after the existing annual-report `include({...})` block ends (currently lines 325–333, right before the closing `}` of the `for (let fyYear ...)` loop at line 334), add the unconditional INK2 emission:

  ```ts
  include({
    id: `tax_ink2_${fyToken}`,
    kind: "income-tax-return",
    dueDate: formatDay(bucketedDueDate(fyEnd, INK2_DUE_TABLE)),
    periodLabel: `FY ${fyYear}`,
    amountRef: null,
    sourceKey: "sv-ink2-digital",
  });
  ```

- [ ] Run the domain test and confirm it passes:
  ```bash
  corepack pnpm exec tsx --test tests/unit/tax-timeline.test.ts
  ```

### 2d. Fix the three `apps/web` call sites (required for `pnpm typecheck` to go green again)

- [ ] `apps/web/components/dashboard/use-dashboard-data.ts` (lines 83–90). Change:

  ```ts
  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart },
        today,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, today],
  );
  ```

  to:

  ```ts
  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart, euTrade: profile.euTrade },
        today,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, profile.euTrade, today],
  );
  ```

- [ ] `apps/web/components/reports/tax-timeline-row.tsx` (lines 31–39). Change:

  ```ts
  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart },
        today,
        limit: VISIBLE_DEADLINES,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, today],
  );
  ```

  to:

  ```ts
  const deadlines = useMemo(
    () =>
      buildTaxTimeline({
        profile: { vatPeriod: profile.vatPeriod, fiscalYearStart: profile.fiscalYearStart, euTrade: profile.euTrade },
        today,
        limit: VISIBLE_DEADLINES,
      }),
    [profile.vatPeriod, profile.fiscalYearStart, profile.euTrade, today],
  );
  ```

- [ ] `apps/web/components/settings/fiscal-year-form.tsx` (lines 79–84 — plain render-time call, not memoized, no dependency array). Change:

  ```ts
  const nextAnnualReport = buildTaxTimeline({
    profile: { vatPeriod: profile.vatPeriod, fiscalYearStart },
    today,
    horizonDays: ANNUAL_REPORT_HORIZON_DAYS,
    limit: ANNUAL_REPORT_SCAN_LIMIT,
  }).find((deadline) => deadline.kind === "annual-report");
  ```

  to:

  ```ts
  const nextAnnualReport = buildTaxTimeline({
    profile: { vatPeriod: profile.vatPeriod, fiscalYearStart, euTrade: profile.euTrade },
    today,
    horizonDays: ANNUAL_REPORT_HORIZON_DAYS,
    limit: ANNUAL_REPORT_SCAN_LIMIT,
  }).find((deadline) => deadline.kind === "annual-report");
  ```

  (`services/api/src/advisor/chat.ts:579` and `apps/web/components/advisor/local-demo-transport.ts:184` pass the full `WorkspaceProfile` object through as `profile` — not a narrowed literal — so they satisfy the widened `Pick<...>` structurally with no edit needed. Confirmed by reading both call sites during planning.)

### 2e. Message-catalog labels (required at RUNTIME, not just compile time — `buildTaxTimeline` will start emitting `kind: "income-tax-return"` rows for any workspace whose fiscal year lands one in the visible window, and `t(\`kinds.${deadline.kind}\`)` would otherwise throw/render a raw key)

- [ ] `apps/web/messages/sv.json`: add `"income-tax-return": "Inkomstdeklaration 2"` to BOTH `reports.taxTimeline.kinds` (after line 459, `"annual-report": "Årsredovisning"`) and `dashboard.widgets["tax-timeline"].kinds` (after line 563, same text):

  ```json
        "kinds": {
          "vat-return": "Momsdeklaration",
          "employer-declaration": "Arbetsgivardeklaration",
          "f-skatt": "Debiterad preliminärskatt",
          "annual-report": "Årsredovisning",
          "income-tax-return": "Inkomstdeklaration 2"
        }
  ```

- [ ] `apps/web/messages/en.json`: add `"income-tax-return": "Income tax return (INK2)"` to the same two `kinds` blocks:

  ```json
        "kinds": {
          "vat-return": "VAT return",
          "employer-declaration": "Employer declaration",
          "f-skatt": "F-tax prepayment",
          "annual-report": "Annual report",
          "income-tax-return": "Income tax return (INK2)"
        }
  ```

  (No source-list code change needed: `tax-timeline-row.tsx`'s `sourceKeys = [...new Set(deadlines.map((d) => d.sourceKey))]` and its render loop over `TAX_DEADLINE_SOURCES[key]` already pick up `"sv-ink2-digital"`/`"sv-vat-yearly-coupled"` automatically — confirmed by reading the component during planning, lines 50 and 96-107.)

- [ ] Full verification for this task:

  ```bash
  corepack pnpm exec tsx --test tests/unit/tax-timeline.test.ts
  corepack pnpm typecheck
  corepack pnpm typecheck:tests
  corepack pnpm format:check
  ```

  If `format:check` flags the new lines, run `corepack pnpm format` and re-check.

- [ ] Commit:

  ```
  fix(tax-calendar): model INK2 deadlines and correct the yearly-VAT EU-trade branch

  buildTaxTimeline previously applied the 26th-of-second-month yearly-moms
  rule unconditionally, which is wrong for any AB without EU-handel (the
  common case) — that company's real deadline is coupled to its
  inkomstdeklaration instead. Adds the missing INK2 (income-tax-return)
  deadline kind and branches yearly VAT on the new profile.euTrade flag,
  per the verified Skatteverket date tables in docs/findings.md.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 3 — Settings UI: `euTrade` toggle on the company profile

**Files:** `apps/web/components/settings/company-form.tsx`, `apps/web/messages/sv.json`, `apps/web/messages/en.json`, `tests/e2e/settings-company.spec.ts`

**Interfaces:** none new — saves through the existing `PUT /api/settings/company` (`jsonValidated(companySettingsSchema)`, unchanged route in `services/api/src/app.ts:907-911`).

`vatPeriod` (the field this new toggle is conceptually paired with) is edited in `company-form.tsx`'s `workspaceProfile` fieldset (confirmed by reading the component during planning — `fiscal-year-form.tsx` only shows `vatPeriod` read-only with a link back here), so the new toggle goes there too, as a full-width row under the existing 2-column grid of `ProfileSelectField`s (a checkbox needs label + hint text, not the compact 2-column select layout).

- [ ] Add the failing E2E test. In `tests/e2e/settings-company.spec.ts`, add `checkControl` to the existing import (line 3):

  ```ts
  import { activateControl, checkControl, pickSelectOption, resetApiState } from "./test-helpers";
  ```

  Append a new test after `"rejects an invalid Swedish organization number..."` (end of file):

  ```ts
  test("saves the EU-trade toggle and persists it across reload", async ({ page, isMobile }) => {
    await page.goto("/settings/company");
    await expect(page.getByTestId("company-form")).toBeVisible();

    // Off by default — the Swedish SMB default assumes no EU-handel.
    await expect(page.getByTestId("company-profile-eu-trade")).not.toBeChecked();

    await fillCompanyBasics(page);
    await checkControl(page.getByTestId("company-profile-eu-trade"), isMobile);

    await activateControl(page.getByTestId("company-form-submit"), isMobile);
    await expect(page.getByText("Company settings saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("company-form")).toBeVisible();
    await expect(page.getByTestId("company-profile-eu-trade")).toBeChecked();
  });
  ```

  This will fail (no `company-profile-eu-trade` testid exists yet) — confirm with a scoped run once the dev/E2E servers are up (see `AGENTS.md`/`playwright.config.ts` for the `build:e2e` prerequisite):

  ```bash
  corepack pnpm build:e2e && npx playwright test tests/e2e/settings-company.spec.ts -g "EU-trade"
  ```

- [ ] Add the messages. `apps/web/messages/sv.json`, inside `settings.company` (after line 888, `"vatPeriod": "Momsperiod",`):

  ```json
        "vatPeriod": "Momsperiod",
        "euTrade": "Bedriver ni EU-handel?",
        "euTradeHint": "Styr momsdeklarationens tidpunkt vid helårsmoms — med EU-handel gäller 26:e-regeln, annars kopplas tidpunkten till inkomstdeklarationen.",
  ```

  `apps/web/messages/en.json`, same position (after line 888):

  ```json
        "vatPeriod": "VAT period",
        "euTrade": "Do you trade within the EU?",
        "euTradeHint": "Controls the timing of the yearly VAT return — with EU trade the 26th-of-month rule applies, otherwise the deadline is coupled to the income tax return.",
  ```

- [ ] Implement the toggle in `apps/web/components/settings/company-form.tsx`. Insert a new `FormField` as a sibling immediately after the closing `</div>` of the `grid grid-cols-2 gap-4` block (currently ends right before `</fieldset>`, i.e. after the `profile.vatPeriod` `ProfileSelectField` closes, lines 263-276 in the current file):

  ```tsx
            <ProfileSelectField
              control={form.control}
              name="profile.vatPeriod"
              label={t("vatPeriod")}
              options={vatPeriodOptions}
              testId="company-vat-period"
            />
          </div>
          <FormField
            control={form.control}
            name="profile.euTrade"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3 space-y-0 rounded-lg border border-border p-3">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(event) => field.onChange(event.target.checked)}
                    data-testid="company-profile-eu-trade"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-input"
                  />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="font-normal">{t("euTrade")}</FormLabel>
                  <p className="text-sm leading-6 text-muted-foreground">{t("euTradeHint")}</p>
                </div>
              </FormItem>
            )}
          />
        </fieldset>
  ```

  (`FormField`/`FormControl`/`FormLabel` are already imported at the top of this file; no new imports needed. `field.value`/`field.onChange` come from `react-hook-form`'s `Controller` render prop, same pattern the file already uses for text `Input`s — just wired to `checked`/`event.target.checked` instead of spreading `{...field}, since a native checkbox needs `checked`, not `value`.)

  `EMPTY_COMPANY_SETTINGS` (bottom of the file) needs no change — it already spreads `profile: DEFAULT_WORKSPACE_PROFILE`, which carries `euTrade: false` once Task 1 lands.

- [ ] Run the E2E test again and confirm it passes:

  ```bash
  corepack pnpm build:e2e && npx playwright test tests/e2e/settings-company.spec.ts
  ```

- [ ] Run the broader web typecheck + format check:

  ```bash
  corepack pnpm typecheck
  corepack pnpm format:check
  ```

- [ ] Commit:

  ```
  feat(settings): add EU-trade toggle to the company profile

  Surfaces profile.euTrade (added in the contracts task) next to vatPeriod
  in the company form, so the yearly-VAT deadline branch calendar.ts now
  computes is actually reachable from the UI.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task 4 — Knowledge corpus: fix the two statutory-content bugs + rebuild

**Files:** `docs/knowledge/sv/moms-deklarationstider.md`, `docs/knowledge/sv/arsredovisning-ab.md`, `packages/advisor/src/corpus.generated.ts` (regenerated, not hand-edited)

**Interfaces:** none — content + generated data only. The "test" here is the existing corpus-sync tripwire (`tests/unit/knowledge-retrieval.test.ts`, the `"corpus-sync tripwire..."` test), which fails the moment the source `.md` changes without a matching `pnpm build:knowledge` run.

- [ ] Confirm no other doc needs the same amount fix (already grep-verified during planning, re-confirm before editing):

  ```bash
  grep -rn "5 000\|förseningsavgift" docs/knowledge/sv/
  ```

  Expect exactly one hit: `docs/knowledge/sv/arsredovisning-ab.md`, the `förseningsavgift` bullet.

- [ ] Edit `docs/knowledge/sv/moms-deklarationstider.md`. Bump the frontmatter and sharpen the citation (lines 1–6):

  ```
  ---
  title: Momsdeklaration — redovisningsperioder och deklarationstidpunkter
  source: Skatteverket — "När ska jag deklarera moms"; Deklarationstidpunkter för moms; skatteförfarandelagen 26 kap.
  url: https://www.skatteverket.se/foretag/moms/deklareraochbetalamoms
  effective: 2026-08-20
  ---
  ```

  Replace the entire `## Helårsmoms (redovisningsperiod ett beskattningsår)` section (lines 22–27) — this is the inverted-branch bug from `docs/findings.md`:

  ```
  ## Helårsmoms (redovisningsperiod ett beskattningsår)

  - Utan EU-handel: deklarationen ska vara inne senast den 26:e i andra månaden efter beskattningsårets utgång; när tidpunkten infaller i december gäller i stället den 27:e.
  - Räkenskapsår som slutar den 31 december → deklaration och betalning senast den 26 februari året därpå.
  - Räkenskapsår som slutar den 31 oktober → deklaration senast den 27 december samma år.
  - Företag som bedriver EU-handel har en tidigare deklarationstidpunkt än företag utan EU-handel.
  ```

  with:

  ```
  ## Helårsmoms (redovisningsperiod ett beskattningsår)

  - Vilken av två tidtabeller som gäller avgörs av om företaget bedriver EU-handel (unionsvaruhandel/unionstjänstehandel) eller inte behöver lämna någon inkomstdeklaration.
  - Med EU-handel, eller inget krav på inkomstdeklaration: deklarationen ska vara inne senast den 26:e i andra månaden efter beskattningsårets utgång; när tidpunkten infaller i december gäller i stället den 27:e.
  - Räkenskapsår som slutar den 31 december (EU-handel) → deklaration och betalning senast den 26 februari året därpå.
  - Räkenskapsår som slutar den 31 oktober (EU-handel) → deklaration senast den 27 december samma år.
  - Utan EU-handel, för bolag som lämnar inkomstdeklaration (t.ex. de flesta aktiebolag): momsdeklarationen knyts i stället till inkomstdeklarationens tidpunkt och styrs av räkenskapsårets slutmånad, inte av 26:e-regeln. Digital inlämning:
    - Räkenskapsår september–december → senast den 17 augusti året därpå.
    - Räkenskapsår januari–april → senast den 12 december samma år.
    - Räkenskapsår maj–juni → senast den 17 januari året därpå.
    - Räkenskapsår juli–augusti → senast den 12 april året därpå.
  - Pappersinlämning i samma fyra fönster har tidigare datum: 12 juli, 12 november, 27 december respektive 12 mars.
  ```

  (1285 characters — comfortably under the 1500-char-per-chunk ceiling in `corpus-source.ts`, verified during planning; no further splitting needed.)

- [ ] Edit `docs/knowledge/sv/arsredovisning-ab.md`. Bump the frontmatter (line 5):

  ```
  effective: 2026-07-04
  ```

  to:

  ```
  effective: 2026-08-20
  ```

  Replace the stale förseningsavgift bullet (line 21):

  ```
  - Förseningsavgift för privata aktiebolag: 5 000 kronor vid försening, ytterligare 5 000 kronor efter två månader och ytterligare 10 000 kronor efter fyra månader.
  ```

  with (Prop. 2024/25:8, in force 2025-01-01):

  ```
  - Förseningsavgift för privata aktiebolag (Prop. 2024/25:8, i kraft sedan 2025-01-01): 7 500 kronor vid försenad årsredovisning, ytterligare 7 500 kronor om den fortfarande inte kommit in två månader efter första förseningen, och ytterligare 15 000 kronor om den fortfarande inte kommit in fyra månader efter första förseningen.
  ```

  Replace the `## Digital inlämning` section (lines 35–37):

  ```
  ## Digital inlämning

  - Årsredovisningen kan lämnas in digitalt (iXBRL) via Bolagsverkets e-tjänst; digital inlämning ger automatisk mottagningskontroll.
  ```

  with (live-verified 2026-08-20 — see the plan header's "Verified facts" note):

  ```
  ## Digital inlämning

  - Digital inlämning (iXBRL) av årsredovisningen via Bolagsverkets e-tjänst är i nuläget frivillig — pappersinlämning är fortfarande ett giltigt alternativ.
  - Från och med räkenskapsår som inleds efter den 31 december 2025 blir digital iXBRL-inlämning obligatorisk för aktiebolag; de första obligatoriska inlämningarna väntas därför sommaren 2027 för bolag med kalenderår som räkenskapsår.
  - Digital inlämning ger automatisk mottagningskontroll och är normalt snabbare att handlägga än pappersinlämning.
  ```

- [ ] Confirm the corpus-sync tripwire now fails (the checked-in `corpus.generated.ts` is stale relative to the edited source docs):

  ```bash
  corepack pnpm exec tsx --test tests/unit/knowledge-retrieval.test.ts
  ```

  Expect the `"corpus-sync tripwire: rebuilding from docs/knowledge/sv equals the checked-in corpus"` test to fail with the message `"corpus.generated.ts is stale — run \`pnpm build:knowledge\` and commit the result"`.

- [ ] Regenerate:

  ```bash
  corepack pnpm build:knowledge
  ```

- [ ] Confirm green:

  ```bash
  corepack pnpm exec tsx --test tests/unit/knowledge-retrieval.test.ts
  corepack pnpm format:check
  ```

- [ ] Commit (include the regenerated `corpus.generated.ts` — it is checked in per CLAUDE.md):

  ```
  fix(knowledge): correct helårsmoms branch and förseningsavgift amounts

  moms-deklarationstider.md had the EU-handel/no-EU-handel helårsmoms
  branches inverted, and arsredovisning-ab.md still cited the pre-2025
  förseningsavgift amounts (Prop. 2024/25:8 raised them to 7 500/+7 500/
  +15 000, in force since 2025-01-01). Rebuilds corpus.generated.ts.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Phase F verification

1. `corepack pnpm check` (lint, format:check, typecheck ×2, unit tests, build) — must be green.
2. `corepack pnpm exec tsx --test tests/unit/tax-timeline.test.ts tests/unit/contracts-settings.test.ts tests/unit/knowledge-retrieval.test.ts` — all three suites green in one run.
3. `corepack pnpm build:e2e && npx playwright test tests/e2e/settings-company.spec.ts` — the new EU-trade toggle test passes alongside the existing three.
4. **Visual-regression risk (read before running `pnpm test:e2e:visual`):** `buildTaxTimeline` now unconditionally emits one `income-tax-return` row per nearby fiscal year, regardless of `vatPeriod`. Per `docs/findings.md`'s 2026-08-06 entry, the demo/E2E seed uses the REAL system clock (no frozen "today"), so whether an INK2 deadline lands inside the tax-timeline widget's (top-3) or reports-screen row's (top-5) visible window depends on the day the suite runs — this was already true for `annual-report` before this phase and is a pre-existing, documented limitation (not something Phase F introduces or is expected to fully solve). If `pnpm test:e2e:visual` shows diffs on the dashboard or reports screen after landing this phase, they are very likely a new/shifted deadline row, not a real regression — review the diff images and re-baseline with `pnpm test:e2e:visual:update` per `scripts/visual-baselines.md` if so.
5. Spot-check the reports screen and `/today` dashboard manually (`pnpm dev`) with a workspace profile set to `vatPeriod: "yearly"` once with `euTrade` on and once off, confirming the yearly VAT deadline date changes and the INK2 row's label reads "Inkomstdeklaration 2" / "Income tax return (INK2)".

---

## Deviations from the master interface contract

None on the modeled surface — `taxDeadlineKindSchema`, `workspaceProfileSchema.euTrade`, and the calendar branch dates all match the master's Cross-phase interface contract (line 47–48, 59) exactly, verified against the underlying `docs/findings.md` date tables via the standalone date-arithmetic simulation run during planning (see "Verification math" in Task 2).

One **elaboration beyond the literal phase brief**: Task 4's "digital-filing-still-voluntary status" ask is stated in the corpus fix as a _transition_, not a static fact — live web verification during planning (two independent sources, 2026-08-20) found digital iXBRL filing becomes mandatory for fiscal years beginning after 2025-12-31 (first mandatory filings ~summer 2027). Stating only "still voluntary" would itself have become stale advice almost immediately, and would have been directly wrong for JPx's own FY2 (starts 2026-09-01, after the cutover). This is a deliberate accuracy upgrade, not a scope change.

## Current-code facts that contradict the readiness spec / findings.md

1. `docs/findings.md`'s 2026-08-20 entry describes the calendar.ts bug purely in terms of _dates computed_. It does not mention that `TAX_DEADLINE_SOURCES["sv-vat-yearly-26"]`'s citation STRING carries the identical inverted claim ("för helt beskattningsår utan EU-handel"). Left unfixed, correcting only the date-computation logic would have produced a self-contradictory citation (a row computed under the `euTrade: true` branch citing a source that says "utan EU-handel"). Fixed in Task 2 as a necessary consequence of the master's Task 2b instruction, not a separate scope item.
2. `packages/contracts/src/index.ts`'s `workspaceProfileSchema` currently has neither `euTrade` nor `firstFiscalYearStart` (grep-confirmed 2026-08-20, before this phase's Task 1 lands) — the master's phrasing ("may already be added by Phase B/D") does not hold in the current `main` snapshot this plan was written against. Task 1's defensive grep-then-add step handles either ordering.
3. No dedicated `tests/unit/tax-calendar.test.ts` file exists — the actual file is `tests/unit/tax-timeline.test.ts`. All run commands in this plan use the real filename.
