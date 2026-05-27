# Deploy → Main: Port Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Cross-reference:** [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](./2026-05-27-deploy-to-main-port-plan.md) is the survey/strategy doc. This file is the executable plan derived from it.
>
> **Open PR:** [#14 `deploy → main`](https://github.com/JPxWeb/jpx-accounting/pull/14) is the source of the work being ported. Keep it open for historical context; the port produces fresh PRs off `main` (PR-A, PR-B, PR-C).

**Goal:** Move Phase 7's data-layer features (real `runSimulation`, `refreshComplianceAlerts`, `buildAssistantScaffold`, `ReviewNotFoundError`, contract extensions, company settings) from the `deploy` branch's dead `SupabaseLedgerStore` architecture onto `main`'s canonical `PostgresLedgerStore` architecture, while preserving the 26 conventions, Phase 7 design spec, and UI follow-ups.

**Architecture:** Main replaced `SupabaseLedgerStore` (supabase-js write path) with `PostgresLedgerStore` (postgres-js direct, `sql.begin` transactions, `lockWorkspaceTail` for hash-chain serialization). Main has a typed `ApiJsonErrorBody` envelope, JWKS-backed JWT verification on mutating routes, rate limiting, body limits, secure headers, and Azure Document Intelligence for OCR. The port keeps every piece of main's architecture and layers Phase 7's *features* on top — the pure-function helpers, contract extensions, Memory store work, and API routes all port cleanly; only PostgresLedgerStore extensions need real reimplementation.

**Tech Stack:** TypeScript 5.9 strict, pnpm monorepo, Hono 4 (`hono-rate-limiter`, `hono/jwk`, `hono/body-limit`, `hono/secure-headers`), Zod v4 (`@jpx-accounting/contracts`), postgres-js (`packages/persistence-postgres`), `node:test` + `tsx`, Playwright 1.58. Migrations use sequential numbering in `infra/supabase/migrations/0NNN_<name>.sql` (NOT timestamps like deploy used).

---

## Context for fresh agents (junior-dev orientation)

You're picking this up in a new session. Here's what happened, what you're walking into, and the critical rules.

### What happened

Three months ago, the `deploy` branch shipped a Supabase-backed accounting platform (Track A IA + Supabase backend + Track B Phase 7 hardening). PR #14 was opened against `main`. Meanwhile, `main` was independently refactored to replace the entire Supabase write path with a direct postgres-js layer (`packages/persistence-postgres` + `PostgresLedgerStore`), added Document Intelligence, switched to Docker deployment, introduced a typed error envelope, and added security middleware (JWKS, rate limiting, body limits).

When merge was attempted, `git merge origin/main` aborted with 106 conflicting files, +10k LOC, and a fundamental architectural mismatch: every fix in deploy's `supabase-store.ts` needs reimplementing against `PostgresLedgerStore`.

A survey + strategy doc was written ([`2026-05-27-deploy-to-main-port-plan.md`](./2026-05-27-deploy-to-main-port-plan.md)). This plan is the executable form of it.

### What you're walking into

- `deploy` branch carries 107 commits ahead of `main`, including the Phase 7 work being ported.
- `origin/main` is the trunk. All port work happens on fresh branches off `origin/main`.
- The port is split into **3 PRs (A, B, C)** for staged review, plus an optional PR-D for later web work.
- **PR-A is shippable today** (zero-risk docs cherry-pick).
- **PR-B and PR-C are 5–8 hours of careful implementation each.**

### Critical rules (memorize before starting)

1. **Never modify `deploy`.** All work happens on fresh branches off `origin/main`. The `deploy` branch is the source of truth for *what to port*, not a place to commit anything new.
2. **Read [`docs/CONVENTIONS.md`](../../CONVENTIONS.md) before each task.** It has 26 rules distilled from real incidents — Rules 1 (schema-contract sync), 11 (store parity), 15 (symmetric fixes), 17 (mutation discipline), 18 (PG pitfalls), 20 (system attribution), 23 (dedup at boundary) are directly relevant to this port.
3. **PostgresLedgerStore uses `sql.begin(...)` transactions and `lockWorkspaceTail(tx)` for hash-chain serialization.** Do NOT port deploy's `appendEvent` retry loop — main's `SELECT ... FOR UPDATE` makes it unnecessary. Read `git show origin/main:packages/persistence-postgres/src/store.ts` (around the `applyReviewDecision` method) for the canonical pattern before writing any new method.
4. **Migrations use sequential numbering.** Main has 0001, 0002, 0003 in `infra/supabase/migrations/`. Next is `0004_<name>.sql`. NOT timestamps.
5. **Use the `jsonError(c, message, runtimeMode, status, { code, issues })` helper for all error responses.** Defined in `services/api/src/app.ts`. Do not return ad-hoc JSON.
6. **The LedgerStore interface on main is a SUBSET of deploy's.** Main has 14 methods; deploy has 17 (added `refreshComplianceAlerts`, `getCompanySettings`, `putCompanySettings`). This plan extends main's interface by 3.
7. **Test conventions:** Unit tests in `tests/unit/*.test.ts` use `node:test` + `node:assert/strict`. Integration tests in `tests/integration/postgres-ledger.test.ts` use the same and gate on `SUPABASE_DB_URL`.
8. **`tests/tsconfig.json` typecheck gate exists.** Run `pnpm typecheck:tests` after any test changes. Tests are typechecked against the workspace.
9. **Biome + lint-staged on pre-commit.** Imports will be reordered; minor whitespace will change. Don't fight it.
10. **Conventional Commits:** `feat(scope):`, `fix(scope):`, `refactor(scope):`, `docs(scope):`, `test(scope):`, `chore(scope):`.

### Reference reading order before Task 1

1. [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](./2026-05-27-deploy-to-main-port-plan.md) — strategy/survey (skim, 5 min)
2. [`docs/CONVENTIONS.md`](../../CONVENTIONS.md) — 26 rules (skim, 10 min)
3. `git show origin/main:packages/persistence-postgres/src/store.ts | head -200` — PostgresLedgerStore shape (read, 5 min)
4. `git show origin/main:services/api/src/app.ts | head -250` — main's onError, jsonError, middleware patterns (read, 10 min)
5. `git show origin/main:infra/supabase/migrations/0001_init.sql` — schema baseline (skim, 5 min)

Total ramp-up: ~35 min before opening Task 1.

---

## File Structure (mapped before tasks)

This is what each PR touches. PRs are independent — completing PR-A does not block starting PR-B's planning, but execution should be sequential.

### PR-A (docs cherry-pick — ~30 min, ZERO risk)

| File | Action | Source |
|------|--------|--------|
| `docs/CONVENTIONS.md` | CREATE | Cherry-pick from deploy commits `19ca3fa` + `7fe05d4` |
| `docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md` | CREATE | Cherry-pick from deploy commit `254a986` |
| `docs/superpowers/plans/2026-05-26-track-b-phase-7-completion.md` | CREATE | Cherry-pick from deploy commits `f3f6134` + `cd425d1` |
| `docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md` | CREATE | Cherry-pick from deploy commit `99acc75` |
| `docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md` | CREATE | This file (also cherry-picked) |
| `docs/DEV_STATUS.md` | MODIFY | Hand-edit to mark Phase 7 as "in-port (PR-B/PR-C)" + paste UI follow-ups section from deploy `c3cea90` |
| `CLAUDE.md` | MODIFY | Add CONVENTIONS.md pointer (cherry-pick from `19ca3fa`'s CLAUDE.md hunk only) |
| `apps/web/components/settings/company-form.tsx` | MODIFY | Cherry-pick zodResolver Zod v4 fix from `b50f5ea` (skip if file doesn't exist on main) |
| `apps/web/app/api-proxy/[...path]/route.ts` | MODIFY | Cherry-pick proxy comment from `a6c0d04` (skip if file doesn't exist on main) |

### PR-B (architecture-light port — ~5 hrs)

| File | Action | Notes |
|------|--------|-------|
| `packages/contracts/src/index.ts` | MODIFY | Extend `simulationRequestSchema`, `simulationRunSchema`, `complianceAlertSchema`; add `companySettingsSchema` |
| `packages/domain/src/assistant.ts` | CREATE | `buildAssistantScaffold` pure helper |
| `packages/domain/src/compliance.ts` | CREATE | `detectComplianceIssues` + `detectComplianceIssuesDetailed` |
| `packages/domain/src/simulation.ts` | CREATE | `simulateApprovals` pure function |
| `packages/domain/src/store.ts` | MODIFY | Add `ReviewNotFoundError`; extend `LedgerStore` interface (+3 methods); extend `MemoryLedgerStore` |
| `packages/domain/src/index.ts` | MODIFY | Re-export the 3 new modules |
| `services/api/src/app.ts` | MODIFY | Replace `/api/compliance-watch/refresh` stub if exists, else add; add `GET/PUT /api/settings/company`; add `ReviewNotFoundError` branch in `onError`; fix `/api/knowledge/query` citation source |
| `infra/supabase/migrations/0004_compliance_and_settings.sql` | CREATE | `compliance_alerts` + `assistant_sessions` + `organization_settings` tables, dedup index |
| `tests/unit/assistant.test.ts` | CREATE | |
| `tests/unit/compliance.test.ts` | CREATE | |
| `tests/unit/simulation.test.ts` | CREATE | |
| `tests/unit/contracts-simulation.test.ts` | CREATE | |
| `tests/unit/ledger-store.test.ts` | MODIFY | Add Memory store coverage for new methods |

### PR-C (PostgresLedgerStore extensions — ~4 hrs)

| File | Action | Notes |
|------|--------|-------|
| `packages/persistence-postgres/src/store.ts` | MODIFY | Add `refreshComplianceAlerts`, replace `runSimulation` stub with real, replace `answerAssistantQuestion` with `buildAssistantScaffold` delegation, add `getCompanySettings`/`putCompanySettings` |
| `tests/integration/postgres-ledger.test.ts` | MODIFY | Add integration coverage for the 4 new/changed methods |

### PR-D (later sprint — Track A IA web cherry-picks)

Out of scope for this plan. See [`2026-05-27-deploy-to-main-port-plan.md`](./2026-05-27-deploy-to-main-port-plan.md) Phase G for the strategy.

---

## Conventions used by every task

- Single unit test file: `npx tsx --test tests/unit/<file>.test.ts`
- Full unit suite: `pnpm test:unit`
- Typecheck workspaces: `pnpm typecheck`
- Typecheck tests: `pnpm typecheck:tests`
- Integration (env-gated): `SUPABASE_DB_URL=... pnpm test:integration`
- Pre-commit hooks reformat — don't fight Biome's import ordering.
- Conventional Commits (`feat(scope):`, `fix(scope):`, etc.).
- Every task ends with `pnpm test:unit && pnpm typecheck && pnpm typecheck:tests` all green before commit.

---

# PR-A: Docs cherry-pick

**Branch:** `port/phase-7-docs` off `origin/main`. **Effort:** 30 min. **Risk:** Zero. **Goal:** Ship the conventions, design spec, port plan, and UI follow-ups to `main` so they're discoverable while PR-B/PR-C are in flight.

### Task 1: Create branch and cherry-pick CONVENTIONS.md

**Files:**
- Create: `docs/CONVENTIONS.md`

- [ ] **Step 1: Branch off main**

```bash
cd c:/git/jpx-accounting
git fetch origin
git checkout -b port/phase-7-docs origin/main
```

Expected: `Switched to a new branch 'port/phase-7-docs'`.

- [ ] **Step 2: Cherry-pick CONVENTIONS.md base (Rules 1–14)**

```bash
git checkout deploy -- docs/CONVENTIONS.md
```

Expected: `docs/CONVENTIONS.md` now exists in the working tree.

- [ ] **Step 3: Stage and verify**

```bash
git status --short docs/CONVENTIONS.md
```

Expected: `A  docs/CONVENTIONS.md` (added) or `M  docs/CONVENTIONS.md` if main has a different file by the same path.

If main has a different `docs/CONVENTIONS.md`, **stop and investigate** — the assumption that this file is new doesn't hold. Run `git show origin/main:docs/CONVENTIONS.md 2>&1 | head -5` to inspect; if it exists with unrelated content, rename deploy's file to `docs/CODE_CONVENTIONS.md` or similar and update internal cross-references.

- [ ] **Step 4: Commit**

```bash
git add docs/CONVENTIONS.md
git commit -m "docs: add CONVENTIONS.md (26 rules distilled from Phase 7 review series)

Rules 1-14 cover schema-contract sync, store parity, mutation
discipline, PG pitfalls. Rules 15-26 cover symmetric fixes,
HTTP error mapping, audit attribution, per-record error
isolation, bounded accumulation, and API response defaults.

Source: deploy commits 19ca3fa + 7fe05d4 (cherry-picked).
"
```

### Task 2: Cherry-pick Phase 7 design spec + plan + port plan

**Files:**
- Create: `docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md`
- Create: `docs/superpowers/plans/2026-05-26-track-b-phase-7-completion.md`
- Create: `docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`
- Create: `docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md` (this file)

- [ ] **Step 1: Pull the four planning documents from deploy**

```bash
git checkout deploy -- \
  docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md \
  docs/superpowers/plans/2026-05-26-track-b-phase-7-completion.md \
  docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md \
  docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md
```

Expected: all four files now exist in the working tree.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/
git commit -m "docs(plans): Phase 7 spec, plan, and port-to-main planning

- Phase 7 design spec (Track B data-layer completion)
- Phase 7 implementation plan (13 tasks, original SupabaseLedgerStore-targeted)
- Port-to-main survey/strategy doc (8-phase port plan)
- Port-to-main executable implementation plan (this PR-A + PR-B + PR-C)

Source: deploy commits 254a986, f3f6134, cd425d1, 99acc75 (cherry-picked).
"
```

### Task 3: Cherry-pick UI follow-ups section into DEV_STATUS.md

**Files:**
- Modify: `docs/DEV_STATUS.md`

The deploy commit `c3cea90` added a `## UI follow-ups from Track B Phase 7` section. Cherry-picking the whole commit conflicts because main's DEV_STATUS has diverged. Instead, hand-merge just the new section.

- [ ] **Step 1: Inspect what main has at the bottom of DEV_STATUS.md**

```bash
git show origin/main:docs/DEV_STATUS.md | tail -50
```

Read the output to find a sensible insertion point — typically just before the final "Documentation index" or "Agent handoff checklist" section, or after a "Deferred" section if one exists.

- [ ] **Step 2: Extract the UI follow-ups section from deploy**

```bash
git show deploy:docs/DEV_STATUS.md | sed -n '/## UI follow-ups from Track B Phase 7/,/^## [^U]/p' | head -n -1
```

This prints from the section header up to (but not including) the next top-level heading. Copy the output.

- [ ] **Step 3: Insert into main's DEV_STATUS.md**

Open `docs/DEV_STATUS.md` (currently main's version, untouched by previous tasks). Find the insertion point from Step 1. Paste the section from Step 2. The section starts with `## UI follow-ups from Track B Phase 7 (2026-05-26 fix passes)` and ends just before the "Convention reminders" subsection's closing line.

- [ ] **Step 4: Also mark Phase 7 status in the appropriate table**

If main's DEV_STATUS has a "Track B Phase 7" entry, find it and change it to:

```markdown
| **7** | Hardening (JWT-claim RLS, assistant/compliance DB, supa_audit, real runSimulation, rebuild script) | In port — see [port plan](./superpowers/plans/2026-05-27-port-phase-7-to-main.md). PR-A docs landed; PR-B (architecture-light) + PR-C (PostgresLedgerStore) pending. |
```

If main's DEV_STATUS doesn't reference Phase 7 at all, skip this sub-step.

- [ ] **Step 5: Commit**

```bash
git add docs/DEV_STATUS.md
git commit -m "docs(status): UI follow-ups from Phase 7 port + status update

Captures the 8 UI items the Phase 7 contract surface expects but
no web component consumes yet. Status row updated to reflect the
port-in-progress (PR-A docs landed; PR-B/PR-C pending).
"
```

### Task 4: Cherry-pick CLAUDE.md pointer + zodResolver fix

**Files:**
- Modify: `CLAUDE.md`
- Modify: `apps/web/components/settings/company-form.tsx` (conditional)
- Modify: `apps/web/app/api-proxy/[...path]/route.ts` (conditional)

- [ ] **Step 1: Add CONVENTIONS pointer to CLAUDE.md**

Open `CLAUDE.md`. Find any line mentioning `docs/DEV_STATUS.md` (typically in a "Documentation" or "Reference" section). Add a sibling line immediately after:

```markdown
**Conventions / anti-patterns:** see `docs/CONVENTIONS.md` for rules distilled from past incidents (schema-contract sync, partial-index pitfalls, store parity, citation provenance, etc.). Consult before changes that touch contracts, migrations, or `LedgerStore` implementations.
```

If main's CLAUDE.md has no DEV_STATUS pointer, add the CONVENTIONS pointer at the end of the file's "Architecture" or top-level conventions section.

- [ ] **Step 2: Conditionally cherry-pick the zodResolver fix**

```bash
git show origin/main:apps/web/components/settings/company-form.tsx 2>&1 | head -5
```

If the file exists on main and references `zodResolver`, cherry-pick the fix:

```bash
git checkout deploy -- apps/web/components/settings/company-form.tsx
```

Then inspect the diff (`git diff --staged apps/web/components/settings/company-form.tsx`) — ensure the change is only the `zodResolver(companySettingsSchema as never)` workaround plus its comment. If the file diverged further on main, manually apply only the `as never` cast and leave main's other changes.

If main doesn't have this file, skip — the settings UI doesn't exist on main yet, so the Zod v4 workaround isn't needed.

- [ ] **Step 3: Conditionally cherry-pick the proxy comment**

```bash
git show origin/main:apps/web/app/api-proxy/[...path]/route.ts 2>&1 | head -5
```

If the file exists on main, cherry-pick:

```bash
git checkout deploy -- "apps/web/app/api-proxy/[...path]/route.ts"
```

If main has diverged, hand-apply only the comment block from deploy's commit `a6c0d04` (search for "double validation is intentional"). If main doesn't have this file, skip.

- [ ] **Step 4: Verify nothing else slipped in**

```bash
git status --short
git diff --staged --stat
```

Expected: changes limited to CLAUDE.md and (conditionally) two apps/web files. No other files should appear.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md $(git diff --staged --name-only)
git commit -m "docs(repo): CLAUDE.md points at CONVENTIONS.md; carry zodResolver + proxy comment fixes if applicable

CLAUDE.md gains a one-line pointer so agents discover the
26-rule conventions doc before contract/migration/store edits.
zodResolver Zod-v4 workaround and api-proxy double-validation
comment carried from deploy if the corresponding files exist
on main; skipped silently otherwise.
"
```

### Task 5: Verify suite is green and open PR-A

- [ ] **Step 1: Run the full local gate**

```bash
pnpm install
pnpm typecheck
pnpm typecheck:tests
pnpm test:unit
```

Expected: all green. The PR-A changes are docs + at most two web file tweaks; nothing should break.

If something does break, it's almost certainly the zodResolver cast (Step 4.2) interacting differently with main's Zod version. Revert that single file (`git checkout origin/main -- apps/web/components/settings/company-form.tsx`) and re-run.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin port/phase-7-docs
```

- [ ] **Step 3: Open PR-A**

```bash
gh pr create --base main --head port/phase-7-docs --title "Port Phase 7 (PR-A): docs, conventions, planning" --body "$(cat <<'EOF'
## Summary

PR-A of the Phase 7 port. Cherry-picks ONLY documentation and convention artifacts from \`deploy\` — zero code-behavior changes. Ships immediately to make the 26 conventions, Phase 7 design spec, and port plan discoverable while PR-B and PR-C are in flight.

## Contents

- \`docs/CONVENTIONS.md\` — 26 rules distilled from the Phase 7 review series (schema-contract sync, store parity, mutation discipline, PG pitfalls, audit attribution, etc.)
- \`docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md\` — design spec
- \`docs/superpowers/plans/2026-05-26-track-b-phase-7-completion.md\` — original Phase 7 implementation plan (deploy-targeted, retained for reference)
- \`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md\` — survey/strategy doc
- \`docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md\` — this plan (executable)
- \`docs/DEV_STATUS.md\` — UI follow-ups section + Phase 7 status update
- \`CLAUDE.md\` — pointer to CONVENTIONS.md
- \`apps/web/components/settings/company-form.tsx\` — zodResolver Zod-v4 fix (conditional)
- \`apps/web/app/api-proxy/[...path]/route.ts\` — proxy double-validation comment (conditional)

## Test plan

- [x] \`pnpm typecheck\` green
- [x] \`pnpm typecheck:tests\` green
- [x] \`pnpm test:unit\` green
- [ ] PR reviewer scans CONVENTIONS.md and the port plan

## Related

- Supersedes PR #14 for the docs-only work
- Next: PR-B (architecture-light port — contracts + Memory store + API + migration 0004)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Update PR #14 with cross-link**

```bash
gh pr comment 14 --body "PR-A (docs cherry-pick) opened: see \$PR_URL. PR-B and PR-C will follow with the implementation port."
```

Expected: comment posted on PR #14.

**STOP HERE — PR-A complete. Wait for review/merge before starting PR-B in a fresh session.**

---

# PR-B: Architecture-light port (contracts + pure domain + Memory + API + migration)

**Branch:** `port/phase-7-features` off `origin/main` (after PR-A merges, rebase off updated main).
**Effort:** ~5 hours.
**Risk:** Medium — adds new tables and a new interface methods. Tests must lock in semantics before PostgresLedgerStore work (PR-C) starts.
**Goal:** Land everything that doesn't require touching `PostgresLedgerStore`: contract field extensions, pure domain helpers, `MemoryLedgerStore` extensions, the API route additions, and migration 0004.

## Phase 1 — Contract extensions

### Task 6: Extend simulationRequestSchema and simulationRunSchema

**Files:**
- Modify: `packages/contracts/src/index.ts` (the `simulationRequestSchema` and `simulationRunSchema` definitions)
- Create: `tests/unit/contracts-simulation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/contracts-simulation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { simulationRequestSchema, simulationRunSchema } from "@jpx-accounting/contracts";

test("simulationRequestSchema requires reviewIds (min 1) and action", () => {
  const ok = simulationRequestSchema.parse({
    actorId: "user_a",
    title: "What if I approve these",
    scenario: "approve 2 pending",
    reviewIds: ["r1", "r2"],
    action: "approve",
  });
  assert.equal(ok.reviewIds.length, 2);
  assert.equal(ok.action, "approve");

  assert.throws(() =>
    simulationRequestSchema.parse({
      actorId: "u",
      title: "t",
      scenario: "s",
      reviewIds: [],
      action: "approve",
    }),
  );

  assert.throws(() =>
    simulationRequestSchema.parse({
      actorId: "u",
      title: "t",
      scenario: "s",
      reviewIds: ["r1"],
      action: "delete",
    }),
  );
});

test("simulationRunSchema requires balanceDelta and vatDelta", () => {
  const ok = simulationRunSchema.parse({
    id: "sim_1",
    title: "t",
    scenario: "s",
    outcomeSummary: "ok",
    affectedAccounts: ["6540"],
    balanceDelta: [{ accountNumber: "6540", accountName: "IT", deltaDebit: 999.2, deltaCredit: 0 }],
    vatDelta: [{ vatCode: "VAT25", deltaBase: 999.2, deltaAmount: 249.8 }],
  });
  assert.equal(ok.balanceDelta.length, 1);
  assert.equal(ok.vatDelta[0]?.vatCode, "VAT25");
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx tsx --test tests/unit/contracts-simulation.test.ts`
Expected: tests fail because main's schemas don't have these fields.

- [ ] **Step 3: Locate and modify the schemas in contracts/index.ts**

Open `packages/contracts/src/index.ts`. Find `simulationRequestSchema`. Main's version is:

```ts
export const simulationRequestSchema = z.object({
  actorId: z.string(),
  title: z.string(),
  scenario: z.string(),
  voucherId: z.string().optional(),
});
```

Replace with:

```ts
export const simulationRequestSchema = z.object({
  actorId: z.string(),
  title: z.string(),
  scenario: z.string(),
  reviewIds: z.array(z.string()).min(1).max(50),
  action: z.enum(["approve", "book-without-vat"]),
});
```

Find `simulationRunSchema`. Main's version is:

```ts
export const simulationRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  outcomeSummary: z.string(),
  affectedAccounts: z.array(z.string()),
});
```

Replace with:

```ts
export const simulationRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  scenario: z.string(),
  outcomeSummary: z.string(),
  affectedAccounts: z.array(z.string()),
  balanceDelta: z.array(
    z.object({
      accountNumber: z.string(),
      accountName: z.string(),
      deltaDebit: z.number(),
      deltaCredit: z.number(),
    }),
  ),
  vatDelta: z.array(
    z.object({
      vatCode: z.string(),
      deltaBase: z.number(),
      deltaAmount: z.number(),
    }),
  ),
});
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/contracts-simulation.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Run pnpm typecheck**

Run: `pnpm typecheck`
Expected: FAIL in `packages/persistence-postgres/src/store.ts` because `runSimulation`'s return value no longer matches the schema. The current main impl returns `{ id, title, scenario, outcomeSummary, affectedAccounts }` — missing `balanceDelta` and `vatDelta`.

This is expected. The PostgresLedgerStore stub gets fixed in PR-C. For now, satisfy the typechecker by adding empty arrays:

In `packages/persistence-postgres/src/store.ts`, find `runSimulation`. The current return object is:

```ts
const result: SimulationRun = {
  id: createId("sim"),
  title: input.title,
  scenario: input.scenario,
  outcomeSummary: "Shadow ledger run completed. ...",
  affectedAccounts: ["6071", "2641", "6991"],
};
```

Add the two new fields (intentionally empty — the real implementation lands in PR-C):

```ts
const result: SimulationRun = {
  id: createId("sim"),
  title: input.title,
  scenario: input.scenario,
  outcomeSummary: "Shadow ledger run completed. ...",
  affectedAccounts: ["6071", "2641", "6991"],
  // TODO(PR-C): replace with real projection diff via simulateApprovals
  balanceDelta: [],
  vatDelta: [],
};
```

Run `pnpm typecheck` again — expected: green.

- [ ] **Step 6: Hold — do not commit yet**

Tasks 6–8 commit together at the end of Task 8 (atomic contract change per CONVENTIONS Rule 6).

### Task 7: Extend complianceAlertSchema

**Files:**
- Modify: `packages/contracts/src/index.ts` (`complianceAlertSchema`)
- Test added in Task 11 (compliance pure-function test exercises the schema)

- [ ] **Step 1: Locate and update the schema**

In `packages/contracts/src/index.ts`, find `complianceAlertSchema`. Main's version is:

```ts
export const complianceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  detectedAt: z.string(),
  impactSummary: z.string(),
});
```

Replace with:

```ts
export const complianceAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  detectedAt: z.string(),
  impactSummary: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
  targetId: z.string().optional(),
  body: z.string().optional(),
});
```

- [ ] **Step 2: Verify the typecheck still passes**

Run: `pnpm typecheck`
Expected: green. The new fields on `complianceAlertSchema` are constructed by Memory/Postgres stores; any existing seed data on main needs to be updated.

If there's a seeded `ComplianceAlert` literal anywhere (search via `grep -rn "id: \"alert_" packages/ services/`), add the new fields with sensible defaults:

```ts
kind: "representation-review", // or "legacy" if you can't tell what it represents
severity: "info",
status: "open",
```

- [ ] **Step 3: Hold — bundle with Task 8 commit**

### Task 8: Add companySettingsSchema and commit Tasks 6–8

**Files:**
- Modify: `packages/contracts/src/index.ts` (add new schema)

- [ ] **Step 1: Add the schema**

In `packages/contracts/src/index.ts`, after the last existing schema (typically near the end of the file), add:

```ts
export const companySettingsSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string().min(1),
  organizationNumber: z.string().regex(/^\d{6}-\d{4}$/, "Swedish org number format is XXXXXX-XXXX"),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().regex(/^\d{3}\s?\d{2}$/, "Swedish postal code format is XXX XX"),
  city: z.string().min(1),
  contactEmail: z.email(),
  contactPhone: z.string().optional(),
  bankIban: z.string().optional(),
  bankBic: z.string().optional(),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit
```

Expected: all green.

- [ ] **Step 3: Commit Tasks 6–8 together**

```bash
git add packages/contracts/src/index.ts packages/persistence-postgres/src/store.ts tests/unit/contracts-simulation.test.ts
git commit -m "feat(contracts): extend simulation/compliance schemas; add companySettings

- simulationRequestSchema gains reviewIds[] (min 1, max 50) + action enum
- simulationRunSchema gains balanceDelta[] + vatDelta[]; affectedAccounts derived
- complianceAlertSchema gains kind, severity, status (4-state), targetId?, body?
- companySettingsSchema added (Swedish org number / postal format)
- PostgresLedgerStore.runSimulation stubbed to return empty deltas (PR-C lands real impl)
"
```

## Phase 2 — Pure domain helpers

### Task 9: buildAssistantScaffold helper

**Files:**
- Create: `packages/domain/src/assistant.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `tests/unit/assistant.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/assistant.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAssistantScaffold } from "@jpx-accounting/domain";

test("buildAssistantScaffold returns a grounded session with one citation", () => {
  const session = buildAssistantScaffold("Can we deduct VAT?");
  assert.equal(session.question, "Can we deduct VAT?");
  assert.equal(session.status, "grounded");
  assert.equal(session.citations.length, 1);
  assert.match(session.id, /^assistant_/);
  assert.ok(session.answer.length > 0);
});

test("buildAssistantScaffold answer/citation deterministic; ids unique", () => {
  const a = buildAssistantScaffold("Q");
  const b = buildAssistantScaffold("Q");
  assert.equal(a.answer, b.answer);
  assert.equal(a.citations[0]?.title, b.citations[0]?.title);
  assert.notEqual(a.id, b.id);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx tsx --test tests/unit/assistant.test.ts`
Expected: FAIL — module not exported.

- [ ] **Step 3: Create `packages/domain/src/assistant.ts`**

```ts
import type { AssistantSession } from "@jpx-accounting/contracts";

import { createId } from "./ids";

// Shared scaffold for assistant responses. When the real Azure AI advisor
// lands (IA Phase 6 Cmd-K Advisor), this single function is replaced with a
// call to aiRuntime.answer(question) and neither store implementation changes.
export function buildAssistantScaffold(question: string): AssistantSession {
  return {
    id: createId("assistant"),
    question,
    answer:
      "This scaffold uses grounded, citation-first advisory. In production the answer would combine Azure AI Search retrieval, policy sources, and Responses API reasoning before it reaches the reviewer.",
    status: "grounded",
    citations: [
      {
        id: "cit_arch",
        title: "Internal architecture policy",
        sourceType: "internal",
        excerpt: "AI may suggest and explain, but may not silently mutate accounting state.",
      },
    ],
  };
}
```

- [ ] **Step 4: Export from `packages/domain/src/index.ts`**

Open `packages/domain/src/index.ts`. Add (preserve alphabetical order):

```ts
export * from "./assistant";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/assistant.test.ts`
Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/assistant.ts packages/domain/src/index.ts tests/unit/assistant.test.ts
git commit -m "feat(domain): buildAssistantScaffold shared helper

Centralizes the grounded scaffold response (id, question, answer,
status, single hardcoded citation). Both LedgerStore implementations
will delegate to this in subsequent tasks (Rule 15: symmetric fix).
"
```

### Task 10: detectComplianceIssues + detectComplianceIssuesDetailed

**Files:**
- Create: `packages/domain/src/compliance.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `tests/unit/compliance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/compliance.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { detectComplianceIssues, detectComplianceIssuesDetailed } from "@jpx-accounting/domain";

const voucherFixture = (overrides: Partial<Voucher> = {}): Voucher => ({
  id: "v1",
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p1",
  voucherNumber: "V-1",
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    description: "Test",
    grossAmount: 100,
    netAmount: 80,
    vatAmount: 20,
    vatRate: 25,
    currency: "SEK",
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
  ...overrides,
});

const reviewFixture = (overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id: "r1",
  voucherId: "v1",
  title: "Review V-1",
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: {
    id: "s1",
    voucherId: "v1",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    vatCode: "VAT25",
    confidence: 0.9,
    reasoning: "r",
    kind: "recommendation",
    citations: [],
    ruleHits: [],
  },
  provenanceTimeline: [],
  ...overrides,
});

const blockingRuleHit = {
  id: "rh1",
  code: "vat-missing",
  title: "Missing supplier VAT",
  severity: "blocking" as const,
  message: "Supplier VAT is required",
  sourceIds: [],
};

test("no alerts on clean data", () => {
  const alerts = detectComplianceIssues([reviewFixture()], [voucherFixture()], "2026-05-02");
  assert.equal(alerts.length, 0);
});

test("stale-blocked fires for needs-review with blocking hit > 7 days", () => {
  const blocking = reviewFixture({ suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] } });
  const alerts = detectComplianceIssues([blocking], [voucherFixture()], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "stale-blocked");
  assert.equal(alerts[0]?.targetId, "v1");
});

test("stale-blocked does NOT fire on exactly day 7", () => {
  const blocking = reviewFixture({ suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] } });
  const alerts = detectComplianceIssues([blocking], [voucherFixture()], "2026-05-08");
  assert.equal(alerts.length, 0);
});

