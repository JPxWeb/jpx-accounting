# Wave 5 Task 5.9 Sol UI review

**Date:** 2026-08-09

**Scope:** `67c3642` — Books ledger line-target and VAT/deductibility UI

**Verdict:** APPROVE_WITH_FIXES

## Review result

No product defect was found. The implementation derives the target column only
from optional `JournalEntryProjection.lineId`; `JournalEntryProjection.id`
remains a positional render-key fallback and is never exposed as an enrichment
target. A voucher with no targetable lines keeps the localized disabled slot,
and a mixed projection renders each line without `lineId` as untargetable.

VAT code and deductibility columns activate only when at least one line carries
the corresponding optional projection data. Missing values within an active
column render as an honest em dash. This read-only surface neither submits a
pre-post proposal nor handles API errors, so surfacing the Wave 5B typed 422
responses here would add a false interaction path.

## Safe review fix

`463ae1f` adds the shared WCAG 2.2 AA axe assertion to the existing desktop and
Pixel 7 scenario. No production UI, contract, store, integration test, or visual
baseline changed.

## Verification

- ledger voucher view-model unit tests: 5/5 passed;
- focused lint and IDE diagnostics: passed;
- `pnpm build:e2e`: passed;
- focused desktop and Pixel 7 E2E, including axe: 2/2 passed;
- no visual baseline was updated.

## Clearance

Task 5.9 is approved after `463ae1f`. It introduces no blocker for the Wave 5
gate. Task 5.12 may proceed once the separate Task 5.11 Sol review clears; Wave
5 is complete only after that review and the Task 5.12 final gate pass. Wave 6,
PR creation, and changes to `main` remain blocked until then.
