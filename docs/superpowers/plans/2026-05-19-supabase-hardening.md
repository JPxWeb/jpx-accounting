# Supabase Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every open finding from the Supabase-backend-track review — multi-tenancy fail-open, unscoped reads, dishonest stubs, N+1/unbounded queries, and remaining reuse debt — without changing the public API contract.

**Architecture:** The API runs `SupabaseLedgerStore` under a **service-role client that bypasses RLS** (see `services/api/src/runtime.ts` → `createServiceClient`). Therefore the per-query `.eq("organization_id", …)` filters plus `parseTenantFromClaims` are the _only_ tenant boundary; the RLS policies in `20260519000003_rls_jwt_claims.sql` are inert for this path. Phase 1 makes that boundary fail-closed. Phases 2–4 are independent and may ship separately.

**Tech Stack:** TypeScript 5.9, pnpm monorepo, Hono, Zod v4 (`@jpx-accounting/contracts`), Supabase JS, Postgres, `node:test` + `tsx` for unit tests, Playwright for E2E.

**Scope note:** This spec spans three subsystems (auth/tenancy, domain store query layer, reuse polish). It is delivered as one phased plan because all phases touch the same files and share the hardening goal; **each phase is independently shippable and leaves the suite green**. If you prefer, Phases 1–4 can be split into four PRs in order.

**Conventions used by every task:**

- Single unit test file: `npx tsx --test tests/unit/<file>.test.ts`
- Full suite: `pnpm test:unit`
- Types: `pnpm typecheck`
- The mock Supabase client pattern is the one in `tests/unit/supabase-store.test.ts` (a chainable object whose terminal methods resolve `{ data, error }`); reuse/extend it, do not invent a new mock shape.
- Commit after every task with the message shown in its final step.

---

## File Structure

| File                                                                 | Responsibility                                                                             | Tasks            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `packages/contracts/src/index.ts`                                    | Add `tenantScopeSchema`/`TenantScope` (single tenant-identity type)                        | 1                |
| `services/api/src/middleware/tenant.ts`                              | Fail-closed claims parsing, typed result                                                   | 2                |
| `services/api/src/middleware/auth.ts`                                | Use fail-closed parser; non-prod skip sentinel                                             | 2, 3             |
| `services/api/src/store-factory.ts`, `runtime.ts`, `app.ts`          | Thread `TenantScope` + acting `userId` into the store                                      | 1, 5             |
| `packages/domain/src/supabase-store.ts`                              | Scoped `suggestVoucher`; honest stubs; N+1 fixes; aggregate reads; actor on settings event | 4, 5, 6, 7, 8, 9 |
| `packages/domain/src/voucher-draft.ts` (new)                         | Shared voucher/review draft builder                                                        | 10               |
| `packages/domain/src/store.ts`, `supabase-store.ts`                  | Consume shared draft builder                                                               | 10               |
| `packages/domain/src/bas.ts`                                         | Export named account-number/VAT constants                                                  | 11               |
| `packages/domain/src/posting.ts`, `projections.ts`, `store.ts`       | Use BAS constants instead of string literals                                               | 11               |
| `packages/domain/src/ids.ts`                                         | Add `today()` digest-date helper                                                           | 12               |
| `services/api/src/runtime.ts`, `store-factory.ts`                    | Share `LEDGER_STORE_UNAVAILABLE_REASON`                                                    | 13               |
| `apps/web/app/api-proxy/[...path]/route.ts`                          | Restore WHY comment; document accepted double-validation                                   | 14               |
| `supabase/migrations/20260519000004_projection_aggregates.sql` (new) | Triggers maintaining `account_balances`/`vat_summary`                                      | 9                |

---

# Phase 1 — Security & Multi-tenancy

### Task 1: Single `TenantScope` contract type

**Files:**

- Modify: `packages/contracts/src/index.ts` (append near `userProfileSchema`, ~line 311)
- Modify: `services/api/src/store-factory.ts:76-79`
- Modify: `packages/domain/src/supabase-store.ts:39-42`
- Modify: `services/api/src/runtime.ts:41`
- Test: `tests/unit/contracts-tenant-scope.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/contracts-tenant-scope.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantScopeSchema } from "@jpx-accounting/contracts";

test("tenantScopeSchema requires organizationId and workspaceId", () => {
  assert.deepEqual(tenantScopeSchema.parse({ organizationId: "org_a", workspaceId: "ws_a" }), {
    organizationId: "org_a",
    workspaceId: "ws_a",
  });
  assert.throws(() => tenantScopeSchema.parse({ organizationId: "org_a" }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/contracts-tenant-scope.test.ts`
Expected: FAIL — `tenantScopeSchema` is not exported.

- [ ] **Step 3: Add the schema and type**

In `packages/contracts/src/index.ts`, immediately above `export const userProfileSchema = z.object({`:

```ts
export const tenantScopeSchema = z.object({
  organizationId: z.string(),
  workspaceId: z.string(),
});
export type TenantScope = z.infer<typeof tenantScopeSchema>;
```

- [ ] **Step 4: Replace the three duplicated inline shapes**

`packages/domain/src/supabase-store.ts` — delete the local `type StoreContext = { organizationId: string; workspaceId: string };` and change the import block to add `type TenantScope` from `@jpx-accounting/contracts`, then change the constructor param type `ctx: StoreContext` → `ctx: TenantScope`.

`services/api/src/store-factory.ts` — replace:

```ts
export type LedgerStoreScope = {
  organizationId: string;
  workspaceId: string;
};
```

with:

```ts
import type { RuntimeMode, TenantScope } from "@jpx-accounting/contracts";
export type LedgerStoreScope = TenantScope;
```

(keep the existing `import type { RuntimeMode } …` merged into the line above; remove the now-duplicate `RuntimeMode` import).

`services/api/src/runtime.ts:41` — change `(scope: { organizationId: string; workspaceId: string })` to `(scope: TenantScope)` and add `import type { TenantScope } from "@jpx-accounting/contracts";`.

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/contracts-tenant-scope.test.ts` → PASS
Run: `pnpm typecheck` → all 9 projects Done

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/index.ts packages/domain/src/supabase-store.ts services/api/src/store-factory.ts services/api/src/runtime.ts tests/unit/contracts-tenant-scope.test.ts
git commit -m "refactor(contracts): single TenantScope type, drop 3 duplicated shapes"
```

---

