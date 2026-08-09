# Wave 6a Sol-review batch

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Base: `cf7edc7`
Scope: Wave 6a Tasks 6a.1–6a.6
Checkpoint: **READY FOR SOL REVIEW**

## Completed tasks

- Task 6a.1 — project registry and typed line-enrichment contracts:
  `c89852f`
  - Added append-only `ProjectRegistered` / `ProjectArchived` event vocabulary.
  - Added project registration, archive, projection, list-row, line payload,
    and `project_assignment` proposal schemas and inferred types.
  - Kept project assignment on the existing typed enrichment proposal path;
    no direct AI/MCP mutation path was introduced.
- Task 6a.2 — pure project registry and list projections:
  `3ffb28f`
  - Added `buildProjectRegistryFromEvents` and `buildProjectsList`.
  - Registered `kind: "project"` on the Wave 5 generic list seam.
  - Registry archive replay creates a new projection value and does not mutate
    historical registration payloads.
  - Activity counts use active `LineEnrichmentRecorded` replay state, so a
    superseded project assignment no longer contributes and its replacement
    contributes to the replacement project.
- Sol fixes for Tasks 6a.1–6a.2:
  `8d78a48`, report normalization `69ceb19`
  - Duplicate registrations cannot rename or reactivate a project; first
    registration remains authoritative.
  - Client-supplied `actorId` is stripped by the registration contract.
- Task 6a.3 — project registration/list API and api-client:
  `b15eaad`
  - Added server-attributed project registration and pure list retrieval.
  - Added Memory/Postgres/Unavailable store parity without a mutable project
    balance.
- Task 6a.4 — project pre-post review fields and deterministic line binding:
  `663c6c6`
  - Project assignments bind to the first eligible posting-order cost line.
  - Missing eligible lines fail before append; the review UI requires human
    project selection and submits through the existing approval path.
- Task 6a.5 — Books project list, workflow filter, and voucher drill:
  `94f4777`
  - Added `?workflow=project`, a project list panel, and voucher drill based on
    active assignment replay.
  - Project rows expose associated voucher ids so drill selection is
    deterministic rather than arbitrary.
- Task 6a.6 — full Wave 6a review gate:
  - Full repository, strict Postgres, focused E2E, visual, i18n, and seam gates
    passed. No visual baseline was updated.

## TDD evidence

- Task 6a.1 RED: 5/5 initial project contract tests failed because event
  members, schemas, and proposal arm were absent.
- Task 6a.1 GREEN: 6/6 passed after adding the lifecycle archive assertion.
- Task 6a.2 RED: 4/4 project projection tests failed because the builders were
  absent.
- Task 6a.2 GREEN: combined project contract/projection suite passed 10/10.
- Task 6a.3 RED: route tests returned 404 before project routes and store/client
  methods existed; GREEN: project registration/list route tests passed 2/2.
- Task 6a.4 RED: the binding helper was absent and the E2E controls did not
  exist; GREEN: planner tests passed 2/2 and the workflow E2E passed on desktop
  and Pixel 7.
- Task 6a.5 RED: the Books project panel was absent; GREEN: project list/drill
  E2E passed on desktop and Pixel 7.

## Verification

- Focused Wave 6a unit suite: PASS, 16/16.
- `pnpm check`: PASS, including 604/604 unit tests and production build.
- `pnpm db:test`: PASS, migrations `0001`–`0011` and 95/95 integration tests.
- `pnpm build:e2e`: PASS.
- Project workflow E2E: PASS, 4/4 across desktop and Pixel 7.
- Visual comparisons: PASS, 20/20 across both themes and viewports; no
  baseline update.
- `pnpm check:i18n`: PASS, en/sv parity at 1029 keys each.
- `pnpm check:seams`: PASS.

## Sol review ask

Review completed Wave 6a for:

1. immutable first-registration authority in both stores;
2. deterministic project assignment to a real eligible `lineId`, with
   fail-before-append behavior;
3. continued single-posting and explicit human-approval semantics;
4. active-assignment replay for project counts and deterministic voucher drill;
5. API/client/store parity, actor attribution, i18n, and Wave 5 identity rules.

No PR to `main` was opened. While Sol's Wave 6a review remained active, the
isolated Wave 6b contract/projection foundation below was pipelined by explicit
instruction; store, API, and UI work remains stopped.

# Wave 6b Sol-review foundation batch

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Base: `d8b2a73`
Scope: Wave 6b Tasks 6b.1–6b.2
Checkpoint: **READY FOR SOL REVIEW**

## Completed tasks

