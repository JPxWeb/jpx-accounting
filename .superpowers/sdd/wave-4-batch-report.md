# Wave 4 second Sol-review batch and UI pipeline

Date: 2026-08-09  
Branch: `feat/ledger-overview-enrichments-mcp`  
Starting HEAD: `5f9d840`  
Checkpoint HEAD: `f3f0899`
Sol review fix: `539ca51`

## Scope completed

- Task 4.3 — store, API, and API-client voucher-tag paths:
  - `LedgerStore.appendVoucherTags` implemented for Memory, Postgres, and
    fail-closed Unavailable stores.
  - Direct human `POST /api/vouchers/:id/tags` validates a bounded body,
    strips client attribution, and derives the actor server-side.
  - AI/MCP `voucher_tags_add` / `voucher_tags_remove` proposals confirm through
    enrichment work items and append only tag events.
  - Both direct and work-item paths derive active tags by replay, preserve
    effective no-op behavior, validate the tenant registry, and never append a
    second `PostedToLedger`.
  - `AccountingApiClient.appendVoucherTags` supports authenticated HTTP and the
    offline demo transport.
  - Memory/Postgres conformance covers direct add, no-op replay, MCP removal,
    idempotent confirmation, and unchanged posting count.
  - commit `f3f0899` (`feat(enrichment): append-only voucher tag API`)

## Sol review result

- APPROVE_WITH_FIXES at `539ca51`:
  - shared request/response contracts now validate the tag API boundary;
  - bounded empty tag projections are accepted by the API client;
  - registry validation failures use the typed 422 response path.

## Task 4.4 completed in parallel

- Added bounded registry-only soft-tag chips to ledger voucher detail.
- Direct add/remove actions require an explicit focus-trapped confirmation.
- `?tag=` filters the journal and tag names participate in journal search.
- MCP/advisor tag proposals render their real tag change in the existing
  human-confirmation shell and refresh the active UI projection only after
  confirmation.
- Added English/Swedish copy with key parity.
- TDD RED observed for the missing direct tag selector and placeholder MCP
  proposal copy.
- `pnpm build:e2e` passed.
- Focused `tests/e2e/voucher-tags.spec.ts` passed 4/4 across desktop Chromium
  and Pixel 7 mobile Chromium.
- Web/tests typechecks and i18n parity passed.

Task 4.5 was not started.

## TDD evidence

- Task 4.3 RED: 4/4 expected failures for the missing store method, unsupported
  proposal kind, absent route, and missing Unavailable implementation.
- API-client RED: the focused test failed because `appendVoucherTags` was
  missing.
- GREEN: focused Wave 4 tests pass 14/14.

## Focused verification

- `pnpm exec tsx --test tests/unit/voucher-tags-store.test.ts tests/unit/tag-registry.test.ts tests/unit/voucher-tags-contracts.test.ts`
  - PASS: 14/14
- Contracts, domain, Postgres persistence, API, API-client, and tests typechecks
  - PASS
- Targeted ESLint, Prettier, IDE diagnostics, and `git diff --check`
  - PASS
- `pnpm db:test`
  - PASS: migrations `0001`–`0010`; 86/86 strict Postgres integration tests
  - New voucher-tag Memory, Postgres, and parity scenarios all PASS

## Sol review request

Review Task 4.3 at the checkpoint commit, especially:

1. active-tag replay and effective no-op behavior in both stores;
2. table-backed Postgres registry validation and tenant scoping;
3. direct route actor stripping versus MCP/advisor work-item-only policy;
4. confirmation idempotency and the invariant that no second posting occurs;
5. API-client input stripping and offline/HTTP parity.

Task 4.4 integrated on top of the Sol fix. Stop before the Wave 4 final gate.

## Wave 4C blocker resolution

- Added the contract-first `voucherTags` workspace snapshot projection with a
  backward-compatible empty default and the existing 50-tag bound.
- Memory and Postgres snapshots now derive voucher tags from append-only event
  replay; conformance covers both active and final-tag-removed snapshots.
- The API workspace response carries the store projection, and the API client
  validates both HTTP and offline demo snapshots with the shared schema.
- Removed the web-only snapshot type extensions so ledger detail consumes the
  shared `WorkspaceSnapshot.voucherTags` field.
- Reload coverage now proves a directly added tag survives a fresh workspace
  request on desktop Chromium and Pixel 7.
- TDD RED: the focused contract/store/client suite failed 3 tests because the
  snapshot field and store projections were absent.
- GREEN: focused unit tests 14/14, affected package and test typechecks,
  `pnpm db:test` 86/86, `pnpm build:e2e`, and focused tag E2E 4/4.

Task 4.4 is ready for Sol re-review. Do not run the Wave 4 final gate yet.
