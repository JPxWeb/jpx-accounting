# Wave 6c Sol review

**Date:** 2026-08-09  
**Scope:** `31f836b`, `6f5294b`, `778afa7` atop `dcc8a60`  
**Verdict:** APPROVE_WITH_FIXES

## Finding fixed

### P2 — Trip totals depended on an out-of-contract amount

`buildTripsList` read `payload.expenseAmount`, but the locked trip payload is
`{ tripId, purpose, traveler, startDate, endDate, evidenceId?, distanceKm? }`.
Any producer validating through `tripLineEnrichmentPayloadSchema` strips that extra
field, so real trip enrichments would project an expense total of zero.

The projection now validates the typed trip payload and resolves the expense from the
canonical posted ledger line identified by the enrichment wrapper's stable `lineId`.
It uses the Wave 5/Opus-approved journal identity path for both `ln_` and legacy line
ids, applies active supersession replay, and replaces projection rows immutably.
Regression coverage proves a superseded assignment moves one bound line amount between
trips without double counting.

## Confirmed

- `TripRegistered` / `TripClosed` are append-only events; first registration remains
  authoritative and close replay does not rewrite registration payloads.
- Ordered dates and optional evidence/distance validation match the locked design.
- Unknown `actorId` input is stripped; attribution remains on the server-owned event
  envelope.
- Trip proposals use the existing `line_enrichment_record` work-item/review path and
  do not introduce a direct AI/MCP mutation path.
- Generic list kind `trip` matches the Wave 5 list framework.

## Verification

- Focused trip contracts/projections: PASS, 9/9.
- Contracts, domain, and tests typechecks: PASS.
- Focused ESLint, Prettier, IDE diagnostics, and `git diff --check`: PASS.

## Clearance

No `NEEDS_OPUS_REVIEW` escalation is required. Wave 6c store/API work may proceed
after the review-fix commit. Its producer must bind trip enrichment to a real posted
cost-line `lineId`; it must not add a client-authored amount or actor field. This review
did not start store/API or UI work.
