# Wave 6c Opus Review — atomic trip approval → registration/enrichment seam

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed: Sol's `NEEDS_OPUS_REVIEW` escalation (`97be5a3`,
`.superpowers/sdd/w6c-trips-ui-sol-review.md`) against `5f94a94`, `dcfe672`, and the
**uncommitted working tree**, in which the Wave 6c trips fix agent had already
implemented the seam (contracts, planner, both stores, conformance, review sheet,
E2E) while the Wave 6b invoice fix agent was concurrently writing the same files.

Verdict: **REQUEST_CHANGES** — design **APPROVED**, implementation substantially
correct, one defect fixed during this review, one defect that must land before the
gate, four that must be fixed or explicitly deferred.

---

## 1. Answering the escalation

### Sol's decision is upheld: pre-post trip fields need the atomic seam

Sol was right that the committed `5f94a94` discarded every trip field: `handleSubmit`
built only a `project_assignment` proposal, so purpose, traveler, dates and evidence
never reached `attachReviewEnrichmentIntent()` or `approveReview()`. The E2E did not
substantiate the pre-post path — it filled the fields, pressed Escape, and approved
through an empty API request.

### The seam Sol asked for is the Wave 5 pre-post intent path, not a new mechanism

This is the same answer the Wave 6b Opus review gave, and the trips fix agent reached
it independently. `attachReviewEnrichmentIntent(reviewId, proposals)` stores a pre-post
intent against a review that must still be `needs-review`; `applyReviewDecision` reads
that intent **inside** the decision transaction, feeds it to `planPrePostEnrichment`,
and merges the companions into the single `ReviewDecisionPlan`. Every event appends in
one pass and the intent row is deleted — in Postgres inside the same `client.begin(...)`
that already took `pg_advisory_xact_lock` before the tail read, wrapped in
`withChainForkRetry`; in Memory synchronously.

Sol's specific requirements are all met by the in-flight implementation:

- **Server-derived identity** — `tripId` is `createId("trip")` inside the planner. The
  planner is re-entrant, so a Postgres chain-fork retry rolls back and re-plans; a
  regenerated id cannot double-register.
- **Real eligible posted `lineId`** — `findPrimaryCostLine(input.postingLines)`, the same
  helper the project/invoice/inventory branches use.
- **Packet-bounded evidence** — validated against the voucher's packet, threaded from
  both stores (Memory: `evidencePackets.get(voucher.evidencePacketId)`; Postgres: a
  `ledger.evidence_packet_items` read inside the same transaction).
- **One `PostedToLedger` + `TripRegistered` + companion enrichment, atomically** —
  `mergePrePostEnrichmentsIntoReviewDecisionPlan` still refuses companions containing
  `PostedToLedger` and requires exactly one in the base plan.
- **Human approval preserved** — registration happens only as a companion to a human
  `approve` / `book-without-vat`, never on `reject`, never from the advisor path.

**Clearance: the seam is approved as built. No alternative seam should be created, and
`registerTrip()` must not be called from the approval path.**

### Things that are already right — do not "re-fix" them

Verified against the installed Zod and by executing the domain projection, not by recall:

- The refined `tripRegistrationProposalSchema` **does** work as a `z.discriminatedUnion`
  arm. A forged `tripId` is stripped, and the `startDate <= endDate` refinement fires at
  the API boundary through `attachReviewEnrichmentIntentInputSchema` — so reversed dates
  are a `400 validation_error`, not the raw-`ZodError`-to-500 path.
- The companion enrichment payload carries the **full** registration, which is required
  and easy to get wrong. `buildTripsList` `safeParse`s enrichment payloads against
  `tripLineEnrichmentPayloadSchema` and `continue`s on failure, so copying the invoice
  branch's minimal `{ invoiceId, direction }` shape here would have produced a trip stuck
  at `expenseTotal: 0` forever, with no error anywhere. The implementer avoided this.
- `assertPrePostEnrichmentIntentSupported` now treats `trip_registration` as a singleton
  kind, and the proposals arrays are bounded — so one approval cannot append N trips.
- The stale-intent hazard raised as Wave 6b §2.1 is closed on both axes: the sheet always
  attaches an explicit intent (`[proposal ?? { kind: "noop" }]`), and a plain queue
  approve clears it via `clearEnrichmentIntent`. See §3.4 for the residual coupling.
- Actor attribution is server-derived throughout; the proposal contract carries no
  `actorId`, no `tripId`, no amount.
- `scenarioTripReviewApproval` is registered in the conformance suite for both stores.

---

## 2. Fixed during this review

### [FIXED] 2.1 `buildTripsList` double-counted a posted line's expense — [95]

`packages/domain/src/workflows/trips.ts` added the bound line's amount once **per active
`trip` enrichment**, with no dedupe. Now that a trip can be attached both pre-post (the
new approval seam) and post-post (the work-item path the shipped E2E exercises), the same
posted line legitimately carries two active `trip` enrichments for the same trip — and the
trip's `expenseTotal` doubled.

Measured on a 1 000 kr posted line before the fix:

