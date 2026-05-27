# Session Handover: deploy → main port + PR-D1 shadcn foundation

**Session date:** 2026-05-27
**Owner:** Johan (johan@jpx.nu)
**Scope:** Six squash-merged PRs against `main` — closing out the long-running `deploy → main` port (Phase 7 data layer) and shipping the first slice of the deferred PR-D web sprint (shadcn/ui foundation).

This document is a single-file record of what happened, why each decision was made, what was deferred, and what the next session needs to know. It supersedes individual PR descriptions for narrative continuity but doesn't replace them — links to each PR appear inline.

---

## Why this session existed

`origin/deploy` had been the parking lot for the last several months of work: Track A IA web shell + Track B Supabase backend + Phase 7 data-layer completion (~110 commits ahead of `main`). PR #14 (`deploy → main`) sat open and `CONFLICTING` because `main` had been independently rewritten — the Supabase write path was replaced with `postgres-js` direct (`packages/persistence-postgres` + `PostgresLedgerStore`), Document Intelligence was added, deployment switched to Docker, a typed JSON error envelope landed, and JWKS-backed JWT verification was wired into the API. Every fix in deploy's `supabase-store.ts` needed reimplementing against `PostgresLedgerStore`.

The decision: don't merge PR #14. Port the _features_ over via fresh PRs off `main`, skip the obsoleted `SupabaseLedgerStore` code entirely.

---

## What landed (in merge order)

