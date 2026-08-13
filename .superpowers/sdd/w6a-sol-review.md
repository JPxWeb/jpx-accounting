# Wave 6a Tasks 6a.1–6a.2 Sol review

**Date:** 2026-08-09
**Scope:** project contracts and pure registry/list projections (`c89852f`–`cd0e661`)
**Verdict:** APPROVE_WITH_FIXES
**NEEDS_OPUS_REVIEW:** no — no ledger-line identity derivation, posting logic, or accounting amount behavior changed.

## Findings and fixes

1. **Fixed — duplicate registration could rewrite registry history.**
   `buildProjectRegistryFromEvents` previously accepted every
   `ProjectRegistered` event for a project id. A later duplicate could rename
   an existing project or reactivate an archived project without a lifecycle
   event. Replay now keeps the first registration authoritative; archive
   remains an append-only projection transition.
2. **Confirmed — attribution remains server-owned.**
   `registerProjectInputSchema` has no `actorId`; a regression assertion proves
   Zod strips a forged client value. Event actor attribution remains outside
   these client contracts.
3. **Confirmed — Wave 5 identity and typed-enrichment seams are preserved.**
   Project assignments carry `projectId` plus optional activity/object codes.
   The projection consumes active `enrichmentType: "project"` records and does
   not derive, reinterpret, or target `journal_n`; `lineId` handling remains in
   the Wave 5 framework.
4. **Confirmed — projections are pure and bounded to projects.**
   Builders replay supplied events into new maps/rows, never mutate the store
   or historical event payloads, and exclude superseded assignments. No
   invoice, payment, trip, inventory, route, store, or MCP surface was added.

## Verification

- Focused project contract/projection tests: 11/11 passed.
- Contracts, domain, and tests typechecks passed.
- Targeted Prettier and IDE diagnostics passed.
- `git diff --check` passed for the reviewed commit range.
- Database and E2E gates were not run because this batch changes no store,
  migration, API, or UI behavior.

## Clearance

- **Tasks 6a.1–6a.2:** approved after the review-fix commit.
- **Tasks 6a.3–6a.6:** may proceed in plan order.
- **Wave 6b+, Wave 7, PR creation, and `main`:** not part of this review.
