# Supabase Backend Hardening Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred items and new findings surfaced during the Supabase Backend Hardening series (`2026-05-19-supabase-hardening.md`): complete the audit-trail actor threading (Task 5 only covered settings; reviews/evidence still client-spoofable), close the test-coverage gap (no end-to-end normal-mode test; tests/integration/ not typechecked; suggestVoucher positive path uncovered), and one small consistency cleanup (`thisMonth()` helper).

**Architecture:** All work continues on branch `deploy`, building on commit `2f13b89` (the last hardening commit). Each task is independently shippable and the suite stays green between tasks. The audit-trail work mirrors the Task 5 pattern (use `this.ctx.userId` for event actors, ignore the user-editable `input.actorId` for audit purposes); the test-coverage work introduces a `tests/tsconfig.json` so future test changes are caught at type-check time, plus a Hono-level integration test exercising `authMiddleware → parseTenantFromClaims → SupabaseLedgerStore` with a mocked Supabase client (no DB).

**Tech Stack:** Same as the parent project — TypeScript 5.9 strict, pnpm monorepo, Hono, Zod v4 (`@jpx-accounting/contracts`), Supabase JS, `node:test` + `tsx`, Husky + lint-staged + Biome on commit.

**Junior-dev orientation:** This codebase ships every audit decision as an append-only event (see `packages/domain/src/supabase-store.ts` `appendEvent`). The `actorId` on each event is what the audit trail attributes the action to — it must come from the authenticated user (`this.ctx.userId` after Task 5 of the parent plan), not from the request body (`input.actorId`), which a malicious or buggy client can set to anything. That is the entire reason Phase 2 exists. The store's existing `saveCompanySettings` already follows this pattern — read it (around line 750) before starting Task 2 so the new code looks identical.

---

## Conventions used by every task

- Test single file: `npx tsx --test tests/unit/<file>.test.ts`
- Full unit suite: `pnpm test:unit`
- Integration (env-gated by default): `pnpm test:integration`
- Type-check all workspaces: `pnpm typecheck`
- Type-check tests (new in Task 1): `pnpm typecheck:tests`
- The repo's pre-commit hook (Husky + lint-staged + Biome) reformats staged `.ts`/`.json`/`.md` on every `git commit`. Expect your imports to be re-ordered and minor whitespace to change. Don't fight it; if a hook fails (Biome rejects something), read the error, fix the underlying issue, re-stage, re-commit.
- The codebase uses node:test + node:assert/strict (NOT Jest, NOT Vitest yet). Follow the existing test file style.
- Mock Supabase client pattern is the chainable object in `tests/unit/supabase-store.test.ts` — builder methods return `chain`, terminal methods (`maybeSingle`, `insert`, `update`, `upsert`, `order`, `in`, etc.) resolve `{ data, error }`. Reuse and extend it, do not invent a new mock shape.
- All commit messages follow the Conventional-Commits style already in the log (`fix(scope):`, `perf(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`).

---

## File Structure

| File                                              | Responsibility                                                                                                                                                                                                                                                                   | Tasks   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `tests/tsconfig.json` (NEW)                       | Type-check config for all files under `tests/` (extends `tsconfig.base.json`)                                                                                                                                                                                                    | 1       |
| `package.json` (root)                             | Add `typecheck:tests` script; wire it into `check`                                                                                                                                                                                                                               | 1       |
| `packages/domain/src/supabase-store.ts`           | Use `this.ctx.userId` for the EvidenceReceived / VoucherCreated / ReviewApproved / ReviewRejected / PostedToLedger audit events and the provenance timeline step; use new `thisMonth()` helper in `getSnapshot`                                                                  | 2, 3, 6 |
| `tests/unit/supabase-store.test.ts`               | Add audit-actor tests (Tasks 2, 3); add positive-path `suggestVoucher` test (Task 4)                                                                                                                                                                                             | 2, 3, 4 |
| `packages/domain/src/ids.ts`                      | Add `thisMonth()` helper alongside `today()`                                                                                                                                                                                                                                     | 6       |
| `tests/unit/ids-today.test.ts`                    | Add `thisMonth()` test (extend the file that already tests `today()`)                                                                                                                                                                                                            | 6       |
| `tests/integration/api-normal-mode.test.ts` (NEW) | Hono-level integration: real `authMiddleware` + real `createApp` + mocked Supabase client (no real DB); proves the JWT → tenant claims → SupabaseLedgerStore → response chain holds end-to-end and that `actor_id` on persisted audit events is `ctx.userId` not `input.actorId` | 5       |

