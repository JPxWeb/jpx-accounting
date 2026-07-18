# AGENTS.md — jpx-accounting agent contract

Cross-tool contract per JPx ADR DL-001 — "AGENTS.md is the cross-tool agent contract and wins
on conflict; CLAUDE.md is Claude-specific project memory" (the ADR ledger lives in the private
JPx brain repo, external to this public repo): this file wins on conflict; `CLAUDE.md` is the
deep project memory (Claude Code loads it automatically — other tools should read it too);
`docs/CONVENTIONS.md` holds 29 incident-derived rules; `docs/DEV_STATUS.md` is current truth.

## What this is

AI advisory accounting app for European small businesses — Sweden-first (BAS 2026, moms,
Bokföringslagen), EU AI Act-honest, human-approved postings on an append-only hash-chained
ledger. pnpm monorepo (Node ≥24, pnpm 10.29.2): Next.js 16 web PWA, Hono API, Zod v4
contracts, Postgres/Memory ledger stores, AI SDK 7 advisor, pgvector RAG.

## Absolute invariants — never violate, flag any violation you see

1. **Append-only events are truth.** Never rewrite ledger history or evidence; corrections
   are new events. The hash chain (`previousHash → eventHash`) is per workspace.
2. **AI suggests, never mutates.** The review queue is the ONLY path to a posted voucher.
   The advisor's `proposeReviewAction` executes nothing until an explicit, signed human
   approval, and then only via `applyReviewDecision`.
3. **Store parity.** Any `LedgerStore` behavior change lands in BOTH `MemoryLedgerStore`
   and `PostgresLedgerStore` (shared helpers in `packages/domain`).
4. **Fail closed.** `normal` mode without config = `Unavailable*` implementations, never
   silent demo fallbacks. Demo mode is explicit and labeled.
5. **Article 50 labeling** on every AI surface; honest empty/disabled states over fake depth.
6. **i18n parity**: every `messages/en.json` key exists in `sv.json` (and vice versa).

## Environment (Windows dev box)

- pnpm lives at `%LOCALAPPDATA%\corepack-shims` and is NOT on PATH — prepend in every
  shell: `$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"` (husky hooks need it too).
- Python is absent; use Node for scripting. PowerShell 5.1: no `&&` — use `;`.
- Port 3002 (`pnpm dev:web`) may collide with an unrelated Vite dev server.

## Commands

- `pnpm install` · `pnpm dev` (web 3002 + API 3001) · `pnpm check` (lint + format + typecheck
  ×11 workspaces + unit + build) — the merge gate.
- Unit: `pnpm test:unit` (single file: `tsx --test tests/unit/<file>.test.ts`).
- E2E: `pnpm build:e2e && npx playwright test --grep-invert "visual:"` — NEVER plain
  `pnpm build` for E2E (misses `NEXT_PUBLIC_*` demo/proxy inlining).
- Visual: run `npx playwright test tests/e2e/visual-regression.spec.ts`; on intentional diffs
  REVIEW every diff image, then `--update-snapshots`, then re-run to verify. Never blind-update.
- Corpus: `pnpm build:knowledge` (regenerate + commit together with `docs/knowledge/sv` edits).
- Integration: `pnpm test:integration` (skips without `SUPABASE_DB_URL`).

## Definition of done

`pnpm check` green → functional E2E green → visual verified (diffs reviewed, re-baselined
deliberately) → conventional commit (`feat(scope): …`). CI on PRs runs typecheck+unit+build;
full E2E is opt-in via the `run-e2e` label and mandatory on pushes to `main`. Deploy is
currently blocked on an Azure RBAC grant — see `docs/DEPLOY_UNBLOCK.md`; don't "fix" it blind.

## Architectural seams (grep-gated — keep them tight)

- `@dnd-kit` imports ONLY in `apps/web/components/dashboard/sortable-grid.tsx`.
- `ai` / `@ai-sdk/*` imports ONLY in `apps/web/components/advisor/*` and
  `services/api/src/advisor/*`.
- recharts ONLY via the `components/reports/charts/` lazy barrel — never in the dashboard
  (inline SVG minis there).
- Clock-derived UI (dates, hashes from seeded data) gets `data-visual-mask` so visual
  baselines stay date-stable.
- Exact-pin fast-moving deps (`--save-exact`); verify APIs against installed types in
  `node_modules`, not recall.

## Multi-agent execution (what worked for the 2026-07 pivot)

Parallel subagents get **disjoint file ownership**; at most ONE agent per batch touches
`messages/*.json` (surgical edits only, never wholesale writes); subagents never build,
never commit; verification is centralized (one gate run by the orchestrator); re-baseline
happens once per wave after human-grade diff review. Plans live under `docs/superpowers/`.
