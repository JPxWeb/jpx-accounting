# Wave 8 Task 8.1 Streamable HTTP adapter — Sol review

Date: 2026-08-09
Reviewer: Sol (GPT-5.6)
Reviewed commits: `0ae028f`, `867318d`
Wave 7 baseline: `ff64519`

## Verdict

**REQUEST_CHANGES**

## Important finding

### [P1, confidence 100] Bound the number of retained sessions

`packages/mcp-server/src/http-adapter.ts:68-90`

The event history is capped at 100 entries per session, but the `sessions` map
has no global capacity and expired entries are deleted only when a caller later
presents that exact session id. Repeated authenticated requests to
`initialize` can therefore create abandoned entries indefinitely; in demo mode
the same memory-exhaustion path is anonymous. TTL does not bound retained
memory without sweeping or capacity eviction.

Add a configured maximum session count and deterministic eviction (or sweep
expired entries before capacity admission), reject or evict when the limit is
reached, and regression-test both abandoned-session expiry and over-capacity
initialization. Keep the 100-event per-session ring.

## Verified

- `/api/mcp` registers POST and GET only; no DELETE route is present.
- Existing `/api/*` middleware covers the route, including JWT verification
  when configured and the mutation rate limiter for POST.
- Per-session operations serialize through one promise chain, and buffered SSE
  events preserve that accepted request order with monotonic ids.
- HTTP lists the same fixed 13 tools as stdio. No approval, confirmation,
  posting, direct-tag, direct-reference, or ledger-store mutation entrypoint was
  added.
- Proposal tools still stop at an open-review intent or
  `pending_confirmation`; actor attribution remains behind the authenticated
  API routes.
- Fresh focused HTTP adapter tests passed 8/8. The implementer's focused MCP
  record is 19/19 and full unit record is 702/702.
- `git diff ff64519..867318d --check` passed.

## Scope and escalation

Tasks 8.2–8.4 remain pending, including the dedicated Origin/Host/security and
live-SSE work. No packaged escalation is requested: the blocker is a localized
session-capacity defect with a direct bounded-store repair, not a session
hijack, authentication bypass, or ledger-mutation path. Task 8.2 sibling work
may continue in disjoint files, but Task 8.1 is not approved until the capacity
repair is reviewed.
