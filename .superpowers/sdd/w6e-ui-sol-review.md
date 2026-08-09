# Wave 6e Task 6e.4 valued-inventory UI — Sol review

Date: 2026-08-09
Reviewed commit: `95b3c67`
Verdict: **REQUEST_CHANGES**

## Important finding

1. **Unit-cost formatting can contradict the displayed total (confidence 95).**
   - `apps/web/components/books/valued-movements-panel.tsx:74` formats
     `row.unitCost` with the shared currency formatter, which applies the
     currency's standard fraction digits. The valued contract intentionally
     accepts arbitrary nonnegative numeric unit costs, and the existing
     projection fixture uses `15.555 SEK` for quantity `2`, deriving a rounded
     total of `31.11 SEK`.
   - The panel therefore renders `15.56 SEK` beside `31.11 SEK`; the visible
     operands imply `31.12 SEK`. This obscures the explicitly confirmed cost
     and makes the valued display internally inconsistent.
   - Preserve enough unit-cost precision to represent the authoritative value
     (with an explicit currency code), while continuing to show the derived
     extended amount at its rounded monetary precision. Add populated-row
     coverage using a fractional unit cost such as the existing `15.555`
     fixture.

## Verified

- Feature-off gating suppresses the valued query and panel; the quantity
  inventory query/panel and `(skuId, uom)` domain bucketing are unchanged.
- The panel reads explicit `unitCost`, `currency`, `quantity`, and `uom` from
  the contract-validated valued list. It does not infer value from tags.
- Task 6e.4 adds no writer or mutation path, so no valued write bypasses the
  existing human-review boundary.
- The changed files stay within the plan's Task 6e.4 scope.
- English/Swedish parity passed at 1115 keys each.
- Web typecheck, focused ESLint, Prettier, and the implementation diff check
  passed.

No Opus escalation is required: this is a bounded presentation-precision
defect, not a valuation identity or append-only writer issue.

Wave 6e is **NOT COMPLETE**. Task 6e.4 needs the precision fix and populated
display regression coverage; Task 6e.5's centralized full, functional E2E,
and human-reviewed visual gates also remain.