| events                                            | reported `expenseTotal` |
| ------------------------------------------------- | ----------------------- |
| one trip, one enrichment                          | 1 000                   |
| one trip, two active enrichments on the same line | **2 000**               |

The events are immutable, so the inflated total is permanent and can only be papered over
by superseding an enrichment.

**Fix applied:** a posted line now contributes to a given trip at most once, tracked by a
`(tripId → lineIds)` set. Distinct lines still accumulate. Two regression tests added to
`tests/unit/trips-list.test.ts`; the file passes 6/6, the domain package typechecks, and
lint is clean. The existing supersede semantics are untouched.

---

## 3. Findings that must land before the Wave 6c gate

Confidence scores in brackets.

### [IMPORTANT] 3.1 Both trip planner refusals surface as HTTP 500 — [90]

`TripRegistrationLineNotFoundError` and `TripEvidenceNotInPacketError` are thrown by the
planner and exported from `packages/domain`, but `app.onError` has **no branch for
either**. They fall through to the generic `500 "Unexpected server error."` Every sibling
vertical got a mapped 422 in the same sweep — `invoice_registration_line_not_found`,
`invoice_registration_amount_invalid`, `inventory_movement_line_not_found`,
`enrichment_proposal_multiplicity_invalid` — and `tests/unit/api-runtime.test.ts` already
pins the invoice one.

Both are reachable. A voucher whose posting has no eligible cost line (every debit in
26xx / 19xx / 24xx) hits the first on any trip approval. The second is reachable by any
non-UI caller — MCP, advisor, a direct `api-client` consumer — because only the review
sheet mirrors the packet check client-side.

The transaction rolls back cleanly, so nothing is corrupted; the reviewer just gets an
opaque 500 for what is a correctable input problem.

**Fix.** Two branches beside the invoice ones, and pin both codes in
`tests/unit/api-runtime.test.ts`:

```ts
if (error instanceof TripRegistrationLineNotFoundError) {
  return jsonError(c, error.message, runtimeMode, 422, { code: "trip_registration_line_not_found" });
}

if (error instanceof TripEvidenceNotInPacketError) {
  return jsonError(c, error.message, runtimeMode, 422, { code: "trip_evidence_not_in_packet" });
}
```

### [MEDIUM] 3.2 Two different trips on one posted line each report the full amount — [85]

With §2.1 fixed, a line still contributes its full amount to _every distinct_ trip bound
to it. Measured: one 1 000 kr line bound to `trip_a` and `trip_b` reports 1 000 on each,
so the trips list accounts for 2 000 of a 1 000 kr expense. This is reachable today —
pre-post registration binds the primary cost line, and the post-post work-item path can
bind a second trip to that same line.

I did not fix this because the right answer is a modelling decision, not a bug fix:
splitting, last-active-wins, and refusal are all defensible. My recommendation is
**refusal** — `planPostPostEnrichmentConfirm` should reject a `trip` enrichment on a line
that already has a different active `trip` enrichment, since `line_enrichment_supersede`
already exists as the intended way to move a line between trips (and
`tests/unit/trips-list.test.ts` already pins that supersede behaviour). If the team
prefers to allow it, document it in the wave report as a known double-count.

### [MEDIUM] 3.3 `evidenceIds` is optional on the planner input — [80]

`planPrePostEnrichment` declares `evidenceIds?: readonly string[]` and guards with
`!input.evidenceIds?.includes(...)`. Both stores pass it correctly today, so behaviour is
right. But the optional type means a future store or caller that forgets it gets no
compile error — it silently fails closed and rejects **every** packet-bound evidence id
with `TripEvidenceNotInPacketError` (which, per §3.1, is currently a 500). That is exactly
the Memory/Postgres divergence CONVENTIONS' store-parity rule exists to prevent, and the
compiler can prevent it for free.

**Fix.** Make it required (`evidenceIds: readonly string[]`) and let the two call sites
prove parity at build time.

### [MEDIUM] 3.4 Intent consumption is inferred from `input.edited === undefined` — [75]

