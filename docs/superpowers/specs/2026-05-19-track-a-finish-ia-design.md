# Track A — Finish IA: Execution Design Spec

**Date:** 2026-05-19
**Status:** Draft for review
**Scope:** Complete the IA restructure (Phases 5–8 of `2026-05-13-ia-restructure.md`) as a single, codebase-re-baselined, phased effort. This is **Track A** in `docs/DEV_STATUS.md` — product-visible, demo-safe, no production database required.

**Parent product spec (unchanged):** `docs/superpowers/specs/2026-05-13-ia-restructure-design.md`
**Supersedes:** Phases 5–8 of `docs/superpowers/plans/2026-05-13-ia-restructure.md` (those phases were authored before Phases 1–4 landed and are stale).
**Linked plan (to be written next):** `docs/superpowers/plans/2026-05-19-track-a-finish-ia.md`

---

## 1. Purpose and relationship to the parent spec

The 2026-05-13 IA spec defines the _product design_ for the 5-tab IA. Phases 1–4 shipped (5-tab nav, digest, redirects, Books drill-through, Today keyboard flow). Phases 5–8 remain:

| Phase | Surface                                                   | Parent spec section |
| ----- | --------------------------------------------------------- | ------------------- |
| 7     | Reports — P&L, Balance Sheet, VAT return, charts, exports | §4.4                |
| 5     | Capture — drafts + evidence archive                       | §4.2                |
| 6     | Global Cmd-K Advisor palette                              | §5.1                |
| 8     | Settings depth + simulations                              | §4.5, §8.7          |

This document does **not** re-do product design. It is an **execution delta**: it re-baselines Phases 5–8 against the _current_ tree, records the decisions taken on 2026-05-19, and resolves the points where the parent spec or the old plan diverged from code reality.

## 2. Decisions (2026-05-19)

1. **Sequencing — risk-first: 7 → 5 → 6 → 8.** Reports is the highest user value and the only phase with genuine technical risk (charts, PDF, a new event type); doing it first de-risks the track. Capture and the Advisor palette are mostly UI over working APIs; Settings depth is mostly forms.
2. **Charts — Recharts v3 via shadcn's (now v3-native) `chart` component.** As of 2026 `shadcn add chart` generates a Recharts-v3 wrapper, so the hand-patch assumed during the 2026-05-19 design discussion is **not needed** (a simplification). The open React 19.2.x blank-render risk (recharts#6857) is independent and is accepted, mitigated by a `react-is` override, a mandatory CI render smoke test, and a documented bespoke-SVG fallback.
3. **VAT filing — full event-sourced filing state.** New `VatPeriodFiled` ledger event, API route, and provenance UI. This is the only Track A work that touches the domain/event layer.

## 3. Re-baseline: corrections to the parent spec and old plan

These are code-verified as of 2026-05-19. The plan must encode them; ignoring them reproduces stale work.

