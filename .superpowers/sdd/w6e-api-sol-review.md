# Wave 6e Task 6e.3 API Sol review

Date: 2026-08-09
Reviewer: Sol (GPT-5.6)
Scope: Task 6e.3
Commits: `38e1b99`, `26152d9`

## Verdict

**APPROVE**

No high-confidence API, client, valuation-identity, or scope findings.
`NEEDS_OPUS_REVIEW` is not warranted.

## Confirmed

- `GET /api/lists/valued-movements` is registered unconditionally with the
  other list routes. It remains inside the API's existing authentication
  middleware when JWKS auth is enabled and does not depend on the deferred web
  feature flag.
- The route reads append-only ledger events, derives the pure valued-movement
  projection, and validates the response with `valuedMovementListSchema` before
  returning JSON.
- `AccountingApiClient.getValuedMovementsList()` uses the authorized fetch path
  over HTTP. Its offline-demo path replays the same event projection, and both
  transports parse through the same shared response schema.
- The locked valued identity and valuation rules approved at the foundation
  checkpoint remain unchanged: `id === movementId`, explicit unit cost and
  currency, authoritative row UOM, and rounded extended amount.
- No store method, writer, mutable inventory state, UI, feature-flag behavior,
  or quantity-only Wave 6d payload was added by the reviewed Task 6e.3 surface.

## Verification

- Focused route/client plus valued projection tests: **6/6 passed**.
- `@jpx-accounting/api-client` typecheck: passed.
- `@jpx-accounting/api` typecheck: passed.
- Aggregate tests typecheck: passed.
- `git diff --check 51e5aba..38e1b99`: passed.

## Concurrent worktree note

Commit `38e1b99` was created while concurrent Wave 6b intent-version work also
touched shared `services/api/src/app.ts` and `packages/api-client/src/index.ts`;
the current branch includes the associated `5ec5169` / `11e69d9` reconciliation.
Those approval-wiring changes are outside this review and are not cleared by
this verdict. The valued-list route/client hunks are unchanged between
`38e1b99` and the reviewed branch state, so that WIP contamination does not
block the isolated Task 6e.3 approval.

Wave 6e remains incomplete. Task 6e.4 UI and the full/visual gate remain
deferred.
