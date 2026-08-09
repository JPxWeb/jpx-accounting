# Wave 6b Opus review — approval-intent consume race

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Escalation answered: `w6b-invoice-seam-sol-rereview.md` (`b467729`),
`NEEDS_OPUS_REVIEW` on "[95] Approval does not identify the intent the reviewer
saw". Sol's parallel implementation brief
(`w6b-intent-consume-race-sol-brief.md`) reaches the same shape; this review
confirms it and records what actually landed.

Reviewed and landed: `5ec5169` (contracts, domain, both stores, migration
`0012`, review sheet, unit + conformance tests) and the API / api-client half of
the same repair, which a concurrent Wave 6e commit collision carried in under
the misleading message `11e69d9 docs(sdd): prepare Wave 6e API review`. Those
are ONE Wave 6b change; see "Commit hygiene" below.

Verdict: **race CONFIRMED — fix designed, implemented, and verified**.
Wave 6b remains **NOT COMPLETE** pending Sol re-review.

`NEEDS_OPUS_REVIEW`: cleared for this finding. No further Opus escalation is
requested; no alternative seam was built.

## 1. The race is real

Confirmed against the pre-fix code, not inferred. Before this repair the
approval path read the intent by review id only:

```
const proposals = input.clearEnrichmentIntent ? [{ kind: "noop" }] : intent?.proposals;
```

`clearEnrichmentIntent` was derived from `input.enrichmentIntent !== "consume"`,
a bare boolean assertion carrying no identity. The exploitable interleaving:

1. Reviewer A opens the review edit sheet, fills the invoice fields, submits.
   The sheet attaches intent A (`attachReviewEnrichmentIntent`).
2. Before A's approval transaction reads the row, a second producer upserts
   intent B for the same open review. Four such producers exist today:
   `POST /api/review-proposals` (MCP), the advisor's `executeReviewApproval`,
   a second browser tab, and a second human reviewer.
3. A's approval arrives with `enrichmentIntent: "consume"`.
4. The decision transaction reads the CURRENT row — B — and appends B's
   companion events beside A's posting.

Severity is high because the output is an immutable append on the hash chain:
an `InvoiceRegistered` (or `TripRegistered`, or `InventoryMovementRecorded`)
event, attributed to A, for a proposal A never saw. That is a direct breach of
"AI suggests, never mutates" — the human approval gate is the ONLY path to a
posted voucher, and it was approving unseen content. The Postgres advisory lock
does not help: it serializes the writes, it does not bind the approval to a
specific intent. A public client could also POST `"consume"` against any
pre-existing intent with no prior attach at all.

The two `attachReviewEnrichmentIntent` calls in `review-queue-widget.tsx` and
`review-queue-view.tsx` did not close this either — they overwrite the intent
with a `noop` _before_ approving, which is fail-closed for the queue path but
does nothing for the edit-sheet path that actually carries proposals.

## 2. Design (as landed)

Optimistic concurrency on the existing Wave 5 pre-post intent path. No second
seam, no new mutation entry point, no `registerInvoice()` on the approval path.

- Every `attachReviewEnrichmentIntent` mints a **fresh** opaque token
  (`createId("rei")`) and returns it on the intent. The row is replaced, not
  versioned in place, so any replacement invalidates every token handed out
  before it.
- `reviewDecisionInputSchema.enrichmentIntent` becomes a discriminated union:
  `{ mode: "consume", version }` or `{ mode: "clear" }`. It is now
  _structurally impossible_ to assert "I saw the intent" without naming which
  one — the old bare `"consume"` string no longer parses.
- The API translates a `consume` decision into the server-only approval gate
  `consumeEnrichmentIntentVersion`. Client-supplied gate fields remain
  impossible: `ApprovalGate` is not part of the wire contract.
