# Ledger overview enrichments MCP — SDD progress

## Complete

- Task 0 / W1-A + Sol 093cb6b
- W1-B 1.3–1.4 + Sol 13746b9
- Task 1.5–1.7 + Sol W1-C APPROVE_WITH_FIXES `47fd65f`
- Web typecheck after parallel Sol/UI: PASS
- Task 1.8 visual + docs `3ffa206`; win32 and Linux visual suites: 20/20 PASS
- Task 1.9 Wave 1 gate: PASS
  - Root cause: system `core.autocrlf=true` materialized 488 tracked LF blobs
    as CRLF only in this feature worktree; `scripts/check-seams.sh` is LF in
    Git, not committed as CRLF
  - Remediation: restored tracked files byte-for-byte from the index and
    formatted only 12 Git-ignored `.superpowers/sdd` gate-input documents; no
    tracked EOL churn and no new commit
  - PASS: `pnpm check` (501 unit tests), `build:e2e`, targeted ledger E2E 12/12,
    `check:seams`, and i18n 945/945
  - Verdict: Wave 1 COMPLETE; Wave 2 may start
- Task 2.1 enrichment work-item contracts `07473fb`
- Task 2.2 post-post noop planner and guards `a16832f`
- Wave 2A Sol review: APPROVE; no code changes required; focused tests and
  contracts/domain/tests typechecks passed at `a16832f`
- Task 2.3 atomic `LedgerStore` + Memory/Postgres/Unavailable parity `3374e85`;
  focused unit test and all three package typechecks passed.
- Wave 2B Sol review: APPROVE_WITH_FIXES `26a7865`
  - Proposal now rejects unposted targets in both Memory and Postgres.
  - Shared domain target derivation removes the posted-line parity gap.
  - Memory work-item responses no longer expose mutable stored state.
  - Focused enrichment tests 11/11, domain/persistence/API/tests typechecks,
    formatting, diagnostics, and diff checks passed.
- Task 2.4 idempotent `0009_enrichment_work_items.sql` migration `ad821c7`;
  fresh local Postgres 17 applied migrations `0001`–`0009` and passed all
  capability assertions.
- Task 2.5 enrichment work-item API routes `89553a1`; route RED observed,
  GREEN 2/2, focused enrichment suite 13/13, API/tests typechecks, targeted
  lint/format, diagnostics, and diff checks passed.
- Wave 2C Sol review: APPROVE_WITH_FIXES `e22a8b4`
  - GET missing-item responses now use the same dedicated 404 code and
    request-id shape as confirm/reject.
  - Migration and tenant-scoped transition paths reviewed; no auth, ledger,
    or cross-tenant blocker found.
  - Focused enrichment tests 14/14, API/tests typechecks, migration check,
    lint/format, diagnostics, and diff checks passed.
- Task 2.6 API client propose/get/confirm/reject methods `3529b13`; RED 2/2
  missing methods, GREEN 2/2, API-client/tests typechecks, format, diagnostics,
  and diff checks passed.
- Task 2.7 Memory/Postgres enrichment confirmation conformance `1c9019b`;
  shared scenario proves idempotent noop confirmation and exactly one
  `PostedToLedger` for the target voucher.
  - Strict `pnpm db:test` passed all 80 integration tests against disposable
    Postgres 17 with migrations `0001`–`0009`; new Memory, Postgres, and parity
    executions passed. The test container was stopped afterward.
- Wave 2D Sol review: APPROVE_WITH_FIXES
  - API-client proposal parsing now strips client-supplied attribution before
    both HTTP and offline Memory fallback transports.
  - Conformance now proves noop confirm and replay append zero events globally,
    preserve the posting count, and return no resulting event ids.
  - Focused tests and typechecks passed; strict disposable-Postgres
    `pnpm db:test` passed all 80 integration tests.