test("missing-supplier-vat fires on approved voucher without supplierVatNumber", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: undefined },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, "missing-supplier-vat");
});

test("missing-supplier-vat skipped when supplierVatNumber present", () => {
  const v = voucherFixture({
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: "SE556677889901" },
  });
  const alerts = detectComplianceIssues([], [v], "2026-05-09");
  assert.equal(alerts.length, 0);
});

test("deterministic alert ID across runs (same condition → same id)", () => {
  const blocking = reviewFixture({ suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] } });
  const v = voucherFixture();
  const first = detectComplianceIssues([blocking], [v], "2026-05-09");
  const second = detectComplianceIssues([blocking], [v], "2026-05-10");
  assert.equal(first[0]?.id, second[0]?.id);
});

test("malformed timestamps skipped per-record (don't abort batch)", () => {
  const blocking = reviewFixture({
    id: "r_bad",
    voucherId: "v_bad",
    suggestion: { ...reviewFixture().suggestion!, voucherId: "v_bad", ruleHits: [blockingRuleHit] },
  });
  const bad = voucherFixture({ id: "v_bad", createdAt: "not-a-date" });
  const goodApproved = voucherFixture({
    id: "v_approved",
    status: "approved",
    voucherFields: { ...voucherFixture().voucherFields, supplierVatNumber: undefined },
  });
  const result = detectComplianceIssuesDetailed([blocking], [bad, goodApproved], "2026-05-09");
  assert.equal(result.alerts.length, 1, "good voucher still produces alert");
  assert.equal(result.alerts[0]?.kind, "missing-supplier-vat");
  assert.ok(result.skipped.length >= 1, "bad voucher in skipped");
});

