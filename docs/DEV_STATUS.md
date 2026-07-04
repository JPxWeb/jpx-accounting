# Development Status

**Last reviewed:** 2026-07-03 (advisory-pivot kickoff)
**Purpose:** Track phase completion, ported work, and open UI follow-ups. Update at the end of each phase.

> **Advisory pivot — Phase 3 (real capture) COMPLETE:** the capture journey is genuinely real end-to-end — drop-zone/file/camera/paste/share intake with real Blobs in IndexedDB, one promotion pipeline (SHA-256 → initUpload with canonical blobPath → real PUT → createEvidence with honest metadata), extraction persisted via `ExtractionRefreshed` + regenerated suggestions (hash-chained, append-only, decided-voucher guard), deterministic file-seeded demo extraction (seed/baseline pins hold), evidence detail with preview + extracted fields + review deep-link + re-extract, review Edit is a real editor (edited approvals post corrected lines append-only; `PostedToLedger` payload-lines parity fixed), share_target files forwarded server-side through the real pipeline, and SIE 4 is spec-valid both directions (CP437/PC8, `VoucherImported` events replayed into reports, golden-file pinned). Known v1 limitations: shared-file staging needs API reachability; imported vouchers have no voucher rows (journal-only); imports carry `vatCode: "NA"`. Exit gate: capture-loop E2E proves file → extraction → review → approval → journal with API cross-checks.
>
> **Advisory pivot — Phase 2 (platform seams) COMPLETE:** workspace profile (country/locale/currency/fiscalYearStart) on company settings with per-country validation registry (SE populated), both stores normalizing legacy jsonb; tabular-mono `Money` component + locale-parameterized presentation (zero sv-SE/SEK literals in product code); next-intl without routing (en source + full sv catalog, cookie-driven, dynamic `html lang`); CoA registry (`bas-2026`, 68-account Swedish SMB subset + role map — zero account literals in domain logic); VAT regime as data (rates/direction/SE box mapping/deductibility rules, `buildVat` gains the output side, `buildVatReturnBoxes` ready for Phase 4). Exit gate: check green, 44 functional E2E green, visuals re-baselined (Money mono + settings fieldset), grep gates zero.
>
> **Advisory pivot — Phase 0 (Green) and Phase 1 (one-shot UI consolidation) are COMPLETE** on `feat/advisory-pivot`: single OKLCH token file + Tailwind bridge (was missing entirely — shadcn primitives rendered unstyled pre-pivot), one palette, unified radius scale (3xl/4xl retired, lint-enforced), dark mode mounted (next-themes + toggle), one lucide icon system, dead primitives deleted, drill-downs/palette/proxy fixed, brand + PWA assets real (installability fixed), advisor wired into rail + palette. Regression net: 20 themed screenshot baselines + 3 new E2E specs. Phases 2–6 in progress.
>
> **Advisory pivot in progress (2026-07-03, branch `feat/advisory-pivot`).** The product is being evolved into an AI advisory reporting app for European SMBs — drag-&-drop advisory dashboard, one-shot UI/token consolidation, real capture pipeline, deep reports, advisory layer. Where the Track A phase plans below conflict with it, the pivot wins. Spec: [`superpowers/specs/2026-07-03-advisory-pivot-design.md`](./superpowers/specs/2026-07-03-advisory-pivot-design.md) · Plan: [`superpowers/plans/2026-07-03-advisory-pivot-master-plan.md`](./superpowers/plans/2026-07-03-advisory-pivot-master-plan.md).

> **Deploy → main port is complete (2026-05-27).** Eight PRs (A, B, C, D1, D2, D3, G, H1) drained the useful work from `origin/deploy` and reset `origin/deploy` to match `origin/main`. The Track A IA web layer (5-tab navigation, ambient digest, settings layout, Today per-card actions, Books) is on `main` with shadcn/ui primitives in place; the underlying data layer (`PostgresLedgerStore`) has the full Phase 7 contract surface. Future-work plans + design specs from the `deploy` lineage are preserved under [`docs/superpowers/plans/`](./superpowers/plans/) and [`docs/superpowers/specs/`](./superpowers/specs/).

