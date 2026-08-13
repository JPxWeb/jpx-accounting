# Wave 6b Tasks 6b.4–6b.6 Sol Review

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed commits: `c38a565`, `a5d88cb`, `0eea053`

Verdict: **REQUEST_CHANGES**

## Finding

### [P1] Invoice review fields are discarded on approval

`ReviewEditSheet` requires direction, counterparty, and due date, but
`handleSubmit` sends only the ordinary `ReviewDecisionEdit`; its sole optional
enrichment is `project_assignment`. Approval therefore posts the voucher and
closes the review while all three invoice values disappear. It appends neither
an `InvoiceRegistered` event nor an invoice line enrichment, so the approved
invoice cannot appear in the new Books panels.

This is not safely repairable in the UI. Registration requires authoritative
`invoiceId`, `currency`, and `originalAmount`, none of which the new fields
own. Calling `registerInvoice()` after `approveReview()` would also be
non-atomic: a failure between calls leaves a posted voucher without its invoice
registration, and a retry can observe a closed review.

Required follow-up: define a contract-first pre-post invoice intent carrying
the human-entered fields plus server-derived/validated invoice identity,
currency, and amount. Both stores must consume it inside the same serialized
approval transaction that appends exactly one `PostedToLedger`, one
`InvoiceRegistered`, and the line enrichment bound to a real posted `lineId`.
Actor attribution must remain server-derived. Memory/Postgres conformance and
strict `pnpm db:test` must prove all-or-nothing behavior and replay.

## Other review results

- Books panels preserve contract identities and format each row with its own
  currency. Loading, error, and empty states are honest.
- The new controls use native labeled inputs with associated validation
  messages and remain inside the existing focus trap.
- English/Swedish keys are paired.
- No safe code-only patch was applied because guessing invoice identity or
  currency, or chaining a second client mutation, would violate the locked
  accounting boundaries.

## Gate assessment

The reported commands may be green, but the focused review E2E only proves
that filling the three fields enables the button; it never submits or verifies
an `InvoiceRegistered` event, line enrichment, Books row, server attribution,
or atomic failure behavior. Task 6b.6 therefore overstates completion.

Wave 6b is **NOT COMPLETE**. `NEEDS_OPUS_REVIEW` is set for the atomic
approval-to-invoice registration design before implementation.

## Verification

- Reviewed all three target patches and their current call sites.
- `git diff --check` passed for each target commit.
- No UI/store code changed during this review, so focused E2E and
  `pnpm db:test` were not re-run.
