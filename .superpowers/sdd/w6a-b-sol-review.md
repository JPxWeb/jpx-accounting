# Wave 6a Tasks 6a.3–6a.6 Sol review

**Date:** 2026-08-09
**Scope:** project API/store parity, pre-post review fields, Books list/drill, and final gate (`b15eaad`–`d8b2a73`)
**Verdict:** APPROVE_WITH_FIXES
**NEEDS_OPUS_REVIEW:** no — the fix reuses the Opus-approved canonical projection identity and does not change identity derivation, posting, or accounting amounts.

## Findings and fixes

1. **Fixed — legacy project assignments could not drill to their voucher.**
   `buildProjectsList` mapped vouchers from payload `lineId` only. A valid
   post-post assignment targeting an Opus-approved projection-only
   `legacy_<eventId>_<index>` line increased the project activity count but
   left `voucherIds` empty, disabling the Books row. The projection now uses
   `buildJournal(collectLedgerLinesFromEvents(...))`, the existing single
   identity producer, and never derives or treats `journal_n` as ledger
   identity.
2. **Fixed — `?workflow=project` labeled unrelated vouchers as project work.**
   The URL state previously activated the workflow slot on every journal
   voucher while leaving the journal unfiltered. It now filters to active
   project-assigned voucher ids and activates the slot only for those
   vouchers. Project rows are disabled when no linked voucher is available in
   the current journal scope; opening a row clears local tag/text filters that
   would otherwise make the action silently do nothing.
3. **Fixed — project loading and failure looked like an empty registry.**
   The list panel now exposes localized status and alert states rather than
   claiming no projects exist before the query resolves or after it fails.
4. **Added — store parity coverage for immutable registration.**
   Shared Memory/Postgres conformance proves a duplicate registration returns
   the first name/status, appends exactly one `ProjectRegistered`, and
   preserves the first server-provided actor.

## Reviewed invariants

- Project registration remains append-only and first-registration-authoritative
  in both stores under the Postgres workspace advisory lock.
- Pre-post project intent binds only to the first eligible posting-order
  `lineId`; missing eligible lines fail before append.
- Post-post project enrichment remains available through the existing
  line-target work-item path and never emits another `PostedToLedger`.
- The review UI submits only `project_assignment`; actor attribution remains
  server-derived.
- English/Swedish keys remain in parity. No invoice/payment, Wave 7, MCP, main,
  PR, or visual-baseline change was made.

## Verification

- Focused Wave 6a unit tests: PASS, 17/17.
- `pnpm check`: PASS, including 617/617 unit tests at the pipelined branch state.
- Domain, web, and tests typechecks: PASS.
- Targeted ESLint, Prettier, IDE diagnostics, and `git diff --check`: PASS.
- `pnpm check:i18n`: PASS, 1031 keys per locale.
- `pnpm check:seams`: PASS.
- `pnpm db:test`: PASS, migrations `0001`–`0011` and 98/98 integration tests.
- `pnpm build:e2e`: PASS.
- Focused project E2E: PASS, 4/4 across desktop and Pixel 7.
- The prior Wave 6a visual gate remains applicable; this fix changes only the
  opt-in `?workflow=project` surface and no baseline was updated.

## Clearance

- **Wave 6a Tasks 6a.1–6a.6:** COMPLETE after the review-fix commit.
- **Wave 6b:** may proceed; already-pipelined disjoint 6b work may continue.
- **Wave 7 / PR / main:** not started or touched.
