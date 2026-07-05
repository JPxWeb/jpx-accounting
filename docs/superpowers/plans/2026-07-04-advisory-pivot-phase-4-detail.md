# Phase 4 — Reports that report: detailed execution plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox syntax for tracking. Verification vocabulary: `CHECK` = `pnpm check`; `E2E` = `pnpm test:e2e`; `E2E:file <f>` = `pnpm build:e2e && npx playwright test tests/e2e/<f>`; `INTEG` = `pnpm test:integration` with `SUPABASE_DB_URL` set (or documented manual smoke, Rules 2/14).

**Baseline verified against branch `feat/advisory-pivot` on 2026-07-04** (HEAD `5524545`, Phases 0–3 landed: CoA registry `bas-2026` with `accountClass` on every account + `roles` map, `swedishVatRegime` + `buildVatReturnBoxes` (domain-ready, zero consumers), `VoucherImported` replay in both stores' `getReports`, workspace profile with `fiscalYearStart`, `Money` component, next-intl en+sv with `common/shell/palette/today/evidence/capture` namespaces, nuqs `?period=YYYY-MM` in Books, migrations 0001–0004, 20 visual baselines light/dark).

**Recharts version verified 2026-07-04:** `recharts@3.9.1` is `latest` on npm — v3 confirmed as the locked chart lib.

## Findings that correct the scope description (read before executing)

1. **The web app never calls `/api/reports/*` today.** All four report routes (`journal`, `general-ledger`, `trial-balance`, `vat-prep`) exist but their only consumers are `tests/e2e/api.spec.ts` and the SIE export/MCP internals. Every screen reads `apiClient.getSnapshot()` and filters client-side. "Server-side period filtering" is therefore a **new consumption path**: `getReports()` gains an optional `range` (no-arg behavior byte-identical), and Books/Reports switch to the parameterized endpoints. The snapshot's embedded `reports` stays unfiltered — Today's cards and existing pins keep working.
2. **`api.spec.ts` journal-shape pins survive by construction.** The `toHaveLength(3)` / `toHaveLength(6)` pins hit `/api/reports/journal` with **no query params** → unfiltered default → untouched.
3. **The two period systems confirmed — and the Books one has a live UTC bug.** Reports uses local `useState<ReportPeriodPreset>` + `apps/web/lib/report-period.ts` (correct local calendar parts). Books' `use-period-scope.ts` `parsePeriod` does `new Date(y, m-1, 1).toISOString().slice(0,10)` — in Stockholm, period `2026-07` currently spans `2026-06-30 … 2026-07-30`; last-day entries leak between months. The unified resolver (4.1) formats from local calendar parts; `report-period.ts` and `parsePeriod` are deleted. `CLAUDE.md:85` documents the old helpers → truth-pass in the exit gate.
4. **No voucher route exists.** The drill grammar terminates honestly at evidence, **no new voucher route this phase**: journal line → account drawer → per-line voucher chip that (a) links to `/capture/evidence/<id>` when voucherId resolves via snapshot vouchers+packets, (b) renders text + "Imported" badge for `sie_*` ids, (c) plain muted text otherwise (e.g. `voucher_seed_1`).
5. **The voucher→evidence join is impossible client-side today**: the snapshot has no packets. Fix: `workspaceSnapshotSchema` += `packets: z.array(evidencePacketSchema).default([])`; Memory returns its map values; Postgres selects `ledger.evidence_packets` + items. Rule 5 sweep: all consumers additive-safe.
6. **`buildVatReturnBoxes` never reads `line.vatCode`/`deductible`** — it classifies via regime accounts + CoA data. It consumes the same `LedgerLine[]` both stores already assemble. The old per-vatCode cards are replaced by the momsdeklaration box table; `buildVat` stays untouched.
7. **SIE imports can post accounts outside the 68-account template.** Statements classify via template lookup **with a number-range fallback**: new `classifyAccountNumber()` in `coa/registry.ts`.
8. **Demo seed dates are E2E-deterministic**: seed + approvals use `nowIso()` → current month (default period). The api.spec SIE fixture is pinned `20260315` → permanent out-of-default-period fixture. Seed-only reconciliation numbers (post-reset, current month): P&L result −1 000, cash closing −1 250, box 48 = 250, box 49 = −250, BS balanced.
9. **Recharts is not installed; no chart primitives exist.** `--chart-1..5` tokens exist in both themes. All charts are `"use client"` loaded via `next/dynamic({ ssr: false })` from the already-client reports screen — no SSR issues, ~100 kB chunk confined to the reports route. `isAnimationActive={false}` everywhere. SVG `fill="var(--chart-1)"` props don't trip the class-based lint bans.
10. **Narrative reconciliation by construction**: one `ReportPack` fetched once; tables render pack values; narrative facts are a pure function of the same pack (`packages/reporting` depends only on contracts — pack schema lives in contracts to avoid a domain↔reporting cycle; stores compose packs). E2E asserts prose text equals table text as a tripwire.
11. **`fiscalYearStart` is consumed only by the SIE serializer today.** Client resolves `?period=` with `useWorkspaceProfile().fiscalYearStart`; the pack route resolves server-side from `getCompanySettings()` — one resolver used by both.
12. **i18n for `books` + `reports` was deferred in Phase 2** — migrates now. `en.json` verbatim where copy survives; `sv.json` fully translated.
13. **No print CSS exists.** Tailwind `print:` variant is available — shell chrome gets `print:hidden` (screen-inert → non-reports baselines stay byte-stable).
14. **Testids that die with the rewrite**: `report-period` and `journal-summary` (only consumer: `reports.spec.ts`, rewritten here). `alerts-panel`, `export-sie`, `trial-balance`, `vat-preparation` are kept. `capture-loop.spec.ts` asserts Books journal by row text — the voucher cell keeps identical text and only gains a link wrapper.
15. **No migration needed** (read-model-only phase). `0005` stays free.

## Invariants honored throughout

- **Append-only untouched**: NO events, NO new event types. Everything derived.
- **Store parity (Rules 6, 11)**: `getReports(range?)` + `getReportPack` + snapshot `packets` land in Memory + Postgres + Unavailable in one commit, with pack parity assertions.
- **Rule 16**: `InvalidPeriodTokenError` + invalid from/to → 422 via explicit branches.
- **One source object**: every number in prose, KPI, chart, and table renders from the same fetched `ReportPack`.
- Demo fully offline: `getJournal`/`getTrialBalance`/`getReportPack` get `fallbackStore` paths.
- No testid renames except finding 14. Every task ends `CHECK` green.

## Task dependency graph

```
Track S (shared, SEQUENTIAL): 4.1 (period model) → 4.2 (statements + pack + contracts) → 4.3 (stores + routes + api-client)
Track R: 4.4 (narrative facts) — after 4.2, parallel with 4.3
Track W: 4.5 (one period system + Books) — after 4.3
         4.6 (reports screen v2) — after 4.3 + 4.4 + 4.5
         4.7 (Recharts kit) — after 4.6
         4.8 (drill grammar) — after 4.7
         4.9 (print) — after 4.8
4.10 (exit gate) joins everything.
```

---

## Task 4.1 — Unified period model in domain

**Files — Create:** `packages/domain/src/reports/period.ts`, `tests/unit/report-period.test.ts`. **Modify:** `packages/domain/src/index.ts`, `packages/domain/src/projections.ts` (add `filterLedgerLines`).

- [ ] `reports/period.ts`:

  ```ts
  export type PeriodKind = "month" | "quarter" | "fiscal-year" | "ytd" | "all";
  export type ResolvedPeriod = {
    token: string;
    kind: PeriodKind;
    from: string; // YYYY-MM-DD inclusive
    to: string; // YYYY-MM-DD inclusive
    previous?: { from: string; to: string };
  };
  export class InvalidPeriodTokenError extends Error {}
  export function resolvePeriodToken(token: string, opts: { fiscalYearStart: string; today?: string }): ResolvedPeriod;
  export function currentMonthToken(today?: string): string; // "YYYY-MM"
  ```

  Token grammar: `YYYY-MM` (calendar month, default) · `YYYY-QN` (fiscal quarter of the fiscal year starting YYYY, windows from `fiscalYearStart` MM-DD) · `fy-YYYY` · `ytd` · `all` (sentinel `1900-01-01`…`2999-12-31`). `previous`: equal-kind preceding window; absent for `all`. Unknown → `InvalidPeriodTokenError`. **Date formatting from local calendar parts** (kills the Books month-edge bug). Day comparisons string-based on `bookedAt.slice(0,10)`.

- [ ] `projections.ts`: `export function filterLedgerLines(lines: LedgerLine[], range?: { from?: string; to?: string }): LedgerLine[]` — inclusive; no range returns input unchanged.
- [ ] Tests: month windows (leap Feb); fiscal quarters for `01-01`, `07-01`, `05-15` starts; ytd with injected today; previous windows; `all`; invalid throws; regression pin `2026-07` → `from === "2026-07-01"`; filter inclusivity both edges.
- [ ] `CHECK`. Commit: `feat(domain): unified period model — fiscal-aware period tokens resolve to day ranges (one resolver for web + API)`.

## Task 4.2 — Statements, cash bridge, monthly series, ReportPack

**Depends on 4.1.** **Files — Create:** `packages/domain/src/reports/statements.ts`, `packages/domain/src/reports/cash.ts`, `packages/domain/src/reports/pack.ts`, `tests/unit/report-statements.test.ts`, `tests/unit/report-pack.test.ts`. **Modify:** `packages/contracts/src/index.ts`, `packages/domain/src/coa/registry.ts` (add `classifyAccountNumber`), `packages/domain/src/index.ts`.

- [ ] Contracts (new schemas + types): `statementLineSchema` {accountNumber, accountName, amount} (P&L: credit−debit; BS assets: debit−credit; BS eq/liab: credit−debit); `statementGroupSchema` {key: enum[revenue, materials, externalCost, personnel, financial, assets, equityAndLiabilities], lines, total} (labels are client i18n keys — server ships keys); `profitLossStatementSchema` {period{from,to}, groups, operatingResult, financialNet, periodResult} (personnel includes 78xx depreciation per bas-2026 — documented); `balanceSheetStatementSchema` {asOf, assets, equityAndLiabilities, computedResult, balanced (±0.005)}; `vatReturnBoxSchema` {box, label, amount}; `cashBridgeSchema` {opening (19xx before from), drivers ≤4 {accountNumber, accountName, amount}, other {amount, accountNumbers}, closing} with invariant opening+Σdrivers+other = closing = 19xx balance at `to`; `monthlyPointSchema` {month, cashIn, cashOut, cashClosing, revenue, result}; `reportPeriodSchema`; `reportPackSchema` {period, previousPeriod?, profitLoss, previousProfitLoss?, balanceSheet, vatReturn, cashBridge, monthly (trailing 12), generatedAt}. `reportBundleSchema` unchanged.
- [ ] `coa/registry.ts`: `classifyAccountNumber(accountNumber, coa = defaultCoaTemplate): CoaAccountClass | undefined` — template lookup, then first-digit fallback (1→asset, 2→equity-liability, 3→revenue, 4→materials, 5–6→external-cost, 7→personnel, 8→financial); non-numeric → undefined (excluded, unit-tested).
- [ ] `reports/statements.ts`: `buildProfitLoss(lines, range, coa)` (filter → group by class → sorted lines, empty groups total 0); `buildBalanceSheet(lines, asOf, coa)`.
- [ ] `reports/cash.ts`: cash accounts = `startsWith("19")`. `buildCashBridge(lines, range, {maxDrivers = 4})`: per voucher cashDelta over 19xx lines; skip cashDelta 0 (non-cash); attribute across non-19xx lines proportional to |debit−credit|; aggregate per account; top-N → drivers, rest → other; closing ≡ independent 19xx balance ≤ to (asserted). `buildMonthlySeries(lines, endMonth, months = 12, coa)`.
- [ ] `reports/pack.ts`: `buildReportPack(lines, { periodToken, fiscalYearStart, today?, coa?, regime? }): ReportPack` composing all builders + `buildVatReturnBoxes`.
- [ ] Tests: seed-trio golden (finding 8 numbers); synthetic sale flips signs, fills 05/10; classification fallback (4711 → materials); bridge closing≡balance invariant incl. non-cash skip + other-bucket; monthly cumulative; `reportPackSchema.parse` round-trip.
- [ ] `CHECK`. Commit: `feat(domain,contracts): P&L/balance-sheet/cash-bridge/monthly builders + ReportPack contract (Swedish statement grouping from CoA classes)`.

## Task 4.3 — Store surface + period-scoped routes + api-client (atomic)

**Depends on 4.2.** **Files — Modify:** `packages/contracts/src/index.ts` (snapshot += packets), `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `services/api/src/runtime.ts`, `services/api/src/app.ts`, `packages/api-client/src/index.ts`, `tests/unit/ledger-store.test.ts`, `tests/integration/postgres-ledger.test.ts`, `tests/e2e/api.spec.ts`.

- [ ] `LedgerStore`: `getReports(range?: ReportRange)` (`{from?, to?}` inclusive day strings) + `getReportPack(input: { period: string }): Promise<ReportPack>`. Memory: filter `this.ledgerLines`; pack via `buildReportPack` with `fiscalYearStart` from settings (default 01-01). Postgres: extract line assembly into `private collectLedgerLines()`; both methods consume it. Unavailable += failing `getReportPack`.
- [ ] Snapshot `packets`: schema default []; Memory map values; Postgres query packets + items (org/workspace-scoped).
- [ ] Routes: existing four report routes parse optional `from`/`to` (`/^\d{4}-\d{2}-\d{2}$/` + from ≤ to else 422). New `GET /api/reports/pack?period=` (default `currentMonthToken()`); `InvalidPeriodTokenError` → 422 in onError.
- [ ] api-client: `getJournal(range?)`, `getTrialBalance(range?)`, `getReportPack(period)` — URLSearchParams, Zod-validated, fallbackStore paths.
- [ ] Tests: unit (range windows; pack after March import → 6110 −100; snapshot packets join resolves); INTEG (pack parity Memory vs Postgres deep-equal modulo generatedAt; packets parity); api.spec (March window → 2 lines; April → 0; malformed from → 422; pack period=2026-03 → periodResult −100 + box 49; bogus → 422; no-param pins untouched).
- [ ] `CHECK` + `INTEG`. Commit: `feat(reports): period-scoped report routes + ReportPack endpoint; getReports(range)/getReportPack in both stores; snapshot carries packets`.

## Task 4.4 — Narrative facts + KPI helpers in `packages/reporting` (parallel with 4.3)

**Depends on 4.2 (contracts only).** **Files — Modify:** `packages/reporting/src/index.ts`. **Create:** `packages/reporting/src/narrative.ts`, `packages/reporting/src/kpis.ts`, `tests/unit/report-narrative.test.ts`.

- [ ] `narrative.ts` — deterministic facts, no LLM, every value copied from the pack:

  ```ts
  export type NarrativeFact =
    | { id: "period-result"; amount: number; previousAmount?: number; delta?: number }
    | {
        id: "biggest-mover";
        accountNumber: string;
        accountName: string;
        amount: number;
        previousAmount: number;
        delta: number;
      }
    | { id: "cash-delta"; opening: number; closing: number; delta: number }
    | { id: "vat-position"; amount: number; box: "49" };
  export function buildReportNarrative(pack: ReportPack): NarrativeFact[];
  ```

  biggest-mover = largest |current−previous| across cost-group lines, omitted without previous/movement. Deterministic order.

- [ ] `kpis.ts`: `buildKpis(pack)` → { result, cash, revenue, vat, sparklines {result[], cash[], revenue[]} } from pack + monthly (exactly 4 KPIs).
- [ ] Tests: fact values ≡ pack values (reconciliation guards); mover math on two-period fixture; ordering.
- [ ] `summarizeJournal`/`summarizeVat` deletion happens in 4.6 (after last consumer dies).
- [ ] `CHECK`. Commit: `feat(reporting): deterministic narrative facts + KPI series derived from ReportPack (reconciled by construction)`.

## Task 4.5 — One period system + Books server-filtered + books i18n

**Depends on 4.3.** **Files — Create:** `apps/web/components/period/period-selector.tsx`, `apps/web/components/period/period-options.ts`. **Modify:** `apps/web/hooks/use-period-scope.ts`, `apps/web/components/screens/books-screen.tsx`, all `apps/web/components/books/*.tsx`, `apps/web/messages/en.json` + `sv.json` (`books` namespace), `tests/e2e/books-drilldown.spec.ts`. **Delete:** `apps/web/components/books/period-selector.tsx`; `apps/web/lib/report-period.ts` deletion may defer to 4.6 (its last consumer) — note in commit.

- [ ] `use-period-scope.ts`: nuqs period token with `currentMonthToken()` default, resolved via `resolvePeriodToken` + profile `fiscalYearStart`, `InvalidPeriodTokenError` → fallback to current month. Returns { raw, kind, from, to, label, setPeriod }. Fixes the UTC bug.
- [ ] `period-options.ts`: grouped options — last 12 months · current fy quarters · ytd · current+previous fy · all.
- [ ] Shared `period/period-selector.tsx` (testid `period-selector` unchanged) mounted by Books (and Reports in 4.6).
- [ ] Books server-filtered: journal + GL via `apiClient.getJournal({from,to})` (drop inline bookedAt filters; supplier filter stays client-side against snapshot vouchers); trial-balance via `apiClient.getTrialBalance({from,to})` (becomes period-movement — deliberate); suppliers-view stays voucher-based (documented).
- [ ] `books` i18n namespace (en verbatim).
- [ ] books-drilldown.spec += period test: POST March fixture to API → default month excludes 6110; `?period=2026-03` includes; `?period=2026-Q1` includes.
- [ ] `CHECK` + `E2E:file books-drilldown.spec.ts` + `E2E:file capture-loop.spec.ts`. Commit: `feat(web): one period system — fiscal presets in shared selector, Books server-filtered, UTC month-edge bug fixed; books i18n`.

## Task 4.6 — Reports screen v2: narrative-first, statements, VAT boxes (no charts yet)

**Depends on 4.3 + 4.4 + 4.5.** **Files — Create:** `apps/web/components/reports/kpi-row.tsx`, `narrative-card.tsx`, `pnl-statement.tsx`, `balance-sheet-statement.tsx`, `vat-return-table.tsx`. **Modify:** `apps/web/components/screens/reports-screen.tsx` (rewrite), messages (`reports` namespace), `packages/reporting/src/index.ts` (delete summarizeJournal/summarizeVat after grep re-verify). **Delete:** `apps/web/lib/report-period.ts` (if deferred).

- [ ] Composition: ScreenHeader (export-sie kept) → shared PeriodSelector → `useQuery(["reports","pack",raw], () => apiClient.getReportPack(raw))` → kpi-row → narrative-card → chart slots (4.7) → pnl → bs → vat table → alerts-panel (kept). Skeleton/UnavailableState preserved (testid `reports-unavailable`).
- [ ] kpi-row: 4 tiles testids `kpi-result/cash/revenue/vat`, values via Money, sparkline slot prop.
- [ ] narrative-card: `t.rich` templates rendering `<span data-testid="narrative-value-<id>"><Money value={fact.amount}/></span>` — prose numbers are literally pack values. "Computed from your ledger" line. Provenance chips (`narrative-chip-<id>`) → scroll/drawer targets. Empty state.
- [ ] pnl-statement (`id="pnl-statement"`, testid `pnl-statement`): group labels via i18n (Rörelsens intäkter etc.), rows `pnl-line` with `data-account`, Money amounts, group subtotals, `pnl-operating-result`, `pnl-period-result`; rows are buttons → drawer (inert until 4.8).
- [ ] balance-sheet-statement (testid `balance-sheet`): groups, `bs-line`, `bs-computed-result`, totals `bs-total-assets`/`bs-total-equity-liabilities`, balanced chip `bs-balanced` (integrity styling).
- [ ] vat-return-table (section testid `vat-preparation`, `id="vat-preparation"`): box rows `vat-box-row` with `data-box`, highlighted `vat-box-49` with att betala/få tillbaka phrase.
- [ ] `reports` i18n namespace complete (incl. 4.7/4.8 strings).
- [ ] REWRITE `tests/e2e/reports.spec.ts` NOW: render assertions (kpi-result, narrative-card, pnl-statement, balance-sheet, vat-preparation, alerts-panel, export-sie, period-selector); reconciliation gate `narrative-value-period-result text === pnl-period-result text`; period filter (March fixture via API → `?period=2026-03` shows `pnl-line[data-account="6110"]`, default absent).
- [ ] `CHECK` + `E2E:file reports.spec.ts`. Commit: `feat(reports): narrative-first reports screen — KPI row, resultat/balansrapport, momsdeklaration boxes; reports i18n`.

## Task 4.7 — Recharts v3 chart kit

**Depends on 4.6.** **Files — Create:** `apps/web/components/reports/charts/chart-kit.tsx`, `sparkline.tsx`, `monthly-bars-chart.tsx`, `cash-bridge-chart.tsx`, `apps/web/components/reports/chart-data-table.tsx`. **Modify:** `apps/web/package.json` (recharts@^3.9.1), kpi-row, reports-screen, messages.

- [ ] Install recharts; all chart files `"use client"`; big charts via `next/dynamic({ ssr: false, loading: ChartSkeleton })` from the client reports screen. Fixed heights, ResponsiveContainer, min-w-0 parents. `isAnimationActive={false}` everywhere. Colors via `var(--chart-*)`/`var(--positive)`/`var(--negative)` SVG props.
- [ ] sparkline: axis-less LineChart, aria-hidden (KPI value is the accessible text); wired into the 4 KPI tiles.
- [ ] monthly-bars (testid `monthly-bars`, role img + aria-label): grouped cashIn/cashOut bars, accessibilityLayer, tooltip trigger click on mobile (useIsMobile).
- [ ] cash-bridge (testid `cash-bridge`, `id="cash-bridge"`): waterfall as stacked BarChart (invisible base + delta Cells; opening/closing `--chart-3`, positive `--positive`, negative `--negative`); ≤7 bars; `Bar onClick` → `onDrill(accountNumber)` prop.
- [ ] chart-data-table: `<table>` fed the SAME array reference; toggle button `chart-table-toggle-<chartId>` with aria-expanded; container `hidden print:block` when collapsed. Cash-bridge twin rows carry drill buttons `cash-bridge-row-<accountNumber>` (keyboard drill path + E2E target).
- [ ] Bundle guard: `pnpm build` route table — recharts only in the reports lazy chunk (numbers in commit body).
- [ ] `CHECK` + `E2E:file reports.spec.ts` (charts visible via waitForSelector svg; table toggle; axe with charts mounted). Commit: `feat(charts): Recharts v3 kit — sparklines, monthly in/out bars, cash-bridge waterfall with data-table twins`.

## Task 4.8 — Drill grammar: account drawer, voucher→evidence links, GL handoff

**Depends on 4.7.** **Files — Create:** `apps/web/components/reports/account-drill-drawer.tsx`, `apps/web/components/reports/voucher-link.tsx`, `tests/e2e/reports-drill.spec.ts`. **Modify:** reports-screen, pnl/bs statements, cash-bridge chart + table wiring, narrative-card (mover chip → drawer), `apps/web/components/books/journal-view.tsx` (voucher cell → VoucherLink), messages.

- [ ] Drawer state = URL state: nuqs `?drill=<accountNumber>` (shareable, back-safe). Drawer testid `account-drill-drawer`, `useDialogFocusTrap`, data = getJournal({from,to}) filtered to account; rows `drill-line`: date, description, Money net, VoucherLink. Footer `drill-open-ledger` → `/books?view=general-ledger&account=<n>&period=<raw>` (one period token across surfaces).
- [ ] voucher-link.tsx per finding 4: (a) resolvable voucher+packet → Link to `/capture/evidence/<evidenceIds[0]>` showing voucherNumber (testid `drill-voucher-link`); (b) `sie_*` → mono text + "Imported" badge (`drill-imported-badge`); (c) otherwise plain muted mono. Never a dead link.
- [ ] Wire all drill sources: statement line buttons, waterfall bars + table rows, narrative mover chip → setDrill. Books journal voucher cell adopts VoucherLink (text unchanged — capture-loop survives).
- [ ] reports-drill.spec: approve seed via API → /reports → open bridge table → `cash-bridge-row-6540` → drawer ≥2 lines → voucher link → evidence detail; back → GL handoff with account + period in URL; March import → `?period=2026-03` drill 6110 → imported badge, no link. Axe on open drawer.
- [ ] `CHECK` + both drill spec files. Commit: `feat(reports): drill grammar — account drawer (nuqs ?drill=), voucher→evidence links, imported badges, GL handoff`.

## Task 4.9 — Print-clean PDF

**Depends on 4.8.** **Files — Create:** `apps/web/components/reports/print-header.tsx`. **Modify:** `apps/web/app/globals.css` (@media print), `apps/web/components/app-shell.tsx` (print:hidden on chrome), reports-screen, messages.

- [ ] `print:hidden` on shell rail/header/dock/digest/draft-notice/banner (screen-inert).
- [ ] Reports print: selector + buttons + chart SVGs `print:hidden`; chart tables visible in print; statements `break-inside-avoid`; print-header (testid `report-print-header`): company name, period label, generatedAt.
- [ ] globals @media print: plain background, glass → border-only, link underlines.
- [ ] `print-report` button → `window.print()`.
- [ ] E2E: emulateMedia print → nav + svg hidden, table + header visible; print stub via addInitScript → flag.
- [ ] `CHECK` + `E2E:file reports.spec.ts`. Commit: `feat(print): print-clean report pack — print CSS, print header, chart table fallback, Print/Save-as-PDF button`.

## Task 4.10 — Phase-4 exit gate

**Files — Modify:** `tests/e2e/visual-regression.spec.ts` (reports waits for `[data-testid="cash-bridge"] svg` before screenshot — ssr:false race), baselines, `docs/DEV_STATUS.md`, `CLAUDE.md:85` truth-pass, `docs/CONVENTIONS.md` if warranted.

- [ ] Full `CHECK` + full `E2E`. Re-baseline after diff review: expected diffs reports-{light,dark} (new screen) + books-{light,dark} (links). Today/capture/settings must be byte-stable.
- [ ] E2E inventory green: reports.spec (render, reconciliation, period, print, axe) · reports-drill.spec · books-drilldown (+periods) · api.spec (params, pack, 422s, untouched pins) · capture-loop unmodified-green.
- [ ] Grep gates: `report-period\b` zero in apps/web+tests · `getPeriodDayRange|journalEntryInPeriod` zero · `toISOString().slice(0, 10)` zero in apps/web/hooks · `from "recharts"` only under components/reports/charts/ · books/reports copy only in messages/.
- [ ] Parity inventory: unit + INTEG (pack parity, packets) + E2E. Bundle note in commit body.
- [ ] DEV_STATUS (Phase 4 complete; limitations: VAT boxes over selected period — statutory VAT-period config lands with Phase 5 timeline; suppliers view not period-scoped; bridge attribution proportional, skips non-cash vouchers) + CLAUDE.md fix. Commit: `chore: phase 4 exit — reports regression-locked (E2E, visual re-baseline, axe, bundle notes)`.

---

### Critical Files for Implementation

- `packages/contracts/src/index.ts` — reportPackSchema family + snapshot packets
- `packages/domain/src/store.ts` — getReports(range?)/getReportPack + Memory impls
- `packages/persistence-postgres/src/store.ts` — collectLedgerLines extraction, parity
- `services/api/src/app.ts` — period params, /api/reports/pack, 422s
- `apps/web/components/screens/reports-screen.tsx` — the narrative-first rewrite (4.6–4.9 compose into it)
