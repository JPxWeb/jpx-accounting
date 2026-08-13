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
- Wave 6a Tasks 6a.1–6a.2 Sol review: APPROVE_WITH_FIXES.
  - Duplicate `ProjectRegistered` replay can no longer rename or reactivate an
    existing project; the first registration remains authoritative.
  - A regression assertion pins client `actorId` stripping on project
    registration input.
  - Focused project tests passed 11/11; contracts, domain, and tests typechecks,
    targeted formatting, and diagnostics passed.
  - No Opus escalation is required. See
    `.superpowers/sdd/w6a-sol-review.md`; Tasks 6a.3–6a.6 may proceed.
- Wave 6a Tasks 6a.3–6a.5 completed.
  - Task 6a.3 project registration/list API, store parity, and api-client
    `b15eaad`.
  - Task 6a.4 deterministic project pre-post line binding and review fields
    `663c6c6`.
  - Task 6a.5 Books project list, workflow filter, and deterministic voucher
    drill `94f4777`.
  - Duplicate registration remains immutable; project assignment uses a real
    eligible posting `lineId` and fails before append when none exists.
- Task 6a.6 Wave 6a final gate: COMPLETE; ready for Sol review.
  - Focused project unit tests passed 16/16; `pnpm check` passed with 604/604
    unit tests and a production build.
  - Strict `pnpm db:test` applied migrations `0001`–`0011` and passed 95/95
    integration tests.
  - `pnpm build:e2e` and focused project workflow E2E passed 4/4 across desktop
    and Pixel 7.
  - Visual comparisons passed 20/20 with no baseline update; i18n parity passed
    at 1029 keys per locale and all seam gates passed.
  - No PR to `main` was opened. Wave 6b remains blocked pending Sol approval.
- Wave 6a Tasks 6a.3–6a.6 Sol review: APPROVE_WITH_FIXES.
  - Legacy project assignments now reuse the canonical journal projection to
    map Opus-approved `legacy_<eventId>_<index>` targets to voucher drill ids;
    `journal_n` remains presentation-only.
  - `?workflow=project` now filters to assigned vouchers and activates workflow
    detail only for those vouchers; localized loading/error states replace
    false empty-registry rendering.
  - Shared Memory/Postgres conformance now proves duplicate registration keeps
    the first project name, status, actor, and single append.
  - Focused unit tests passed 17/17; affected typechecks, ESLint, Prettier,
    diagnostics, diff checks, i18n 1031/1031, and seams passed; full
    `pnpm check` passed with 617/617 unit tests at the pipelined branch state.
  - Strict `pnpm db:test` passed migrations `0001`–`0011` and 98/98 integration
    tests; `pnpm build:e2e` and focused project E2E passed 4/4 across desktop
    and Pixel 7.
  - No Opus escalation is required. Wave 6a is COMPLETE and Wave 6b may
    proceed, including already-pipelined disjoint work. See
    `.superpowers/sdd/w6a-b-sol-review.md`.
- Wave 6b Tasks 6b.1–6b.2 Sol review: APPROVE_WITH_FIXES.
  - Duplicate `PaymentAllocated` replay now keeps the first `paymentId`
    authoritative, preventing duplicate history ids and double subtraction.
  - Payment history row `id` must match `paymentId`; forged client `actorId`
    fields remain stripped by the contracts.
  - Focused tests passed 13/13; affected typechecks, ESLint, formatting,
    diagnostics, and diff checks passed.
  - No Opus escalation is required. Tasks 6b.3+ may proceed; the eventual
    server-attributed event producer must validate allocation currency before
    Wave 6b is declared complete. See `.superpowers/sdd/w6b-sol-review.md`.
- Wave 6b store/API checkpoint completed.
  - Task 6b.3 read routes and api-client methods: `ee1d9bf`.
  - Sol-required append-only invoice/payment writers: `e66a0c1`.
  - First invoice/payment identity is authoritative; currency mismatch fails
    before append; API attribution remains server-derived.
  - Focused invoice tests passed 15/15; affected typechecks passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0011` and passed 101/101
    integration tests, including Memory/Postgres writer parity.
  - Ready for Sol review before Tasks 6b.4–6b.6 UI/gate work.
- Wave 6b Task 6b.3 + writer Sol review: APPROVE_WITH_FIXES.
  - API list routes now validate derived responses against the shared
    open-invoice and payment-history contracts before returning JSON.
  - First-payment replay, fail-before-append currency validation, workspace
    serialization, server attribution, store parity, and the existing
    work-item confirmation path were confirmed.
  - Focused tests passed 15/15; affected package/test typechecks passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0011` and passed 101/101
    integration tests.
  - No Opus escalation is required. Tasks 6b.4–6b.6 may proceed after the
    review-fix commit. See `.superpowers/sdd/w6b3-sol-review.md`.
- Wave 6c foundation was pipelined during the Wave 6b.3 Sol review and is ready
  for Sol review on top of `dcc8a60`.
  - Task 6c.1 trip registry and typed line-enrichment contracts: `31f836b`.
  - Task 6c.2 pure trip list projection: `6f5294b`.
  - First registration is authoritative; close replay is append-only; active
    enrichments provide rounded expense totals without counting superseded
    values.
  - TDD RED was observed for both tasks; focused trip tests passed 9/9.
  - Contracts, domain, and tests typechecks passed; focused lint, formatting,
    and diagnostics are clean.
  - Store/API/UI work remains unstarted pending the Wave 6c foundation review.
- Wave 6c Tasks 6c.1–6c.2 Sol review: APPROVE_WITH_FIXES.
  - Trip totals now resolve the amount from the canonical posted ledger line
    bound by the enrichment wrapper's stable `lineId`; the locked trip payload
    no longer depends on an out-of-contract `expenseAmount`.
  - Active supersession moves one line amount between trip projections, and
    projection row updates are immutable.
  - Focused trip tests passed 9/9; contracts, domain, and tests typechecks,
    ESLint, Prettier, diagnostics, and diff checks passed.
  - No Opus escalation is required. Tasks 6c.3+ may proceed after the
    review-fix commit. See `.superpowers/sdd/w6c-sol-review.md`.
- Wave 6d quantity-inventory foundation was pipelined during the Wave 6c Sol
  review and is ready for its own Sol checkpoint.
  - Wave 6c fix `5fead99` and normalized report `e2e49d4` are integrated in
    the current ancestry.
  - Task 6d.1 strict quantity movement contracts: `60351b0`.
  - Task 6d.2 pure per-SKU running-quantity projection: `505ca24`.
  - Quantity payloads require stable movement/line identity and booking date;
    strict parsing rejects valued `unitCost` and `currency` fields.
  - First movement identity is authoritative, and running quantities remain
    isolated per SKU.
  - TDD RED was observed for both tasks; focused quantity tests passed 8/8.
  - Contracts, domain, and tests typechecks passed; focused lint, formatting,
    diagnostics, and diff checks are clean.
  - Store/API/UI and optional Wave 6e valued inventory remain unstarted.
