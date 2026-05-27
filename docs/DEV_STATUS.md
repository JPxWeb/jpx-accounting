# Development Status

**Last reviewed:** 2026-05-27
**Purpose:** Track phase completion, ported work, and open UI follow-ups. Update at the end of each phase.

> This file was created during the Phase 7 port from `deploy` → `main` (PR-A docs cherry-pick). Earlier phase-by-phase status from the `deploy` branch is preserved only by reference; the canonical implementation now lives on `main` and uses `PostgresLedgerStore` rather than the obsoleted `SupabaseLedgerStore` lineage. See [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](./superpowers/plans/2026-05-27-deploy-to-main-port-plan.md) for the full survey and [`docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md`](./superpowers/plans/2026-05-27-port-phase-7-to-main.md) for the executable plan.

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

> **Note:** a dedicated `pnpm typecheck:tests` script (typechecking files under `tests/`) does not exist on main yet. PR-B introduces a `tests/tsconfig.json` + a `typecheck:tests` workspace script as a prerequisite for the new test files it adds.

---

## Phase 7 port status

| PR       | Scope                                                                                                                                | Status            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **PR-A** | Docs cherry-pick (CONVENTIONS, Phase 7 spec + plans, this DEV_STATUS)                                                                | **This PR**       |
| **PR-B** | Contracts, pure domain helpers, `MemoryLedgerStore` extensions, API routes, migration `0004`                                         | Pending           |
| **PR-C** | `PostgresLedgerStore` real implementations (`runSimulation`, `refreshComplianceAlerts`, `answerAssistantQuestion`, company settings) | Pending           |
| **PR-D** | Track A IA web cherry-picks (separate sprint)                                                                                        | Out of scope here |

Phase 7 design + conventions land via PR-A; the `PostgresLedgerStore` implementation is tracked by PR-B/PR-C. PR #14 (`deploy → main`) remains open as historical context and will be closed as superseded once PR-C merges.

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
