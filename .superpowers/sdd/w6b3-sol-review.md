# Wave 6b Task 6b.3 + Writer Sol Review

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed commits: `ee1d9bf`, `e66a0c1`, `3e29ecc`

Verdict: **APPROVE_WITH_FIXES**

## Findings and fixes

1. **Fixed — API list responses lacked an explicit contract boundary.**
   `/api/lists/open-invoices` and `/api/lists/payment-history` now parse their
   derived rows through the shared list schemas before returning JSON. HTTP and
   offline api-client paths already validated the same schemas.
2. **Confirmed — first payment identity is authoritative.** Memory and Postgres
   return the first `paymentId` allocation without appending a duplicate.
   Projections likewise count only the first allocation.
3. **Confirmed — currency mismatch fails before append.** Both stores validate
   the registered invoice currency after identity lookup and before appending;
   Postgres performs the lookup under the workspace advisory lock.
4. **Confirmed — attribution remains server-owned.** Request schemas strip
   forged actor fields and routes inject `deriveActorId(context)`.
5. **Confirmed — no direct enrichment mutation path was added.** Invoice line
   enrichment remains a `line_enrichment_record` proposal on the existing
   work-item/human-confirmation path; writers do not call
   `applyReviewDecision`.

Memory, Postgres, and Unavailable implementations expose the same writer
surface. The added writers are the minimal production source required for the
new read models; no additional invoice mutation abstraction is needed.

## Verification

- Focused invoice/payment unit and route tests: PASS, 15/15.
- Contracts, domain, Postgres persistence, API, api-client, and tests
  typechecks: PASS.
- Strict `pnpm db:test`: PASS, migrations `0001`–`0011`, 101/101 integration
  tests including Memory/Postgres invoice/payment parity.
- IDE diagnostics and `git diff --check`: PASS.

## Clearance

Tasks 6b.4–6b.6 UI/gate work may proceed after the review-fix commit. No
`NEEDS_OPUS_REVIEW` escalation is required.