- Wave 6d Tasks 6d.1–6d.2 Sol review: APPROVE_WITH_FIXES.
  - SKU movement list rows now require `id === movementId`, preserving one
    contract identity for append-only replay and API validation.
  - Quantity payloads remain strict and reject valued fields plus forged client
    `actorId`; per-SKU running balances and first-movement authority are intact.
  - Focused tests passed 8/8; contracts/domain typechecks, ESLint, Prettier,
    diagnostics, and diff checks passed.
  - No Opus escalation is required. Wave 6d store/API may proceed after the
    review-fix commit; Wave 6e remains blocked until Wave 6d is complete. See
    `.superpowers/sdd/w6d-sol-review.md`.
- Wave 6c store/API checkpoint completed on the reviewed foundation.
  - Task 6c.3 contract-validated trips read route and HTTP/offline api-client:
    `c93e5ac`.
  - Append-only Memory/Postgres/Unavailable lifecycle producers, authenticated
    API routes, and api-client methods: `5005bc7`.
  - First registration/close remain authoritative; unknown closes fail before
    append; route actor attribution is server-derived.
  - Focused trip tests passed 13/13 and all affected package plus aggregate
    test typechecks passed.
  - Strict `pnpm db:test` applied migrations `0001`–`0011` and passed 104/104
    integration tests including Memory/Postgres trip lifecycle parity.
  - Wave 6d review fixes `deaf719` / `4fda984` are in the ancestry. Ready for
    Sol review before Wave 6c Tasks 6c.4–6c.5.
- Wave 6d Task 6d.3 store/API checkpoint completed: `c490e66`.
  - Added contract-validated `GET /api/lists/sku-movements` and matching
    `getSkuMovementsList()` HTTP/offline-demo client paths.
  - List reads derive from append-only events, append nothing, retain locked
    movement row identity, and expose no valued fields.
  - No direct movement writer was added; the human-reviewed work-item path,
    posted `lineId` validation, and server actor derivation remain mandatory
    for the later movement producer.
  - Focused tests passed 2/2; API, api-client, and tests typechecks plus focused
    lint, formatting, diagnostics, and diff checks passed.
  - Store/database code did not change, so `pnpm db:test` was not required.
    Heavy UI and full gates remain stopped for Sol review.
- Wave 6c store/API Sol review: APPROVE.
  - Append-only first-registration/first-close authority, fail-before-append
    unknown closes, server attribution, advisory-lock serialization, and
    Memory/Postgres/Unavailable parity were confirmed without findings.
  - Trip list and client responses remain contract-validated; expense totals
    still derive from the canonical posted line bound by active enrichment
    `lineId`, with no direct AI mutation path.
  - Focused tests passed 28 with 36 expected Postgres skips; strict
    `pnpm db:test` passed migrations `0001`–`0011` and 104/104 integration
    tests.
  - No Opus escalation is required. Wave 6c trips UI may proceed through the
    existing explicit human-review work-item path. See
    `.superpowers/sdd/w6c-store-sol-review.md`.
- Wave 6b Tasks 6b.4–6b.6 completed; ready for Sol review.
  - Invoice pre-post validation fields and explicit human approval gate:
    `c38a565`.
  - Books open-invoice/payment panels with row-currency and identity-preserving
    empty/populated E2E: `a5d88cb`.
  - `pnpm check` passed with 641/641 unit tests; strict `pnpm db:test` passed
    migrations `0001`–`0011` and 104/104 integration tests.
  - `pnpm build:e2e`, focused desktop/Pixel 7 invoice E2E 6/6, visuals 20/20,
    i18n 1057/1057, seams, and diff checks passed with no baseline update.
  - No PR was opened, `main` was not touched, and no Wave 6c trip module was
    edited by this batch.
- Wave 6d Task 6d.3 Sol review: APPROVE.
  - The API route and HTTP/offline clients validate the shared SKU movement
    list contract, including locked `id === movementId` identity.
  - Reads remain append-only and quantity-only with no writer, mutable
    inventory table, valued field, or Wave 6e behavior.
  - Focused Wave 6d tests passed 10/10; contracts, domain, API client, API, and
    aggregate tests typechecks passed.
  - No fix commit or Opus escalation is required. Wave 6d UI and remaining
    writers may proceed; Wave 6e remains blocked until Wave 6d is complete.
    See `.superpowers/sdd/w6d3-sol-review.md`.
- Wave 6b Tasks 6b.4–6b.6 Sol review: REQUEST_CHANGES.
  - Invoice review fields currently gate approval but are discarded on submit;
    approval appends neither `InvoiceRegistered` nor an invoice line
    enrichment, so the new Books panels cannot reflect the reviewed invoice.
  - A client-side post-approval `registerInvoice()` call is not acceptable:
    identity/currency/amount would be inferred outside the authoritative seam
    and the two writes would not be atomic.
  - Books panel identity, row-currency formatting, state handling, a11y
    structure, and i18n parity were reviewed without another finding.
  - Wave 6b is NOT COMPLETE. `NEEDS_OPUS_REVIEW` is set for a contract-first,
    server-attributed, Memory/Postgres-parity approval-to-registration design.
    See `.superpowers/sdd/w6b-ui-sol-review.md`.
- Wave 6c Task 6c.4 trips UI checkpoint completed: `5f94a94`.
  - Added packet-bounded trip review validation and a localized
    `?workflow=trip` list with honest loading, error, and empty states.
  - Focused E2E proves an advisor proposal targets a real posted cost-line
    `lineId` and affects the derived trip total only after explicit human
    confirmation; `pnpm build:e2e` and desktop/Pixel 7 trip E2E passed 4/4.
  - Web/tests typechecks, focused lint/format/diagnostics, and i18n parity at
    1078/1078 passed.
  - Task 6c.5's centralized visual/full gate is pending because concurrent
    Wave 6b/6d owners currently hold shared journal, review, contract, planner,
    store, and test files. No visual baseline was updated.
  - Sol review should decide whether trip pre-post fields require the same
    contract-first atomic approval seam requested for Wave 6b; the UI does not
    invent identity or perform a client-side post-approval registration.
- Wave 6c Task 6c.4 Sol review: REQUEST_CHANGES.
  - Trip purpose, traveler, dates, and optional evidence are validated in the
    edit sheet but discarded on submit; the committed handler only persists a
    project proposal.
  - The focused E2E closes the sheet, approves with an empty API request, then
    separately registers and post-post enriches the trip. It correctly proves
    explicit human confirmation against a real posted `lineId`, but not the
    claimed pre-post workflow.
  - Atomic-seam decision: YES. Pre-post trip fields must be contract-first and
    consumed in the serialized approval transaction that derives identity,
    binds a real eligible cost-line `lineId`, and appends exactly one posting
    plus trip registration/enrichment events.
  - `NEEDS_OPUS_REVIEW` is set because the repair crosses identity,
    review-intent contracts, posting-line binding, and Memory/Postgres
    all-or-nothing behavior. Reuse/generalize the Wave 6b seam where possible.
  - No implementation fix was made while Wave 6b/6d owners hold shared files.
    Wave 6c remains NOT COMPLETE and the full/visual gate remains deferred.
    See `.superpowers/sdd/w6c-trips-ui-sol-review.md`.