### Task 2: Fail-closed `parseTenantFromClaims`

**Files:**

- Modify: `services/api/src/middleware/tenant.ts` (full rewrite, 9 lines → ~30)
- Modify: `services/api/src/middleware/auth.ts:62-66`
- Test: `tests/unit/tenant-claims.test.ts:1-14` (extend)

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/tenant-claims.test.ts`:

```ts
import { MissingTenantClaimError } from "../../services/api/src/middleware/tenant";

test("parseTenantFromClaims throws when organization_id is absent", () => {
  assert.throws(
    () => parseTenantFromClaims({ sub: "u1", app_metadata: { workspace_id: "ws_a" } }),
    MissingTenantClaimError,
  );
});

test("parseTenantFromClaims throws when sub is absent", () => {
  assert.throws(
    () => parseTenantFromClaims({ app_metadata: { organization_id: "org_a", workspace_id: "ws_a" } }),
    MissingTenantClaimError,
  );
});

test("parseTenantFromClaims never falls back to a default org", () => {
  assert.throws(() => parseTenantFromClaims({ sub: "u1", app_metadata: {} }), MissingTenantClaimError);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/tenant-claims.test.ts`
Expected: FAIL — `MissingTenantClaimError` not exported; current code returns `org_jpx` default.

- [ ] **Step 3: Rewrite `tenant.ts`**

```ts
export class MissingTenantClaimError extends Error {
  constructor(claimPath: string) {
    super(`Authenticated token is missing required claim: ${claimPath}`);
    this.name = "MissingTenantClaimError";
  }
}

export type ParsedTenant = {
  userId: string;
  userEmail: string;
  organizationId: string;
  workspaceId: string;
};

export function parseTenantFromClaims(claims: Record<string, unknown>): ParsedTenant {
  const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const sub = claims.sub;
  const organizationId = appMeta.organization_id;
  const workspaceId = appMeta.workspace_id;

  if (typeof sub !== "string" || sub.length === 0) throw new MissingTenantClaimError("sub");
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new MissingTenantClaimError("app_metadata.organization_id");
  }
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new MissingTenantClaimError("app_metadata.workspace_id");
  }

  return {
    userId: sub,
    userEmail: typeof claims.email === "string" ? claims.email : "",
    organizationId,
    workspaceId,
  };
}
```

- [ ] **Step 4: Make `auth.ts` translate the throw into 401**

In `services/api/src/middleware/auth.ts`, replace the block starting `const tenant = parseTenantFromClaims(...)` … through the four `context.set(...)` calls with:

```ts
let tenant;
try {
  tenant = parseTenantFromClaims(data.claims as Record<string, unknown>);
} catch {
  return context.json({ error: "Token is missing organization claims" }, 401);
}
context.set("userId", tenant.userId);
context.set("userEmail", tenant.userEmail);
context.set("organizationId", tenant.organizationId);
context.set("workspaceId", tenant.workspaceId);
```

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/tenant-claims.test.ts` → PASS (incl. existing app_metadata-precedence test)
Run: `npx tsx --test tests/unit/auth-middleware.test.ts` → PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 6: Commit**

```bash
git add services/api/src/middleware/tenant.ts services/api/src/middleware/auth.ts tests/unit/tenant-claims.test.ts
git commit -m "fix(api): fail closed when JWT lacks org/workspace claims (no org_jpx default)"
```

---

### Task 3: `skipAuthVerification` uses a non-production sentinel tenant

**Files:**

- Modify: `services/api/src/middleware/auth.ts` (the `if (options.skipVerification)` block)
- Modify: `tests/unit/auth-middleware.test.ts:68-69`

- [ ] **Step 1: Update the existing test expectation** — in `tests/unit/auth-middleware.test.ts`, change:

```ts
assert.equal(body.userId, "user_test");
assert.equal(body.organizationId, "org_jpx");
```

to:

```ts
assert.equal(body.userId, "user_test");
assert.equal(body.organizationId, "org_test");
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/auth-middleware.test.ts`
Expected: FAIL — middleware still sets `org_jpx`.

- [ ] **Step 3: Change the skip block** in `services/api/src/middleware/auth.ts`:

```ts
if (options.skipVerification) {
  context.set("userId", "user_test");
  context.set("userEmail", "test@jpx.se");
  context.set("organizationId", "org_test");
  context.set("workspaceId", "workspace_test");
  return next();
}
```

- [ ] **Step 4: Verify**

Run: `npx tsx --test tests/unit/auth-middleware.test.ts` → PASS
Run: `pnpm test:unit` → all PASS (confirms `api-runtime.test.ts` "normal runtime fails closed" still 503s; the Unavailable store is tenant-agnostic).

- [ ] **Step 5: Commit**

```bash
git add services/api/src/middleware/auth.ts tests/unit/auth-middleware.test.ts
git commit -m "fix(api): skipAuthVerification injects org_test sentinel, not real org_jpx"
```

---

### Task 4: `suggestVoucher` gates on voucher ownership in one round trip

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`suggestVoucher`, ~lines 600-635)
- Test: `tests/unit/supabase-store.test.ts` (append)

