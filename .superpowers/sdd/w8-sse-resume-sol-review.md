# Wave 8 Task 8.4 session SSE resumption — Sol-style review

Date: 2026-08-09
Reviewer: Composer (substitute; Sol API rate limit)
Reviewed commits: `b18293c`, `bf237b6`
Prior approved baseline: Wave 8 Tasks 8.1–8.2 (`582f4eb` lineage via session-security review)
Sibling context: Task 8.3 E2E repair `9597caa` (not part of 8.4 scope; addresses `a5e9450` REQUEST_CHANGES)

## Verdict

**APPROVE**

## Summary

Task 8.4 closes the live-SSE gap from Task 8.1: buffered replay via `Last-Event-ID`
was already present, but open GET streams did not receive events appended after
connection. The repair adds per-session subscriber fan-out on `append`, registers
the stream controller after replay, and unregisters on `ReadableStream` cancel.
Integration coverage exercises the real guarded `/api/mcp` route, replay,
resume, and live delivery.

## Verified

### Resumable and live session SSE

- `GET /api/mcp` replays buffered events with `id > Last-Event-ID`, then
  subscribes the stream for subsequent `append` calls.
- `append` enqueues SSE frames to all subscribed controllers; failed enqueue
  removes stale controllers from the set.
- Stream `cancel` invokes the unsubscribe callback — no controller leak on
  client disconnect.
- Integration tests prove: (1) replay after `tools/list` with `Last-Event-ID: 0`,
  (2) resume with `Last-Event-ID: 1` returns 200 on the same session, (3) an
  open stream receives a later `tools/list` within 100 ms (the Task 8.1 RED case).

### Guarded `/api/mcp`

- Route remains under existing `/api/*` JWT middleware (when JWKS configured),
  POST mutation rate limiter, JSON body limit, and exact Origin/Host guards on
  both POST and GET (`services/api/src/routes/mcp-http.ts`).
- RFC 9728 protected-resource metadata unchanged.
- Integration tests hit `createApp` with demo runtime and MCP allowlists; security
  unit tests (JWT, Origin/Host, rate limit) remain green independently.

### 13-tool proposal/read-only boundary

- Integration test asserts exactly 13 tools and presence of
  `submit_enrichment_proposal`.
- No tool name matches `/approve|confirm|post/`.
- `createMcpHttpToolHandlers` still delegates only through the authenticated
  API client; proposal tools stop at open-review intent or
  `pending_confirmation`. No ledger-store import or direct mutation path was
  added.

### Human approval gates

- Unchanged from approved Wave 7/8.1–8.2 posture: MCP cannot approve reviews,
  confirm work items, or post vouchers. SSE delivery is transport-only and does
  not widen mutation authority.

### Bounded sessions

- Task 8.1 capacity repair intact: TTL refresh on access, proactive expiry sweep,
  hard `maxSessions` default 1,000 with deterministic next-expiring eviction, and
  100-event per-session ring. Task 8.4 does not relax these bounds.

## Verification (reviewer rerun)

- Focused MCP HTTP integration + adapter + security tests: **18/18 pass**
- Reviewed range `b18293c^..bf237b6`: `git diff --check` clean

## Dependency note (Task 8.3 — do not block 8.4)

Sol's `a5e9450` review on Task 8.3 correctly flagged stale functional E2E
expecting legacy `POST /mcp` → 200. That defect is in `tests/e2e/api.spec.ts`,
not in the SSE adapter. Sibling commit `9597caa` replaces the stale assertion
with legacy 404 plus guarded `/api/mcp` initialize coverage. Task 8.4 SSE code
is sound independent of that E2E repair; Wave 8.3 approval still requires the
E2E fix to land and pass the functional gate.

## Non-blocking notes (confidence < 80)

- The resume test asserts HTTP 200 and session header but does not read the
  resumed body to prove zero replay frames when `Last-Event-ID` equals the last
  delivered id. Behavior appears correct from adapter logic; stronger assertion
  would tighten regression coverage.
- Sessions evicted from the map while an SSE stream remains open leave the
  in-memory `Session` object reachable via stream references until the client
  cancels. POST on the evicted id correctly returns 404; this is an edge-case
  retention quirk, not a mutation or auth bypass.

## Scope

Task 8.5, PR creation, and `main` remain deferred. Wave 8 is NOT COMPLETE.