- Wave 6b Opus review of the atomic approval-to-invoice seam: REQUEST_CHANGES,
  with the seam **design APPROVED** and the fix agent cleared to proceed.
  - The seam Sol asked for already exists: the Wave 5 pre-post intent path
    (`attachReviewEnrichmentIntent` → `planPrePostEnrichment` →
    `mergePrePostEnrichmentsIntoReviewDecisionPlan`) appends companion events
    inside the one serialized approval transaction, and already refuses both a
    companion `PostedToLedger` and a base plan without exactly one. No new seam
    should be built and `registerInvoice()` must stay off the approval path.
    Wave 6c trips should reuse it rather than invent a parallel path.
  - `invoiceId`, `currency`, and `originalAmount` are all server-derivable in
    the planner, so attach-then-approve is safe: a failure between the two calls
    leaves an intent on a still-open review, never a posted voucher without its
    registration.
  - Two blocking defects in the in-flight implementation: a stale intent is
    never cleared, so an approval can register an invoice the approver never
    saw; and `originalAmount` sums the debit legs without `round2`, writing a
    non-öre-exact amount into an immutable event for 25.7% of gross amounts.
  - Also required before the gate: a typed 422 for the amount-less voucher that
    currently yields an opaque 500 and a permanently unapprovable review,
    invoice/inventory-specific line-not-found errors instead of the
    project-assignment one, and a bound on the unbounded `proposals` array plus
    an at-most-one rule per singleton proposal kind.
  - Known limitation to document: postings credit bank, not AP/AR, so an open
    invoice and the balance sheet will disagree until payment allocation.
  - No code was changed — the fix agent holds uncommitted work in every file the
    fixes touch. Wave 6b is NOT COMPLETE; the seven gate conditions are in
    `.superpowers/sdd/w6b-opus-invoice-seam-review.md`.
- Wave 6c atomic trip approval repair is implemented and verified for Sol
  re-review; Wave 6c remains NOT COMPLETE.
  - Added the contract-first `trip_registration` proposal and reused the Wave 5
    atomic pre-post intent seam approved by the Wave 6b Opus design review.
  - Approval derives `tripId` and a real eligible posting `lineId`, validates
    optional packet evidence, and appends one registration plus one line
    enrichment beside exactly one posting in the serialized transaction.
  - Memory/Postgres conformance proves invalid-evidence rollback, persist-once,
    server actor attribution, intent consumption, and no double attach/repost;
    list replay counts a posted line only once per trip.
  - Focused contract/planner tests passed 15/15, trip-list tests passed 6/6,
    typed trip refusal mapping passed, and affected typechecks passed; strict
    `pnpm db:test` passed 110/110; `build:e2e` and trip E2E passed 4/4 across
    desktop and Pixel 7 while retaining the post-post real-line path.
  - See `.superpowers/sdd/wave-6-batch-report.md`.
- Wave 6c Opus review of the atomic trip approval seam is published in
  `.superpowers/sdd/w6c-opus-trip-seam-review.md`; verdict REQUEST_CHANGES with
  the design APPROVED as built. Wave 6c remains NOT COMPLETE.
  - Sol's escalation is upheld and answered: the required seam is the Wave 5
    pre-post intent path, already used correctly by the implementation. Server
    `tripId`, primary-cost-line binding, packet-bounded evidence, one posting
    plus registration plus enrichment per transaction, and store parity all
    verified. No alternative seam should be built.
  - Fixed during review: `buildTripsList` double-counted a posted line whenever
    the same trip was attached both pre-post and post-post (1 000 kr line
    reported 2 000). Fix plus two regression tests in
    `packages/domain/src/workflows/trips.ts` and `tests/unit/trips-list.test.ts`
    (6/6 PASS, domain typecheck and lint clean).
  - Must land before the gate: `TripRegistrationLineNotFoundError` and
    `TripEvidenceNotInPacketError` have no `app.onError` branch and answer 500
    instead of a mapped 422. Four medium findings (cross-trip double count,
    optional `evidenceIds`, intent consumption inferred from `edited`,
    silently inert unregistered trip references) must be fixed or deferred with
    a reason. Seven gate conditions are listed in the review.
  - No shared in-flight file was edited: both fix agents were actively writing
    contracts, planner, stores, `app.ts`, conformance and the review sheet
    during the review, so every other finding is written for its owner to apply.
- Wave 6b atomic invoice approval repair is implemented and verified for Sol
  re-review; Wave 6b remains NOT COMPLETE.
  - Reused the Opus-approved Wave 5 pre-post intent seam; no second mutation or
    standalone `registerInvoice()` call was introduced.
  - Invoice identity, normalized currency, rounded posted amount, and real line
    identity are derived server-side and appended atomically with one posting.
  - Deselect, close, plain queue/dashboard/API, and advisor paths clear unseen
    stale intents with `noop`; focused E2E covers the user-visible stale cases.
  - Typed 422s cover amount-less invoices and vertical-specific missing lines;
    proposal arrays are bounded and singleton workflow proposals cannot repeat.
  - Full `pnpm check` passed (661 unit tests), `pnpm db:test` passed 110/110
    with Memory/Postgres rollback and replay parity, invoice E2E passed 12/12,
    and visual comparison passed 20/20 without updating baselines.
  - Intent-author metadata and true 1510/2440 AR/AP posting remain explicitly
    deferred in the batch report/plan.
- Wave 6c Opus gate repair is implemented in `6796c1b` and verified for Sol
  re-review; Wave 6c remains NOT COMPLETE pending that verdict.
  - Both trip planner refusals map to typed 422 responses; packet evidence ids
    are required by the planner type.
  - Approval consumes intent only through explicit
    `enrichmentIntent: "consume"`; every other approval path clears unseen
    intent inside the decision transaction.
  - Post-post trip enrichment rejects unregistered trips and refuses a second
    active trip on the same posted line; same-trip replay is idempotent.
  - Centralized verification passed: focused seam tests 63/63, `pnpm check`,
    strict `pnpm db:test` 110/110, `pnpm build:e2e`, and combined invoice/trip
    E2E 12/12 across desktop and Pixel 7.
