# Wave 6b Opus Review — atomic approval → invoice registration seam

Date: 2026-08-09

Branch: `feat/ledger-overview-enrichments-mcp`

Reviewed: Sol's `NEEDS_OPUS_REVIEW` escalation (`16c47c5`,
`.superpowers/sdd/w6b-ui-sol-review.md`) against `c38a565`, `a5d88cb`, `0eea053`,
plus HEAD `5f94a94` and the **uncommitted working tree** in which a concurrent fix
agent is actively implementing this exact seam (contracts, planner, both stores,
conformance harness, review sheet, focused E2E).

Verdict: **REQUEST_CHANGES**

The **design is APPROVED** — the seam Sol asked for already exists and the fix
agent chose it correctly. Five defects in the in-flight implementation must land
before the Wave 6b gate. Two of them append wrong or unseen data to an
append-only ledger, so they are blocking rather than cosmetic.

---

## 1. Answering the escalation

### The atomic seam is not missing — it is the Wave 5 pre-post intent path

Sol's conclusion that registration "requires a new contract-first pre-post
invoice intent" is right in substance, but the mechanism already shipped in
Wave 5 and is already used by `project_assignment`:

1. `attachReviewEnrichmentIntent(reviewId, proposals)` stores a **pre-post
   intent** against a review that must still be `needs-review`
   (`EnrichmentIntentClosedError` otherwise). Memory keeps a map; Postgres keeps
   `ledger.review_enrichment_intents` with an upsert on
   `(organization_id, workspace_id, review_id)`.
2. `applyReviewDecision` reads that intent **inside** the decision transaction,
   feeds it to `planPrePostEnrichment(...)`, and merges the resulting
   `companionEvents` into the single `ReviewDecisionPlan` via
   `mergePrePostEnrichmentsIntoReviewDecisionPlan(...)`.
3. All planned events append in one pass, then the intent row is deleted — in
   Postgres inside the same `client.begin(...)` that already took
   `pg_advisory_xact_lock` before the tail read, wrapped in
   `withChainForkRetry`; in Memory synchronously, with no interleaving point.

That satisfies every property Sol required, and two guards in
`mergePrePostEnrichmentsIntoReviewDecisionPlan` make double-posting structurally
impossible: companions may not contain `PostedToLedger`, and the base plan must
contain exactly one.

**Sol's "two client calls are non-atomic" objection does not apply to
attach-then-approve.** The two calls are not "post, then register". A failure
between them leaves an intent row attached to a _still-open_ review: no posted
voucher, no orphan `InvoiceRegistered`, nothing to reconcile. The atomicity that
matters — posting and registration succeeding or failing together — lives
entirely inside the approval transaction. The client sequence is safe **on the
happy path**; §2.1 below is where it actually breaks.

### Server-derived identity, currency, and amount are available

Sol wrote that `invoiceId`, `currency`, and `originalAmount` are owned by nobody.
They are all derivable server-side inside the planner:

- `invoiceId` — `createId("inv")`. Re-entrancy is safe: the Postgres retry path
  rolls the whole transaction back and re-plans, so a regenerated id cannot
  double-register.
- `currency` — `postingVoucher.voucherFields.currency` (contract-guaranteed
  3-char, defaulted `SEK`).
- `originalAmount` — the posted total. `buildPostingLines` emits exactly one
  credit leg (`coa.roles.bank`) for `grossAmount`, and `assertBalancedPosting`
  guarantees Σdebit = Σcredit, so the debit total is the gross. See §2.2 for the
  rounding defect in how the fix agent computes it.

The human enters only `direction`, `counterparty`, `dueDate`; the contract
`invoiceRegistrationProposalSchema` picks exactly those three, so Zod strips a
forged `invoiceId`/`currency`/`originalAmount`/`actorId`. Attribution stays
server-derived (`input.actorId ?? DEMO_ACTOR_ID` from the verified JWT subject).

### Human-approval and append-only invariants hold

Registration only ever happens as a companion to a human `approve` /
`book-without-vat` decision, never on `reject`, never from the advisor path, and
never as a second write. No history is rewritten. Both stores call the same
shared planner, so parity is by construction.