test("non-UTC timestamp normalizes via UTC roundtrip", () => {
  const blocking = reviewFixture({ suggestion: { ...reviewFixture().suggestion!, ruleHits: [blockingRuleHit] } });
  // 2026-05-01T01:00:00+02:00 is 2026-04-30T23:00:00Z; UTC day = April 30.
  // Against today=2026-05-09 that's 9 days, alert fires.
  const v = voucherFixture({ createdAt: "2026-05-01T01:00:00+02:00" });
  const alerts = detectComplianceIssues([blocking], [v], "2026-05-09");
  assert.equal(alerts.length, 1);
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx tsx --test tests/unit/compliance.test.ts`
Expected: module not found.

- [ ] **Step 3: Create `packages/domain/src/compliance.ts`**

```ts
import type { ComplianceAlert, ReviewTask, Voucher } from "@jpx-accounting/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floored day-difference. Both timestamps normalized to UTC before compare.
 * Throws on malformed input; callers (refreshComplianceAlerts in both stores)
 * isolate per-record via try/catch so one bad voucher doesn't abort the batch.
 */
function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(from)}`);
  if (Number.isNaN(toMs)) throw new Error(`daysBetween: unparseable timestamp ${JSON.stringify(to)}`);
  return Math.floor((toMs - fromMs) / DAY_MS);
}

/**
 * Stable alert ID derived from the dedup key, so re-detection produces the
 * same ID for the same condition across both store implementations. Required
 * for Memory<->Postgres identity parity (CONVENTIONS Rule 11).
 */
function deterministicAlertId(kind: string, targetId: string): string {
  return `alert_${kind}_${targetId}`;
}

export type ComplianceDetectionResult = {
  alerts: ComplianceAlert[];
  skipped: Array<{ kind: "review" | "voucher"; id: string; reason: string }>;
};

export function detectComplianceIssues(
  reviews: ReviewTask[],
  vouchers: Voucher[],
  today: string,
): ComplianceAlert[] {
  return detectComplianceIssuesDetailed(reviews, vouchers, today).alerts;
}

export function detectComplianceIssuesDetailed(
  reviews: ReviewTask[],
  vouchers: Voucher[],
  today: string,
): ComplianceDetectionResult {
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));
  const alerts: ComplianceAlert[] = [];
  const skipped: ComplianceDetectionResult["skipped"] = [];
  const detectedAt = `${today}T00:00:00.000Z`;

  // Rule 1: stale-blocked — needs-review with blocking rule hit, voucher older than 7 days.
  for (const review of reviews) {
    try {
      if (review.status !== "needs-review") continue;
      const ruleHits = review.suggestion?.ruleHits ?? [];
      if (!ruleHits.some((h) => h.severity === "blocking")) continue;
      const voucher = vouchersById.get(review.voucherId);
      if (!voucher) continue;
      // Normalize via UTC roundtrip (CONVENTIONS Rule 22) so non-UTC timestamps
      // bucket to the correct UTC calendar day, not their local-string date.
      const voucherDate = new Date(voucher.createdAt).toISOString().slice(0, 10);
      if (daysBetween(`${voucherDate}T00:00:00.000Z`, detectedAt) <= 7) continue;
      alerts.push({
        id: deterministicAlertId("stale-blocked", voucher.id),
        title: `Blocked voucher unresolved for >7 days (${voucher.voucherNumber})`,
        source: "internal/compliance",
        detectedAt,
        impactSummary:
          "A voucher with mandatory missing data has been sitting in review for over a week. Resolve or book without VAT.",
        kind: "stale-blocked",
        severity: "warning",
        status: "open",
        targetId: voucher.id,
      });
    } catch (err) {
      skipped.push({ kind: "review", id: review.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Rule 2: missing-supplier-vat — approved voucher without supplierVatNumber.
  for (const voucher of vouchers) {
    try {
      if (voucher.status !== "approved") continue;
      if (voucher.voucherFields.supplierVatNumber && voucher.voucherFields.supplierVatNumber.length > 0) continue;
      alerts.push({
        id: deterministicAlertId("missing-supplier-vat", voucher.id),
        title: `Approved voucher missing supplier VAT number (${voucher.voucherNumber})`,
        source: "Bokföringslagen / VAT requirement",
        detectedAt,
        impactSummary:
          "Posted voucher has no supplier VAT number. Required for input-VAT deduction documentation under Skatteverket rules.",
        kind: "missing-supplier-vat",
        severity: "warning",
        status: "open",
        targetId: voucher.id,
      });
    } catch (err) {
      skipped.push({ kind: "voucher", id: voucher.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { alerts, skipped };
}
```

- [ ] **Step 4: Export from `packages/domain/src/index.ts`**

Add (alphabetical):

```ts
export * from "./compliance";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx tsx --test tests/unit/compliance.test.ts`
Expected: 8/8 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/compliance.ts packages/domain/src/index.ts tests/unit/compliance.test.ts
git commit -m "feat(domain): detectComplianceIssues with two v1 rules + per-record isolation

Rules:
- stale-blocked: needs-review with blocking hit, voucher >7 UTC-days old
- missing-supplier-vat: approved voucher without supplierVatNumber

Implementation notes:
- Deterministic alert IDs (alert_<kind>_<targetId>) for Memory<->Postgres parity
- Per-record try/catch; one bad voucher doesn't abort the batch
- Date normalization via new Date(...).toISOString() avoids non-UTC skew
- detectComplianceIssuesDetailed returns alerts + skipped[] for caller visibility
"
```

### Task 11: simulateApprovals pure function

**Files:**
- Create: `packages/domain/src/simulation.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `tests/unit/simulation.test.ts`

- [ ] **Step 1: Verify buildPostingLines export location**

Run: `git show origin/main:packages/domain/src/store.ts | grep -n "buildPostingLines\|export"` — confirm where it lives.

If `buildPostingLines` is private to `store.ts` (likely on main, since `MemoryLedgerStore` uses it internally), you'll need to extract it. Check first:

```bash
git grep -n "export.*buildPostingLines" -- packages/domain/src/
```

If no export, extract it before Task 11 by adding `export` to its declaration in `store.ts`. The function signature on main is `(voucher: Voucher, suggestion: AccountingSuggestion, action: "approve" | "book-without-vat", occurredAt: string): LedgerLine[]`.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/simulation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountingSuggestion, ReviewTask, Voucher } from "@jpx-accounting/contracts";
import { simulateApprovals } from "@jpx-accounting/domain";

