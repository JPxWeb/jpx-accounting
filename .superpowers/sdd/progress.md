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
- Wave 4C Sol re-review: APPROVE_WITH_FIXES `b27f824`.
  - The original reload blocker is fixed with contract-first Memory/Postgres
    snapshot parity and shared API-client parsing.
  - Removed both obsolete client-only tag cache projections; direct and
    MCP/advisor paths now refresh only from the authoritative workspace
    snapshot.
  - Focused unit tests passed 20/20; targeted format, lint, web typecheck,
    diagnostics, and diff checks passed.
  - `pnpm build:e2e` and focused desktop/Pixel 7 tag E2E passed 4/4, including
    reload persistence without cache replay.
  - Wave 4 final gate may proceed. Wave 5 was not started.
- Task 4.5 Wave 4 final gate: COMPLETE.
  - `pnpm check` passed with 566/566 unit tests; strict `pnpm db:test` applied
    migrations `0001`–`0010` and passed 86/86 integration tests.
  - `pnpm build:e2e` and focused voucher-tag E2E passed 4/4 across desktop and
    Pixel 7. Visual comparisons passed 20/20 with no baseline update.
  - Seams passed, i18n remained 1010/1010, and `docs/REPO_MAP.md` was updated
    in `5e6832f`.
  - No PR to `main` was opened. Wave 5 may proceed and was already pipelined.
- Wave 5 pipelined foundation batch completed while the Wave 4 final gate ran.
  - Task 5.1 review-enrichment intent contracts `04789c7`.
  - Task 5.4 additive journal/typed line-enrichment contracts `179429c`.
  - Task 5.5 stable `ln_` identifiers on new posting lines `b99c8bc`.
  - Task 5.6 locked `journal_n` plus projection-only legacy `lineId` rule
    `508ff1a`.
  - Task 5.7 line-target record/supersede planning and replay `d627d6e`.
  - Concurrent Wave 4 gate documentation commit `5e6832f` was preserved.
  - Task 5.8 route-free list projection framework `e69e746`.
  - Focused unit tests passed 30/30; contracts, domain, and tests typechecks
    passed; no store change, so this batch did not run `pnpm db:test`.
- Wave 5A Sol review: APPROVE_WITH_FIXES.
  - Fixed production replay of projection-only legacy line identity while
    preserving required `journal_n` IDs and immutable historical payloads.
  - Fixed legacy line-target recognition and rejected unknown/already
    superseded line enrichments before replacement events can append.
  - Strict `pnpm db:test` passed 89/89 with Memory/Postgres supersession parity;
    focused tests and affected typechecks passed.
  - `NEEDS_OPUS_REVIEW` is set for the legacy ledger-line identity change before
    Task 5.9 activates identity in the UI. See
    `.superpowers/sdd/w5a-sol-review.md`.

- Wave 5 Opus identity review: APPROVE_WITH_FIXES. See
  `.superpowers/sdd/w5-opus-identity-review.md`.
  - Fixed a high-severity latent mis-targeting hazard: `buildJournal` had a
    second legacy-identity derivation keyed on the journal-wide row index while
    replay and target validation use the event-local index. With the demo seed
    prepended, that path could hand a row the valid posted-target id of a
    different line in the same event. The parameter is removed;
    `collectLedgerLinesFromEvents` is now the only producer.
  - Fixed append-only supersession replay: a stale `LineEnrichmentSuperseded`
    naming an already-superseded prior overwrote the first supersession's actor,
    timestamp, and replacement id. First supersession now wins.
  - Confirmed unchanged: required `journal_n` IDs, payload `ln_` precedence,
    immutable historical payloads, Memory/Postgres target parity, and
    supersession serialized behind the Postgres workspace advisory lock.
  - Focused identity tests 22/22, full unit suite 583/583, domain/persistence/
    tests typechecks, formatting, and diagnostics passed. No store, migration,
    or UI file changed, so `pnpm db:test` and E2E were not re-run.
- Task 5.2 pre-post enrichment planning `9f978e9`.
  - Pure planning validates line targets against the approval batch and merges
    companion enrichment events while preserving exactly one `PostedToLedger`.
- Task 5.3 review-enrichment intent persistence `25c6804`.
  - Memory, Postgres, and Unavailable stores expose attach/get parity; approval
    consumes intent atomically and migration `0011` is tenant-scoped.
  - Focused tests and affected typechecks passed; strict `pnpm db:test` applied
    migrations `0001`–`0011` and passed 89/89 integration tests.
