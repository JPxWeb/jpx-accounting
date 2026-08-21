# KFR Phase E — Books UI & Numbering

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox syntax for tracking. Verification vocabulary: `CHECK` = `corepack pnpm check`; `UNIT:file <f>` = `corepack pnpm exec tsx --test tests/unit/<f>.test.ts`; `INTEG` = `corepack pnpm db:test`; `E2E:file <f>` = `corepack pnpm build:e2e && corepack pnpm exec playwright test tests/e2e/<f>`. Commits per task, message ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**Depends on Phase B (posting engine) and Phase D (SIE migration) having landed first** — per the master's dependency notes ("B before E... land D before E"). This plan is written against the master's Interface Contract names; if the ACTUAL Phase B/D code uses different names for anything below, reconcile against the real code before proceeding — do not silently rename without checking why.

## Findings from studying the current code (read before executing)

1. **`composeEvidence` has ZERO client wiring today.** `LedgerStore.composeEvidence` exists in both stores and `POST /api/evidence/compose` exists in `services/api/src/app.ts:687`, but `packages/api-client/src/index.ts` has no `composeEvidence` method and no web component calls it (verified by repo-wide grep, `.next` build artifacts aside). Task E.2 adds the client method from scratch — this is not "wire up an existing call," it is new plumbing.
2. **The voucher-list source for the attach-to-voucher picker already exists and is already used for the identical purpose elsewhere.** `apiClient.getSnapshot()` (`GET /api/workspace`) returns `WorkspaceSnapshot.vouchers` — `apps/web/components/books/journal-view.tsx` and `apps/web/components/command-palette.tsx` both already build voucher lookups off this same snapshot. No new endpoint is needed for the picker.
3. **`voucherNumber` is rendered as opaque text everywhere — nothing parses it.** Repo-wide grep for `voucherNumber.match/replace/slice/split/startsWith` and `parseInt(...voucherNumber...)` found zero hits. The 5 render sites (`review-card.tsx`, `evidence-detail-screen.tsx`, `voucher-link.tsx`, `command-palette.tsx`, plus a comment-only mention in `journal-view.tsx`) all just interpolate the string. This means the numbering change (Task E.1) needs **no code changes** in those 5 files — the literal value simply becomes `"Utkast"` before posting and `"V-<n>"` after, and every render site already handles an arbitrary string correctly.
4. **Exactly one unit test pins the planner's _computed_ voucher number**: `tests/unit/store-planning.test.ts:32` (`assert.equal(plan.voucher.voucherNumber, "V-1001")`). Every other `"V-10xx"` / `` `V-${...}` `` occurrence across `tests/unit/*.test.ts` (posting-balance, simulation, observations, compliance, ai-core-runtime, review-blocked-approval, advisor-demo-turn, and the other fixtures inside store-planning.test.ts) is a **hand-authored literal fixture** unrelated to the planner's own output — none of them need to change.
5. **One integration test needs real rework, not just a literal swap**: `tests/integration/postgres-ledger.test.ts:1465-1477` asserts `new Set(voucherNumbers).size === 8` for 8 concurrently-created (but never approved) vouchers, to prove the advisory lock serializes the numbering `COUNT(*)`. After Task E.1, freshly-created vouchers are all `"Utkast"` (not distinct) — the concurrency property this test protects now lives at **posting time**. Task E.1 rewrites this assertion to approve all 8 reviews concurrently (still racing `storeA`/`storeB`) and check 8 distinct **posted** numbers instead.
6. **The demo seed voucher will now display `"Utkast"` instead of `"V-1001"` pre-approval.** `MemoryLedgerStore`'s constructor seeds one `needs-review` voucher via `createEvidenceSync`. No E2E spec asserts the literal text `"V-1001"` anywhere (verified by grep across `tests/e2e/`), so this is a safe, silent behavior change.
7. **A real (small) rough edge**: `packages/domain/src/compliance.ts:60`'s `"stale-blocked"` alert title embeds `voucher.voucherNumber` — `Blocked voucher unresolved for >7 days (${voucher.voucherNumber})`. With the shared sentinel, two simultaneously-stale-blocked vouchers would produce two alerts with the **identical human-readable title** (their `id`/`targetId` stay correctly distinct — only the label collides). Task E.1 folds in a one-line disambiguation. No existing test pins the exact title string (checked `tests/unit/compliance.test.ts`), so this is a free, safe fix.
8. **No combobox/`cmdk` primitive exists in the repo** (checked `apps/web/components/ui/*`). The one true "search over a big list AND accept free text" idiom available without a new dependency is a native `<input list="...">` + `<datalist>` — this is what Task E.4's account field uses. The existing `ui/select.tsx` (base-ui `Select`) is a closed listbox (no free entry) and is kept for the VAT-code field, matching `review-edit-sheet.tsx`'s existing raw-`<select>` idiom for account/VAT-code pickers.
9. **`manual-entry-view.tsx` is a full inline view, not a modal** — per the master's explicit instruction ("prefer inline view, not modal"), it does **not** use `useDialogFocusTrap` (that hook is for the review-edit sheet's `role="dialog"` overlay, which this isn't).

## Task dependency graph

```
E.1 (numbering, domain+stores+tests) — independent, do first (other tasks' E2E assertions rely on deterministic V-numbers)
E.2 (api-client: createManualVoucher + composeEvidence) — independent of E.1
E.3 → E.4 (manual-entry form: E2E spec red, then UI green) — depends on E.1 + E.2
E.5 (attach-to-voucher picker: E2E extension red, then UI green) — depends on E.2
E.6 (print for journal + huvudbok) — independent, after E.1 so the printed V-numbers are real
E.7 (phase exit gate)
```

---

## Task E.1 — Posting-time voucher numbering (domain + Memory + Postgres + tests)

**Files — Modify:** `packages/domain/src/store-shared.ts`, `packages/domain/src/store-planning.ts`, `packages/domain/src/store.ts`, `packages/domain/src/compliance.ts`, `packages/persistence-postgres/src/store.ts`, `tests/unit/store-planning.test.ts`, `tests/integration/postgres-ledger.test.ts`.

### E.1.1 — Failing tests first

- [ ] In `tests/unit/store-planning.test.ts`, add the import and update the existing pin:

  ```ts
  import { DRAFT_VOUCHER_NUMBER } from "../../packages/domain/src/store-shared.ts";
  ```

  Rename the test and its assertion (was `"numbers vouchers from voucherIndex and emits 4 events..."`):

  ```ts
  it("assigns the DRAFT_VOUCHER_NUMBER sentinel at intake and emits 4 events with extractor/ai sentinels", () => {
    const plan = planEvidenceCreate(
      {
        title: "Test",
        modalities: ["upload"],
        originalFilename: "x.jpg",
        mimeType: "image/jpeg",
        actorId: "user:test",
      },
      {
        now: "2026-03-15T12:00:00.000Z",
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      },
    );
    assert.equal(plan.voucher.voucherNumber, DRAFT_VOUCHER_NUMBER);
    ...
  ```

  (drop the `voucherIndex: 0,` line — the ctx type no longer has that field, so leaving it in is a compile error, which is the point: it proves the old call shape is gone.)

