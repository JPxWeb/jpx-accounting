# Repo-Health Wave B — Ledger Honesty Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Wave B ledger honesty — verify P0-2 already landed in Wave A, extract shared store planners (P1-2), then unify projection line collection on event replay (P1-3).

**Architecture:** Keep `LedgerStore → MemoryLedgerStore | PostgresLedgerStore`. Planners in `packages/domain` return pure planned events (no id/hash); stores persist only. Projection lines come from `collectLedgerLinesFromEvents` over `PostedToLedger` / `VoucherImported` payloads; Memory keeps its ctor-frozen demo seed concatenated on read.

**Tech Stack:** Node ≥24, pnpm 10.29.2, Zod v4 contracts, `MemoryLedgerStore` + `PostgresLedgerStore`, `tsx --test`, `pnpm db:test` (throwaway `jpx_test_*`).

**Branch / worktree choice:** New branch `feat/repo-health-wave-b` created from Wave A HEAD (`2af7b7f` on `feat/repo-health-wave-a`). Worktree: `.worktrees/feat-repo-health-wave-b`. Rationale: Wave A first-slice PR stays reviewable; Wave B continues its commits without mixing wave labels. Do **not** branch from `main` or `feat/db-lifecycle-plan-v2` — those lack Wave A landings.

**Parent sources:** [`2026-08-06-repo-health-execution-handover.md`](../2026-08-06-repo-health-execution-handover.md), consolidation plan Wave B §6 + P0-2/P1-2/P1-3 in [`2026-08-06-repo-health-consolidation-plan.md`](./2026-08-06-repo-health-consolidation-plan.md).

## Global Constraints

- Append-only events; never rewrite history. Review queue is the only path to a posted voucher.
- Store parity: any `LedgerStore` behavior change lands in **both** Memory and Postgres (shared helpers in `packages/domain`). P0-2 demo-seed exception stands: Memory keeps ctor seed; Postgres has **no** seed prepend.
- Fail closed in `normal`; demo is explicit and labeled.
- Article 50 hard date **2026-08-02** (do not change Art. 50 surfaces in this wave).
- i18n parity: **Wave B touches zero `messages/*.json` keys** — no message-file owner this wave.
- Grep-gated seams unchanged (`@dnd-kit`, `ai`/`@ai-sdk`, recharts).
- Windows: `$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"` before every pnpm call; PowerShell uses `;` not `&&`.
- Do not churn DB lifecycle (`compose.db.yml`, `scripts/db*.mts`) — Wave B has no authorized carve-out.
- **NEVER delete** `apps/web/components/advisor/tool-approval.ts`.
- Pins (Next 16.2.12 / hono 4.12.34 / @hono/node-server 1.19.17) are **Wave C** — do not bump deps here.
- P2-15 dropped; P1-4 Unavailable\* + `/ready` is Wave G — out of scope.
- `buildExcerpt` → reporting never domain — out of scope.
- AGENTS.md agent protocol for this wave: **subagents never build or commit**; orchestrator centralizes `pnpm check` / `pnpm db:test` and conventional commits after each task's review gate.
- Owner open questions (do **not** decide): Art. 50 counsel, JWT tenant claims, `WEBSITES_CONTAINER_STOP_TIME_LIMIT` deploy verify, P0-4 share-under-auth product choice.

## Re-verification deltas (2026-08-06, against `feat/repo-health-wave-b` @ `2af7b7f`)

