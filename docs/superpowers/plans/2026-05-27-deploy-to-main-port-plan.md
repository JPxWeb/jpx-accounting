# Deploy → Main Port Plan

> **Status:** Survey complete; ready for execution. No code changes yet.
> **Created:** 2026-05-27 (post-survey)
> **Branch state:** `deploy` is 107 commits ahead of `origin/main`; `origin/main` is 30 commits ahead of `deploy`. PR #14 (deploy → main) is open but `CONFLICTING` because the architectures have materially diverged.

## Why this plan exists

`deploy` shipped Track A IA + Supabase backend + Track B Phase 7 (data-layer parity for `SupabaseLedgerStore`) over the last several months. In parallel, `main` was refactored:

- The **Supabase write path was replaced** with a direct `postgres-js` driver: new `packages/persistence-postgres`, `PostgresLedgerStore` is the canonical store.
- The `supabase/` directory was **deleted** (no migrations, no `config.toml` on main).
- **Document Intelligence** was added (`packages/document-intelligence`, Azure REST client).
- Web app shipped via **Docker** instead of zip-deploy.
- A typed **error envelope** landed (`packages/contracts/src/api-errors.ts`, `jsonError()` helper in `app.ts`).

Net result: deploy's `SupabaseLedgerStore` and its 8 supabase migrations are **dead code** on main. The PR cannot be merged mechanically — every "fix in `supabase-store.ts`" needs to be re-applied to `PostgresLedgerStore` instead. The conventions, design specs, contract additions, pure domain helpers, and Memory store work all port cleanly, but the persistence-layer work needs reimplementation.

This document captures the port strategy in tractable phases. Phase A (docs cherry-pick) can ship today. Phases B–H are the implementation work and should be executed as a fresh sprint with its own plan + test gates.

---

## What lives where after the port

| Concept                 | Lives on main today                                                                         | Where deploy work lands                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical write store   | `PostgresLedgerStore` (postgres-js direct, `sql.begin` transactions)                        | Extended with `refreshComplianceAlerts`, real `runSimulation`, `getCompanySettings`/`putCompanySettings`, `buildAssistantScaffold` delegation |
| `LedgerStore` interface | Async, 14 methods                                                                           | + `refreshComplianceAlerts`, + `getCompanySettings`, + `putCompanySettings`                                                                   |
| Migrations              | NOT in `supabase/` (likely raw SQL in `packages/persistence-postgres/` — verify in Phase F) | New `compliance_alert_keys` and `projection_aggregates` migrations ported to main's runner                                                    |
| Error handling          | Typed envelope via `jsonError()` + branches in `onError`                                    | `ReviewNotFoundError` added as domain class + onError branch returning the typed envelope                                                     |
| Pure domain functions   | `bas`, `rules`, `projections`, `hash-chain`, `ids`                                          | + `assistant.ts`, `compliance.ts`, `simulation.ts` (architecture-neutral)                                                                     |
| Web app                 | Docker-deployed; ESLint stack; partial shadcn                                               | + Track A IA shell, dock nav, Today/Books/Reports/Settings, zodResolver Zod-v4 fix                                                            |
| Docs                    | DEV_STATUS, CLAUDE.md, architecture.md                                                      | + CONVENTIONS.md (26 rules), Phase 7 design spec + plan, UI follow-ups                                                                        |

---

## Cherry-pick classification (Phase 7 commits)