No other files are touched.

---

# Phase 1 — Type-check the test files

### Task 1: Add `tests/tsconfig.json` and a `typecheck:tests` script

**Why this is first:** the rest of the plan adds and changes test files. Without typecheck coverage, a typo in a test (like the integration test's missing `userId` that hardening's Task 5 silently broke) only manifests at runtime. Putting the gate in place first means every later task is checked.

**Files:**

- Create: `tests/tsconfig.json`
- Modify: `package.json` (root) — add a `typecheck:tests` script and extend `check`

- [ ] **Step 1: Create `tests/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "..",
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

`extends: "../tsconfig.base.json"` reuses the project-wide strict settings (`strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, the workspace path aliases for `@jpx-accounting/*`). `rootDir: ".."` is needed because the test imports reach into `services/api/src/...` via relative paths.

- [ ] **Step 2: Add the script to root `package.json`**

In `package.json`, in the `scripts` object, add this entry between `typecheck` and `test:unit` (keep alphabetical-ish placement consistent):

```json
"typecheck:tests": "tsc --noEmit -p tests/tsconfig.json",
```

Then change `check` from:

```json
"check": "pnpm typecheck && pnpm build",
```

to:

```json
"check": "pnpm typecheck && pnpm typecheck:tests && pnpm build",
```

(Don't touch other scripts. Don't add `typecheck:tests` to the workspace-wide `typecheck` — keep them separate so `pnpm typecheck` stays fast for editor watchers.)

- [ ] **Step 3: Run the new script and discover existing issues**

Run: `pnpm typecheck:tests`
Expected outcome: it MIGHT fail. Tests that haven't been type-checked may have stale types. Read each error and fix it in place. Common issues to expect:

- Imports of types that have moved or been renamed during the hardening series.
- Mock objects whose shape no longer matches the constructors (e.g. missing `userId`).
- `as never` / `as unknown as` casts that are now redundant.

Do NOT add `// @ts-expect-error` or `as any` to silence errors — fix the underlying typing. If an error genuinely requires a code change beyond a test file, STOP and report it; do not silently change production code from a test-typecheck task.

- [ ] **Step 4: Fix until clean**

When `pnpm typecheck:tests` exits 0 with no errors, you're done.

- [ ] **Step 5: Confirm the full suite still passes**

Run: `pnpm test:unit`
Expected: 38/38 pass (unchanged — your changes were type-only).
Run: `pnpm typecheck`
Expected: 9 workspace projects green (unchanged).
Run: `pnpm typecheck:tests`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add tests/tsconfig.json package.json
git commit -m "build(repo): typecheck tests/ via dedicated tsconfig and typecheck:tests script"
```

If your "Fix until clean" step touched test files, include them in the same commit:

```bash
git add tests/tsconfig.json package.json tests/path/to/fixed.ts
git commit -m "build(repo): typecheck tests/ via dedicated tsconfig and typecheck:tests script"
```

---

# Phase 2 — Audit-trail completion

Phase 2 closes the actor-spoofing gap the Task 5 reviewer flagged: `createEvidence` and `applyReviewDecision` still attribute their audit events (and the review provenance timeline) to the request body's `input.actorId`, which is client-controllable. This phase routes them to `this.ctx.userId` (the authenticated user threaded in during the hardening series' Task 5).

The pattern to mirror exactly is `SupabaseLedgerStore.saveCompanySettings` (see `packages/domain/src/supabase-store.ts` around lines 750–795 — read it before starting). Same idea: use `this.ctx.userId`, ignore `input.contactEmail` (or `input.actorId` for these tasks).

**Scope note:** these changes apply ONLY to `SupabaseLedgerStore`. `MemoryLedgerStore` does not take a `ctx` (it is the demo singleton) and continues to use `input.actorId` — that is intentional: demo data has no real auth boundary.

### Task 2: `createEvidence` audit events attribute to `this.ctx.userId`

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`persistCreateEvidence`, the two `appendEvent` calls with `actorId: input.actorId`)
- Test: `tests/unit/supabase-store.test.ts` (append a test)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase-store.test.ts` (at the end of the file, before the last closing brace if any — match the existing test-append style):

