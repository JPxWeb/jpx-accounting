# Wave 8 Tasks 8.1–8.2 Sol review

Reviewed:

- Task 8.1 repair `0bebe8a` against prior request-changes review `3c091e4`
- Task 8.2 security commits `9283ffb` and `69b8bbb`

## Task 8.1 — APPROVE

No findings.

The abandoned-session retention blocker is resolved. Session creation sweeps
expired entries before insertion and enforces a positive, configurable hard
capacity (default 1,000). If all retained sessions remain live at capacity, the
next-expiring session is evicted before the replacement is inserted. Combined
with the existing 100-event ring per session, retained session memory is
bounded even under initialize-only churn.

The focused capacity regression test passes, and all production callers supply
the new `maxSessions` argument.

## Task 8.2 — APPROVE

No findings.

The implementation matches the Wave 8 threat model and Task 8.2 plan:

- POST and GET require an exact allowed Origin and lower-cased Host allowlist
  match before the adapter runs.
- `/api/mcp` remains under the existing `/api/*` JWT middleware and the
  subject/IP-keyed POST mutation limiter.
- RFC 9728 protected-resource metadata advertises the configured resource,
  authorization servers, and header bearer authentication.
- `/ready` remains the existing ledger/AI/blob/DocIntel readiness probe.
- HTTP lists the same fixed 13 tools as stdio. The surface contains only
  capture/proposal/read operations and exposes no confirm, approve, post, or
  direct-mutation tool.

## Verification

- Focused MCP adapter, security, inventory, and registration tests: 20/20 pass
- `@jpx-accounting/mcp-server` typecheck: pass
- `@jpx-accounting/api` typecheck: pass
- Aggregate tests typecheck: pass
- Reviewed diffs: clean under `git diff --check`

Wave 8 Tasks 8.3+ remain outside this review.