- Task 2.8 human confirmation UI shell `a514b24` complete.
  - `/books?view=journal&enrichmentWorkItem=...` opens a controlled,
    focus-trapped confirmation surface using the real API client.
  - Confirm and reject require explicit human activation; the shell never
    auto-applies. Advisor work carries Article 50 labeling and MCP work remains
    visibly external.
  - English/Swedish copy, active ledger-detail slot, mobile dock clearance,
    desktop/Pixel 7 E2E, keyboard semantics, and axe coverage are included.
  - Web/tests typechecks, `build:e2e`, and focused E2E 4/4 passed.
- Wave 2E Sol review: APPROVE_WITH_FIXES `cf6c59b`
  - Focus restoration now captures the invoking control before the dialog
    focus trap moves focus.
  - Desktop/Pixel 7 E2E verifies Escape closes the shell and returns focus;
    build, typechecks, i18n parity, lint, formatting, and diagnostics passed.
- Task 2.9 Wave 2 final gate: COMPLETE at `8bfd3a0`.
  - `pnpm check` passed with 518/518 unit tests after normalizing four ignored
    Sol review reports; no tracked EOL churn was introduced.
  - `pnpm db:test` passed migrations `0001`–`0009`, all capability assertions,
    and 80/80 strict Postgres integration tests.
  - Full functional E2E initially exposed one stale post-Wave-1 ledger-detail
    assertion on both projects; fixed in `b59ed2d`.
  - Focused review-edit E2E passed 8/8, then the full rerun passed 152 tests
    with 20 expected skips and 0 failures.
  - Desktop/mobile advisor and desktop MCP confirmation-shell visuals were
    reviewed without baseline updates; seams and i18n 969/969 passed.
  - `docs/REPO_MAP.md` route inventory updated in `8bfd3a0`.
  - No mid-wave PR was opened and `main` was not touched; Wave 3 may start.
- Task 3.1 external-reference contracts `d6c7380`.
  - Added linked/removed event types, payload/projection schemas, and
    link/unlink enrichment proposal arms.
  - Zod accepts valid URLs only when their parsed protocol is `https:`.
- Task 3.2 external-reference replay projection `ba55eeb`.
  - Added pure `buildExternalReferencesFromEvents` replay with retained link
    history and removal audit fields.
  - TDD RED/GREEN recorded; focused enrichment suite passed 14/14.
  - Contracts/domain/tests typechecks, targeted lint/format, diagnostics, and
    diff checks passed.
- Wave 3A Sol review: APPROVE; no code changes required.
  - HTTPS-only Zod contracts, exports, client-attribution stripping, pure
    append-only replay, voucher-matched removal, and no-fetch SSRF posture
    reviewed without findings.
  - Focused enrichment tests 14/14, contracts/domain/tests typechecks, and
    reviewed diff check passed at `ba55eeb`.
- Task 3.3 atomic external-reference planner/store/API `6a5668d`.
  - Added HTTPS-only shared link/removal planners, direct human link/unlink
    routes, and `external_reference_link` / `external_reference_unlink`
    work-item confirmation events.
  - Memory, Postgres, and Unavailable stores remain behaviorally aligned;
    direct and work-item paths append only external-reference events and never
    another `PostedToLedger`.
  - TDD RED observed for missing methods/routes/event arms; focused suite
    passed 17/17 after implementation.
  - Domain, persistence, API, and tests typechecks passed; targeted lint,
    formatting, diagnostics, and diff checks passed.
  - Strict `pnpm db:test` passed migrations `0001`–`0009`, all capability
    assertions, and 83/83 Postgres integration tests including the new
    Memory/Postgres external-reference conformance scenario.
- Wave 3B Sol review: APPROVE_WITH_FIXES `16109bc`.
  - Work-item unlink confirmation now requires an active reference belonging
    to the target voucher, matching direct unlink semantics.
  - Shared domain lookup and contract-schema validation keep Memory/Postgres
    behavior and HTTPS enforcement aligned; inactive unlinks append nothing
    and return a stable API 404.
  - Focused external-reference tests passed 18/18; domain, persistence, API,
    and tests typechecks, lint, formatting, diagnostics, and diff checks passed.
  - Strict `pnpm db:test` passed migrations `0001`–`0009`, capability
    assertions, and 83/83 integration tests.