```ts
test("createEvidence attributes EvidenceReceived/VoucherCreated audit events to ctx.userId, not input.actorId", async () => {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.insert = async (row: Record<string, unknown>) => {
          if (table === "events") inserted.push(row);
          return { error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_a",
    workspaceId: "ws_a",
    userId: "user_real",
  });

  await store.createEvidence({
    organizationId: "org_a",
    workspaceId: "ws_a",
    actorId: "attacker_from_body",
    title: "Test",
    originalFilename: "t.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf"],
  });

  const evidenceEvent = inserted.find((e) => e.event_type === "EvidenceReceived");
  const voucherEvent = inserted.find((e) => e.event_type === "VoucherCreated");
  const suggestionEvent = inserted.find((e) => e.event_type === "SuggestionGenerated");

  assert.equal(evidenceEvent?.actor_id, "user_real", "EvidenceReceived must attribute to ctx.userId");
  assert.equal(voucherEvent?.actor_id, "user_real", "VoucherCreated must attribute to ctx.userId");
  assert.equal(suggestionEvent?.actor_id, "system-ai", "SuggestionGenerated stays system-ai");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL on the new test. The `EvidenceReceived` and `VoucherCreated` events currently have `actor_id: "attacker_from_body"`.

- [ ] **Step 3: Replace the two `actorId: input.actorId` lines**

Open `packages/domain/src/supabase-store.ts`. Inside `persistCreateEvidence`, find these two `appendEvent` calls (around lines 252–268 — exact line numbers will drift as the file evolves; identify by `eventType: "EvidenceReceived"` and `eventType: "VoucherCreated"`):

```ts
await this.appendEvent({
  aggregateType: "evidence",
  aggregateId: evidence.id,
  eventType: "EvidenceReceived",
  actorId: input.actorId,
  occurredAt: evidence.createdAt,
  payload: evidence as unknown as Record<string, unknown>,
});

await this.appendEvent({
  aggregateType: "voucher",
  aggregateId: voucher.id,
  eventType: "VoucherCreated",
  actorId: input.actorId,
  occurredAt: evidence.createdAt,
  payload: voucher as unknown as Record<string, unknown>,
});
```

Change both `actorId: input.actorId,` to `actorId: this.ctx.userId,`:

```ts
await this.appendEvent({
  aggregateType: "evidence",
  aggregateId: evidence.id,
  eventType: "EvidenceReceived",
  actorId: this.ctx.userId,
  occurredAt: evidence.createdAt,
  payload: evidence as unknown as Record<string, unknown>,
});

await this.appendEvent({
  aggregateType: "voucher",
  aggregateId: voucher.id,
  eventType: "VoucherCreated",
  actorId: this.ctx.userId,
  occurredAt: evidence.createdAt,
  payload: voucher as unknown as Record<string, unknown>,
});
```

Do NOT change the third `appendEvent` in the same block (the `eventType: "SuggestionGenerated"` one with `actorId: "system-ai"`). That is a system identity, not a human actor — leave it.

Do NOT change `evidence.createdBy` or `voucher.createdBy` (those are constructed earlier in `createEvidence` from `input.actorId`). Those fields are the domain "who created the entity" attribution and intentionally come from the request body; they are distinct from the immutable audit event's `actor_id`.

- [ ] **Step 4: Run the new test — expect PASS**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: all PASS, including the new "createEvidence attributes ... to ctx.userId" test.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test:unit`
Expected: 39/39 pass (was 38, +1 new).
Run: `pnpm typecheck`
Expected: 9 workspace projects green.
Run: `pnpm typecheck:tests`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "fix(domain): createEvidence audit events attribute to ctx.userId, not input.actorId"
```

---

### Task 3: `applyReviewDecision` audit events + provenance step attribute to `this.ctx.userId`

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`applyReviewDecision` — the provenance step's `actor` and the two `appendEvent` calls)
- Test: `tests/unit/supabase-store.test.ts` (append a test)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/supabase-store.test.ts`:

```ts
test("applyReviewDecision attributes ReviewApproved + PostedToLedger + provenance step to ctx.userId, not input.actorId", async () => {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const reviewRow = {
    id: "r1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    voucher_id: "v1",
    title: "Review V-1",
    status: "needs-review",
    suggested_action: "Approve",
    suggestion: {
      id: "s1",
      voucherId: "v1",
      accountNumber: "6540",
      accountName: "IT-tjänster",
      vatCode: "VAT25",
      confidence: 0.9,
      reasoning: "r",
      kind: "recommendation",
      citations: [],
      ruleHits: [],
    },
    provenance_timeline: [],
  };
  const voucherRow = {
    id: "v1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    evidence_packet_id: "p1",
    voucher_number: "V-1",
    status: "needs-review",
    accounting_method: "invoice",
    extracted_fields: [],
    voucher_fields: {
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      vatRate: 25,
      currency: "SEK",
      description: "Test",
    },
    created_at: "2026-05-19T00:00:00.000Z",
    created_by: "user_real",
  };

  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => {
          if (table === "review_tasks") return { data: reviewRow, error: null };
          if (table === "vouchers") return { data: voucherRow, error: null };
          if (table === "events") return { data: null, error: null };
          return { data: null, error: null };
        };
        chain.insert = async (row: Record<string, unknown>) => {
          if (table === "events") inserted.push(row);
          return { error: null };
        };
        chain.update = (row: Record<string, unknown>) => {
          updated.push({ table, ...row });
          return chain;
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_a",
    workspaceId: "ws_a",
    userId: "user_real",
  });

  const updatedReview = await store.applyReviewDecision("r1", "approve", {
    actorId: "attacker_from_body",
    notes: "ok",
  });

  const reviewEvent = inserted.find((e) => e.event_type === "ReviewApproved");
  const ledgerEvent = inserted.find((e) => e.event_type === "PostedToLedger");

  assert.equal(reviewEvent?.actor_id, "user_real", "ReviewApproved must attribute to ctx.userId");
  assert.equal(ledgerEvent?.actor_id, "user_real", "PostedToLedger must attribute to ctx.userId");

  const latestStep = updatedReview?.provenanceTimeline.at(-1);
  assert.equal(latestStep?.actor, "user_real", "provenance step actor must be ctx.userId");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL on the new test. `reviewEvent.actor_id` and `ledgerEvent.actor_id` and the provenance step's `actor` are all currently `"attacker_from_body"`.

- [ ] **Step 3: Replace the three `input.actorId` references**

Open `packages/domain/src/supabase-store.ts`. Inside `applyReviewDecision`, locate three sites (line numbers may drift; identify by surrounding code):

**Site A — provenance timeline step actor** (around line 641, inside `const provenanceTimeline = [..., { ... actor: input.actorId }]`):

Change `actor: input.actorId,` to `actor: this.ctx.userId,`.

**Site B — `ReviewApproved`/`ReviewRejected` appendEvent** (around lines 666–673):

```ts
await this.appendEvent({
  aggregateType: "review",
  aggregateId: reviewId,
  eventType: action === "approve" ? "ReviewApproved" : "ReviewRejected",
  actorId: input.actorId,
  occurredAt,
  payload: { action, notes: input.notes },
});
```

Change `actorId: input.actorId,` to `actorId: this.ctx.userId,`.

**Site C — `PostedToLedger` appendEvent** (around lines 699–706):

```ts
await this.appendEvent({
  aggregateType: "ledger",
  aggregateId: voucher.id,
  eventType: "PostedToLedger",
  actorId: input.actorId,
  occurredAt,
  payload: { action, suggestion: review.suggestion },
});
```

Change `actorId: input.actorId,` to `actorId: this.ctx.userId,`.

Do NOT touch the `payload: { action, notes: input.notes }` — `notes` is content, not actor, and is supposed to come from the body.

- [ ] **Step 4: Run the new test — expect PASS**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: all PASS, including the new test.

- [ ] **Step 5: Verify nothing else regressed**

Run: `pnpm test:unit`
Expected: 40/40 pass (39 + 1).
Run: `pnpm typecheck && pnpm typecheck:tests`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "fix(domain): applyReviewDecision audit events + provenance step attribute to ctx.userId"
```