**Clearance: the fix agent may proceed on this design.** No alternative seam
should be built, and `registerInvoice()` must not be called from the approval
path.

---

## 2. Findings against the in-flight implementation

Reviewed as work-in-progress; some may already be fixed by the time this is
read. Confidence scores in brackets.

### [BLOCKING] 2.1 A stale intent registers an invoice the approver never saw — [90]

`apps/web/components/today/review-edit-sheet.tsx`, mutation at ~L97–114:

```ts
if (proposal) {
  await apiClient.attachReviewEnrichmentIntent({ reviewId: review.id, proposals: [proposal] });
}
return apiClient.approveReview(review.id, { edited });
```

There is no path that ever _clears_ an attached intent. The intent outlives the
sheet and is consumed by whatever approval arrives next:

- User picks `invoice`, fills the fields, submits; the network call to
  `approveReview` fails. User reopens the sheet, switches workflow back to
  `none`, submits. `proposal` is `undefined`, so nothing is attached — but the
  server still holds the previous intent and **registers the invoice the user
  just deselected**.
- Worse, the intent is not scoped to the sheet at all. User attaches an intent
  and closes the sheet without approving. A colleague later clicks the plain
  **Approve** button in the review queue and silently appends an
  `InvoiceRegistered` they were never shown.

That second case violates the project's core posture directly: the approving
human must see what they are approving, and the appended event is permanent.

**Fix.** Make the intent state explicit on every submit rather than
fire-and-forget. Always send an intent, using the existing no-op proposal to
mean "no enrichment":

```ts
await apiClient.attachReviewEnrichmentIntent({
  reviewId: review.id,
  proposals: [proposal ?? { kind: "noop" }],
});
return apiClient.approveReview(review.id, { edited });
```

`{ kind: "noop" }` is already accepted by `assertPrePostEnrichmentIntentSupported`
and already skipped by `planPrePostEnrichment`, and the Postgres upsert replaces
the stale row, so this needs no contract or store change. It does not fix the
cross-user case — for that, the review queue's plain approve should either
surface any attached intent before approving or clear it. At minimum, the queue
approve path must be covered by a test that pins the chosen behavior.

### [BLOCKING] 2.2 `originalAmount` is written non-öre-exact ~1 time in 4 — [90]

`packages/domain/src/store-planning.ts`, invoice branch:

```ts
originalAmount: input.postingLines.reduce((sum, postingLine) => sum + postingLine.debit, 0),
```

The debit legs are `netAmount` and `vatAmount`, both `round2`-ed independently
from gross. Their float sum frequently is not the gross. Measured over every
gross from 0.01 to 2000.00 at the 25% Swedish standard rate,
`net + vat !== gross` for **51 330 of 200 000 amounts (25.7%)**. The demo seed's
1249 (999.2 + 249.8) happens to be exact, which is why the new conformance
assertion `assert.equal(originalAmount, voucherFields.grossAmount)` passes today
— it is passing by luck on one lucky number, not because the arithmetic is
right.

The consequence is a monetary value like `1249.0000000000002` hashed into an
immutable `InvoiceRegistered` payload that can never be corrected, only
superseded. `round2` exists in `store-shared` for precisely this reason and is
used on every other derived amount in the codebase.

**Fix.** Round, and pin the invariant that makes the debit total meaningful:

```ts
// Σdebit = Σcredit is guaranteed by assertBalancedPosting, and buildPostingLines
// emits a single credit leg for the gross — so the debit total IS the invoice
// gross. round2 because the net/VAT legs are rounded independently.
originalAmount: round2(input.postingLines.reduce((sum, line) => sum + line.debit, 0)),
```

Add a unit case with a gross that exposes the drift (e.g. 100.10 → net 80.08,
vat 20.02) so the assertion stops depending on 1249.

### [IMPORTANT] 2.3 An amount-less voucher makes the review permanently unapprovable behind a 500 — [85]

If `voucherFields.grossAmount` is absent — reachable in normal mode when live
Document Intelligence returns no parseable amount, since `deriveVoucherFields`
yields `undefined` and `num()` rejects non-finite strings — `buildPostingLines`
emits an all-zero balanced posting, the debit total is `0`, and
`invoiceRegisteredPayloadSchema.parse` fails `.positive()`. The raw `ZodError`
has no branch in `app.onError`, so it falls through to a generic
**500 "Unexpected server error."**

