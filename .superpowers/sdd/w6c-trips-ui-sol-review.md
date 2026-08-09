# Wave 6c trips UI Sol review

**Date:** 2026-08-09
**Scope:** `5f94a94`, `dcfe672`
**Verdict:** REQUEST_CHANGES
**NEEDS_OPUS_REVIEW:** YES

## Important finding

### [P1, confidence 100] Pre-post trip fields are discarded

`apps/web/components/today/review-edit-sheet.tsx` requires purpose, traveler,
start date, end date, and optionally packet-bounded evidence when `workflow`
is `trip`. However, the committed `handleSubmit` only creates a
`project_assignment` proposal. None of the trip values enter
`attachReviewEnrichmentIntent()` or `approveReview()`, so submitting the form
posts and closes the review while silently discarding every trip field.

The focused test in `tests/e2e/trips-vertical.spec.ts` does not exercise that
path: it fills the fields, closes the sheet with Escape, approves the review
through an empty API request, then independently registers a trip and creates
a post-post work item. The test correctly covers post-post human confirmation
against a real posted `ln_` target, but it cannot substantiate the claimed
pre-post workflow.

## Atomic-seam decision: YES

Pre-post trip fields require the same contract-first atomic approval seam as
invoices. Trips do not differ in a way that permits these fields to be
client-only validation:

- The approved design requires each Wave 6 vertical to include pre-post review
  fields and freezes pre-post choices with the first `PostedToLedger`.
- Purpose, traveler, dates, and evidence are the authoritative
  `TripRegistered` / trip-enrichment payload, not transient presentation data.
- A client-side `registerTrip()` call after approval would invent `tripId`
  outside the authoritative store seam and split one human decision into two
  writes. Failure between them leaves a posted voucher with no trip; retry
  starts from a closed review.
- Post-only attachment to an existing `lineId` is sufficient only for the
  already-correct post-post work-item path. It does not satisfy Task 6c.4 while
  that task exposes and requires pre-post trip fields.

Required follow-up: add a strict trip pre-post proposal contract that carries
the human-entered fields without client actor or final identity. The
server/store approval path must derive `tripId`, bind the trip enrichment to a
real eligible posted cost-line `lineId`, validate optional evidence against
the voucher packet, and append exactly one `PostedToLedger`,
`TripRegistered`, and the companion line enrichment in the same serialized
Memory/Postgres transaction. Unavailable-store parity and conformance must
cover fail-before-append, attribution, replay, and all-or-nothing behavior.

Because this change crosses generated identity, review-intent contracts,
posting-line binding, and atomic Memory/Postgres event production,
`NEEDS_OPUS_REVIEW` is set before implementation. The Wave 6b seam design
should be generalized where possible rather than creating a second ad hoc
vertical seam.

## Other review results

- The trips list uses the contract-validated API client and preserves the
  authoritative trip row id. Loading, error, empty, open, and closed states are
  honest and localized.
- Optional evidence choices come only from the selected voucher's packet.
- The post-post E2E uses a real posted `lineId`, requires explicit human
  confirmation, and checks the advisor Article 50 marker.
- No client actor or amount is invented by the UI; expense totals remain
  derived from the posted ledger line.
- English and Swedish message keys are paired.
- No code simplification was applied: the required repair is architectural,
  and editing shared contract/store/UI files would conflict with the active
  Wave 6b/6d owners.

## Gate assessment

Task 6c.5 remains deferred. The implementer's focused `build:e2e` and trip E2E
result is recorded as 4/4, but this review did not treat that prior run as a
fresh full gate. `pnpm check`, strict Postgres, complete functional E2E, and
human-reviewed visual comparison must run after the atomic seam and concurrent
Wave 6b/6d shared-file work settle. No visual baseline should be updated
without reviewing every diff.

Wave 6c is **NOT COMPLETE**.

## Verification

- Reviewed both target commits and the exact committed submission/test paths.
- `git diff --check` passed for `5f94a94` and `dcfe672`.
- No implementation code changed during this review, so focused E2E and
  database tests were not re-run.
