# Phase 2 — Platform seams: detailed execution plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox syntax for tracking. Verification vocabulary: `CHECK` = `pnpm check`; `E2E` = `pnpm test:e2e`; `E2E:file <f>` = `pnpm build:e2e && npx playwright test tests/e2e/<f>`.

**Baseline verified against branch `feat/advisory-pivot` on 2026-07-03** (Phases 0–1 landed: dark mode mounted in `layout.tsx`, `theme-toggle.tsx` exists, visual-regression + dark-mode + palette-deeplink + books-drilldown specs exist, migrations run 0001–0004).

## Findings that correct the scope description (read before executing)

1. **Settings are ORG-level, not workspace-level.** They live in `ledger.organization_settings` (one row per `organization_id`, `settings jsonb`, migration `0004`), surfaced via `companySettingsSchema` (`packages/contracts/src/index.ts:315`) and `LedgerStore.getCompanySettings/putCompanySettings`. There is no workspace-settings table or contract. Decision: the profile lands as a nested `profile` object on `companySettingsSchema` (one workspace per org today — `workspace_main`); moving it to a real workspace scope is deferred to when multi-workspace lands. Every task below says "company settings", meaning this org-level seam.
2. **No Postgres migration is needed.** `settings` is `jsonb`; new keys need no columns (CONVENTIONS Rule 1 satisfied by inspection — traced both write paths: `putCompanySettings` upserts the whole jsonb blob; no per-field columns). Legacy rows lacking `profile` are normalized on read via Zod defaults (Task 2.1). The next migration number (`0005`) stays free for Phase 3's `0005_extraction.sql`.
3. **`<html lang="sv">` today while all copy is English** (`apps/web/app/layout.tsx:67`). It becomes dynamic via next-intl; default message locale is **`en`** (the source catalog). Consequence and deliberate decision: out of the box the UI stays English (keeps every E2E copy assertion — `home.spec.ts` "Camera draft saved", etc. — and all visual baselines green) while **formatting** defaults to `sv-SE` (identical to today's hardcoded behavior). Saving a profile with locale `sv-SE` flips UI copy to Swedish via cookie. This intentionally softens "Sweden defaults sv-SE" for the _message_ locale only; the profile field itself still defaults `sv-SE`.
4. **Money cells currently use `tabular-nums` on Manrope (sans), not mono.** Spec §2.9 mandates tabular _mono_ via a `Money` component — this is an intentional visual change on Today/Books/Reports money cells → visual re-baseline in 2.7 with reviewed diffs.
5. **`buildVat` output-side is absent entirely** (`packages/domain/src/projections.ts:49` only recognizes input VAT via `=== "2641"`), and `vatCode` strings carry deductibility as name suffixes (`VAT25-LIMITED`, `VAT12-LIMITED` in `bas.ts`). Retiring the suffixes changes the `vatCode` chip text on review cards for 6071/5610 suggestions — the seeded demo review is 6540/`VAT25`, so baselines are unaffected. Historical event payloads containing old codes are **not** rewritten (append-only); `buildVat` groups by string so old and new codes coexist harmlessly.
6. **Voucher `currency` stays hardcoded `"SEK"`** in both stores' `createEvidence` (`packages/domain/src/store.ts:250`, `packages/persistence-postgres/src/store.ts:459`) and in `voucherFieldSchema`'s default. Multi-currency vouchers are out of scope (spec §6); noted as a known literal for a later phase. Display currency comes from the workspace profile regardless.
7. **There is no settings E2E today** — only visual-regression screenshots `/settings/company`. Task 2.2 adds the first functional one.
8. **`EMPTY_COMPANY_SETTINGS.organizationId === "org_default"`** in `company-form.tsx` vs server default `org_jpx` — pre-existing quirk, left as-is (server ignores the field for scoping).
9. next-intl "without i18n routing" setup verified against next-intl docs (2026-07-03): `i18n/request.ts` + `getRequestConfig` reading a cookie, `createNextIntlPlugin` in `next.config.ts`, `NextIntlClientProvider` in the root layout, manual `<html lang={await getLocale()}>`. No URL prefixes; fully compatible with `NuqsAdapter` (both are plain providers).

## Invariants honored throughout

- Append-only events untouched: no event schema change, no payload rewrite, no new event types in this phase.
- Store parity: every `LedgerStore`-behavior change lands in `MemoryLedgerStore` + `PostgresLedgerStore` (+ `UnavailableLedgerStore` compiles unchanged — no interface signature changes in this phase) in the same commit, with parity assertions (Rules 6, 11).
- No existing `data-testid` is renamed or removed.
- Every task ends `CHECK` green; E2E at the exit gate and after each web-facing task.

## Task dependency graph

```
Track A (web/contract):  2.1 → 2.2 → 2.3 → 2.4
Track B (domain):        2.5 → 2.6
2.1 ∥ 2.5 (fully independent packages until 2.7)   [NB: 2.5 imports CountryCode from contracts → 2.1 lands first in this execution]
2.7 (exit gate) joins both tracks
```

Within Track A, 2.3 and 2.4 both edit `review-card.tsx`/`app-shell.tsx` — keep them sequential to avoid conflicts. Track B never touches `apps/web`.

---

## Task 2.1 — Workspace profile on the settings contract + both stores (atomic)

**Files — Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/store.ts` (Memory settings methods only), `packages/persistence-postgres/src/store.ts` (settings methods only), `apps/web/components/settings/company-form.tsx` (only the `EMPTY_COMPANY_SETTINGS` constant — keeps typecheck green), `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`. **Create:** `packages/contracts/src/countries.ts`, `tests/unit/contracts-settings.test.ts`.

- [ ] `packages/contracts/src/countries.ts` — per-country validation registry (Sweden is an _entry_, not a schema hardcode):

  ```ts
  export const countryCodeSchema = z.enum(["SE"]); // widen per country as populated
  export type CountryCode = z.infer<typeof countryCodeSchema>;

  export type CountryValidationRule = {
    organizationNumber: { pattern: RegExp; message: string; example: string };
    postalCode: { pattern: RegExp; message: string; example: string };
  };

  export const countryValidationRegistry: Record<CountryCode, CountryValidationRule> = {
    SE: {
      organizationNumber: {
        pattern: /^\d{6}-\d{4}$/,
        message: "Swedish org number format is XXXXXX-XXXX",
        example: "556677-8899",
      },
      postalCode: { pattern: /^\d{3}\s?\d{2}$/, message: "Swedish postal code format is XXX XX", example: "111 22" },
    },
  };
  ```

- [ ] In `packages/contracts/src/index.ts`:

  ```ts
  export const workspaceProfileSchema = z.object({
    country: countryCodeSchema.default("SE"),
    locale: z.string().min(2).default("sv-SE"), // BCP-47; drives Intl + message catalog
    currency: z.string().length(3).default("SEK"), // ISO-4217
    fiscalYearStart: z
      .string()
      .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      .default("01-01"), // MM-DD
  });
  export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;
  export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = workspaceProfileSchema.parse({});
  ```

  `companySettingsSchema`: add `profile: workspaceProfileSchema.default(DEFAULT_WORKSPACE_PROFILE)`; replace the two hardcoded `.regex(...)` on `organizationNumber`/`postalCode` with `z.string().min(1)` + a schema-level `.superRefine((v, ctx) => ...)` that applies `countryValidationRegistry[v.profile.country]` and emits issues at paths `["organizationNumber"]` / `["postalCode"]` (RHF field errors keep working). Export `* from "./countries"`. Note: spec §4.2 says `fiscalYear`; the field is named **`fiscalYearStart`** per the master-plan 2.1 wording.

- [ ] Both stores normalize through the schema so legacy data and demo-fallback writes behave identically (Rule 11):
  - `MemoryLedgerStore.putCompanySettings`: `this.companySettings = companySettingsSchema.parse(input)`; `getCompanySettings` unchanged clone-return.
  - `PostgresLedgerStore.getCompanySettings`: return `rows[0] ? companySettingsSchema.parse(rows[0].settings) : null` (fills `profile` defaults for pre-profile jsonb rows). `putCompanySettings`: parse input before the jsonb upsert; return the parsed value.
  - `UnavailableLedgerStore`: no change (no interface change).
- [ ] `apps/web/components/settings/company-form.tsx`: extend `EMPTY_COMPANY_SETTINGS` with `profile: DEFAULT_WORKSPACE_PROFILE` (constant only; UI fields come in 2.2).
- [ ] Rule 5 sweep (done at plan time, re-verify): `companySettingsSchema` referenced in `services/api/src/app.ts:444` (PUT parse — no change needed, defaults absorb old payloads), `company-form.tsx`, `tests/unit/ledger-store.test.ts:101`, `tests/integration/postgres-ledger.test.ts:172`. No E2E spec posts settings today. Update the two test fixtures to include/expect `profile`.
- [ ] Tests:
  - `tests/unit/contracts-settings.test.ts` (new): legacy payload without `profile` parses to Sweden defaults; invalid SE orgnr yields issue at path `organizationNumber`; `fiscalYearStart: "13-01"` rejected; `DEFAULT_WORKSPACE_PROFILE` equals `{country:"SE",locale:"sv-SE",currency:"SEK",fiscalYearStart:"01-01"}`.
  - `tests/unit/ledger-store.test.ts`: round-trip saves + reads `profile` (e.g. `currency:"EUR"`), and a legacy-shaped input (no profile) reads back with defaults.
  - `tests/integration/postgres-ledger.test.ts`: same round-trip on Postgres, plus a legacy-row test: raw `INSERT INTO ledger.organization_settings ... settings = '{...no profile...}'` → `getCompanySettings()` returns defaults (guards the jsonb-normalization path; Rule 2 — run with `SUPABASE_DB_URL` or document in PR).
- [ ] `CHECK`. Commit: `feat(contracts): workspace profile (country/locale/currency/fiscalYearStart) with per-country validation registry; both stores normalize`.

## Task 2.2 — Company form UI for the profile + first settings E2E

**Depends on 2.1.** **Files — Modify:** `apps/web/components/settings/company-form.tsx`. **Create:** `tests/e2e/settings-company.spec.ts`.

- [ ] Add a "Workspace profile" fieldset (RHF `FormField`s over the existing `ui/select.tsx`), field names `profile.country`, `profile.locale`, `profile.currency`, `profile.fiscalYearStart`:
  - country: options from `countryCodeSchema.options` (SE only today) — testid `company-profile-country`
  - locale: options `sv-SE` (Svenska), `en-GB` (English) — testid `company-profile-locale`
  - currency: options `SEK, EUR, NOK, DKK, GBP, USD` — testid `company-profile-currency`
  - fiscalYearStart: 12 options `01-01 … 12-01` labeled by month — testid `company-profile-fiscal-year-start`
  - Existing testids `company-form`, `company-form-submit` untouched.
- [ ] `tests/e2e/settings-company.spec.ts`: goto `/settings/company` → fill name/orgnr/address/postal/city/email + pick `currency=EUR`, `locale=en-GB` → submit → expect toast "Company settings saved." → `page.reload()` → expect persisted select values (demo API server holds MemoryLedgerStore state for the run). Add a negative case: orgnr `12345` → expect the SE registry message rendered by `FormMessage`. (Locale/currency _rendering_ assertions land in 2.3/2.4 extensions of this same spec.)
- [ ] Visual: `/settings/company` screenshot will diff (form grew) — re-baseline deliberately in 2.7, not here.
- [ ] `CHECK` + `E2E:file settings-company.spec.ts`. Commit: `feat(settings): company form captures workspace profile; settings E2E`.

## Task 2.3 — `Money` component + locale/currency-driven presentation

**Depends on 2.1 (profile shape). Can run in parallel with 2.2.** **Files — Create:** `apps/web/components/providers/workspace-profile-provider.tsx`, `apps/web/components/ui/money.tsx`. **Modify:** `apps/web/lib/presentation.ts`, `apps/web/app/layout.tsx` (mount provider inside `QueryProvider`), `tests/unit/presentation.test.ts`, and every `formatMoney`/locale-literal call site listed below.

- [ ] `presentation.ts` — pure, locale-parameterized (keep `APP_THEME_COLOR`/`APP_BACKGROUND_COLOR` and `formatRuntimeModeLabel`; delete the module-level `sv-SE` `Intl` singletons):

  ```ts
  export type MoneyFormatProfile = Pick<WorkspaceProfile, "locale" | "currency">;
  export function formatMoney(value: number | undefined, profile: MoneyFormatProfile): string; // Intl.NumberFormat(locale, { style:"currency", currency, currencyDisplay:"code" }) — sv-SE/SEK renders "1 249,80 SEK", byte-identical intent to today
  export function formatShortDate(value: string | undefined, locale: string, fallback?: string): string;
  export function formatPercent(value: number, locale: string, fractionDigits?: number): string;
  ```

  Memoize `Intl` instances in a `Map` keyed `` `${locale}|${currency}` ``.

- [ ] `workspace-profile-provider.tsx`: client component; `useQuery({ queryKey: ["company-settings"], queryFn: () => apiClient.getCompanySettings() })`; context value = `settings?.profile ?? DEFAULT_WORKSPACE_PROFILE`; export `useWorkspaceProfile(): WorkspaceProfile`. Same query key as the form → saving invalidates/updates rendering live via `queryClient.setQueryData`.
- [ ] `money.tsx`: `export function Money({ value, className }: { value: number | undefined; className?: string })` → `useWorkspaceProfile()` + `formatMoney`, rendering `<span className={cn("font-mono tabular-nums", className)}>` (the spec's signature tabular-mono; **intentional visual change**, re-baseline in 2.7).
- [ ] Convert **every** product `formatMoney` call site to `<Money …>` (exact list, verified by grep):
  - `apps/web/components/books/trial-balance-view.tsx:55,60,64`
  - `apps/web/components/books/suppliers-view.tsx:70`
  - `apps/web/components/books/general-ledger-view.tsx:72,80`
  - `apps/web/components/books/journal-view.tsx:84,85`
  - `apps/web/components/today/review-card.tsx:93,97` (+ its `formatShortDate`/`formatPercent` calls take `useWorkspaceProfile().locale`)
  - `apps/web/components/screens/reports-screen.tsx:144,145,165,170,174,189,190`
- [ ] Kill the remaining `sv-SE` literals outside presentation plumbing:
  - `apps/web/components/app-shell.tsx:71` (topbar timestamp) → profile locale via hook
  - `apps/web/hooks/use-period-scope.ts:17` and `apps/web/components/books/period-selector.tsx:12` (period labels) → accept/use profile locale
  - `apps/web/components/screens/settings-about-screen.tsx:69` → profile locale
- [ ] `tests/unit/presentation.test.ts` — parameterized matrix (NBSP-normalized like today): (`sv-SE`,`SEK`,1249.8) → `"1 249,80 SEK"`; (`sv-SE`,`SEK`,0) → `"0,00 SEK"`; (`en-GB`,`EUR`,1249.8) → `"EUR 1,249.80"`; short-date and percent per locale. (No React render infra in `tsx --test` — `Money` itself is covered by the E2E below.)
- [ ] Extend `tests/e2e/settings-company.spec.ts`: after saving `currency=EUR, locale=en-GB`, goto `/today` → expect a `review-card` gross cell to match `/EUR/`; goto `/books` trial balance → same. This is the exit-gate proof "a currency/locale change reflects in rendered amounts".
- [ ] `CHECK` + `E2E:file settings-company.spec.ts` + confirm existing visual specs: Today/Books/Reports will diff only by the mono font on money cells — defer re-baseline to 2.7. Commit: `feat(web): Money component + workspace-profile-driven formatting; sv-SE/SEK literals removed`.

## Task 2.4 — next-intl without i18n routing (en source + sv catalog)

**Depends on 2.2 (cookie write on save) and 2.3 (shared files).** **Files — Create:** `apps/web/i18n/request.ts`, `apps/web/messages/en.json`, `apps/web/messages/sv.json`, `apps/web/lib/message-locale.ts`. **Modify:** `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/package.json` (add `next-intl`), `apps/web/components/settings/company-form.tsx` (cookie on save), plus the copy-migration files listed below.

- [ ] Install `next-intl` (latest v4). `next.config.ts`: `const withNextIntl = createNextIntlPlugin("./i18n/request.ts"); export default withNextIntl(nextConfig);` — verify `pnpm build` (Next 16.2 / Turbopack / `output: "standalone"`) still succeeds; this is the task's first checkpoint.
- [ ] `apps/web/lib/message-locale.ts`: `export function messagesLocale(profileLocale: string | undefined): "en" | "sv" { return profileLocale?.toLowerCase().startsWith("sv") ? "sv" : "en"; }`
- [ ] `apps/web/i18n/request.ts`:

  ```ts
  export default getRequestConfig(async () => {
    const locale = (await cookies()).get("NEXT_LOCALE")?.value === "sv" ? "sv" : "en";
    return { locale, messages: (await import(`../messages/${locale}.json`)).default };
  });
  ```

  No URL prefixes, no middleware — single-locale-per-workspace, cookie/settings-driven (verified against next-intl "App Router without i18n routing" docs).

- [ ] `layout.tsx`: make `RootLayout` async; `const locale = await getLocale();` → `<html lang={locale} …>` (fixes today's `lang="sv"`-with-English-copy mismatch); wrap children in `<NextIntlClientProvider>` directly inside `ThemeProvider` (order vs `QueryProvider`/`NuqsAdapter` is irrelevant — all plain providers); "Skip to content" via `getTranslations("common")`.
- [ ] `company-form.tsx` on mutation success: `` document.cookie = `NEXT_LOCALE=${messagesLocale(saved.profile.locale)}; path=/; max-age=31536000` `` + `router.refresh()`.
- [ ] Catalogs: namespaces `common`, `shell`, `palette`, `today`, `capture`. **`en.json` values are the current literals verbatim** (zero visual/E2E diff by construction). `sv.json` fully translated. Migrate copy in exactly these files (`useTranslations` in client components):
  - `apps/web/components/app-shell.tsx` — nav labels/summaries array, marketing blocks, capture-lane card, capture sheet, draft modes, `buildCaptureStatusMessage` strings, demo banners, "Today's pulse"
  - `apps/web/components/command-palette.tsx` — placeholder, "Ask advisor", "No matches", esc hint
  - `apps/web/components/theme-toggle.tsx` — labels
  - `apps/web/components/screens/today-screen.tsx` + `apps/web/components/today/review-card.tsx`, `review-card-actions.tsx`, `review-filters.tsx` — headers, metric labels, empty states, action labels, "Edit will be available…" toast
  - `apps/web/components/screens/capture-screen.tsx` + `apps/web/components/capture/quick-add-grid.tsx`, `drafts-table.tsx`, `evidence-archive-table.tsx`
- [ ] **Explicitly NOT migrated (keep literals; later phases):** `books/*` views (Phase 4 rework), `screens/reports-screen.tsx` (Phase 4), `screens/assistant-screen.tsx` (Phase 5), `digest/digest-panel.tsx` (Phase 5), `screens/evidence-detail-screen.tsx` (Phase 3), all `settings/*` screens except the company form's own labels (Phase 6), `ui/unavailable-state.tsx` defaults, `layout.tsx` metadata (SEO copy, Phase 6).
- [ ] Extend `tests/e2e/settings-company.spec.ts`: save profile with `locale=sv-SE` → expect `html[lang="sv"]` and one Swedish shell string (e.g. nav label `Böcker`); fresh-context specs stay English (cookie absent), so all existing copy assertions remain green.
- [ ] `CHECK` + full `E2E` (both projects). Commit: `feat(i18n): next-intl without routing; en source + sv catalog; shell/palette/today/capture migrated; dynamic html lang`.

## Task 2.5 — CoA registry in `packages/domain` (Track B; parallel with 2.2–2.4, AFTER 2.1)

**Files — Create:** `packages/domain/src/coa/types.ts`, `packages/domain/src/coa/bas-2026.ts`, `packages/domain/src/coa/registry.ts`, `tests/unit/coa-registry.test.ts`. **Modify:** `packages/domain/src/index.ts` (export `./coa`, drop `./bas`), `packages/domain/src/rules.ts`, `packages/domain/src/store.ts` (`buildPostingLines`), `packages/domain/src/evidence-defaults.ts` (`initialLedgerLines`). **Delete:** `packages/domain/src/bas.ts` (only consumer is `rules.ts`; verified no web/persistence imports of `basAccounts`/`findBasAccount`).

- [ ] `coa/types.ts`:

  ```ts
  export type VatCodeId = "VAT25" | "VAT12" | "VAT6" | "VAT0" | "NA" | "VAT-REVIEW";
  export type CoaAccountClass =
    | "asset"
    | "equity-liability"
    | "revenue"
    | "materials"
    | "external-cost"
    | "personnel"
    | "financial";
  export type CoaAccount = {
    number: string;
    name: string;
    nameEn?: string;
    accountClass: CoaAccountClass;
    defaultVatCode: VatCodeId;
    deductibilityRuleId?: string;
  };
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
  };
  export type CoaTemplate = {
    id: string;
    country: CountryCode;
    name: string;
    accounts: CoaAccount[];
    roles: CoaRoleMap;
  };
  ```

- [ ] `coa/registry.ts`: `export const coaTemplates: CoaTemplate[]`, `export function getCoaTemplate(country: CountryCode, templateId = "bas-2026"): CoaTemplate` (throws on unknown), `export const defaultCoaTemplate = bas2026`, `export function findCoaAccount(template: CoaTemplate, number: string): CoaAccount | undefined`.
- [ ] `coa/bas-2026.ts` — `export const bas2026: CoaTemplate` with `roles = { bank:"1930", cash:"1910", accountsReceivable:"1510", accountsPayable:"2440", inputVat:"2641", outputVatByRate:{VAT25:"2610",VAT12:"2620",VAT6:"2630"}, vatSettlement:"2650", fallbackExpense:"6991", rounding:"3740" }` and this 68-account Swedish SMB subset (BAS 2026 numbers/names; `defaultVatCode` shown where not `NA`):
  - **1xxx assets:** 1110 Byggnader · 1220 Inventarier och verktyg · 1250 Datorer · 1510 Kundfordringar · 1630 Avräkning för skatter och avgifter (skattekonto) · 1650 Momsfordran · 1790 Övriga förutbetalda kostnader och upplupna intäkter · 1910 Kassa · 1930 Företagskonto
  - **2xxx equity/liabilities:** 2081 Aktiekapital · 2091 Balanserad vinst eller förlust · 2099 Årets resultat · 2440 Leverantörsskulder · 2510 Skatteskulder · 2610 Utgående moms 25 % · 2620 Utgående moms 12 % · 2630 Utgående moms 6 % · 2640 Ingående moms · 2641 Debiterad ingående moms · 2650 Redovisningskonto för moms · 2710 Personalskatt · 2731 Avräkning lagstadgade sociala avgifter · 2890 Övriga kortfristiga skulder · 2990 Övriga upplupna kostnader och förutbetalda intäkter
  - **3xxx revenue:** 3001 Försäljning inom Sverige 25 % (VAT25) · 3002 Försäljning inom Sverige 12 % (VAT12) · 3003 Försäljning inom Sverige 6 % (VAT6) · 3004 Försäljning inom Sverige, momsfri (VAT0) · 3308 Försäljning tjänster till annat EU-land (VAT0, reverse charge) · 3740 Öres- och kronutjämning
  - **4xxx materials/goods:** 4000 Inköp av varor från Sverige (VAT25) · 4515 Inköp av varor från annat EU-land 25 % (VAT25) · 4535 Inköp av tjänster från annat EU-land 25 % (VAT25) · 4990 Förändring av lager
  - **5xxx–6xxx external costs:** 5010 Lokalhyra (VAT25) · 5410 Förbrukningsinventarier (VAT25) · 5460 Förbrukningsmaterial (VAT25) · 5610 Personbilskostnader (VAT25, `deductibilityRuleId:"passenger-car"`) · 5615 Leasing av personbilar (VAT25, `passenger-car`) · 5800 Resekostnader (VAT6) · 5831 Kost och logi i Sverige (VAT12) · 5910 Annonsering (VAT25) · 6071 Representation, avdragsgill (VAT12, `representation-meal`) · 6072 Representation, ej avdragsgill (NA, `representation-meal`) · 6110 Kontorsmateriel (VAT25) · 6212 Mobiltelefon (VAT25) · 6230 Datakommunikation (VAT25) · 6250 Postbefordran (VAT25) · 6310 Företagsförsäkringar (VAT0) · 6420 Ersättningar till revisor (VAT25) · 6530 Redovisningstjänster (VAT25) · 6540 IT-tjänster (VAT25) · 6550 Konsultarvoden (VAT25) · 6570 Bankkostnader (VAT0) · 6970 Tidningar, tidskrifter och facklitteratur (VAT6) · 6991 Övriga externa kostnader, avdragsgilla (VAT25) · 6992 Övriga externa kostnader, ej avdragsgilla (NA)
  - **7xxx personnel/depreciation:** 7210 Löner till tjänstemän · 7220 Löner till företagsledare · 7331 Skattefria bilersättningar · 7510 Arbetsgivaravgifter · 7690 Övriga personalkostnader · 7832 Avskrivningar på inventarier och verktyg · 7835 Avskrivningar på datorer
  - **8xxx financial/result:** 8310 Ränteintäkter från omsättningstillgångar · 8410 Räntekostnader för långfristiga skulder · 8910 Skatt som belastar årets resultat · 8999 Årets resultat
  - Note: `-LIMITED` vat codes are **retired**; deductibility moves to data (`deductibilityRuleId`, rules defined in 2.6). `2641`'s old `"VAT-INPUT"` code disappears with `bas.ts` — input-VAT identity now lives in `roles.inputVat`/regime data.
- [ ] Rewire every hardcoded account literal (complete inventory from grep):
  - `packages/domain/src/store.ts:77` `buildPostingLines(voucher, suggestion, action, occurredAt, coa: CoaTemplate = defaultCoaTemplate)` — `"2641"/"Debiterad ingående moms"` → `coa.roles.inputVat` + `findCoaAccount(...).name`; `"1930"/"Företagskonto"` → `coa.roles.bank`. Default param keeps `packages/persistence-postgres/src/store.ts:952` and `simulation.ts:30` call sites compiling unchanged (atomicity, Rule 6).
  - `packages/domain/src/rules.ts:93-111` — replace `basAccounts` map with `defaultCoaTemplate` accounts; `"6991"` fallback → `coa.roles.fallbackExpense`; keyword heuristics (6110/5610/6540/6071/5460) keep their targets but resolve via `findCoaAccount` (all present in bas-2026).
  - `packages/domain/src/evidence-defaults.ts:48-85` `initialLedgerLines()` — 6540/2641/1930 numbers+names via registry.
  - (`projections.ts:61` and `simulation.ts:37` `"2641"` sites are rewired in 2.6 with the regime.)
- [ ] `tests/unit/coa-registry.test.ts`: unique account numbers; every `roles` value resolves via `findCoaAccount`; account class matches number range (1xxx→asset … 8xxx→financial); every `outputVatByRate`/`inputVat` account exists; `getCoaTemplate("SE")` returns bas-2026; snapshot count = 68. Existing `simulation.test.ts` / `ledger-store.test.ts` stay green unmodified (behavioral no-op — same numbers via roles).
- [ ] `CHECK`. Commit: `feat(domain): CoA registry (CoaTemplate, bas-2026 68-account SMB subset); posting/suggestion/seed literals eliminated`.

## Task 2.6 — VAT regime as data (rates, direction, boxes, deductibility)

**Depends on 2.5.** **Files — Create:** `packages/domain/src/vat/regime.ts`, `packages/domain/src/vat/boxes.ts`, `tests/unit/vat-regime.test.ts`. **Modify:** `packages/domain/src/projections.ts`, `packages/domain/src/simulation.ts`, `packages/domain/src/index.ts` (export `./vat/*`).

- [ ] `vat/regime.ts`:

  ```ts
  export type VatRateId = "VAT25" | "VAT12" | "VAT6" | "VAT0";
  export type VatDirection = "input" | "output";
  export type VatBoxKind = "sales-base" | "output-vat" | "purchase-base" | "input-vat" | "net";
  export type VatBoxDef = { box: string; label: string; kind: VatBoxKind; rate?: VatRateId };
  export type DeductibilityRule = {
    id: string;
    label: string;
    appliesToAccounts: string[];
    vatDeductionBaseCapSek?: number;
    perPerson?: boolean;
    vatDeductibleShare?: number;
    incomeTaxDeductible: boolean;
    source: string;
  };
  export type VatRegime = {
    country: CountryCode;
    rates: Record<VatRateId, { percent: 25 | 12 | 6 | 0 }>;
    accounts: {
      input: string[];
      outputByRate: Record<Exclude<VatRateId, "VAT0">, string>;
      settlement: string;
    };
    boxes: VatBoxDef[];
    deductibility: DeductibilityRule[];
  };
  export const swedishVatRegime: VatRegime; // accounts.input: ["2641","2640"]; outputByRate 2610/2620/2630; settlement 2650
  export function getVatRegime(country: CountryCode): VatRegime;
  ```

  Swedish box subset (standard momsdeklaration, bounded to current features): **05** Momspliktig försäljning (sales-base) · **10/11/12** Utgående moms 25/12/6 (output-vat) · **20** Inköp av varor från annat EU-land (purchase-base, modeled) · **21** Inköp av tjänster från annat EU-land (purchase-base, modeled) · **30/31/32** Utgående moms på inköp 25/12/6 (output-vat, modeled for reverse charge) · **48** Ingående moms att dra av (input-vat) · **49** Moms att betala eller få tillbaka (net). Deductibility data: `representation-meal` (VAT deduction base cap 300 SEK/person, meals; not income-tax deductible; source: Skatteverket representation guidance) and `passenger-car` (50 % VAT deduction on car leasing; source: Skatteverket) — **data only**, enforcement lands with the real rule engine later; `rules.ts` may cite them in reasoning text but must not change decisions in this phase.

- [ ] Rewire the remaining literal sites (purchase-side end-to-end):
  - `projections.ts:49` `buildVat(lines: LedgerLine[], regime: VatRegime = swedishVatRegime)` — input detection `regime.accounts.input.includes(line.accountNumber)` (replaces `=== "2641"`); **add output side**: if `line.accountNumber` is in `Object.values(regime.accounts.outputByRate)` → `vatAmount += line.credit - line.debit`. Default param keeps both stores' `getReports()` call sites compiling unchanged.
  - `simulation.ts:37` `simulateApprovals(reviews, suggestions, vouchers, action, coa = defaultCoaTemplate, regime = swedishVatRegime)` — `isVatLine` via `regime.accounts.input` (and pass `coa` through to `buildPostingLines`).
- [ ] `vat/boxes.ts`: `export function buildVatReturnBoxes(lines: LedgerLine[], regime: VatRegime = swedishVatRegime): Array<{ box: string; label: string; amount: number }>` — maps posted lines to the box subset (48 from input accounts, 05/10-12 from revenue+output accounts, 49 = output − input). **Domain-only in Phase 2**: no contract/`reportBundleSchema` change, no route, no UI — Phase 4's VAT report consumes it (this is the deliberate "sales-side modeled + domain-tested only" line; purchase-side is end-to-end already because the posting pipeline `buildPostingLines → buildVat → simulateApprovals` runs on regime data).
- [ ] `tests/unit/vat-regime.test.ts`: rate table exact (25/12/6/0); every regime account exists in bas-2026 (cross-registry integrity); `buildVat` with a synthetic purchase (6540 debit 1000 + 2641 debit 250 + 1930 credit 1250) reproduces today's output **byte-identically** (regression pin), and with a synthetic sale (1930 debit 1250 + 3001 credit 1000 + 2610 credit 250) yields output VAT 250; `buildVatReturnBoxes` golden case: one 25 % purchase + one 25 % sale → box 05 = 1000, box 10 = 250, box 48 = 250, box 49 = 0; deductibility rules resolve to existing accounts. Existing `tests/unit/simulation.test.ts`, `contracts-simulation.test.ts`, `compliance.test.ts` stay green (codes `VAT25`/`NA` unchanged).
- [ ] `CHECK`. Commit: `feat(domain): VAT regime as data (rates/direction/SE box mapping/deductibility); buildVat+simulateApprovals regime-driven; sales side modeled`.

## Task 2.7 — Phase-2 exit gate

- [ ] Full `CHECK` + full `E2E` (both projects). Re-baseline visual-regression deliberately (review report diff images first): expected diffs are `/settings/company` (new fieldset) and money cells on Today/Books/Reports (mono font). Any other diff is a bug.
- [ ] Grep gates (zero hits expected):
  - `grep -rn "sv-SE" apps/web --include=*.ts*` → only inside `messages/`, `i18n/`, provider defaults re-exported from contracts
  - `grep -rn "' SEK'\|\` SEK\`" apps/web --include=_.ts_` → zero
  - `grep -rn "\"2641\"\|\"1930\"\|\"6991\"\|\"2610\"" packages/domain/src --include=*.ts` → only inside `coa/bas-2026.ts` and `vat/regime.ts`
- [ ] Parity proof inventory (the exit-gate definition):
  - Unit (Memory): `ledger-store.test.ts` profile round-trip + legacy normalization; `contracts-settings.test.ts`; `presentation.test.ts` locale matrix; `coa-registry.test.ts`; `vat-regime.test.ts`
  - Integration (Postgres, `SUPABASE_DB_URL`): `postgres-ledger.test.ts` profile round-trip + legacy jsonb-row normalization — run it or record the manual SQL smoke in the PR (Rules 2, 14)
  - E2E: `settings-company.spec.ts` — form saves + persists profile; currency/locale change reflects in rendered amounts on Today + Books; sv locale flips `html[lang]` + one shell string
- [ ] Update `docs/DEV_STATUS.md` (Phase 2 complete) and append a CONVENTIONS note if any new recurring pattern surfaced. Commit: `chore: phase 2 exit — platform seams (profile, i18n, CoA registry, VAT regime) regression-locked`.

---

### Critical Files for Implementation

- `packages/contracts/src/index.ts` — profile schema + per-country validation seam (line 315)
- `packages/domain/src/store.ts` — `buildPostingLines` + `MemoryLedgerStore` settings/posting paths
- `packages/persistence-postgres/src/store.ts` — jsonb settings normalization + posting parity
- `apps/web/lib/presentation.ts` — the hardcoded `sv-SE`/`SEK` formatter core every money surface consumes
- `apps/web/components/settings/company-form.tsx` — profile UI, cookie/locale switch trigger, E2E anchor