- Wave 6b atomic invoice seam Sol re-review: REQUEST_CHANGES;
  `NEEDS_OPUS_REVIEW` for a new high-risk intent-identity race.
  - The original discarded-field, Wave 5 pre-post seam, listed stale-intent,
    öre-rounding, typed-422, vertical error-code, singleton-proposal, parity,
    and documentation requirements are substantially fixed.
  - Approval sends only `enrichmentIntent: "consume"` and does not identify the
    attached intent version. A concurrent upsert between attach and approve is
    therefore consumed inside the serialized transaction even though the
    approver saw a different proposal.
  - Bind consume to an opaque intent id/version and fail closed with zero event
    append on mismatch; add Memory/Postgres race conformance and API coverage.
  - This re-review passed 42/42 focused invoice seam tests and
    `git diff --check`. Wave 6b remains NOT COMPLETE. See
    `.superpowers/sdd/w6b-invoice-seam-sol-rereview.md`.
- Wave 6b intent-version consume-race Sol re-review: **APPROVE; COMPLETE**.
  - Every attach mints a fresh opaque version; consume must echo that exact
    version, and stale/forged assertions fail before any append with typed 409
    `enrichment_intent_stale`.
  - Memory/Postgres use one shared resolver, omission remains fail-closed, and
    migration `0012` backfills legacy rows with `gen_random_uuid()`.
  - Fresh focused intent tests passed 30/30 and the reviewed range passed
    `git diff --check`. Existing clean records remain typecheck 11/11 plus
    tests typecheck, and strict disposable-Postgres 119/119 with consume-race
    parity.
  - Reject+stale, redundant noop attaches, and English domain 409 detail are
    documented non-blocking notes. No further Opus review is requested.
  - Invoice E2E and visuals are explicitly deferred to the centralized
    pre-merge gate because Wave 6e UI files are actively dirty; no visual
    baseline may be updated without human review. See
    `.superpowers/sdd/w6b-intent-version-sol-rereview.md`.
- Wave 6c atomic trip seam Sol re-review: REQUEST_CHANGES; no renewed Opus
  review is required.
  - Typed trip 422s, required packet evidence ids, explicit intent
    consumption, the Wave 5 pre-post seam, same-trip deduplication, and the
    exercised real-`ln_` post-post path are sound.
  - `line_enrichment_supersede` trip replacements bypass both registered-trip
    validation and the one-active-trip-per-line guard. They can append an inert
    unregistered trip or restore cross-trip double counting.
  - Apply the shared trip guard to record and supersede arms, with
    Memory/Postgres conformance for invalid replacement and legitimate trip
    reassignment.
  - Focused trip seam tests passed 52/52 and `git diff --check` passed. Wave 6c
    remains NOT COMPLETE; full functional E2E and visual review remain
    deferred. See `.superpowers/sdd/w6c-trips-seam-sol-rereview.md`.
- Wave 6c trip-supersession Sol re-review: APPROVE; Wave 6c is COMPLETE for
  all open Sol blockers.
  - The shared validator now rejects unregistered supersede replacements and
    a second active trip while permitting trip A to move to registered trip B.
  - Postgres loads the replacement registration before shared planning;
    Memory/Postgres conformance covers both refusals and legitimate movement.
  - Fresh focused verification passed 55/55, including planner 12/12 and
    Memory supersession conformance. The repair's clean strict Postgres record
    remains 116/116.
  - A review-time strict rerun was contaminated by concurrent dirty Wave 6b
    intent-version work: migration `0012` appeared after migration and 42 tests
    then failed on its missing `version` column. This is unrelated to the
    committed trip repair and does not block Wave 6c.
  - No Opus escalation is required. Full functional E2E and human-reviewed
    visuals remain deferred. See
    `.superpowers/sdd/w6c-trips-supersession-sol-rereview.md`.

## In progress

- Wave 6d quantity inventory UOM/conformance Sol re-review: APPROVE.
  - Reviewed repairs: `232cdd2` + ownership-separation commit `9fadc18`.
  - Running quantities are now keyed by `(skuId, uom)`, so incompatible units
    remain separate instead of producing false mixed-unit balances.
  - Shared conformance now exercises the quantity-inventory approval writer on
    Memory and Postgres, including rollback, exactly one posting and movement,
    server-derived movement/line/date/actor fields, intent consumption, replay,
    and parity.
  - Focused quantity tests passed 21/21. The pre-Wave-6b-WIP strict
    `pnpm db:test` applied migrations `0001`–`0011` and passed 113/113
    integration tests.
  - A focused Memory conformance rerun is currently disrupted only by
    concurrent uncommitted Wave 6b intent-version work changing the consume
    API. Wave 6d paths are clean; rerun the strict gate after that WIP settles.
  - No shared approval implementation, valued field, or Wave 6e behavior was
    added. No Opus escalation is required. Wave 6d remains NOT COMPLETE; full
    and visual gates remain deferred. See
    `.superpowers/sdd/w6d-inventory-uom-sol-rereview.md`.
- Task 6d.5 Wave 6d final gate: PASS; ready for Sol's COMPLETE decision.
  - `pnpm check` passed with 683/683 unit tests; strict `pnpm db:test` applied
    migrations `0001`–`0012`, passed every capability assertion, and passed
    119/119 integration tests including quantity-inventory store parity.
  - `pnpm build:e2e` passed with valued inventory unset. Focused quantity
    inventory E2E passed 4/4 across desktop Chromium and Pixel 7.
  - Visual comparisons passed 20/20 across both themes and viewports. Every
    image matched its baseline; no baseline was updated.
  - Seams passed, i18n remained 1115/1115, and `git diff --check` passed.
  - SIE `#OBJEKT` / `#ANTAL` remains deferred per plan. No PR was opened,
    `main` was not touched, and Waves 7–8 were not started. See
    `.superpowers/sdd/wave-6d-gate-report.md`.
- Task 6d.5 final Sol review: **APPROVE; WAVE 6d COMPLETE**.
  - Sol independently reran the substantive gates: `pnpm check` passed with
    683/683 unit tests; strict `pnpm db:test` applied migrations `0001`–`0012`,
    passed every capability assertion, and passed 119/119 integration tests.
  - Valued-flag-off `pnpm build:e2e` passed. Quantity-inventory E2E passed 4/4
    across desktop Chromium and Pixel 7; visuals matched 20/20 across both
    themes and viewports without a baseline update.
  - i18n parity passed at 1115/1115 keys, all seam gates passed, and
    `git diff --check` passed.
  - SIE `#OBJEKT` / `#ANTAL` remains the plan-required documented deferral.
    The PR step remains intentionally deferred by the program instruction not
    to touch `main`; neither item blocks technical completion.
  - Concurrent Wave 7 commits did not change the approved Wave 6d
    implementation. See `.superpowers/sdd/w6d-final-gate-sol-review.md`.