- [ ] In the same file, wrap the two bare 5th-argument `now` strings into the new options object (lines ~146 and ~213):

  ```ts
  // before: planReviewDecision(review, voucher, "reject", {...}, "2026-03-15T13:00:00.000Z")
  // after:
  planReviewDecision(
    review,
    voucher,
    "reject",
    { actorId: "user:x", notes: "duplicate" },
    { now: "2026-03-15T13:00:00.000Z" },
  );
  ```

  and likewise for the "edited approve" test. Add one bonus assertion to the edited-approve test (default `postedVoucherCount` is 0 when omitted):

  ```ts
  assert.equal(plan.updatedVoucher.voucherNumber, "V-1001");
  ```

- [ ] Add a new dedicated test proving the numbering contract:

  ```ts
  it("assigns V-<n> only on posting via ctx.postedVoucherCount; reject keeps the draft sentinel", () => {
    const voucher = {
      id: "v1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      evidencePacketId: "p1",
      voucherNumber: DRAFT_VOUCHER_NUMBER,
      status: "needs-review",
      accountingMethod: "cash",
      extractedFields: [],
      voucherFields: { currency: "SEK", grossAmount: 125, netAmount: 100, vatAmount: 25 },
      createdAt: "2026-03-15T12:00:00.000Z",
      createdBy: "user:x",
    } as Voucher;
    const suggestion = {
      id: "sug1",
      voucherId: "v1",
      accountNumber: "6110",
      accountName: "Kontorsmateriel",
      vatCode: "VAT25",
      confidence: 0.9,
      reasoning: "test",
      kind: "recommendation",
      citations: [],
      ruleHits: [],
    } as AccountingSuggestion;
    const review = {
      id: "r1",
      voucherId: "v1",
      title: "Review Utkast",
      status: "needs-review",
      suggestedAction: "Approve the proposed posting.",
      suggestion,
      provenanceTimeline: [],
    } as ReviewTask;

    const approved = planReviewDecision(review, voucher, "approve", { actorId: "user:x" }, { postedVoucherCount: 3 });
    if (approved.kind !== "apply") throw new Error("unreachable");
    assert.equal(approved.updatedVoucher.voucherNumber, "V-1004");

    const rejected = planReviewDecision(review, voucher, "reject", { actorId: "user:x" }, { postedVoucherCount: 3 });
    if (rejected.kind !== "apply") throw new Error("unreachable");
    assert.equal(rejected.updatedVoucher.voucherNumber, DRAFT_VOUCHER_NUMBER, "rejected drafts never burn a V-number");
  });
  ```