`postReviewDecision` passes `clearEnrichmentIntent: input.edited === undefined`. That
closes the cross-user hazard correctly for today's clients, because the review sheet is
the only producer of `edited` and it always attaches an explicit intent in the same
submit. But the invariant that matters — _the approving human saw what they are
approving_ — now rests on an undocumented coupling between "this request carries edits"
and "this request owns the attached intent". Any future approve-with-edits caller (MCP, or
the advisor's `proposeReviewAction` flow) would silently consume a stale trip intent and
append a `TripRegistered` nobody was shown.

**Fix.** Carry the decision's intent explicitly rather than inferring it — either an
explicit `enrichmentIntent: "consume" | "clear"` on the decision input, or an intent
version/etag the approver echoes back. At minimum, comment the coupling at both
`app.ts:352` and the two store call sites, and add a test pinning it.

### [MEDIUM] 3.5 A `trip` enrichment naming an unregistered trip vanishes silently — [80]

Verified: a `LineEnrichmentRecorded` with `enrichmentType: "trip"` whose `tripId` was never
registered produces **no** trips-list row and **no** error —
`planPostPostEnrichmentConfirm` does not check that a `trip` enrichment references a
registered trip, and `buildTripsList` skips the unknown id. The human confirms an
enrichment, gets a "Confirmed" status, and nothing appears anywhere. The pre-post seam
cannot produce this (it registers and binds together), but the post-post path and MCP can.

**Fix.** Validate the referenced trip at confirm time and throw a mapped 422, or state in
the wave report that unregistered trip references are intentionally inert.

---

## 4. Minor / document-only

- **[MINOR, 80] `distanceKm` is unreachable pre-post.** The locked Wave 6c payload is
  `{ tripId, purpose, traveler, startDate, endDate, evidenceId?, distanceKm? }`, but
  `tripDetailsSchema` omits `distanceKm`, so the proposal cannot carry it and only the
  post-post path can set it. Add it to the proposal or note the deferral.
- **[MINOR, 75] The Postgres packet-evidence read runs on every intent-bearing approval**,
  including project, invoice, inventory and `noop` intents that never look at it — one
  extra round trip inside the transaction holding the workspace-wide advisory lock. Gate
  it on `proposals.some((p) => p.kind === "trip_registration" && p.evidenceId !== undefined)`.
- **[MINOR, 70] Two identity regimes coexist for trips.** `POST /api/trips` still accepts a
  client-chosen `tripId` (the shipped E2E posts `trip_e2e_1`) while the approval seam
  derives `trip_…` server-side. Pre-existing and consistent with the project and invoice
  registries, so not a Wave 6c defect — but it is the reason Sol's "client invents
  `tripId`" objection was well-founded, and it should not be extended to new routes.

---

## 5. Gate conditions for Wave 6c

Wave 6c is **NOT COMPLETE**. To close it:

1. §3.1 fixed, with both 422 codes pinned in `tests/unit/api-runtime.test.ts` alongside
   the existing enrichment error codes.
2. §3.2, §3.3, §3.4, §3.5 fixed, or explicitly deferred in the wave report with a reason.
3. `scenarioTripReviewApproval` green under strict `pnpm db:test` on **both** stores,
   including a negative case: an intent that cannot plan (no eligible cost line, or
   out-of-packet evidence) must leave the review open with **zero** `PostedToLedger` and
   zero `TripRegistered`, matching `scenarioPrePostEnrichmentSinglePosting`.
4. The trips E2E extended to actually **submit** the trip workflow through the sheet and
   assert the resulting Books row — the pre-post path Sol found unsubstantiated — while
   keeping the existing post-post real-`ln_` confirmation coverage.
5. An E2E or store test pinning §2.1: a trip attached pre-post and then again post-post on
   the same line reports the line's amount **once**.
6. `pnpm check`, then `pnpm build:e2e` + focused E2E on desktop and Pixel 7, then visual
   diffs reviewed before any re-baseline.
7. §3.2 and §4 documented as known limitations in the wave report.

Note on the implementer's recorded verification (`pnpm db:test` 110/110, trip E2E 4/4):
those runs predate this review and predate the §2.1 fix. They are credible for what they
covered, but this review did not treat them as the final gate — items 3–6 above must be
re-run centrally after the concurrent Wave 6b/6d shared-file owners settle.

---

## 6. Scope note

Two fix agents were writing this tree throughout the review — file mtimes on
`packages/contracts/src/enrichment.ts`, `packages/domain/src/store-planning.ts`,
`packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`,
`services/api/src/app.ts`, `tests/unit/api-runtime.test.ts`, the conformance harness and
the review sheet all advanced during it. Editing those would have clobbered in-flight TDD
cycles, so every finding above is written to be applied directly by their owners.

I changed only two files, both unowned and unmodified by either agent:
`packages/domain/src/workflows/trips.ts` and `tests/unit/trips-list.test.ts`. No PR was
opened, `main` was not touched, no Wave 6d inventory UI file was edited, and no Wave 6e
work was started.

## Verification performed

- Traced `applyReviewDecision` in both stores against `planReviewDecision`,
  `planPrePostEnrichment` and `mergePrePostEnrichmentsIntoReviewDecisionPlan`, including
  the Postgres advisory-lock / chain-fork-retry / intent-delete ordering and the
  packet-evidence read.
- Executed the contract probes against the installed Zod: refined arm inside
  `z.discriminatedUnion`, forged-`tripId` stripping, date-order rejection at the
  `attachReviewEnrichmentIntentInputSchema` boundary, and the proposals `.max()` bound.
- Executed `buildTripsList` over hand-built event sets to measure the §2.1 double-count,
  the §3.2 cross-trip double-count, and the §3.5 silent drop.
- Confirmed by reading `app.onError` end to end that neither trip error has a branch and
  that there is no `ZodError` branch before the generic 500.
- Confirmed `ledger.evidence_packet_items` has no tenant columns, so the Postgres packet
  read is correctly scoped through the tenant-scoped voucher's `evidence_packet_id`.
- After the §2.1 fix: `tsx --test tests/unit/trips-list.test.ts` 6/6 PASS, domain package
  `tsc --noEmit` clean, lint clean.
