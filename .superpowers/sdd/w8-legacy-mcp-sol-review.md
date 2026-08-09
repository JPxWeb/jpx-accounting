# Wave 8 Task 8.3 legacy MCP retirement — Sol review

Date: 2026-08-09
Reviewer: Sol (GPT-5.6)
Reviewed commits: `85045e2`, `ab31c59`
Prior approved baseline: `582f4eb`

## Verdict

**REQUEST_CHANGES**

## Important finding

### [P1, confidence 100] Update the functional E2E assertion for the retired route

`tests/e2e/api.spec.ts:43-49`

The functional API E2E test still posts to legacy `/mcp` and requires the
deleted demo response to be successful. After `85045e2`, that request correctly
returns 404, so the required functional E2E gate will fail deterministically.
Replace this stale assertion with the retirement expectation and, if this test
continues to cover MCP availability, initialize guarded `/api/mcp` using its
required Origin, Host, Accept, and JSON-RPC request shape.

## Verified

- No application route registers `/mcp`; the legacy unguarded demo-only POST
  handler is gone.
- `/api/mcp` remains registered under the existing `/api/*` middleware stack:
  JWT verification when configured, the subject/IP-keyed POST mutation limiter,
  the JSON body limit, and exact Origin/Host guards.
- HTTP and stdio remain pinned to the same fixed 13-tool inventory.
- No approve, confirm, post, or direct-ledger mutation tool is exposed.
  Evidence capture/extraction and proposal tools still terminate before human
  approval or confirmation.
- Fresh focused API/MCP tests pass 50/50.
- Reviewed diffs pass `git diff --check`.

Task 8.4 sibling work may continue in disjoint files. Task 8.3 is not approved
until the stale functional E2E expectation is repaired and the focused
functional E2E test passes.
