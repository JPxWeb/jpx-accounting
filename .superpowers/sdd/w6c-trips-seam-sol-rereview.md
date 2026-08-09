# Wave 6c trips seam Sol re-review

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed: Opus `REQUEST_CHANGES` in `5b1522f`, the double-count repair
`8d37d74`, implementation `6796c1b`, and gate record `88d687b`.

Verdict: **REQUEST_CHANGES**

`NEEDS_OPUS_REVIEW`: **NO** — the remaining defect is a missed proposal arm in
the already-approved post-post validation design.

## Important finding

### [P1, confidence 98] Trip supersession bypasses registration and one-trip-per-line guards

`planPostPostEnrichmentConfirm` validates a registered `tripId`, same-trip
idempotency, and the one-active-trip-per-line rule only in the
`line_enrichment_record` case (`packages/domain/src/store-planning.ts:971-993`).
The adjacent `line_enrichment_supersede` case accepts any typed replacement
without equivalent trip validation (`packages/domain/src/store-planning.ts:1017-1041`).

This leaves both Opus findings reachable through the public work-item contract:

- Superseding any active enrichment with a `trip` replacement naming an
  unregistered trip confirms and appends the replacement. `buildTripsList`
  silently ignores it because no registry row exists.
- If a line already has active trip A plus another active enrichment, a work
  item can supersede the other enrichment with trip B. Both trip enrichments
  remain active, so the same posted expense is counted once for each trip.

The Postgres loader has the same gap: it derives `proposedTripId` only for
`line_enrichment_record` (`packages/persistence-postgres/src/store.ts:1986-2016`).
Memory supplies all registered trips, but the shared planner never consults
them for a supersede replacement, so both stores exhibit the bypass.

**Required fix:** centralize trip-replacement validation and call it from both
record and supersede arms. For supersession, validate that the replacement
trip is registered and reject a different active trip on the line, excluding
the exact prior enrichment being superseded. Extend Postgres trip-id loading to
trip replacements. Add shared planner and Memory/Postgres conformance tests for
an unregistered replacement, moving trip A to registered trip B, and attempting
to introduce trip B while another active trip remains.

## Opus gate re-verification

- **422 mapping:** PASS for `trip_registration_line_not_found` and
  `trip_evidence_not_in_packet`; focused API tests pin both.
- **Cross-trip double count:** PARTIAL. Direct trip records are refused and
  same-trip replay is idempotent, but supersede replacements bypass the guard.
- **Required `evidenceIds`:** PASS. `planPrePostEnrichment` requires
  `evidenceIds: readonly string[]`; both stores provide it.
- **Explicit intent consumption:** PASS. The review sheet attaches the
  presented proposal and sends `enrichmentIntent: "consume"`; omitted/clear
  requests atomically clear unseen intent.
- **Unregistered trip fail-closed:** PARTIAL. Direct trip records fail closed;
  supersede replacements do not.
- **Wave 5 seam only:** PASS. Approval uses
  `attachReviewEnrichmentIntent` → `planPrePostEnrichment` → merge inside the
  serialized decision transaction. No standalone `registerTrip()` call was
  added to approval.
- **Post-post real-line path:** PASS for the exercised
  `line_enrichment_record` path. It still targets a posted `ln_` line, requires
  explicit confirmation, and appends no `PostedToLedger`. The supersede variant
  needs the fix above.

## Verification

- Focused trip seam unit/API suite: **52/52 PASS**:
  `trips-contracts`, `trips-list`, `pre-post-enrichment-planning`,
  `line-enrichment-planning`, and `api-runtime`.
- `git diff --check 8d37d74..88d687b`: PASS.
- Reviewed Memory and Postgres approval/confirmation transactions, planner
  arms, projection replay, intent callers, and the desktop/mobile trip E2E.
- Implementer-recorded centralized results remain credible: `pnpm check`
  green, strict `pnpm db:test` 110/110, `pnpm build:e2e`, and focused combined
  invoice/trip E2E 12/12.

## Gate status

Wave 6c is **NOT COMPLETE**. The supersede bypass must be fixed and covered by
store parity before the renewed Task 6c.5 gate. The complete functional E2E
suite and human-reviewed visual comparison remain deferred; no baseline should
be updated without reviewing every diff.

No PR was opened, `main` was not touched, and no Wave 6e work was started.