---

# Phase 3 — Test coverage hardening

### Task 4: Positive-path `suggestVoucher` regression-guard test

The hardening Task 4 (commit `10844e2`) added one negative-path test for `suggestVoucher` (out-of-org returns undefined). The two positive paths are uncovered:

- **stored-suggestion branch** — in-org voucher with an existing suggestion row returns the mapped suggestion.
- **fallback-deterministic branch** — in-org voucher with NO existing suggestion row falls back to `buildDeterministicSuggestion(voucher, ruleHits)`.

A future refactor of `suggestVoucher` could accidentally break either branch and no test would notice. Close the gap.

**Files:**

- Test: `tests/unit/supabase-store.test.ts` (append two tests)

- [ ] **Step 1: Write the two failing tests**

Append to `tests/unit/supabase-store.test.ts`:

```ts
test("suggestVoucher returns the stored suggestion when one exists for an in-org voucher", async () => {
  const voucherRow = {
    id: "v1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    evidence_packet_id: "p1",
    voucher_number: "V-1",
    status: "needs-review",
    accounting_method: "invoice",
    extracted_fields: [],
    voucher_fields: {},
    created_at: "2026-05-19T00:00:00.000Z",
    created_by: "u",
  };
  const suggestionRow = {
    id: "s1",
    voucher_id: "v1",
    account_number: "6540",
    account_name: "IT-tjänster",
    vat_code: "VAT25",
    confidence: 0.9,
    reasoning: "stored",
    kind: "recommendation",
    citations: [],
    rule_hits: [],
  };
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => {
          if (table === "vouchers") return { data: voucherRow, error: null };
          if (table === "suggestions") return { data: suggestionRow, error: null };
          return { data: null, error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_a",
    workspaceId: "ws_a",
    userId: "u",
  });

  const result = await store.suggestVoucher("v1");
  assert.equal(result?.id, "s1");
  assert.equal(result?.accountNumber, "6540");
  assert.equal(result?.reasoning, "stored");
});

test("suggestVoucher falls back to deterministic suggestion when none is stored", async () => {
  const voucherRow = {
    id: "v1",
    organization_id: "org_a",
    workspace_id: "ws_a",
    evidence_packet_id: "p1",
    voucher_number: "V-1",
    status: "needs-review",
    accounting_method: "invoice",
    extracted_fields: [
      { key: "supplierName", label: "Supplier", value: "OpenAI Ireland", confidence: 0.9, required: true },
    ],
    voucher_fields: {
      supplierName: "OpenAI Ireland",
      description: "OpenAI",
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      vatRate: 25,
      currency: "SEK",
    },
    created_at: "2026-05-19T00:00:00.000Z",
    created_by: "u",
  };
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => {
          if (table === "vouchers") return { data: voucherRow, error: null };
          if (table === "suggestions") return { data: null, error: null };
          return { data: null, error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_a",
    workspaceId: "ws_a",
    userId: "u",
  });

  const result = await store.suggestVoucher("v1");
  // Deterministic suggestion is built from rules; we don't lock the exact account here
  // (the rules engine owns that). We only assert the fallback fired (got SOMETHING back).
  assert.ok(result, "fallback must produce a deterministic suggestion when none stored");
  assert.equal(result.voucherId, "v1");
});
```

- [ ] **Step 2: Run — expect both tests to pass already (the code is already correct from hardening Task 4)**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: ALL PASS including the two new tests. These are regression-guard tests for already-working code — they're a coverage addition, not a bug fix.

- [ ] **Step 3: Verify the schema fixture choices**

If either test FAILS with a Zod parse error, the fixture is missing a contract-required field. Inspect:

- `accountingSuggestionSchema` in `packages/contracts/src/index.ts` — confirm `kind: "recommendation"` is valid (`suggestionKindSchema` accepts `"explanation" | "recommendation" | "automation-request"`). If different values are accepted, pick one.
- `voucherSchema` — confirm `voucher_fields: {}` parses (all fields should be optional).
  Adjust ONLY the fixture, never the assertion.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test:unit`
Expected: 42/42 pass (40 + 2).
Run: `pnpm typecheck && pnpm typecheck:tests`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/supabase-store.test.ts
git commit -m "test(domain): positive-path regression guards for suggestVoucher (stored + deterministic)"
```

