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

Do not start Wave 6b until this checkpoint is reviewed and approved. No PR to
`main` was opened.