| Item                      | Consolidation plan claim                                        | Live tree                                                                                                                                                                                                                                                                                                                                                      | Action                   |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **P0-2** seed prepend     | PG `collectLedgerLines` prepends `initialLedgerLines()` @ ~1311 | **ALREADY FIXED** — PG `collectLedgerLines` @ `packages/persistence-postgres/src/store.ts:1310-1332` starts `const lines: LedgerLine[] = []`; doc comment says no demo seed; import of `initialLedgerLines` removed from PG store                                                                                                                              | **Verify only** — Task 1 |
| **P0-2** seed helper      | Optional `initialLedgerLines(bookedAt?)`                        | **ALREADY FIXED** — `packages/domain/src/evidence-defaults.ts:103` `export function initialLedgerLines(bookedAt: string = nowIso())`                                                                                                                                                                                                                           | Verify only              |
| **P0-2** pins             | Update 5→2 @ :839, 3+2→2 @ :1937, add empty-reports             | **ALREADY FIXED** — empty pin @ `postgres-ledger.test.ts:780-788`; unfiltered `journal.length === 2` @ `:834`; legacy `=== 2` @ `:1894` (line drift vs plan 839/1937)                                                                                                                                                                                          | Verify only              |
| **P1-2** planners         | Extract `store-planning.ts`                                     | **Still open** — no `store-planning.ts`; `AUTO_DETECTED_KINDS` still private @ `domain/store.ts:424`; create/decision/extraction bodies still duplicated (Memory `createEvidenceSync` `:687`, `applyReviewDecision` `:1113`, `updateEvidenceExtraction` `:890`; PG `createEvidence` `:601`, `applyReviewDecision` `:1470`, `updateEvidenceExtraction` `:1012`) | Implement Tasks 2–3      |
| **P1-2** chain assert     | Soft break + fields-only                                        | **Still open** — `ledger-store-conformance.ts:363-387` still early-`break`s; no `chainLinear` flag; 7 scenarios, no reject/edit scenario                                                                                                                                                                                                                       | Implement Task 3         |
| **P1-3** shared collector | `collectLedgerLinesFromEvents`                                  | **Still open** — PG private loop @ `:1310-1332`; Memory still `ledgerLines.push` @ `:1016` / `:1192` and reads array in `getReports` `:1056` / `getReportPack` `:1065`                                                                                                                                                                                         | Implement Task 4         |
| Line-number drift         | Plan cites pre-Wave-A lines                                     | Wave A shifted some PG/test lines; citations below use **current** locations                                                                                                                                                                                                                                                                                   | Cite live lines in tasks |

**§6 conflict resolutions that bind Wave B (exact order):**

1. **P0-2 before P1-3** — seed-prepend already settled; Task 4 must not reintroduce prepend.
2. **P1-2 before / with shared collectors** — planners return events whose `PostedToLedger.payload.lines` remain replay truth; Task 2 must preserve that payload shape.
3. **P1-2 pin churn = red flag** — planner wiring must keep `postgres-ledger.test.ts` pins green with **zero** intentional pin edits (P0-2 already updated them).
4. **Planners re-entrant inside PG `withChainForkRetry`** — call planners **inside** the transaction closure; planned events have no id/hash.
5. **No `messages/*.json`** this wave.

## File ownership (disjoint)

| Task | Owner surfaces                | May touch                                                                                                                                                                                              |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | verify-only                   | read-only (+ progress ledger)                                                                                                                                                                          |
| 2    | domain planners + both stores | `packages/domain/src/store-planning.ts` (new), `packages/domain/src/store.ts`, `packages/domain/src/index.ts`, `packages/persistence-postgres/src/store.ts`, `tests/unit/store-planning.test.ts` (new) |
| 3    | conformance helpers           | `tests/integration/helpers/ledger-store-conformance.ts` (+ callers if outcome shape requires), optionally thin asserts in `tests/integration/*` that read new flags                                    |
| 4    | projection collection         | `packages/domain/src/projections.ts`, `packages/domain/src/store.ts`, `packages/persistence-postgres/src/store.ts`, `tests/unit/ledger-store.test.ts`                                                  |

**Never touch this wave:** `messages/*`, `apps/web/**` (except if a type import breaks — should not), dep pins, `scripts/db*.mts`, advisor/tool-approval, Art. 50 docs.

## Verification gates

