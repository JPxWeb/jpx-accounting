# Wave 6e Task 6e.4 unit-cost precision — Sol re-review

Date: 2026-08-09
Reviewed fix: `3acc905`
Prior review: `4948f49`
Verdict: **APPROVE**

The blocking display contradiction is resolved. The valued-movements panel now
uses a dedicated unit-cost formatter that preserves the authoritative numeric
decimal precision while retaining the row currency code. Quantity remains
displayed from the contract-validated row without rounding, and the extended
amount continues to use normal currency precision.

For the reported fixture, the row now displays `15,555 SEK × 2 st` alongside
`31,11 SEK`; the same behavior applies to other fractional unit costs instead
of silently rounding their visible operand to currency precision.

## Verification

- Focused presentation tests: **5/5 passed**.
- Full unit suite: **683/683 passed**.
- Reviewed diff check: passed.
- The panel wiring directly uses `formatUnitCost(row.unitCost, ...)`; no
  valuation, quantity/UOM, writer, or human-review-boundary behavior changed.

No high-confidence findings remain and no Opus escalation is required.
Task 6e.4 is approved specifically. Wave 6e is **NOT COMPLETE**: Task 6e.5's
full functional E2E and human-reviewed visual gates remain pending, including
the final populated-row browser coverage.