---

### Task 5: Hono-level integration test for the normal-mode chain

The hardening's final review observation O1: _"There is no integration test or E2E scenario that exercises: valid JWT → parseTenantFromClaims → createLedgerStore → SupabaseLedgerStore → HTTP response. ... A straightforward Hono integration test (mocking the Supabase JWT verify, using the real authMiddleware + createLedgerStore, and mocking only the DB client) would close most of it."_

We will write that test. It exercises the entire normal-mode chain except the actual Postgres process — sufficient to catch a wide class of regressions (middleware wiring, scope threading, audit-actor wiring).

**Strategy:** Construct `createApp({...})` with a custom `createLedgerStore` that returns `new SupabaseLedgerStore(mockSupabase, scope)`. Use `skipAuthVerification: true` so the auth middleware injects the sentinel `org_test`/`user_test` identity without needing a real JWT verifier (this is honest — `skipAuthVerification` is a real, supported flag, and the hardening's Task 3 spec verified its behavior). The test then drives `app.request("/api/evidence", { ... })` with `Authorization: Bearer <anything>` and inspects (a) the response shape and (b) the mock's recorded `events` inserts to confirm `actor_id === "user_test"` (NOT the body's `actorId`).

**Files:**

- Create: `tests/integration/api-normal-mode.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/integration/api-normal-mode.test.ts` with this exact content:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiRuntime } from "@jpx-accounting/ai-core";
import { MemoryLedgerStore, SupabaseLedgerStore } from "@jpx-accounting/domain";

import { createApp } from "../../services/api/src/app";
import { readApiRuntimeConfig } from "../../services/api/src/config";

type RowSink = { events: Record<string, unknown>[] };

function makeMockSupabase(sink: RowSink) {
  return {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.insert = async (row: Record<string, unknown>) => {
          if (table === "events") sink.events.push(row);
          return { error: null };
        };
        chain.update = () => chain;
        chain.upsert = async () => ({ error: null });
        return chain;
      },
    }),
  } as never;
}

test("normal-mode: createEvidence audit events attribute to skip-verification sentinel user, not request body", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "normal", PORT: "0" });
  const sink: RowSink = { events: [] };
  const mockSupabase = makeMockSupabase(sink);

  const demoStoreRef = { current: new MemoryLedgerStore() };
  const aiRuntime = createAiRuntime({ runtimeMode: "demo" }); // AI not exercised in this test

  const app = createApp({
    runtimeMode: "normal",
    aiRuntime,
    createLedgerStore: (scope) => new SupabaseLedgerStore(mockSupabase, scope),
    demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
    skipAuthVerification: true,
  });

  const response = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: {
      Authorization: "Bearer fake-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      organizationId: "org_test",
      workspaceId: "workspace_test",
      actorId: "attacker_from_body",
      title: "Integration evidence",
      originalFilename: "i.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
    }),
  });

  assert.equal(response.status, 200, await response.text());

  const evidenceEvent = sink.events.find((e) => e.event_type === "EvidenceReceived");
  const voucherEvent = sink.events.find((e) => e.event_type === "VoucherCreated");

  assert.ok(evidenceEvent, "EvidenceReceived must have been recorded");
  assert.ok(voucherEvent, "VoucherCreated must have been recorded");
  assert.equal(
    evidenceEvent.actor_id,
    "user_test",
    "EvidenceReceived actor must be the authenticated sentinel, not the body's actorId",
  );
  assert.equal(
    voucherEvent.actor_id,
    "user_test",
    "VoucherCreated actor must be the authenticated sentinel, not the body's actorId",
  );
});