The transaction rolls back cleanly, which is correct. But the reviewer gets no
actionable message, and combined with §2.1 the review becomes unapprovable
through the UI entirely: switching the workflow back to `none` does not clear the
intent, so every subsequent approve throws the same 500. The only escape is
reject.

**Fix.** Throw a typed domain error and map it, as every other planner refusal
does:

```ts
export class InvoiceRegistrationAmountError extends Error {
  constructor(public readonly voucherId: string) {
    super("Invoice registration requires a posted amount greater than zero.");
    this.name = "InvoiceRegistrationAmountError";
  }
}
```

Map it in `app.onError` to `422 { code: "invoice_registration_amount_invalid" }`,
and mirror the guard in the review sheet so the invoice workflow is not
selectable on an amount-less voucher.

### [IMPORTANT] 2.4 Invoice and inventory failures report as a project-assignment error — [85]

Both new branches reuse `ProjectAssignmentLineNotFoundError` when no eligible
cost line exists. `app.onError` maps it to
`422 { code: "project_assignment_line_not_found" }` with the message "Project
assignment requires an eligible cost line." A reviewer registering an invoice
gets told their project assignment failed.

**Fix.** Give each vertical its own error and code, or generalise to a single
`PrePostEnrichmentLineNotFoundError` carrying the proposal kind, and keep
`ProjectAssignmentLineNotFoundError` as an alias so the existing pinned 422 code
does not change.

### [IMPORTANT] 2.5 Unbounded proposals let one approval register N duplicate invoices — [85]

`attachReviewEnrichmentIntentInputSchema.proposals` and
`reviewEnrichmentIntentSchema.proposals` are `z.array(enrichmentProposalSchema).min(1)`
with **no `.max()`**, and nothing rejects repeated singleton kinds. So a single
intent can carry fifty `invoice_registration` proposals; one approval then
appends fifty `InvoiceRegistered` events, **each carrying the full gross**, and
Books shows fifty duplicate open invoices for one purchase — permanently.

It is also an availability concern: the companion-event count is caller-controlled
and every append happens inside the transaction holding the workspace-wide
`pg_advisory_xact_lock`. That is CONVENTIONS Rule 25's bounded-accumulation rule
applied to a write path.

**Fix.** Both halves:

- `.max(MAX_PROPOSALS_PER_INTENT)` on the proposals arrays in `packages/contracts`.
- In `assertPrePostEnrichmentIntentSupported`, reject more than one proposal of
  any singleton kind (`invoice_registration` today; `quantity_inventory_movement`
  deserves the same look, since each movement re-binds to the same primary cost
  line).

### [MEDIUM] 2.6 Intent authorship is erased on approval — [80]

The intent row carries `updatedBy`, and it is `DELETE`d inside the approval
transaction without ever being written to an event. When reviewer A enters the
invoice fields and reviewer B approves, the chain attributes `InvoiceRegistered`
solely to B and A's authorship of the human-entered data leaves no append-only
trace.

The approver remains the accountable human, so this is not an invariant
violation — but "append-only events are truth" argues the authorship should
survive. Cheapest fix: include the intent's `updatedBy` and `updatedAt` in the
`ReviewApproved` decision payload.

### [MEDIUM] 2.7 Currency is not normalised, and a mismatch is unrecoverable — [75]

`voucherFields.currency` is `.length(3)` with no case constraint, and
`allocatePayment` compares `invoice.currency !== input.currency` exactly. A
voucher carrying `sek` registers an invoice in `sek`; every later payment in
`SEK` throws `InvoiceAllocationCurrencyError` (422), and because the registration
is immutable the invoice can never be settled.

**Fix.** Uppercase at registration (and ideally constrain the contract to
`/^[A-Z]{3}$/`).

### [MINOR] 2.8 The `invoice` line enrichment is currently write-only — [80]