- Wave 6e valued-inventory foundation passed its first Sol checkpoint:
  **APPROVE**.
  - Task 6e.1 distinct valued movement contracts: `ad7e6ff`.
  - Task 6e.2 pure active valued-movement projection: `d109e76`.
  - Explicit unit cost and uppercase currency are required; quantity-only
    payloads remain strict and continue rejecting valued fields.
  - Projection replay excludes quantity-only events and superseded values,
    preserves first movement identity, validates wrapper/payload line identity,
    and keeps each row's authoritative UOM without changing Wave 6d
    `(skuId, uom)` quantity balances.
  - TDD RED was observed for both tasks; focused valued tests passed 8/8.
    Contracts/domain typechecks, focused ESLint, Prettier, diagnostics, and
    diff checks passed.
  - Sol independently reran the focused valued tests (8/8), quantity-only
    regression tests (10/10), and contracts/domain typechecks; all passed.
  - No high-confidence valuation, identity, UOM, scope, or premature API/UI
    claim issue was found. No Opus escalation is required. See
    `.superpowers/sdd/w6e-foundation-sol-review.md`.
  - Aggregate tests typecheck is currently blocked only by concurrent Wave 6b
    WIP referencing an unimported `EnrichmentIntentVersionMismatchError` in
    shared conformance. Task 6e.3 is concurrent sibling WIP outside this
    checkpoint; the full Wave 6e gate remains pending.
- Wave 6e Task 6e.3 API + client is ready for Sol review at `38e1b99`.
  - `GET /api/lists/valued-movements` is always available independently of the
    later web feature flag and validates its derived response contract.
  - `AccountingApiClient.getValuedMovementsList()` covers both authenticated
    HTTP and offline-demo replay through the shared valued-list schema.
  - TDD RED observed the missing route (404) and client method; focused valued
    route/domain tests pass 6/6, API + client typechecks pass, and focused
    diagnostics/diff checks are clean.
  - No writer/store behavior changed; Memory/Postgres parity is therefore not
    implicated. UI, full gate, and Wave 6e completion remain pending.
- Wave 6e Task 6e.3 API + client Sol review: **APPROVE**.
  - The always-on route and authenticated HTTP/offline-demo client validate the
    same shared valued-movement list contract and replay only append-only
    events.
  - No writer, store mutation, UI, feature flag, or Wave 6d quantity payload
    changed; the foundation's valuation, identity, UOM, and rounding rules
    remain intact.
  - Fresh focused tests passed 6/6; API client, API, and aggregate tests
    typechecks passed; the implementation diff check passed.
  - Concurrent Wave 6b approval wiring in shared `app.ts` / API-client history
    is outside this verdict and does not block the unchanged valued-list hunks.
  - No Opus escalation is required. Task 6e.4 UI and the full/visual gate remain
    pending. See `.superpowers/sdd/w6e-api-sol-review.md`.
- Wave 6e Task 6e.4 Books UI Sol review: **REQUEST_CHANGES**.
  - Flag-off gating suppresses the valued query and panel; quantity-inventory
    UOM behavior is unchanged, and the read-only UI introduces no writer.
  - The shared money formatter rounds an authoritative `15.555 SEK` unit cost
    to `15.56 SEK` while the projection correctly reports `31.11 SEK` for
    quantity two, making the displayed operands contradict the total.
  - Preserve explicit unit-cost precision and add populated-row regression
    coverage. Web typecheck, focused lint/format, i18n 1115/1115, and diff
    checks passed.
  - No Opus escalation is required. Wave 6e remains NOT COMPLETE pending the
    Task 6e.4 fix and Task 6e.5 full/functional/visual gates. See
    `.superpowers/sdd/w6e-ui-sol-review.md`.
- Wave 6e Task 6e.4 unit-cost precision blocker fixed in `3acc905`; ready for
  Sol re-review.
  - Unit costs preserve their authoritative decimal precision while extended
    amounts continue using normal currency precision, so `15.555 SEK × 2`
    reconciles with the displayed `31.11 SEK`.
  - TDD RED observed the missing precision formatter; focused presentation
    tests passed 5/5, the full unit suite passed 683/683, and web/tests
    typechecks plus focused lint/format checks passed.
  - Unrelated dirty Wave 6b review and projects E2E files were not staged.
    Wave 6e remains NOT COMPLETE; Task 6e.5 full/functional/visual gates are
    still pending.
- Wave 6e Task 6e.4 unit-cost precision Sol re-review: **APPROVE**.
  - The valued panel now preserves the authoritative unit-cost decimals,
    displays quantity without rounding, and keeps the extended amount at
    currency precision; `15,555 SEK × 2 st` reconciles with `31,11 SEK`.
  - Fresh focused presentation tests passed 5/5 and the full unit suite passed
    683/683; the reviewed diff check passed.
  - No high-confidence finding or Opus escalation remains. Task 6e.4 is
    approved specifically, but Wave 6e remains NOT COMPLETE pending Task
    6e.5's full functional E2E and human-reviewed visual gates. See
    `.superpowers/sdd/w6e-ui-unit-cost-sol-rereview.md`.
- Wave 6b deferred functional E2E follow-up Sol re-review: **APPROVE**; Wave 6b
  remains COMPLETE.
  - `tests/e2e/projects-vertical.spec.ts` attached a `project_assignment`
    intent and approved with an empty body. Under the new fail-closed
    semantics that discards the assignment, so the projects panel rendered
    empty on both projects. The spec now echoes the version its attach
    returned; no product code changed.
  - It was the only approving caller that did not name its intent. The review
    edit sheet echoes the version; the queue, dashboard widget, advisor
    `executeReviewApproval`, and demo transport attach a deliberate `noop` and
    correctly omit the assertion.
  - 53/53 approval and enrichment E2E specs pass on desktop and Pixel 7.
  - Sol audited every production approval entry point: the review edit sheet
    echoes the attached version, while queue, dashboard, server advisor, and
    demo advisor paths deliberately attach `noop` before plain approval. No
    enrichment-consuming caller still relies on implicit consume.
  - Fresh focused `projects-vertical.spec.ts` verification passed 2/2 on
    desktop Chromium and Pixel 7; `git diff 56abac1..b684bdd --check` passed.
  - Eight first-pass failures were cross-run contamination, not defects: a
    sibling agent's concurrent Playwright run shared the test API on `:3201`
    and its `resetApiState` wiped state mid-spec. Run only one Playwright
    process against this worktree.
  - The visual suite remains deferred; no baseline was updated. No renewed
    Opus review is required. See
    `.superpowers/sdd/w6b-projects-e2e-intent-sol-rereview.md`.
- Task 6e.5 Wave 6e final gate: **APPROVE; WAVE 6e COMPLETE**.
  - `pnpm check` passed with 683/683 unit tests after normalizing CRLF checkout
    materialization in two already-committed Wave 6b advisor files; the
    normalization produced no source diff.
  - Strict `pnpm db:test` applied migrations `0001`–`0012`, passed every
    capability assertion, and passed 119/119 integration tests.
  - `pnpm build:e2e` passed with the valued flag off and on. Focused valued
    inventory E2E passed 2/2 hidden assertions and 2/2 visible assertions
    across desktop Chromium and Pixel 7.
  - Flag-on visual comparisons passed 20/20 across both themes and viewports.
    Every image matched its baseline; no baseline was updated.
  - Seams passed, i18n remained 1115/1115, and focused quantity/valued schema
    distinction tests passed 9/9.
  - No PR was opened and `main` was not touched. Wave 6d's separately owned
    final gate remains pending, and Waves 7–8 were not started. See
    `.superpowers/sdd/wave-6e-gate-report.md`.
  - Sol independently reran the substantive gates: `pnpm check` 683/683,
    strict `pnpm db:test` 119/119, flag-off/on builds, valued E2E 2/2 hidden
    and 2/2 visible, visuals 20/20, i18n 1115/1115, seams, and schema
    distinction 9/9 all passed. No baseline changed. See
    `.superpowers/sdd/w6e-final-gate-sol-review.md`.