Current code fetches the suggestion **first** (no org filter — `suggestions` has no org column), then does a second org-scoped `vouchers` round trip only to confirm ownership. Reorder: resolve the org-scoped voucher first; if it is not in-org, return `undefined` before touching `suggestions`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/supabase-store.test.ts`:

```ts
test("suggestVoucher returns undefined for a voucher outside the caller's org", async () => {
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () =>
          table === "vouchers" ? { data: null, error: null } : { data: { id: "s1", voucher_id: "v1" }, error: null };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a" });
  assert.equal(await store.suggestVoucher("v1"), undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — current order returns the mapped suggestion before the (null) voucher check is reached for the stored-suggestion branch.

- [ ] **Step 3: Reorder `suggestVoucher`**

```ts
  async suggestVoucher(voucherId: string): Promise<AccountingSuggestion | undefined> {
    const { data: voucherRow, error: voucherError } = await this.ledger()
      .from("vouchers")
      .select("*")
      .eq("id", voucherId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (voucherError) throw new Error(`Failed to load voucher: ${voucherError.message}`);
    if (!voucherRow) return undefined;

    const { data: suggestionRow, error } = await this.ledger()
      .from("suggestions")
      .select("*")
      .eq("voucher_id", voucherId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load suggestion: ${error.message}`);
    if (suggestionRow) return mapSuggestionRow(suggestionRow);

    const voucher = mapVoucherRow(voucherRow);
    const ruleHits = evaluateVoucherRules(voucher);
    return buildDeterministicSuggestion(voucher, ruleHits);
  }
```

The `suggestions` read is now reachable only after the voucher is proven in-org (defense in depth even though `suggestions` has no org column), and the previous extra ownership round trip is gone.

- [ ] **Step 4: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "fix(domain): suggestVoucher gates on org-scoped voucher first, single round trip"
```

---

# Phase 2 — Correctness & Honesty

### Task 5: Thread the authenticated actor into settings audit events

**Files:**

- Modify: `services/api/src/store-factory.ts` (`LedgerStoreScope` → add `userId`)
- Modify: `services/api/src/runtime.ts:41-50`
- Modify: `services/api/src/app.ts` (the `createLedgerStore({...})` call site in the `/api/*` middleware)
- Modify: `packages/domain/src/supabase-store.ts` (`StoreContext`/ctx usage in `saveCompanySettings`)
- Test: `tests/unit/supabase-store.test.ts` (append)

`saveCompanySettings` currently sets `updated_by`/event `actorId` from `parsed.contactEmail || "system"` — a user-editable payload field, which corrupts the append-only audit trail. Pass the real actor.

- [ ] **Step 1: Extend the scope type** — in `store-factory.ts`:

```ts
import type { RuntimeMode, TenantScope } from "@jpx-accounting/contracts";
export type LedgerStoreScope = TenantScope & { userId: string };
```

- [ ] **Step 2: Widen the store ctx** — in `supabase-store.ts`, change the constructor `ctx: TenantScope` to `ctx: TenantScope & { userId: string }` and add a private getter `private actor() { return this.ctx.userId; }`.

- [ ] **Step 3: Write the failing test** — append to `tests/unit/supabase-store.test.ts`:

```ts
test("saveCompanySettings attributes the audit event to the authenticated user", async () => {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.upsert = async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        };
        chain.insert = async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a", userId: "user_real" });
  await store.saveCompanySettings({
    organizationId: "org_a",
    organizationName: "X AB",
    organizationNumber: "556677-8899",
    addressLine1: "A 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "attacker@evil.test",
  });
  const settingsRow = inserted.find((r) => "updated_by" in r);
  assert.equal(settingsRow?.updated_by, "user_real");
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — `updated_by` is `attacker@evil.test`.

- [ ] **Step 5: Use the actor in `saveCompanySettings`** — replace `const updatedBy = parsed.contactEmail || "system";` with `const updatedBy = this.ctx.userId;` (both the `upsert.updated_by` and the `appendEvent.actorId` already reference `updatedBy`).

- [ ] **Step 6: Pass `userId` at the call sites** — in `services/api/src/runtime.ts` change the lambda to `(scope: TenantScope & { userId: string }) => createLedgerStore({ runtimeMode: config.runtimeMode, supabase, demoStoreRef }, scope)`. In `services/api/src/app.ts`, where the `/api/*` middleware calls `createLedgerStore`, pass `{ organizationId: context.get("organizationId"), workspaceId: context.get("workspaceId"), userId: context.get("userId") }`.

- [ ] **Step 7: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `pnpm test:unit` → all PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/supabase-store.ts services/api/src/store-factory.ts services/api/src/runtime.ts services/api/src/app.ts tests/unit/supabase-store.test.ts
git commit -m "fix(domain): attribute settings audit event to authenticated user, not contactEmail"
```

---

### Task 6: Honest not-implemented for Supabase `runSimulation`/`getCloseRun`

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`runSimulation`, `getCloseRun`)
- Test: `tests/unit/supabase-store.test.ts` (append)

These return fabricated, plausible numbers (`affectedAccounts: ["6071","2641","6991"]`, a fake checklist) from the _production_ store. Return an explicit unimplemented signal instead, reusing the existing error type.

- [ ] **Step 1: Export the error from domain** — confirm `LedgerStoreUnavailableError` lives in `services/api/src/runtime.ts`. It must not be imported by `packages/domain` (layering). Instead add to `packages/domain/src/supabase-store.ts` a local:

```ts
export class NotImplementedInSupabaseStore extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented for the Supabase-backed store.`);
    this.name = "NotImplementedInSupabaseStore";
  }
}
```

- [ ] **Step 2: Write the failing test** — append to `tests/unit/supabase-store.test.ts`:

```ts
test("Supabase runSimulation/getCloseRun reject instead of returning fake data", async () => {
  const client = { schema: () => ({ from: () => ({}) }) } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  await assert.rejects(() => store.runSimulation({ title: "t", scenario: "s", actorId: "u" }), /not yet implemented/);
  await assert.rejects(() => store.getCloseRun(), /not yet implemented/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — both currently resolve.

- [ ] **Step 4: Replace the bodies**

```ts
  async runSimulation(_input: SimulationRequest): Promise<SimulationRun> {
    throw new NotImplementedInSupabaseStore("runSimulation");
  }

  async getCloseRun(): Promise<CloseRun> {
    throw new NotImplementedInSupabaseStore("getCloseRun");
  }
```

Then update `getSnapshot` (rewritten in the simplify pass to `Promise.all([... this.getCloseRun()])`): replace the `this.getCloseRun()` element with a literal honest placeholder so the workspace snapshot still loads:

```ts
      Promise.resolve<CloseRun>({
        id: "close_current",
        period: new Date().toISOString().slice(0, 7),
        generatedAt: nowIso(),
        checklist: [],
      }),
```

(empty `checklist` = "nothing computed yet", not a fake "ready/open" list).

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "fix(domain): Supabase store no longer returns fabricated simulation/close data"
```

---

# Phase 3 — Store Efficiency

### Task 7: `getReviewFeed` — one batched suggestions fetch instead of N+1

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`getReviewFeed`, `hydrateReviewRow`)
- Test: `tests/unit/supabase-store.test.ts` (append)

`getReviewFeed` maps every review row through `hydrateReviewRow`, which issues one `suggestions` query _per_ review whose embedded `suggestion` column is null. Fetch all needed suggestions in a single `in("voucher_id", …)` query and map in memory.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/supabase-store.test.ts` (the mock counts `suggestions` reads):

```ts
test("getReviewFeed fetches suggestions in one batched query", async () => {
  let suggestionReads = 0;
  const reviews = [
    { id: "r1", voucher_id: "v1", title: "a", status: "needs-review", suggested_action: "x", provenance_timeline: [] },
    { id: "r2", voucher_id: "v2", title: "b", status: "needs-review", suggested_action: "x", provenance_timeline: [] },
  ];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = { _table: table };
        for (const m of ["select", "eq", "order", "in"]) chain[m] = () => chain;
        chain.then = undefined;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.order = async () => ({ data: reviews, error: null });
        chain.in = async () => {
          suggestionReads++;
          return { data: [], error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const feed = await store.getReviewFeed();
  assert.equal(feed.length, 2);
  assert.equal(suggestionReads, 1); // one batched read, not one per review
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — current code calls `suggestions` once per null-suggestion row (2 reads) via `.maybeSingle`.

- [ ] **Step 3: Rewrite `getReviewFeed`**

```ts
  async getReviewFeed(): Promise<ReviewTask[]> {
    const { data, error } = await this.ledger()
      .from("review_tasks")
      .select("*")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to load review feed: ${error.message}`);
    const rows = data ?? [];

    const missingVoucherIds = rows.filter((r) => !r.suggestion).map((r) => r.voucher_id as string);
    const suggestionsByVoucher = new Map<string, AccountingSuggestion>();
    if (missingVoucherIds.length > 0) {
      const { data: suggestionRows, error: sErr } = await this.ledger()
        .from("suggestions")
        .select("*")
        .in("voucher_id", missingVoucherIds);
      if (sErr) throw new Error(`Failed to load suggestions: ${sErr.message}`);
      for (const row of suggestionRows ?? []) {
        suggestionsByVoucher.set(row.voucher_id as string, mapSuggestionRow(row));
      }
    }

    return rows.map((row) =>
      row.suggestion ? mapReviewRow(row) : mapReviewRow(row, suggestionsByVoucher.get(row.voucher_id as string)),
    );
  }
```

`hydrateReviewRow` is still used by `findReviewByVoucher`/`applyReviewDecision` (single-row paths) — leave it unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `pnpm test:unit` → all PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "perf(domain): getReviewFeed batches suggestion lookups (N+1 -> 2 queries)"
```

---

### Task 8: `getEvidenceContext` — collapse the sequential chain, drop the duplicate query and N+1 fallback

**Files:**

- Modify: `packages/domain/src/supabase-store.ts` (`getEvidenceContext`, ~lines 353-475)
- Test: `tests/unit/supabase-store.test.ts` (append)

Problems: the first `evidence_packet_items` lookup uses `.maybeSingle()` (throws if the evidence is in >1 packet); `evidence_packet_items` for the same evidence is queried **twice**; the fallback loop issues one `vouchers` query per packet (N+1). Replace with: fetch all packet links for the evidence once, then resolve packet + items + voucher for those packet ids with `.in(...)`, parallelized.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/supabase-store.test.ts`:

```ts
test("getEvidenceContext resolves voucher across multiple packet links without per-packet queries", async () => {
  let voucherReads = 0;
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
        chain.maybeSingle = async () => {
          if (table === "evidence_objects")
            return {
              data: {
                id: "e1",
                organization_id: "o",
                workspace_id: "w",
                created_at: "2026-01-01T00:00:00.000Z",
                created_by: "u",
                title: "t",
                modalities: ["pdf"],
                original_filename: "f.pdf",
                mime_type: "application/pdf",
                blob_path: "b",
                hash: "h",
                trust_level: "user-upload",
              },
              error: null,
            };
          return { data: null, error: null };
        };
        chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === "evidence_packet_items")
            return resolve({ data: [{ evidence_packet_id: "p1" }, { evidence_packet_id: "p2" }], error: null });
          if (table === "vouchers") {
            voucherReads++;
            return resolve({
              data: [
                {
                  id: "v1",
                  organization_id: "o",
                  workspace_id: "w",
                  evidence_packet_id: "p2",
                  voucher_number: "V-1",
                  status: "needs-review",
                  accounting_method: "invoice",
                  extracted_fields: [],
                  voucher_fields: {},
                  created_at: "2026-01-01T00:00:00.000Z",
                  created_by: "u",
                },
              ],
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const ctx = await store.getEvidenceContext("e1");
  assert.equal(ctx?.voucher?.id, "v1");
  assert.equal(voucherReads, 1); // one `.in(...)` query, not one per packet
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — current code uses `.maybeSingle()` on the first packet-items query (would error/return one) and loops per packet.

- [ ] **Step 3: Rewrite `getEvidenceContext`**

```ts
  async getEvidenceContext(
    evidenceId: string,
  ): Promise<{ evidence: EvidenceObject; packet?: EvidencePacket; voucher?: Voucher } | undefined> {
    const { data: evidenceRow, error: evidenceError } = await this.ledger()
      .from("evidence_objects")
      .select("*")
      .eq("id", evidenceId)
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .maybeSingle();

    if (evidenceError) throw new Error(`Failed to load evidence: ${evidenceError.message}`);
    if (!evidenceRow) return undefined;
    const evidence = mapEvidenceRow(evidenceRow);

    const { data: links } = await this.ledger()
      .from("evidence_packet_items")
      .select("evidence_packet_id")
      .eq("evidence_object_id", evidenceId);

    const packetIds = [...new Set((links ?? []).map((r) => r.evidence_packet_id as string))];
    if (packetIds.length === 0) return { evidence };

    const [packetsRes, itemsRes, vouchersRes] = await Promise.all([
      this.ledger().from("evidence_packets").select("*")
        .eq("organization_id", this.ctx.organizationId).eq("workspace_id", this.ctx.workspaceId)
        .in("id", packetIds),
      this.ledger().from("evidence_packet_items").select("evidence_packet_id, evidence_object_id")
        .in("evidence_packet_id", packetIds),
      this.ledger().from("vouchers").select("*")
        .eq("organization_id", this.ctx.organizationId).eq("workspace_id", this.ctx.workspaceId)
        .in("evidence_packet_id", packetIds),
    ]);

    const packetRow = (packetsRes.data ?? [])[0];
    const packet: EvidencePacket | undefined = packetRow
      ? {
          id: packetRow.id as string,
          evidenceIds: (itemsRes.data ?? [])
            .filter((r) => r.evidence_packet_id === packetRow.id)
            .map((r) => r.evidence_object_id as string),
          note: (packetRow.note as string | null) ?? undefined,
          voiceTranscript: (packetRow.voice_transcript as string | null) ?? undefined,
        }
      : undefined;

    const voucherRow = (vouchersRes.data ?? [])[0];

    return {
      evidence,
      ...(packet ? { packet } : {}),
      ...(voucherRow ? { voucher: mapVoucherRow(voucherRow) } : {}),
    };
  }
```

- [ ] **Step 4: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `pnpm test:unit` → all PASS (incl. `ledger-store.test.ts` which exercises `getEvidenceContext` against the memory store — unchanged)
Run: `pnpm typecheck` → Done

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/supabase-store.ts tests/unit/supabase-store.test.ts
git commit -m "perf(domain): getEvidenceContext is 3 parallel queries, no duplicate read or N+1"
```

---

### Task 9: Maintained projection aggregates + narrowed report reads

**Files:**

- Create: `supabase/migrations/20260519000004_projection_aggregates.sql`
- Modify: `packages/domain/src/supabase-store.ts` (`getReports`; new `getBalances`/`getVat`)
- Modify: `packages/domain/src/store.ts` (`LedgerStore` interface — add `getBalances`, `getVat`)
- Modify: `services/api/src/store-factory.ts` (`UnavailableLedgerStore` — add the two methods)
- Modify: `services/api/src/app.ts` (`/api/reports/trial-balance`, `/api/reports/vat`, `/api/reports/general-ledger`)
- Test: `tests/unit/supabase-store.test.ts`, `tests/unit/ledger-store.test.ts`

`projections.account_balances` and `projections.vat_summary` exist but **nothing writes them**, so `getReports` recomputes both from a full unbounded `journal_entries` scan on every reports view (and `getSnapshot`). Add Postgres triggers that maintain the two aggregate tables on every `journal_entries` insert (mirroring `buildBalances`/`buildVat` exactly), then read the small aggregate tables for the balance/VAT slices and stop pulling the full journal for routes that don't need it.

- [ ] **Step 1: Create the migration** — `supabase/migrations/20260519000004_projection_aggregates.sql`:

```sql
-- Maintain projections.account_balances and projections.vat_summary incrementally
-- from projections.journal_entries. Mirrors packages/domain/src/projections.ts
-- (buildBalances / buildVat): balance = debit - credit; vat base = debit or credit
-- whichever is non-zero; vat_amount accrues only on account 2641 (input VAT);
-- account_name / deductible keep their first-seen value (do-not-update on conflict).

create or replace function projections.apply_journal_aggregates()
returns trigger
language plpgsql
as $$
begin
  insert into projections.account_balances
    (organization_id, workspace_id, account_number, account_name, debit, credit, balance)
  values
    (new.organization_id, new.workspace_id, new.account_number, new.account_name,
     new.debit, new.credit, new.debit - new.credit)
  on conflict (organization_id, workspace_id, account_number) do update
    set debit   = projections.account_balances.debit  + excluded.debit,
        credit  = projections.account_balances.credit + excluded.credit,
        balance = (projections.account_balances.debit  + excluded.debit)
                - (projections.account_balances.credit + excluded.credit);

  insert into projections.vat_summary
    (organization_id, workspace_id, vat_code, base_amount, vat_amount, deductible)
  values
    (new.organization_id, new.workspace_id, new.vat_code,
     case when new.debit <> 0 then new.debit else new.credit end,
     case when new.account_number = '2641' then new.debit - new.credit else 0 end,
     new.deductible)
  on conflict (organization_id, workspace_id, vat_code) do update
    set base_amount = projections.vat_summary.base_amount
          + (case when new.debit <> 0 then new.debit else new.credit end),
        vat_amount  = projections.vat_summary.vat_amount
          + (case when new.account_number = '2641' then new.debit - new.credit else 0 end);

  return new;
end;
$$;

create trigger trg_journal_aggregates
  after insert on projections.journal_entries
  for each row execute function projections.apply_journal_aggregates();

-- Backfill any rows inserted before this trigger existed.
insert into projections.account_balances
  (organization_id, workspace_id, account_number, account_name, debit, credit, balance)
select organization_id, workspace_id, account_number, min(account_name),
       sum(debit), sum(credit), sum(debit) - sum(credit)
from projections.journal_entries
group by organization_id, workspace_id, account_number
on conflict (organization_id, workspace_id, account_number) do nothing;

insert into projections.vat_summary
  (organization_id, workspace_id, vat_code, base_amount, vat_amount, deductible)
select organization_id, workspace_id, vat_code,
       sum(case when debit <> 0 then debit else credit end),
       sum(case when account_number = '2641' then debit - credit else 0 end),
       bool_or(deductible)
from projections.journal_entries
group by organization_id, workspace_id, vat_code
on conflict (organization_id, workspace_id, vat_code) do nothing;
```

- [ ] **Step 2: Static-check the SQL**

Run: `npx --yes @databases/pg-syntax-lint supabase/migrations/20260519000004_projection_aggregates.sql` _(if unavailable, instead run `supabase db reset --linked=false` against a local instance, or do a manual review confirming every column matches the table defs in `20260324000000_schema_v2.sql` lines 260-282)._
Expected: no syntax errors; column names exactly match the `account_balances`/`vat_summary` definitions.

- [ ] **Step 3: Add `getBalances`/`getVat` to the interface** — in `packages/domain/src/store.ts`, add to `interface LedgerStore`:

```ts
  getBalances(): Promise<ReportBundle["balances"]>;
  getVat(): Promise<ReportBundle["vat"]>;
```

Add implementations to `MemoryLedgerStore` (derive from `this.ledgerLines`, reusing existing helpers):

```ts
  async getBalances() { return buildBalances(this.ledgerLines); }
  async getVat() { return buildVat(this.ledgerLines); }
```

Add to `UnavailableLedgerStore` in `store-factory.ts`:

```ts
  async getBalances() { return this.fail(); }
  async getVat() { return this.fail(); }
```

- [ ] **Step 4: Write the failing test** — append to `tests/unit/supabase-store.test.ts`:

```ts
test("getBalances reads the maintained aggregate table, not journal_entries", async () => {
  let journalReads = 0;
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
        chain.then = (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === "journal_entries") {
            journalReads++;
            return resolve({ data: [], error: null });
          }
          if (table === "account_balances")
            return resolve({
              data: [{ account_number: "6540", account_name: "IT", debit: 1000, credit: 0, balance: 1000 }],
              error: null,
            });
          return resolve({ data: [], error: null });
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const balances = await store.getBalances();
  assert.equal(balances[0].accountNumber, "6540");
  assert.equal(journalReads, 0);
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx tsx --test tests/unit/supabase-store.test.ts`
Expected: FAIL — `getBalances` does not exist on `SupabaseLedgerStore`.

- [ ] **Step 6: Implement aggregate reads in `supabase-store.ts`**

```ts
  async getBalances(): Promise<ReportBundle["balances"]> {
    const { data, error } = await this.projections()
      .from("account_balances")
      .select("account_number, account_name, debit, credit, balance")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("account_number", { ascending: true });
    if (error) throw new Error(`Failed to load balances: ${error.message}`);
    return (data ?? []).map((r) => ({
      accountNumber: r.account_number as string,
      accountName: r.account_name as string,
      debit: Number(r.debit),
      credit: Number(r.credit),
      balance: Number(r.balance),
    }));
  }

  async getVat(): Promise<ReportBundle["vat"]> {
    const { data, error } = await this.projections()
      .from("vat_summary")
      .select("vat_code, base_amount, vat_amount, deductible")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId);
    if (error) throw new Error(`Failed to load VAT summary: ${error.message}`);
    return (data ?? []).map((r) => ({
      vatCode: r.vat_code as string,
      baseAmount: Number(r.base_amount),
      vatAmount: Number(r.vat_amount),
      deductible: Boolean(r.deductible),
    }));
  }
```

Then narrow `getReports` to compose them (journal still from `journal_entries` but with explicit columns, not `select("*")`):

```ts
  async getReports(): Promise<ReportBundle> {
    const { data, error } = await this.projections()
      .from("journal_entries")
      .select("voucher_id, account_number, account_name, description, debit, credit, vat_code, deductible, booked_at")
      .eq("organization_id", this.ctx.organizationId)
      .eq("workspace_id", this.ctx.workspaceId)
      .order("booked_at", { ascending: true });
    if (error) throw new Error(`Failed to load journal entries: ${error.message}`);
    const lines = (data ?? []).map((row) => mapJournalRowToLedgerLine(row));
    const [balances, vat] = await Promise.all([this.getBalances(), this.getVat()]);
    return { journal: buildJournal(lines), balances, vat };
  }
```

- [ ] **Step 7: Point read-only report routes at the narrow methods** — in `services/api/src/app.ts`:
  - `/api/reports/trial-balance` and `/api/reports/general-ledger` (balance views): `context.json(await context.get("store").getBalances())`
  - `/api/reports/vat`: `context.json(await context.get("store").getVat())`
  - leave the route that needs the full journal calling `getReports()`.
    Match the existing response shape (these routes currently return `(await getReports()).balances` / `.vat`, so the payload is unchanged).

- [ ] **Step 8: Verify**

Run: `npx tsx --test tests/unit/supabase-store.test.ts` → PASS
Run: `npx tsx --test tests/unit/ledger-store.test.ts` → PASS (memory `getBalances/getVat` equal the old `getReports().balances/.vat`)
Run: `pnpm test:unit && pnpm typecheck` → all green

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260519000004_projection_aggregates.sql packages/domain/src/supabase-store.ts packages/domain/src/store.ts services/api/src/store-factory.ts services/api/src/app.ts tests/unit/supabase-store.test.ts
git commit -m "perf(domain): maintain projection aggregates via trigger; report routes read them"
```

---

# Phase 4 — Reuse & Quality

### Task 10: Shared voucher/review draft builder

**Files:**

- Create: `packages/domain/src/voucher-draft.ts`
- Modify: `packages/domain/src/index.ts` (export it)
- Modify: `packages/domain/src/store.ts` (`createEvidence`)
- Modify: `packages/domain/src/supabase-store.ts` (`createEvidence`)
- Test: `tests/unit/voucher-draft.test.ts` (new)

Both `createEvidence` implementations build the identical `voucherFields` literal (with magic `grossAmount: 1249, netAmount: 999.2, vatAmount: 249.8, vatRate: 25`) and the identical `ReviewTask` (blocked/suggested ternaries + 4-step provenance). Extract one builder; the per-store difference is only ids/voucherNumber/actor, which become parameters.

- [ ] **Step 1: Write the failing test** — `tests/unit/voucher-draft.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildVoucherDraft } from "@jpx-accounting/domain";

test("buildVoucherDraft produces voucher + review + suggestion from extracted fields", () => {
  const draft = buildVoucherDraft({
    organizationId: "o",
    workspaceId: "w",
    actorId: "u",
    voucherId: "v1",
    packetId: "p1",
    voucherNumber: "V-1001",
    description: "OpenAI subscription invoice",
    createdAt: "2026-05-19T00:00:00.000Z",
    input: {
      organizationId: "o",
      workspaceId: "w",
      actorId: "u",
      title: "OpenAI subscription invoice",
      originalFilename: "openai.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf"],
    },
  });
  assert.equal(draft.voucher.voucherFields.grossAmount, 1249);
  assert.equal(draft.review.voucherId, "v1");
  assert.equal(draft.review.provenanceTimeline.length, 4);
  assert.equal(draft.suggestion.voucherId, "v1");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/voucher-draft.test.ts`
Expected: FAIL — `buildVoucherDraft` not exported.

- [ ] **Step 3: Create `voucher-draft.ts`** (lift the shared literals out of the two `createEvidence` bodies verbatim):

```ts
import type { AccountingSuggestion, EvidenceCreateInput, ReviewTask, Voucher } from "@jpx-accounting/contracts";

import { buildExtractedFields, guessAccountingMethod } from "./extraction";
import { createId } from "./ids";
import { buildDeterministicSuggestion, evaluateVoucherRules } from "./rules";

export type VoucherDraftInput = {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  voucherId: string;
  packetId: string;
  voucherNumber: string;
  description: string;
  createdAt: string;
  input: EvidenceCreateInput;
};

export function buildVoucherDraft(d: VoucherDraftInput): {
  voucher: Voucher;
  review: ReviewTask;
  suggestion: AccountingSuggestion;
} {
  const extractedFields = buildExtractedFields(d.input);
  const voucher: Voucher = {
    id: d.voucherId,
    organizationId: d.organizationId,
    workspaceId: d.workspaceId,
    evidencePacketId: d.packetId,
    voucherNumber: d.voucherNumber,
    status: "needs-review",
    accountingMethod: guessAccountingMethod(d.input),
    extractedFields,
    voucherFields: {
      supplierName: extractedFields.find((f) => f.key === "supplierName")?.value,
      supplierVatNumber: extractedFields.find((f) => f.key === "supplierVatNumber")?.value,
      invoiceNumber: extractedFields.find((f) => f.key === "invoiceNumber")?.value,
      receiptDate: extractedFields.find((f) => f.key === "receiptDate")?.value,
      transactionDate: extractedFields.find((f) => f.key === "transactionDate")?.value,
      description: d.description,
      grossAmount: 1249,
      netAmount: 999.2,
      vatAmount: 249.8,
      vatRate: 25,
      currency: "SEK",
    },
    createdAt: d.createdAt,
    createdBy: d.actorId,
  };

  const ruleHits = evaluateVoucherRules(voucher);
  const suggestion = buildDeterministicSuggestion(voucher, ruleHits);
  const blocked = ruleHits.some((r) => r.severity === "blocking");
  const review: ReviewTask = {
    id: createId("review"),
    voucherId: d.voucherId,
    title: `Review ${d.voucherNumber}`,
    status: "needs-review",
    blockedReason: blocked
      ? "Mandatory bookkeeping or VAT data must be confirmed before deductible VAT can be approved."
      : undefined,
    suggestedAction: blocked ? "Request more evidence or post without VAT deduction." : "Approve the proposed posting.",
    suggestion,
    provenanceTimeline: [
      { id: createId("step"), label: "Evidence received", timestamp: d.createdAt, actor: d.actorId },
      { id: createId("step"), label: "Fields extracted", timestamp: d.createdAt, actor: "system-extractor" },
      { id: createId("step"), label: "Rules applied", timestamp: d.createdAt, actor: "system-rules" },
      { id: createId("step"), label: "Suggestion generated", timestamp: d.createdAt, actor: "system-ai" },
    ],
  };

  return { voucher, review, suggestion };
}
```

Add `export * from "./voucher-draft";` to `packages/domain/src/index.ts` (alphabetical: after `./store`, before `./supabase-mappers`).

- [ ] **Step 4: Use it in both stores** — in each `createEvidence`, replace the inline `extractedFields`/`voucher`/`ruleHits`/`suggestion`/`review` block with:

```ts
const { voucher, review, suggestion } = buildVoucherDraft({
  organizationId: input.organizationId,
  workspaceId: input.workspaceId,
  actorId: input.actorId,
  voucherId,
  packetId,
  voucherNumber, // store.ts: `V-${this.vouchers.size + 1001}`; supabase-store.ts: `V-${Date.now() % 100000}`
  description: input.title,
  createdAt,
  input,
});
const extractedFields = voucher.extractedFields;
```

Compute `voucherNumber` into a local before the call exactly as each store did. Keep `seedDemoData`'s post-`createEvidence` title patch.

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/voucher-draft.test.ts` → PASS
Run: `pnpm test:unit` → all PASS (`ledger-store.test.ts`, `supabase-store.test.ts`, `api-runtime.test.ts` unchanged behavior)
Run: `pnpm typecheck` → Done

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/voucher-draft.ts packages/domain/src/index.ts packages/domain/src/store.ts packages/domain/src/supabase-store.ts tests/unit/voucher-draft.test.ts
git commit -m "refactor(domain): shared buildVoucherDraft; remove duplicated voucher/review construction"
```

---

### Task 11: Source BAS account numbers + VAT codes from `bas.ts`

**Files:**

- Modify: `packages/domain/src/bas.ts` (add named constants)
- Modify: `packages/domain/src/posting.ts:30-46`
- Modify: `packages/domain/src/projections.ts:51`
- Modify: `packages/domain/src/store.ts` (`initialLedgerLines`)
- Test: `tests/unit/posting.test.ts` (existing — must stay green)

- [ ] **Step 1: Add constants to `bas.ts`**

```ts
export const ACCOUNT_INPUT_VAT = "2641";
export const ACCOUNT_COMPANY_BANK = "1930";
export const VAT_CODE_NONE = "NA";

export const ACCOUNT_NAME = {
  [ACCOUNT_INPUT_VAT]: "Debiterad ingående moms",
  [ACCOUNT_COMPANY_BANK]: "Företagskonto",
} as const;
```

- [ ] **Step 2: Use them in `posting.ts`** — replace the literal `"2641"`/`"Debiterad ingående moms"`, `"1930"`/`"Företagskonto"`, and `vatCode: "NA"` with `ACCOUNT_INPUT_VAT`, `ACCOUNT_NAME[ACCOUNT_INPUT_VAT]`, `ACCOUNT_COMPANY_BANK`, `ACCOUNT_NAME[ACCOUNT_COMPANY_BANK]`, `VAT_CODE_NONE` (add `import { ACCOUNT_COMPANY_BANK, ACCOUNT_INPUT_VAT, ACCOUNT_NAME, VAT_CODE_NONE } from "./bas";`).

- [ ] **Step 3: Use the constant in `projections.ts`** — change `if (line.accountNumber === "2641")` to `if (line.accountNumber === ACCOUNT_INPUT_VAT)` (`import { ACCOUNT_INPUT_VAT } from "./bas";`).

- [ ] **Step 4: Use them in `store.ts` `initialLedgerLines`** — replace the `"2641"`/`"1930"`/`"NA"` literals with the constants (the `"6540"` seed line is fine to leave as a literal — it is demo seed data, not a domain rule).

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/posting.test.ts` → PASS (output identical — constants resolve to the same strings)
Run: `pnpm test:unit && pnpm typecheck` → all green

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/bas.ts packages/domain/src/posting.ts packages/domain/src/projections.ts packages/domain/src/store.ts
git commit -m "refactor(domain): source input-VAT/bank account + NA vat-code from bas.ts"
```

---

### Task 12: Shared `today()` digest-date helper

**Files:**

- Modify: `packages/domain/src/ids.ts`
- Modify: `packages/domain/src/extraction.ts`, `store.ts`, `supabase-store.ts`
- Test: `tests/unit/ids-today.test.ts` (new)

`new Date().toISOString().slice(0, 10)` is hand-rolled in ≥4 places.

- [ ] **Step 1: Write the failing test** — `tests/unit/ids-today.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { today } from "@jpx-accounting/domain";

test("today returns an ISO yyyy-mm-dd date", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --test tests/unit/ids-today.test.ts`
Expected: FAIL — `today` not exported.

- [ ] **Step 3: Add the helper** — append to `packages/domain/src/ids.ts`:

```ts
export function today() {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Replace inline occurrences** — in `extraction.ts` (`const today = new Date()...` → import and call `today()`; rename the local to avoid shadowing), `store.ts` `appendEvent` (`const digestDate = ...`), and `supabase-store.ts` `appendEvent` (`const digestDate = ...`). Leave `getCloseRun`'s `.slice(0, 7)` (month, different helper — out of scope).

- [ ] **Step 5: Verify**

Run: `npx tsx --test tests/unit/ids-today.test.ts` → PASS
Run: `pnpm test:unit && pnpm typecheck` → all green

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/ids.ts packages/domain/src/extraction.ts packages/domain/src/store.ts packages/domain/src/supabase-store.ts tests/unit/ids-today.test.ts
git commit -m "refactor(domain): shared today() helper, drop inline date slicing"
```

---

### Task 13: Share the `UnavailableLedgerStore` reason string

**Files:**

- Modify: `services/api/src/runtime.ts` (export the constant next to `LedgerStoreUnavailableError`)
- Modify: `services/api/src/store-factory.ts:96-98`

- [ ] **Step 1: Export the constant** — in `services/api/src/runtime.ts`, below the `LedgerStoreUnavailableError` class:

```ts
export const LEDGER_STORE_UNAVAILABLE_REASON =
  "Workspace data is unavailable in normal mode until a non-demo LedgerStore implementation is configured.";
```

- [ ] **Step 2: Reference it** — in `services/api/src/store-factory.ts`, change the import to `import { LEDGER_STORE_UNAVAILABLE_REASON, LedgerStoreUnavailableError } from "./runtime";` and replace the inline string in `new UnavailableLedgerStore(...)` with `LEDGER_STORE_UNAVAILABLE_REASON`.

- [ ] **Step 3: Verify**

Run: `pnpm test:unit` → `api-runtime.test.ts` "normal runtime fails closed … /unavailable/i" still PASS
Run: `pnpm typecheck` → Done

- [ ] **Step 4: Commit**

```bash
git add services/api/src/runtime.ts services/api/src/store-factory.ts
git commit -m "refactor(api): single LEDGER_STORE_UNAVAILABLE_REASON constant"
```

---

### Task 14: Restore the load-bearing api-proxy comment + document accepted double-validation

**Files:**

- Modify: `apps/web/app/api-proxy/[...path]/route.ts`

No behavior change. The simplify pass / earlier changeset deleted the WHY comment explaining why this same-origin proxy exists; the new auth block makes that rationale _more_ relevant. Also record that proxy `getSession()` + API `getClaims()` validating the same token twice is a deliberate, accepted trade-off of the same-origin-proxy design (not a bug to silently "fix").

- [ ] **Step 1: Add the comment** — at the top of `proxyRequest`, above `const { runtimeMode } = getWebServerRuntimeConfig();`:

```ts
// The browser talks to this same-origin route so API targeting stays runtime-configurable
// in Azure and during e2e runs. In normal mode it attaches the Supabase access token; the
// Hono API then re-verifies that token (getClaims). The double validation is intentional and
// accepted: it keeps the browser from ever holding an API-trusted credential directly.
```

- [ ] **Step 2: Verify** (comment-only)

Run: `pnpm typecheck` → `apps/web` Done

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api-proxy/[...path]/route.ts"
git commit -m "docs(web): restore proxy rationale comment; document accepted double token validation"
```

---

## Self-Review

**Spec coverage** — every open finding maps to a task:

| Finding (review source)                                                        | Task                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| H3 tenant fail-open default                                                    | 2                                                                                                                                |
| H4 skipVerification real tenant                                                | 3                                                                                                                                |
| M6 StoreContext/Scope type sprawl                                              | 1 (+5 extends it)                                                                                                                |
| M8 / Eff#8 suggestVoucher unscoped + extra round trip                          | 4                                                                                                                                |
| L7 settings actor = contactEmail                                               | 5                                                                                                                                |
| L3 fake simulation/close data                                                  | 6                                                                                                                                |
| Eff#2 getReviewFeed N+1                                                        | 7                                                                                                                                |
| H1 / Eff#7 getEvidenceContext chain + dup query + N+1                          | 8                                                                                                                                |
| Eff#3 / Eff#9 unbounded recompute + SELECT \*                                  | 9                                                                                                                                |
| M2 (remainder) voucher/review construction dup                                 | 10                                                                                                                               |
| Reuse#6 / L2 stringly-typed BAS accounts                                       | 11                                                                                                                               |
| Reuse#8 inline date slicing                                                    | 12                                                                                                                               |
| Reuse#7 duplicated unavailable-reason string                                   | 13                                                                                                                               |
| L4 deleted proxy comment / Eff#5 double validation                             | 14                                                                                                                               |
| L8 auth/login JSX, L9 leftover TODOs, M4 async-no-await, #12 per-request store | None — confirmed non-issues / informational in the review; no action                                                             |
| H1's tenant-unscoped first packet-items read                                   | Folded into Task 8 (evidence is org-verified before the link query; rework removes the `.maybeSingle()` correctness bug)         |
| api-proxy per-request `createSupabaseServerClient` cost (Eff#5)                | Task 14 documents it as inherent to the design; no safe in-place fix without re-architecting the proxy (explicitly out of scope) |

**Placeholder scan:** no TBD/"handle errors"/"similar to Task N"; every code/SQL/test step contains complete content.

**Type consistency:** `TenantScope` (Task 1) is widened to `TenantScope & { userId: string }` consistently in Task 5 across `store-factory.ts`, `runtime.ts`, `app.ts`, `supabase-store.ts`. `buildVoucherDraft` signature in Task 10 matches its test and both call sites. `getBalances`/`getVat` added to the `LedgerStore` interface, `MemoryLedgerStore`, `UnavailableLedgerStore`, and `SupabaseLedgerStore` in Task 9 (no implementer left missing). `MissingTenantClaimError`/`NotImplementedInSupabaseStore`/`LEDGER_STORE_UNAVAILABLE_REASON` are each defined before first use.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-19-supabase-hardening.md`.
