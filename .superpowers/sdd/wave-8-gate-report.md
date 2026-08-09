# Wave 8 final gate report

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Prior Task approvals: 8.1–8.2 `582f4eb` lineage, 8.3 E2E `9597caa` / docs `40ebca5`, 8.4 SSE `b18293c` / docs `07cd84f`
Verdict: **READY FOR COMPLETE REVIEW** (implementer gate only — not self-declared COMPLETE)

## Gate results

- `pnpm check`: **PASS**
  - 711/711 unit tests passed.
  - Lint, i18n 1115/1115, formatting, all 12 workspace typechecks, aggregate
    test typecheck, web build, and API build passed.
- `pnpm db:test`: **PASS**
  - Applied migrations `0001`–`0012` to disposable PostgreSQL 17.
  - All capability assertions and 121/121 integration tests passed, including
    MCP HTTP SSE resume and live delivery (`tests/integration/mcp-http.test.ts`).
- Focused MCP tests: **PASS**, 29/29
  - `tests/unit/mcp-http-adapter.test.ts` — session TTL/capacity, ordered
    buffering, v1 no DELETE, 13-tool inventory parity with stdio.
  - `tests/unit/mcp-http-security.test.ts` — Origin/Host guards, JWT when JWKS
    configured, mutation rate limit, RFC 9728 metadata, unchanged `/ready`.
  - `tests/integration/mcp-http.test.ts` — guarded route SSE replay + live fan-out.
  - Wave 7 stdio inventory/handlers/registration regression: 11/11 within the
    same run (total 29).
- `tests/unit/api-runtime.test.ts`: **PASS**, 23/23
  - Legacy `POST /mcp` removed (404); guarded `POST /api/mcp` initialize 200.
- `pnpm check:seams`: **PASS**
- `git diff --check`: **PASS**

First `pnpm check` stopped on Prettier for `docs/MCP_SETUP.md`, `docs/REPO_MAP.md`,
and one Git-ignored Sol review artifact; formatting those files removed the
blocker with no tracked EOL churn beyond the Task 8.5 documentation edits.

## Task 8.5 documentation

- `docs/MCP_SETUP.md` — Streamable HTTP section documents POST+GET `/api/mcp`,
  `Mcp-Session-Id`, optional `Last-Event-ID`, Origin/Host guards, RFC 9728
  `/.well-known/oauth-protected-resource`, JWT inheritance, and explicit **no
  DELETE in v1**.
- `docs/REPO_MAP.md` — route inventory, handler location, package export blurb,
  and MCP tool inventory updated for Wave 8 HTTP; demo `POST /mcp` marked retired.

## Security checklist (Wave 8 PR scope)

| Control                                                     | Status                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| JWT on `/api/mcp` when JWKS configured                      | Verified — 401 without bearer                        |
| Origin allowlist on POST and GET                            | Verified — `mcp_origin_forbidden`                    |
| Host allowlist (DNS rebinding)                              | Verified — `mcp_host_forbidden`                      |
| POST mutation rate limit inherited                          | Verified — 429 at 61st POST                          |
| RFC 9728 protected-resource metadata                        | Verified — header bearer only                        |
| Exactly 13 proposal/read tools                              | Verified — inventory + forbidden-name tests          |
| No approve / confirm / post / direct-tag / direct-ref tools | Verified                                             |
| Demo `POST /mcp` retired                                    | Verified — 404 in unit + E2E (`9597caa`)             |
| Human approval / confirmation gates unchanged               | Verified — handlers delegate through API client only |
| v1 omits DELETE session route                               | Verified — TTL + capacity eviction only              |

## Scope and residuals

- E2E and visual gates were **not required** by Task 8.5 (API/MCP transport
  only; no web UI change). Task 8.3 already cleared guarded MCP E2E at
  `9597caa`. No visual baseline was updated or reviewed in this gate.
- Plan Step 5 (PR `wave-8/mcp-streamable-http` → `main`) is **intentionally
  deferred** per program instruction — stop after gates for COMPLETE review.
- No PR was opened and `main` was not touched.

## Clearance

Task 8.5 has fresh centralized gate evidence on top of approved Tasks 8.1–8.4.
Wave 8 awaits a separate COMPLETE review decision; the implementer does not
self-declare COMPLETE.
