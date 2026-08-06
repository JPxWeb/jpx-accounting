# Docs authority index

**Last updated:** 2026-08-06 (Wave F′ docs truth + archive policy)

Start here when you need to know **which document wins**. Do not treat landed plans under `docs/archive/` as active backlogs.

## Authority ladder (read order)

| Priority | Doc | Owns |
| -------- | --- | ---- |
| 1 | [`AGENTS.md`](../AGENTS.md) (repo root) | Cross-tool agent contract + absolute invariants. **Wins on conflict.** |
| 2 | [`CLAUDE.md`](../CLAUDE.md) (repo root) | Deep how-to memory (commands, architecture seams, env). |
| 3 | [`CONVENTIONS.md`](./CONVENTIONS.md) | 29 incident-derived rules (cited by code as Rule N). |
| 4 | [`DEV_STATUS.md`](./DEV_STATUS.md) | Dated phase ledger + open follow-ups (“current truth” for port status). |
| 5 | [`REPO_MAP.md`](./REPO_MAP.md) | WHERE-IS-WHAT navigation (routes, modules, events, gotchas). |
| 6 | [`architecture.md`](./architecture.md) | Runtime shape + persistence diagram. |
| 7 | [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Human env matrix, trust boundaries, build/deploy subtleties. |
| 8 | [`findings.md`](./findings.md) | Dated research log — do not re-research settled facts. |
| 9 | [`superpowers/`](./superpowers/) | **Active** plans/specs/handovers only. |
| 10 | [`archive/`](./archive/) | Landed/superseded plans & reports (STATUS banners; **no deletes**). |

## Active vs archive

- **Active plans** live in [`superpowers/plans/`](./superpowers/plans/):
  - [`2026-08-06-repo-health-consolidation-plan.md`](./superpowers/plans/2026-08-06-repo-health-consolidation-plan.md) — Waves D–G backlog (A–C COMPLETE)
  - [`2026-07-18-full-sweep-next-steps-plan.md`](./superpowers/plans/2026-07-18-full-sweep-next-steps-plan.md) — strategy baseline
  - [`2026-07-19-opportunity-backlog.md`](./superpowers/plans/2026-07-19-opportunity-backlog.md) — product bets
- **Landed execution plans** (advisory pivot, Track A, Wave B/C, port sweeps, etc.) live under [`archive/superpowers/plans/`](./archive/superpowers/plans/) with a `STATUS: ARCHIVED (landed)` or `STATUS: COMPLETE` banner.
- **Design specs** remain in [`superpowers/specs/`](./superpowers/specs/) (not bulk-archived).
- **Handovers** stay in [`superpowers/*.md`](./superpowers/); the Aug-6 repo-health handover carries a post-merge STATUS banner.

## Other useful docs

| Doc | Purpose |
| --- | ------- |
| [`DEPLOY_UNBLOCK.md`](./DEPLOY_UNBLOCK.md) | Azure storage RBAC / `assignStorageRoles` CD gate |
| [`compliance-playbook.md`](./compliance-playbook.md) | Accounting/compliance controls |
| [`AGENT_HARNESS_ADOPTION.md`](./AGENT_HARNESS_ADOPTION.md) | Agent-harness mapping |
| [`knowledge/sv/`](./knowledge/sv/) | Advisor corpus sources (`pnpm build:knowledge`) |
| [`../scripts/integration-db.md`](../scripts/integration-db.md) | Local Postgres / `pnpm db:*` lifecycle |

## Archive policy (Q10 approved)

Moving a plan under `docs/archive/superpowers/` is the approved way to retire landed work:

1. Add a **STATUS** banner (COMPLETE / ARCHIVED) — never silent moves.
2. `git mv` into `docs/archive/superpowers/plans/` (or sibling archive folders).
3. **Never delete** historical plans; update the authority index + `DEV_STATUS` / `REPO_MAP` pointers.
4. Prefer the newest STATUS / brainstorm wording over stale “nothing implemented” handover prose.
