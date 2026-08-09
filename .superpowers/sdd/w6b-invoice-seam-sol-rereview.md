# Wave 6b Sol re-review — atomic invoice approval seam

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed: `6796c1b`, `88d687b`, Opus review `b9372df`, and prior Sol review
`16c47c5`, restricted to the Wave 6b invoice vertical.

Verdict: **REQUEST_CHANGES**

`NEEDS_OPUS_REVIEW`: **YES** — the remaining blocker is a new high-risk
approval-intent identity race. The Wave 5 pre-post seam remains the approved
design; no alternative seam is requested.

## Critical

### [95] Approval does not identify the intent the reviewer saw

Locations:

- `packages/contracts/src/index.ts:535-544`
- `apps/web/components/today/review-edit-sheet.tsx:97-113`
- `services/api/src/app.ts:346-360`
- `packages/domain/src/store.ts:891-912`
- `packages/persistence-postgres/src/store.ts:1725-1764`

The serial fix correctly makes omitted/plain approvals clear stale intent, but
the explicit path sends only `enrichmentIntent: "consume"`. That flag carries no
intent id, version, hash, or `updatedAt`. The stores therefore consume whichever
row is current when the approval transaction reads it.

A practical race remains:

1. Reviewer A attaches and sees invoice proposal A.
2. Reviewer B, an advisor/MCP producer, or another tab upserts proposal B for
   the same open review.
3. Reviewer A sends approval with `"consume"`.
4. The serialized transaction posts the voucher and permanently appends B,
   which A never saw.

The advisory lock serializes writes but does not bind the approval to the
specific intent A presented. A public client may also send `"consume"` directly
against any pre-existing intent. This violates the core human-approval
invariant on an append-only ledger.

Fix by binding approval to the exact attached intent. For example, return an
opaque intent version/id from attach, require that value on consume, and compare
it inside the same locked approval transaction before planning. A mismatch must
fail closed (typed 409 is appropriate), leave the review open, and append zero
events. Add Memory/Postgres conformance for A-attach → B-replace → A-approve,
plus an API test proving a missing/forged/stale consume token cannot append the
replacement proposal.

## Re-verified Opus gate conditions

1. **Fields and approved seam:** fixed. Invoice fields become an
   `invoice_registration` proposal and flow through the Wave 5 pre-post planner;
   no standalone `registerInvoice()` call was introduced.
2. **Listed stale-intent paths:** fixed for workflow-none, close, and omitted
   queue/dashboard/API/advisor approvals. The identity race above keeps this
   condition incomplete.
3. **Öre-exact amount:** fixed with shared `round2`; the 100.10 regression case
   asserts exact `originalAmount`.
4. **Typed refusals:** fixed. Amount-less and invoice-specific missing-line
   failures map to distinct 422 codes; inventory no longer reports a project
   assignment code.
5. **Bounded singleton proposals:** fixed. Intent arrays are capped at 10 and
   invoice registration is at-most-one per intent.
6. **Atomicity/parity and gates:** existing conformance proves rollback,
   one posting, one registration, one line enrichment, replay safety, and
   Memory/Postgres parity. Reported gates are `pnpm check`, strict
   `pnpm db:test` 110/110, invoice E2E 12/12, and visual 20/20. This re-review
   independently passed 42/42 focused invoice contract/planner/API tests and
   `git diff --check`.
7. **Deferrals:** intent-author metadata and true 1510/2440 AR/AP posting are
   explicitly documented with reasons.

## Gate status

Wave 6b is **NOT COMPLETE**. The seven original repair areas are substantially
closed, but the unversioned consume assertion leaves a high-risk concurrent
approval gap. No PR was opened, `main` was not touched, and no Wave 6e work was
performed.