- Task 6b.1 — invoice/payment event and list contracts: `266e8d4`
  - Added append-only `InvoiceRegistered` and `PaymentAllocated` event
    vocabulary and their locked typed payloads.
  - Added typed invoice line-enrichment payload plus open-invoice and payment
    history list schemas.
  - Kept invoice line enrichment on the existing
    `line_enrichment_record` work-item/review path; no direct mutation path was
    introduced.
  - Corrected the plan sample by enforcing its locked required
    `originalAmount` field.
- Task 6b.2 — pure invoice/payment projections: `14587d0`
  - Added `deriveOpenInvoiceAmount`, append-only invoice replay,
    `buildOpenInvoicesList`, and `buildPaymentHistoryList`.
  - Partial allocations reduce open amount; fully allocated invoices leave the
    open list.
  - First invoice registration remains authoritative during replay, matching
    the Wave 6a immutable-registry review fix.
  - Registered `open_invoice` and `payment` on the Wave 5 generic list seam.

## TDD evidence

- Task 6b.1 RED: 5/5 tests failed because event members and schemas were
  absent; GREEN: 5/5 passed.
- Task 6b.2 RED: 7/7 tests failed because amount and list builders were absent;
  GREEN: 7/7 passed.

## Verification

- Focused Wave 6b unit suite: PASS, 12/12.
- Contracts package typecheck: PASS.
- Domain package typecheck: PASS.
- Tests typecheck: PASS.
- Focused ESLint on changed contract/domain/test files: PASS.
- Full store/API/E2E/visual gates were intentionally not run because this
  checkpoint stops before Tasks 6b.3–6b.6.

## Pipeline and integration notes

- Wave 6b was pipelined while Sol reviewed Wave 6a.3–6a.6.
- Sol's concurrent Wave 6a review edits remain unstaged and were not included
  in either Wave 6b commit.
- The only shared seams touched by 6b are additive contract exports,
  `eventTypeSchema`, the domain barrel, and the generic list dispatcher.
- No store, API route, Books UI, messages, PR, or Wave 6c work was started.

## Sol review ask

Review the Wave 6b foundation for:

1. locked invoice/payment payload identity and required `originalAmount`;
2. continued work-item/human-review path for invoice line enrichment;
3. first-registration authority and append-only allocation replay;
4. partial/full allocation math and two-decimal rounding;
5. generic list kind names (`open_invoice`, `payment`) before API work begins.

# Wave 6b store/API Sol checkpoint

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Base: `a80cfa5`
Scope: Task 6b.3 plus the Sol-required production event-writer completion
Checkpoint: **READY FOR SOL REVIEW**

## Completed tasks

- Task 6b.3 — open-invoice and payment-history read routes and api-client:
  `ee1d9bf`
  - Added pure `GET /api/lists/open-invoices` and
    `GET /api/lists/payment-history` routes.
  - Added contract-validated HTTP and offline-demo client methods.
  - Read routes append no events.
- Sol-required production writers — invoice registration/payment allocation:
  `e66a0c1`
  - Added append-only Memory/Postgres/Unavailable store parity, authenticated
    API routes, and HTTP/offline client methods.
  - Duplicate invoice and payment identities keep the first event authoritative.
  - Payment allocation validates the registered invoice currency before append;
    mismatch returns typed HTTP 422 and appends nothing.
  - API payload parsing strips forged actor fields and routes inject only the
    server-derived actor.
  - No AI direct-write path was added; invoice line enrichment remains on the
    existing work-item/review path.

## TDD evidence

- Task 6b.3 RED: both list routes returned 404; GREEN: exact empty derived JSON
  and no event append.
- Writer RED: store methods were absent and both writer routes returned 404.
  GREEN: immutable first-identity replay, server attribution, and fail-before-
  append currency validation pass across Memory and Postgres.

## Verification

- Focused invoice unit/route suite: PASS, 15/15.
- Focused Memory writer conformance: PASS; Postgres cases correctly skipped
  outside the strict gate.
- Contracts/domain/persistence/API/api-client/tests typechecks: PASS.
- `pnpm db:test`: PASS, migrations `0001`–`0011`, 101/101 integration tests,
  including Memory/Postgres invoice/payment parity.
- Formatting, ESLint/IDE diagnostics, and `git diff --check`: PASS.

## Sol review ask

Review this store/API checkpoint for:

1. first-registration and first-payment identity under replay;
2. fail-before-append allocation currency validation;
3. workspace advisory-lock serialization and Memory/Postgres parity;
4. server-owned actor attribution and no AI direct-write path;
5. read-route/client contract validation.

Tasks 6b.4–6b.6 remain intentionally unstarted pending this natural Sol
checkpoint. No PR was opened and Wave 6c was not started.

# Wave 6c Sol-review foundation batch

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Base: `dcc8a60`
Scope: Wave 6c Tasks 6c.1–6c.2
Checkpoint: **READY FOR SOL REVIEW**

## Completed tasks