| Gate            | When                                      | Command (Windows PATH first)                                                                            |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit planners   | Task 2                                    | `tsx --test tests/unit/store-planning.test.ts`                                                          |
| Unit ledger     | Tasks 2–4                                 | `tsx --test tests/unit/ledger-store.test.ts`                                                            |
| Unit suite      | After Tasks 2–4                           | `pnpm test:unit`                                                                                        |
| Typecheck       | After Tasks 2–4                           | `pnpm typecheck` ; `pnpm typecheck:tests`                                                               |
| Integration     | After Tasks 2–4 (required Wave B gate)    | `pnpm db:test`                                                                                          |
| Full merge gate | Wave B complete                           | `pnpm check` then note format:check CRLF baseline caveat from Wave A                                    |
| E2E             | Only if opening a PR that needs the label | `pnpm build:e2e` then Playwright; apply `run-e2e` on the PR — **default: no push/PR** unless human asks |

---

### Task 1: P0-2 verify-only (ALREADY FIXED)

**Files:**

- Read: `packages/persistence-postgres/src/store.ts:1303-1332`
- Read: `packages/domain/src/evidence-defaults.ts:103`
- Read: `tests/integration/postgres-ledger.test.ts:780-834`, `:1894`
- Modify: none (code). Update `.superpowers/sdd/progress.md` only after verify.

**Interfaces:**

- Consumes: Wave A commits that removed PG seed prepend
- Produces: confirmation that Tasks 2–4 may proceed without redoing P0-2

- [ ] **Step 1: Confirm PG collectLedgerLines has no seed prepend**

```bash
# from worktree
rg -n "initialLedgerLines\(" packages/persistence-postgres/src/store.ts
# Expected: comments only, NO call expression
rg -n "private async collectLedgerLines" -A 25 packages/persistence-postgres/src/store.ts
# Expected: `const lines: LedgerLine[] = [];` then SELECT payload WHERE PostedToLedger|VoucherImported
```

- [ ] **Step 2: Confirm seed helper + integration pins**

```bash
rg -n "export function initialLedgerLines" -A 2 packages/domain/src/evidence-defaults.ts
# Expected: bookedAt: string = nowIso()
rg -n "honest empty workspace|no demo seed|journal.length, 2" tests/integration/postgres-ledger.test.ts
# Expected: fresh-namespace empty pin + length===2 pins present
```

- [ ] **Step 3: Optional smoke `pnpm db:test` if Docker available**

Expected: pass (including empty-reports pin). If Docker unavailable, document BLOCKED-for-smoke but do **not** re-implement P0-2; proceed — Wave A already ran `pnpm db:test` 70/70.

- [ ] **Step 4: Orchestrator commit** — none for code. Append progress ledger: `Task 1 (P0-2 verify): complete — ALREADY FIXED, no redo`.

---

### Task 2: P1-2 Extract shared store planners + wire both stores

**Files:**

- Create: `packages/domain/src/store-planning.ts`
- Create: `tests/unit/store-planning.test.ts`
- Modify: `packages/domain/src/index.ts` (add `export * from "./store-planning";`)
- Modify: `packages/domain/src/store.ts` — Memory consumes planners; export/replace `AUTO_DETECTED_KINDS` with import from planning module
- Modify: `packages/persistence-postgres/src/store.ts` — PG consumes planners inside tx / `withChainForkRetry` closures
- Test: `tests/unit/store-planning.test.ts`, keep green `tests/unit/ledger-store.test.ts`
- **Do not** edit `postgres-ledger.test.ts` pins in this task

**Interfaces:**

- Consumes: existing `resolveReviewDecisionEdit`, `buildPostingLines`, `buildExtractedFields`, `deriveVoucherFields`, `guessAccountingMethod`, `evaluateVoucherRules`, `buildDeterministicSuggestion`, `detectComplianceIssues`, `DEMO_ACTOR_ID`, `ActorAttribution`, `createId`, `nowIso`, `DEFAULT_TENANT_SCOPE` / local defaults
- Produces (exact):

