# Wave 6d quantity inventory UI/writer — Sol review

Date: 2026-08-09  
Branch: `feat/ledger-overview-enrichments-mcp`  
Reviewed: `968c26c`, `96c8b54`, inventory-related hunks in `6796c1b`, and `88d687b`

## Verdict

**REQUEST_CHANGES**

`NEEDS_OPUS_REVIEW`: **No**. The findings do not change ledger identity or the
approved Wave 5 pre-post architecture.

Wave 6d is **not COMPLETE**. The full and visual gate remains deferred.

## Important findings

### [P1, confidence 95] Reject or isolate mixed units before calculating a running quantity

`packages/domain/src/workflows/inventory-quantity.ts:17-24`

The projection keys its balance only by `skuId`, while every movement carries
its own free-form `uom`. The UI therefore permits, for example, `3 st` followed
by `2 kg` for the same SKU; the second row is rendered as a running quantity of
`5 kg`. That is a false quantity, not merely a presentation issue.

Fix by enforcing one canonical UOM per SKU (preferably through the planned SKU
registry and fail-before-append validation), or by treating `(skuId, uom)` as
the balance identity and making that distinction explicit in the contract/UI.
Add a regression test covering two different UOMs for one SKU.

### [P1, confidence 90] Add inventory approval to the Memory/Postgres conformance registry

`tests/integration/helpers/ledger-store-conformance.ts`  
`tests/integration/ledger-store-conformance.test.ts:58-73`

The reported `pnpm db:test` 110/110 run does not exercise a
`quantity_inventory_movement` review intent. There is no inventory scenario in
`CONFORMANCE_SCENARIOS` or its registry assertion. The only writer coverage is
the pure planner test and Playwright's demo-mode Memory store path, so the
strict Postgres run does not prove the required serialized append, intent
consumption, actor attribution, rollback, or Memory/Postgres parity.

Add a shared conformance scenario analogous to the invoice/trip atomic approval
scenarios. It should attach one quantity proposal, approve once, and assert:

- exactly one `PostedToLedger` and one `InventoryMovementRecorded`;
- server-derived `movementId`, posted `lineId`, booking date, and actor;
- consumed intent and replay/no-double-append behavior;
- equivalent Memory/Postgres outcomes.

## Confirmed

- The UI uses the existing Wave 5 review-intent seam; it does not add a
  client-side post-approval writer or a second posting.
- Movement identity, line identity, booking date, and actor are server-derived.
- Inventory line-not-found maps to a typed 422.
- Quantity inventory is a bounded singleton proposal kind.
- Quantity schemas are strict and reject `unitCost`, `currency`, and forged
  attribution/identity fields.
- The Books panel exposes quantity and running quantity only; no Wave 6e valued
  contract, endpoint, writer, column, feature flag, or inferred value was
  introduced.
- English/Swedish keys are paired, and clock-derived booking dates are visually
  masked.

## Gate status

Earlier focused inventory E2E was reported 4/4 and strict database tests
110/110. Those results are useful but do not close the findings above. No
visual baseline was reviewed or updated in this review.