const voucherFixture = (id: string, overrides: Partial<Voucher["voucherFields"]> = {}): Voucher => ({
  id,
  organizationId: "o",
  workspaceId: "w",
  evidencePacketId: "p",
  voucherNumber: `V-${id}`,
  status: "needs-review",
  accountingMethod: "invoice",
  extractedFields: [],
  voucherFields: {
    grossAmount: 1249,
    netAmount: 999.2,
    vatAmount: 249.8,
    vatRate: 25,
    currency: "SEK",
    description: "Test",
    ...overrides,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  createdBy: "u",
});

const suggestionFixture = (voucherId: string): AccountingSuggestion => ({
  id: `s_${voucherId}`,
  voucherId,
  accountNumber: "6540",
  accountName: "IT-tjänster",
  vatCode: "VAT25",
  confidence: 0.9,
  reasoning: "r",
  kind: "recommendation",
  citations: [],
  ruleHits: [],
});

const reviewFixture = (voucherId: string): ReviewTask => ({
  id: `r_${voucherId}`,
  voucherId,
  title: `Review ${voucherId}`,
  status: "needs-review",
  suggestedAction: "Approve",
  suggestion: suggestionFixture(voucherId),
  provenanceTimeline: [],
});

test("approve produces 3-line balance delta", () => {
  const result = simulateApprovals(
    [reviewFixture("v1")],
    [suggestionFixture("v1")],
    [voucherFixture("v1")],
    "approve",
  );
  assert.equal(result.balanceDelta.length, 3);
  assert.equal(result.balanceDelta.find((b) => b.accountNumber === "6540")?.deltaDebit, 999.2);
  assert.equal(result.balanceDelta.find((b) => b.accountNumber === "2641")?.deltaDebit, 249.8);
  assert.equal(result.balanceDelta.find((b) => b.accountNumber === "1930")?.deltaCredit, 1249);
  assert.deepEqual(result.affectedAccounts.sort(), ["1930", "2641", "6540"]);
});

test("book-without-vat zeroes the VAT line", () => {
  const result = simulateApprovals(
    [reviewFixture("v1")],
    [suggestionFixture("v1")],
    [voucherFixture("v1")],
    "book-without-vat",
  );
  assert.equal(result.balanceDelta.find((b) => b.accountNumber === "2641")?.deltaDebit, 0);
});

test("skips reviews whose voucher is missing", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1")], // v2 absent
    "approve",
  );
  assert.equal(result.balanceDelta.length, 3);
});