- Wave 7 Tasks 7.1–7.2 first MCP checkpoint is ready for Sol review.
  - Task 7.1 scaffolded the 12th typechecked workspace and an SDK 1.30.0 stdio
    entrypoint in `130a761`.
  - Task 7.2 pinned the 13 proposal/read tool names and documented the
    proposal-only threat boundary in `19dfe4f`.
  - TDD RED failed on missing `initialize_upload`; focused GREEN passed 2/2.
    The MCP package and aggregate tests typechecks, focused ESLint/Prettier,
    diagnostics, and diff checks passed.
  - Tasks 7.3–7.5 remain unstarted. No handler, direct mutation tool, HTTP
    transport, PR, or change to `main` is included in this checkpoint.
- Wave 7 Tasks 7.1–7.2 Sol review: **APPROVE**.
  - The stdio workspace typechecks and the exact 13-name proposal/read surface
    is regression-pinned, including duplicate and forbidden direct-mutation
    exclusions.
  - The threat model preserves server-derived attribution and the existing
    human approval/confirmation gates: MCP creates open-review intents or
    post-post work items and never approves, confirms, or posts.
  - No Task 7.3 handler, Task 7.4 documentation, Task 7.5 gate, or Wave 8 HTTP
    transport is included or claimed complete.
  - Fresh focused verification passed: MCP typecheck, aggregate tests
    typecheck, registry tests 2/2, ESLint, Prettier, and reviewed-range diff
    check.
  - No high-risk auth/mutation hole or escalation is required. Tasks 7.3–7.5
    may continue in plan order. See
    `.superpowers/sdd/w7-foundation-sol-review.md`.
- Wave 7 Task 7.3 MCP handlers are ready for Sol review at `0c16b4f`.
  - `initialize_upload` exposes only an HTTPS SAS URL plus upload/blob
    identity; relative/demo upload URLs fail closed and no base64 body exists.
  - The stdio client requires `ACCOUNTING_API_BASE_URL` and
    `JPX_MCP_BEARER_TOKEN`, forwarding the bearer through the existing
    authenticated API client without sending it to blob storage.
  - Review proposals use the open-review API, map closed-review 409s to a
    structured MCP error, and now atomically echo the exact attached intent
    version. Post-post proposals force `source: "mcp"`, preserve idempotency,
    and stop at `pending_confirmation`.
  - TDD RED observed the missing handler module and missing intent-version
    response. The full unit suite passed 692/692; MCP/contracts/api-client/API
    plus aggregate test typechecks, focused ESLint/Prettier, diagnostics, and
    diff checks passed.
  - No approve, confirm, post, direct tag/reference, HTTP transport, Task 7.4,
    Task 7.5, PR, or `main` change is included.
- Wave 7 Task 7.3 MCP handlers Sol review: **APPROVE**.
  - The handlers call only authenticated existing API routes and expose no
    approval, confirmation, posting, or direct ledger-mutation path.
  - Open-review checks remain store-enforced; the response echoes the exact
    freshly attached intent version, and closed reviews map to a structured
    `review_not_open` conflict.
  - MCP source attribution is forced before the post-post proposal API call;
    actor attribution remains server-derived, and ledger effects still require
    separate human confirmation.
  - Upload initialization returns no file body, rejects relative/demo URLs, and
    exposes only the API-minted HTTPS upload credential plus upload/blob
    identity. API bearer credentials are not used for absolute blob uploads.
  - Fresh independent verification passed: full unit suite 692/692, focused
    MCP/API-client/review-proposal tests 18/18, changed-workspace and aggregate
    test typechecks, focused ESLint/Prettier, and reviewed-range diff check.
  - No auth or mutation hole warrants escalation. Separately staged Task 7.4
    documentation was not reviewed or included in the review commit. See
    `.superpowers/sdd/w7-handlers-sol-review.md`.
- Wave 7 Task 7.4 MCP setup documentation is ready for Sol review at
  `1159a0e`; it is integrated in the approved current branch state `36dfa7d`.
  - `docs/MCP_SETUP.md` documents the Windows stdio launch, required API URL
    and bearer-token environment, exact 13-tool inventory, SAS-only upload
    posture, and Wave 8 HTTP deferral.
  - The setup and repo map state the proposal-only boundary: MCP cannot
    approve, confirm, or post; review proposals echo an opaque intent version
    that the later human approval must match.
  - `docs/REPO_MAP.md` records the twelfth workspace, dependency edge, handler
    locations, tool inventory, and excluded direct-mutation surface.
  - Documentation RED/GREEN was observed with `Test-Path`: absent before the
    task and present afterward. Targeted Prettier and `git diff --check`
    passed.
  - The Task 7.3 review commit landed after the documentation commit in the
    shared branch, so `36dfa7d` is already the current descendant containing
    both; no history rewrite or duplicate cherry-pick was needed.
  - Task 7.5, Wave 8 HTTP transport, PR creation, and `main` remain untouched.
- Wave 7 Task 7.4 MCP documentation Sol review: **REQUEST_CHANGES**.
  - The documented 13 names exactly match `MCP_TOOL_NAMES`, exclude direct
    mutation tools, preserve the human approval/confirmation gates, correctly
    describe the opaque review-intent version, and defer HTTP to Wave 8.
  - The setup behavior does not match the implementation: `src/index.ts`
    connects an empty `McpServer`, constructs no authenticated API client, and
    registers none of the 13 tools. It therefore starts without the documented
    required environment and exposes zero callable tools.
  - Focused MCP tests passed 9/9 and targeted documentation Prettier passed,
    but those tests cover the inventory and three standalone handlers rather
    than stdio registration. See `.superpowers/sdd/w7-docs-sol-review.md`.
- Wave 7 Task 7.4 stdio runtime blocker fixed in `7044967`; ready for Sol
  re-review.
  - The entrypoint now validates `ACCOUNTING_API_BASE_URL` and
    `JPX_MCP_BEARER_TOKEN` before connecting and registers the exact fixed
    13-tool inventory with contract-backed input schemas.
  - All capture/proposal/read tools delegate through the authenticated API
    client. Review proposals still return the API's exact opaque
    `intentVersion`; no approval, confirmation, posting, direct tag, or direct
    external-reference tool was added.
  - TDD RED observed the absent server registry. Focused MCP tests passed
    11/11, MCP/API-client/tests typechecks and focused lint/format passed, and
    direct entrypoint startup without required environment failed closed.
  - Full `pnpm check` passed with 694/694 unit tests. Wave 8, PR creation, and
    `main` remain untouched.
