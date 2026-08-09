# Wave 6d inventory UOM + conformance — Sol re-review

Date: 2026-08-09  
Branch: `feat/ledger-overview-enrichments-mcp`  
Reviewed: `232cdd2`, `9fadc18`, `c58b9fb`, `d35cf8b`  
Prior review: `566755c` / `.superpowers/sdd/w6d-inventory-ui-sol-review.md`

## Verdict

**APPROVE**

`NEEDS_OPUS_REVIEW`: **No**. The repairs do not introduce a new
high-risk identity issue.

Wave 6d remains **NOT COMPLETE** only because the full functional and visual
gate is intentionally deferred.

## Findings

No findings.

## Blocker resolution

- Running quantities are keyed by `(skuId, uom)`. The regression test proves
  that `st` and `kg` movements for the same SKU retain independent balances.
- The shared quantity-inventory approval scenario is registered across
  Memory, Postgres, and parity executions. It covers invalid-line rollback,
  exactly one posting and movement, server-derived movement and posted-line
  identity, booking date, actor attribution, intent consumption, and replay
  without another append.
- The contracts, projection, route, client, conformance scenario, and Books
  panel remain quantity-only. No valued field, valuation logic, or Wave 6e
  behavior was added.

## Verification

- Focused Wave 6d contract, projection, planner, route, and client tests:
  **21/21 PASS**.
- `git diff --check 566755c..HEAD`: **PASS**.
- The focused Memory conformance rerun is currently disrupted by concurrent,
  uncommitted Wave 6b intent-version work: the WIP intentionally treats an
  approval without an echoed intent version as `noop`, while the committed
  conformance scenario targets the pre-version API. The Wave 6d projection and
  conformance files have no uncommitted changes, and the committed
  `232cdd2`/`9fadc18` scenario is consistent with the reported strict
  Postgres **113/113 PASS** before that WIP began. This contamination is not a
  Wave 6d blocker; rerun the strict gate after Wave 6b settles.
- Full functional E2E and visual comparison: **deferred**.