- Task 5.10 open-review proposal guard `b8d1ed5`.
  - Contract-first `POST /api/review-proposals` verifies the review/voucher
    relationship, rejects closed reviews, attaches server-attributed intent,
    and returns a queue deep link.
  - Focused route/client tests and affected typechecks passed.
- Wave 5B Sol review: APPROVE_WITH_FIXES.
  - Unsupported proposal kinds now fail before intent persistence in both
    stores instead of poisoning a later approval with an opaque 500.
  - Unsupported pre-post kinds and missing approval-batch line targets map to
    typed 422 responses; Opus identity, single-posting, tenant, and actor
    invariants remain intact.
  - Focused suites passed 40/40; affected typechecks, formatting, diagnostics,
    and diff checks passed. Strict `pnpm db:test` applied migrations
    `0001`–`0011` and passed 89/89 integration tests.
  - See `.superpowers/sdd/w5b-sol-review.md`. Tasks 5.2, 5.3, and 5.10 are
    approved after the review-fix commit; Wave 6 remains blocked on the full
    Wave 5 gate.
- Task 5.9 Books line-target and VAT/deductibility UI `67c3642`; Sol review:
  APPROVE_WITH_FIXES via accessibility-coverage commit `463ae1f`.
  - Voucher detail activates stable target columns only when projection
    `lineId` exists; demo seed rows remain explicitly disabled.
  - Positional `journal_n` ids are never exposed as enrichment targets.
  - English/Swedish copy and desktop/Pixel 7 E2E cover the gated behavior;
    the focused scenario now also runs the shared WCAG 2.2 AA axe assertion.
  - This read-only surface submits no pre-post proposal, so Wave 5B's typed
    422 response is not surfaced or obscured by Task 5.9.
  - Review rerun: view-model unit tests 5/5, focused lint and diagnostics,
    `pnpm build:e2e`, and desktop/Pixel 7 E2E with axe 2/2 passed.
  - See `.superpowers/sdd/w5-9-sol-review.md`; Task 5.9 no longer blocks the
    Wave 5 final gate.
- Task 5.11 pre-post and line-target integration conformance `d02b503`.
  - Memory/Postgres parity proves pre-post approval consumes its intent with
    exactly one posting and post-post line work-item confirmation never reposts.
  - TDD registry RED was observed; focused Memory conformance passed 16/16.
  - Strict `pnpm db:test` applied migrations `0001`–`0011` and passed 95/95
    integration tests, including both new scenarios across both stores.
- Wave 5C Sol review: APPROVE_WITH_FIXES.
  - Pre-post conformance now proves an absent approval-batch `lineId` raises
    the typed fail-closed error with zero event mutation before recovery and
    exactly one human-approved posting.
  - Line work-item conformance now proves proposal is non-mutating, confirmation
    is human-attributed, and replay appends neither another enrichment event nor
    another `PostedToLedger`.
  - Focused Memory conformance passed 16/16 with 30 expected Postgres skips;
    strict `pnpm db:test` applied migrations `0001`–`0011` and passed 95/95.
  - See `.superpowers/sdd/w5c-sol-review.md`. Task 5.11 is approved after the
    review-fix commit.
- Task 5.12 Wave 5 final gate: COMPLETE.
  - `pnpm check` passed with 588/588 unit tests; seams and i18n passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0011`, passed every
    capability assertion, and passed 95/95 integration tests.
  - `pnpm build:e2e` and focused ledger line identity/VAT E2E passed 2/2
    across desktop and Pixel 7.
  - Visual comparisons passed 20/20 across both themes and viewports,
    including `/books`; no baseline was updated.
  - `docs/REPO_MAP.md` now records Wave 5 routes, line-enrichment events,
    stable projection identity, pre-post review-intent flow, and migration
    `0011`.
  - The branch contains no MCP workspace package and no PR to `main` was
    opened. Wave 6 may start after the gate documentation commit.
- Wave 6a first Sol-review batch completed at `3ffb28f`.
  - Task 6a.1 project registry and typed line-enrichment contracts `c89852f`.
  - Task 6a.2 pure project registry/list projections `3ffb28f`.
  - TDD RED was observed for both tasks; focused project tests passed 10/10.
  - Contracts, domain, and tests typechecks passed; targeted formatting and
    diagnostics are clean.
  - No store or migration changed, so `pnpm db:test` was not required.
  - See `.superpowers/sdd/wave-6-batch-report.md`.

## In progress

- Wave 6a Tasks 6a.1–6a.2 await Sol review.

## Pending

- Wave 6a Tasks 6a.3–6a.6 after Sol approval.
- Waves 6b–8 in plan order (single feature branch; defer mid-wave PR to main
  until program ready).