## Verification baseline

Run before opening any PR:

```bash
pnpm typecheck         # all workspace packages (10 workspaces)
pnpm test:unit         # node:test + tsx unit suite (tests/unit/**)
pnpm typecheck:tests   # tests/tsconfig.json typecheck (added in PR-B)
pnpm lint              # ESLint
pnpm format:check      # Prettier
pnpm build             # web + API
```

`pnpm check` runs the full `lint → format:check → typecheck → typecheck:tests → test:unit → build` chain.

E2E is **opt-in on PRs** (PR-H1, #28): apply the `run-e2e` label to trigger the Playwright job. E2E runs automatically on pushes to `main` (pre-deploy gate) and via `workflow_dispatch`. Use it for any user-facing change where regressions would be hard to catch otherwise.

```bash
pnpm test:e2e          # local Playwright (builds first; demo API on 3201, web on 3200)
```

Integration tests against a real Postgres are gated on `SUPABASE_DB_URL`:

```bash
SUPABASE_DB_URL=<local-postgres-url> pnpm test:integration
```

---

## Merged PRs (2026-05-27 port sweep)

| PR        | Scope                                                                                                                                                                                                                            | Status                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **PR-A**  | Docs cherry-pick (CONVENTIONS, Phase 7 spec + plans, initial DEV_STATUS)                                                                                                                                                         | **MERGED** [#15](https://github.com/JPxWeb/jpx-accounting/pull/15) |
| **PR-B**  | Contracts, pure domain helpers, `MemoryLedgerStore` extensions, API routes, migration `0004`, `typecheck:tests` script                                                                                                           | **MERGED** [#16](https://github.com/JPxWeb/jpx-accounting/pull/16) |
| **PR-C**  | `PostgresLedgerStore` real implementations (`runSimulation`, `refreshComplianceAlerts`, `answerAssistantQuestion`, company settings round-trip)                                                                                  | **MERGED** [#17](https://github.com/JPxWeb/jpx-accounting/pull/17) |
| **PR-D1** | shadcn/ui foundation (deps, OKLCH theme, `@/` alias, `cn` helper, 18 primitives, Sonner toaster mount, skip-to-content link, `useIsMobile` hook)                                                                                 | **MERGED** [#19](https://github.com/JPxWeb/jpx-accounting/pull/19) |
| **PR-G**  | Security + tooling — SHA-pinned GHA workflows, Husky v9 + lint-staged, `.cursorignore`, worktree gitignore                                                                                                                       | **MERGED** [#25](https://github.com/JPxWeb/jpx-accounting/pull/25) |
| **PR-D2** | Settings layout + sidebar, RHF company form, 8 settings sub-routes (about, ai-posture, company, compliance, fiscal-year, integrations, retention, team) — most are stubs; the form pattern is the reusable piece                 | **MERGED** [#26](https://github.com/JPxWeb/jpx-accounting/pull/26) |
| **PR-D3** | 5-tab IA refactor (Today / Capture / Books / Reports / Settings), ambient digest as parallel route (`(shell)/@digest/`), Today per-card actions with filter UI, Books screen with tab dispatch, NuqsAdapter wired at root layout | **MERGED** [#27](https://github.com/JPxWeb/jpx-accounting/pull/27) |
| **PR-H1** | CI E2E gated behind `run-e2e` label + auto-run on main pushes + `workflow_dispatch`                                                                                                                                              | **MERGED** [#28](https://github.com/JPxWeb/jpx-accounting/pull/28) |
| **PR-H**  | Port deferred plan + spec docs from `deploy`; refresh DEV_STATUS + CLAUDE.md; reset `origin/deploy` to match `origin/main`                                                                                                       | (this PR)                                                          |

PR #14 (original `deploy → main`) was closed as superseded by the 8-PR port. PR-F (deploy-only `PostgresLedgerStore` perf ports) was opened, then closed as a no-op — all five intent patterns were already present in main's `PostgresLedgerStore`.

---

## Open follow-ups

### Data-layer (small, well-scoped)

- **Manual integration test** against a live Postgres before the next deploy: `SUPABASE_DB_URL=... pnpm test:integration` to exercise the 4 new round-trips (`runSimulation` real diff + `ReviewNotFoundError`, `answerAssistantQuestion` persists, `refreshComplianceAlerts` idempotency, settings round-trip).
- **Migration 0004** applies cleanly to PG ≥ 15 (Supabase ships PG 17). Coordinate with the schema owner before applying to production.
- **Document Intelligence persistence** — `BlobUploader.mintReadSas()` landed in the 2026-05-28 sweep; `/api/evidence/:id/extract` now mints real SAS. Still needed to land OCR results into the ledger: `LedgerStore.updateEvidenceExtraction()` method, `ExtractionRefreshed` event type, persistence into `voucher.extracted_fields`.

### UI follow-ups from Track B Phase 7 (2026-05-26 fix passes)

The data-layer work shipped contract surfaces ahead of the UI. These items capture the UI work that the API now expects but no web component consumes yet. None block merge.

| #   | Surface                              | What the API exposes                                                                                                                                                                 | UI work needed                                                                                                                                                                                           | Priority                                   |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | **Compliance alerts list**           | `POST /api/compliance-watch/refresh` returns `ComplianceAlert[]` with new fields: `kind`, `severity`, `status`, `targetId?`, `body?`                                                 | Render alert chips by `severity`; show `targetId` as a deep-link to the voucher; filter or tab between `open`/`acknowledged`/`resolved`/`dismissed`                                                      | P1 — compliance is a real UX surface       |
| 2   | **System-vs-human attribution**      | Auto-resolved alerts have `resolved_by = "system:auto-resolver"`; human dismissals will use the real `userId`                                                                        | Render `system:auto-resolver` as "Auto-resolved by system" (with an icon), NOT as a username lookup. Same pattern applies anywhere `actor_id` could be a sentinel (e.g. `system-ai`, `system-extractor`) | P1 — bad audit-trail UX otherwise          |
| 3   | **Acknowledged / dismissed actions** | The widened `complianceAlertSchema.status` enum permits `acknowledged` (reviewed but not resolved) and `dismissed` (user-acknowledged terminal state). NO route writes these yet     | Add `POST /api/compliance-alerts/:id/acknowledge` + `/dismiss` routes; corresponding UI buttons. The auto-resolver respects `dismissed` (Rule 24) so a user dismiss survives next refresh                | P2 — useful but not required for v1        |
| 4   | **Resolved-history toggle**          | `/api/compliance-watch/refresh` defaults to `open + acknowledged` only; `?includeResolved=true` returns everything                                                                   | Add a "Show resolved" toggle that re-requests with the query param. Default off                                                                                                                          | P2                                         |
| 5   | **Simulation preview UI**            | `POST /api/simulations/run` accepts `{ reviewIds, action }` and returns `balanceDelta` + `vatDelta` + `affectedAccounts` (the real read-only diff, not the prior fabricated numbers) | Today queue: multi-select reviews → "Preview impact" → modal showing the delta table. Maps to spec Piece 3 from the Phase 7 design                                                                       | P1 — directly improves the review workflow |
| 6   | **Simulation 404 handling**          | `runSimulation` throws `ReviewNotFoundError` → HTTP 404 if any `reviewId` doesn't resolve                                                                                            | UI must handle 404 (caller error) distinctly from 5xx (server error). Don't show "server broken" for a stale review ID after navigation                                                                  | P2                                         |
| 7   | **Knowledge query citations**        | `/api/knowledge/query` now returns `citations: []` (was leaking scaffold citation). When the real AI advisor (IA Phase 6) lands, it needs its own citation source                    | When wiring Cmd-K Advisor: ensure the knowledge route fetches citations from Azure AI Search results, not from `assistantExamples`                                                                       | P2 — only relevant when Cmd-K ships        |
| 8   | **Bounded MemoryStore alerts**       | `MemoryLedgerStore.alerts` is capped at 500 entries with seeded alerts pinned; auto-detected entries evict oldest first                                                              | Demo runs with churn now have a stable upper bound — no UI work, just be aware that very-old alerts may not appear in long demo sessions                                                                 | Informational                              |

**Convention reminders for the eventual UI sprint:**

- CONVENTIONS Rule 17 — clone before mutating any state returned by `getSnapshot()`. The Memory store is a singleton in demo mode; in-place mutation leaks across requests.
- CONVENTIONS Rule 20 — never render a system sentinel (`system:*`, `system-ai`, `system-extractor`) as a username; show "Auto" / "System" with appropriate context.
- CONVENTIONS Rule 26 — default to active state; opt into historical with an explicit toggle.

### Forward-looking plans (preserved under `docs/superpowers/plans/`)

These captured the future-work intent from the `deploy` lineage and were ported in PR-H so they survive the `deploy` reset. None are scheduled; pick one when starting a new sprint.

| Plan                                                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Unified radius](./superpowers/plans/2026-04-01-unified-radius.md)                                                                               | Not started; PR-D1 introduced `--radius: 0.75rem` but did not refactor existing bespoke radii to consume it                                                                                                                                                                                                                                                                                      |
| [IA restructure](./superpowers/plans/2026-05-13-ia-restructure.md)                                                                               | **Foundation landed in PR-D3** (5-tab nav, ambient digest, NuqsAdapter). Remaining: settings depth, Today filter persistence in URL state, Books drill-downs                                                                                                                                                                                                                                     |
| [Track A Phase 5 — Capture](./superpowers/plans/2026-05-19-track-a-phase-5-capture.md)                                                           | **LANDED 2026-05-28** — `/capture` has QuickAddGrid, DraftsTable (with promote-to-ledger), EvidenceArchiveTable (TanStack search + drill-through), evidence detail route at `/capture/evidence/[id]`, E2E spec in `tests/e2e/capture.spec.ts`. PWA share_target redirects to `/capture` via `app/share/route.ts`. Real blob upload pipeline still needs wiring once Azure Storage RBAC unblocks. |
| [Track A Phase 6 — Advisor (Cmd-K)](./superpowers/plans/2026-05-19-track-a-phase-6-advisor.md)                                                   | Not started. Existing command palette is the seed; the real advisor surface is unbuilt                                                                                                                                                                                                                                                                                                           |
| [Track A Phase 7 — Reports](./superpowers/plans/2026-05-19-track-a-phase-7-reports.md)                                                           | Not started. `/reports` exists but lacks drill-downs                                                                                                                                                                                                                                                                                                                                             |
| [Track A Phase 8 — Settings depth + simulations](./superpowers/plans/2026-05-19-track-a-phase-8-settings.md)                                     | **Partially landed in PR-D2** (layout + sidebar + company form). 7 sub-pages are stubs                                                                                                                                                                                                                                                                                                           |
| [Postgres hardening](./superpowers/plans/2026-05-19-supabase-hardening.md) + [follow-ups](./superpowers/plans/2026-05-20-hardening-followups.md) | Plans were written against the retired `SupabaseLedgerStore` lineage; reuse the _intent_ (RLS verification, fail-closed auth, JWT-gated mutations) when auditing the live `PostgresLedgerStore`. `SupabaseLedgerStore` no longer exists in code.                                                                                                                                                 |

Design specs for these plans live under [`docs/superpowers/specs/`](./superpowers/specs/) (unified-radius-design, shadcn-setup-design, ia-restructure-design, track-a-finish-ia-design).
