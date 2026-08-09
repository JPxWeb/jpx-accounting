# Wave Hygiene Report — F-5 / F-6 / F-7 / F-10

**Branch / worktree:** `feat/post-wave-c-hygiene` @ `.worktrees/feat-post-wave-c-hygiene`  
**Base:** `origin/main` @ `3604ba5`  
**Date:** 2026-08-06  
**Parked (per brief):** F-9, Plat-1  
**Skipped (per brief):** F-1–F-4, F-8; no messages/share/D′/G′/docs-truth edits

---

## Verdict

| ID           | Status              | Notes                                                                               |
| ------------ | ------------------- | ----------------------------------------------------------------------------------- |
| **F-5**      | **DONE**            | Not blocked by D′ (clean at `origin/main`, no dirty store files)                    |
| **F-6**      | **DONE**            | Joyride `next/dynamic`; `check:seams` in CI; script fail-closed + Windows path-safe |
| **F-7**      | **DONE**            | Orphaned assistant retired; ghost `packages/supabase-client/` deleted + gitignored  |
| **F-10**     | **DONE** (optional) | `scripts/visual-baselines.md` refreshed only — no snapshot updates                  |
| F-9 / Plat-1 | PARKED              | Per ownership brief                                                                 |

---

## F-5 — Break `store` ↔ `store-planning` cycle

**BLOCKED_ON_D?** No. `.worktrees/feat-post-wave-c-d-prime` was at `3604ba5` with a clean tree; no overlapping edits.

**Design:**

1. New `packages/domain/src/store-shared.ts` holds helpers planners need (`buildPostingLines`, `resolveReviewDecisionEdit`, `mergeExtractedFields`, `recomputeVoucherFields`, `DEMO_ACTOR_ID`, `ActorAttribution`, `ReviewAction`, date/VAT helpers, etc.).
2. `store-planning.ts` imports from `./store-shared` (not `./store`).
3. `store.ts` imports planners from `./store-planning` and re-exports shared helpers for in-package `./store` consumers (e.g. `simulation.ts`) and the public barrel.
4. **Memory `planComplianceMerge` parity:** `MemoryLedgerStore.refreshComplianceAlerts` now uses `planComplianceMerge` for shared `resolveIds`. Memory-only extras kept and documented: reopen of resolved-still-detected auto alerts, and `MEMORY_ALERT_CAP` trim (Postgres has no in-memory cap).

**Cycle check:** `store` → `store-planning` → `store-shared` (no edge back to `store`).

---

## F-6 — Joyride lazy-load + CI seams

- `onboarding-shell.tsx`: `Joyride` via `next/dynamic(() => import("react-joyride").then(m => m.Joyride), { ssr: false })`; `STATUS` / `Step` stay static.
- `package.json`: `"check:seams": "bash scripts/check-seams.sh"`.
- `.github/workflows/ci.yml`: **Check architectural seams** step after Lint.
- `scripts/check-seams.sh`: fails if `rg` missing; normalizes `\`→`/` so Windows allowlists work (previous `-v` path filter false-failed on `apps\web\...`).

Verified locally: `bash scripts/check-seams.sh` → `check-seams: all grep gates passed`.

---

## F-7 — Retire orphaned assistant (P2-6) + ghost package

**Removed:**

- `LedgerStore.answerAssistantQuestion` + Memory/Postgres/`UnavailableLedgerStore` impls
- `packages/domain/src/assistant.ts` (`buildAssistantScaffold`) + barrel export
- `assistantRequestSchema` / `AssistantRequest`
- `scripts/db-seed.mts` assistant turn + fixture
- `tests/unit/assistant.test.ts`; PG `answerAssistantQuestion` integration test
- Rule-17 unit test rewritten to alerts-only + empty `assistantExamples`

**Staged wire compat:** `workspaceSnapshotSchema.assistantExamples` → `.default([])`; both stores return `[]`.  
**Kept:** `ledger.assistant_sessions` table/migrations (append-only history).

**Ghost package:** deleted untracked `c:\git\jpx-accounting\packages\supabase-client\` (stray `node_modules`); `.gitignore` adds `packages/supabase-client/`.

Live-code grep for `answerAssistantQuestion|buildAssistantScaffold|assistantRequestSchema` (excluding docs): **0 hits**.

---

## F-10 — Visual baselines doc

`scripts/visual-baselines.md` “Known limitation” updated for post–Wave C masks: residual issue is **row-count reflow**, not unmasked clock text; notes demo-seed `"now"` as durable fix. **No** `--update-snapshots`.

---

## Verification

| Gate                             | Result                                 |
| -------------------------------- | -------------------------------------- |
| `pnpm typecheck` (11 workspaces) | pass                                   |
| `pnpm typecheck:tests`           | pass                                   |
| `pnpm test:unit`                 | **463/463** pass                       |
| `pnpm lint`                      | pass (1 pre-existing TanStack warning) |
| `bash scripts/check-seams.sh`    | pass                                   |

Not run here (orchestrator / gate owner): full `pnpm check` build half, E2E, visual.

---

## Files touched (hygiene worktree)

- `packages/domain/src/store-shared.ts` **(new)**
- `packages/domain/src/{store,store-planning,index}.ts`; **deleted** `assistant.ts`
- `packages/contracts/src/index.ts`
- `packages/persistence-postgres/src/store.ts`
- `services/api/src/runtime.ts`
- `apps/web/components/onboarding/onboarding-shell.tsx`
- `scripts/{check-seams.sh,db-seed.mts,visual-baselines.md}`
- `.github/workflows/ci.yml`, `package.json`, `.gitignore`
- `tests/unit/ledger-store.test.ts`; **deleted** `tests/unit/assistant.test.ts`
- `tests/integration/postgres-ledger.test.ts`