- [ ] Run `UNIT:file store-planning` — confirm it **fails to compile/run** (the old `voucherIndex` field and bare-string `now` argument no longer match anything, and `DRAFT_VOUCHER_NUMBER` doesn't exist yet). This is the RED step.

### E.1.2 — Implementation

- [ ] `packages/domain/src/store-shared.ts` — add near `DEMO_ACTOR_ID`:

  ```ts
  /**
   * Draft-voucher display sentinel (Phase E / readiness doc G8): every planner
   * that creates a NEW Voucher row (capture intake, manual entry) assigns this
   * literal instead of computing a `V-<n>` — the real number is assigned only
   * once the voucher actually POSTS (approve or book-without-vat), inside
   * `planReviewDecision`. A rejected review never posts, so its voucher keeps
   * this sentinel forever: rejected drafts no longer burn V- numbers.
   * SIE-imported vouchers never pass through this path at all (`importSie`
   * assigns its own "<series> <number>" display directly) so there is no
   * interaction with that numbering scheme.
   */
  export const DRAFT_VOUCHER_NUMBER = "Utkast";

  /** True for voucher/review statuses that correspond to an actual PostedToLedger event. */
  export function isPostedVoucherStatus(status: Voucher["status"]): boolean {
    return status === "approved" || status === "booked-without-vat";
  }
  ```

- [ ] `packages/domain/src/store-planning.ts` — `planEvidenceCreate`: drop `voucherIndex` from the `ctx` parameter type and use the sentinel:

  ```ts
  export function planEvidenceCreate(
    input: EvidenceCreateInput & ActorAttribution,
    ctx: { now?: string; organizationId: string; workspaceId: string },
  ): EvidenceCreatePlan {
    ...
    voucherNumber: DRAFT_VOUCHER_NUMBER,
  ```

  (add `DRAFT_VOUCHER_NUMBER` to the existing `from "./store-shared"` import in this file.)

- [ ] `planReviewDecision` — new `ctx` options object replaces the bare `now` parameter, and the posting branch assigns the real number:

  ```ts
  export function planReviewDecision(
    review: ReviewTask,
    voucher: Voucher,
    action: ReviewAction,
    input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
    ctx: { now?: string; postedVoucherCount?: number } = {},
  ): ReviewDecisionPlan {
    if (review.status !== "needs-review") {
      return { kind: "replay", review: { ...review } };
    }
    if (input.enforceBlockedReason && action === "approve" && review.blockedReason) {
      throw new ReviewBlockedError(review.blockedReason);
    }

    const actorId = input.actorId ?? DEMO_ACTOR_ID;
    const edited = action !== "reject" ? input.edited : undefined;
    let postingSuggestion = review.suggestion;
    let postingVoucher = voucher;
    if (edited) {
      const resolved = resolveReviewDecisionEdit(voucher, review.suggestion, edited);
      postingSuggestion = resolved.effectiveSuggestion;
      postingVoucher = resolved.effectiveVoucher;
    }

    const occurredAt = ctx.now ?? nowIso();
    const newStatus = reviewStatusForAction(action);
    const timelineStep = {
      id: createId("step"),
      label: reviewDecisionLabel(action, Boolean(edited)),
      timestamp: occurredAt,
      actor: actorId,
    };

    let updatedReview: ReviewTask = {
      ...review,
      status: newStatus,
      provenanceTimeline: [...review.provenanceTimeline, timelineStep],
    };

    // Posting-time numbering (Phase E / G8): the voucher only earns its real
    // `V-<n>` the instant it actually posts. Reject never posts, so it keeps
    // whatever voucherNumber it already had (DRAFT_VOUCHER_NUMBER at intake).
    let lines: LedgerLine[] | undefined;
    let postedVoucherNumber = voucher.voucherNumber;
    if (action !== "reject" && postingSuggestion) {
      lines = buildPostingLines(postingVoucher, postingSuggestion, action, occurredAt);
      postedVoucherNumber = `V-${(ctx.postedVoucherCount ?? 0) + 1001}`;
    }

    const updatedVoucher: Voucher = { ...voucher, status: newStatus, voucherNumber: postedVoucherNumber };
    if (edited && postingSuggestion) {
      updatedReview = { ...updatedReview, suggestion: postingSuggestion };
    }

    const decisionPayload: Record<string, unknown> = { action };
    if (input.notes !== undefined) decisionPayload.notes = input.notes;
    if (edited) decisionPayload.edited = edited;

    const events: PlannedEvent[] = [
      {
        organizationId: updatedVoucher.organizationId,
        workspaceId: updatedVoucher.workspaceId,
        aggregateType: "review",
        aggregateId: review.id,
        eventType: reviewDecisionEventType(action),
        actorId,
        occurredAt,
        payload: decisionPayload,
      },
    ];

    if (lines) {
      events.push({
        organizationId: updatedVoucher.organizationId,
        workspaceId: updatedVoucher.workspaceId,
        aggregateType: "ledger",
        aggregateId: updatedVoucher.id,
        eventType: "PostedToLedger",
        actorId,
        occurredAt,
        payload: { action, suggestion: postingSuggestion, lines },
      });
    }

    return { kind: "apply", updatedReview, updatedVoucher, postingSuggestion, lines, events };
  }
  ```

- [ ] `packages/domain/src/store.ts` (`MemoryLedgerStore`):
  - Remove `voucherIndex: this.vouchers.size,` from the `planEvidenceCreate(...)` call in `createEvidenceSync`.
  - Add `isPostedVoucherStatus` to the existing `import {...} from "./store-shared"` block AND to the re-export block (matches the file's existing "re-export shared helpers for `@jpx-accounting/domain/store` consumers" convention).
  - `applyReviewDecision`: compute the posted count only when the decision can actually post (skip the wasted work on reject / already-decided reviews):

    ```ts
    async applyReviewDecision(
      reviewId: string,
      action: ReviewAction,
      input: ReviewDecisionInput & ActorAttribution & ApprovalGate,
    ): Promise<ReviewTask | undefined> {
      const review = this.reviews.get(reviewId);
      if (!review) return undefined;
      const voucher = this.vouchers.get(review.voucherId);
      if (!voucher) return undefined;

      const willPost = review.status === "needs-review" && action !== "reject" && Boolean(review.suggestion);
      const postedVoucherCount = willPost
        ? [...this.vouchers.values()].filter((v) => isPostedVoucherStatus(v.status)).length
        : 0;

      const plan = planReviewDecision(review, voucher, action, input, { postedVoucherCount });
      if (plan.kind === "replay") return plan.review;
      ...
    ```

- [ ] `packages/domain/src/compliance.ts` — disambiguate the stale-blocked title so N simultaneously-drafted blocked vouchers don't collide on the human-readable label:

  ```ts
  import { DRAFT_VOUCHER_NUMBER } from "./store-shared";
  ...
  const voucherLabel =
    voucher.voucherNumber === DRAFT_VOUCHER_NUMBER ? `${DRAFT_VOUCHER_NUMBER} ${voucher.id}` : voucher.voucherNumber;
  alerts.push({
    id: deterministicAlertId("stale-blocked", voucher.id),
    title: `Blocked voucher unresolved for >7 days (${voucherLabel})`,
    ...
  ```

- [ ] `packages/persistence-postgres/src/store.ts`:
  - `createEvidence`: remove the `voucherCountRows`/`voucherCount` block (lines ~614-625) entirely and drop `voucherIndex: voucherCount,` from the `planEvidenceCreate(...)` call. Replace the stale comment ("Voucher number sequencing: COUNT(\*)...") with: `// Voucher number: DRAFT_VOUCHER_NUMBER at intake — the real V-<n> is assigned only when the voucher posts (applyReviewDecision), Phase E / G8.`
  - `applyReviewDecision`: after fetching `voucher` (and before calling `planReviewDecision`), add the same lazy posted-count query, inside the SAME advisory-locked transaction as the existing `lockWorkspaceTail(tx)` call:

    ```ts
    const willPost = review.status === "needs-review" && action !== "reject" && Boolean(review.suggestion);
    let postedVoucherCount = 0;
    if (willPost) {
      const postedCountRows = await tx<{ count: string }[]>`
        SELECT COUNT(*)::text AS count
        FROM ledger.vouchers
        WHERE organization_id = ${this.defaults.organizationId}
          AND workspace_id = ${this.defaults.workspaceId}
          AND status IN ('approved', 'booked-without-vat')
      `;
      postedVoucherCount = Number(postedCountRows[0]?.count ?? "0");
    }

    const plan = planReviewDecision(review, voucher, action, input, { postedVoucherCount });
    if (plan.kind === "replay") return plan.review;
    ```

    and add `voucher_number` to the existing `UPDATE ledger.vouchers` statement in the same method:

    ```sql
    UPDATE ledger.vouchers
    SET status = ${plan.updatedVoucher.status},
        voucher_number = ${plan.updatedVoucher.voucherNumber}
    WHERE id = ${plan.updatedVoucher.id}
    ```

- [ ] **Reconcile with Phase B**: grep `packages/domain/src/store-planning.ts`, `packages/domain/src/store.ts`, and `packages/persistence-postgres/src/store.ts` for whatever planner Phase B added for `createManualVoucher` (search for a second `` `V-${...+1001}` `` or similarly-shaped intake-time numbering expression introduced by that phase). Convert its intake-time voucher-number assignment to `DRAFT_VOUCHER_NUMBER` as well — manual vouchers go through the exact same `applyReviewDecision` → `planReviewDecision` posting path, so once intake stops pre-assigning a number, posting-time numbering covers them automatically. Do **not** skip this step: if Phase B's manual-voucher planner still computes its own `V-<n>` at intake, manual vouchers and captured vouchers will silently collide on the same number sequence.
- [ ] Run `UNIT:file store-planning` — GREEN.

### E.1.3 — Integration test rework

- [ ] In `tests/integration/postgres-ledger.test.ts`, add `import { DRAFT_VOUCHER_NUMBER } from "@jpx-accounting/domain/store-shared";` and replace the final block of the concurrency test (was: `assert.equal(new Set(voucherNumbers).size, 8, ...)`):

  ```ts
  // Posting-time numbering (Phase E): freshly created vouchers are all still
  // drafts — same sentinel, not yet distinct.
  const snapshot = await storeA.getSnapshot();
  assert.ok(
    snapshot.vouchers.every((voucher) => voucher.voucherNumber === DRAFT_VOUCHER_NUMBER),
    "unposted vouchers all render the draft sentinel, not distinct numbers",
  );

  // The advisory-lock serialization guarantee this test protects now lives at
  // POSTING time — approve all 8 reviews concurrently (still racing storeA vs
  // storeB) and confirm no two get the same V-<n>.
  const reviewIds = snapshot.reviews.map((review) => review.id);
  assert.equal(reviewIds.length, 8);
  const half = Math.ceil(reviewIds.length / 2);
  await Promise.all([
    ...reviewIds.slice(0, half).map((id) => storeA.applyReviewDecision(id, "approve", {})),
    ...reviewIds.slice(half).map((id) => storeB.applyReviewDecision(id, "approve", {})),
  ]);
  const postedSnapshot = await storeA.getSnapshot();
  const postedNumbers = postedSnapshot.vouchers.map((voucher) => voucher.voucherNumber);
  assert.equal(new Set(postedNumbers).size, 8, "8 distinct posted voucher numbers under concurrency");
  ```

- [ ] `INTEG` (`corepack pnpm db:test`) — GREEN.
- [ ] `CHECK` — GREEN.
- [ ] Commit:

  ```
  feat(domain,persistence-postgres): assign voucher numbers at posting time, not intake (G8)

  Numbering moves from planEvidenceCreate to planReviewDecision's posting
  branch (approve / book-without-vat only — reject never burns a number).
  Unposted vouchers carry the shared DRAFT_VOUCHER_NUMBER ("Utkast") sentinel;
  every existing render site already treats voucherNumber as opaque text, so
  no UI changes are needed beyond a compliance-alert title disambiguation.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.2 — api-client: `createManualVoucher` + `composeEvidence`

**Depends on Phase B's contracts landing** (`ManualVoucherInput`, `ManualVoucherResult`, `manualVoucherResultSchema`) and Phase D's `evidenceComposeInputSchema.targetVoucherId`. **Files — Modify:** `packages/api-client/src/index.ts`, `tests/unit/api-client-demo-fallback.test.ts`.

- [ ] Add a failing test first in `tests/unit/api-client-demo-fallback.test.ts`:

  ```ts
  test("demo createManualVoucher posts through MemoryLedgerStore.createManualVoucher without network", async (t) => {
    const captured = mockFetch(t, () => jsonResponse({}));
    const client = createAccountingApiClient({ runtimeMode: "demo" });

    const result = await client.createManualVoucher({
      description: "Kontorsmaterial, kontant",
      bookedAt: "2026-08-10",
      lines: [
        { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" },
        { accountNumber: "1930", debit: 0, credit: 100, vatCode: "NA" },
      ],
    });

    manualVoucherResultSchema.parse(result);
    const snapshot = await client.getSnapshot();
    const review = snapshot.reviews.find((r) => r.id === result.reviewId);
    assert.ok(review, "manual voucher review must appear in the workspace snapshot");
    assert.equal(review?.status, "needs-review");
    assert.equal(captured.length, 0, "demo createManualVoucher must not fetch");
  });

  test("demo composeEvidence relinks evidence via MemoryLedgerStore.composeEvidence without network", async (t) => {
    const captured = mockFetch(t, () => jsonResponse({}));
    const client = createAccountingApiClient({ runtimeMode: "demo" });

    const created = await client.createEvidence(EVIDENCE_INPUT);
    const packet = await client.composeEvidence({
      evidenceIds: [created.evidence.id],
      targetVoucherId: created.voucher.id,
    });

    assert.deepEqual(packet.evidenceIds, [created.evidence.id]);
    assert.equal(captured.length, 0, "demo composeEvidence must not fetch");
  });
  ```

  Add `manualVoucherResultSchema` to the existing `@jpx-accounting/contracts` import at the top of the test file.

- [ ] Run `UNIT:file api-client-demo-fallback` — RED (methods don't exist yet, TS compile error).
- [ ] In `packages/api-client/src/index.ts`:
  - Add `EvidencePacket`, `ManualVoucherInput`, `ManualVoucherResult` to the `import type {...} from "@jpx-accounting/contracts"` block, and `evidencePacketSchema`, `manualVoucherResultSchema` to the value-schema import block.
  - Add the two methods (near `approveReview`/`createEvidence`, matching their exact demo-fallback-then-HTTP shape):

    ```ts
    /**
     * Manual N-line journal entry (`POST /api/vouchers/manual`): creates a
     * Voucher (`origin: "manual"`) + ReviewTask through the SAME review gate as
     * captured evidence — nothing posts until a human approves. No actorId: the
     * server (or the demo store) derives attribution (WS-C R5).
     */
    async createManualVoucher(input: ManualVoucherInput): Promise<ManualVoucherResult> {
      if (this.fallbackStore) return this.fallbackStore.createManualVoucher(input);
      if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
      return requestJson(this.authorizedFetch, this.baseUrl, "/api/vouchers/manual", manualVoucherResultSchema, {
        method: "POST",
        json: input,
      });
    }

    /**
     * Compose/relink evidence into a packet, optionally attached to a specific
     * voucher (`targetVoucherId`) — powers the evidence-detail "Koppla till
     * verifikation" picker. Matches `POST /api/evidence/compose`.
     */
    async composeEvidence(input: EvidenceComposeInput): Promise<EvidencePacket> {
      if (this.fallbackStore) return this.fallbackStore.composeEvidence(input);
      if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
      return requestJson(this.authorizedFetch, this.baseUrl, "/api/evidence/compose", evidencePacketSchema, {
        method: "POST",
        json: input,
      });
    }
    ```

    (`EvidenceComposeInput` is already imported in this file.)

- [ ] Run `UNIT:file api-client-demo-fallback` — GREEN.
- [ ] `CHECK`.
- [ ] Commit:

  ```
  feat(api-client): add createManualVoucher + composeEvidence client methods

  Both were domain/API-only until now (composeEvidence had zero client
  wiring). Demo-fallback branches call the in-memory store directly, matching
  every other mutation method's shape.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.3 — E2E spec for manual entry (written first, expected RED)

**Files — Create:** `tests/e2e/manual-entry.spec.ts`.

- [ ] Create the spec:

  ```ts
  import { expect, test } from "@playwright/test";

  import { activateControl, resetApiState } from "./test-helpers";

  test.beforeEach(async ({ request }) => {
    await resetApiState(request);
  });

  // Activated via `activateControl`: pointer click on desktop, keyboard on
  // mobile — see the helper's doc comment for the Pixel 7 viewport quirk.

  test("manual entry posts a balanced 2-line voucher through the review gate", async ({ page, isMobile }) => {
    await page.goto("/books");
    await activateControl(page.getByTestId("books-new-manual-entry"), isMobile);
    await expect(page.getByTestId("manual-entry-view")).toBeVisible();

    await page.getByTestId("manual-entry-description").fill("Kontorsmaterial, kontant");
    await page.getByTestId("manual-entry-booked-at").fill("2026-08-10");

    await page.getByTestId("manual-entry-account-0").fill("6110");
    await page.getByTestId("manual-entry-debit-0").fill("100");
    await page.getByTestId("manual-entry-account-1").fill("1930");
    await page.getByTestId("manual-entry-credit-1").fill("100");

    // Live öre-exact diff indicator reads zero once both legs match.
    await expect(page.getByTestId("manual-entry-diff")).toHaveText(/0,00/);
    await expect(page.getByTestId("manual-entry-submit")).toBeEnabled();

    await activateControl(page.getByTestId("manual-entry-submit"), isMobile);

    // Success resets the form (rows collapse back to two blanks) and lands
    // in the review queue — never posts directly (D2 invariant).
    await expect(page.getByTestId("manual-entry-account-0")).toHaveValue("");

    await page.goto("/today?view=queue");
    const cards = page.getByTestId("review-card");
    // The demo seed always contributes exactly one review ("Approve AI
    // subscription posting") — the manual entry is whichever OTHER card exists.
    const manualCard = cards.filter({ hasNotText: "Approve AI subscription posting" });
    await expect(manualCard).toHaveCount(1);

    await activateControl(manualCard.getByTestId("review-accept"), isMobile);
    await expect(manualCard.getByTestId("review-status").filter({ hasText: "approved" })).toHaveCount(1);

    // First-ever posted voucher after reset → V-1001; verbatim lines, no VAT leg.
    await page.goto("/books");
    const journal = page.getByTestId("journal-view");
    await expect(journal).toContainText("6110");
    await expect(journal).toContainText("1930");
    await expect(journal).toContainText("V-1001");
  });

  test("manual entry blocks submission while debits and credits do not balance", async ({ page }) => {
    await page.goto("/books?view=manual-entry");
    await expect(page.getByTestId("manual-entry-view")).toBeVisible();

    await page.getByTestId("manual-entry-description").fill("Obalanserad post");
    await page.getByTestId("manual-entry-account-0").fill("6110");
    await page.getByTestId("manual-entry-debit-0").fill("100");
    await page.getByTestId("manual-entry-account-1").fill("1930");
    await page.getByTestId("manual-entry-credit-1").fill("50");

    await expect(page.getByTestId("manual-entry-submit")).toBeDisabled();

    await page.getByTestId("manual-entry-credit-1").fill("100");
    await expect(page.getByTestId("manual-entry-submit")).toBeEnabled();
  });

  test("manual entry supports adding and removing rows, with a floor of two", async ({ page, isMobile }) => {
    await page.goto("/books?view=manual-entry");
    await expect(page.getByTestId("manual-entry-row-0")).toBeVisible();
    await expect(page.getByTestId("manual-entry-row-1")).toBeVisible();
    await expect(page.getByTestId("manual-entry-remove-row-0")).toBeDisabled();

    await activateControl(page.getByTestId("manual-entry-add-row"), isMobile);
    await expect(page.getByTestId("manual-entry-row-2")).toBeVisible();
    await expect(page.getByTestId("manual-entry-remove-row-0")).toBeEnabled();

    await activateControl(page.getByTestId("manual-entry-remove-row-2"), isMobile);
    await expect(page.getByTestId("manual-entry-row-2")).toHaveCount(0);
  });
  ```

- [ ] Run `E2E:file manual-entry.spec.ts` — confirm it **fails** (no `books-new-manual-entry` button, no `manual-entry-view` yet). This is the RED step; do not proceed to Task E.4 until you've watched it fail for the RIGHT reason (missing testids), not a typo in the spec itself.
- [ ] Commit (spec-only, expected-failing — acceptable per TDD convention when immediately followed by the implementation commit):

  ```
  test(e2e): add failing manual-entry spec ahead of the Books UI (Task E.4)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.4 — Manual-entry view + Books screen wiring + i18n (turns E.3 green)

**Depends on E.1, E.2, E.3.** **Files — Create:** `apps/web/components/books/manual-entry-view.tsx`. **Modify:** `apps/web/components/screens/books-screen.tsx`, `apps/web/messages/sv.json`, `apps/web/messages/en.json`.

- [ ] `apps/web/messages/sv.json` — add to the `books` object (alongside `close`):

  ```json
  "print": {
    "button": "Skriv ut / spara som PDF"
  },
  "newManualEntry": "Ny verifikation",
  "manualEntry": {
    "eyebrow": "Ny verifikation",
    "title": "Manuell bokföringspost",
    "description": "Bokför en verifikation med valfria konton. Posten läggs i granskningskön — inget bokförs direkt.",
    "descriptionLabel": "Beskrivning",
    "descriptionPlaceholder": "Vad gäller verifikationen?",
    "bookedAtLabel": "Bokföringsdatum",
    "accountLabel": "Konto",
    "accountPlaceholder": "Kontonummer",
    "accountInvalid": "Ange ett giltigt 4-siffrigt kontonummer.",
    "accountUnknown": "Konto utanför kontoplanen — bokförs ändå.",
    "debitLabel": "Debet",
    "creditLabel": "Kredit",
    "vatCodeLabel": "Momskod",
    "removeRow": "Ta bort",
    "removeRowAria": "Ta bort rad {row}",
    "addRow": "Lägg till rad",
    "totalDebit": "Summa debet",
    "totalCredit": "Summa kredit",
    "diff": "Differens",
    "imbalanceHint": "Summa debet måste vara lika med summa kredit innan verifikationen kan skickas.",
    "rowError": "Varje rad behöver ett giltigt konto och exakt ett belopp (debet eller kredit).",
    "submit": "Skicka till granskning",
    "submitting": "Skickar…",
    "createSuccess": "Verifikationen skapades och väntar på granskning.",
    "openReviewQueue": "Öppna granskningskön",
    "createError": "Verifikationen kunde inte skapas. Försök igen."
  }
  ```

  Mirror the identical key structure in `en.json` (`"button": "Print / save as PDF"`, `"newManualEntry": "New voucher"`, plain English strings for the rest — same keys, no structural drift).

- [ ] Create `apps/web/components/books/manual-entry-view.tsx`:

  ```tsx
  "use client";

  import type { ManualVoucherInput, VatCode } from "@jpx-accounting/contracts";
  import { vatCodeSchema } from "@jpx-accounting/contracts";
  import { defaultCoaTemplate, findCoaAccount, localTodayIso, postingImbalanceOre } from "@jpx-accounting/domain";
  import { isValidCalendarDay } from "@jpx-accounting/domain/store-shared";
  import { useMutation, useQueryClient } from "@tanstack/react-query";
  import { useTranslations } from "next-intl";
  import { useRouter } from "next/navigation";
  import { type FormEvent, useState } from "react";
  import { toast } from "sonner";

  import { apiClient } from "../../lib/client";
  import { getErrorMessage } from "../../lib/request-errors";
  import { invalidateLedgerDerived } from "../../lib/query-invalidation";
  import { Button } from "../ui/button";
  import { Money } from "../ui/money";

  const ACCOUNT_PATTERN = /^\d{4}$/;
  const MAX_ROWS = 100;

  type ManualEntryRow = {
    id: string;
    accountNumber: string;
    debit: string;
    credit: string;
    vatCode: VatCode;
  };

  function emptyRow(): ManualEntryRow {
    return { id: crypto.randomUUID(), accountNumber: "", debit: "", credit: "", vatCode: "NA" };
  }

  /** "" → 0 (blank leg); non-numeric stays out of the balance math via row validity, not silent 0. */
  function parseAmount(raw: string): number {
    const trimmed = raw.trim();
    if (trimmed === "") return 0;
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : 0;
  }

  function isRowValid(row: ManualEntryRow, debitNumber: number, creditNumber: number): boolean {
    if (!ACCOUNT_PATTERN.test(row.accountNumber)) return false;
    return debitNumber > 0 !== creditNumber > 0; // exactly one leg filled
  }

  export function ManualEntryView() {
    const t = useTranslations("books.manualEntry");
    const queryClient = useQueryClient();
    const router = useRouter();
    const localToday = localTodayIso();

    const [description, setDescription] = useState("");
    const [bookedAt, setBookedAt] = useState(localToday);
    const [rows, setRows] = useState<ManualEntryRow[]>(() => [emptyRow(), emptyRow()]);

    function updateRow(id: string, patch: Partial<ManualEntryRow>) {
      setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    }
    function addRow() {
      setRows((current) => (current.length >= MAX_ROWS ? current : [...current, emptyRow()]));
    }
    function removeRow(id: string) {
      setRows((current) => (current.length <= 2 ? current : current.filter((row) => row.id !== id)));
    }

    const parsedRows = rows.map((row) => ({
      ...row,
      debitNumber: parseAmount(row.debit),
      creditNumber: parseAmount(row.credit),
    }));
    const totalDebit = parsedRows.reduce((sum, r) => sum + r.debitNumber, 0);
    const totalCredit = parsedRows.reduce((sum, r) => sum + r.creditNumber, 0);
    const imbalanceOre = postingImbalanceOre(parsedRows.map((r) => ({ debit: r.debitNumber, credit: r.creditNumber })));
    const balanced = imbalanceOre === 0;
    const rowsValid = parsedRows.every((r) => isRowValid(r, r.debitNumber, r.creditNumber));
    const descriptionValid = description.trim().length > 0 && description.trim().length <= 200;
    const bookedAtValid = isValidCalendarDay(bookedAt) && bookedAt <= localToday;

    const createManualVoucher = useMutation({
      mutationFn: (input: ManualVoucherInput) => apiClient.createManualVoucher(input),
      onSuccess: () => {
        invalidateLedgerDerived(queryClient);
        setRows([emptyRow(), emptyRow()]);
        setDescription("");
        setBookedAt(localTodayIso());
        toast.success(t("createSuccess"), {
          action: { label: t("openReviewQueue"), onClick: () => router.push("/today?view=queue") },
        });
      },
    });

    const submitDisabled =
      !balanced ||
      !rowsValid ||
      !descriptionValid ||
      !bookedAtValid ||
      rows.length < 2 ||
      createManualVoucher.isPending;

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (submitDisabled) return;
      createManualVoucher.mutate({
        description: description.trim(),
        bookedAt,
        lines: rows.map((row) => ({
          accountNumber: row.accountNumber,
          debit: parseAmount(row.debit),
          credit: parseAmount(row.credit),
          vatCode: row.vatCode,
        })),
      });
    }

    return (
      <div className="space-y-4" data-testid="manual-entry-view" data-tour="books-manual-entry">
        <div className="glass-panel rounded-xl p-5">
          <p className="text-eyebrow">{t("eyebrow")}</p>
          <h2 className="mt-2 text-lg font-semibold">{t("title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="manual-entry-description" className="text-eyebrow block">
                  {t("descriptionLabel")}
                </label>
                <input
                  id="manual-entry-description"
                  data-testid="manual-entry-description"
                  type="text"
                  maxLength={200}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label htmlFor="manual-entry-booked-at" className="text-eyebrow block">
                  {t("bookedAtLabel")}
                </label>
                <input
                  id="manual-entry-booked-at"
                  data-testid="manual-entry-booked-at"
                  data-visual-mask
                  type="date"
                  max={localToday}
                  value={bookedAt}
                  onChange={(event) => setBookedAt(event.target.value)}
                  className="glass-panel-inset mt-2 w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                />
              </div>
            </div>

            <datalist id="manual-entry-coa-options">
              {defaultCoaTemplate.accounts.map((account) => (
                <option key={account.number} value={account.number}>
                  {account.name}
                </option>
              ))}
            </datalist>

            <div className="space-y-3">
              {rows.map((row, index) => {
                const debitNumber = parseAmount(row.debit);
                const creditNumber = parseAmount(row.credit);
                const accountValid = ACCOUNT_PATTERN.test(row.accountNumber);
                const amountValid = debitNumber > 0 !== creditNumber > 0;
                const accountName = findCoaAccount(defaultCoaTemplate, row.accountNumber)?.name;
                return (
                  <div
                    key={row.id}
                    className="glass-panel-inset rounded-lg p-3 sm:p-4"
                    data-testid={`manual-entry-row-${index}`}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto] sm:items-start">
                      <div>
                        <label htmlFor={`manual-entry-account-${index}`} className="text-eyebrow block sm:hidden">
                          {t("accountLabel")}
                        </label>
                        <input
                          id={`manual-entry-account-${index}`}
                          data-testid={`manual-entry-account-${index}`}
                          list="manual-entry-coa-options"
                          inputMode="numeric"
                          value={row.accountNumber}
                          onChange={(event) => updateRow(row.id, { accountNumber: event.target.value.trim() })}
                          placeholder={t("accountPlaceholder")}
                          className="glass-panel-inset w-full rounded-lg px-3 py-2 text-sm outline-none"
                        />
                        <p
                          className={`mt-1 text-xs ${row.accountNumber !== "" && !accountValid ? "text-danger" : "text-muted-foreground"}`}
                        >
                          {row.accountNumber === ""
                            ? ""
                            : accountValid
                              ? (accountName ?? t("accountUnknown"))
                              : t("accountInvalid")}
                        </p>
                      </div>
                      <div>
                        <label htmlFor={`manual-entry-debit-${index}`} className="text-eyebrow block sm:hidden">
                          {t("debitLabel")}
                        </label>
                        <input
                          id={`manual-entry-debit-${index}`}
                          data-testid={`manual-entry-debit-${index}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={row.debit}
                          onChange={(event) =>
                            updateRow(row.id, {
                              debit: event.target.value,
                              credit: event.target.value ? "" : row.credit,
                            })
                          }
                          className="glass-panel-inset w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor={`manual-entry-credit-${index}`} className="text-eyebrow block sm:hidden">
                          {t("creditLabel")}
                        </label>
                        <input
                          id={`manual-entry-credit-${index}`}
                          data-testid={`manual-entry-credit-${index}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={row.credit}
                          onChange={(event) =>
                            updateRow(row.id, {
                              credit: event.target.value,
                              debit: event.target.value ? "" : row.debit,
                            })
                          }
                          className="glass-panel-inset w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor={`manual-entry-vat-${index}`} className="text-eyebrow block sm:hidden">
                          {t("vatCodeLabel")}
                        </label>
                        <select
                          id={`manual-entry-vat-${index}`}
                          data-testid={`manual-entry-vat-${index}`}
                          value={row.vatCode}
                          onChange={(event) => updateRow(row.id, { vatCode: event.target.value as VatCode })}
                          className="glass-panel-inset w-full rounded-lg px-3 py-2 text-sm outline-none"
                        >
                          {vatCodeSchema.options.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        data-testid={`manual-entry-remove-row-${index}`}
                        aria-label={t("removeRowAria", { row: index + 1 })}
                        disabled={rows.length <= 2}
                        onClick={() => removeRow(row.id)}
                        className="mt-1 rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground disabled:opacity-40 sm:mt-6"
                      >
                        {t("removeRow")}
                      </button>
                    </div>
                    {!amountValid && (row.debit !== "" || row.credit !== "") ? (
                      <p className="mt-2 text-xs text-danger">{t("rowError")}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              data-testid="manual-entry-add-row"
              disabled={rows.length >= MAX_ROWS}
              onClick={addRow}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-40"
            >
              {t("addRow")}
            </button>

            <div className="glass-panel-soft rounded-lg p-4" data-testid="manual-entry-totals">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  {t("totalDebit")} <Money value={totalDebit} />
                </span>
                <span>
                  {t("totalCredit")} <Money value={totalCredit} />
                </span>
                <span
                  data-testid="manual-entry-diff"
                  className={balanced ? "font-semibold text-success" : "font-semibold text-danger"}
                >
                  {t("diff")} <Money value={imbalanceOre / 100} />
                </span>
              </div>
              {!balanced ? <p className="mt-2 text-xs text-danger">{t("imbalanceHint")}</p> : null}
            </div>

            {createManualVoucher.error ? (
              <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                {getErrorMessage(createManualVoucher.error, t("createError"))}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" data-testid="manual-entry-submit" disabled={submitDisabled}>
                {createManualVoucher.isPending ? t("submitting") : t("submit")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }
  ```

- [ ] `apps/web/components/screens/books-screen.tsx`:
  - Add `"manual-entry"` to the `views` tuple.
  - Import `ManualEntryView` from `../books/manual-entry-view`, `PrintHeader` from `../reports/print-header`, `nowIso` from `@jpx-accounting/domain`, and `useState` from `react`.
  - Add `const [generatedAt] = useState(() => nowIso());` inside `BooksScreen`.
  - Render `<PrintHeader generatedAt={generatedAt} />` as the FIRST child of the root `<div className="page-shell space-y-6">`, before `<ScreenHeader>` (matching `reports-screen.tsx`'s exact placement).
  - Replace the `aside` content with:

    ```tsx
    aside={
      <div className="flex flex-col items-end gap-3">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            data-testid="books-onboarding-help"
            onClick={() => startTour("books-period", { force: true })}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground print:hidden"
          >
            {tOnboarding("booksHelp")}
          </button>
          {view === "journal" || view === "general-ledger" ? (
            <button
              type="button"
              data-testid="books-print"
              onClick={() => window.print()}
              className="rounded-lg bg-surface-muted px-4 py-2 text-sm font-semibold text-foreground shadow-sm print:hidden"
            >
              {t("print.button")}
            </button>
          ) : null}
          {view !== "manual-entry" ? (
            <button
              type="button"
              data-testid="books-new-manual-entry"
              onClick={() => void setView("manual-entry")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm print:hidden"
            >
              {t("newManualEntry")}
            </button>
          ) : null}
        </div>
        <div className="print:hidden">
          <PeriodSelector />
        </div>
      </div>
    }
    ```

  - Add `{view === "manual-entry" ? <ManualEntryView /> : null}` to the view-switch `<section>`.

- [ ] Run `E2E:file manual-entry.spec.ts` — GREEN.
- [ ] `CHECK`.
- [ ] Commit:

  ```
  feat(web): manual-entry Books view — N-line form posting through the review gate

  "Ny verifikation" opens /books?view=manual-entry: searchable account field
  (datalist over the full CoA, free 4-digit entry accepted per the SIE-import
  precedent), per-row debit/credit + VAT code, live öre-exact Σdebit/Σkredit
  diff. Submits via createManualVoucher; success resets the form and toasts a
  link to the review queue — nothing posts directly.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.5 — Attach-to-voucher picker on evidence detail

**Depends on E.2 and Phase D's `targetVoucherId`.** **Files — Modify:** `apps/web/components/screens/evidence-detail-screen.tsx`, `tests/e2e/capture.spec.ts`, `apps/web/messages/sv.json`, `apps/web/messages/en.json`.

- [ ] Add the failing extension to `tests/e2e/capture.spec.ts` first:

  ```ts
  test("evidence detail can attach a receipt to a different, already-posted voucher", async ({
    page,
    isMobile,
    request,
  }) => {
    // Create a SECOND evidence+voucher+review directly (setup, not the flow
    // under test) and approve it so it carries a real V-number — attaching to
    // an "Utkast" target would be visually ambiguous (two drafts both render
    // "Utkast").
    const created = await request.post(`${apiBaseUrl}/api/evidence`, {
      data: { ...createEvidencePayload, title: "Second receipt for attach test" },
    });
    expect(created.ok()).toBeTruthy();
    const { review } = await created.json();
    const approved = await request.post(`${apiBaseUrl}/api/reviews/${review.id}/approve`, { data: {} });
    expect(approved.ok()).toBeTruthy();

    // Navigate to the SEEDED evidence (still needs-review) via the archive
    // search, which uniquely identifies it by its known constructor title.
    await page.goto("/capture");
    await page.getByTestId("evidence-search").fill("OpenAI subscription invoice");
    await activateControl(page.getByTestId("evidence-open").first(), isMobile);

    await expect(page.getByTestId("evidence-attach-picker")).toBeVisible();
    await page.getByTestId("evidence-attach-search").fill("Second receipt");
    const candidate = page.getByTestId("evidence-attach-picker").getByRole("listitem").first();
    await expect(candidate).toContainText("V-1001");
    await activateControl(candidate.getByRole("button"), isMobile);

    await expect(page.getByTestId("evidence-review-links")).toContainText("V-1001");
  });
  ```

  Add `apiBaseUrl` and `createEvidencePayload` to the existing `./test-helpers` import at the top of `capture.spec.ts` (only `activateControl` and `resetApiState` are imported today).

- [ ] Run `E2E:file capture.spec.ts` — confirm the new test fails (no `evidence-attach-picker` yet); the pre-existing tests in the file stay green.
- [ ] Add i18n — `evidence` namespace in `sv.json` (sibling of `links`):

  ```json
  "attach": {
    "title": "Koppla till verifikation",
    "description": "Sök upp en annan verifikation och koppla det här underlaget till den i stället.",
    "searchPlaceholder": "Sök på verifikatnummer, datum eller beskrivning…",
    "empty": "Inga andra verifikat att koppla till.",
    "attachButton": "Koppla",
    "attachSuccess": "Underlaget kopplades till verifikationen.",
    "attachError": "Kunde inte koppla underlaget. Försök igen."
  }
  ```

  Mirror in `en.json` with plain English strings.

- [ ] In `apps/web/components/screens/evidence-detail-screen.tsx`, add a new component and mount it after the `evidence-review-links` section:

  ```tsx
  function AttachToVoucherPicker({
    evidenceId,
    currentVoucherId,
  }: {
    evidenceId: string;
    currentVoucherId: string | undefined;
  }) {
    const t = useTranslations("evidence.attach");
    const queryClient = useQueryClient();
    const [query, setQuery] = useState("");
    const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => apiClient.getSnapshot() });

    const attach = useMutation({
      mutationFn: (targetVoucherId: string) =>
        apiClient.composeEvidence({ evidenceIds: [evidenceId], targetVoucherId }),
      onSuccess: () => {
        invalidateLedgerDerived(queryClient);
        toast.success(t("attachSuccess"));
      },
      onError: () => toast.error(t("attachError")),
    });

    const needle = query.trim().toLowerCase();
    const candidates = (workspaceQuery.data?.vouchers ?? [])
      .filter((voucher) => voucher.id !== currentVoucherId)
      .filter((voucher) => {
        if (!needle) return true;
        const haystack =
          `${voucher.voucherNumber} ${voucher.voucherFields.description ?? ""} ${voucher.voucherFields.supplierName ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, 20);

    return (
      <section className="glass-panel rounded-xl p-5" data-testid="evidence-attach-picker">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        <input
          data-testid="evidence-attach-search"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="glass-panel-inset mt-3 w-full rounded-lg px-3 py-2 text-sm outline-none"
        />
        {candidates.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="evidence-attach-empty">
            {t("empty")}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {candidates.map((voucher) => {
              const date =
                voucher.voucherFields.transactionDate ?? voucher.voucherFields.receiptDate ?? voucher.createdAt;
              const label = voucher.voucherFields.description ?? voucher.voucherFields.supplierName ?? "";
              return (
                <li
                  key={voucher.id}
                  className="glass-panel-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                >
                  <span className="text-sm">
                    <span className="text-mono font-semibold">{voucher.voucherNumber}</span>
                    {" · "}
                    <span data-visual-mask>{date.slice(0, 10)}</span>
                    {label ? ` · ${label}` : ""}
                  </span>
                  <Button size="sm" disabled={attach.isPending} onClick={() => attach.mutate(voucher.id)}>
                    {t("attachButton")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }
  ```

  Add `useQuery` (already imported), `toast` from `"sonner"`, and `invalidateLedgerDerived` from `"../../lib/query-invalidation"` to the file's imports. Mount it in `EvidenceDetailScreen` right after the `evidence-review-links` `</section>`:

  ```tsx
  <AttachToVoucherPicker evidenceId={evidence.id} currentVoucherId={voucher?.id} />
  ```

- [ ] Run `E2E:file capture.spec.ts` — GREEN (full file, not just the new test).
- [ ] `CHECK`.
- [ ] Commit:

  ```
  feat(web): "Koppla till verifikation" attach-to-voucher picker on evidence detail

  composeEvidence had zero client wiring before this — the picker searches the
  workspace snapshot's vouchers by number/date/description and relinks the
  evidence via targetVoucherId (Phase D).

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.6 — Print for journal + huvudbok

**Depends on E.1 (so printed numbers are real) and E.4 (books-screen already carries `PrintHeader` + `books-print`).** **Files — Modify:** `apps/web/components/books/journal-view.tsx`, `apps/web/components/books/general-ledger-view.tsx`, `tests/e2e/books-drilldown.spec.ts`.

- [ ] Add the failing print assertions to `tests/e2e/books-drilldown.spec.ts` first (mirrors `reports.spec.ts`'s `emulateMedia` pattern — no `window.print()` call needed to test the CSS/markup contract):

  ```ts
  test("print media on the journal view strips chrome and shows the print header", async ({ page }) => {
    await page.goto("/books");
    await expect(page.getByTestId("journal-view")).toBeVisible();

    await page.emulateMedia({ media: "print" });

    await expect(page.getByTestId("desktop-navigation")).toBeHidden();
    await expect(page.getByTestId("books-print")).toBeHidden();
    await expect(page.getByTestId("books-new-manual-entry")).toBeHidden();
    await expect(page.getByTestId("period-selector")).toBeHidden();
    await expect(page.getByTestId("report-print-header")).toBeVisible();
  });

  test("the print button only appears on the journal and general-ledger views", async ({ page }) => {
    await page.goto("/books?view=trial-balance");
    await expect(page.getByTestId("books-print")).toHaveCount(0);

    await page.goto("/books?view=general-ledger");
    await expect(page.getByTestId("books-print")).toBeVisible();
  });
  ```

- [ ] Run `E2E:file books-drilldown.spec.ts` — confirm the two new tests fail (`books-print`/`report-print-header` don't exist on Books yet — this is genuinely satisfied once E.4's books-screen.tsx changes land, so if E.4 is already done this step may already be GREEN for the chrome assertions; keep it here as the explicit regression pin for `break-inside-avoid` below).
- [ ] `apps/web/components/books/journal-view.tsx` — add `break-inside-avoid` to each `<TableRow>`:

  ```tsx
  <TableRow key={`${entry.voucherId}-${entry.accountNumber}`} className="break-inside-avoid">
  ```

- [ ] `apps/web/components/books/general-ledger-view.tsx` — add `break-inside-avoid` to each per-account `<details>` block:

  ```tsx
  <details key={accountNumber} className="glass-panel rounded-xl p-4 break-inside-avoid" open={accountNumber === account}>
  ```

- [ ] Run `E2E:file books-drilldown.spec.ts` — GREEN.
- [ ] `CHECK`.
- [ ] Commit:

  ```
  feat(web): print layout for the journal and general-ledger Books views

  Reuses PrintHeader + window.print() exactly as reports-screen — print:hidden
  chrome, break-inside-avoid rows so a printed grundbok/huvudbok doesn't split
  a posting mid-row.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## Task E.7 — Phase exit gate

**Depends on E.1–E.6.**

- [ ] `CHECK` (`corepack pnpm check`) — GREEN.
- [ ] `INTEG` (`corepack pnpm db:test`) — GREEN.
- [ ] `corepack pnpm build:e2e && corepack pnpm exec playwright test tests/e2e/manual-entry.spec.ts tests/e2e/capture.spec.ts tests/e2e/books-drilldown.spec.ts tests/e2e/review-edit.spec.ts tests/e2e/reports.spec.ts` — GREEN (the last two are the closest-neighbor specs most likely to regress from the numbering/print changes).
- [ ] Grep-verify no stray reference to the old `planEvidenceCreate` `voucherIndex` field or the old bare-string `planReviewDecision` 5th argument remains anywhere (`rg "voucherIndex" packages tests`, `rg "planReviewDecision\(" -A1 packages tests` and eyeball each call).
- [ ] **Named conversion target (Fable review 2026-08-20):** Phase B's `planManualVoucher` (`packages/domain/src/store-planning.ts`) still takes `ctx.voucherIndex` and assigns `V-<n>` at plan time — convert it to `DRAFT_VOUCHER_NUMBER` exactly like `planEvidenceCreate`, drop its `voucherIndex` ctx field, and update B Task 5's test pin (`assert.equal(plan.voucher.voucherNumber, "V-1004")` → the sentinel; the verbatim-lines/approval test gets its real number from the posting branch instead).
- [ ] Re-read `docs/superpowers/plans/2026-08-20-kfr-master.md`'s Verification section item 2 (E2E: new specs for manual entry, attach-to-voucher, RC25) — confirm the RC25 review-path spec is NOT this phase's responsibility (it belongs to whichever phase owns the review-edit-sheet VAT-code select and RC25 posting shape — Phase B/D territory) and hasn't been silently dropped.
- [ ] Commit (only if the above steps produced any residual fixups; otherwise this task is verification-only and needs no commit):

  ```
  chore(kfr-e): phase exit verification — full check + targeted e2e green

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