- One shared resolver, `resolveConsumableIntentProposals` in
  `packages/domain/src/store-shared.ts`, decides what an approval may append:

  | request                        | attached intent | outcome                                                   |
  | ------------------------------ | --------------- | --------------------------------------------------------- |
  | no assertion                   | any / none      | `[noop]` — post, append no enrichment, discard the intent |
  | `clear`                        | any / none      | same as no assertion                                      |
  | `consume` + matching version   | that intent     | append exactly its proposals                              |
  | `consume` + stale/forged token | any / none      | `EnrichmentIntentVersionMismatchError`                    |

- The mismatch is a typed failure mapped to HTTP 409
  `{ code: "enrichment_intent_stale" }`, not a 500. The review stays open, the
  replacement intent survives, and the reviewer can reload and decide against
  what is actually attached. 409 matches the sibling `review_blocked` /
  `review_not_open` lifecycle conflicts rather than payload validation.

Fail-closed on omission is the important half: a caller that forgets the field
(future approve-with-edits surfaces, MCP, advisor, direct API) can never append
enrichment, it can only discard it.

## 3. Implementation review

**Atomicity — Memory.** `resolveConsumableIntentProposals` runs after
`planReviewDecision` and before any `this.reviews.set` / `appendEvent`, so the
throw leaves the read models and the event log untouched.

**Atomicity — Postgres.** The resolver runs inside `client.begin`, after
`lockWorkspaceTail` (the `pg_advisory_xact_lock`) and the intent `SELECT`, and
before the first `appendEvent`. A throw aborts the transaction: zero events,
review still `needs-review`, intent row still present.
`attachReviewEnrichmentIntent` takes the same advisory lock, so attach and
decide are serialized against each other — there is no window between the
version read and the row DELETE. `withChainForkRetry` only retries `23505` fork
violations, so the typed mismatch is not swallowed or retried.

**Store parity.** Both stores call the same resolver with the same arguments
and the same `noop` fallback; behavior is pinned by shared conformance
(section 5), not by two parallel implementations.

**Replay safety.** `planReviewDecision` still returns `replay` for an
already-decided review _before_ the resolver runs, so a retried approval of an
approved review replays idempotently instead of 409-ing on a consumed token.

**UI.** `review-edit-sheet.tsx` attaches at submit and echoes the version the
server just minted, so the approval is bound to the proposal built from the
reviewer's own form state. That is the correct binding: the reviewer approves
what they filled in, and anything that lands in between forces a visible 409
instead of a silent substitution.

**Demo/offline parity.** `packages/api-client` translates the same wire field
into the same gate for the `MemoryLedgerStore` fallback, so the offline demo
path does not fail open.

### Finding fixed during this review

**[85] Migration `0012` backfilled a guessable token.** The original backfill
wrote `'rei_legacy_' || review_id`. The review id is in the request URL, so any
client could reconstruct a "legacy" token and consume a pre-migration intent it
never saw — the exact hole the change exists to close, left open for exactly
the rows the comment claimed to protect. Now backfills
`'rei_legacy_' || gen_random_uuid()` (core since PG 13; the repo requires
PG 15+). Migration remains idempotent: `add column if not exists`, a
`where version is null` update, then `set not null`.

### Non-blocking notes for the owner

1. **[50] A stale token also blocks `reject`.** The resolver runs before the
   `action !== "reject"` branch, so a reject carrying a stale version 409s even
   though rejecting appends no enrichment. Unreachable today (the API only
   forwards the version for `consume`, and no reject surface sends it), and
   fail-closed when reached. Loosen only with a test.
2. **[45] The queue/dashboard/close `noop` attaches are now redundant** and
   mildly destructive: they overwrite a pending MCP/advisor proposal before
   approving, where simply omitting the assertion already discards it
   fail-closed. Harmless, worth removing when that code is next touched.
3. **[40] The 409 message is English**, consistent with every other domain
   error in the repo (`ReviewBlockedError`, `EnrichmentIntentClosedError`), so
   no i18n key was added. If Sol wants a Swedish reviewer-facing string, it
   belongs in the sheet's error mapping, not in the domain error.

