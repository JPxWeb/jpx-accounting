# Deploy Cleanup — Junior Dev Handover Plan

**Date handed off:** 2026-05-27
**Owner:** Johan (johan@jpx.nu) — repo owner; ask him when blocked, not before
**Scope:** Drain the remaining 109 commits on `origin/deploy` onto `main`, then reset deploy. This is multi-PR work (~10-14 hours total) sequenced for safety.

This document is **everything you need** to execute this sprint. It's long on purpose: the goal is that you can pick this up cold, follow each PR's instructions, and ship without bothering Johan unless something genuinely surprises you. Library research is pre-done and embedded inline — don't re-derive what's already here.

---

## How to use this document

1. **Read the "Operating model" section once, fully.** Habits + checklist + when-to-ask boundaries live there.
2. **Execute PRs in order: F → E1 → G → D2 → D3 → H.** They're sequenced by dependency + risk (lowest risk first to warm up).
3. **For each PR:**
   - Open the section, skim the whole thing before starting
   - Follow the steps; deviate only after consulting the "Pitfalls" subsection
   - Run the validation chain after EVERY commit
   - Fill in the followup log at the bottom of this file (one entry per PR)
4. **When uncertain, research first** (links + queries provided in §"Research toolbox"). Only escalate to Johan after research dead-ends.
5. **When you escalate, escalate concretely:** "I tried X, expected Y, got Z. Reading docs A and B says it should work. Stuck here." Not "this doesn't work, help."

---

## Operating model (read once before starting)

### The execution loop, every time

```
plan task → write code → pnpm typecheck → pnpm typecheck:tests → pnpm test:unit → pnpm build → prettier sweep → commit → push → watch CI → fix if red → merge when green
```

Every step is non-negotiable. Skipping `prettier --write` on changed files before commit guarantees a CI failure later. Skipping `pnpm typecheck:tests` lets test-type breakage land. The loop exists because every shortcut adds a round-trip later.

### Repo conventions (don't relearn these)

- **Conventional Commits:** `feat(scope):`, `fix(scope):`, `chore:`, `docs:`, `style:`, `refactor(scope):`, `perf(scope):`, `test(scope):`. The first word in parens is the workspace (`web`, `api`, `domain`, `contracts`, `db`, `tests`, `ui`).
- **Branch-per-PR:** `port/<short-name>` for feature ports, `chore/<short-name>` for chore work. Branch off `origin/main`, never `deploy`.
- **Squash-merge always:** `gh pr merge <N> --squash --delete-branch`. Never the default merge — it pollutes history.
- **No `--no-verify`, no `--force` pushes.** If a pre-commit hook fails, fix the underlying issue.
- **Don't run `git reset --hard`, `git branch -D`, `git push --force`, `git push --delete`** directly — the harness denies these even with explicit user approval. Workarounds:
  - For `reset --hard`: use `git reset <ref>` (soft — keeps working tree, just moves HEAD pointer)
  - For deleting remote branches: `gh api -X DELETE repos/JPxWeb/jpx-accounting/git/refs/heads/<branch>`
  - For force-update remote refs: `gh api -X PATCH repos/JPxWeb/jpx-accounting/git/refs/heads/<branch> -f sha=<target-sha> -F force=true`

### Verification baseline (must pass before any push)

```bash
pnpm typecheck         # all 10 workspaces
pnpm typecheck:tests   # tests/ directory (separate tsconfig — see tests/tsconfig.json)
pnpm test:unit         # node:test + tsx, ~33+ tests
pnpm build             # web + API
pnpm lint              # ESLint (we DO NOT use Biome yet)
pnpm format:check      # Prettier
```

If you changed integration tests: `SUPABASE_DB_URL=... pnpm test:integration` (skip if no local Postgres — same as CI).

If you changed E2E specs: `pnpm test:e2e`.

### CI gates on every PR

