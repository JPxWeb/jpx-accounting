# Wave 6b Tasks 6b.1–6b.2 Sol Review

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed commits: `266e8d4`, `14587d0`, `6d49cd5`

Verdict: **APPROVE_WITH_FIXES**

## Findings and fixes

1. **Fixed — duplicate payment identity changed balances.** Replaying two
   `PaymentAllocated` events with the same `paymentId` previously subtracted
   both amounts and emitted duplicate payment-history row ids. Replay now keeps
   the first allocation authoritative, matching the established immutable
   identity rule.
2. **Fixed — payment row identity was internally inconsistent.** The payment
   history contract accepted an `id` different from `paymentId`. The row schema
   now requires them to match.
3. **Pinned — actor attribution stays server-owned.** Contract tests now prove
   forged `actorId` keys are stripped from invoice and payment payloads.

The invoice line payload remains typed while using the existing
`line_enrichment_record` proposal path. Its target is the proposal's outer
`lineId`; no voucher-only target, direct mutation path, store method, or API
write was added. `open_invoice` and `payment` remain consistent with the Wave 5
generic list seam.

## Verification

- Focused Wave 6b unit tests: PASS, 13/13.
- Contracts package typecheck: PASS.
- Domain package typecheck: PASS.
- Tests typecheck: PASS.
- Focused ESLint and IDE diagnostics: PASS.
- `git diff --check`: PASS.

## Clearance

Tasks 6b.3+ may proceed. No `NEEDS_OPUS_REVIEW` escalation remains for the
reviewed foundation.

Before any future writer appends `PaymentAllocated`, it must preserve the same
first-`paymentId` authority and validate allocation currency against the
invoice. The current Wave 6b plan only specifies read routes and UI after this
foundation; it does not yet identify the server-attributed producer for
`InvoiceRegistered` or `PaymentAllocated`. That producer must be accounted for
before Wave 6b is declared complete, otherwise the new lists have no production
event source.