```typescript
// packages/domain/src/store-planning.ts
export type PlannedEvent = Omit<LedgerEvent, "id" | "previousHash" | "eventHash" | "digestDate">;

export type EvidenceCreatePlan = {
  evidence: EvidenceObject;
  packet: EvidencePacket;
  voucher: Voucher;
  review: ReviewTask;
  suggestion: AccountingSuggestion;
  events: PlannedEvent[];
};

export function planEvidenceCreate(
  input: EvidenceCreateInput & ActorAttribution,
  ctx: { voucherIndex: number; now?: string; organizationId: string; workspaceId: string },
): EvidenceCreatePlan;

export type ReviewDecisionPlan =
  | { kind: "replay"; review: ReviewTask }
  | {
      kind: "apply";
      updatedReview: ReviewTask;
      updatedVoucher: Voucher;
      postingSuggestion: AccountingSuggestion | undefined;
      lines: LedgerLine[] | undefined;
      events: PlannedEvent[];
    };

export function planReviewDecision(
  review: ReviewTask,
  voucher: Voucher,
  action: ReviewAction,
  input: ReviewDecisionInput & ActorAttribution,
  now?: string,
): ReviewDecisionPlan;

export type ExtractionRefreshPlan =
  | { kind: "unchanged"; context: EvidenceContext }
  | {
      kind: "apply";
      context: EvidenceContext;
      updatedVoucher: Voucher;
      updatedReview: ReviewTask | undefined;
      suggestion: AccountingSuggestion;
      events: PlannedEvent[];
    };

export function planExtractionRefresh(/* mirror shared Memory/PG body steps 1–8 */): ExtractionRefreshPlan;

export const AUTO_DETECTED_ALERT_KINDS: ReadonlySet<string> = new Set(["stale-blocked", "missing-supplier-vat"]);

export type ComplianceMergePlan = { upserts: ComplianceAlert[]; resolveIds: string[] };

export function planComplianceMerge(
  existingAutoOpen: Array<{ id: string }>,
  detected: ComplianceAlert[],
): ComplianceMergePlan;
```

Planners MUST be pure + re-entrant: no memoized ids across calls; every call regenerates `createId(...)` when planning fresh entities/events.

- [ ] **Step 1: Write failing unit tests** (`tests/unit/store-planning.test.ts`)

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  planEvidenceCreate,
  planReviewDecision,
  AUTO_DETECTED_ALERT_KINDS,
  planComplianceMerge,
} from "../../packages/domain/src/store-planning.ts";
import type { ReviewTask, Voucher } from "@jpx-accounting/contracts";

describe("planEvidenceCreate", () => {
  it("numbers vouchers from voucherIndex and emits 4 events with extractor/ai sentinels", () => {
    const plan = planEvidenceCreate(
      {
        title: "Test",
        modalities: ["image"],
        originalFilename: "x.jpg",
        mimeType: "image/jpeg",
        actorId: "user:test",
      },
      {
        voucherIndex: 0,
        now: "2026-03-15T12:00:00.000Z",
        organizationId: "org_jpx",
        workspaceId: "workspace_main",
      },
    );
    assert.equal(plan.voucher.voucherNumber, "V-1001");
    assert.deepEqual(
      plan.events.map((e) => e.eventType),
      ["EvidenceReceived", "FieldsExtracted", "VoucherCreated", "SuggestionGenerated"],
    );
    assert.equal(plan.events[1]?.actorId, "system-extractor");
    assert.equal(plan.events[3]?.actorId, "system-ai");
    for (const event of plan.events) {
      assert.equal("id" in event && (event as { id?: string }).id, undefined);
      assert.equal((event as { previousHash?: string }).previousHash, undefined);
      assert.equal((event as { eventHash?: string }).eventHash, undefined);
    }
  });

  it("sets blocked review copy when rules are blocking", () => {
    // Use an input that triggers blocking rules (missing supplier/VAT) — assert
    // blockedReason + suggestedAction match the Memory literals exactly:
    // "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
    // "Request more evidence or post without VAT deduction."
  });
});