- Task 3.4 multi-attachment/external-reference UI `6450959`.
  - Workspace snapshots now expose event-replayed external references with
    Memory/Postgres parity; the API client provides direct human link/unlink
    methods for both HTTP and offline demo transports.
  - Ledger detail lists every evidence ID with uploaded-file badges and active
    external references with separate link badges.
  - Link/unlink require explicit focus-trapped human confirmation; external
    URLs remain HTTPS-only and use safe new-tab attributes.
  - TDD RED observed for the disabled view-model slot, absent snapshot field,
    and absent client methods; focused GREEN passed 14/14.
  - Contracts/domain/persistence/API-client/web/tests typechecks, i18n
    988/988, lint, formatting, diagnostics, and diff checks passed.
  - Strict `pnpm db:test` passed migrations `0001`–`0009`, capability
    assertions, and 83/83 integration tests.
- Task 3.5 external-reference E2E `f137f28`.
  - Desktop and Pixel 7 link→project→confirm unlink happy path passed 2/2
    after a successful `pnpm build:e2e`.
  - The tests-only task passed its first execution because Task 3.4 already
    landed the planned selectors; no artificial failing test was introduced.
- Wave 3C Sol review: APPROVE_WITH_FIXES `f3dab7c`.
  - Work-item confirmation now renders the actual localized external-reference
    proposal and refreshes the workspace snapshot after a human decision.
  - Nested confirmation Escape handling closes only the topmost modal and
    restores focus without dismissing the voucher drawer.
  - HTTPS input exposes accessible invalid state; direct and MCP work-item
    lifecycle coverage passed desktop and Pixel 7, 6/6.
  - Web/tests typechecks, i18n 991/991, targeted lint/format/diagnostics,
    `build:e2e`, and existing confirmation-shell E2E 4/4 passed.
- Task 3.6 Wave 3 final gate: COMPLETE `2f86f47`.
  - Initial `pnpm check` stopped only on three Git-ignored Sol-review reports;
    normalizing those files removed the worktree EOL/format pollution without
    tracked churn. The full rerun passed with 534/534 unit tests.
  - `pnpm db:test` passed migrations `0001`–`0009`, every capability
    assertion, and 83/83 strict Postgres integration tests.
  - `pnpm build:e2e`, focused external-reference E2E 6/6, and the complete
    functional suite passed with 158 tests and 20 expected skips.
  - Visual comparisons passed 20/20, including `/books` in both themes and
    viewports; no baseline was updated.
  - Seams passed and i18n remained 991/991. `docs/REPO_MAP.md` now records the
    new routes, event vocabulary, store/client surfaces, and Books journey.
    The docs commit was followed by a second green `pnpm check` and seam gate.
  - No PR was opened and `main` was not touched. Wave 4 may start.
- Task 4.1 voucher-tag contracts `b9050db`.
  - Added `VoucherTagsAdded` / `VoucherTagsRemoved` to the append-only event
    vocabulary with validated payload schemas and exported types.
  - TDD RED observed for missing event members and schemas; GREEN 3/3.
- Task 4.2 bounded tag registry and pure planner/projection `12b01b8`.
  - Added tenant-scoped migration `0010_tag_registry.sql`, the plan-specified
    `tag_travel` default, request/voucher bounds, and registry membership
    validation.
  - Replay derives active tags from immutable add/remove history; planning
    deduplicates tag ids and emits only a tag event, never `PostedToLedger`.
  - TDD RED observed for all five missing surfaces; focused GREEN 8/8 across
    both Wave 4 test files.
  - Contracts/domain typechecks, targeted formatting/lint/diagnostics, and
    diff checks passed.
  - Local PostgreSQL 17 applied migration `0010`; a second migrate was a
    no-op with 10 migrations already applied.