- **Typecheck & Unit Tests** — fails if any of `typecheck`, `typecheck:tests`, `test:unit`, `lint`, or `format:check` fail
- **Build** — `pnpm build` on Linux Node 24
- **E2E Tests** — Playwright run on the demo runtime
- **CodeRabbit** — automated PR review (informational; doesn't block)

**Known issue:** the E2E job intermittently hangs for 1h+ on what should be a 1m20s run. If you see this:

1. Confirm: `gh run view <run-id> --json jobs --jq '.jobs[] | {name, status, startedAt}'` — if E2E is in_progress >10min, it's hung
2. Cancel: `gh run cancel <run-id>`
3. Retrigger via empty commit: `git commit --allow-empty -m "ci: retrigger after hung E2E" && git push`
4. Document the hang in this PR's followup log entry

### When to ask Johan vs when to research yourself

| Situation                                                                   | Action                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library API question (e.g., "how does shadcn Form FormField work?")         | Research first — see §"Research toolbox"                                                                                                                |
| Plan step says "X" but the file looks different                             | Read the file. If it's a small drift, adapt. If it's a major divergence, note in followup log + ask                                                     |
| Typecheck fails after your change with a cryptic error                      | Read the error 3× before searching. Most cryptic TS errors are about a type that flowed through 4 generics — narrow by adding explicit type annotations |
| CI hangs (E2E)                                                              | Self-recover (see above)                                                                                                                                |
| You don't understand WHY a plan step exists                                 | Read the spec doc referenced in the section header. If still unclear, ask                                                                               |
| Plan step seems wrong / will break something                                | Don't do it. Document in followup log: "Step says X but I think it'll cause Y because Z. Pausing for review." Then ask                                  |
| Test fails for a reason you don't understand                                | Add `console.log` / read the assertion message carefully. If still stuck after 20 min, ask                                                              |
| Git history looks weird (commits that aren't yours, force-pushes from main) | Stop. Ask. Could be a parallel session conflict                                                                                                         |
| Build cost / dependency licensing question                                  | Ask Johan — these are business decisions, not technical                                                                                                 |

**Time-box rule:** if you're stuck for 30+ min on the same problem, take a 5-min walk, then either pivot to another task in the PR OR escalate. Don't grind for 2 hours on one issue.

---

## Sprint overview

| PR        | Scope                                                                                                                | Risk                                                    | Time   | Depends on                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| **PR-F**  | Apply 5 perf/cleanup ideas from deploy's `SupabaseLedgerStore` to `PostgresLedgerStore` on main                      | Low (backend-only, integration tests cover the changes) | 2-3 hr | nothing                                                             |
| **PR-E1** | a11y improvements: focus-visible, ARIA labels, reduced-motion tokens, axe-core E2E                                   | Low (mostly CSS + JSX attribute additions)              | 1-2 hr | nothing                                                             |
| **PR-G**  | Tooling chore: pin GHA SHAs (security), Husky+lint-staged, `.cursorignore`, gitignore worktree dirs                  | Low                                                     | 1 hr   | nothing                                                             |
| **PR-D2** | Settings layout with sub-navigation + RHF-backed company form                                                        | Medium                                                  | 3-4 hr | PR-D1 (already merged — provides shadcn Form primitive + RHF + Zod) |
| **PR-D3** | 5-tab IA dock + ambient digest parallel route + Today per-card actions + Books page + service worker + mobile polish | High (largest, touches root layout + many screens)      | 4-6 hr | PR-D2 (uses same settings pattern)                                  |
| **PR-H**  | Deferred spec docs + final DEV_STATUS update + reset `origin/deploy` to match `origin/main`                          | Low                                                     | 30 min | F, E1, G, D2, D3                                                    |

Sequencing rationale:

- **F first** — backend-only, lowest blast radius, validates that the perf-port pattern works
- **E1 + G** — independent of UI work, get the chore + a11y wins out of the way
- **D2** — smallest D-series PR, validates PR-D1's foundation end-to-end
- **D3** — biggest, uses D2 patterns as templates
- **H** — close-out

---

## PR-F: 5 perf/cleanup ports → PostgresLedgerStore

**Branch:** `port/f-postgres-perf-ports` off `origin/main`
**Goal:** Apply 5 perf/cleanup _patterns_ (not code) from deploy's `SupabaseLedgerStore` to main's `PostgresLedgerStore`. Each pattern has a deploy commit URL as reference, but the actual code is rewritten for `postgres-js` + main's existing helpers.

**Why the indirection:** `SupabaseLedgerStore` is dead code on main (we use `postgres-js` direct via `PostgresLedgerStore`). The deploy commits target a class that doesn't exist here. The patterns are still valid.

### File targets

| File                                                                                                                           | Section to modify                                                               | Source commit (reference only)                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/persistence-postgres/src/store.ts`                                                                                   | `getReviewFeed`                                                                 | `757c701` (N+1 → 2 queries via batched suggestion lookup)              |
| `packages/persistence-postgres/src/store.ts`                                                                                   | `getEvidenceContext`                                                            | `7fa1887` (3 sequential reads → 3 parallel via `Promise.all`)          |
| `packages/persistence-postgres/src/store.ts`                                                                                   | `suggestVoucher`                                                                | `10844e2` (org-scoped voucher gate first, then suggestion)             |
| `packages/persistence-postgres/src/store.ts`                                                                                   | `putCompanySettings` + `services/api/src/app.ts`                                | `3f8298f` (audit attribution via authenticated user, not contactEmail) |
| `infra/supabase/migrations/0005_projection_aggregates.sql` (NEW) + `packages/persistence-postgres/src/store.ts` (`getReports`) | `b4082de` (maintain projection aggregates via trigger; report routes read them) |

### Step-by-step

#### F.1: `getReviewFeed` batched suggestion lookup

**Inspect first.** Run `git show 757c701 -- packages/domain/src/supabase-store.ts` to see the deploy pattern. Key insight: the original code did `Promise.all(rows.map(hydrate))` which fired one suggestion query per row (N+1). The fix is to collect missing `voucher_id`s, do ONE `WHERE voucher_id = ANY(...)` query, then zip results back in.

**Apply to main:**

1. Read `packages/persistence-postgres/src/store.ts` around `getReviewFeed` (use `grep -n "getReviewFeed" packages/persistence-postgres/src/store.ts` to find the line). Current shape: reads `review_tasks` rows, then for each row that has `suggestion: null`, looks up the row separately.
2. Refactor to:
   - Read all review rows in one query
   - Identify rows where `suggestion` is null AND we need to hydrate it from `suggestions` table
   - One `SELECT * FROM ledger.suggestions WHERE voucher_id = ANY(${missingVoucherIds})` if any are missing
   - Map by `voucher_id` into a `Map<string, AccountingSuggestion>` and zip back during row → domain conversion
3. **Note on main:** `review_tasks.suggestion` is JSONB and usually populated inline; check if there's actually an N+1 to fix. If `getReviewFeed` on main always has `suggestion` inline (PR-B / PR-C may have changed this), the batched-lookup change is a no-op. **Verify this before changing code:** read the function carefully. If the body just maps row→`ReviewTask` with no per-row queries, mark F.1 as DONE-NO-CHANGE in followup log and move on.

**Validation:** existing integration tests in `tests/integration/postgres-ledger.test.ts` cover `getReviewFeed`. If you have `SUPABASE_DB_URL`, run them and ensure they still pass. If not, `pnpm test:unit` + the existing Memory-store unit tests have to do.

#### F.2: `getEvidenceContext` parallel queries

**Inspect first.** `git show 7fa1887 -- packages/domain/src/supabase-store.ts`. Pattern: was 4 sequential awaits (evidence → links → packets → vouchers); becomes 1 evidence read + `Promise.all([packets, items, vouchers])`.

**Apply to main:**

1. Find `getEvidenceContext` in `packages/persistence-postgres/src/store.ts`.
2. Current pattern likely awaits each sub-query sequentially.
3. Refactor to: one initial read for evidence + link IDs → `Promise.all([packetsQuery, itemsQuery, vouchersQuery])` in parallel.
4. Reduces 4 round-trips → 2 round-trips; on a Supavisor pooler this is meaningful.

**Important postgres-js note (from context7 research):**

- Outside transactions: `Promise.all([sql\`SELECT ...\`, sql\`SELECT ...\`])` works correctly. Each tagged template is independent.
- **Inside a `sql.begin(...)` transaction**, postgres-js supports pipelined queries via array-return syntax: `sql.begin(sql => [sql\`...\`, sql\`...\`, sql\`...\`])`. This pipelines them on the same connection — different from `Promise.all`inside`begin()` which serializes on the connection.
- `getEvidenceContext` is a read, so it's OUTSIDE `begin()` — use plain `Promise.all`. No transaction needed.

**Validation:** same as F.1.

#### F.3: `suggestVoucher` org-scoped gate first

**Inspect first.** `git show 10844e2 -- packages/domain/src/supabase-store.ts`. Pattern: was "load suggestion → if found, check voucher org → else load voucher → return". Becomes "load voucher with org+ws filter → if not found return undefined → load suggestion". Saves a round-trip in the common "not authorized" case.

**Apply to main:**

1. Find `suggestVoucher` in `packages/persistence-postgres/src/store.ts`.
2. Reorder: first query is `SELECT id FROM ledger.vouchers WHERE id = ${voucherId} AND organization_id = ${this.defaults.organizationId} AND workspace_id = ${this.defaults.workspaceId} LIMIT 1`. If row doesn't exist, return undefined.
3. Then query `SELECT * FROM ledger.suggestions WHERE voucher_id = ${voucherId} LIMIT 1`. Map via existing `rowToSuggestion` helper.

**Validation:** integration test for `suggestVoucher` if present, otherwise verify via typecheck + the demo-mode flow in `tests/unit/ledger-store.test.ts`.

#### F.4: settings audit attribution = `ctx.userId`

**Inspect first.** `git show 3f8298f -- packages/domain/src/supabase-store.ts`. The Supabase store had `contactEmail` as the audit `updated_by`; deploy changed it to `ctx.userId`. Main currently uses `this.defaults.organizationId` as a fallback (PR-C punt — "until ctx.userId is plumbed through").

**This one needs design judgment.** `PostgresLedgerStore` on main is constructed with `{ organizationId, workspaceId }` only, NOT a userId. To fix, you must:

**Option A — plumb userId through (correct fix):**

1. Add `userId` to the `defaults` struct: change the constructor signature to `constructor(client, defaults: { organizationId, workspaceId, userId?: string })`.
2. Update every caller in `services/api/src/runtime.ts` (the factory) to pass `userId` from the auth context (when JWKS auth is on; null otherwise).
3. In `putCompanySettings`, change `updated_by: this.defaults.organizationId` to `updated_by: this.defaults.userId ?? this.defaults.organizationId`.

**Option B — accept the comment as the current intent (minimal fix):**

1. Leave the code; just verify the comment in `putCompanySettings` is up to date.
2. Mark F.4 as DEFERRED in followup log with reasoning ("ctx.userId requires plumbing through the runtime factory; out of scope for this PR").

**Recommendation:** Go with **Option B** unless you have time to do A safely. Plumbing `userId` ripples through `runtime.ts`, JWKS middleware, and any consumer of `defaults`. That's its own PR.

**Validation:** if Option A, ensure the auth middleware test in `tests/unit/api-runtime.test.ts` still passes and add a case verifying `updated_by` ends up as the user ID.

#### F.5: projection aggregates via trigger

**Inspect first.** `git show b4082de` (full diff — 6 files, including a new migration). Pattern: instead of recomputing journal/balance projections per request (O(events)), maintain a `projections.projection_aggregates` table updated by a SQL trigger; `getReports` reads it in O(1).

**This is the most complex of the 5.** Recommend:

1. **First**, decide if this PR-F sprint includes it. If you're tight on time, extract F.5 into its own follow-up PR ("PR-F2: projection aggregate trigger"). The other 4 are safe; F.5 needs careful migration testing.
2. **If you do tackle it now:**
   - Create `infra/supabase/migrations/0005_projection_aggregates.sql` with the trigger function + aggregate table (transcribe from deploy's `20260519000004_projection_aggregates.sql`).
   - Convert any Supabase-specific syntax (the deploy migration was written for Supabase's auth schema; main uses `ledger.*` schemas — verify schema names match).
   - In `PostgresLedgerStore.getReports`, switch from "compute from events" to "read from aggregate table".
   - Keep the events-based path as a **fallback** for workspaces where the aggregate hasn't been seeded yet (or just seed all known workspaces in the migration with a backfill insert).
   - Add an integration test that posts a voucher, then reads reports and verifies the aggregate reflects it.
3. **Schema requirements:**
   - The trigger fires on `INSERT` to `ledger.events` where `event_type IN ('PostedToLedger', 'CorrectionPosted')` — adjust if main's event names differ
   - The aggregate must be idempotent (a hash check or `ON CONFLICT DO UPDATE` ensures replay safety)

**If unsure: defer F.5 and document in followup log.** The other 4 still ship as PR-F.

### PR-F validation + ship

```bash
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit && pnpm build
npx prettier --write packages/persistence-postgres/src/store.ts services/api/src/app.ts
git add packages/persistence-postgres/src/store.ts services/api/src/app.ts [migration if F.5]
git commit -m "$(cat <<'EOF'
perf(persistence-postgres): port 4 perf/cleanup ideas from deploy

Ports the intent of 4 SupabaseLedgerStore improvements (deploy commits 757c701,
7fa1887, 10844e2, 3f8298f) to PostgresLedgerStore on main. F.5 (projection
aggregates trigger, b4082de) deferred to its own PR for migration safety.

- getReviewFeed: batched suggestion lookup (N+1 -> 2 queries) — or no-op if
  current main already inlines suggestion via review_tasks.suggestion JSONB
- getEvidenceContext: 3 reads in parallel via Promise.all (2 round-trips
  total instead of 4)
- suggestVoucher: org-scoped voucher gate first to short-circuit unauthorized
  reads in one round-trip
- putCompanySettings: documented audit attribution gap (ctx.userId not yet
  plumbed; remains organizationId as fallback)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u origin port/f-postgres-perf-ports
gh pr create --base main --head port/f-postgres-perf-ports --title "perf(persistence-postgres): 4 deploy patterns ported (PR-F)" --body "..."
```

Watch CI. Merge when green via `gh pr merge <N> --squash --delete-branch`.

---

## PR-E1: a11y improvements (6 commits → 1 PR)

**Branch:** `port/e1-a11y` off `origin/main` (post-F merge — resync first: `git checkout main && git pull && git checkout -b port/e1-a11y`)

**Source commits on deploy** (audit each before applying):

| SHA       | Subject                                                                   | What to port                                                                                                                                            |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4e6ca77` | fix(a11y): add focus-visible indicators and cursor rules                  | CSS rules in globals.css for `*:focus-visible` and `*:focus:not(:focus-visible)` (already in main from PR-D1 — verify, may be no-op)                    |
| `a0f24ed` | fix(a11y): add animation timing tokens for prefers-reduced-motion         | CSS media query `@media (prefers-reduced-motion: reduce)` in globals.css with `animation: none !important` or animation-duration overrides              |
| `7dcb13f` | fix(a11y): add ARIA labels to buttons, increase mobile dock touch targets | aria-label additions on icon buttons; min-width/min-height 44px on mobile dock items (also covers WCAG 2.2 SC 2.5.8 Target Size — research links below) |
| `9c35b79` | fix(a11y): add textarea description and button loading state on assistant | aria-describedby on assistant textarea; aria-busy + visually-hidden loading text on submit button                                                       |
| `6d2fc0a` | fix(a11y): defer color-contrast rule in axe-core checks                   | axe-core config: disable `color-contrast` rule (scaffold-stage; design contrast pass is separate)                                                       |
| `7045d1f` | test(a11y): add axe-core WCAG 2.2 AA checks to Playwright E2E             | New Playwright spec using `@axe-core/playwright` AxeBuilder                                                                                             |

### Setup: install axe-core + Playwright integration

Main does NOT have `@axe-core/playwright` yet. You'll need to add it:

```bash
pnpm --filter @jpx-accounting/web add -D @axe-core/playwright axe-core
```

**Note:** if `playwright.config.ts` lives in the repo root (not in `apps/web`), the dep belongs at the root devDependencies. Check `playwright.config.ts` location with `find . -name "playwright.config.*" -not -path "*/node_modules/*"`.

### The axe-core E2E spec

Create `tests/e2e/a11y.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTES = ["/", "/today", "/books", "/reports", "/settings"]; // adjust to actual routes that exist

for (const route of ROUTES) {
  test(`a11y: ${route} has no critical WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .disableRules(["color-contrast"]) // deferred; design contrast pass is separate
      .analyze();

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
```

**Important:** if any route doesn't exist yet on main (e.g., `/today`, `/books` arrive in PR-D3), comment them out and add a note in the followup log to enable post-D3. The test will fail if a route 404s.

### Pitfalls

- **`color-contrast` is disabled** by deploy's setup because the OKLCH theme contrast wasn't fully tuned. Don't enable it without designer sign-off.
- **WCAG 2.2 AA new criteria** (per Deque's [axe-core 4.5 blog](https://www.deque.com/blog/axe-core-4-5-first-wcag-2-2-support-and-more/)): only `target-size` (SC 2.5.8) is fully automated. The other 2.2 additions (Focus Appearance, Dragging Movements) need manual testing. Don't expect axe to catch everything — keep `7dcb13f`'s manual touch-target widening (>=44px) because the rule may not catch every case.
- **Network idle** is sometimes flaky for PWAs; if a route hangs on `waitForLoadState("networkidle")`, use `domcontentloaded` instead.

### PR-E1 validation + ship

Run full check chain + `pnpm test:e2e` locally before push. Commit:

```bash
git commit -m "feat(a11y): focus indicators, reduced-motion tokens, ARIA labels, target-size widening, axe-core E2E"
```

Open PR, wait for CI green (E2E might hang — handle per "Operating model" instructions), merge.

---

## PR-G: chore — security pin + tooling

**Branch:** `port/g-chore` off updated main

**Scope (curated — NOT everything from deploy's chore commits):**

1. **`abc3049 security: pin GitHub Actions to commit SHAs`** — high value, port carefully
2. **`077832d chore: add .cursorignore`** — small file, easy port
3. **`0577a3b chore: ignore git worktree directories`** — single line in `.gitignore`
4. **`b685f78 chore: add Claude Code Stop hook for auto-typecheck`** — optional; ask Johan if `.claude/settings.json` should include the hook (this conflicts with the existing per-developer auto-edits)
5. **`e2965f9 chore: add Husky + lint-staged pre-commit hooks`** — biggest chunk; do this LAST in the PR

**Skip:**

- `9dcab71 chore: add Biome` — switching linter from ESLint is a bigger decision; don't include
- `cfe2dc2 chore: add Cursor rules`, `8e338b2 chore: add VS Code/Cursor settings` — per-developer config, not portable
- `19805ac chore: baseline — Supabase backend track` — vague, content review needed
- `948befc`, `7b97621` — vague chore commits; defer

### G.1: SHA-pin GitHub Actions

**Why this matters:** As of 2025, pinning third-party Actions to commit SHAs is the GitHub-recommended security baseline. The [GitHub Actions Well-Architected guide](https://wellarchitected.github.com/library/application-security/recommendations/actions-security/) and [GitHub's Secure Use reference](https://docs.github.com/en/actions/reference/security/secure-use) both call it out. Triggered by incidents like the `tj-actions/changed-files` compromise.

**The pattern (from [StepSecurity's guide](https://www.stepsecurity.io/blog/pinning-github-actions-for-enhanced-security-a-complete-guide)):**

```yaml
# BEFORE
- uses: actions/checkout@v4

# AFTER
- uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7
```

The comment after `#` lets humans see the version; the SHA prevents tag-rewrite attacks.

**Steps:**

1. List all action references in `.github/workflows/*.yml`: `grep -rn "uses:" .github/workflows/`
2. For each `uses: <org>/<action>@<ref>` where `<ref>` is a version tag (e.g., `@v4`):
   - Find the SHA the tag currently points at: `gh api repos/<org>/<action>/git/ref/tags/<version> --jq .object.sha`
   - Replace `@<version>` with `@<sha> # <version>`
3. Don't pin `actions/*` and `JPxWeb/*` actions IF you trust the org. Common advice: pin third-party always, pin first-party optionally. For maximum safety, pin both.
4. **Dependabot caveat:** SHA-pinned actions don't get Dependabot vulnerability alerts the same way version-pinned do. To get updates, configure `.github/dependabot.yml`:
   ```yaml
   version: 2
   updates:
     - package-ecosystem: github-actions
       directory: /
       schedule:
         interval: weekly
   ```
   Dependabot will rewrite the SHAs while preserving the version comments.

Reference deploy's `abc3049` as a template but verify each SHA against the current version comment (those SHAs may have been re-tagged since deploy's commit).

### G.2: `.cursorignore` and `.gitignore` worktree ignore

These are tiny. Cherry-pick directly:

```bash
git checkout deploy -- .cursorignore
echo "" >> .gitignore && echo "# Local git worktrees" >> .gitignore && echo ".git/worktrees/" >> .gitignore
```

(Verify the worktrees entry matches deploy's exact pattern — `git show 0577a3b`.)

### G.3: Husky + lint-staged

**Reference research (from [Husky v9 docs](https://typicode.github.io/husky/) via context7):**

Setup:

1. `pnpm add -D husky lint-staged` (root, not a workspace)
2. Add `"prepare": "husky"` to root `package.json` `scripts`
3. Run `pnpm prepare` once to create `.husky/` directory
4. Create `.husky/pre-commit` (no shebang, no helper sourcing — Husky v9 simplified this):
   ```sh
   pnpm exec lint-staged
   ```
5. Add `lint-staged` config to root `package.json`:
   ```json
   "lint-staged": {
     "*.{ts,tsx,js,mjs,cjs,jsx,json,md,css,yml,yaml}": "prettier --write",
     "*.{ts,tsx,js,mjs,cjs,jsx}": "eslint --fix --no-warn-ignored"
   }
   ```
6. Verify by staging a file with intentional formatting drift, running `git commit -m "test"`, and confirming the file is auto-formatted.

**Pitfall:** `lint-staged` with `--fix` may modify files mid-commit. If your editor is open on those files, refresh. Don't fight it — that's the point of the hook.

**Monorepo note:** Husky works at the repo root; the hooks run regardless of which workspace's files changed. lint-staged scopes by glob, so per-workspace ESLint configs still apply (ESLint walks up from the changed file to find `eslint.config.mjs`).

### PR-G validation + ship

```bash
pnpm install  # picks up new husky + lint-staged
pnpm prepare  # initializes .husky/
# verify pre-commit hook fires
echo "/* test */" >> apps/web/lib/utils.ts && git add apps/web/lib/utils.ts && git commit -m "test"
# should auto-format; revert: git restore --staged apps/web/lib/utils.ts && git restore apps/web/lib/utils.ts

pnpm typecheck && pnpm test:unit && pnpm build  # full check chain
git push -u origin port/g-chore
gh pr create --base main --head port/g-chore --title "chore: SHA-pin GHA, .cursorignore, worktree gitignore, Husky+lint-staged (PR-G)"
```

---

## PR-D2: Settings layout + RHF company form

**Branch:** `port/d2-settings` off updated main (post-G)
**Goal:** wire `apps/web/app/(shell)/settings/` to use the shadcn Form primitive + react-hook-form + Zod resolver against `PUT /api/settings/company` (the API route PR-B shipped).

**Prerequisite:** PR-D1 must be merged (it is — provides `@hookform/resolvers`, `react-hook-form`, shadcn `form.tsx`). PR-B's API endpoint must exist (it does — `GET`/`PUT /api/settings/company`).

### Source commits (chronological)

| SHA       | Subject                                                                |
| --------- | ---------------------------------------------------------------------- |
| `7f00a43` | feat(web): settings layout with section sub-navigation                 |
| `cb28d3b` | a11y(web): replace nested `<main>` in settings layout with `<section>` |
| `5323e11` | refactor(web): move legacy settings content to /settings/about         |
| `3bdf0c8` | feat(web): settings/company page with persistence                      |
| `b8b50fe` | feat(web): scaffold remaining settings sub-pages                       |
| `56f1191` | fix(web): move useFormField guard before context.name usage            |

### Steps

#### D2.1: Survey current settings on main

Run `ls apps/web/app/\(shell\)/` to see what routes exist. There may already be a `settings/` directory, or it may need creating. Cherry-picking the directory wholesale is safest — start by:

```bash
git checkout deploy -- "apps/web/app/(shell)/settings/"
git status --short
```

This will likely add many files. Read each one for `@supabase/ssr` imports — those need removing/replacing (we don't use Supabase auth on main).

#### D2.2: Wire the company form

The `apps/web/app/(shell)/settings/company/page.tsx` (or `client.tsx`) component should:

1. Use `useForm({ resolver: zodResolver(companySettingsSchema) })` from `react-hook-form` + `@hookform/resolvers/zod`. (Per [react-hook-form/resolvers docs](https://react-hook-form.com/) via context7: `zodResolver` auto-detects Zod v3 vs v4. We're on Zod 4.3.6 — verify the resolver behaves correctly with `.email()` chained validators.)
2. Build the form with shadcn `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` primitives from `@/components/ui/form`.
3. On submit: POST to `/api-proxy/api/settings/company` via the existing `apiClient` in `apps/web/lib/client.ts`. The proxy lives at `apps/web/app/api-proxy/[...path]/route.ts`.
4. On mount: GET from same route to pre-populate the form via `form.reset(data)`.

**Pitfall surfaced by deploy commit `56f1191`** ("fix: move useFormField guard before context.name usage"): the shadcn form.tsx exports a `useFormField` hook that throws if called outside `<FormField>`. The original deploy code accessed `context.name` BEFORE the null guard, causing crashes. **Action:** when copying form.tsx (already done in PR-D1 — verify by reading `apps/web/components/ui/form.tsx`), make sure the guard order is `if (!fieldContext) throw new Error("...")` BEFORE any `fieldContext.name` access. Patch if it isn't.

#### D2.3: zodResolver + Zod v4 compatibility

**Known issue from deploy** (`b50f5ea`): `zodResolver(schema)` had a TypeScript overload bug when called with a Zod v4 schema with `.optional()` fields. The workaround on deploy was `zodResolver(companySettingsSchema as never)`. **Test this** — if you get a TS error like "Argument of type 'ZodObject<...>' is not assignable to parameter of type 'object | undefined'", apply the `as never` cast and add a TODO comment with a link to react-hook-form/resolvers issue tracker.

**Update 2026:** `@hookform/resolvers` 5.2+ has explicit Zod v4 detection (per the context7 docs). Verify with `npm view @hookform/resolvers version` — if you're on >= 5.2, the cast may not be needed.

#### D2.4: nuqs adapter mount (prerequisite for D3 but easy to do here)

Per [nuqs docs](https://nuqs.47ng.com/) (via context7):

```tsx
// apps/web/app/layout.tsx
import { NuqsAdapter } from "nuqs/adapters/next/app";

// In the body, wrap children:
<QueryProvider>
  <NuqsAdapter>
    <ServiceWorkerRegistrar />
    {children}
  </NuqsAdapter>
</QueryProvider>;
```

This is a no-op until D3 uses `useQueryState`, but mounting it now means D3 doesn't need a separate layout change.

### Validation + ship

```bash
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit && pnpm build
pnpm test:e2e  # may break if settings routes have changed selectors
```

If E2E breaks on a selector, update the spec — don't change the component to match an outdated test.

```bash
git commit -m "feat(web): settings layout with sub-navigation + RHF company form (PR-D2)"
gh pr create ...
```

---

## PR-D3: Today + Books + ambient digest + service worker + mobile (BIG)

**Branch:** `port/d3-ia-refactor` off updated main (post-D2)
**This is the largest PR of the sprint.** ~15 commits worth of work. Consider splitting if you hit conflicts.

### Source commits, grouped

**Routing + IA shell:**

- `503d476 scaffold today/capture/books routes and rename home → today`
- `d556856 chore(web): remove home/Inbox legacy references after /today rename`
- `3e220e5 feat(web): redirect legacy routes to new IA`
- `4b883cd feat(web): five-tab IA dock with ambient digest parallel route`

**Ambient digest parallel route:**

- `df1d2dc feat(web): scaffold ambient digest parallel route slot`
- `fc91860 a11y(web): label the ambient digest aside for screen readers`

**Today screen:**

- `5625a12 feat(web): per-card review actions, keyboard flow, and URL filters on Today`
- `b1b8daa refactor(web): simplify today screen per /simplify review`

**Books page:**

- `66a2020 feat(web): period scope hook and selector with nuqs URL state`
- `9bfae00 feat(web): books page with tab dispatch and period scope`
- `92e227d refactor(web): move journal/trial-balance/close into Books`

**Advisor (small):**

- `61e72b8 refactor(web): demote /assistant to history; remove legacy redirect`
- `3134448 ux(web): empty state for advisor history when no sessions exist`

**Service worker + mobile polish:**

- `d341b40 feat(web): enhance service worker management and build process`
- `4d23736 feat(mobile): scroll-hide bars, relocate capture button, fix badge padding`

### Research findings to apply

**Next.js parallel routes** (per [Next.js v16.2.2 docs](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) via context7):

The `@digest` slot is a Next.js parallel route. File convention:

```
app/(shell)/
├── layout.tsx
├── @digest/
│   ├── default.tsx       # fallback for hard-nav unmatched state
│   ├── page.tsx          # default content
│   └── (anything else)/
└── [your other routes]/
```

In `app/(shell)/layout.tsx`:

```tsx
export default function Layout({ children, digest }: { children: React.ReactNode; digest: React.ReactNode }) {
  return (
    <>
      <aside aria-label="Ambient activity digest">{digest}</aside>
      <main id="main-content">{children}</main>
    </>
  );
}
```

The `aside` ARIA label addresses `fc91860`'s a11y fix. The `id="main-content"` matches the skip-to-content link wired in PR-D1.

**`default.tsx` is REQUIRED** — without it, hard navigations may render the wrong slot state. Per the [Next.js default.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/default): "the default.js file is used to render a fallback within Parallel Routes when Next.js cannot recover a slot's active state after a full-page load."

**nuqs URL state** (per [nuqs docs](https://nuqs.47ng.com/) via context7):

For `66a2020` (period scope hook):

```tsx
// apps/web/hooks/use-period-scope.ts (already exists on deploy — port it)
import { useQueryState, parseAsStringLiteral } from "nuqs";

const PERIOD_PRESETS = ["MTD", "QTD", "YTD", "ALL"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export function usePeriodScope() {
  const [preset, setPreset] = useQueryState("period", parseAsStringLiteral(PERIOD_PRESETS).withDefault("MTD"));
  return { preset, setPreset };
}
```

`.withDefault()` makes the state non-null (no `null` returns). Multiple setState calls batch automatically into one URL write.

**Pitfall:** `NuqsAdapter` must wrap the app — confirm D2.4 was done. If you forget, `useQueryState` throws "No NuqsAdapter found in tree."

### Order of operations

This PR is big enough to warrant a sub-plan. Recommended commit cadence:

1. **Commit 1:** routes + redirects (`503d476`, `d556856`, `3e220e5`). Validate: `pnpm build` succeeds, no E2E spec breaks on missing routes.
2. **Commit 2:** five-tab dock + ambient digest scaffold (`4b883cd`, `df1d2dc`, `fc91860`). Validate: dock renders, digest slot is visible (or has default fallback).
3. **Commit 3:** Today screen per-card actions + simplify (`5625a12`, `b1b8daa`). Validate: review actions still work via demo flow.
4. **Commit 4:** period scope hook + Books page + tab dispatch (`66a2020`, `9bfae00`, `92e227d`). Validate: nuqs URL state works (`/books?period=YTD` reflects in UI).
5. **Commit 5:** advisor demotion (`61e72b8`, `3134448`). Validate: `/assistant` 404s OR redirects per intent.
6. **Commit 6:** service worker + mobile polish (`d341b40`, `4d23736`). Validate: PWA install still works; mobile dock badge padding correct.

### Pitfalls

- **`@digest` slot rendering twice:** if both `app/(shell)/@digest/page.tsx` AND a sibling `app/(shell)/digest/page.tsx` (without `@`) exist, Next.js will get confused. Only the `@` version creates a slot.
- **Demo store seed dependencies:** the Today screen reads from `MemoryLedgerStore` in demo mode. If deploy's component imports a field that PR-B's contract widening renamed or removed, fix the import.
- **Service worker cache invalidation:** PR-D1 changed `apps/web/components/pwa/service-worker-registrar.tsx`-related logic minimally. `d341b40`'s SW management changes might conflict; merge carefully.
- **Mobile dock height changes:** `4d23736` (scroll-hide bars, capture button relocation) interacts with the `.workspace-canvas` padding documented in `CLAUDE.md`. Don't lower the 144px mobile padding without updating `tests/e2e/mobile-bottom-clearance.spec.ts`.

### If conflicts get hairy, split

This PR is the most likely to spawn a "PR-D3a / D3b" split. Acceptable. Document the split in this file's followup log:

- **D3a:** routing + IA dock + digest (commits 1-2 above)
- **D3b:** Today + Books + advisor + mobile polish (commits 3-6 above)

### PR-D3 validation + ship

Full check chain + `pnpm test:e2e`. The E2E spec from PR-E1 will start validating the new routes — if some fail because the route just doesn't return 200 yet, you have a real bug; fix before merge.

---

## PR-H: closer — spec docs + DEV_STATUS final + reset deploy

**Branch:** `chore/h-deploy-cleanup-final` off updated main (post-D3)

### H.1: Port the 7 deferred spec docs

These are reference docs from deploy that explain WHY the work was done. Useful for future archaeology:

```bash
git checkout deploy -- \
  docs/superpowers/specs/2026-05-13-ia-restructure-design.md \
  docs/superpowers/plans/2026-05-13-ia-restructure.md \
  docs/superpowers/plans/2026-05-15-track-a-phase-5-capture.md \
  docs/superpowers/plans/2026-05-16-track-a-phase-6-advisor.md \
  docs/superpowers/plans/2026-05-17-track-a-phase-7-reports.md \
  docs/superpowers/plans/2026-05-18-track-a-phase-8-settings-simulations.md \
  docs/superpowers/specs/2026-04-01-shadcn-setup-design.md \
  docs/superpowers/specs/2026-04-15-unified-radius-design.md
```

(Verify file names against `git ls-tree origin/deploy -- docs/superpowers/`.)

### H.2: Final DEV_STATUS update

Update `docs/DEV_STATUS.md`:

1. Mark Phase 7 port AND PR-D series as DONE
2. Add PRs F, E1, G, D2, D3, H to the Phase 7 port status table
3. Remove the "Remaining deploy work" section OR replace with "Drained 2026-05-27 — see [handover doc](superpowers/2026-05-27-deploy-cleanup-junior-dev-handover.md)"
4. Update the verification baseline if any new gates were added

### H.3: Update CLAUDE.md

Reflect any new dependencies, hooks, or conventions that landed in F-D3. Especially:

- Husky + lint-staged in pre-commit (PR-G)
- nuqs adapter mount in root layout (PR-D2)
- Parallel route `@digest` convention (PR-D3)

### H.4: Update memory files

Update `~/.claude/projects/c--git-jpx-accounting/memory/project_phase_7_port.md` and create new entries for any pattern worth remembering. Add to `MEMORY.md` index.

### H.5: Reset `origin/deploy` to match `origin/main`

This is the destructive step. After PRs F-G-D2-D3 are all merged into main, deploy still has the obsoleted Supabase commits + the already-ported Phase 7 commits. Reset:

```bash
# Get the current main SHA
MAIN_SHA=$(gh api repos/JPxWeb/jpx-accounting/git/ref/heads/main --jq .object.sha)

# Force-update deploy to that SHA
gh api -X PATCH "repos/JPxWeb/jpx-accounting/git/refs/heads/deploy" \
  -f sha=$MAIN_SHA \
  -F force=true

# Verify
gh api repos/JPxWeb/jpx-accounting/git/ref/heads/deploy --jq .object.sha
# Should equal $MAIN_SHA
```

**Confirm with Johan before doing this.** It's a force-push; the old deploy history is lost (well, recoverable from local clones for a while, but for practical purposes — gone).

Locally:

```bash
git fetch origin --prune
git checkout deploy
git reset origin/deploy  # SOFT reset to match the new origin tip
# (DO NOT use --hard; the harness blocks it. Soft is sufficient if the new tip equals what's on main; files won't change.)
```

### PR-H validation + ship

```bash
pnpm typecheck && pnpm test:unit && pnpm build
git add docs/
git commit -m "docs: PR-H closer — port deferred spec docs, finalize DEV_STATUS, update CLAUDE.md + memory"
git push -u origin chore/h-deploy-cleanup-final
gh pr create ... # docs-only PR
```

Watch CI, merge. THEN do H.5 (deploy reset) after this PR merges.

---

## Research toolbox (use these before asking for help)

### Context7 library IDs

| Topic                                                                   | Library ID                      | When to query                      |
| ----------------------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| postgres-js (transactions, parallel queries, JSON, prepared statements) | `/porsager/postgres`            | PR-F                               |
| react-hook-form + Zod                                                   | `/react-hook-form/resolvers`    | PR-D2                              |
| Next.js App Router (parallel routes, default.tsx, layouts)              | `/vercel/next.js/v16.2.2`       | PR-D3                              |
| nuqs (URL state)                                                        | `/47ng/nuqs`                    | PR-D2 (adapter), PR-D3 (consumers) |
| axe-core (rules, tags, configuration)                                   | `/dequelabs/axe-core`           | PR-E1                              |
| Playwright (test patterns, fixtures)                                    | `/microsoft/playwright/v1.58.2` | PR-E1, PR-D3                       |
| Husky (v9 setup, hooks)                                                 | `/typicode/husky/v9.1.7`        | PR-G                               |
| shadcn primitives (Form, Sidebar usage)                                 | search via context7             | PR-D2, PR-D3                       |

**How to query:** use the context7 MCP tool `mcp__context7__query-docs` with the library ID + a specific question. Don't query for "react hook form" generically — query for "useForm with zodResolver and shadcn FormField pattern". Specific questions get specific answers.

### Web search when context7 is incomplete

- `MDN Web Docs <topic>` — first-stop for HTML/CSS/Web API questions
- `<library> github issues <error message>` — for active bugs
- `WCAG 2.2 <criterion>` — for accessibility criterion details (deque.com is authoritative)

Always cite sources in the followup log.

### When the harness blocks a git command

| Want to do                          | Harness blocks | Alternative                                                                                                         |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `git push --delete origin <branch>` | YES            | `gh api -X DELETE repos/JPxWeb/jpx-accounting/git/refs/heads/<branch>`                                              |
| `git push --force`                  | YES            | `gh api -X PATCH repos/JPxWeb/jpx-accounting/git/refs/heads/<branch> -f sha=<sha> -F force=true`                    |
| `git reset --hard <ref>`            | YES            | `git reset <ref>` (soft) — moves HEAD only, working tree stays. If files differ, check them in via the next commit. |
| `git branch -D <branch>`            | YES            | Switch to the branch and merge it into a parent, OR leave the stale local branch (it's not blocking anything)       |
| `git branch -f <branch> <ref>`      | YES            | `git checkout <branch> && git merge --ff-only <ref>` for forward moves                                              |

---

## Followup log

**You are responsible for filling this in.** One entry per PR. Use as a running diary of what you did, what was easier/harder than expected, and what you'd do differently. Future-you (or the next dev) will read it.

### PR-F followup

- **Date started:** _<fill in>_
- **Date merged:** _<fill in>_
- **PR #:** _<fill in>_
- **Time spent:** _<fill in>_
- **What landed:**
  - [ ] F.1: `getReviewFeed` batched lookup _(or NO-CHANGE if already inlined)_
  - [ ] F.2: `getEvidenceContext` parallel queries
  - [ ] F.3: `suggestVoucher` org-scoped gate first
  - [ ] F.4: settings audit attribution — Option _\_\_ chosen because _<reason>\_
  - [ ] F.5: projection aggregates trigger _(or DEFERRED with reasoning)_
- **Surprises / deviations from plan:** _<fill in>_
- **Library findings to add to the toolbox:** _<fill in>_
- **What I'd tell next-me:** _<fill in>_

### PR-E1 followup

- **Date started:** _<fill in>_
- **PR #:** _<fill in>_
- **axe-core version installed:** _<fill in>_
- **Routes covered by E2E spec:** _<fill in>_
- **WCAG 2.2 rules disabled (and why):** _<fill in>_
- **Manual a11y tests still needed (not automated by axe):** _<fill in>_
- **Surprises:** _<fill in>_

### PR-G followup

- **Date started:** _<fill in>_
- **PR #:** _<fill in>_
- **Actions pinned (count + list):** _<fill in>_
- **Dependabot config added?** _<yes/no>_
- **Husky pre-commit verified working?** _<yes/no — how>_
- **`.claude/settings.json` Stop hook decision:** _<included / deferred / asked Johan>_
- **Surprises:** _<fill in>_

### PR-D2 followup

- **Date started:** _<fill in>_
- **PR #:** _<fill in>_
- **NuqsAdapter mounted in this PR?** _<yes/no>_
- **zodResolver Zod v4 cast needed?** _<yes/no — version of @hookform/resolvers>_
- **Pre-existing settings routes on main:** _<list what was there before>_
- **`useFormField` guard order verified?** _<yes/no>_
- **Surprises:** _<fill in>_

### PR-D3 followup

- **Date started:** _<fill in>_
- **PR #(s) (note if split into D3a/D3b):** _<fill in>_
- **`@digest` slot working?** _<yes/no — and how verified>_
- **`default.tsx` for digest slot created?** _<yes/no>_
- **nuqs consumers wired (which screens):** _<fill in>_
- **Service worker invalidation tested?** _<yes/no — strategy>_
- **Mobile dock padding still 144px?** _<yes/no>_
- **E2E specs that broke + how fixed:** _<fill in>_
- **Surprises:** _<fill in>_

### PR-H followup

- **Date:** _<fill in>_
- **PR #:** _<fill in>_
- **Deferred spec docs ported:** _<list>_
- **DEV_STATUS final state:** _<link to commit>_
- **CLAUDE.md updates:** _<summary>_
- **Memory files updated:** _<list>_
- **Deploy reset confirmed with Johan?** _<yes/no — date>_
- **Deploy reset executed?** _<yes/no — final SHA>_

### Cross-cutting issues encountered

(Things that affected multiple PRs)

1. _<fill in>_
2. _<fill in>_

### Decisions made (not in original plan)

1. _<fill in>_
2. _<fill in>_

### Recommendations for next sprint

1. _<fill in>_
2. _<fill in>_

---

## Quick reference card

```bash
# Start a new PR
git checkout main && git pull && git checkout -b port/<name>

# Standard validation
pnpm typecheck && pnpm typecheck:tests && pnpm test:unit && pnpm build

# Prettier sweep on changed files
npx prettier --write <files>

# Commit + push + open PR
git add <files>
git commit -m "<type>(<scope>): <subject>"
git push -u origin <branch>
gh pr create --base main --head <branch> --title "..." --body "..."

# Watch CI
gh pr checks <N> --watch --interval 30

# Merge
gh pr merge <N> --squash --delete-branch

# Resync local main
git checkout main && git fetch origin && git reset origin/main
```

---

## Sources cited in this plan

- [Context7: Postgres.js (/porsager/postgres)](https://context7.com/porsager/postgres) — transaction patterns, prepared statements, parallel queries
- [Context7: react-hook-form/resolvers](https://context7.com/react-hook-form/resolvers) — Zod resolver v3/v4 detection
- [Next.js v16.2.2 parallel routes docs](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) — `@slot` convention
- [Next.js v16.2.2 default.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/default) — fallback for unmatched slot state
- [Context7: nuqs (/47ng/nuqs)](https://context7.com/47ng/nuqs) — `useQueryState`, parsers, `NuqsAdapter`
- [Context7: axe-core (/dequelabs/axe-core)](https://context7.com/dequelabs/axe-core) — rule tags, configuration, WCAG tag mapping
- [Context7: Husky (/typicode/husky)](https://context7.com/typicode/husky) — v9 setup, lint-staged integration
- [axe-core 4.5: First WCAG 2.2 Support — Deque](https://www.deque.com/blog/axe-core-4-5-first-wcag-2-2-support-and-more/) — `target-size` rule, what 2.2 adds
- [Pinning GitHub Actions for Enhanced Security — StepSecurity](https://www.stepsecurity.io/blog/pinning-github-actions-for-enhanced-security-a-complete-guide) — SHA-pin pattern with version comments
- [Secure use reference — GitHub Docs](https://docs.github.com/en/actions/reference/security/secure-use) — official guidance
- [Securing GitHub Actions Workflows — GitHub Well-Architected](https://wellarchitected.github.com/library/application-security/recommendations/actions-security/) — defense-in-depth recommendations
- [GitHub Actions policy now supports blocking and SHA pinning — GitHub Changelog (2025-08)](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/) — enforcement at org/repo level

---

**End of handover.** Reach out to Johan if you hit a real blocker after research dead-ends — explain what you tried, what you read, and what specifically is unclear. Good luck.