describe("planReviewDecision", () => {
  it("returns replay when review is already decided", () => {
    const review = { id: "r1", status: "approved", voucherId: "v1" /* …minimal */ } as ReviewTask;
    const voucher = { id: "v1", status: "approved" /* …minimal */ } as Voucher;
    const plan = planReviewDecision(review, voucher, "approve", { actorId: "user:x" });
    assert.equal(plan.kind, "replay");
  });

  it("reject produces decision event without PostedToLedger", () => {
    // needs-review review + voucher → kind apply, events eventTypes = [ReviewRejected] only
  });

  it("edited approve threads resolveReviewDecisionEdit into PostedToLedger payload", () => {
    // build a voucher+suggestion pair that accepts a valid edit; assert lines defined
    // and payload.edited present on decision event
  });
});

describe("planComplianceMerge", () => {
  it("exports AUTO_DETECTED_ALERT_KINDS and resolveIds for missing detections", () => {
    assert.ok(AUTO_DETECTED_ALERT_KINDS.has("stale-blocked"));
    const plan = planComplianceMerge([{ id: "a1" }, { id: "a2" }], [{ id: "a2" } as never]);
    assert.deepEqual(plan.resolveIds, ["a1"]);
  });
});
```

Fill the skipped bodies by copying the exact blocked strings and a minimal valid edit from `tests/unit/ledger-store.test.ts` patterns.

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
tsx --test tests/unit/store-planning.test.ts
```

Expected: FAIL — module/export missing.

- [ ] **Step 3: Implement `store-planning.ts`**

Move the shared orchestration bodies from Memory (`createEvidenceSync` ~687–814, `applyReviewDecision` decision core ~1119–1206, `updateEvidenceExtraction` steps 1–8 ~890–997) into pure planners. Use `ctx.organizationId` / `ctx.workspaceId` (pass `DEFAULT_TENANT_SCOPE` fields from Memory; PG passes `this.defaults.*`).

`planReviewDecision` must:

1. If `review.status !== "needs-review"` → `{ kind: "replay", review: { ...review } }`
2. Else apply edit via `resolveReviewDecisionEdit` when `edited` present (non-reject)
3. Build status/timeline/eventType maps identical to current Memory
4. Emit decision `PlannedEvent` + optional `PostedToLedger` with `payload: { action, suggestion, lines }` via `buildPostingLines`
5. Return `lines` for Memory cache push (Task 4 will later drop that push)

`planExtractionRefresh`: preserve step comments 1–8 semantics; return `unchanged` when extraction hash/fields match current short-circuit.

`planComplianceMerge`:

```typescript
export function planComplianceMerge(
  existingAutoOpen: Array<{ id: string }>,
  detected: ComplianceAlert[],
): ComplianceMergePlan {
  const detectedIds = new Set(detected.map((a) => a.id));
  return {
    upserts: detected,
    resolveIds: existingAutoOpen.filter((r) => !detectedIds.has(r.id)).map((r) => r.id),
  };
}
```

- [ ] **Step 4: Wire MemoryLedgerStore**

- `createEvidenceSync`: after dedupe check, `const plan = planEvidenceCreate(input, { voucherIndex: this.vouchers.size, organizationId: defaultOrganizationId, workspaceId: defaultWorkspaceId });` then set maps from plan + `appendEvent` each planned event (Memory `appendEvent` still derives hash/id).
- `applyReviewDecision`: `const plan = planReviewDecision(...); if (plan.kind === "replay") return plan.review;` else write maps, push `plan.lines` if present, append planned events.
- `updateEvidenceExtraction`: consume `planExtractionRefresh`.
- Replace local `AUTO_DETECTED_KINDS` with `AUTO_DETECTED_ALERT_KINDS` import.
- Alert rebuild may use `planComplianceMerge` for resolveIds; keep Memory pass-through semantics for acknowledged/dismissed.