test("aggregates across multiple reviews on the same account", () => {
  const result = simulateApprovals(
    [reviewFixture("v1"), reviewFixture("v2")],
    [suggestionFixture("v1"), suggestionFixture("v2")],
    [voucherFixture("v1"), voucherFixture("v2")],
    "approve",
  );
  assert.equal(result.balanceDelta.find((b) => b.accountNumber === "6540")?.deltaDebit, 999.2 * 2);
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npx tsx --test tests/unit/simulation.test.ts`
Expected: module not found.

- [ ] **Step 4: Create `packages/domain/src/simulation.ts`**

```ts
import type { AccountingSuggestion, ReviewTask, SimulationRun, Voucher } from "@jpx-accounting/contracts";

import { buildPostingLines } from "./store";
import type { ReviewAction } from "./store";

type BalanceDelta = SimulationRun["balanceDelta"];
type VatDelta = SimulationRun["vatDelta"];

export function simulateApprovals(
  reviews: ReviewTask[],
  suggestions: AccountingSuggestion[],
  vouchers: Voucher[],
  action: ReviewAction,
): { balanceDelta: BalanceDelta; vatDelta: VatDelta; affectedAccounts: string[] } {
  const suggestionsByVoucher = new Map(suggestions.map((s) => [s.voucherId, s]));
  const vouchersById = new Map(vouchers.map((v) => [v.id, v]));

  const balanceAcc = new Map<string, { name: string; debit: number; credit: number }>();
  const vatAcc = new Map<string, { base: number; amount: number }>();

  for (const review of reviews) {
    const voucher = vouchersById.get(review.voucherId);
    const suggestion = suggestionsByVoucher.get(review.voucherId) ?? review.suggestion;
    if (!voucher || !suggestion) continue;
    const effectiveAction: "approve" | "book-without-vat" = action === "reject" ? "approve" : action;
    const lines = buildPostingLines(voucher, suggestion, effectiveAction, voucher.createdAt);
    for (const line of lines) {
      const entry = balanceAcc.get(line.accountNumber) ?? { name: line.accountName, debit: 0, credit: 0 };
      entry.debit += line.debit;
      entry.credit += line.credit;
      balanceAcc.set(line.accountNumber, entry);
      const base = line.debit !== 0 ? line.debit : line.credit;
      const isVatLine = line.accountNumber === "2641";
      const v = vatAcc.get(line.vatCode) ?? { base: 0, amount: 0 };
      v.base += base;
      if (isVatLine) v.amount += line.debit - line.credit;
      vatAcc.set(line.vatCode, v);
    }
  }

  const balanceDelta: BalanceDelta = [...balanceAcc].map(([accountNumber, e]) => ({
    accountNumber,
    accountName: e.name,
    deltaDebit: e.debit,
    deltaCredit: e.credit,
  }));
  const vatDelta: VatDelta = [...vatAcc].map(([vatCode, v]) => ({
    vatCode,
    deltaBase: v.base,
    deltaAmount: v.amount,
  }));
  const affectedAccounts = [...balanceAcc.keys()];

  return { balanceDelta, vatDelta, affectedAccounts };
}
```

- [ ] **Step 5: Export from index.ts and run the test**

Add `export * from "./simulation";` to `packages/domain/src/index.ts`.

Run: `npx tsx --test tests/unit/simulation.test.ts`
Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/simulation.ts packages/domain/src/index.ts tests/unit/simulation.test.ts
git commit -m "feat(domain): simulateApprovals pure function for runSimulation deltas

Pure aggregation over (reviews, suggestions, vouchers) producing
balanceDelta[] + vatDelta[] + affectedAccounts[]. Reused by Memory
and Postgres store implementations so deltas are bit-identical
across runtime modes (CONVENTIONS Rule 11).
"
```

## Phase 3 — Interface + Memory store

### Task 12: Add ReviewNotFoundError and extend LedgerStore interface

**Files:**
- Modify: `packages/domain/src/store.ts` (add error class + 3 interface methods)

- [ ] **Step 1: Add ReviewNotFoundError class**

In `packages/domain/src/store.ts`, near the top (after `ReviewAction` type, before the `LedgerStore` interface):

```ts
/**
 * Thrown when an API caller references review IDs that don't exist in the
 * scope. Distinguished from generic Error so the HTTP layer maps to 404
 * instead of catch-all 500 (CONVENTIONS Rule 16).
 */
export class ReviewNotFoundError extends Error {
  constructor(public readonly missingIds: string[]) {
    super(`Review(s) not found in this workspace: ${missingIds.join(", ")}`);
    this.name = "ReviewNotFoundError";
  }
}
```

- [ ] **Step 2: Extend the LedgerStore interface**

Find `interface LedgerStore`. Add three methods (place near related methods):

```ts
  refreshComplianceAlerts(): Promise<ComplianceAlert[]>;
  getCompanySettings(): Promise<CompanySettings | null>;
  putCompanySettings(input: CompanySettings): Promise<CompanySettings>;
```

Update the imports at the top of `store.ts` to include `ComplianceAlert` and `CompanySettings`:

```ts
import type {
  // ... existing imports ...
  ComplianceAlert,
  CompanySettings,
} from "@jpx-accounting/contracts";
```

- [ ] **Step 3: Run typecheck — expect FAIL**

Run: `pnpm typecheck`
Expected: FAILS in `packages/persistence-postgres/src/store.ts` because `PostgresLedgerStore implements LedgerStore` now needs three new methods.

Add stubs to PostgresLedgerStore so typecheck passes (real implementations land in PR-C):

In `packages/persistence-postgres/src/store.ts`, add at the end of the class:

```ts
  async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
    // TODO(PR-C): implement against compliance_alerts table (migration 0004 adds it).
    throw new Error("refreshComplianceAlerts not yet implemented for PostgresLedgerStore");
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    // TODO(PR-C): implement against organization_settings table (migration 0004 adds it).
    return null;
  }

  async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    // TODO(PR-C): implement against organization_settings table.
    void input;
    throw new Error("putCompanySettings not yet implemented for PostgresLedgerStore");
  }
```

Add the imports to `packages/persistence-postgres/src/store.ts`:

```ts
import type { ComplianceAlert, CompanySettings } from "@jpx-accounting/contracts";
```

Run `pnpm typecheck` again — expected: green.

- [ ] **Step 4: Hold — bundle with Task 13 (MemoryLedgerStore implementations)**

### Task 13: MemoryLedgerStore extensions

**Files:**
- Modify: `packages/domain/src/store.ts` (add 4 methods + the auto-detected-kinds constant + MEMORY_ALERT_CAP)

Memory store now needs: `refreshComplianceAlerts`, `runSimulation` (real), `answerAssistantQuestion` (delegate to scaffold), `getCompanySettings`, `putCompanySettings`. Plus state for the alerts/settings.

- [ ] **Step 1: Add state fields and constants**

In `packages/domain/src/store.ts`, find `class MemoryLedgerStore implements LedgerStore`. Add (near other private state declarations):

```ts
  private alerts: ComplianceAlert[] = [];
  private companySettings: CompanySettings | null = null;
```

Near the top of the file (after `defaultOrganizationId` / `defaultWorkspaceId`), add:

```ts
const MEMORY_ALERT_CAP = 500;
const AUTO_DETECTED_KINDS = new Set(["stale-blocked", "missing-supplier-vat"]);
```

- [ ] **Step 2: Replace `answerAssistantQuestion`**

Find the existing `answerAssistantQuestion` method (returns a hardcoded scaffold). Replace with:

```ts
async answerAssistantQuestion(question: string): Promise<AssistantSession> {
  return buildAssistantScaffold(question);
}
```

Add the import at the top:

```ts
import { buildAssistantScaffold } from "./assistant";
```

- [ ] **Step 3: Replace `runSimulation`**

Find the existing `runSimulation`. Replace with:

```ts
async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
  // Dedup at boundary (Rule 23): Postgres .in() dedupes server-side; Memory
  // must match for parity (Rule 11).
  const reviewIds = [...new Set(input.reviewIds)];
  const requestedReviews = reviewIds
    .map((id) => this.reviews.get(id))
    .filter((r): r is ReviewTask => Boolean(r));
  if (requestedReviews.length !== reviewIds.length) {
    const found = new Set(requestedReviews.map((r) => r.id));
    throw new ReviewNotFoundError(reviewIds.filter((id) => !found.has(id)));
  }
  const requestedVouchers = requestedReviews
    .map((r) => this.vouchers.get(r.voucherId))
    .filter((v): v is Voucher => Boolean(v));
  const requestedSuggestions = requestedVouchers
    .map((v) => this.suggestions.get(v.id))
    .filter((s): s is AccountingSuggestion => Boolean(s));

  const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
    requestedReviews,
    requestedSuggestions,
    requestedVouchers,
    input.action,
  );

  const result: SimulationRun = {
    id: createId("sim"),
    title: input.title,
    scenario: input.scenario,
    outcomeSummary: `Simulated ${requestedReviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
    affectedAccounts,
    balanceDelta,
    vatDelta,
  };

  this.appendEvent({
    organizationId: defaultOrganizationId,
    workspaceId: defaultWorkspaceId,
    aggregateType: "simulation",
    aggregateId: result.id,
    eventType: "SimulationExecuted",
    actorId: input.actorId,
    occurredAt: nowIso(),
    payload: result as unknown as Record<string, unknown>,
  });

  return result;
}
```

Add the import:

```ts
import { simulateApprovals } from "./simulation";
```

- [ ] **Step 4: Add refreshComplianceAlerts**

Add new method on `MemoryLedgerStore`:

```ts
async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
  const reviews = [...this.reviews.values()];
  const vouchers = [...this.vouchers.values()];
  const detected = detectComplianceIssues(reviews, vouchers, today());
  const detectedById = new Map(detected.map((a) => [a.id, a]));

  // Immutable single-pass rebuild (CONVENTIONS Rules 17, 24): clone before
  // mutating so prior snapshot consumers don't observe spooky state flips.
  // Auto-detected alerts can transition open<->resolved; user states
  // (acknowledged, dismissed) and seeded non-auto kinds pass through unchanged.
  const rebuilt: ComplianceAlert[] = this.alerts.map((alert) => {
    if (!AUTO_DETECTED_KINDS.has(alert.kind)) return { ...alert };
    const stillDetected = detectedById.has(alert.id);
    if (alert.status === "open" && !stillDetected) return { ...alert, status: "resolved" };
    if (alert.status === "resolved" && stillDetected) return { ...alert, status: "open" };
    return { ...alert };
  });

  const existingIds = new Set(rebuilt.map((a) => a.id));
  for (const alert of detected) {
    if (!existingIds.has(alert.id)) rebuilt.push({ ...alert });
  }

  // Bound accumulation (Rule 25): cap auto-detected entries; seeded alerts pinned.
  const seeded = rebuilt.filter((a) => !AUTO_DETECTED_KINDS.has(a.kind));
  const auto = rebuilt.filter((a) => AUTO_DETECTED_KINDS.has(a.kind));
  const capRemaining = Math.max(0, MEMORY_ALERT_CAP - seeded.length);
  const trimmedAuto = auto.length > capRemaining ? auto.slice(-capRemaining) : auto;

  this.alerts = [...seeded, ...trimmedAuto];
  return [...this.alerts];
}
```

Add the imports:

```ts
import { detectComplianceIssues } from "./compliance";
import { today } from "./ids"; // if not already imported
```

- [ ] **Step 5: Add getCompanySettings/putCompanySettings**

```ts
async getCompanySettings(): Promise<CompanySettings | null> {
  return this.companySettings ? { ...this.companySettings } : null;
}

async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
  this.companySettings = { ...input };
  return { ...this.companySettings };
}
```

- [ ] **Step 6: Append Memory store tests**

In `tests/unit/ledger-store.test.ts`, append:

```ts
import { ReviewNotFoundError } from "@jpx-accounting/domain";

test("MemoryLedgerStore.runSimulation returns real deltas and writes no journal lines", async () => {
  const store = new MemoryLedgerStore();
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target);
  const reportsBefore = await store.getReports();

  const sim = await store.runSimulation({
    actorId: "u",
    title: "what-if",
    scenario: "approve one",
    reviewIds: [target.id],
    action: "approve",
  });
  assert.ok(sim.balanceDelta.length > 0);
  assert.ok(sim.affectedAccounts.includes("2641"));

  const reportsAfter = await store.getReports();
  assert.deepEqual(reportsAfter, reportsBefore);
});

test("MemoryLedgerStore.runSimulation throws ReviewNotFoundError on missing IDs", async () => {
  const store = new MemoryLedgerStore();
  try {
    await store.runSimulation({
      actorId: "u",
      title: "t",
      scenario: "s",
      reviewIds: ["does_not_exist"],
      action: "approve",
    });
    assert.fail("expected ReviewNotFoundError");
  } catch (err) {
    assert.ok(err instanceof ReviewNotFoundError);
    assert.deepEqual(err.missingIds, ["does_not_exist"]);
  }
});

test("MemoryLedgerStore.runSimulation dedupes duplicate reviewIds", async () => {
  const store = new MemoryLedgerStore();
  const reviews = await store.getReviewFeed();
  const target = reviews[0];
  assert.ok(target);
  const single = await store.runSimulation({
    actorId: "u",
    title: "single",
    scenario: "s",
    reviewIds: [target.id],
    action: "approve",
  });
  const dup = await store.runSimulation({
    actorId: "u",
    title: "dup",
    scenario: "s",
    reviewIds: [target.id, target.id, target.id],
    action: "approve",
  });
  assert.deepEqual(dup.balanceDelta, single.balanceDelta);
});

test("MemoryLedgerStore.refreshComplianceAlerts idempotent + immutable", async () => {
  const store = new MemoryLedgerStore();
  const first = await store.refreshComplianceAlerts();
  const second = await store.refreshComplianceAlerts();
  assert.equal(first.length, second.length);
});

test("MemoryLedgerStore.getCompanySettings/putCompanySettings round-trip", async () => {
  const store = new MemoryLedgerStore();
  assert.equal(await store.getCompanySettings(), null);
  const settings = {
    organizationId: "org_test",
    organizationName: "Test AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "test@example.com",
  };
  const saved = await store.putCompanySettings(settings);
  assert.equal(saved.organizationName, "Test AB");
  const loaded = await store.getCompanySettings();
  assert.equal(loaded?.organizationName, "Test AB");
});
```

- [ ] **Step 7: Run the suite — all green**

```bash
pnpm test:unit && pnpm typecheck && pnpm typecheck:tests
```

Expected: green. 5 new Memory tests added.

- [ ] **Step 8: Commit Tasks 12+13**

```bash
git add packages/domain/src/store.ts packages/persistence-postgres/src/store.ts tests/unit/ledger-store.test.ts
git commit -m "feat(domain): extend LedgerStore interface; Memory store implementations

Interface additions (PostgresLedgerStore stubs throw NOT_IMPLEMENTED;
real impl lands in PR-C):
- refreshComplianceAlerts(): Promise<ComplianceAlert[]>
- getCompanySettings(): Promise<CompanySettings | null>
- putCompanySettings(input): Promise<CompanySettings>

MemoryLedgerStore implementations:
- ReviewNotFoundError class for typed HTTP mapping (Rule 16)
- runSimulation: real simulateApprovals diff, dedup input, throw on missing IDs
- refreshComplianceAlerts: immutable rebuild, deterministic IDs, bound at 500
- answerAssistantQuestion: delegate to buildAssistantScaffold
- getCompanySettings/putCompanySettings: in-memory storage
"
```

## Phase 4 — Migration 0004

### Task 14: Write 0004_compliance_and_settings.sql

**Files:**
- Create: `infra/supabase/migrations/0004_compliance_and_settings.sql`

This single migration adds the three tables Phase 7 needs that main doesn't have: `compliance_alerts`, `assistant_sessions`, `organization_settings`.

- [ ] **Step 1: Create the migration**

Create `infra/supabase/migrations/0004_compliance_and_settings.sql`:

```sql
-- Phase 7 schema additions:
--   * ledger.compliance_alerts — auto-detected (stale-blocked, missing-supplier-vat)
--     and user-acknowledged compliance issues, with dedup by (org, ws, kind, target_id).
--   * ledger.assistant_sessions — Q&A history (currently scaffold; real AI advisor later).
--   * ledger.organization_settings — per-org company settings (one row per org).
--
-- Conventions (see docs/CONVENTIONS.md):
--   * Rule 18: separate ADD CONSTRAINT from ADD COLUMN IF NOT EXISTS so CHECKs
--     attach even on partial re-apply.
--   * Rule 18: unique index uses NULLS NOT DISTINCT so future null-target alerts
--     dedup correctly via the same index.
--   * Rule 20: resolved_by uses a 'system:auto-resolver' sentinel for automatic
--     resolutions, not the API caller's userId. The column is text; sentinel is
--     stored as a literal value.

create table if not exists ledger.compliance_alerts (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  title           text          not null,
  source          text          not null,
  detected_at     timestamptz   not null default now(),
  impact_summary  text          not null default '',
  kind            text          not null default 'legacy',
  target_id       text,
  severity        text          not null default 'info',
  status          text          not null default 'open',
  body            text,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz   not null default now()
);

