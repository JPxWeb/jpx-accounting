# Wave 5C Sol review

**Date:** 2026-08-09
**Scope:** Task 5.11 Memory/Postgres conformance for pre-post approval and
post-post line work items
**Verdict:** APPROVE_WITH_FIXES

## Findings and fixes

### P2 — Pre-post conformance did not exercise the typed fail-closed path (fixed)

The original pre-post scenario attached only a `noop` intent. It proved intent
consumption and one posting, but not the Wave 5B guarantee that a
`line_enrichment_record` targeting a line absent from the approval batch fails
before any review, voucher, event, or intent mutation.

The scenario now first attaches a well-formed intent with an unknown stable
line target and requires `EnrichmentLineNotFoundError`. It verifies zero event
delta and that the intent remains available, then replaces the invalid intent
with `noop` and completes the ordinary human approval with exactly one
`PostedToLedger`. Memory and Postgres return the same structural outcome.

### P2 — Line work-item conformance did not pin the human gate or replay (fixed)

The original line-target scenario verified one posting after confirmation, but
did not assert that proposal itself was non-mutating or that a repeated
confirmation could not append another line event.

The scenario now requires a server-issued `ln_` target, a
`pending_confirmation` item, zero proposal event delta, human confirmer
attribution, one correctly targeted `LineEnrichmentRecorded`, and zero event
delta on confirmation replay. The voucher remains posted exactly once.

## Confirmed

- Both scenarios execute independently against `MemoryLedgerStore` and
  `PostgresLedgerStore`, then compare normalized outcomes for parity.
- The pre-post failure preserves append-only state and uses the same typed
  domain error mapped by the API to HTTP 422.
- Stable `lineId` is used throughout; positional `journal_n` identity is not
  accepted or exercised as an enrichment target.
- Neither proposal nor confirmation can bypass the explicit human gate or
  append another `PostedToLedger`.
- Changes are test-only and limited to the existing conformance harness; no
  store, contract, API, UI, migration, or production behavior changed.

## Verification

- Focused conformance: 16 passed, 30 expected Postgres skips.
- Strict `pnpm db:test`: migrations `0001`–`0011`, capability assertions, and
  95/95 integration tests passed.
- IDE diagnostics reported no errors in the changed conformance file.

## Clearance

- Task 5.11: approved after the review-fix commit.
- Task 5.12 initially remained deferred pending the sibling Task 5.9 Sol UI
  review. That clearance landed concurrently in `463ae1f`, so Task 5.12 is now
  unblocked after this Task 5.11 review; the Wave 5 full gate was not run here.
- Wave 6, PR creation, and changes to `main` remain blocked.
