# Development Status

**Last reviewed:** 2026-05-27 (post-merge)
**Purpose:** Track phase completion, ported work, and open UI follow-ups. Update at the end of each phase.

> This file was created during the Phase 7 port from `deploy` → `main` (PR-A docs cherry-pick). Earlier phase-by-phase status from the `deploy` branch is preserved only by reference; the canonical implementation now lives on `main` and uses `PostgresLedgerStore` rather than the obsoleted `SupabaseLedgerStore` lineage. See [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](./superpowers/plans/2026-05-27-deploy-to-main-port-plan.md) for the full survey and [`docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md`](./superpowers/plans/2026-05-27-port-phase-7-to-main.md) for the executable plan.
>
> **Phase 7 port status (2026-05-27):** PR-A (#15), PR-B (#16), PR-C (#17) all squash-merged into `main`. Original `deploy → main` PR #14 closed as superseded. **The data-layer port is complete.** Remaining `deploy` work is the Track A IA web sprint (PR-D) — out of scope for the current port.

## Verification baseline

Run before opening any PR:

```bash
pnpm typecheck         # all workspace packages (10 workspaces)
pnpm test:unit         # node:test + tsx unit suite (tests/unit/**)
pnpm lint              # ESLint (Biome migration is planned, not yet done)
pnpm format:check      # Prettier
pnpm build             # web + API
pnpm test:e2e          # Playwright (builds first; demo API on 3201, web on 3200)
```

`pnpm check` runs the full `lint → format:check → typecheck → test:unit → build` chain.

Integration tests against a real Postgres are gated on `SUPABASE_DB_URL`:

```bash
SUPABASE_DB_URL=<local-postgres-url> pnpm test:integration
```

An additional `pnpm typecheck:tests` script (typechecking files under `tests/`) was introduced in PR-B and is now part of the gate.

---

## Phase 7 port status

| PR       | Scope                                                                                                                                | Status                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **PR-A** | Docs cherry-pick (CONVENTIONS, Phase 7 spec + plans, this DEV_STATUS)                                                                | **MERGED** [#15](https://github.com/JPxWeb/jpx-accounting/pull/15)    |
| **PR-B** | Contracts, pure domain helpers, `MemoryLedgerStore` extensions, API routes, migration `0004`                                         | **MERGED** [#16](https://github.com/JPxWeb/jpx-accounting/pull/16)    |
| **PR-C** | `PostgresLedgerStore` real implementations (`runSimulation`, `refreshComplianceAlerts`, `answerAssistantQuestion`, company settings) | **MERGED** [#17](https://github.com/JPxWeb/jpx-accounting/pull/17)    |
| **PR-D** | Track A IA web cherry-picks (separate sprint)                                                                                        | Out of scope; see "Remaining deploy work" below for scope information |

**PR #14** (original `deploy → main`) closed as superseded. Phase 7 data-layer port is complete on `main`.

### Post-merge follow-ups

- **Manual integration test** against a live Postgres before the next deploy: `SUPABASE_DB_URL=... pnpm test:integration` to exercise the 4 new round-trips (`runSimulation` real diff + `ReviewNotFoundError`, `answerAssistantQuestion` persists, `refreshComplianceAlerts` idempotency, settings round-trip).
- **Migration 0004** applies cleanly to PG ≥ 15 (Supabase ships PG 17). Coordinate with the schema owner before applying to production.

---

## Remaining deploy work (PR-D scope, future sprint)

109 commits remain on `deploy` that did not make it to `main` via the Phase 7 port. Categorized:

| Bucket                                                                 | Approx count | Disposition                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 7 work (already ported)**                                      | ~25          | Landed via PR-A/B/C. The deploy SHAs differ from the squash-merge SHAs on main, so `git log` still shows them as "ahead" — but the content is in.                                                                                                                                                                     |
| **Obsoleted — SupabaseLedgerStore lineage**                            | ~10          | Never to be ported (`efea3d0`, `736a5e6`, `9a1ba6c`, `fa5425f`, `6f080b3`, `4dec542`, etc.). Code is dead on `main`'s `PostgresLedgerStore` architecture.                                                                                                                                                             |
| **Worth-porting perf/cleanup ideas (Supabase impls, port the intent)** | ~5           | `b4082de` (projection aggregates via trigger), `7fa1887` (parallel queries on getEvidenceContext), `757c701` (getReviewFeed batched suggestion lookups), `10844e2` (suggestVoucher org-scoped gate), `3f8298f` (settings audit attribution). Apply the _intent_ to `PostgresLedgerStore` in a small follow-up sprint. |
| **Track A IA web work**                                                | ~40          | The PR-D sprint. nuqs, react-hook-form, shadcn primitives (form, table, tabs, sidebar, skeleton), Sonner, settings layout with sub-navigation, Books page with tab dispatch, ambient digest parallel route, Today per-card actions, a11y improvements, axe-core E2E.                                                  |
| **Chore / setup**                                                      | ~10          | Biome, Husky + lint-staged, .editorconfig, Cursor rules, GitHub Actions SHA pinning, Stop hooks. Some overlap with what main has; needs per-commit conflict resolution.                                                                                                                                               |
| **Unified radius / shadcn theme**                                      | ~6           | Design-token additions that pair with the shadcn primitives bundle.                                                                                                                                                                                                                                                   |

Main's web app today has the `(shell)` route group, `app-shell.tsx`, `command-palette.tsx`, providers, PWA, and screens, plus React Query 5, Motion 12, and Tailwind 4 — but **no** shadcn/ui, **no** nuqs, **no** react-hook-form, **no** Sonner, **no** tanstack-table. PR-D's bigger commits add these primitives + reorganize the screens to use them. Recommend surveying conflicts before sprinting; main may have absorbed parts of the IA shape independently.

---

## UI follow-ups from Track B Phase 7 (2026-05-26 fix passes)

The data-layer work shipped contract surfaces ahead of the UI. These items capture the UI work that the API now expects but no web component consumes yet. None block merge; they are the "first thing to wire when building the compliance / simulation UI."

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

- CONVENTIONS Rule 17 — clone before mutating any state returned by `getSnapshot()`. The Memory store is a singleton in demo mode; in-place mutation leaks across requests
- CONVENTIONS Rule 20 — never render a system sentinel (`system:*`, `system-ai`, `system-extractor`) as a username; show "Auto" / "System" with appropriate context
- CONVENTIONS Rule 26 — default to active state; opt into historical with an explicit toggle