| Commit                            | Subject                                                       | Class                                                                                                         | Notes                                                                            |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `c3cea90`                         | docs(status): UI follow-ups                                   | **CLEAN**                                                                                                     | DEV_STATUS only                                                                  |
| `7fe05d4`                         | docs(conventions): 11 rules                                   | **CLEAN**                                                                                                     | CONVENTIONS Rules 15-26                                                          |
| `766cbc0`                         | fix: 15 second-pass review findings                           | **HEAVY**                                                                                                     | Touches supabase-store; intent ports to PostgresLedgerStore                      |
| `19ca3fa`                         | docs: CONVENTIONS.md 14 rules                                 | **CLEAN**                                                                                                     | CONVENTIONS Rules 1-14                                                           |
| `4da1883`                         | fix: 15 code-review findings                                  | **HEAVY**                                                                                                     | Touches supabase-store; intent ports                                             |
| `c98c7c3`                         | docs(status): Phase 7 landed                                  | **CLEAN**                                                                                                     | Rewrite for the port-aware status                                                |
| `072113a`                         | feat(api): /compliance-watch/refresh actually refreshes       | **LIGHT**                                                                                                     | Port to main's app.ts after refreshComplianceAlerts lands on PostgresLedgerStore |
| `3daf7b2`                         | feat(domain): refreshComplianceAlerts on M+S+U                | **LIGHT** Memory; **HEAVY** Postgres; **N/A** Supabase                                                        |
| `69138f8`                         | feat(domain,supabase): alert schema + detection + dedup index | **LIGHT** (contracts + Memory + helper); **OBSOLETED** (Supabase migration → port to main's migration runner) |
| `68a8f3b`                         | refactor(domain): shared buildAssistantScaffold               | **LIGHT**                                                                                                     | Add `assistant.ts` to main's domain                                              |
| `a3d318b`                         | feat(domain): real runSimulation in both stores               | **LIGHT** Memory; **HEAVY** Postgres                                                                          |
| `6f080b3`                         | feat(supabase): enable supa_audit                             | **OBSOLETED**                                                                                                 | No `supabase/` on main; main likely doesn't use supa_audit                       |
| `b50f5ea`                         | fix(web): zodResolver Zod v4 overload bug                     | **CLEAN**                                                                                                     | Web-only                                                                         |
| `4dec542`                         | feat(scripts): rebuild projections                            | **OBSOLETED**                                                                                                 | Supabase-specific; rewrite as postgres-js script if needed                       |
| `cd425d1` / `f3f6134` / `254a986` | docs(plan + spec)                                             | **CLEAN**                                                                                                     | Historical Phase 7 plan + spec                                                   |
| `9c3f30c`                         | refactor(domain): date handling + audit attribution           | **HEAVY**                                                                                                     | Touches supabase-store                                                           |
| `2f13b89`                         | fix(api,domain): NotImplemented→501; defense-in-depth scoping | **LIGHT** api; **HEAVY** supabase-store scoping → Postgres                                                    |
| `a6c0d04`                         | docs(web): proxy rationale                                    | **CLEAN**                                                                                                     | Comment-only                                                                     |
| `d214e70`                         | refactor(api): LEDGER_STORE_UNAVAILABLE_REASON const          | **LIGHT**                                                                                                     | Small string-const dedup                                                         |
| `0272f4c`                         | refactor(domain): shared today() helper                       | **LIGHT**                                                                                                     | Clean port if main doesn't already have it                                       |

### Earlier work (non-Phase-7)

- **Track A IA** (~40 commits, Today/Capture/Books/Reports/Settings shell, dock nav, nuqs, shadcn primitives, react-hook-form, Sonner): **CLEAN** — pure web layer.
- **Supabase backend track** (commits like `efea3d0`, `736a5e6`, `9a1ba6c`, `fa5425f`): **OBSOLETED** — code is dead on main; CONCEPTS (per-request store, JWT claim scoping, defense-in-depth) need re-application against main's auth/store shape.
- **a11y + tokens + radius** (~10 commits): **CLEAN** — web/tokens only.
- **Chore (Husky, Biome, .editorconfig, Cursor rules)**: **LIGHT** — main has equivalents; may need conflict resolution.
- **Auth claim hardening** (`f7fc5d6`, `c89c6be`): **HEAVY** — main rewrote `index.ts`; re-apply the _intent_ (fail-closed on missing org/workspace, sentinel for `skipAuthVerification`) against main's auth shape.

---

## Named conflicts (must resolve explicitly during port)

1. **`ReviewNotFoundError` vs main's typed error envelope.** Deploy throws a domain class caught by `app.onError` → 404. Main uses a unified `jsonError()` envelope with `code` + `requestId`. **Resolution:** keep `ReviewNotFoundError` as a domain class; the onError branch calls `jsonError(c, err.message, runtimeMode, 404, { code: "REVIEW_NOT_FOUND" })`.
2. **`/api/compliance-watch/refresh`** — main stubs as `getSnapshot().alerts`; deploy has the real implementation. Port deploy's route body **after** `refreshComplianceAlerts` lands on PostgresLedgerStore.
3. **`runSimulation` contract surface** — deploy added `balanceDelta`/`vatDelta` fields + `reviewIds` input. Additive Zod fields are safe to add to main's contracts, but main's PostgresLedgerStore stub returns empty arrays → contract validation in api-client breaks until the stub is replaced.
4. **`complianceAlertSchema` field expansion** — main's stub returns `ComplianceAlert[]` with 5 fields; deploy's 5 new optional fields are safe to add (Zod parse won't fail on omission), but stub data won't populate them.
5. **`supabase-store.ts` bug fixes** — every deploy commit "fixing supabase-store" carries content that must be re-applied to PostgresLedgerStore: org-scoped-first queries, single round-trip patterns, batched suggestion lookups, audit attribution from `ctx.userId`, no fabricated simulation data, NotImplemented→501 mapping.
6. **Settings/company endpoint** — deploy added `GET/PUT /api/settings/company`; main's `app.ts` lacks the route entirely. Need to extend the interface (already in plan), add the PostgresLedgerStore methods, and wire the route.
7. **Biome reformats** — both branches use Biome; mechanical reformats may produce textual conflicts where neither side changed semantics. Resolve by re-running `biome format --write` after the merge.

---

## Recommended port order (Phases A–H)

### Phase A — Docs and conventions (CLEAN, ship today)

**Effort:** 30 min. **Zero conflict.** Ships immediately as PR-1.

1. Create a new branch off `origin/main` (e.g. `port/phase-7-docs`).
2. Cherry-pick (in commit order):
   - `c3cea90` — UI follow-ups
   - `7fe05d4` — CONVENTIONS Rules 15-26
   - `19ca3fa` — CONVENTIONS Rules 1-14
   - `254a986`, `f3f6134`, `cd425d1` — Phase 7 spec + plan + revision
   - `a6c0d04` — proxy rationale comment
   - `c98c7c3` — DEV_STATUS phase 7 marker (will need a tweak — see below)
3. `c98c7c3` claims "Phase 7 Done" referencing the SupabaseLedgerStore impl that doesn't exist on main. Edit the DEV_STATUS update to instead reference: _"Phase 7 design + conventions landed via port; PostgresLedgerStore implementation tracked separately as the next sprint."_
4. Open PR-1 → main. Should typecheck + lint clean.

### Phase B — Contracts (additive Zod fields)

**Effort:** 1 hour. **Low risk** (additive).

1. From the port branch, manually apply contract extensions on top of main's `packages/contracts/src/index.ts`:
   - `simulationRunSchema`: + `balanceDelta`, `vatDelta`
   - `simulationRequestSchema`: + `reviewIds` (min 1, max 50), action enum
   - `complianceAlertSchema`: + `kind`, `severity`, `status` (4 values), `targetId?`, `body?`
2. Add `companySettingsSchema` (extracted from deploy `packages/contracts/src/index.ts`).
3. Add `userProfileSchema` if main lacks it.
4. Re-run typecheck. Any breakage means main consumers need updating.

### Phase C — Domain layer (architecture-neutral pure functions)

**Effort:** 2 hours.

1. Add `packages/domain/src/assistant.ts` (`buildAssistantScaffold`).
2. Add `packages/domain/src/compliance.ts` (`detectComplianceIssues`, `detectComplianceIssuesDetailed`, deterministic IDs, NaN guard, timezone-safe slicing, per-record error isolation).
3. Add `packages/domain/src/simulation.ts` (`simulateApprovals` — pure function).
4. Add `packages/domain/src/voucher-draft.ts`, `posting.ts`, `ledger-line.ts`, `extraction.ts` ONLY if main's MemoryLedgerStore doesn't already have equivalents. Check first.
5. Add `ReviewNotFoundError` class to `packages/domain/src/store.ts`.
6. Extend `LedgerStore` interface: + `refreshComplianceAlerts`, `getCompanySettings`, `putCompanySettings`.
7. Update `MemoryLedgerStore`:
   - Implement `refreshComplianceAlerts` with immutable-update + bounded-accumulation semantics
   - Replace `runSimulation` with real implementation (dedup input, throw `ReviewNotFoundError`)
   - Replace inline `answerAssistantQuestion` body with `buildAssistantScaffold` delegation
   - Implement `getCompanySettings`/`putCompanySettings`
8. Add the unit tests from deploy (`tests/unit/compliance.test.ts`, `simulation.test.ts`, `assistant.test.ts`) — they're architecture-neutral.

### Phase D — PostgresLedgerStore extensions (the heavy lift)

**Effort:** 3-4 hours, biggest risk.

1. Replace `runSimulation` stub: load reviews/vouchers by `reviewIds` via postgres-js (`sql.begin` for read consistency), hydrate suggestions via FK lookup, call `simulateApprovals(...)`, append `SimulationExecuted` event, return result. Dedup input. Throw `ReviewNotFoundError` on miss.
2. Add `refreshComplianceAlerts`:
   - Load workspace reviews + vouchers
   - Call `detectComplianceIssues`
   - Upsert detected alerts (ON CONFLICT on `(org, ws, kind, target_id)` with `NULLS NOT DISTINCT`)
   - Clear `resolved_at`/`resolved_by` on reopen
   - Mark previously-open auto-detected alerts as resolved when condition cleared, using `'system:auto-resolver'` sentinel
   - Read back filtered to active states
3. Replace `answerAssistantQuestion` stub with `buildAssistantScaffold` delegation + DB insert.
4. Add `getCompanySettings` / `putCompanySettings` (postgres-js queries; ensure org-scoped).
5. Apply the 30+ fixes embedded in deploy's cleanup commits:
   - Org-scoped first query (CONVENTIONS Rule 11)
   - Batched suggestion lookups (avoid N+1)
   - Audit `actor_id` from `ctx.userId` (not request body)
   - No fabricated simulation data
   - NotImplemented → 501 mapping
   - Defense-in-depth `.eq("organization_id", ...)` filters
   - Parallel queries where independent
6. Add `runSimulation` test, `refreshComplianceAlerts` test, parity assertions to `tests/integration/postgres-ledger.test.ts`.

### Phase E — API surface

**Effort:** 1 hour.

1. Replace `/api/compliance-watch/refresh` stub with real call: `await store.refreshComplianceAlerts()`; respect `?includeResolved=true` default-exclude.
2. Add `GET /api/settings/company` + `PUT /api/settings/company` routes.
3. Add `ReviewNotFoundError` branch in `onError` returning `jsonError(..., 404, { code: "REVIEW_NOT_FOUND" })`.
4. Apply `LEDGER_STORE_UNAVAILABLE_REASON` const dedup if main doesn't have it.
5. Verify `NotImplementedError → 501` mapping is present (likely already is).

### Phase F — Migrations

**Effort:** 1 hour. **Requires checking main's migration runner first.**

1. Discover where main keeps schema migrations (likely `packages/persistence-postgres/migrations/` — verify).
2. Port the `compliance_alert_keys` migration: add `kind`, `target_id`, `severity` (default 'info' + CHECK as separate statement), `body` columns; unique index `(org, ws, kind, target_id) NULLS NOT DISTINCT`.
3. Port the `projection_aggregates` triggers migration (perf-critical for getReports).
4. **Skip `supa_audit` migration** — main moved off Supabase-managed extensions; row-history via supa_audit doesn't apply. If main has its own audit story, use that.

### Phase G — Web

**Effort:** 2 hours (depending on conflicts).

1. Cherry-pick `b50f5ea` (zodResolver Zod v4 overload fix) — clean.
2. Survey what Track A IA work is missing on main. Cherry-pick in order; resolve conflicts as encountered.
3. **STOP** if conflicts get hairy — Track A IA was 40+ commits and main may have ported parts already. Re-survey rather than mechanically applying.

### Phase H — Tests

**Effort:** 1 hour.

1. Merge `supabase-ledger.test.ts` assertions into `postgres-ledger.test.ts` (don't duplicate the file).
2. Drop `api-normal-mode.test.ts` if main has equivalent; otherwise port.
3. Update Playwright `tests/e2e/api.spec.ts` simulation payload to use `reviewIds + action` (deploy already did this; cherry-pick or re-apply).
4. Verify `pnpm test:integration` passes against a local postgres-js setup.

---

## Skip entirely (OBSOLETED)

- `efea3d0` (supabase-client package)
- `736a5e6` (SupabaseLedgerStore)
- `9a1ba6c` (Supabase runtime wiring)
- `fa5425f` (Supabase config integration)
- `6f080b3` (supa_audit migration)
- `4dec542` (Supabase rebuild-projections script)
- All `fix(domain,supabase): ...` commits — their _intent_ lives on inside Phase D/E; the code is dead.

---

## Risks and mitigations

| Risk                                                                            | Mitigation                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase D port misses a subtle invariant from the original Supabase fixes         | Cross-reference every PostgresLedgerStore method against deploy's `supabase-store.ts` line-by-line; use the per-commit diffs from `git log --oneline 9c3f30c..HEAD packages/domain/src/supabase-store.ts` as a checklist |
| Migration runner mismatch (main may not have a tracked migration system at all) | Phase F starts with discovery; if main applies SQL ad-hoc, the port becomes a runbook entry instead of a migration file                                                                                                  |
| Track A IA cherry-picks conflict on Tailwind/shadcn versions                    | Cherry-pick web commits oldest-first and rebase Tailwind config changes manually; main may have absorbed equivalent migrations                                                                                           |
| `complianceAlertSchema` widening breaks main's mock data                        | Defaults in `mapComplianceAlertRow ?? "info"`/`?? "open"` already handle this — port the mapper alongside the schema                                                                                                     |
| Test coverage regresses                                                         | Maintain a "tests must port" list per phase; don't merge a phase until its tests are green                                                                                                                               |

---

## Decision points for the user

Before starting Phase B:

- **Discovery:** confirm whether main's migration runner is `packages/persistence-postgres/migrations/` or something else (the survey couldn't tell)
- **Auth shape:** check whether main's `services/api/src/index.ts` rewrite changed the `skipAuthVerification` sentinel pattern
- **Track A IA status:** assess whether main already has a partial Today/Books/Reports shell or whether deploy's IA work fully ports
- **Settings/company:** confirm if main has any company-settings work at all

Before starting Phase D:

- **Dedicated sprint or in-line execution?** Phase D alone is 3-4 hours of careful porting. A dedicated PR with its own design checkpoint is recommended.

---

## Total effort estimate

| Phase                    | Effort     | Risk     |
| ------------------------ | ---------- | -------- |
| A (docs)                 | 30 min     | None     |
| B (contracts)            | 1 hr       | Low      |
| C (domain pure + Memory) | 2 hr       | Low      |
| D (PostgresLedgerStore)  | 3-4 hr     | **High** |
| E (API routes)           | 1 hr       | Low      |
| F (migrations)           | 1 hr       | Medium   |
| G (web cherry-picks)     | 2 hr       | Medium   |
| H (tests)                | 1 hr       | Low      |
| **Total**                | **~12 hr** | —        |

Phases A through C are landable as a single PR with low risk. Phase D should be its own PR with extra review. Phases E-H land together as a final PR that completes parity.

---

## Recommended next action

Execute **Phase A** (docs cherry-pick) immediately — zero risk, immediate value. Then schedule Phases B–H as a fresh sprint with its own design checkpoint before Phase D.

**Do not** close PR #14 yet — it carries useful history and reviewer context. Mark it as superseded by this port plan in the PR description, and link to the new PR-1 (Phase A) when it opens.
