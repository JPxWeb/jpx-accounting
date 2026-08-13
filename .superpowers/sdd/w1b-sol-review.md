# Batch W1-B Sol Review

## Verdict

**APPROVE_WITH_FIXES**

Tasks 1.3–1.4 preserve the Wave 1 boundaries: the view-model exposes the complete evidence list, all future slots remain honestly disabled, and the detail component only reads ledger projections. No posting, event, evidence, or review-gate behavior is changed.

## Findings

- Voucher and packet joins are correct, preserve every `evidenceIds` entry, and fall back to the voucher id, empty supplier, and empty evidence list when entities are unavailable.
- The original unit test only covered evidence ids and one slot. It now pins the complete enriched view-model and adds the missing-join fallback.
- Six full-page `UnavailableState` panels made a voucher detail disproportionately heavy and repeated each leaf string as both title and message. They are now one compact unavailable section containing six individually testable list items.
- Slot labels still consume the existing `books.ledger.slots.*` leaf strings. No nested translation shape or message-file edit was introduced.
- The posting-lines table now has a screen-reader-only caption identifying the voucher.
- The unavailable section is omitted when no disabled slots remain, avoiding empty disabled chrome when later waves activate all slots.
- The planned three-argument helper signature included a redundant snapshot because `VoucherLookup` already contains the required maps. Concurrent journal integration used both the original three-argument form and the simplified lookup-only form during review, so the helper now accepts both without duplicating joins. New callers should prefer the two-argument form.
- `provenanceSummary` remains an honest empty Wave 1 seam and renders only when populated; no speculative provenance generation was added.

## Changes made

- Simplified disabled-slot chrome to one compact semantic list while preserving per-slot test ids.
- Added an accessible voucher caption to the ledger-lines table.
- Added compatible two- and three-argument view-model overloads.
- Strengthened view-model coverage for all fields, slots, and failed joins.

## Verification

- `pnpm exec tsx --test tests/unit/ledger-voucher-view-model.test.ts` — **PASS**, 2 tests, 0 failures.
- `pnpm --filter @jpx-accounting/web typecheck` — **PASS**.
- IDE diagnostics for the three edited TypeScript files — no errors.

## Proceed decision

UI integration may continue. Tasks 1.5+ were not started in this review.
