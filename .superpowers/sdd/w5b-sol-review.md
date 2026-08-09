# Wave 5B Sol review

**Date:** 2026-08-09  
**Scope:** Tasks 5.2, 5.3, and 5.10 after Opus identity fixes  
**Verdict:** APPROVE_WITH_FIXES

## Finding and fix

### P2 — Unsupported intents could poison later approval (fixed)

The shared intent contract includes proposal kinds that the current Wave 5
pre-post planner does not consume. Both stores previously persisted those
well-formed proposals, then `applyReviewDecision` threw
`EnrichmentNotSupportedError`; the API catch-all exposed that caller-correctable
state as a 500. A persisted intent could therefore prevent approval until it was
replaced.

One shared domain validator now defines the Wave 5 pre-post subset (`noop` and
`line_enrichment_record`) and is called by the planner plus Memory and Postgres
attach paths. Unsupported proposals fail before persistence with typed HTTP 422
`enrichment_not_supported`. A line target absent from the eventual approval
batch now returns typed HTTP 422 `enrichment_line_not_found` without mutation.
Future verticals can extend this single validator when their high-level
pre-post proposal arms and approval-time binding land.

## Confirmed

- Memory, Postgres, and Unavailable implement attach/get parity. Memory and
  Postgres validate the same open review/voucher state, proposal subset, tenant
  scope, and server-derived actor attribution.
- Approval consumes the intent in the same transaction/batch as exactly one
  `PostedToLedger`; companions append afterward and never call the post-post
  work-item path or create another posting.
- Opus identity rules remain intact: legacy identity is event-local,
  supersession is first-wins, and only `lineId` from the approval batch can be a
  typed line target. Positional `journal_n` ids are never accepted.
- Task 5.10 adds only the specified open-review `POST /api/review-proposals`
  wrapper. The route verifies review/voucher association, delegates the
  race-safe open-state check to the store, strips client attribution through
  the contract, and returns the queue deep link. No user-facing list route or
  Wave 6/MCP wiring was added.
- Migration `0011` keys intents by organization, workspace, and review; all
  Postgres reads, writes, upserts, and deletes carry the tenant scope.

## Verification

- Focused planning/store/API/client/identity suites: 40/40 passed.
- Domain, Postgres persistence, API, and tests typechecks passed.
- Strict `pnpm db:test`: migrations `0001`–`0011`, capability assertions, and
  89/89 integration tests passed.
- Targeted Prettier, IDE diagnostics, and `git diff --check` passed.
- Concurrent Task 5.9 Books UI changes were intentionally excluded from this
  review and commit.

## Clearance

- Tasks 5.2, 5.3, and 5.10: approved after the review-fix commit.
- Wave 5 gate: may proceed only after Tasks 5.9, 5.11, and 5.12 are complete.
- Wave 6 and later waves: still blocked until the full Wave 5 gate passes.
- No PR to `main` is cleared by this review.