## 4. Commit hygiene (needs Sol's awareness)

This worktree had three agents committing concurrently. Two collisions
affected this repair and neither lost content, but the history is misleading:

- Wave 6e commit `38e1b99 feat(api): expose valued inventory movements list`
  swept up the then-uncommitted Wave 6b changes to `services/api/src/app.ts`
  and `packages/api-client/src/index.ts`.
- `lint-staged`'s stash/restore then reverted those two files inside `5ec5169`,
  and the restore landed in the next agent's commit,
  `11e69d9 docs(sdd): prepare Wave 6e API review`.

The **tree** is correct and was verified after the fact (`git diff HEAD` clean,
`pnpm typecheck` and `pnpm typecheck:tests` green). No history rewrite was
attempted while other agents were committing. Read the Wave 6b repair as
`5ec5169` plus the `app.ts` / api-client hunks of `11e69d9`.

## 5. Verification

- `pnpm typecheck` — 11/11 workspaces PASS.
- `pnpm typecheck:tests` — PASS (this also clears the aggregate-typecheck
  blocker the Wave 6d/6e checkpoints reported against this WIP).
- Focused intent suite — 30/30 PASS across
  `review-enrichment-intent-store`, `-route`, `-contracts`,
  `api-client-enrichment`, `pre-post-enrichment-planning`.
- Strict `pnpm db:test` — disposable `jpx_test_*`, migrations `0001`–`0012`,
  **119/119 PASS**, including the new
  `enrichment intent consume race fails closed` scenario on Memory, on
  Postgres, and as an explicit Memory/Postgres parity assertion.

New coverage proving the escalation is closed:

- Conformance `scenarioEnrichmentIntentConsumeRace`: A attaches → B replaces →
  A's consume is refused with zero event delta, the review stays open, B's
  intent survives; a following plain approval posts exactly once and appends no
  `InvoiceRegistered` for B's unseen supplier.
- `scenarioPrePostEnrichmentSinglePosting` extended: a superseded version is
  refused, and only the replacement's version consumes.
- API: replaced-intent consume → 409 `enrichment_intent_stale` with the request
  id, zero events, review still open; forged token → 409; omitted assertion →
  200 with one posting, no registration, intent discarded.
- Contracts: an intent without a version fails to parse, and
  `{ mode: "consume" }` without a version is unrepresentable.

**Not run:** `pnpm build:e2e` + invoice E2E and the visual suite. The review
sheet's submit path changed shape (attach now returns a value the approval
echoes), so both should be re-run once the concurrent Wave 6d/6e file churn
settles — running them against a worktree three agents are writing to would
produce noise, not signal.

`pnpm check` currently stops at `format:check` on two committed Wave 6e files
outside Wave 6b ownership (`services/api/src/routes/lists-valued-movements.ts`,
`tests/unit/lists-valued-movements-route.test.ts`). Wave 6b files are
Prettier-clean. That gate belongs to the Wave 6e owner.

## 6. Gate conditions for Wave 6b

1. Approval consumes only the intent whose version it echoes — **met**.
2. Mismatch fails closed with zero appended events in both stores — **met**,
   proven by parity conformance.
3. Typed 409 rather than an opaque 500, review left open — **met**.
4. Omission remains fail-closed — **met**, and now unrepresentable otherwise.
5. Memory/Postgres parity plus API coverage for missing/forged/stale tokens —
   **met**.
6. Migration additive, idempotent, and fail-closed for pre-existing rows —
   **met after the `gen_random_uuid()` fix**.
7. Invoice E2E and visual re-run — **open**, deferred to the centralized gate.

Wave 6b is **NOT COMPLETE**. No PR was opened, `main` was not touched, and no
Wave 6e behavior was implemented by this review.