- [ ] **Step 5: Wire PostgresLedgerStore**

- Inside existing `sql.begin` + `lockWorkspaceTail` + `withChainForkRetry` closures, call planners **each retry** (re-entrant).
- Keep SQL INSERTs; source values from plan objects; feed `plan.events` through PG `appendEvent(tx, event, previousHash)`.
- Replace inline kind array at alert SQL (`ANY(${["stale-blocked", "missing-supplier-vat"]})`) with `ANY(${[...AUTO_DETECTED_ALERT_KINDS]})`.
- Do **not** change report pins or reintroduce seed prepend.

- [ ] **Step 6: Export from barrel**

```typescript
// packages/domain/src/index.ts — add among domain exports:
export * from "./store-planning";
```

- [ ] **Step 7: Run unit tests — expect PASS**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
tsx --test tests/unit/store-planning.test.ts
tsx --test tests/unit/ledger-store.test.ts
pnpm typecheck
pnpm typecheck:tests
```

Expected: all PASS. Zero intentional changes to `postgres-ledger.test.ts`.

- [ ] **Step 8: Orchestrator commits** (implementer does not commit)

```powershell
git add packages/domain/src/store-planning.ts packages/domain/src/index.ts packages/domain/src/store.ts packages/persistence-postgres/src/store.ts tests/unit/store-planning.test.ts
git commit -m "$(cat <<'EOF'
refactor(domain): extract shared ledger store planners

Move evidence-create, review-decision, and extraction-refresh orchestration
into pure re-entrant planners so Memory and Postgres persist the same plan.
EOF
)"
```

---

### Task 3: P1-2 Harden conformance chainLinear + reject/edit scenarios

**Files:**

- Modify: `tests/integration/helpers/ledger-store-conformance.ts`
- Modify: any integration runner that asserts scenario outcome keys (grep `chainFieldsPresent` / `CONFORMANCE_SCENARIOS`)
- Test via: `pnpm db:test`

**Interfaces:**

- Consumes: planners from Task 2 (behavior-preserving)
- Produces: `chainLinear` + `chainFieldsPresent` on append-only scenario; two new scenarios in `CONFORMANCE_SCENARIOS`

- [ ] **Step 1: Write the hardened assert (replace soft walk)**

In `scenarioAppendOnlyEventVocabulary`, replace the early-break previousHash walk (`:363-387` current) with full-stream linearity on **all** events from `getEvents()` (plan § sketch — both stores are linear per workspace namespace for this scenario):

```typescript
const all = await h.store.getEvents();
const chainLinear = all.every((e, i) => i === 0 || e.previousHash === all[i - 1]!.eventHash);
const chainFieldsPresent = all.every((e) => Boolean(e.previousHash) && Boolean(e.eventHash));

return {
  vocabulary,
  hasEvidenceReceived: vocabulary.includes("EvidenceReceived"),
  // ...existing has* flags...
  hasPostedToLedger: vocabulary.includes("PostedToLedger"),
  chainLinear,
  chainFieldsPresent,
};
```

Keep the existing `relevant`/`vocabulary` computation for the has\* flags (those stay aggregate-filtered). Linearity uses `all`.

- [ ] **Step 2: Add reject scenario + edited-decision scenario**

```typescript
export async function scenarioReviewReject(h: ConformanceHarness): Promise<ConformanceOutcome> {
  const created = await h.store.createEvidence({
    /* minimal valid */ title: "...",
    modalities: ["image"],
    originalFilename: "r.jpg",
    mimeType: "image/jpeg",
    actorId: h.actorId,
  });
  const before = (await h.store.getReports()).journal.length;
  await h.store.applyReviewDecision(created.review.id, "reject", { actorId: h.actorId });
  const after = (await h.store.getReports()).journal.length;
  const events = await h.store.getEvents();
  return {
    journalDelta: after - before, // expect 0
    hasReviewRejected: events.some((e) => e.eventType === "ReviewRejected"),
    hasPostedToLedger: events.some(
      (e) => e.eventType === "PostedToLedger" && (e.payload as { voucherId?: string }).voucherId === created.voucher.id,
    ), // expect false — payload may key differently; assert no new PostedToLedger after reject by journalDelta + event scan for this review's decision path
  };
}