- Task 6c.1 — trip registry and typed line-enrichment contracts: `31f836b`
  - Added append-only `TripRegistered` and `TripClosed` event vocabulary.
  - Added typed trip registration, close, line-enrichment, and list-row schemas.
  - Enforced required purpose/traveler/date fields, ordered dates, optional
    evidence/distance fields, and client `actorId` stripping.
  - Kept trip enrichment on the existing human-confirmed
    `line_enrichment_record` path.
- Task 6c.2 — pure trip list projection: `6f5294b`
  - Added `buildTripsList` and registered `kind: "trip"` on the Wave 5 generic
    list seam.
  - First registration remains authoritative; close events retain the trip in
    history with closed status.
  - Expense totals use active line-enrichment replay, so superseded expenses
    are replaced rather than double counted.

## TDD evidence

- Task 6c.1 RED: 5/5 tests failed because event members and trip schemas were
  absent; GREEN: 5/5 passed.
- Task 6c.2 RED: 4/4 tests failed because `buildTripsList` was absent; GREEN:
  combined trip contract/projection suite passed 9/9.

## Verification

- Focused Wave 6c unit suite: PASS, 9/9.
- Contracts package typecheck: PASS.
- Domain package typecheck: PASS.
- Tests typecheck: PASS.
- Focused ESLint, Prettier, and IDE diagnostics: PASS.
- Full store/API/E2E/visual gates were intentionally not run because this
  checkpoint stops before Tasks 6c.3+.

## Pipeline and integration notes

- Task 6c.1 was pipelined while Sol reviewed Wave 6b.3.
- Sol's `dcc8a60` review fix is in the Wave 6c ancestry before Task 6c.2.
- No store, API, Books UI, messages, Wave 6d work, PR, or `main` change was
  made.

## Sol review ask

Review the Wave 6c foundation for:

1. immutable first-registration authority and append-only close replay;
2. ordered trip dates and bounded optional evidence/distance fields;
3. continued work-item/human-review path and server-owned actor attribution;
4. active-enrichment expense totals, supersession behavior, and rounding;
5. generic list kind `trip` before route or UI work begins.

# Wave 6d Sol-review foundation batch

Date: 2026-08-09
Branch: `feat/ledger-overview-enrichments-mcp`
Base: `778afa7`
Scope: Wave 6d Tasks 6d.1–6d.2
Checkpoint: **READY FOR SOL REVIEW**

## Completed tasks

- Task 6d.1 — quantity inventory event and list contracts: `60351b0`
  - Added append-only `SkuRegistered` and `InventoryMovementRecorded` event
    vocabulary.
  - Added the locked movement payload and SKU movement list schemas/types.
  - Required `movementId`, `skuId`, positive quantity, UOM, direction, stable
    `lineId`, and booking date.
  - Used strict parsing so quantity inventory rejects `unitCost`, `currency`,
    and other valued-only fields.
- Task 6d.2 — pure SKU movement projection: `505ca24`
  - Added `buildSkuMovementList` and registered `kind: "sku_movement"` on the
    Wave 5 generic list seam.
  - Derived deterministic running quantities independently per SKU.
  - Kept the first event authoritative for a repeated `movementId`, preventing
    duplicate history rows and quantity changes during replay.

## TDD evidence

- Task 6d.1 RED: 4/4 tests failed because event members and quantity schemas
  were absent; GREEN: 4/4 passed.
- Task 6d.2 RED: 4/4 tests failed because `buildSkuMovementList` was absent;
  GREEN: combined quantity contract/projection suite passed 8/8.

## Verification

- Focused Wave 6d unit suite: PASS, 8/8.
- Contracts package typecheck: PASS.
- Domain package typecheck: PASS.
- Tests typecheck: PASS.
- Focused ESLint, Prettier, IDE diagnostics, and diff checks: PASS.
- Full store/API/E2E/visual gates were intentionally not run because this
  checkpoint stops before Tasks 6d.3+.

## Pipeline and integration notes

- Wave 6d was pipelined while Sol reviewed the Wave 6c foundation.
- Sol's Wave 6c fix `5fead99` and normalized review report `e2e49d4` are now
  both in the Wave 6d checkpoint ancestry; no rebase conflict remained.
- Concurrent Wave 6b UI and Wave 6c review files were not included in either
  Wave 6d implementation commit.
- The plan and spec separate optional valued inventory into Wave 6e; no valued
  schema, projection, feature flag, route, store, or UI was started.
- No PR was opened and `main` was not touched.

## Sol review ask

Review the Wave 6d foundation for:

1. strict separation between quantity and valued inventory payloads;
2. stable `movementId` / `lineId` identity and first-movement authority;
3. deterministic per-SKU running quantities under interleaved events;
4. append-only event vocabulary and absence of inferred inventory value;
5. generic list kind `sku_movement` before store/API/UI work begins.