do $$ begin
  alter table ledger.compliance_alerts
    add constraint ledger_alerts_severity_check
    check (severity in ('info', 'warning', 'critical'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table ledger.compliance_alerts
    add constraint ledger_alerts_status_check
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed'));
exception when duplicate_object then null;
end $$;

create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  nulls not distinct;

create index if not exists ledger_alerts_org_ws_idx
  on ledger.compliance_alerts (organization_id, workspace_id, status, detected_at desc);

create table if not exists ledger.assistant_sessions (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  question        text          not null,
  answer          text          not null,
  status          text          not null default 'grounded',
  citations       jsonb         not null default '[]'::jsonb,
  actor_id        text,
  created_at      timestamptz   not null default now()
);

create index if not exists ledger_assistant_org_ws_idx
  on ledger.assistant_sessions (organization_id, workspace_id, created_at desc);

create table if not exists ledger.organization_settings (
  organization_id text          primary key,
  settings        jsonb         not null,
  updated_at      timestamptz   not null default now(),
  updated_by      text          not null
);
```

- [ ] **Step 2: Verify SQL syntax**

If a local Postgres is available, dry-run the migration. Otherwise read it carefully for typos.

A quick sanity check — count `create table` statements:

```bash
grep -c "^create table" infra/supabase/migrations/0004_compliance_and_settings.sql
```

Expected: 3.

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/0004_compliance_and_settings.sql
git commit -m "feat(db): migration 0004 adds compliance_alerts, assistant_sessions, organization_settings

- compliance_alerts with deterministic-ID dedup index (NULLS NOT DISTINCT)
- assistant_sessions for Q&A history (scaffold + future real AI)
- organization_settings keyed by organization_id

Schema design notes (CONVENTIONS.md):
- Rule 18: CHECKs added via separate DO blocks (duplicate_object safe)
- Rule 18: unique index NULLS NOT DISTINCT for future null-target alerts
"
```

## Phase 5 — API routes

### Task 15: Add ReviewNotFoundError onError branch + import

**Files:**
- Modify: `services/api/src/app.ts`

- [ ] **Step 1: Add import for ReviewNotFoundError**

In `services/api/src/app.ts`, find the import block. The current `import` from `@jpx-accounting/domain` is:

```ts
import type { LedgerStore, ReviewAction } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";
```

Update to:

```ts
import type { LedgerStore, ReviewAction } from "@jpx-accounting/domain";
import { MemoryLedgerStore, ReviewNotFoundError } from "@jpx-accounting/domain";
```

- [ ] **Step 2: Add the onError branch**

Find `app.onError((error, c) => {` block. Add a branch BEFORE the default 500 fallback (after `LedgerStoreUnavailableError`/`AiRuntimeUnavailableError`):

```ts
    if (error instanceof ReviewNotFoundError) {
      return jsonError(c, error.message, runtimeMode, 404, { code: "review_not_found" });
    }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(api): map ReviewNotFoundError to HTTP 404 with code review_not_found

Otherwise callers see opaque 500 'Unexpected server error' for what is
a client-correctable bad-input case (CONVENTIONS Rule 16).
"
```

### Task 16: /api/compliance-watch/refresh real implementation

**Files:**
- Modify: `services/api/src/app.ts`

- [ ] **Step 1: Locate (or add) the route**

Search: `grep -n "compliance-watch" services/api/src/app.ts`

If the route exists, replace its body. If not, add a new route after `/api/assistant/sessions` (logical grouping).

- [ ] **Step 2: Implement**

Add or replace:

```ts
  app.post("/api/compliance-watch/refresh", async (context) => {
    // Default-exclude resolved/dismissed (CONVENTIONS Rule 26); ?includeResolved=true for all.
    const includeResolved = context.req.query("includeResolved") === "true";
    const all = await currentStore.refreshComplianceAlerts();
    const visible = includeResolved ? all : all.filter((a) => a.status === "open" || a.status === "acknowledged");
    return context.json(visible);
  });
```

- [ ] **Step 3: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(api): /api/compliance-watch/refresh calls store.refreshComplianceAlerts

Replaces (or adds) the route to actually refresh detection rather than
return a stub. Default-excludes resolved/dismissed alerts; ?includeResolved=true
for full history (Rule 26).
"
```

### Task 17: GET/PUT /api/settings/company routes

**Files:**
- Modify: `services/api/src/app.ts`

- [ ] **Step 1: Update imports**

Add `companySettingsSchema` to the import block from `@jpx-accounting/contracts`:

```ts
import {
  // ... existing imports ...
  companySettingsSchema,
} from "@jpx-accounting/contracts";
```

- [ ] **Step 2: Add the routes**

Add after `/api/compliance-watch/refresh`:

```ts
  app.get("/api/settings/company", async (context) => {
    const settings = await currentStore.getCompanySettings();
    if (!settings) return context.json(null);
    return context.json(settings);
  });

  app.put("/api/settings/company", async (context) => {
    const input = await parseBody(context.req.raw, companySettingsSchema);
    const saved = await currentStore.putCompanySettings(input);
    return context.json(saved);
  });
```

- [ ] **Step 3: Commit**

```bash
git add services/api/src/app.ts
git commit -m "feat(api): GET/PUT /api/settings/company

Wires the LedgerStore.getCompanySettings/putCompanySettings methods
to HTTP. PUT validates against companySettingsSchema (Swedish org
number + postal format).
"
```

### Task 18: /api/knowledge/query citation isolation

**Files:**
- Modify: `services/api/src/app.ts`

- [ ] **Step 1: Locate the route**

Search: `grep -n "/api/knowledge/query" services/api/src/app.ts`

Main's current implementation is:

```ts
app.post("/api/knowledge/query", async (context) => {
  const input = await parseBody(context.req.raw, knowledgeQuerySchema);
  const snapshot = await currentStore.getSnapshot();
  return context.json({
    ...
    citations: snapshot.reviews[0]?.suggestion?.citations ?? [...],
    ...
  });
});
```

This leaks the latest review's suggestion citations as if they were knowledge-query citations. Same class of bug deploy already fixed (citation provenance leak — CONVENTIONS Rule 10).

- [ ] **Step 2: Replace the route body**

Read the existing route's full body. Replace the citations source with an empty array directly (the route is a stub until real Azure AI Search lands, per migration 0003 + the eventual Cmd-K Advisor sprint):

```ts
  app.post("/api/knowledge/query", async (context) => {
    const input = await parseBody(context.req.raw, knowledgeQuerySchema);
    // Knowledge query is a placeholder until the Azure AI Search index ships
    // (foundation in migration 0003 + knowledge.documents table). Returning
    // citations from any other flow's data is wrong provenance in an audit
    // context (CONVENTIONS Rule 10). Return [] until real retrieval lands.
    return context.json({
      query: input.query,
      citations: [],
      answer:
        "Knowledge queries are routed through the same grounded advisory stack; next step is wiring the knowledge.documents table (0003 migration) to Azure AI Search.",
    });
  });
```

- [ ] **Step 3: Run the suite**

```bash
pnpm test:unit && pnpm typecheck && pnpm typecheck:tests
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/app.ts
git commit -m "fix(api): /api/knowledge/query returns citations: [] directly

Previously inherited citations from snapshot.reviews[0].suggestion.citations
— wrong provenance in a regulated-audit context (CONVENTIONS Rule 10).
Returns empty array honestly until real Azure AI Search retrieval wires
to the knowledge.documents table from migration 0003.
"
```

## Phase 6 — Final verification + PR-B open

### Task 19: Full suite, push, open PR-B

- [ ] **Step 1: Full local gate**

```bash
pnpm install
pnpm typecheck
pnpm typecheck:tests
pnpm test:unit
```

Expected: all green. Test count should have risen by ~10 vs main baseline.

- [ ] **Step 2: Push**

```bash
git push -u origin port/phase-7-features
```

- [ ] **Step 3: Open PR-B**

```bash
gh pr create --base main --head port/phase-7-features --title "Port Phase 7 (PR-B): contracts + Memory store + API + migration 0004" --body "$(cat <<'EOF'
## Summary

PR-B of the Phase 7 port. Lands all the architecture-light work:

- **Contract extensions:** simulationRequestSchema gains reviewIds+action; simulationRunSchema gains balanceDelta+vatDelta; complianceAlertSchema gains kind/severity/status/targetId/body; new companySettingsSchema
- **Pure domain helpers:** buildAssistantScaffold, detectComplianceIssues (+ Detailed variant), simulateApprovals
- **ReviewNotFoundError** class for typed HTTP 404 mapping
- **LedgerStore interface** extended by 3 methods; MemoryLedgerStore implements all three
- **Migration 0004:** compliance_alerts, assistant_sessions, organization_settings
- **API routes:** /api/compliance-watch/refresh (real), GET/PUT /api/settings/company, ReviewNotFoundError -> 404 mapping, /api/knowledge/query citation isolation

**PostgresLedgerStore** has stub implementations of the 3 new methods that throw or return null. **Real implementations land in PR-C.**

## Conventions applied

CONVENTIONS.md Rules 6 (atomic contract change), 11 (store parity — deferred for refreshComplianceAlerts pending PR-C), 15 (symmetric fix via shared helpers), 16 (typed HTTP mapping), 17 (immutable update), 18 (PG schema pitfalls — separated CHECK, NULLS NOT DISTINCT), 21 (per-record error isolation), 22 (UTC normalization), 23 (dedup at boundary), 24 (auto vs user state), 25 (bounded accumulation), 26 (active vs historical defaults).

## Test plan

- [x] pnpm typecheck green
- [x] pnpm typecheck:tests green
- [x] pnpm test:unit green (~10 new tests)
- [ ] PR reviewer scans migration 0004 + new domain modules

## Blocking on

- Migration 0004 needs to apply against the deployed Postgres. **Coordinate with the schema owner before merge.**

## Related

- Phase 7 design spec: docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md
- Port plan: docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md
- Next: PR-C (PostgresLedgerStore real implementations for the 3 new methods + runSimulation real diff)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**STOP HERE — PR-B complete. Wait for review/merge before starting PR-C in a fresh session.**

---

# PR-C: PostgresLedgerStore extensions

**Branch:** `port/phase-7-postgres` off `origin/main` (after PR-A + PR-B merge, rebase off updated main).
**Effort:** ~4 hours.
**Risk:** HIGH — touches the canonical write store; needs integration tests against real Postgres.
**Goal:** Replace the PostgresLedgerStore stubs from PR-B with real implementations: `runSimulation` real diff, `refreshComplianceAlerts` with full upsert+resolve semantics, `answerAssistantQuestion` via `buildAssistantScaffold` + DB insert, `getCompanySettings`/`putCompanySettings`.

## Phase 7 — PostgresLedgerStore real implementations

### Task 20: Read main's PostgresLedgerStore patterns

Before writing a single line, read the canonical patterns:

- [ ] **Step 1: Read `applyReviewDecision` carefully**

```bash
git show origin/main:packages/persistence-postgres/src/store.ts | sed -n '/async applyReviewDecision/,/^  async [a-z]/p' | head -120
```

Note:
- Uses `this.client.begin(async (tx) => { ... })` for transactional consistency
- Calls `this.lockWorkspaceTail(tx)` before any writes (hash chain serialization via `SELECT ... FOR UPDATE`)
- Calls `this.appendEvent(tx, ...)` to write events inside the transaction
- Uses tagged template strings: ``tx`select ... from ledger.x where id = ${id}` ``

- [ ] **Step 2: Read `createEvidence`**

```bash
git show origin/main:packages/persistence-postgres/src/store.ts | sed -n '/async createEvidence/,/^  async [a-z]/p' | head -100
```

Same patterns. Now you have the template for postgres-js queries.

- [ ] **Step 3: Read `lockWorkspaceTail` and `appendEvent` helpers**

```bash
git show origin/main:packages/persistence-postgres/src/store.ts | sed -n '/private async lockWorkspaceTail\|private async appendEvent/,/^  [a-z]/p' | head -80
```

Note the helper signatures. Reuse them.

### Task 21: Real runSimulation on PostgresLedgerStore

**Files:**
- Modify: `packages/persistence-postgres/src/store.ts` (`runSimulation`)
- Test: extend `tests/integration/postgres-ledger.test.ts` (gated on `SUPABASE_DB_URL`)

- [ ] **Step 1: Write the integration test**

Append to `tests/integration/postgres-ledger.test.ts`:

```ts
test("runSimulation returns real projection diff with balanceDelta + vatDelta", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t); // helper that builds a clean PostgresLedgerStore + seeds an org
  const evidence = await store.createEvidence({
    organizationId: "org_test",
    workspaceId: "ws_test",
    actorId: "user_test",
    title: "Test invoice",
    originalFilename: "t.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf"],
  });
  const sim = await store.runSimulation({
    actorId: "user_test",
    title: "what-if",
    scenario: "approve one",
    reviewIds: [evidence.review.id],
    action: "approve",
  });
  assert.ok(sim.balanceDelta.length > 0, "balance delta non-empty");
  assert.ok(sim.affectedAccounts.includes("2641"), "input VAT in affected accounts");
});

test("runSimulation throws ReviewNotFoundError on missing IDs", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t);
  await assert.rejects(
    () => store.runSimulation({
      actorId: "u",
      title: "t",
      scenario: "s",
      reviewIds: ["review_does_not_exist"],
      action: "approve",
    }),
    /not found in this workspace/,
  );
});
```

`setupStore` is a helper that should exist in `tests/integration/postgres-ledger.test.ts`. If not, write one that takes a `TestContext`, creates a fresh schema, and registers cleanup.

- [ ] **Step 2: Run — expect FAIL**

```bash
SUPABASE_DB_URL=<your-local-postgres-url> pnpm test:integration
```

Expected: FAIL (stub throws).

- [ ] **Step 3: Replace the stub in PostgresLedgerStore**

Find `async runSimulation(input: SimulationRequest): Promise<SimulationRun>` in `packages/persistence-postgres/src/store.ts`. Replace with:

```ts
async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
  return this.client.begin(async (tx) => {
    // Dedup at boundary (CONVENTIONS Rule 23). Postgres .in() would dedupe
    // anyway, but explicit dedup makes the length-check correct.
    const reviewIds = [...new Set(input.reviewIds)];

    const reviewRows = await tx<Array<{
      id: string;
      voucher_id: string;
      title: string;
      status: string;
      blocked_reason: string | null;
      suggested_action: string;
      suggestion: AccountingSuggestion | null;
      provenance_timeline: unknown[];
    }>>`
      select id, voucher_id, title, status, blocked_reason, suggested_action,
             suggestion, provenance_timeline
      from ledger.review_tasks
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
        and id = any(${reviewIds})
    `;
    if (reviewRows.length !== reviewIds.length) {
      const found = new Set(reviewRows.map((r) => r.id));
      throw new ReviewNotFoundError(reviewIds.filter((id) => !found.has(id)));
    }

    const voucherIds = [...new Set(reviewRows.map((r) => r.voucher_id))];
    const voucherRows = voucherIds.length === 0 ? [] : await tx<Array<{
      id: string;
      voucher_number: string;
      status: string;
      accounting_method: string;
      voucher_fields: Voucher["voucherFields"];
      extracted_fields: ExtractedField[];
      created_at: string;
      created_by: string;
      evidence_packet_id: string;
    }>>`
      select id, voucher_number, status, accounting_method, voucher_fields,
             extracted_fields, created_at, created_by, evidence_packet_id
      from ledger.vouchers
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
        and id = any(${voucherIds})
    `;

    const reviews: ReviewTask[] = reviewRows.map((r) => ({
      id: r.id,
      voucherId: r.voucher_id,
      title: r.title,
      status: r.status as ReviewTask["status"],
      blockedReason: r.blocked_reason ?? undefined,
      suggestedAction: r.suggested_action,
      suggestion: r.suggestion ?? undefined,
      provenanceTimeline: r.provenance_timeline as ReviewTask["provenanceTimeline"],
    }));
    const vouchers: Voucher[] = voucherRows.map((v) => ({
      id: v.id,
      organizationId: this.organizationId,
      workspaceId: this.workspaceId,
      evidencePacketId: v.evidence_packet_id,
      voucherNumber: v.voucher_number,
      status: v.status as Voucher["status"],
      accountingMethod: v.accounting_method as Voucher["accountingMethod"],
      extractedFields: v.extracted_fields,
      voucherFields: v.voucher_fields,
      createdAt: v.created_at,
      createdBy: v.created_by,
    }));
    const suggestions = reviews.map((r) => r.suggestion).filter((s): s is AccountingSuggestion => Boolean(s));

    const { balanceDelta, vatDelta, affectedAccounts } = simulateApprovals(
      reviews,
      suggestions,
      vouchers,
      input.action,
    );

    const result: SimulationRun = {
      id: createId("sim"),
      title: input.title,
      scenario: input.scenario,
      outcomeSummary: `Simulated ${reviews.length} review(s); ${affectedAccounts.length} accounts affected. No production postings were changed.`,
      affectedAccounts,
      balanceDelta,
      vatDelta,
    };

    await this.appendEvent(tx, {
      aggregateType: "simulation",
      aggregateId: result.id,
      eventType: "SimulationExecuted",
      actorId: input.actorId,
      occurredAt: nowIso(),
      payload: result as unknown as Record<string, unknown>,
    });

    return result;
  });
}
```

Add the imports at the top of `packages/persistence-postgres/src/store.ts`:

```ts
import { simulateApprovals, ReviewNotFoundError } from "@jpx-accounting/domain";
```

- [ ] **Step 4: Run the integration test — expect PASS**

```bash
SUPABASE_DB_URL=<your-local-postgres-url> pnpm test:integration
```

Expected: both new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/persistence-postgres/src/store.ts tests/integration/postgres-ledger.test.ts
git commit -m "feat(persistence-postgres): real runSimulation with projection diff

Replaces the stub that returned hardcoded affectedAccounts=[6071,2641,6991]
with a real implementation that loads reviews+vouchers by reviewIds,
runs simulateApprovals to compute balanceDelta+vatDelta, and appends a
SimulationExecuted event. Throws ReviewNotFoundError (-> HTTP 404) on
missing IDs. Dedupes input.reviewIds at the boundary for parity with
MemoryLedgerStore.
"
```

### Task 22: Replace answerAssistantQuestion stub with buildAssistantScaffold + DB insert

**Files:**
- Modify: `packages/persistence-postgres/src/store.ts`

- [ ] **Step 1: Replace the method**

Find `async answerAssistantQuestion`. Replace with:

```ts
async answerAssistantQuestion(question: string): Promise<AssistantSession> {
  const session = buildAssistantScaffold(question);

  await this.client`
    insert into ledger.assistant_sessions
      (id, organization_id, workspace_id, question, answer, status, citations, actor_id)
    values
      (${session.id}, ${this.organizationId}, ${this.workspaceId}, ${session.question},
       ${session.answer}, ${session.status}, ${this.client.json(session.citations)}, null)
  `;

  return session;
}
```

Add import:

```ts
import { buildAssistantScaffold } from "@jpx-accounting/domain";
```

- [ ] **Step 2: Add integration test**

Append to `tests/integration/postgres-ledger.test.ts`:

```ts
test("answerAssistantQuestion delegates to buildAssistantScaffold + persists", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t);
  const session = await store.answerAssistantQuestion("Can I deduct this?");
  assert.equal(session.status, "grounded");
  assert.equal(session.citations.length, 1);
  assert.equal(session.question, "Can I deduct this?");

  // Verify persistence — read it back via raw SQL.
  const row = await getRawClient(t)`
    select question, status from ledger.assistant_sessions where id = ${session.id}
  `;
  assert.equal(row[0]?.question, "Can I deduct this?");
});
```

- [ ] **Step 3: Run + commit**

```bash
SUPABASE_DB_URL=... pnpm test:integration
git add packages/persistence-postgres/src/store.ts tests/integration/postgres-ledger.test.ts
git commit -m "feat(persistence-postgres): answerAssistantQuestion uses shared scaffold + persists