export async function scenarioReviewApproveEdited(h: ConformanceHarness): Promise<ConformanceOutcome> {
  // Create evidence, approve with a valid `edited` payload (copy a working edit
  // from tests/unit/ledger-store.test.ts or postgres-ledger edit pins).
  // Assert journalDelta > 0 and decision event payload includes `edited`.
}
```

Register both in `CONFORMANCE_SCENARIOS`. Shape must satisfy `assertConformanceParity` (identical keys Memory vs Postgres).

- [ ] **Step 3: Run `pnpm db:test`**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
pnpm db:test
```

Expected: all conformance ×3 (memory/postgres/parity) green including new scenarios; `postgres-ledger.test.ts` unchanged pins green. If `chainLinear` fails, diagnose real ordering bugs — do **not** soften the assert.

- [ ] **Step 4: Orchestrator commit**

```text
test(integration): harden ledger chainLinear and add reject/edit conformance
```

---

### Task 4: P1-3 Unify projection collection on event replay

**Files:**

- Modify: `packages/domain/src/projections.ts` — add `collectLedgerLinesFromEvents`
- Modify: `packages/domain/src/store.ts` — Memory option **(a)**: frozen `seedLines` + replay; delete push sites
- Modify: `packages/persistence-postgres/src/store.ts` — `collectLedgerLines` delegates to shared helper (keep filtered SQL)
- Modify: `tests/unit/ledger-store.test.ts` — add seed+replay equivalence pin
- Test: `tsx --test tests/unit/ledger-store.test.ts` ; `pnpm db:test`

**Interfaces:**

- Consumes: Task 1 (no PG seed); Task 2 (`PostedToLedger.payload.lines` still present)
- Produces:

```typescript
export function collectLedgerLinesFromEvents(events: Array<Pick<LedgerEvent, "eventType" | "payload">>): LedgerLine[];
```

- [ ] **Step 1: Write failing unit test for replay equivalence**

In `tests/unit/ledger-store.test.ts`, add:

```typescript
it("getReports journal equals seed lines plus event-payload replay", async () => {
  const store = new MemoryLedgerStore();
  const seedCount = (await store.getReports()).journal.length; // demo seed
  const created = await store.createEvidence({
    /* … */
  });
  await store.applyReviewDecision(created.review.id, "approve", { actorId: "user:test" });
  // Optional: importSie small fixture if existing tests already have one handy
  const reports = await store.getReports();
  const events = await store.getEvents();
  const replayed = collectLedgerLinesFromEvents(events);
  assert.equal(reports.journal.length, seedCount + replayed.length);
  // deep-equal journal account numbers / amounts vs filterLedgerLines([...seed..., ...replayed])
});
```

- [ ] **Step 2: Run — expect FAIL** (helper missing or inequality if only half-wired)

- [ ] **Step 3: Implement helper in `projections.ts`**

```typescript
import type { LedgerEvent } from "@jpx-accounting/contracts";

const LINE_CARRYING_EVENT_TYPES = new Set(["PostedToLedger", "VoucherImported"]);

export function collectLedgerLinesFromEvents(events: Array<Pick<LedgerEvent, "eventType" | "payload">>): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const event of events) {
    if (!LINE_CARRYING_EVENT_TYPES.has(event.eventType)) continue;
    const payloadLines = (event.payload as { lines?: unknown }).lines;
    if (Array.isArray(payloadLines)) lines.push(...(payloadLines as LedgerLine[]));
  }
  return lines;
}
```