- Wave 7 Task 7.4 stdio entrypoint Sol re-review: **APPROVE**.
  - The entrypoint registers exactly the 13 names pinned by `MCP_TOOL_NAMES`;
    no approval, confirmation, posting, direct-tag, or direct-reference tool is
    exposed.
  - Missing API URL or bearer-token configuration throws before stdio
    connection. All tools delegate through the authenticated API client.
  - Review proposals preserve the exact opaque `intentVersion`; MCP cannot
    consume it, approve the review, or confirm post-post work.
  - The setup and repo-map documentation now match the callable stdio surface
    and continue to defer Streamable HTTP to Wave 8.
  - Fresh focused verification passed: MCP tests 11/11, MCP/API-client/tests
    typechecks, direct fail-closed startup, and reviewed-range diff check. The
    implementer full gate remains green at 694/694 unit tests.
  - See `.superpowers/sdd/w7-entrypoint-sol-rereview.md`.
- Task 7.5 Wave 7 final gate: **PASS; ready for Sol's COMPLETE decision**.
  - Fresh `pnpm check` passed with 694/694 unit tests, lint, i18n, formatting,
    all 12 workspace typechecks, aggregate test typecheck, and production
    web/API builds.
  - Focused inventory, handler, and stdio registration tests passed 11/11.
    Registration is exactly the fixed 13-tool surface and startup fails closed
    before stdio connection without either required environment variable.
  - Manual mutation-entrypoint tracing confirmed that MCP imports no store or
    domain mutation implementation. All tools delegate through the
    authenticated API client; ledger-affecting proposal calls stop at an open
    review intent or pending confirmation work item.
  - No store, migration, database, web UI, or browser workflow changed, so
    `pnpm db:test`, E2E, and visual gates were not required by Task 7.5. No
    visual baseline was updated.
  - No PR was opened, `main` was not touched, and Wave 8 was not started. See
    `.superpowers/sdd/wave-7-gate-report.md`.
- Wave 7 final Sol gate: **APPROVE — WAVE 7 COMPLETE**.
  - Fresh independent `pnpm check` passed with 694/694 unit tests, lint, i18n,
    formatting, all 12 workspace typechecks, aggregate test typecheck, and
    production web/API builds.
  - Fresh wired MCP tests passed 11/11 across inventory, handlers, and stdio
    registration.
  - The prior zero-tool `REQUEST_CHANGES` remains closed: the entrypoint
    validates API URL and bearer token before stdio connection and registers
    exactly the fixed 13-tool inventory.
  - Mutation-entrypoint tracing remains clean: no ledger store or domain
    mutation implementation is imported, and proposal tools stop at the
    existing human approval or confirmation gates.
  - `pnpm db:test`, E2E, and visual gates were not required because Wave 7
    changes no store, migration, web UI, or browser workflow.
  - No PR was opened, `main` was not touched, and Wave 8 was not started. See
    `.superpowers/sdd/w7-final-gate-sol-review.md`.
- Wave 8 Task 8.1 first HTTP checkpoint is ready for Sol review at `0ae028f`.
  - Added the bounded TTL session store and `/api/mcp` POST + GET adapter; v1
    registers no DELETE route.
  - Initialize issues `Mcp-Session-Id`; later JSON-RPC supports
    `notifications/initialized`, `tools/list`, and `tools/call`, with typed
    protocol errors and request-ordered buffering capped at 100 events.
  - HTTP reuses the exact 13 proposal/read tools from Wave 7. Per-request
    bearer credentials are forwarded only through the existing API client;
    no approve, confirm, post, or direct-mutation MCP tool was added.
  - TDD RED observed the missing adapter and out-of-order concurrent buffering.
    Focused MCP tests passed 19/19; MCP/API/tests typechecks passed; the full
    unit suite passed 702/702 before commit.
  - Task 8.2 Origin/Host/JWT/rate-limit/RFC 9728 security work, Task 8.3 demo
    stub retirement, and Task 8.4 live SSE resumption remain unstarted. Wave 8
    and the overall program are NOT COMPLETE; stop here for Sol review.
- Wave 8 Task 8.1 Streamable HTTP adapter Sol review: **REQUEST_CHANGES**.
  - The per-session SSE event ring is capped at 100 and serialized operations
    preserve accepted request order, but the session map itself has no capacity
    bound.
  - Expired sessions are removed only when their exact ids are queried, so
    repeated abandoned `initialize` requests can retain sessions indefinitely;
    TTL alone does not bound process memory.
  - Add a configured maximum session count plus expiry sweep/capacity behavior
    and regression coverage. POST/GET routing and the unchanged 13-tool
    proposal/read-only boundary were otherwise verified; no ledger mutation
    entrypoint was added.
  - Fresh focused HTTP adapter tests passed 8/8; the implementer records focused
    MCP 19/19 and full unit 702/702. No packaged escalation is required because
    this is a localized capacity defect, not authentication bypass, session
    hijack, or ledger mutation.
  - Task 8.1 remains unapproved pending repair. Task 8.2 sibling work may
    continue in disjoint files. See
    `.superpowers/sdd/w8-http-adapter-sol-review.md`.
- Wave 8 Task 8.1 bounded-session blocker repaired; ready for Sol re-review.
  - Session creation proactively sweeps expired entries and enforces a
    configurable hard maximum of 1,000 sessions by default.
  - At capacity, the next-expiring live session is evicted deterministically;
    the existing 100-event per-session ring remains unchanged.
  - TDD RED observed the missing capacity eviction. Focused HTTP adapter tests
    passed 9/9; MCP/API/tests typechecks, focused Prettier, diagnostics, and
    diff checks passed.
  - Concurrent Task 8.2 security work was preserved and not staged by this
    repair. Wave 8 remains NOT COMPLETE pending Sol re-review and Tasks 8.2+.
- Wave 8 Task 8.2 HTTP security boundary is ready for Sol review at `9283ffb`.
  - POST and GET `/api/mcp` reject missing or disallowed origins and hosts
    before invoking the adapter, covering the DNS-rebinding boundary.
  - MCP POST continues through the existing JWT and subject/IP-keyed mutation
    limiter middleware; RFC 9728 protected-resource metadata advertises only
    header bearer authentication.
  - `/ready` remains the unchanged ledger/AI/blob/DocIntel readiness probe.
    The exact 13 proposal/read-only tools, human confirmation gates, opaque
    intent-version echo, and no-posting boundary remain regression-pinned.
  - TDD RED observed missing guards and metadata. After integrating the Task
    8.1 capacity repair `0bebe8a`, focused MCP tests passed 25/25 and MCP, API,
    and aggregate tests typechecks passed. Task 8.3+ and Wave 8 completion
    remain deferred for Sol review.