test("normal-mode: request without Authorization header returns 401", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "normal", PORT: "0" });
  const sink: RowSink = { events: [] };
  const mockSupabase = makeMockSupabase(sink);

  const demoStoreRef = { current: new MemoryLedgerStore() };
  const aiRuntime = createAiRuntime({ runtimeMode: "demo" });

  const app = createApp({
    runtimeMode: "normal",
    aiRuntime,
    createLedgerStore: (scope) => new SupabaseLedgerStore(mockSupabase, scope),
    demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "fake-key",
    // NOT setting skipAuthVerification — we want the real header check.
  });

  const response = await app.request("http://localhost/api/workspace");
  assert.equal(response.status, 401);
});
```

**Junior-dev orientation for this test:**

- `app.request(...)` is Hono's in-process request API — it constructs a synthetic `Request` and runs the full middleware chain without binding to a port. See `tests/unit/api-runtime.test.ts` for the existing pattern.
- `createAiRuntime({ runtimeMode: "demo" })` returns a no-network AI runtime — this test does not exercise AI, but `createApp` requires the dependency.
- `skipAuthVerification: true` causes `authMiddleware` to inject `userId: "user_test"`, `organizationId: "org_test"`, `workspaceId: "workspace_test"` (the sentinels the hardening's Task 3 introduced). The body's `actorId: "attacker_from_body"` is irrelevant to the audit trail — that is exactly what we are asserting.
- The mock supabase client supports the entire `appendEvent` chain: a `select.eq.eq.order.limit.maybeSingle()` for the previous-hash read and `insert(row)` for the events write. Other tables (`evidence_objects`, `evidence_packets`, etc.) are inserted into but we do not assert on them.

- [ ] **Step 2: Run the integration test**

Run: `pnpm test:integration`
Expected: both tests in `api-normal-mode.test.ts` PASS. The existing `supabase-ledger.test.ts` will be SKIPPED (no `SUPABASE_URL` env var) — that is fine.

- [ ] **Step 3: Confirm the new test catches regressions**

To confirm the test actually catches the regression class it is meant to: temporarily revert ONE of the `actorId: this.ctx.userId` changes from Task 2 back to `actorId: input.actorId` in `supabase-store.ts`. Run the integration test again — it must now FAIL with the actor_id mismatch assertion. Restore the change (do not commit the revert).

This step is for your own verification — it proves the test would catch the bug Tasks 2 and 3 fixed. After confirming, restore and run `git diff` to make sure your tree is clean before continuing.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:tests`
Expected: green (the new file passes typecheck under the config Task 1 added).
Run: `pnpm typecheck`
Expected: 9 workspace projects green (unchanged — no workspace files modified).
Run: `pnpm test:unit`
Expected: 42/42 (unchanged — no unit tests added).

- [ ] **Step 5: Commit**

```bash
git add tests/integration/api-normal-mode.test.ts
git commit -m "test(api): Hono integration covers normal-mode auth → store actor-attribution"
```

---

# Phase 4 — Small polish

### Task 6: Shared `thisMonth()` helper for the `.slice(0, 7)` site

The hardening's Task 12 centralized `.slice(0, 10)` as `today()`. The single remaining `.slice(0, 7)` site (the `period: new Date().toISOString().slice(0, 7)` in `getSnapshot`'s inline `CloseRun` placeholder) is the natural completion of that work.

**Files:**

- Modify: `packages/domain/src/ids.ts`
- Modify: `packages/domain/src/supabase-store.ts` (one line in `getSnapshot`)
- Test: `tests/unit/ids-today.test.ts` (extend the file that already tests `today()`)

- [ ] **Step 1: Write the failing test**

Open `tests/unit/ids-today.test.ts`. Add the `thisMonth` import to the existing import line (keep `today` import):

```ts
import { thisMonth, today } from "@jpx-accounting/domain";
```

Then append this new test below the existing `today` test:

```ts
test("thisMonth returns yyyy-mm", () => {
  assert.match(thisMonth(), /^\d{4}-\d{2}$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx --test tests/unit/ids-today.test.ts`
Expected: FAIL with "Cannot find name 'thisMonth'" or similar — the function does not exist yet.

- [ ] **Step 3: Add the helper to `ids.ts`**

Append to `packages/domain/src/ids.ts` (after `today()`):

```ts
export function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}
```

- [ ] **Step 4: Use it in `supabase-store.ts`**

Open `packages/domain/src/supabase-store.ts`. Locate the inline `CloseRun` placeholder inside `getSnapshot`'s `Promise.all` (around line 534 — identify by `id: "close_current"` and `checklist: []`):

```ts
      Promise.resolve<CloseRun>({
        id: "close_current",
        period: new Date().toISOString().slice(0, 7),
        generatedAt: nowIso(),
        checklist: [],
      }),
```