- [ ] **Step 4: Memory option (a)**

```typescript
private readonly seedLines: LedgerLine[] = assertBalancedPosting(initialLedgerLines(), "demo seed lines");
// DELETE this.ledgerLines mutable array and all ledgerLines.push sites

async getReports(range?: ReportRange): Promise<ReportBundle> {
  const lines = filterLedgerLines(
    [...this.seedLines, ...collectLedgerLinesFromEvents(this.events)],
    range,
  );
  return { journal: buildJournal(lines), balances: buildBalances(lines), vat: buildVat(lines) };
}

async getReportPack(input: { period: string }): Promise<ReportPack> {
  const lines = [...this.seedLines, ...collectLedgerLinesFromEvents(this.events)];
  return buildReportPack(lines, { /* existing args */ });
}
```

Ensure `this.events` is the in-memory event list already used by `getEvents()` / `appendEvent`.

- [ ] **Step 5: Postgres delegates**

```typescript
private async collectLedgerLines(): Promise<LedgerLine[]> {
  const rows = await this.client<{ event_type: string; payload: Record<string, unknown> }[]>`
    SELECT event_type, payload FROM ledger.events
    WHERE event_type = ANY(${["PostedToLedger", "VoucherImported"]})
      AND organization_id = ${this.defaults.organizationId}
      AND workspace_id = ${this.defaults.workspaceId}
    ORDER BY seq ASC`;
  return collectLedgerLinesFromEvents(
    rows.map((r) => ({
      eventType: r.event_type as LedgerEvent["eventType"],
      payload: r.payload,
    })),
  );
}
```

Do **not** prepend seed.

- [ ] **Step 6: Verify**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
tsx --test tests/unit/ledger-store.test.ts
pnpm test:unit
pnpm typecheck
pnpm typecheck:tests
pnpm db:test
```

Expected: all green; Memory journal ordering unchanged (seed first, then event order); PG pins unchanged.

- [ ] **Step 7: Orchestrator commit**

```text
refactor(domain): unify ledger line collection via event replay
```

---

### Task 5: Wave B verification + progress ledger + simplify pass

**Files:** `.superpowers/sdd/progress.md`; no product code unless simplify finds Critical/Important.

- [ ] **Step 1: Orchestrator runs full gates**

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
pnpm check
pnpm db:test
```

Record exit codes. If `format:check` fails on the ~400-file CRLF baseline (Wave A residual), note it — do not mass-reformat.

- [ ] **Step 2: Final whole-branch review** (SDD) on `2af7b7f..HEAD` Wave B commits only; then `code-simplifier` on the Wave B batch.

- [ ] **Step 3: Update progress ledger** with commits per task + residual minors + owner escalations unchanged.

- [ ] **Step 4: Do not push/PR** unless human requests; E2E label is for PR time.

---

## Self-review (plan author)

1. **Spec coverage:** Wave B items P0-2 (verify), P1-2 (planners + conformance), P1-3 (collector) each have tasks. §6 order encoded. No Wave C/D/G bleed.
2. **Placeholder scan:** Test stubs for reject/edit note “copy from existing unit pins” — implementer must flesh from `ledger-store.test.ts`; blocked-string literals are given.
3. **Type consistency:** `PlannedEvent`, `EvidenceCreatePlan`, `ReviewDecisionPlan`, `collectLedgerLinesFromEvents` names stable across tasks.
4. **messages/\*:** none.
5. **Execution choice (mandated by user):** Subagent-Driven Development after this file is committed.

## Execution handoff

Plan complete at `docs/superpowers/plans/2026-08-06-repo-health-wave-b-execution-plan.md`.

**Execution:** Subagent-Driven (mandated) — fresh implementer per task, task review between tasks, orchestrator commits + centralized verification, final review + simplify on the full Wave B batch.
)