- Sol re-review approves Wave 8 Tasks 8.1 and 8.2.
  - Task 8.1: **APPROVE** — creation-time expiry sweeping plus the hard
    session-count cap bounds abandoned-session retention; the 100-event
    per-session ring remains intact.
  - Task 8.2: **APPROVE** — Origin/Host guards, inherited JWT and POST rate
    limiting, RFC 9728 metadata, unchanged readiness semantics, and the fixed
    13-tool proposal/read-only boundary match the plan and threat model.
  - Fresh focused MCP adapter/security/inventory/registration tests passed
    20/20; MCP, API, and aggregate tests typechecks passed; reviewed diffs pass
    `git diff --check`.
  - See `.superpowers/sdd/w8-session-security-sol-review.md`. Tasks 8.3+ remain
    deferred; Wave 8 is not yet complete.
- Wave 8 Task 8.3 demo MCP stub retirement is ready for Sol review at
  `85045e2`.
  - Removed the legacy demo-only `POST /mcp`; the authenticated and guarded
    `POST /api/mcp` Streamable HTTP initialization path remains available.
  - The exact 13 proposal/read-only tools, explicit human approval and
    confirmation gates, opaque intent-version handling, and bounded HTTP
    sessions are unchanged.
  - TDD RED observed the legacy route returning 200 instead of 404. Focused
    API/MCP tests passed 50/50; API and aggregate tests typechecks, focused
    ESLint/Prettier, diagnostics, and diff checks passed.
  - Task 8.4+, PR creation, and `main` remain deferred. Wave 8 is NOT COMPLETE;
    stop here for Sol review.
- Sol review requests changes on Wave 8 Task 8.3 at `a5e9450`.
  - The production change is sound: legacy `/mcp` is gone, guarded `/api/mcp`
    remains under the JWT/rate-limit/Origin/Host boundary, and the fixed 13-tool
    proposal/read-only inventory exposes no approval, confirmation, posting, or
    direct-ledger mutation entrypoint.
  - **P1:** `tests/e2e/api.spec.ts` still required the deleted demo `/mcp`
    response to return 200.
  - See `.superpowers/sdd/w8-legacy-mcp-sol-review.md`.
- Wave 8 Task 8.3 E2E repair Sol re-review: **APPROVE** (Composer substitute;
  Sol API rate-limited) at `9597caa`.
  - The prior P1 is closed: legacy `POST /mcp` now asserts 404 and guarded
    `POST /api/mcp` JSON-RPC `initialize` sends the required Origin, Host,
    Accept, and session-header contract.
  - Production stub retirement in `85045e2` is unchanged; unit
    `api-runtime.test.ts` still pins legacy 404 plus guarded initialize 200.
  - Implementer record: `pnpm build:e2e` and focused Playwright `api.spec.ts`
    passed 1/1 (mobile skipped). Composer independently reran
    `api-runtime.test.ts` 23/23.
  - Task 8.3 is approved. Task 8.5, PR creation, and `main` remain deferred.
    Wave 8 is NOT COMPLETE. See
    `.superpowers/sdd/w8-legacy-mcp-sol-rereview.md`.
- Wave 8 Task 8.4 session SSE resumption: **APPROVE** (Composer substitute;
  Sol API rate-limited) at `b18293c`.
  - GET `/api/mcp` replays buffered events after `Last-Event-ID`, subscribes
    open streams for later session events, and unregisters on client cancel.
  - Integration coverage exercises the real guarded API route, the exact
    13-tool proposal/read-only boundary, forbidden approval/confirmation/post
    names, replay, and live delivery. Human approval boundaries and bounded
    session/event stores remain unchanged.
  - Fresh focused MCP HTTP integration + adapter + security tests passed 18/18.
  - Task 8.3 E2E repair remains a separate sibling gate at `9597caa`. Task
    8.5, PR creation, and `main` remain deferred; Wave 8 is NOT COMPLETE.
  - See `.superpowers/sdd/w8-sse-resume-sol-review.md`.
- Task 8.5 Wave 8 final gate: **PASS; ready for COMPLETE review** at `cda9ca4`.
  - `pnpm check` passed with 711/711 unit tests; strict `pnpm db:test` applied
    migrations `0001`–`0012`, passed every capability assertion, and passed
    121/121 integration tests including MCP HTTP SSE.
  - Focused MCP adapter/security/integration plus Wave 7 stdio regression passed
    29/29; `api-runtime.test.ts` passed 23/23 (legacy `/mcp` 404).
  - Seams passed, i18n remained 1115/1115, and `git diff --check` passed.
  - `docs/MCP_SETUP.md` and `docs/REPO_MAP.md` now document Streamable HTTP
    POST+GET `/api/mcp`, session headers, Origin/Host guards, RFC 9728 metadata,
    and explicit no DELETE in v1.
  - E2E/visual gates were not required by Task 8.5; Task 8.3 E2E remains at
    `9597caa`. No visual baseline was updated. No PR was opened and `main` was
    not touched. See `.superpowers/sdd/wave-8-gate-report.md`.
- Wave 8 final Sol-style gate: **APPROVE — WAVE 8 COMPLETE** (Composer
  substitute; Sol API rate limit).
  - Fresh independent `pnpm check` and strict `pnpm db:test` (121/121) passed.
  - Fresh focused MCP tests passed 29/29; `api-runtime.test.ts` passed 23/23;
    seams passed; `git diff --check` clean.
  - Task 8.5 documentation and security checklist verified against plan Steps
    1–4. Prior Tasks 8.1–8.4 approvals remain closed.
  - Plan Step 5 PR (`wave-8/mcp-streamable-http` → `main`) deferred per program
    instruction — the expected next action when merge is authorized. All 80
    numbered plan tasks (Waves 0–8) are technically complete on this branch.
  - No PR was opened and `main` was not touched. See
    `.superpowers/sdd/w8-final-gate-sol-review.md`.

- Program wrap-up final gate: **PASS** at `fcfca5d` (2026-08-09).
  - Worktree clean; no fix commits required.
  - `pnpm check` passed 711/711 unit tests, lint, i18n 1115/1115, formatting,
    all workspace typechecks, and production web/API builds.
  - Strict `pnpm db:test` applied migrations `0001`–`0012`, passed every
    capability assertion, and passed 121/121 integration tests.
  - `pnpm build:e2e` passed. Full functional E2E (`--grep-invert "visual:"`)
    passed 190/190 with 22 expected skips and 0 failures (single Playwright
    process; no port-3201 contamination).
  - Visual regression passed 20/20 across desktop and Pixel 7 in light/dark;
    every image matched its baseline; no baseline was updated.
  - PR to `main` opened as the authorized program handoff (Task 8.5 Step 5).
    See `.superpowers/sdd/program-wrap-up-gate.md`.

## Pending

- None — Waves 0–8 and program wrap-up gates are complete on this branch.
