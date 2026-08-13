# Wave 8 final gate — Sol-style review

Date: 2026-08-09
Reviewer: Composer (substitute; Sol API rate limit)
Gate commit: `cda9ca4`
Prior approvals: Tasks 8.1–8.2 `582f4eb` lineage, 8.3 E2E `9597caa` / docs `40ebca5`, 8.4 SSE `b18293c` / docs `07cd84f`

## Verdict

**APPROVE — WAVE 8 COMPLETE**

Task 8.5 satisfies the plan's substantive completion gates. The plan's Step 5 PR
(`wave-8/mcp-streamable-http` → `main`) is intentionally deferred by the explicit
program instruction not to open a PR or touch `main`; neither item blocks
technical completion.

## Findings

No high-confidence findings.

## Verified evidence

### Task 8.5 plan gates

| Plan step | Requirement                                                                                                                                             | Status                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1         | `docs/MCP_SETUP.md` + `docs/REPO_MAP.md` document POST+GET `/api/mcp`, session headers, Origin/Host guards, RFC 9728 metadata, explicit no DELETE in v1 | Verified                                                                                 |
| 2         | `pnpm check` + `pnpm db:test`                                                                                                                           | Verified independently — both PASS                                                       |
| 3         | Focused MCP adapter + security unit tests                                                                                                               | Verified — 29/29 PASS (includes Wave 7 stdio inventory/handlers/registration regression) |
| 4         | Security checklist (JWT, Origin, Host, rate limit, 13-tool boundary, demo `/mcp` retired, human gates unchanged)                                        | Verified via gate report + focused tests                                                 |
| 5         | PR to `main`                                                                                                                                            | Deferred per program instruction                                                         |

### Independent reviewer rerun (Composer)

- Fresh `pnpm check` passed (lint, i18n, formatting, all workspace typechecks,
  unit suite, web/API builds).
- Fresh strict `pnpm db:test` applied migrations `0001`–`0012`, passed every
  capability assertion, and passed 121/121 integration tests (includes MCP HTTP
  SSE resume and live delivery).
- Fresh focused MCP tests passed 29/29 across
  `mcp-http-adapter`, `mcp-http-security`, `mcp-http` integration, and Wave 7
  stdio inventory/handlers/registration regression.
- Fresh `api-runtime.test.ts` passed 23/23 — legacy `POST /mcp` returns 404;
  guarded `POST /api/mcp` initialize returns 200.
- Fresh `pnpm check:seams` passed; `git diff --check` clean on reviewed tip.

### Prior task closure

- Task 8.1 bounded session store (TTL sweep, hard capacity, 100-event ring) —
  approved.
- Task 8.2 Origin/Host guards, JWT inheritance, POST rate limit, RFC 9728
  metadata — approved.
- Task 8.3 legacy demo `POST /mcp` retirement + E2E repair — approved at
  `9597caa`.
- Task 8.4 live SSE fan-out after `Last-Event-ID` replay — approved at
  `b18293c`.

### Security and invariants (Wave 8 scope)

- HTTP exposes exactly 13 proposal/read tools; no approve, confirm, post,
  direct-tag, or direct-reference tool names.
- MCP handlers delegate only through the authenticated API client; human review
  and enrichment confirmation gates are unchanged.
- v1 omits DELETE; sessions expire by TTL and bounded store capacity only.
- Demo `POST /mcp` is retired (404).

## Scope

E2E and visual gates were not required by Task 8.5 (API/MCP transport and docs
only; no web UI change). Task 8.3 already cleared guarded MCP E2E at `9597caa`.
No visual baseline was updated or reviewed in this gate.

## Program handoff

All 80 numbered tasks in
`docs/superpowers/plans/2026-08-09-ledger-overview-enrichments-mcp.md` (Waves
0–8) are now technically complete on `feat/ledger-overview-enrichments-mcp`.
The plan's deferred Step 5 PR (`wave-8/mcp-streamable-http` → `main`) is the
expected next program action when merge is authorized — not performed in this
review task. No PR was opened and `main` was not touched.
