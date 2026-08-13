# Wave 6e foundation Sol review

Date: 2026-08-09
Reviewer: Sol (GPT-5.6)
Scope: Tasks 6e.1–6e.2
Commits: `ad7e6ff`, `d109e76`, `883bcfb`

## Verdict

**APPROVE**

No high-confidence correctness, valuation-identity, or scope findings.
`NEEDS_OPUS_REVIEW` is not warranted.

## Review

- The valued payload is strict and distinct from Wave 6d quantity movements:
  identity and booking fields are required, quantity is positive, unit cost is
  explicit and nonnegative, currency is uppercase three-letter text, and
  unknown keys are rejected.
- The list-row contract locks `id === movementId` and derives value only from
  explicit `valued_inventory_movement` enrichments. It does not infer cost from
  tags or quantity-only events.
- Replay uses the shared active-enrichment projection, excludes superseded
  values, rejects wrapper/payload line-identity mismatches, and preserves the
  first active row for a repeated movement identity.
- Each valued row retains its own UOM. The Wave 6d quantity projection remains
  unchanged and continues balancing independently by `(skuId, uom)`.
- The reviewed commits add only contracts, pure domain projection, tests, and
  SDD reporting. They do not claim the Wave 6e API, api-client, feature flag, or
  Books UI planned for Tasks 6e.3–6e.4.

## Verification

- Focused valued tests: **8/8 passed**.
- Quantity-only regression tests: **10/10 passed**.
- `@jpx-accounting/contracts` typecheck: passed.
- `@jpx-accounting/domain` typecheck: passed.

The worktree also contains concurrent, uncommitted Wave 6b/6e.3-adjacent files.
They were not reviewed, edited, staged, or included in this verdict. Wave 6e
remains incomplete, and the deferred Wave 6d/full/visual gates are unchanged.
