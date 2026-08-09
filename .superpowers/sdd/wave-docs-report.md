# Wave F′ docs report (F-1 / F-2 / F-3)

**Branch:** `feat/post-wave-c-docs`  
**Worktree:** `.worktrees/feat-post-wave-c-docs`  
**Base:** `origin/main` @ `3604ba5`  
**Date:** 2026-08-06  
**Scope:** docs-only (plus CLAUDE.md Bicep/`DATABASE_URL` note, `.cursor/rules` + copilot 28→29)

## Done

### F-1 — Truth pass

- `docs/DEV_STATUS.md`: Last reviewed 2026-08-06; Waves 0+A–C COMPLETE; `pnpm db:test` / `DATABASE_TEST_URL` integration gate; hosted migrations note; compliance #4 Done; Phase-5 historical SUPABASE mention annotated.
- `docs/CONVENTIONS.md`: present-tense integration gates → `db:test` / `DATABASE_*` (+ legacy alias).
- `docs/architecture.md`: `DATABASE_URL` + migrations via `db-migrations.mts`; `DATABASE_POOL_MODE=transaction`.
- `docs/REPO_MAP.md`: active-vs-archive plan index; gotcha #4 SIGTERM/`closeDatabase` corrected.
- `docs/findings.md`: SIGTERM “wiring missing” corrected in place + Wave F′ entry appended.
- `CLAUDE.md`: Bicep still wires legacy `SUPABASE_DB_URL` secret name (alias for `DATABASE_URL`); archive pointers for Track A / pivot master plan.
- `.cursor/rules/jpx-accounting.mdc` + `.github/copilot-instructions.md`: **28 → 29** rules.

### F-2 — STATUS banners

- Handover: post-merge STATUS; §2 marked historical / struck “nothing implemented”.
- Consolidation plan: A–C COMPLETE, D–G still active.
- Wave B + Wave C execution plans: COMPLETE (then archived).

### F-3 — Authority index + archive

- Created `docs/README.md` authority ladder.
- Created `docs/archive/superpowers/README.md`.
- `git mv` **29** landed plans → `docs/archive/superpowers/plans/` with ARCHIVED/COMPLETE banners (**no deletes**).
- **Kept active** under `docs/superpowers/plans/`: consolidation, full-sweep-next-steps, opportunity-backlog (3 files).
- Note: Wave A had no standalone execution-plan file on `main` (only B/C were checked in).

## Verification (spot-check)

- Grep owned files: no `22 chronological`, no `closeDatabase is never wired`, no `signal wiring is missing`, no `28 rules`, no DEV_STATUS `Last reviewed: 2026-07-19`.
- Code check: `services/api/src/index.ts` calls `registerGracefulShutdown({… closeDatabase})`.
- Plan counts on this tip: 32 before archive → 3 active + 29 archived.

## Not done / out of scope

- No push / no PR.
- F-4…F-10 not in this slice.
- Did not archive `docs/superpowers/specs/` (plans only).
- Post–Wave C brainstorm file lives on the docs/brainstorm branch, not this `main`-based worktree.

## Commits

- `7c64d92` — `docs(status): Wave F' truth pass, STATUS banners, archive landed plans`  
  Local only on `feat/post-wave-c-docs` (not pushed).
