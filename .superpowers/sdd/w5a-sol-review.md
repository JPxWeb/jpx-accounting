# Wave 5A Sol review

**Date:** 2026-08-09  
**Scope:** Tasks 5.1 and 5.4–5.8  
**Verdict:** APPROVE_WITH_FIXES  
**NEEDS_OPUS_REVIEW:** yes — legacy ledger-line identity is security/integrity-adjacent and the production replay fix should receive one focused second review before Task 5.9 activates it in the UI.

## Findings and fixes

1. **Fixed — legacy `lineId` existed only in an isolated `buildJournal` context test.**
   Memory and Postgres report replay discarded event IDs, so historical
   `PostedToLedger` / `VoucherImported` lines never received the specified
   projection-only `legacy_${eventId}_${eventLocalIndex}` identity in production.
   Replay now carries that identity as private projection metadata. Historical
   payloads remain untouched, payload `ln_` IDs still win, and
   `JournalEntryProjection.id` remains `journal_${n}`.
2. **Fixed — legacy lines were not valid posted line targets.**
   `collectPostedEnrichmentTargets` now derives the same deterministic legacy
   identity from posting events. Memory and Postgres both retain the event ID
   needed for this guard.
3. **Fixed — supersession could replace a nonexistent or already-superseded enrichment.**
   Confirmation now requires the prior enrichment to be active on the same
   line. Memory and Postgres load the same append-only line-enrichment history;
   a stale prior returns the typed `line_enrichment_not_active` conflict instead
   of silently recording an orphan replacement.
4. **Accepted — contract and framework scope.**
   The Task 5.1 and 5.4 schemas are additive and keep server-owned attribution.
   The Task 5.8 list seam remains route-free and intentionally empty. No Task
   5.2/5.3 pre-post store/API vertical, Wave 6 workflow vertical, MCP package, or
   user-facing list route was introduced by the foundation batch.

## Verification

- Focused Wave 5 unit/regression suite: 56/56 passed.
- Contracts, domain, Postgres persistence, API, and tests typechecks passed.
- Strict `pnpm db:test`: migrations `0001`–`0010`; 89/89 integration tests
  passed, including Memory/Postgres line-enrichment supersession parity.
- Targeted Prettier, IDE diagnostics, and `git diff --check` passed.
- Wave 4 gate and E2E were not run.

## Clearance

- **May proceed:** Tasks 5.2, 5.3, and 5.10.
- **After focused Opus identity review:** Task 5.9.
- **Then:** Tasks 5.11–5.12 after their dependencies are complete.
- **Not cleared:** Wave 6 verticals, Wave 7/8 MCP work, or any PR to `main`.