The companion `LineEnrichmentRecorded` with `enrichmentType: "invoice"` binds the
invoice to a posted `lineId`, but nothing reads it: `buildOpenInvoicesList`
computes `openAmount` from `InvoiceRegistered.originalAmount` minus
`PaymentAllocated`, feeding `deriveOpenInvoiceAmount` a synthetic single line.
The enrichment is correct and worth keeping as the audit link, but the plan
should not claim the list is derived from it.

### [MINOR] 2.9 The cost-line heuristic is now duplicated three times — [80]

`bindProjectAssignmentToPrimaryCostLine`, the invoice branch, and the inventory
branch each inline the same `!startsWith("26") && !startsWith("19") &&
!startsWith("24")` filter. Extract one `findPrimaryCostLine(postingLines)` in
`store-planning.ts`. (That the exclusion list is three magic prefixes rather than
COA roles is pre-existing and out of scope.)

---

## 3. Accounting-honesty limitation to document, not to fix in 6b

`buildPostingLines` always credits `coa.roles.bank`. Registering an **open AP
invoice** on approval therefore produces a ledger that says the cash already
left, while the Books panel shows the invoice open until a `PaymentAllocated`
arrives. The two surfaces will disagree, and the `invoice` line enrichment binds
to the expense line because no payable line exists.

Nothing breaks — the open-invoice read path never consults ledger lines — but
this is a real double-truth. Honestly modelling it needs an AR/AP posting shape
(1510 / 2440) with the bank leg deferred to payment allocation, which is well
beyond Wave 6b's locked scope. **Record it as a known limitation in the wave
report and the plan**, and do not let the Books panel imply it reconciles to the
balance sheet.

---

## 4. Gate conditions for Wave 6b

Wave 6b is **NOT COMPLETE**. To close it:

1. §2.1 and §2.2 fixed, each with a regression test — a stale-intent test
   proving `workflow=none` after a failed invoice submit appends no
   `InvoiceRegistered`, and a unit case on a gross whose net/VAT legs do not sum
   exactly.
2. §2.3, §2.4, §2.5 fixed; the 422 codes asserted in `tests/unit/api-runtime.test.ts`
   alongside the existing enrichment error codes.
3. §2.6 and §2.7 fixed or explicitly deferred in the wave report with a reason.
4. The new `scenarioInvoiceReviewApproval` conformance scenario green under
   strict `pnpm db:test` on **both** stores — it is the only thing that actually
   proves Memory/Postgres parity and all-or-nothing behaviour. Add a negative
   case: an intent that cannot plan must leave the review open with **zero**
   `PostedToLedger`, matching the existing `scenarioPrePostEnrichmentSinglePosting`
   pattern.
5. The focused E2E already extended to submit and assert the Books row is the
   right shape and closes Sol's gate objection. Keep the `originalAmount`
   assertion but tighten it from `> 0` to the exact expected gross.
6. `pnpm check`, then `pnpm build:e2e` + focused E2E on desktop and Pixel 7, then
   visual diffs reviewed before any re-baseline.
7. §3 documented as a known limitation.

---

## 5. Scope note

No code was changed by this review. The fix agent holds uncommitted work in
`packages/contracts/src/enrichment.ts`, `packages/domain/src/store-planning.ts`,
`packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`,
the conformance harness, and the review sheet — the exact files every fix above
touches. Editing them concurrently would have clobbered an in-flight TDD cycle,
so the guidance is written to be applied directly by that agent. No PR was
opened, `main` was not touched, and no Wave 6e work was started.

## Verification performed

- Traced `applyReviewDecision` in both stores against `planReviewDecision`,
  `planPrePostEnrichment`, and `mergePrePostEnrichmentsIntoReviewDecisionPlan`,
  including the Postgres advisory-lock, chain-fork-retry, and intent-delete
  ordering.
- Confirmed `apps/web` had **no** caller of `attachReviewEnrichmentIntent` before
  the in-flight change: the pre-post seam had no UI producer at all, for
  `project_assignment` either.
- Confirmed `app.onError` has no `ZodError` branch, so a planner parse failure
  surfaces as a generic 500 (§2.3).
- Quantified the §2.2 rounding drift numerically (51 330 / 200 000 amounts).
- Confirmed `deriveVoucherFields` returns `grossAmount: undefined` when no
  amount is extracted, and that `buildPostingLines` still produces a balanced
  all-zero posting in that case.