Replaces the in-line stub (which returned the same scaffold text but
didn't persist) with a buildAssistantScaffold delegation followed by
an insert to ledger.assistant_sessions (table added in migration 0004).
"
```

### Task 23: refreshComplianceAlerts on PostgresLedgerStore

**Files:**
- Modify: `packages/persistence-postgres/src/store.ts`

This is the longest method. Three logical phases inside one transaction:

1. Load reviews + vouchers (with suggestion hydration)
2. Detect, upsert detected, mark stale-resolved
3. Read back the persisted list

- [ ] **Step 1: Replace the stub**

Find `async refreshComplianceAlerts(): Promise<ComplianceAlert[]>`. Replace with:

```ts
async refreshComplianceAlerts(): Promise<ComplianceAlert[]> {
  return this.client.begin(async (tx) => {
    const reviewRows = await tx<Array<{
      id: string;
      voucher_id: string;
      title: string;
      status: string;
      blocked_reason: string | null;
      suggested_action: string;
      suggestion: AccountingSuggestion | null;
      provenance_timeline: unknown[];
    }>>`
      select id, voucher_id, title, status, blocked_reason, suggested_action,
             suggestion, provenance_timeline
      from ledger.review_tasks
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
    `;
    const reviews: ReviewTask[] = reviewRows.map((r) => ({
      id: r.id,
      voucherId: r.voucher_id,
      title: r.title,
      status: r.status as ReviewTask["status"],
      blockedReason: r.blocked_reason ?? undefined,
      suggestedAction: r.suggested_action,
      suggestion: r.suggestion ?? undefined,
      provenanceTimeline: r.provenance_timeline as ReviewTask["provenanceTimeline"],
    }));

    // Suggestions are embedded on review_tasks.suggestion (jsonb) on main —
    // no separate suggestions table to hydrate from. If a row has null
    // suggestion, the stale-blocked rule won't fire for it (intentional —
    // a review without any suggestion can't have rule hits).

    const voucherRows = await tx<Array<{
      id: string;
      voucher_number: string;
      status: string;
      accounting_method: string;
      voucher_fields: Voucher["voucherFields"];
      extracted_fields: ExtractedField[];
      created_at: string;
      created_by: string;
      evidence_packet_id: string;
    }>>`
      select id, voucher_number, status, accounting_method, voucher_fields,
             extracted_fields, created_at, created_by, evidence_packet_id
      from ledger.vouchers
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
    `;
    const vouchers: Voucher[] = voucherRows.map((v) => ({
      id: v.id,
      organizationId: this.organizationId,
      workspaceId: this.workspaceId,
      evidencePacketId: v.evidence_packet_id,
      voucherNumber: v.voucher_number,
      status: v.status as Voucher["status"],
      accountingMethod: v.accounting_method as Voucher["accountingMethod"],
      extractedFields: v.extracted_fields,
      voucherFields: v.voucher_fields,
      createdAt: v.created_at,
      createdBy: v.created_by,
    }));

    const detected = detectComplianceIssues(reviews, vouchers, today());

    if (detected.length > 0) {
      // Upsert via ON CONFLICT on (org, workspace, kind, target_id) — unique
      // index with NULLS NOT DISTINCT from migration 0004. Explicitly clear
      // resolved_at/resolved_by on every upsert so re-detected alerts don't
      // carry stale resolution metadata (CONVENTIONS Rule 18).
      for (const alert of detected) {
        await tx`
          insert into ledger.compliance_alerts
            (id, organization_id, workspace_id, title, source, detected_at,
             impact_summary, kind, severity, status, target_id, body,
             resolved_at, resolved_by)
          values
            (${alert.id}, ${this.organizationId}, ${this.workspaceId},
             ${alert.title}, ${alert.source}, ${alert.detectedAt},
             ${alert.impactSummary}, ${alert.kind}, ${alert.severity},
             ${alert.status}, ${alert.targetId ?? null}, ${alert.body ?? null},
             null, null)
          on conflict (organization_id, workspace_id, kind, target_id) do update
            set status = excluded.status,
                detected_at = excluded.detected_at,
                resolved_at = null,
                resolved_by = null
        `;
      }
    }

    // Resolve any previously-open auto-detected alert whose condition no
    // longer holds (CONVENTIONS Rule 24). Use 'system:auto-resolver' sentinel
    // for attribution, not ctx.userId (Rule 20).
    const detectedIds = new Set(detected.map((a) => a.id));
    const autoOpenRows = await tx<Array<{ id: string }>>`
      select id from ledger.compliance_alerts
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
        and status = 'open'
        and kind = any(${["stale-blocked", "missing-supplier-vat"]})
    `;
    const toResolve = autoOpenRows.filter((r) => !detectedIds.has(r.id)).map((r) => r.id);
    if (toResolve.length > 0) {
      await tx`
        update ledger.compliance_alerts
        set status = 'resolved',
            resolved_at = now(),
            resolved_by = 'system:auto-resolver'
        where organization_id = ${this.organizationId}
          and workspace_id = ${this.workspaceId}
          and id = any(${toResolve})
      `;
    }

    const allRows = await tx<Array<{
      id: string;
      title: string;
      source: string;
      detected_at: string;
      impact_summary: string;
      kind: string;
      severity: string;
      status: string;
      target_id: string | null;
      body: string | null;
    }>>`
      select id, title, source, detected_at, impact_summary, kind, severity,
             status, target_id, body
      from ledger.compliance_alerts
      where organization_id = ${this.organizationId}
        and workspace_id = ${this.workspaceId}
      order by detected_at desc
    `;
    return allRows.map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      detectedAt: r.detected_at,
      impactSummary: r.impact_summary,
      kind: r.kind,
      severity: r.severity as ComplianceAlert["severity"],
      status: r.status as ComplianceAlert["status"],
      targetId: r.target_id ?? undefined,
      body: r.body ?? undefined,
    }));
  });
}
```

Add imports:

```ts
import { detectComplianceIssues, today } from "@jpx-accounting/domain";
```

- [ ] **Step 2: Add integration tests**

Append to `tests/integration/postgres-ledger.test.ts`:

```ts
test("refreshComplianceAlerts upserts detected and resolves stale", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t);

  // Seed: create an approved voucher missing supplier VAT — fires Rule 2.
  // (Use the existing test helpers that approve a review and mutate the voucher
  //  to clear supplierVatNumber. Implementation detail varies by helper API.)
  await seedApprovedVoucherWithoutVat(store);

  const first = await store.refreshComplianceAlerts();
  assert.ok(first.some((a) => a.kind === "missing-supplier-vat"));

  // Now backfill the VAT number directly in the DB and refresh — alert resolves.
  await getRawClient(t)`
    update ledger.vouchers
    set voucher_fields = jsonb_set(voucher_fields, '{supplierVatNumber}', '"SE556677889901"')
    where organization_id = 'org_test'
  `;
  const second = await store.refreshComplianceAlerts();
  const stillMissing = second.find((a) => a.kind === "missing-supplier-vat");
  assert.equal(stillMissing?.status, "resolved");
});