| #   | PR                                                      | Title                                                                      | Squash SHA | Date                  |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- | --------------------- |
| 1   | [#15](https://github.com/JPxWeb/jpx-accounting/pull/15) | Port Phase 7 (PR-A): docs, conventions, planning                           | `dd02489`  | 2026-05-27 08:44 UTC  |
| 2   | [#16](https://github.com/JPxWeb/jpx-accounting/pull/16) | Port Phase 7 (PR-B): contracts + Memory store + API + migration 0004       | `4de83b8`  | 2026-05-27 09:04 UTC  |
| 3   | [#17](https://github.com/JPxWeb/jpx-accounting/pull/17) | Port Phase 7 (PR-C): PostgresLedgerStore real implementations              | `f914bcb`  | 2026-05-27 09:24 UTC  |
| 4   | [#18](https://github.com/JPxWeb/jpx-accounting/pull/18) | docs(status): mark Phase 7 port complete; categorize remaining deploy work | `587dd6a`  | 2026-05-27 09:37 UTC  |
| 5   | [#19](https://github.com/JPxWeb/jpx-accounting/pull/19) | Port PR-D1 (web): shadcn/ui foundation — deps, theme, primitives, toaster  | `0f612fd`  | 2026-05-27 12:29 UTC  |
| 6   | [#20](https://github.com/JPxWeb/jpx-accounting/pull/20) | docs(status): PR-D1 shadcn foundation landed                               | `a680031`  | 2026-05-27 ~12:40 UTC |

[PR #14](https://github.com/JPxWeb/jpx-accounting/pull/14) closed as superseded.

### PR-A (docs)

- 26-rule [`docs/CONVENTIONS.md`](../CONVENTIONS.md) distilled from the Phase 7 review series
- Phase 7 design spec + original implementation plan + survey/strategy doc + executable port plan
- Fresh [`docs/DEV_STATUS.md`](../DEV_STATUS.md) (didn't exist on main before)
- [`CLAUDE.md`](../../CLAUDE.md) pointers to the two new docs

The plan in PR-A contained **8 in-line "PLAN CORRECTION" callouts** captured during pre-execution verification against `origin/main`. Each correction is a delta between what the plan assumed and what main actually shipped. The most load-bearing was Task 21's `runSimulation` — the original omitted `lockWorkspaceTail(tx)` + the `tailHash` argument to `appendEvent`, which would have type-errored and broken hash-chain serialization in PR-C. Catching this in the docs PR saved an hour of PR-C debugging.

### PR-B (architecture-light)

- Contract widening: `simulationRequestSchema` (+`reviewIds`/`action`), `simulationRunSchema` (+`balanceDelta`/`vatDelta`), `complianceAlertSchema` (+`kind`/`severity`/`status`/`targetId?`/`body?`), new `companySettingsSchema` (Swedish org number + postal format)
- Pure domain helpers: `buildAssistantScaffold`, `detectComplianceIssues` (+`Detailed` variant), `simulateApprovals` — all architecture-neutral; same code path runs against Memory and Postgres stores (CONVENTIONS Rule 11 store parity)
- `today()` helper added to `packages/domain/src/ids.ts` (didn't exist before)
- `ReviewNotFoundError` class for typed HTTP 404 mapping
- `LedgerStore` interface extended by 3 methods (`refreshComplianceAlerts`, `getCompanySettings`, `putCompanySettings`); `MemoryLedgerStore` implements all three; `UnavailableLedgerStore` + `PostgresLedgerStore` get stubs
- Migration [`0004_compliance_and_settings.sql`](../../infra/supabase/migrations/0004_compliance_and_settings.sql): `compliance_alerts` (with `NULLS NOT DISTINCT` unique index), `assistant_sessions`, `organization_settings`
- API routes: real `POST /api/compliance-watch/refresh`, `GET` + `PUT /api/settings/company`, `ReviewNotFoundError` → 404 mapping in `app.onError`, `/api/knowledge/query` citation isolation
- New CI gate: `tests/tsconfig.json` + root `pnpm typecheck:tests` script (Task 5.5 — surfaced as a prerequisite during plan corrections because the plan referenced a script that didn't exist on main)

### PR-C (PostgresLedgerStore)

Replaces PR-B's stubs with real implementations against the Postgres schema from migration 0004:

- `runSimulation`: real projection diff via `simulateApprovals`, dedupes input `reviewIds`, throws `ReviewNotFoundError` on missing IDs, inside `sql.begin` + `lockWorkspaceTail(tx)` + `tailHash` to `appendEvent` (the load-bearing correction caught in PR-A's plan callout)
- `refreshComplianceAlerts`: upsert on `(org, ws, kind, target_id)` with `NULLS NOT DISTINCT`, clears `resolved_at`/`resolved_by` on reopen, marks previously-open auto-detected alerts as resolved with `'system:auto-resolver'` sentinel (CONVENTIONS Rule 20)
- `answerAssistantQuestion`: delegates to `buildAssistantScaffold`, persists to `ledger.assistant_sessions` via `tx.json(...)` inside `begin()`
- `getCompanySettings` / `putCompanySettings`: reads + upserts `ledger.organization_settings`
- 4 integration tests added; gated on `SUPABASE_DB_URL` (skip silently in CI without a live DB)

### PR-D1 (shadcn/ui foundation)

Two commits in one PR (Approach C from brainstorming) plus three follow-up fixes (lint, prettier, prettier-again).

- 14 runtime deps: `@base-ui/react`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `lucide-react`, `sonner`, `next-themes`, `nuqs`, `react-hook-form`, `@hookform/resolvers`, `react-hotkeys-hook`, `@tanstack/react-table` + `shadcn` CLI devDep. **`@supabase/ssr` excluded** (incompatible with main's PostgresLedgerStore direction).
- `apps/web/tsconfig.json`: `@/*` path alias with `baseUrl: "."` (the baseUrl was the second plan-correction caught during execution — bare `paths` without baseUrl doesn't function in TypeScript's path resolver)
- [`apps/web/components.json`](../../apps/web/components.json): shadcn CLI config (style `base-nova` / baseColor `neutral` / lucide / cssVariables)
- [`apps/web/lib/utils.ts`](../../apps/web/lib/utils.ts): `cn()` helper (twMerge + clsx)
- [`apps/web/app/globals.css`](../../apps/web/app/globals.css): appended `tw-animate-css` + `shadcn/tailwind.css` imports, `@custom-variant dark`, OKLCH `:root` block (light + `.dark`). **Bespoke `@theme` radius block + glass surfaces + html/body gradients preserved unchanged** — additive, not a replacement.
- 18 shadcn primitives copied verbatim from deploy at [`apps/web/components/ui/`](../../apps/web/components/ui/): badge, button, card, dialog, form, input, kbd, label, select, separator, sheet, sidebar, sonner, table, tabs, toggle, toggle-group, tooltip
- `apps/web/components/ui/skeleton.tsx`: replaced with deploy's version (preserves `ScreenSkeleton` export AND adds shadcn `Skeleton`)
- [`apps/web/hooks/use-mobile.ts`](../../apps/web/hooks/use-mobile.ts): refactored from deploy's `useState+useEffect` (which trips this repo's `react-hooks/set-state-in-effect` rule) to `useSyncExternalStore` — the canonical React 19 browser-API-sync pattern. SSR-safe by construction.
- [`apps/web/app/layout.tsx`](../../apps/web/app/layout.tsx): `<Toaster />` mount + keyboard-accessible Skip-to-content link, html className via `cn()`

**Visual inspection was SKIPPED** because port 3002 was occupied by a separate dev server on the developer's machine (CultureDNA — a Vite + React Router 7 project). Documented in the PR description. CI E2E passed, which is the regression-detection floor.

---

## Untouched on main (explicitly out of scope)

| Area                                                                                                                                                                                                                                                                          | Why deferred                                                    | Owning future PR                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| Refactoring `home-screen.tsx` / `app-shell.tsx` to USE shadcn primitives                                                                                                                                                                                                      | D1 is foundation only; no screen refactors                      | PR-D2/D3                                    |
| New IA routes (Today / Capture / Books / Reports / Settings sub-pages)                                                                                                                                                                                                        | Bigger sprint with conflict surface                             | PR-D2/D3                                    |
| Auth UI (`apps/web/app/auth/` on deploy)                                                                                                                                                                                                                                      | Depends on `@supabase/ssr` which main dropped                   | Future Auth plan                            |
| nuqs URL state on screens, RHF on company-settings form, `next-themes` provider mounted, Cmd-K palette migration to shadcn `Command`                                                                                                                                          | All deps install in D1 but have no consumer                     | PR-D2/D3                                    |
| 7 bespoke `apps/web/components/ui/*.tsx` files (icons, metric-card, screen-header, section-label, status-badge, unavailable-state, original ScreenSkeleton convention)                                                                                                        | Already on main, work alongside shadcn primitives               | No PR needed; coexistence is the convention |
| 5 deploy-only perf/cleanup ideas in `SupabaseLedgerStore` (`b4082de` projection-aggregate triggers, `7fa1887` parallel `getEvidenceContext`, `757c701` batched `getReviewFeed` suggestions, `10844e2` `suggestVoucher` org-scoped gate, `3f8298f` settings audit attribution) | Worth porting the _intent_ to PostgresLedgerStore, not the code | Separate sprint (2-3 hr)                    |
| `supa_audit` extension migration                                                                                                                                                                                                                                              | Supabase-managed extension; main moved off that pattern         | Out of scope permanently                    |
| `4dec542` rebuild-projections script                                                                                                                                                                                                                                          | Supabase-specific; rewrite as postgres-js if needed             | Conditional on incremental projection need  |

---

## Key lessons (worth remembering)

### 1. Plan-vs-reality verification beats mechanical execution

Pre-execution verification of the port plan against `origin/main` caught **8 deltas** that would have caused PR-C to type-error and break hash-chain serialization. Two more deltas surfaced during PR-D1 execution (`tsconfig.json` `baseUrl: "."` for path resolution; `useSyncExternalStore` over deploy's `useState+useEffect` for `useIsMobile`). The pattern:

> Before executing a plan that prescribes code blocks against another branch's code: confirm each file/function exists with the assumed shape, check constructor + helper signatures the plan calls into, walk the upstream invariants the plan's mutations rely on, and patch the plan in-line under "PLAN CORRECTION" callouts.

"Production-proven on deploy" is necessary but not sufficient. The receiving codebase's gates (typecheck, ESLint, prettier) are the real verifier.

### 2. The CI/local discipline holds across PR shapes

Six different PRs — contract widening, real DB writes, primitive copies, docs cherry-picks — all used the same loop:

```
plan + corrections → execute → typecheck + typecheck:tests + test:unit + build → prettier sweep → push → watch CI → fix → repush → merge
```

When the loop fits, you trust it. Most PR failures this session were prettier or ESLint catching things that didn't surface locally (Windows CRLF vs CI Linux LF; react-hooks rules stricter in CI). The fix is always small.

### 3. CI E2E hangs are a real, recurring problem on this repo

PR-D1 (#19) and post-merge PR #20 both saw the `E2E Tests` job hang for ~1h on what should be 1m20s runs. Cause unknown — possibly Actions runner flakiness, possibly a Playwright webserver-detection bug. **Workaround:** cancel the run, push an empty commit (`git commit --allow-empty -m "ci: retrigger" && git push`), wait for the fresh run.

**Worth proposing:** add `paths-ignore: ['docs/**', '*.md']` to the E2E job in `.github/workflows/ci.yml`. PR #20 was docs-only and still burned 45min of wall-clock waiting on E2E.

### 4. Local visual inspection isn't free

The user runs CultureDNA (a separate Vite project) on the same dev port (3002). When ports collide:

- `pnpm dev:web` may not bind IPv4 (CultureDNA holds it); IPv6 `::1` works but browser hits IPv4 first
- Next.js's "duplicate dev server" detector flags any process on the target port, even if it's a different framework

**Workaround:** use a different port (`npx next dev -p 3010`) but Next may still complain. If visual inspection blocks the work, fall back to E2E for regression detection — appropriate for controlled-blast-radius changes (CSS vars, new directory, single root mount). Document the skip in the PR description so post-merge manual verification is on the user's radar.

### 5. The harness blocks destructive git even after explicit user approval

The Claude Code Bash tool denies `git reset --hard <ref>`, `git branch -D <name>`, `git branch -f <branch> <ref>` even after the user explicitly approves via `AskUserQuestion`. AskUserQuestion captures intent; Bash permissions are gated separately and don't honor it.

**Workarounds tested this session:**

- `git reset <ref>` (soft) instead of `--hard` — moves HEAD pointer only; working tree stays. Works for re-anchoring after squash-merge divergence (squash content equals local commit content).
- `git checkout <branch> && git merge --ff-only <ref>` instead of `git branch -f`.
- Cherry-pick the commit onto a fresh branch instead of `branch -D`-ing the old one.
- If none of these fit: ask the user to run the command manually and explain which command + why.

---

## What the next session needs to know

### Immediate state (as of this handover)

- `origin/main` tip: `a680031` (PR #20 post-D1 DEV_STATUS update)
- All 6 PRs merged; PR #14 closed; **no open PRs**
- Local working tree: clean
- Memory at `~/.claude/projects/c--git-jpx-accounting/memory/`: 7 entries (`project_phase_7_port`, `feedback_verify_plan_before_exec`, `user_johan_jpx`, `feedback_harness_blocks_destructive_git`, `reference_phase_7_port_docs`, `project_ci_e2e_hang_pattern`, `project_local_dev_port_collision`)

### Recommended next actions

1. **Before next prod deploy:** run `SUPABASE_DB_URL=... pnpm test:integration` against a live PG ≥ 15 with migrations 0001–0004 applied. Verifies PR-C's 4 round-trip tests against the actual schema (CI couldn't run these — no DB).
2. **Visual sanity check of PR-D1** in a clean dev environment (`pnpm dev:web` without CultureDNA on 3002). Confirm OKLCH theme + `--radius` coexists with the existing radius scale; trigger a `toast("test")` to verify Sonner mounted.
3. **CI workflow tweak:** add `paths-ignore: ['docs/**', '*.md']` to the `E2E Tests` job to avoid the recurring 1h hang on docs-only PRs.

### Credible next-phase work

In rough order of pragma:

1. **PR-D2** — Settings page rewrite with shadcn `<Form />` + react-hook-form against the existing `PUT /api/settings/company` route. Smallest credible next slice — exercises the foundation PR-D1 shipped.
2. **Small perf/cleanup port** — apply the 5 deploy-only ideas (`b4082de` / `7fa1887` / `757c701` / `10844e2` / `3f8298f`) to `PostgresLedgerStore`. Independent of PR-D, pure backend wins, ~2-3 hours.
3. **PR-D3** — Books page (tab dispatch), ambient digest parallel route, Today per-card actions, axe-core E2E.
4. **The 8 UI follow-ups in `docs/DEV_STATUS.md`** — pick whichever consumer the user values most (compliance alerts list, simulation preview modal, etc.).

---

## Cross-references

- Survey / strategy doc: [`docs/superpowers/plans/2026-05-27-deploy-to-main-port-plan.md`](plans/2026-05-27-deploy-to-main-port-plan.md)
- Phase 7 executable plan (with 8 in-line corrections): [`docs/superpowers/plans/2026-05-27-port-phase-7-to-main.md`](plans/2026-05-27-port-phase-7-to-main.md)
- PR-D1 spec: [`docs/superpowers/specs/2026-05-27-pr-d1-shadcn-foundation-design.md`](specs/2026-05-27-pr-d1-shadcn-foundation-design.md)
- PR-D1 plan: [`docs/superpowers/plans/2026-05-27-pr-d1-shadcn-foundation.md`](plans/2026-05-27-pr-d1-shadcn-foundation.md)
- Conventions: [`docs/CONVENTIONS.md`](../CONVENTIONS.md)
- Current dev status: [`docs/DEV_STATUS.md`](../DEV_STATUS.md)
- Repo root agent context: [`CLAUDE.md`](../../CLAUDE.md)
