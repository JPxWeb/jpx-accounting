# Repo-Health Plan — Execution Handover (2026-08-06)

> **STATUS (2026-08-06 post-merge):** Waves **0 + A–C are COMPLETE** on `main` (PR #35 `1ef18be`; deploy scope casing PR #37 `3604ba5`). §2 below is **historical** (written pre-execution). Do **not** re-run Wave A–C. For remaining backlog (D–G) and post–Wave C prioritization, prefer [`plans/2026-08-06-repo-health-consolidation-plan.md`](plans/2026-08-06-repo-health-consolidation-plan.md) plus the post–Wave C improvement brainstorm when present. Wave B/C execution plans are archived under [`../archive/superpowers/plans/`](../archive/superpowers/plans/) with COMPLETE banners.

**Audience:** the fresh Claude Code session (or human) that will implement the verified repo-health consolidation plan, and the subagents it dispatches.
**Mission:** execute [`plans/2026-08-06-repo-health-consolidation-plan.md`](plans/2026-08-06-repo-health-consolidation-plan.md) (the **v2 verified edition** — every claim re-verified 2026-08-06) wave by wave — **starting after Wave C** (see consolidation STATUS banner). The §7 first-slice list below is historical.

---

## 1. Read-first list (in order)

1. [`plans/2026-08-06-repo-health-consolidation-plan.md`](plans/2026-08-06-repo-health-consolidation-plan.md) — THE source of truth. Every backlog item is self-sufficient: an executor assigned one item needs only that item's section + the plan's Global constraints.
2. [`../REPO_MAP.md`](../REPO_MAP.md) — the WHERE-IS-WHAT index (route/module/event inventories, journey→files traces, 14 gotchas). Use it to locate code instead of exploring.
3. [`../findings.md`](../findings.md) — 2026-08-06 entry: sourced research facts (corrected pins, ai#13670, Art. 50 dates, patterns). Do not re-research these.
4. [`../CONVENTIONS.md`](../CONVENTIONS.md) — the rule book; code comments cite it by rule number.
5. `CLAUDE.md` / `AGENTS.md` at repo root — commands, invariants, agent contract (AGENTS.md wins on conflict).

## 2. State at handover

> **Superseded by the STATUS banner above.** Historical text retained for provenance:

- **Wave 0 is COMPLETE**: the previously-uncommitted DB-lifecycle working tree (config canonicalization, `scripts/db*.mts`, `compose.db.yml`, strict integration gate, CI job, tests) is committed. Branch from current `feat/db-lifecycle-plan-v2` (or `main` once merged) — the plan's line-number citations were verified against exactly this tree.
- The plan, `docs/REPO_MAP.md`, `docs/findings.md`, and this handover are committed in the follow-up docs commit.
- ~~Nothing from the plan's backlog (P0-1 … P2-20) has been implemented yet.~~ **False as of PR #35** — Waves A–C landed (tenant strip, planners, pins, SIGTERM, etc.). P0-4 share-under-auth and Waves D–G remain open. Three items were _partially_ pre-fixed by Wave 0 and are marked **"ALREADY FIXED — verify only"** in the plan (P1-11: CONTRIBUTING/.env.example/integration-db.md — docs truth pass continues in Wave F′; P1-15: shared-pool half; P2-16: `database-config.test.ts`) — verify, never redo.

## 3. Execution protocol

- **REQUIRED SUB-SKILL:** `superpowers:subagent-driven-development` (fresh subagent per task, review between tasks) or `superpowers:executing-plans` (inline with checkpoints). Also use `superpowers:using-git-worktrees` for isolation and `superpowers:verification-before-completion` before any "done" claim.
- **Disjoint file ownership** per parallel agent; at most ONE agent per batch touches `messages/*.json` (P0-4, P1-1, P1-14, P2-7, P2-13 all add/remove keys — never co-batch them; P0-7 touches no messages).
- Subagents never build/commit; verification is centralized in the orchestrating session.
- Conventional commits. No visual-baseline changes except where an item explicitly expects them (P1-9B) — and then only after reviewing every diff.
- Wave order and the 16 encoded conflict resolutions live in plan §6 — do not re-derive or reorder without re-reading the conflicts they encode (e.g. the `DocumentIntelligenceClient.kind` discriminator is pulled forward from P1-4 into Wave D; P2-18's `/ready` change lands inside P1-4; P2-8 sequences after P0-1).

## 4. First slice (plan §7) — start here

Ship **Wave A + P0-2** as one PR series, in this order:

1. P0-7 — onboarding `t.raw()` + enable `showProgress` (no message-file edits)
2. P0-3 — reject client `system` roles at parse time (delete the opposing `withSystem` pin at `tests/unit/advisor-chat-route.test.ts:448-457`)
3. P0-6 — ingest `DATABASE_URL` alignment
4. P0-1 — server-owned tenant scope (`DEFAULT_TENANT_SCOPE`; includes `KNOWLEDGE_SCOPE`, settings `organizationId`, share-route spreads)
5. P0-2 — remove Postgres `initialLedgerLines()` prepend + update the three named integration pins
6. P1-13 — SIGTERM/SIGINT `closeDatabase` wiring (drive-by in the API agent)
7. P1-21 — ScreenHeader verify-then-guard + console-hygiene E2E (after P0-7)

**Gates (commands verified to exist):** `pnpm check` (includes `check:i18n`; excludes integration), `pnpm db:test` (strict throwaway `jpx_test_*`), `/today` console-hygiene smoke, PR E2E via `gh pr edit <N> --add-label run-e2e` + re-push/re-run.

## 5. Corrections executors MUST NOT miss (these override any older text)

- **Pins:** `next` → exactly **16.2.12**; `hono` → exactly **4.12.34**; `@hono/node-server` → **1.19.17** (never 2.x). The first draft's floors (≥16.2.10 / ≥4.12.31) are insufficient.
- **NEVER delete `apps/web/components/advisor/tool-approval.ts`** — vercel/ai#13670 is open with no released fix through 7.0.55. The `ai` bump itself is fine but gated on a deny-flow test existing first.
- **Article 50: 2026-08-02 is the hard date** for JPX (the 2026-12-02 marking grace only covers systems on market before 2026-08-02).
- **P2-15 is dropped** (Proxy-based `UnavailableLedgerStore` would be harmful); **boot-fail for P1-4 is dropped** (`Unavailable*` + `/ready` is the pattern); **`buildExcerpt` moves to `packages/reporting`, never domain** (P2-11).
- **P1-10's mobile-flake file list was corrected**: onboarding force-clicks + home/books-drilldown/reports/assistant raw clicks — NOT dark-mode (it skips mobile).

## 6. Invariants (from Global constraints — every task inherits them)

Append-only events; review queue is the only path to a posted voucher; store parity Memory↔Postgres (with the annotated P0-2 demo-seed exception); fail-closed normal mode; server-derived actor; Article 50 labeling; grep-gated import seams; en↔sv key parity; Windows `corepack-shims` PATH; don't churn the DB lifecycle beyond the authorized carve-outs listed in the plan.

## 7. Open questions for the owner (not executor decisions)

- Counsel review of the Article 50 provider-role / extraction-is-assistive rationale before any external (sponsor/auditor) use.
- Provisioning `org_id`/`workspace_id` claims into Supabase JWT `app_metadata` (blocks real multi-tenancy; until then `DEFAULT_TENANT_SCOPE` is the single authority).
- Verify `WEBSITES_CONTAINER_STOP_TIME_LIMIT` takes effect on the deployed Linux App Service (P1-13's Bicep pairing).
- P0-4 product choice ratification: fail-closed share-disable under auth (the plan's recommendation) vs building a cookie-session path.