| #   | Parent spec / old plan said                                            | Reality (verified)                                                                                                                                                            | Action                                                                                          |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | New event `vat-period-filed` (kebab-case)                              | `eventTypeSchema` is PascalCase only (`PostedToLedger`, `ExportGenerated`, …) — `packages/contracts/src/index.ts:27-43`                                                       | Use **`VatPeriodFiled`**; add `RetentionPolicyUpdated` likewise                                 |
| 2   | Phase 5: "extend `draft-queue` to add a list path"                     | `listCaptureDrafts()` + `removeCaptureDraft()` already exported — `apps/web/lib/draft-queue.ts:114-120`                                                                       | Drop that task; consume the existing functions                                                  |
| 3   | Phase 1/5/6/7 "install nuqs / hotkeys / react-table / react-hook-form" | All already in `apps/web/package.json` (nuqs `^2.8.9`, react-hotkeys-hook `^5.3.2`, @tanstack/react-table `^8.21.3`, react-hook-form `^7.75.0`, @hookform/resolvers `^5.2.2`) | Only **new** installs: `cmdk`, `recharts@^3`, `@react-pdf/renderer`                             |
| 4   | Old plan: "react-hook-form 8"                                          | Installed `^7.75.0`; RHF 7 is current stable and Zod-4 compatible via resolvers v5                                                                                            | Keep RHF 7 (parent spec's `^7` is correct)                                                      |
| 5   | Advisor "streams streaming response … with citations" (§5.1)           | `POST /api/assistant/sessions` returns a complete `AssistantSession` JSON; no streaming                                                                                       | Ask mode: loading state → complete answer + citation chips. **No fake token streaming.**        |
| 6   | PDF export = "client dynamic import of `@react-pdf/renderer`" (§6.2)   | Exports already served by the Hono API (`GET /api/exports/sie`), web links via `/api-proxy/...`                                                                               | PDF is a **Hono API route**, not a client import or a Next route handler (see §4.1)             |
| 7   | Reports period via shared scope                                        | `getSnapshot()` is period-less; `buildJournal/Balances/Vat` never filter `bookedAt` — `projections.ts`, `store.ts:446-448`                                                    | Period-scoped reports use **dedicated period-aware endpoints**, not the snapshot                |
| 8   | "Server actions for submission where possible" (§4.5)                  | Implemented `company-form.tsx` uses RHF + React Query mutation → Hono `PUT`; no server actions in the tree                                                                    | Keep the established RHF + React Query + Hono pattern; **do not** introduce Next server actions |
| 9   | `closeRun.assignees` for the team table                                | `closeRunSchema` exposes `checklist`, not `assignees` — `contracts/src/index.ts:211-219`                                                                                      | Team page is display-only from a stub/new field, not derived from close runs                    |

## 4. Phase designs

Order of execution: **7 → 5 → 6 → 8**. Each phase ends in independently revertable commits (same backout model as the parent plan).

### 4.1 Phase 7 — Reports

**Goal:** `/reports` becomes a real statutory/management surface: Resultaträkning, Balansräkning, period-aware VAT return with event-sourced filing, charts, and SIE/CSV/PDF exports. Period scope is shared with Books via the existing `usePeriodScope()` URL hook.

**Projections (new, pure, period-filtered) — `packages/reporting/src/`:**

- `profit-loss.ts` — Resultaträkning, _kostnadsslagsindelad_. BAS rollup:
  - Revenue: 3000–3799 (Nettoomsättning), 3900–3999 (Övriga rörelseintäkter)
  - Costs: 4000–4799 (Råvaror/handelsvaror), 5000–6999 (Övriga externa kostnader), 7000–7699 (Personalkostnader), 7700–7899 (Av/nedskrivningar), 7900–7999 (Övriga rörelsekostnader)
  - Financial/result: 8000–8499 (finansiella poster), 8800–8999 (bokslutsdispositioner, skatt, årets resultat)
  - Returns grouped lines + subtotals `rörelseresultat`, `resultatEfterFinansiellaPoster`, `åretsResultat`.
- `balance-sheet.ts` — Balansräkning. Class 1: 1000–1399 anläggningstillgångar (10 immateriella, 11–12 materiella, 13 finansiella), 1400–1999 omsättningstillgångar (14 lager, 15 kund­fordringar, 16–18 övr., 19 kassa/bank). Class 2: 2000–2099 eget kapital, 2100–2199 obeskattade reserver, 2200–2299 avsättningar, 2300–2399 långfristiga, 2400–2999 kortfristiga skulder. Invariant: assets = equity + liabilities (assert in unit test).
- `vat-return.ts` — Skatteverket box model: 05–08 (base), 10–12 (utgående 25/12/6 %), 20–24 (förvärv/omvänd), 30–32 (utgående på förvärv), 35–42 (momsfri/EU/export), 48 (ingående att dra av), 49 (att betala/få tillbaka = sum outputs − 48). BAS 26xx → box mapping driven by account-number metadata, **not** leading-digit heuristics. Each box carries the journal rows that fed it for reconciliation.
- Unit tests in `tests/unit/` per projection over a fixture journal (existing `tsx --test tests/unit/*.test.ts` harness).

**Contracts — `packages/contracts/src/`:** add `profitLossSchema`, `balanceSheetSchema`, `vatReturnSchema` (+ inferred types). Add `VatPeriodFiled` to `eventTypeSchema`. `workspaceSnapshotSchema` is **unchanged** — period-scoped reports are fetched per-request.

**API — `services/api/src/app.ts`:**

- `GET /api/reports/profit-loss?period=YYYY-MM`, `/balance-sheet?period=`, `/vat-return?period=` — filter `this.ledgerLines` by `bookedAt ∈ [period.start, period.end]`, run the projection. (`MemoryLedgerStore` gains period-filtered read methods; signatures kept sync/async-tolerant to match the documented future async migration.)
- `POST /api/vat/periods/:period/file` — appends a `VatPeriodFiled` event via the existing `appendEvent` (hash-chained generically; no reducer rewrite). VAT return responses include `filedBy`/`filedAt` derived by folding `VatPeriodFiled` events.
- `GET /api/exports/sie?period=` — extend the existing SIE route with an optional period filter.
- `GET /api/exports/pdf?report=pl|bs&period=` — Hono route rendering with `@react-pdf/renderer` (Node; the API is already a Node Hono server, so no `next.config` `serverExternalPackages` and no client bundle cost). Web links to it through the existing `/api-proxy/...` pattern with `download`.

**Web — `apps/web/`:** rewrite `components/screens/reports-screen.tsx` (replace the `pl`/`bs` "Coming in Phase 7" placeholders; keep `?view=` tuple `pl|bs|vat|exports`). Reuse `hooks/use-period-scope.ts` (already `?period=`, default current month, `{start,end,label}`) so the period selector is shared with Books through the URL. New: `components/reports/{profit-loss-view,balance-sheet-view,vat-return-view,exports-view}.tsx`, `components/reports/charts/{pl-stacked-bar,bs-area,vat-bar}.tsx`. A single `useReport(kind, periodRaw)` React Query wrapper backs all three report views (one fetch abstraction, not three).

**Charts:** `pnpm --filter @jpx-accounting/web add recharts@^3`; add a root `package.json` `overrides` entry pinning `react-is` to the React 19.2.x line; `pnpm --filter @jpx-accounting/web exec shadcn@latest add chart` (the current generator emits a Recharts-v3 wrapper — **no hand-patch**). Follow shadcn's v3 conventions: reference chart tokens as `var(--chart-1)` (not `hsl(var(--chart-1))`), keep a `min-h`/`aspect-*` on `ChartContainer` so `ResponsiveContainer` measures on first render, and hold any persistent active shape in chart state. **Mandatory** E2E smoke test asserting a chart renders real SVG (`path`/`rect` nodes present) — guards the open recharts#6857 blank-render regression on React 19.2.x. Documented fallback: if charts render blank in CI, swap the three chart components for bespoke SVG/CSS (tables + numbers ship regardless; charts are additive).

**VAT filing UI:** "Mark period as filed" button on the VAT return view. Once filed, the period renders read-only with a "Filed by {actor} on {date}" provenance line; next period auto-advances. Filing is idempotent (replayed POST is a no-op fold).

**Tests:** unit (3 projections); E2E `tests/e2e/reports.spec.ts` (tabs, period change re-fetches, chart SVG smoke, file-VAT records an event, SIE/PDF download); axe-core on `/reports`.

### 4.2 Phase 5 — Capture

**Goal:** `/capture` becomes a real page: quick-add, local drafts, evidence archive with hash chain. The global FAB stays.

**Web — `apps/web/`:**

- `components/capture/quick-add-grid.tsx` — 4 hero tiles (camera/upload/paste/share) reusing `saveCaptureDraft` (the exact path the modal uses) + an "Import SIE file" tile (`input[type=file]` → `POST /api/imports/sie`) + a "Connect bank feed" CTA linking `/settings/integrations`.
- `components/capture/drafts-table.tsx` — consumes existing `listCaptureDrafts()`; columns: icon/thumb, mode, createdAt, storage-tier badge; "Promote to ledger" → `apiClient.createEvidence(...)` then `removeCaptureDraft(id)` + toast.
- `components/capture/evidence-archive-table.tsx` — `@tanstack/react-table` over `snapshot.evidence`; columns: title, mime, hash (first 8 + copy), createdAt, voucher-status badge; search + filter.
- `app/(shell)/capture/evidence/[id]/page.tsx` — detail rendered from `snapshot.evidence` (find-by-id) + packet/hash chain/provenance. No new API required for the demo path; an optional thin `GET /api/evidence/:id` is flagged for SSR deep-links (not required for Track A).
- `components/screens/capture-screen.tsx` composes the three sections.

**Tests:** E2E `tests/e2e/capture.spec.ts` (page loads; a modal-captured draft appears in the table; promote creates evidence; row → detail with hash visible); axe-core on `/capture`.

### 4.3 Phase 6 — Global Cmd-K Advisor palette

**Goal:** A global keyboard palette combining navigation, AI Q&A, knowledge lookup, and simulations. `/assistant` stays as session history.

**Install:** `cmdk@^1` (React 19-clean since 1.0.1) + `shadcn add command`.

**Web — `apps/web/`:**

- `components/advisor/advisor-palette.tsx` — `<CommandDialog>`; mode derived from input prefix: **nav** (default — fuzzy across primary routes + key actions), **ask** (`?` → `POST /api/assistant/sessions`), **lookup** (`/policy|/vat|/supplier` → `POST /mcp` tool), **simulate** (`sim:` → `POST /api/simulations/run`).
- `components/advisor/advisor-palette-provider.tsx` — mounted in the **root** `app/layout.tsx` next to the existing `QueryProvider`/`NuqsAdapter`; `useAdvisor()` opens it from anywhere.
- Ask mode is **non-streaming** (see correction #5): loading state → complete answer + citation chips.
- `?advisor=open` auto-opens on mount via nuqs (satisfies the legacy `/assistant` redirect already wired in `proxy.ts`).
- Global `⌘K`/`Ctrl+K` + `g t/c/b/r/s` nav chords via the installed `react-hotkeys-hook` (scoped off when an input/textarea is focused; honors `prefers-reduced-motion`).
- An "Ask" affordance in the top bar for discoverability.

**Tests:** E2E `tests/e2e/advisor-palette.spec.ts` (⌘K opens from any route; `/policy vat` returns a lookup; `?` switches to Ask and renders an answer + citations; legacy `/assistant` redirects and opens the palette); axe-core on the open palette.

### 4.4 Phase 8 — Settings depth + simulations

**Goal:** Every Settings sub-page renders real content or a clearly-marked roadmap card; simulations surface as a Books sub-tab. No "Coming in Phase 8" copy remains.

**Field-persisted settings (mirror the `companySettings` pattern — `store.ts:588-595`, _not_ event-sourced):**

- `fiscal-year` — `fiscalYearSettingsSchema { fiscalYearStartMonth: 1–12, vatReportingPeriod: monthly|quarterly|annually }`; `get/saveFiscalYearSettings`; `GET/PUT /api/settings/fiscal-year`; RHF+Zod form (`radio-group` for VAT cadence, `select` for start month).
- `ai-posture` — `aiPostureSchema { autoApproveConfidence: number, surfacesEnabled: {advisor,inline,ambient}, killSwitch: boolean }`; `get/saveAiPostureSettings`; `GET/PUT /api/settings/ai-posture`; RHF+Zod form (`switch`, `slider`).

**Event-sourced (new PascalCase event, folded for state — same mechanism as VAT filing):**

- `retention` — read-only "7-year Bokföringslagen" banner + per-voucher-class legal-hold toggle persisted as `RetentionPolicyUpdated`.

**Read / stub:**

- `team` — display-only member table + "Invite" dialog → `POST /api/team/invitations` (stub response, "Coming soon"). Members come from a new `team` snapshot/store stub, not `closeRun`.
- `integrations` — placeholder cards (Bank feeds / Skatteverket / Accountant access) each opening a roadmap dialog.
- `compliance` — subscribed-source list + alert history from `snapshot.alerts` + "Refresh" → `POST /api/compliance-watch/refresh`.

**Simulations under Books:** extend `components/screens/books-screen.tsx` `views` tuple with `simulate` (`?view=simulate`); free-text scenario + voucher selector → `POST /api/simulations/run`; render `SimulationRun.affectedAccounts`/`outcomeSummary` as proposed lines vs current.

**Shared helper:** a single `deriveFromEvents(kind, fold)` utility powers both `VatPeriodFiled` and `RetentionPolicyUpdated` state derivation (one mechanism, not two ad-hoc folds).

**Tests:** E2E `tests/e2e/settings.spec.ts` extended (fiscal-year + AI-posture persist across reload; compliance refresh works; Books `simulate` runs and renders proposed entries); axe-core on each settings route.

## 5. Cross-cutting

- **Contracts/events added (all additive, backward-compatible):** schemas `profitLoss`, `balanceSheet`, `vatReturn`, `fiscalYearSettings`, `aiPosture`; event kinds `VatPeriodFiled`, `RetentionPolicyUpdated`. Unknown event kinds are ignored by existing folds (to be verified in the reducer during planning).
- **New shadcn primitives:** `command`, `chart`, `radio-group`, `switch`, `slider`. Existing set already covers table/tabs/form/dialog/sheet/sidebar/toggle-group/kbd/select/badge.
- **Shared abstractions to extract (anti-duplication):** `useReport(kind, period)` React Query wrapper (Phase 7); a shared `<DataTable>` over `@tanstack/react-table` reused by drafts, evidence archive, VAT reconciliation, and (if not already extracted in Phase 3) Books tables; `deriveFromEvents` fold helper.
- **State model:** URL search params remain the source of truth (`?view=`, `?period=`, `?advisor=`) via the already-wired nuqs adapter. Server Components by default; client only for interactivity (palette, forms, charts, mutations).
- **Per-phase gate:** `pnpm typecheck && pnpm build && pnpm test:unit && pnpm test:e2e`. axe-core: zero serious WCAG 2.2 AA per new/changed route (EAA mandate).
- **Documented deviations from the 2026-05-13 spec:** corrections #1, #5, #6, #7, #8 in §3 are intentional and recorded here so the parent spec is not silently contradicted.

## 6. Acceptance criteria (Track A exit)

1. `/reports` shows P&L, Balance Sheet, VAT, Exports — no "Coming in Phase 7" copy. Changing the period re-fetches; the same `?period=` drives Books.
2. A chart renders real SVG on `/reports` in CI (smoke test green).
3. Marking a VAT period filed appends a `VatPeriodFiled` event; the period becomes read-only with provenance.
4. SIE (period-scoped) and PDF (P&L/BS) downloads succeed; CSV serializes the active view in `sv-SE`.
5. `/capture` shows quick-add, drafts (a modal-captured draft appears; promoting it creates evidence), and the evidence archive; a row drills to detail with the hash visible.
6. `⌘K` opens the Advisor palette from any route; nav/ask/lookup/simulate modes work; legacy `/assistant` redirects and opens it.
7. Every `/settings/*` sub-page renders real content or a clearly-marked roadmap card; fiscal-year and AI-posture persist across reload; compliance refresh works.
8. Simulations run from the Books `simulate` sub-tab and render proposed entries.
9. All E2E specs pass (capture, advisor-palette, reports, settings updated/added); axe-core clean on each route.
10. No new silent demo fallbacks in `normal` mode; Swedish locale for currency/date/number via `apps/web/lib/presentation.ts`.

## 7. Out of scope (unchanged from parent spec §9)

Supabase-backed `LedgerStore` (Track B); dark mode; Swedish UI translation; real bank/Skatteverket OAuth; Phase-2 graduated AI autonomy logic; OCR pipeline. Track A is demo-safe and does not require the production database.

## 8. Risks

| Risk                                                     | Likelihood | Mitigation                                                                                                                       |
| -------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Recharts v3 blank render on React 19.2.x (recharts#6857) | Medium     | `react-is` override; mandatory CI SVG smoke test; bespoke-SVG fallback (tables ship regardless)                                  |
| BAS kontogrupp boundary ambiguity (class 4/49/78/79)     | Medium     | Map by full account number, not leading digits; unit-test against a fixture journal; validate P&L subtotals tie to trial balance |
| Skatteverket box mapping drift                           | Low        | Stable since 2017; validate 26xx→box wiring against current SKV 552 before any real filing (out of Track A scope but noted)      |
| `@react-pdf/renderer` weight                             | Low        | Server-only in the Hono API; never in the client bundle                                                                          |
| Async `LedgerStore` migration lands mid-Track-A          | Low        | New store read methods kept async-tolerant in signatures                                                                         |

## 9. Framework & best-practice consolidation review (2026-05-19)

Reviewed against current upstream state; conclusions baked into the spec above.

1. **shadcn `chart` is Recharts-v3-native** (verified via shadcn/ui docs, 2026). The planned hand-patch is removed; follow shadcn's v3 token/`ResponsiveContainer` conventions instead. Net: less custom code, one fewer maintenance burden.
2. **react-hook-form stays on 7** (latest stable 7.76.0; v8 is beta-only). Confirms the parent spec's `^7`; rejects the old plan's "8". `@hookform/resolvers@^5` already gives Zod-4 resolver support.
3. **Data fetching stays client + React Query + nuqs, uniformly.** Next.js 16 would permit RSC `searchParams` fetching for Reports, but every existing screen (`reports-screen`, `books-screen`, `assistant-screen`) is a client component with `useQuery` + nuqs. A single consistent pattern beats a per-page RSC optimization here — the data is small, auth-gated, and period-reactive, and codebase uniformity is a stated project priority (AI-maintained, no shims). Documented as a deliberate choice, not an oversight.
4. **Report endpoints stay one-route-per-concern** (`/api/reports/profit-loss`, `/balance-sheet`, `/vat-return`) rather than a single `?kind=` route — matches the existing granular Hono convention (`/api/exports/sie`, `/api/settings/company`, `/api/reviews/:id/approve`). Consistency over surface-area golf.
5. **Exports unified in the Hono API.** PDF joins SIE as a Hono route (not a Next route handler / client import) — one export surface, `@react-pdf/renderer` stays server-only, no `next.config` `serverExternalPackages` needed, zero client-bundle cost.
6. **Shared abstractions confirmed as anti-duplication directives**, not optional: `useReport(kind, period)`, a shared `<DataTable>` over `@tanstack/react-table` (extract from Phase 3 Books tables if one is not already factored), and the `deriveFromEvents(kind, fold)` helper shared by `VatPeriodFiled` and `RetentionPolicyUpdated`.