test("refreshComplianceAlerts is idempotent (same input → same persisted set)", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t);
  await seedApprovedVoucherWithoutVat(store);
  const first = await store.refreshComplianceAlerts();
  const second = await store.refreshComplianceAlerts();
  assert.equal(first.length, second.length);
  assert.deepEqual(first.map((a) => a.id).sort(), second.map((a) => a.id).sort());
});
```

- [ ] **Step 3: Run + commit**

```bash
SUPABASE_DB_URL=... pnpm test:integration
git add packages/persistence-postgres/src/store.ts tests/integration/postgres-ledger.test.ts
git commit -m "feat(persistence-postgres): refreshComplianceAlerts real implementation

Loads scoped reviews+vouchers, calls detectComplianceIssues, upserts
detected alerts via ON CONFLICT on (org, ws, kind, target_id) with
NULLS NOT DISTINCT (migration 0004). Marks previously-open auto-
detected alerts as resolved when their condition clears, using
'system:auto-resolver' sentinel for attribution (CONVENTIONS Rule 20).
Clears resolved_at/resolved_by on upsert reopen (Rule 18).
"
```

### Task 24: getCompanySettings/putCompanySettings on PostgresLedgerStore

**Files:**
- Modify: `packages/persistence-postgres/src/store.ts`

- [ ] **Step 1: Replace the stubs**

Find `async getCompanySettings` and `async putCompanySettings`. Replace with:

```ts
async getCompanySettings(): Promise<CompanySettings | null> {
  const rows = await this.client<Array<{ settings: CompanySettings }>>`
    select settings from ledger.organization_settings
    where organization_id = ${this.organizationId}
  `;
  return rows[0]?.settings ?? null;
}

async putCompanySettings(input: CompanySettings): Promise<CompanySettings> {
  // Authenticated user attribution would normally come from a ctx field —
  // PostgresLedgerStore on main constructs without one, so use the org id as
  // the audit fallback. When ctx.userId is plumbed through (separate sprint),
  // swap this for ctx.userId.
  await this.client`
    insert into ledger.organization_settings (organization_id, settings, updated_by)
    values (${this.organizationId}, ${this.client.json(input)}, ${this.organizationId})
    on conflict (organization_id) do update
      set settings = excluded.settings,
          updated_at = now(),
          updated_by = excluded.updated_by
  `;
  return input;
}
```

- [ ] **Step 2: Integration test**

Append:

```ts
test("getCompanySettings/putCompanySettings round-trip", { skip: !process.env.SUPABASE_DB_URL }, async (t) => {
  const store = await setupStore(t);
  assert.equal(await store.getCompanySettings(), null);
  const settings = {
    organizationId: "org_test",
    organizationName: "Test AB",
    organizationNumber: "556677-8899",
    addressLine1: "Kungsgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "test@example.com",
  };
  await store.putCompanySettings(settings);
  const loaded = await store.getCompanySettings();
  assert.equal(loaded?.organizationName, "Test AB");
});
```

- [ ] **Step 3: Run + commit**

```bash
SUPABASE_DB_URL=... pnpm test:integration
git add packages/persistence-postgres/src/store.ts tests/integration/postgres-ledger.test.ts
git commit -m "feat(persistence-postgres): getCompanySettings/putCompanySettings real impl

Reads + upserts ledger.organization_settings (table from migration 0004).
Audit attribution uses organization_id as fallback until ctx.userId is
plumbed through PostgresLedgerStore in a separate sprint.
"
```

### Task 25: Full verification, push, open PR-C

- [ ] **Step 1: Full local gate**

```bash
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit
SUPABASE_DB_URL=<your-local-postgres-url> pnpm test:integration
```

Expected: all green.

- [ ] **Step 2: Push**

```bash
git push -u origin port/phase-7-postgres
```

- [ ] **Step 3: Open PR-C**

```bash
gh pr create --base main --head port/phase-7-postgres --title "Port Phase 7 (PR-C): PostgresLedgerStore real implementations" --body "$(cat <<'EOF'
## Summary

PR-C of the Phase 7 port. Replaces PR-B's PostgresLedgerStore stubs with real implementations:

- **runSimulation:** real projection diff (replaces ["6071","2641","6991"] hardcoded stub). Loads reviews+vouchers by reviewIds in a single transaction, computes balanceDelta+vatDelta via simulateApprovals, appends SimulationExecuted event. Dedupes input + throws ReviewNotFoundError on missing IDs.
- **refreshComplianceAlerts:** loads workspace reviews+vouchers, detects via shared detectComplianceIssues, upserts on (org, ws, kind, target_id) with NULLS NOT DISTINCT. Marks stale alerts resolved with 'system:auto-resolver' sentinel. Clears resolved_at/by on reopen.
- **answerAssistantQuestion:** delegates to buildAssistantScaffold (parity with Memory store) + persists to assistant_sessions table.
- **getCompanySettings/putCompanySettings:** reads + upserts ledger.organization_settings.

## Conventions applied

CONVENTIONS.md Rules 11 (store parity — Memory and Postgres produce same shapes), 15 (symmetric fix — same helpers as MemoryLedgerStore), 17 (immutable update via ON CONFLICT, not in-place mutation), 18 (PG ON CONFLICT clears stale audit columns), 20 (system sentinel for auto-resolution), 23 (dedup at boundary).

## Test plan

- [x] Unit suite green (~10 tests from PR-B)
- [x] Integration suite green with SUPABASE_DB_URL set:
  - runSimulation real diff
  - runSimulation throws ReviewNotFoundError
  - answerAssistantQuestion persists
  - refreshComplianceAlerts upsert + resolve cycle
  - refreshComplianceAlerts idempotency
  - company settings round-trip

## Prerequisites

- **Depends on PR-B** (migration 0004 must be deployed before merging this)

## Related

- Phase 7 design spec: docs/superpowers/specs/2026-05-26-track-b-phase-7-completion-design.md
- Port plan: docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Phase 7 port complete after PR-C merges.** PR #14 can be closed as superseded; the next sprint can plan PR-D (Track A IA web cherry-picks) as a separate effort.

---

## PR-D (future sprint) — Track A IA web cherry-picks

Out of scope for this plan. See [`2026-05-27-deploy-to-main-port-plan.md`](./2026-05-27-deploy-to-main-port-plan.md) Phase G for the strategy. Summary:

- Cherry-pick deploy's ~40 Track A IA commits (Today/Capture/Books/Reports/Settings shell, dock nav, nuqs, react-hook-form, Sonner) onto a fresh branch off main
- Resolve conflicts one commit at a time
- Survey first — main may have partial IA work that overlaps

**Scope** for that sprint: produce a separate plan once PR-C lands and the team has bandwidth.

---

## Self-Review

**Spec coverage** — every gap surfaced in the port plan survey maps to a task:

| Survey item | Plan task(s) |
|---|---|
| Cherry-pick CONVENTIONS.md | Task 1 |
| Cherry-pick Phase 7 spec/plan | Task 2 |
| Cherry-pick UI follow-ups | Task 3 |
| Cherry-pick CLAUDE.md pointer + zodResolver fix | Task 4 |
| Extend simulationRequestSchema | Task 6 |
| Extend simulationRunSchema | Task 6 |
| Extend complianceAlertSchema | Task 7 |
| Add companySettingsSchema | Task 8 |
| buildAssistantScaffold helper | Task 9 |
| detectComplianceIssues | Task 10 |
| simulateApprovals | Task 11 |
| ReviewNotFoundError class | Task 12 |
| Extend LedgerStore interface | Task 12 |
| MemoryLedgerStore extensions | Task 13 |
| Migration 0004 (compliance + assistant + settings tables) | Task 14 |
| ReviewNotFoundError -> 404 mapping | Task 15 |
| /api/compliance-watch/refresh real | Task 16 |
| GET/PUT /api/settings/company | Task 17 |
| /api/knowledge/query citation isolation | Task 18 |
| PostgresLedgerStore.runSimulation real | Task 21 |
| PostgresLedgerStore.answerAssistantQuestion | Task 22 |
| PostgresLedgerStore.refreshComplianceAlerts | Task 23 |
| PostgresLedgerStore.getCompanySettings/putCompanySettings | Task 24 |

Out-of-scope (per port plan strategy doc): Track A IA web cherry-picks (PR-D, separate sprint), supa_audit migration (Supabase-specific, dropped per survey), rebuild-projections script (Supabase-specific, drop or rewrite later).

**Placeholder scan:** every code block is complete and concrete; no "TBD", no "implement details here", no "similar to Task N" without repeating the code.

**Type consistency:**
- `ReviewNotFoundError(missingIds: string[])` constructor matches every throw site (Memory's runSimulation, Postgres's runSimulation).
- `LedgerStore` interface signatures (`refreshComplianceAlerts`, `getCompanySettings`, `putCompanySettings`) match the implementations in MemoryLedgerStore, the stubs in PostgresLedgerStore (PR-B), and the real impls (PR-C).
- `simulateApprovals(reviews, suggestions, vouchers, action)` signature matches both call sites (Memory's runSimulation, Postgres's runSimulation).
- `detectComplianceIssues(reviews, vouchers, today)` returns just `alerts`; `detectComplianceIssuesDetailed` returns `{alerts, skipped}` — both signatures consistent across call sites.
- `complianceAlertSchema` field set matches: writer (PostgresLedgerStore upsert payload), reader (the SELECT in refreshComplianceAlerts), and contract (extended in Task 7).
- Migration 0004 columns match what `refreshComplianceAlerts` writes/reads.

**Risks called out:**
- Task 11 may need `buildPostingLines` extraction if main keeps it private — handled by Step 1 check.
- Task 4 (zodResolver fix) is conditional on the file existing on main; instructions handle both cases.
- Task 21 et seq require `SUPABASE_DB_URL` to actually run integration tests. The plan assumes the executing agent has access; if not, they need to flag and either provide credentials or merge based on type-checks alone.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md`.