- Wave 4A Sol review: APPROVE_WITH_FIXES.
  - Tag event contracts now enforce 1–10 ids.
  - The planner uses active tag ids to compute effective add/remove deltas,
    avoiding false overflow and redundant no-op events.
  - Migration `0010` idempotently seeds `tag_travel` for the current tenant
    scope so Postgres and Memory start from the same bounded registry.
  - Focused tests passed 9/9; contracts/domain/tests typechecks passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0010` and passed all
    83/83 integration tests.
  - No Opus escalation required; Tasks 4.3+ may proceed after the review fix
    commit.
- Task 4.3 store/API/client append-only voucher tags `f3f0899`.
  - Memory, Postgres, and Unavailable stores implement the bounded direct human
    path; active tags are replayed from events and no-op requests append
    nothing.
  - AI/MCP add/remove proposals confirm only through enrichment work items and
    never append a second `PostedToLedger`.
  - The direct API strips client attribution and derives the actor server-side;
    the API client supports both HTTP and offline demo transports.
  - TDD RED observed for missing store/route/work-item/client surfaces; focused
    Wave 4 tests passed 14/14.
  - Strict `pnpm db:test` applied migrations `0001`–`0010` and passed 86/86,
    including Memory/Postgres voucher-tag parity.
- Wave 4B Sol review: APPROVE_WITH_FIXES `539ca51`.
  - Shared request/projection contracts now allow the valid empty active-tag
    response after removing a voucher's final tag, with HTTP and offline client
    validation kept aligned.
  - Registry and per-voucher bound failures now map to a typed HTTP 422 instead
    of an opaque 500.
  - Focused Wave 4 tests passed 16/16; affected package/test typechecks,
    lint/format/diagnostics, and diff checks passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0010` and passed 86/86.
  - No Opus escalation required; Task 4.4 may proceed after the review-fix
    commit and rebase.
- Task 4.4 soft-tag UI and E2E completed on top of `539ca51`.
  - Ledger detail exposes registry-only tag chips; direct add/remove requires
    explicit focus-trapped human confirmation.
  - `?tag=` filters the journal, tag names participate in search, and confirmed
    MCP/advisor tag work items render and refresh the tag projection.
  - TDD RED observed for missing selectors and placeholder proposal copy.
  - Web/tests typechecks and i18n parity passed; `pnpm build:e2e` and focused
    desktop/Pixel 7 tag lifecycle E2E passed 4/4.
- Wave 4C Sol review: REQUEST_CHANGES.
  - The UI reads voucher tags only from a local React Query cache extension;
    the shared workspace contract and store snapshots do not expose the
    event-replayed projection, so active tags and `?tag=` results disappear
    after reload or a fresh session.
  - Safe UI review fixes restrict `?tag=` to registry ids and extend desktop /
    Pixel 7 E2E through final-tag removal, empty projection rendering, Escape,
    and focus restoration; focused E2E remains 4/4 after `pnpm build:e2e`.
  - No Opus escalation required. Wave 4 final gate remains blocked pending a
    contract-first workspace projection with Memory/Postgres parity and reload
    E2E coverage.
- Wave 4C blocker resolved; ready for Sol re-review.
  - `WorkspaceSnapshot.voucherTags` is contract-first, bounded, and defaulted
    for backward-compatible parsing.
  - Memory/Postgres snapshots replay append-only tag events with parity for
    active and empty-after-removal projections; HTTP and demo clients validate
    the shared snapshot contract.
  - Desktop and Pixel 7 E2E prove a direct tag survives reload.
  - Focused unit tests passed 14/14, affected typechecks passed, strict
    `pnpm db:test` passed 86/86, and focused tag E2E passed 4/4 after
    `pnpm build:e2e`.

## In progress

- None.

## Pending

- Sol re-review of the Wave 4C blocker resolution; do not run Task 4.5 final
  gate before clearance.
- Waves 5–8 (single feature branch; defer mid-wave PR to main until program
  ready).