Add `thisMonth` to the existing `./ids` import (it currently imports `createId, nowIso, today`):

```ts
import { createId, nowIso, thisMonth, today } from "./ids";
```

Then change `period: new Date().toISOString().slice(0, 7),` to `period: thisMonth(),`:

```ts
      Promise.resolve<CloseRun>({
        id: "close_current",
        period: thisMonth(),
        generatedAt: nowIso(),
        checklist: [],
      }),
```

- [ ] **Step 5: Confirm only the canonical `.slice(0, 7)` remains**

Run: `grep -rn "toISOString().slice(0, 7)" packages/domain/src/`
Expected output: exactly ONE line — the definition inside `thisMonth()` in `ids.ts`. If there's another occurrence, replace it the same way.

- [ ] **Step 6: Run the suite**

Run: `npx tsx --test tests/unit/ids-today.test.ts`
Expected: 2/2 pass (`today` + `thisMonth`).
Run: `pnpm test:unit`
Expected: 42/42 (unchanged count — `tests/unit/ids-today.test.ts` ran a new sub-test but the file still counts as 1 test file with 2 sub-tests).

Wait — counting note: each `test(...)` call in node:test is one entry in the `tests N` count. So after this task it should be 43/43, not 42. Verify the actual number when you run it; the spec count is illustrative — what matters is that the count went up by exactly 1 and zero failed.

Run: `pnpm typecheck && pnpm typecheck:tests`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/ids.ts packages/domain/src/supabase-store.ts tests/unit/ids-today.test.ts
git commit -m "refactor(domain): shared thisMonth() helper, drop last inline yyyy-mm slice"
```

---

## Self-Review

**Spec coverage** — every deferred item from the hardening series' finishing summary maps to a task (items explicitly deferred as design-decisions or scope-excluded are NOT included, as they require non-mechanical product/design work):

| Deferred item (from `2026-05-19-supabase-hardening.md` finish notes)                                   | Task                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/` not in any tsconfig (final-review suggestion)                                     | 1                                                                                                                       |
| `createEvidence` / `applyReviewDecision` event `actorId` still client-spoofable (Task 5 reviewer's O3) | 2, 3                                                                                                                    |
| Positive-path `suggestVoucher` test gap (Task 4 reviewer M3)                                           | 4                                                                                                                       |
| No end-to-end normal-mode test (final review O1)                                                       | 5                                                                                                                       |
| `getCloseRun` month slice not centralized like `today()` (final review M1)                             | 6                                                                                                                       |
| `vat_summary.deductible` first-seen design choice (final review O2)                                    | **NOT included** — explicitly a design decision pending the VAT engine maturing. Code is correct and intentional today. |
| `runSimulation` demo array literal accounts (final review M2)                                          | **NOT included** — Task 11 of the parent plan explicitly scoped this out as demo scaffold.                              |

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N"/"fill in details" patterns. Every code block, command, and assertion is complete and concrete.

**Type consistency:**

- `thisMonth()` signature in Task 6 (`(): string`) matches the test that imports it.
- `createApp({...})` signature in Task 5 matches `services/api/src/app.ts` `CreateAppOptions` as of HEAD `2f13b89` (`runtimeMode`, `aiRuntime`, `createLedgerStore`, `demoStoreRef`, `apiConfig`, `allowTestReset`, `supabaseUrl?`, `supabaseSecretKey?`, `skipAuthVerification?`).
- The mock supabase client shape in Tasks 2, 3, 4, 5 uses the same chainable pattern (`select/eq/order/limit/in` return `chain`; `maybeSingle/insert/update/upsert` are terminal) consistent with the existing `tests/unit/supabase-store.test.ts`.
- `this.ctx.userId` references in Tasks 2 and 3 match the constructor parameter type `TenantScope & { userId: string }` established by the hardening's Task 5.

**Final test count progression** (assuming the suite is at 38 at start):

- After Task 1: 38 (no test added; possibly some test files type-fixed)
- After Task 2: 39
- After Task 3: 40
- After Task 4: 42
- After Task 5: 42 unit + 2 integration (integration was 0 runnable + 1 skipped)
- After Task 6: 43 unit + 2 integration

---

Plan complete and saved to `docs/superpowers/plans/2026-05-20-hardening-followups.md`.
