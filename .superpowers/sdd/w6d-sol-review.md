# Wave 6d Sol review

**Date:** 2026-08-09
**Scope:** `60351b0`, `505ca24`, `3161bc3`, reviewed at latest synced
ancestry `1cc5207`
**Verdict:** APPROVE_WITH_FIXES

## Finding fixed

### P2 — SKU movement row identity was not contract-locked

`skuMovementListRowSchema` accepted an `id` different from `movementId`. The
projection currently emits matching values, but an API response or future producer
could pass shared contract validation while presenting a second identity for the same
append-only movement. That weakens first-event authority and repeats the payment-row
identity defect already fixed in Wave 6b.

The row contract now requires `id === movementId`. Regression coverage also pins that
quantity movement payloads reject a client-supplied `actorId`.

## Confirmed

- Quantity inventory remains strict and quantity-only: `unitCost`, `currency`, and
  every other unknown valued field are rejected.
- `InventoryMovementRecorded` replay is pure and append-only. The first event for a
  repeated `movementId` remains authoritative; later duplicates neither add a row nor
  change a balance.
- Running quantities are derived independently per `skuId`, including interleaved
  event streams. No inventory value is inferred.
- `movementId` is the list-row identity and `lineId` remains the stable Wave 5 ledger
  target. The generic dispatcher uses the locked `sku_movement` kind.
- The event payload contains no actor field. Attribution remains on the server-owned
  event envelope, and the strict schema rejects forged client attribution.
- No store, API, UI, valued-inventory schema, feature flag, or Wave 6e behavior was
  added by this review.

## Verification

- Focused quantity contract/projection tests: PASS, 8/8.
- Contracts, domain, and tests typechecks: PASS. The tests typecheck was retried
  after concurrent Wave 6c route/client edits settled.
- Focused ESLint, Prettier, IDE diagnostics, and `git diff --check`: PASS.

## Clearance

No `NEEDS_OPUS_REVIEW` escalation is required. Wave 6d store/API work may proceed
after this review-fix commit. Any movement writer must preserve first-`movementId`
authority, validate the real posted `lineId` through the existing human-confirmed
work-item/review path, derive actor attribution server-side, and append no valued
fields or second `PostedToLedger`.

Wave 6e remains blocked until Wave 6d is complete under the plan. This review did not
start Wave 6d store/API/UI or Wave 6e.
