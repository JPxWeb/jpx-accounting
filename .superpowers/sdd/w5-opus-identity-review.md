# Wave 5 Opus identity review

**Date:** 2026-08-09
**Reviewer:** Opus (focused identity/architecture review)
**Scope:** ledger-line identity only — `JournalEntryProjection.id` / `lineId`, legacy
identity derivation, posted-target validation, and line-enrichment supersession under
append-only. Not a full Wave 5 code review.
**Base reviewed:** `7a41d0e` (Sol APPROVE_WITH_FIXES), with `9f978e9` (sibling Task 5.2)
present in the worktree.
**Verdict:** APPROVE_WITH_FIXES — the two fixes below are applied in this branch.

## Verdict summary

The identity model is sound: `JournalEntryProjection.id` is still the required positional
`journal_${n}` row key, `lineId` is additive and optional, posted payloads are never
rewritten, and supersession is serialized behind the workspace advisory lock in Postgres.
Sol's production-replay fix is correct. One high-severity latent defect and one medium
append-only replay defect were found and fixed.

## Findings

### H1 — Two divergent derivations of the same legacy identity (High, FIXED)

`buildJournal` accepted an optional `context.eventIdByLineIndex` and derived
`legacy_${eventId}_${index}` from the **journal-wide** row index, while
`collectLedgerLinesFromEvents` (the production path Sol added) and
`collectPostedEnrichmentTargets` (the target guard) both derive it from the
**event-local** line index. Two producers, one identity namespace.

This is worse than a mismatch. When a line-carrying event starts at journal-wide offset
`k` and carries `m` lines with `0 < k < m`, the context path emits ids that are valid
posted targets **belonging to a different line of the same event**. `MemoryLedgerStore`
prepends 3 demo seed lines (`k = 3`), so any imported voucher with more than 3 lines
lands squarely in that window: the row for event-local line 0 would render
`legacy_E_3`, which `assertEnrichmentTargetPosted` happily accepts as the identity of
event-local line 3. A confirmed enrichment would attach to the wrong ledger line and pass
every existing guard.

No production caller passed `context` — the parameter was exercised only by unit tests —
so nothing shipped mis-targeted. But Task 5.9 activates `lineId` in the UI, and the plan's
Task 5.6 sketch invites exactly this wiring.

**Fix:** removed the `context` parameter. `collectLedgerLinesFromEvents` is now the only
producer of legacy identity, carrying it as private projection metadata that `buildJournal`
reads back. The identity rule is documented at both sites. Tests were rewritten to drive
the collector, plus two new regressions: one proving the event-local index survives a
journal-wide offset, and one proving every projected `lineId` is a member of
`collectPostedEnrichmentTargets(...).postedLineIds` for the same event stream.

### M1 — Stale supersession rewrote the first supersession's attribution (Medium, FIXED)

`buildLineEnrichmentsFromEvents` applied every `LineEnrichmentSuperseded` naming a known
prior, including a prior that was already superseded. Replaying a second such event
overwrote `supersededAt`, `supersededBy`, and `replacementEnrichmentId` on the prior — the
audit fields that link an enrichment to its actual replacement. The planner blocks this on
the write path (`findActiveLineEnrichment`), so a store-mediated stream cannot produce it,
but the projection is also the read model for any replayed or externally supplied stream,
and silently rewriting who superseded what is exactly the mutation append-only forbids.

**Fix:** first supersession wins; a later event naming an already-superseded prior is
ignored. Regression test pins the original actor, timestamp, and replacement id.

## Confirmed correct (no change)

1. **`JournalEntryProjection.id` preserved.** Required in `journalEntryProjectionSchema`,
   always `journal_${index + 1}`, never a `legacy_*` or `ln_` value. `lineId`, `vatCode`,
   and `deductible` are additive and optional — a pre-Wave-5 client still parses.
2. **Legacy identity touches only the `lineId` field.** `collectLedgerLinesFromEvents`
   spreads the payload line into a new object and attaches the legacy id under a module-private
   `Symbol`; historical payloads keep no `lineId` own-property (pinned by test). A payload
   `ln_` id always wins.
3. **Production replay and target validation agree.** Both stores now retain the event id:
   Postgres selects `id` in `collectLedgerLines` (`ORDER BY seq ASC`) and in
   `loadPostedEnrichmentTargets`; Memory passes `this.events` directly. Same event, same
   payload order (jsonb preserves array order), same event-local index — so a legacy id
   rendered in the journal is precisely the id the guard accepts.
4. **Supersession requires an active prior on the same line,** and in Postgres the check
   runs inside the transaction **after** `lockWorkspaceTail(tx)`, so two concurrent
   supersessions of one prior cannot both observe it as active. Memory matches by
   construction. Both stores load the same event set, and confirmation emits
   `LineEnrichmentSuperseded` then `LineEnrichmentRecorded` — never `PostedToLedger`.
5. **No posted-ledger invariant is touched.** Every line-enrichment arm appends only
   enrichment events against `aggregateId = lineId`; `buildPostingLines` remains the sole
   producer of `ln_` ids, assigned server-side.

## Residual risks accepted (no change this pass)

- **`legacy_*` namespace is trusted, not reserved.** `collectPostedEnrichmentTargets`
  accepts any string `lineId` found in a posting payload. Today no path lets a client
  supply one (posting lines are server-built; SIE import lines carry no `lineId`), so the
  namespace cannot be shadowed. If an importer ever accepts caller-supplied line ids,
  reject `legacy_`-prefixed values at that boundary.
- **`buildExternalReferencesFromEvents` has the same stale-overwrite shape** for a repeat
  `ExternalReferenceRemoved` (pre-existing, Wave 3; write path guarded by
  `findActiveExternalReference`). Out of scope here; worth the same first-wins treatment
  when that projection is next touched.
- **`loadPostedEnrichmentTargets` reads every posting payload** on each propose/confirm.
  Correct, but O(all postings) per mutation — revisit if enrichment volume grows.

## Constraints Task 5.9 must honor

1. **Gate enrichment affordances on `lineId` presence.** The 3 demo seed lines have no
   `lineId` and no posting event, so `voucher_seed_1` is not a posted target either — a
   proposal against a seed row fails with `EnrichmentTargetNotPostedError`. Render the
   affordance disabled rather than surfacing a 4xx.
2. **Never use `id` as an enrichment target.** `journal_${n}` is positional and shifts
   with period filters and new postings; `lineId` is the only stable identity.

## Verification

- Focused identity suites (`build-journal-line-id`, `line-enrichment-planning`,
  `enrichment-planning`, `journal-projection-schema`, `line-id-posting`): 22/22 passed.
- Full `pnpm test:unit`: 583/583 passed.
- `@jpx-accounting/domain`, `@jpx-accounting/persistence-postgres`, and tests typechecks
  passed; Prettier and IDE diagnostics clean on changed files.
- `pnpm db:test`, the Wave 4 gate, and E2E were not re-run — no store, migration, or UI
  file changed in this review.

## Clearance

- **Store wiring Tasks 5.2 / 5.3 / 5.10: may continue.** Nothing found blocks them; the
  `buildJournal` signature change touches no store call site (both stores already call it
  with lines only).
- **Task 5.9: unblocked**, subject to the two constraints above.
- **Wave 6 verticals, Wave 7/8 MCP work, and any PR to `main`: still blocked.**
