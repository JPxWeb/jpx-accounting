# Track B — Supabase & Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Update [DEV_STATUS.md](../../DEV_STATUS.md) when each phase completes.
>
> **Parallel work:** [Track A — IA restructure](./2026-05-13-ia-restructure.md) (Phases 5–8) runs **in parallel**. This plan owns all Supabase, API store, auth, projections, blob upload, and normal-mode E2E. Avoid editing the same files in both tracks without coordination (see [Parallel execution](#parallel-execution-with-track-a)).

**Goal:** Make `ACCOUNTING_RUNTIME_MODE=normal` with Supabase env vars deliver the same core flows as demo (`MemoryLedgerStore`): capture evidence → review queue → approve/reject → Books/Reports/SIE — while keeping Azure for web/API compute, blob storage, and OpenAI.

**Architecture:** Per-request `SupabaseLedgerStore` (service key, app-level org filtering) writes to the `ledger.*` event/voucher/review tables and a `projections.journal_entries` read model; Supabase Auth issues JWTs whose **`app_metadata`** carries the tenant; the Next.js app authenticates with `@supabase/ssr` and proxies a Bearer token to the Hono API, which verifies it locally via `getClaims()`.

**Tech Stack:** Supabase (Postgres 17, Auth, local CLI), `@supabase/supabase-js` ^2.100, `@supabase/ssr`, Hono 4, Next.js 16, `@azure/storage-blob` + `@azure/identity`, `tsx --test`, Playwright 1.58.

**Non-goals (this track):** Azure Postgres migration, Drizzle ORM adoption (raw `supabase-js` for now — see [open question](#open-questions)), Document Intelligence OCR, AI Search indexing, full multi-tenant billing, Track A UI features (Capture page UI, Cmd-K, P&L charts).

**Supersedes:** Task-level detail in [`2026-03-29-auth-and-database.md`](./2026-03-29-auth-and-database.md) — use **this document** as the active checklist.

---

## ⚠️ Corrections applied vs. the previous revision (READ THIS FIRST)

This revision was audited against the live codebase and current Supabase/Azure docs (verified May 2026 — see [Verified references](#verified-references)). If you read an older copy, these changed:

| # | Previous guidance | Why it was wrong | Corrected in |
|---|-------------------|------------------|--------------|
| C1 | "Verify PostgREST exposes `ledger` schema" (risk-register footnote) | **Blocking bug.** `supabase-store.ts` calls `.from("ledger.events")`, which supabase-js treats as a table named `ledger.events` in `public`. `config.toml` only exposes `["public","graphql_public"]`. Every write currently fails silently (swallowed by fire-and-forget `.catch`). | **New blocking [Task 0.0](#task-00-expose-the-ledger--projections-schemas-blocking)** |
| C2 | Org id from `user_metadata.organization_id` (Tasks 0.3, 4.5; live in `auth.ts:63`) | **Security hole.** `user_metadata` is end-user-writable via `supabase.auth.updateUser({ data })`; a user could switch `organization_id` and read another tenant's ledger. | `app_metadata` everywhere — [Task 0.3](#task-03-tenant-identity-from-app_metadata-security), [Task 4.5](#task-45-dev-user-bootstrap-app_metadata) |
| C3 | `getUser(token)` per request (live in `auth.ts:57`) | Network round-trip to the Auth server on **every API call** → latency + rate-limit + outage coupling. | `getClaims()` with asymmetric signing keys — [Task 0.3](#task-03-tenant-identity-from-app_metadata-security) |
| C4 | Hash chain not addressed | `appendEvent` does `SELECT max → INSERT` with no lock; concurrent appends fork the append-only legal chain (Bokföringslagen integrity). | **New [Task 0.5](#task-05-make-the-event-hash-chain-concurrency-safe)** (unique index + retry) |
| C5 | `.single()` on the last-event lookup | Throws `PGRST116` when a tenant has zero events (every first write). | `.maybeSingle()` — folded into [Task 0.4](#task-04-await-evidence-persistence-fail-loud) |
| C6 | `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` env names | Legacy JWT keys are deprecated; new model is `sb_publishable_…` / `sb_secret_…`. | [Environment variables](#environment-variables-normal-mode-dev) (both accepted; new names preferred) |
| C7 | "Wire in `config.toml` `[db.seed]` if not already" (Task 6.1) | It is **already** wired (`sql_paths = ["./seed.sql"]`, `enabled = true`); `seed.sql` just doesn't exist yet. | [Task 6.1](#task-61-seed-script) simplified |
| C8 | Azure Blob via `AZURE_STORAGE_CONNECTION_STRING` | Account-key/connection-string secrets in App Service. Managed identity + **user-delegation SAS** is the current secure pattern and matches the credibility/compliance posture. | [Phase 5](#phase-5--azure-blob-evidence-upload-user-delegation-sas) |

---

## For the junior developer (onboarding)

You don't need accounting knowledge. You do need to understand five repo-specific things:

1. **Two runtime modes.** `demo` uses `MemoryLedgerStore` (in-process, seeded, no DB). `normal` uses `SupabaseLedgerStore`. The composition root that picks one is `services/api/src/runtime.ts`. **Your prime directive: never break `demo`.** Demo E2E runs on every PR.
2. **`LedgerStore` is the seam.** One TypeScript interface (`packages/domain/src/store.ts`) with two implementations. `MemoryLedgerStore` is the **reference behaviour**: when in doubt about what `SupabaseLedgerStore` should return, read what `MemoryLedgerStore` does and match it.
3. **Event sourcing.** `ledger.events` is append-only and hash-chained (a DB trigger blocks `UPDATE`/`DELETE`). Mutable tables (`vouchers`, `review_tasks`) are convenience read state; the events are the legal record. Reports (`journal`, `balances`, `vat`) are *derived* by pure functions in `packages/domain/src/projections.ts`.
4. **The API uses the service key and bypasses RLS.** Tenant isolation on the API path is therefore **100% your responsibility in application code**: every Supabase query MUST be filtered by `organization_id` (and usually `workspace_id`). RLS policies exist but only protect the *future* direct-client path (Phase 7). See [the org-filter checklist](#mandatory-org-filter-checklist).
5. **Verify, don't assume.** After each task run the [verification commands](#verification-after-each-phase). Supabase changes often — if a doc claim here disagrees with reality, trust reality and flag it.

### Glossary

| Term | Meaning in this repo |
|------|----------------------|
| **Evidence** | An uploaded file record (receipt/invoice). Immutable. `ledger.evidence_objects`. |
| **Packet** | A grouping of one+ evidence rows. `ledger.evidence_packets` + `evidence_packet_items`. |
| **Voucher** | The accounting transaction extracted from a packet, pending review. `ledger.vouchers`. |
| **Review task** | A human approval item in the Today feed. `ledger.review_tasks`. |
| **Suggestion** | Deterministic AI posting recommendation (BAS account + VAT). `ledger.suggestions`. |
| **Posting / journal line** | A debit/credit row produced when a review is approved. `projections.journal_entries`. |
| **Projection** | A read model derived from events (journal/balances/VAT). Never a source of truth. |
| **Service key (`sb_secret_…` / `service_role`)** | Server-only key that **bypasses RLS**. Used by the API. |
| **Publishable key (`sb_publishable_…` / `anon`)** | Browser-safe key. RLS applies. Used by `@supabase/ssr`. |
| **`app_metadata`** | JWT claims set only by admins/hooks. **Trustworthy** for authorization. Holds `organization_id`. |
| **`user_metadata`** | JWT claims the user can edit. **Never** use for authorization. |
| **`.schema('ledger')`** | supabase-js call selector for a non-`public` Postgres schema. Required here. |

### Mandatory org-filter checklist

Because the API service key bypasses RLS, run this check on **every** query you add to `SupabaseLedgerStore`:

- [ ] Read queries (`select`) have `.eq("organization_id", this.ctx.organizationId)` and, for org+workspace-scoped tables, `.eq("workspace_id", this.ctx.workspaceId)`.
- [ ] Write queries (`insert`/`update`) set `organization_id`/`workspace_id` from `this.ctx`, never from request input.
- [ ] Cross-table lookups (e.g. suggestion by `voucher_id`) still resolve the parent's org before trusting the child row.
- [ ] A unit test asserts that a query for org A cannot see org B's seeded row.

---

## Architecture decisions (locked for implementation)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Source of truth** | `ledger.events` (append-only, hash-chained) + mutable `ledger.vouchers` / `ledger.review_tasks` | Matches existing schema and domain event model |
| **Schema access** | `supabase.schema('ledger' \| 'projections').from(table)`; schemas added to `config.toml` `[api] schemas` + `GRANT`ed | supabase-js cannot parse `"ledger.events"`; PostgREST rejects unexposed schemas even for the service role (C1) |
| **Reports read path** | Load `projections.journal_entries` → map to `LedgerLine` → reuse `buildJournal`/`buildBalances`/`buildVat` from `packages/domain/src/projections.ts` | Reuses proven projection logic; no logic drift from `MemoryLedgerStore` |
| **Reports write path** | On `applyReviewDecision` (non-reject), insert journal rows + append `PostedToLedger` event | Denormalized reads stay fast; full rebuild-from-events deferred to [Task 7.5](#task-75-projection-rebuild-job-optional) |
| **API DB access** | Per-request service-role client (bypasses RLS) + **mandatory org/workspace filter on every query** | Matches current `authMiddleware`; RLS via JWT claims deferred to Phase 7 |
| **Store lifetime** | **Per-request** `SupabaseLedgerStore` via factory | Fixes hardcoded `org_default` in `runtime.ts:103` |
| **`LedgerStore` sync/async** | **All methods `Promise`-returning**; remove fire-and-forget writes | Eliminates the create↔fetch race and silent write failures |
| **Tenant identity** | `organization_id` / `workspace_id` from JWT **`app_metadata`** (not `user_metadata`) | `user_metadata` is user-editable → cross-tenant access (C2) |
| **API token verification** | `supabase.auth.getClaims(token)` with **asymmetric JWT signing keys** | No per-request Auth-server round-trip; still cryptographically verified (C3) |
| **Event hash chain** | Unique index `(organization_id, workspace_id, previous_hash)` + bounded retry-on-conflict in `appendEvent` | Cheap optimistic concurrency; no fragile SQL port of the JS hash (C4) |
| **API keys** | Prefer `sb_publishable_…` (web) / `sb_secret_…` (API); legacy `anon`/`service_role` still accepted | Legacy JWT keys deprecated by Supabase (C6) |
| **Evidence files** | Metadata in Postgres; bytes in **Azure Blob** (swedencentral) via **user-delegation SAS** | Bicep provisions storage; managed identity > connection-string secrets (C8) |
| **Hosted region** | Supabase project in **`eu-north-1` (Stockholm)** | Bokföringslagen / audit checklist in tech stack doc |

---

## File map

| Path | Action | Phase |
|------|--------|-------|
| `supabase/config.toml` | Modify — add `ledger`, `projections` to `[api] schemas` | 0 |
| `supabase/migrations/<ts>_expose_ledger_schemas.sql` | Create (via `supabase migration new`) — GRANTs | 0 |
| `supabase/migrations/<ts>_event_chain_unique.sql` | Create — unique index for hash-chain safety | 0 |
| `supabase/migrations/<ts>_organization_settings.sql` | Create | 3 |
| `supabase/migrations/<ts>_rls_jwt_claims.sql` | Create — JWT-claim RLS policies | 7 |
| `supabase/seed.sql` | Create (path already wired in `config.toml`) | 6 |
| `supabase/signing_keys.json` | Create locally, **git-ignored** (`supabase gen signing-key`) | 0 |
| `packages/domain/src/ledger-line.ts` | Create (shared `LedgerLine` type + mappers) | 1 |
| `packages/domain/src/supabase-store.ts` | Major rewrite | 0–4 |
| `packages/domain/src/supabase-mappers.ts` | Create | 1 |
| `packages/domain/src/posting.ts` | Create (extract `buildPostingLines`) | 2 |
| `packages/domain/src/store.ts` | Modify — all methods return `Promise`; export `buildPostingLines` move | 0, 2 |
| `packages/domain/src/index.ts` | Export new modules | 0–2 |
| `services/api/src/store-factory.ts` | Create | 0 |
| `services/api/src/runtime.ts` | Modify — export factory, drop hardcoded org | 0 |
| `services/api/src/app.ts` | Modify — per-request store from context | 0 |
| `services/api/src/middleware/auth.ts` | Modify — `getClaims` + `app_metadata` | 0, 3 |
| `services/api/src/blob-upload.ts` | Create | 5 |
| `services/api/src/config.ts` | Modify — storage account + credential | 5 |
| `services/api/package.json` | Modify — add `@azure/storage-blob`, `@azure/identity` | 5 |
| `packages/supabase-client/src/index.ts` | Modify — `createScopedClient` uses publishable key | 4 |
| `apps/web/lib/supabase/server.ts` | Create | 4 |
| `apps/web/lib/supabase/client.ts` | Create | 4 |
| `apps/web/middleware.ts` | Create | 4 |
| `apps/web/app/auth/login/page.tsx` | Create | 4 |
| `apps/web/app/auth/callback/route.ts` | Create | 4 |
| `apps/web/app/api-proxy/[...path]/route.ts` | Modify — inject Bearer from session | 4 |
| `scripts/create-dev-user.mjs` | Create | 4 |
| `infra/azure/main.bicep` | Modify — grant API identity Storage Blob Data Contributor | 5 |
| `tests/unit/supabase-store.test.ts` | Expand | 0–2 |
| `tests/unit/supabase-projections.test.ts` | Create | 2 |
| `tests/integration/supabase-ledger.test.ts` | Create | 6 |
| `tests/e2e/normal-mode.spec.ts` | Create | 6 |
| `.env.example` | Update | 0, 4, 5 |
| `.gitignore` | Modify — add `supabase/signing_keys.json` | 0 |

---

## Prerequisites

### Local Supabase

```bash
supabase --version           # confirm CLI present; commands change between versions — use --help
supabase start               # requires Docker
supabase db reset            # applies migrations (+ seed.sql once Phase 6 creates it)
```

`supabase start` prints the local URL and **both** key formats. Copy them into `.env.local`.

### Environment variables (normal mode dev)

```bash
ACCOUNTING_RUNTIME_MODE=normal
NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal
ACCOUNTING_API_BASE_URL=http://localhost:3001

SUPABASE_URL=http://127.0.0.1:54321
# Prefer the new key names. Legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
# remain accepted by config.ts for back-compat during migration (C6).
SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… or local anon key>
SUPABASE_SECRET_KEY=<sb_secret_… or local service_role key>
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same publishable key>

# Phase 5 — no account key/connection string; identity-based (C8)
AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_CONTAINER=evidence
```

> First Supabase user must have `app_metadata.organization_id = "org_jpx"` and `app_metadata.workspace_id = "workspace_main"`. [Task 4.5](#task-45-dev-user-bootstrap-app_metadata) automates this.

### Verification after each phase

```bash
pnpm typecheck && pnpm test:unit && pnpm lint
# Phase 6+ also:
pnpm build && pnpm test:e2e            # demo-mode E2E MUST stay green
```

---

## Parallel execution with Track A

| Track B (this plan) | Track A (IA) | Conflict risk |
|---------------------|--------------|---------------|
| Phases 0–2 | Phase 5 Capture UI | **Low** — Capture UI calls existing `/api/evidence`; store changes stay behind unchanged API contracts |
| Phase 3 settings | Phase 8 fiscal year / team settings UI | **Medium** — coordinate: Track B owns API + DB; Track A owns forms/UI only |
| Phase 4 auth | Phase 6 Cmd-K | **Low** — different files |
| Phase 5 blob | Phase 5 Capture "promote draft" | **Medium** — agree `POST /api/uploads/init` response shape before either lands |
| Phase 6 E2E | Phase 7 Reports UI | **Low** — E2E uses journal/VAT APIs Track A consumes |

**Rule:** Track B must not break `ACCOUNTING_RUNTIME_MODE=demo` or the existing Playwright demo E2E.

---

## Phase 0 — Make the store actually reach Postgres (foundations)

**Goal:** Schemas reachable, `LedgerStore` async, per-request store with trustworthy tenant id, hash chain concurrency-safe, evidence persistence awaited and fail-loud. Demo mode unchanged.

**Estimated effort:** 2–3 days.

### Task 0.0: Expose the `ledger` & `projections` schemas (BLOCKING)

> Nothing else in normal mode works until this is done. Today every `SupabaseLedgerStore` write fails silently.

**Files:** `supabase/config.toml`, `supabase/migrations/<ts>_expose_ledger_schemas.sql`, `packages/domain/src/supabase-store.ts`

- [ ] **Step 1:** In `supabase/config.toml` change the `[api]` schemas line:

```toml
# was: schemas = ["public", "graphql_public"]
schemas = ["public", "graphql_public", "ledger", "projections"]
```

- [ ] **Step 2:** Create the grants migration with the CLI (never hand-name migration files):

```bash
supabase migration new expose_ledger_schemas
```

Put this in the generated file:

```sql
-- Custom schemas are owned by `postgres` and are NOT auto-granted to the
-- Supabase roles. PostgREST rejects a schema profile that isn't granted —
-- even for the service role (service_role bypasses RLS, not schema grants).
grant usage on schema ledger, projections to anon, authenticated, service_role;
grant all on all tables    in schema ledger, projections to anon, authenticated, service_role;
grant all on all sequences in schema ledger, projections to anon, authenticated, service_role;
grant all on all routines  in schema ledger, projections to anon, authenticated, service_role;

alter default privileges for role postgres in schema ledger
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema projections
  grant all on tables to anon, authenticated, service_role;
```

- [ ] **Step 3:** Apply and restart so PostgREST picks up the new exposed schemas:

```bash
supabase db reset      # re-applies all migrations including the new grants
supabase stop && supabase start   # PostgREST reloads [api] schemas on restart
```

- [ ] **Step 4:** In `supabase-store.ts`, replace **every** `this.supabase.from("ledger.<x>")` with `this.supabase.schema("ledger").from("<x>")` (and `projections` likewise). There are ~9 call sites in `persistCreateEvidence`, `persistComposeEvidence`, and `appendEvent`. Example diff for `appendEvent`:

```ts
// before
const { data: lastEvent } = await this.supabase
  .from("ledger.events")
  .select("event_hash")
// after
const { data: lastEvent } = await this.supabase
  .schema("ledger")
  .from("events")
  .select("event_hash")
```

- [ ] **Step 5: Verification.** With local Supabase up, run a smoke insert and read using the service key against the `ledger` schema (an integration-style scratch test, deleted after):

```bash
# expect: a row returned, no "schema must be one of the following" error
node -e "import('@supabase/supabase-js').then(async ({createClient})=>{const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);const {error}=await s.schema('ledger').from('events').select('id').limit(1);console.log(error??'OK');})"
```

Expected: `OK` (or empty result), **not** a PostgREST schema error.

### Task 0.1: Make `LedgerStore` fully async

**Files:** `packages/domain/src/store.ts`, `packages/domain/src/supabase-store.ts`, `services/api/src/runtime.ts`, `services/api/src/app.ts`, `tests/unit/ledger-store.test.ts`

- [ ] Change every `LedgerStore` method signature to return `Promise<…>` only (delete the `| Promise<…>` unions in `store.ts:32-55`).
- [ ] Make `MemoryLedgerStore` methods `async` (they can `return` values directly; the constructor calls `createEvidence` synchronously today — keep an internal sync `seed()` for the constructor, expose async `createEvidence`).
- [ ] Make `UnavailableLedgerStore` (`runtime.ts:15-81`) methods `async` and `await this.fail()` shaped (still throws).
- [ ] Confirm `app.ts` already `await`s store calls (it does for most); fix any non-awaited call.
- [ ] Run `pnpm typecheck`; fix every call site the compiler flags. Run `pnpm test:unit`.

### Task 0.2: Per-request store factory

**Files:** `services/api/src/store-factory.ts`, `services/api/src/runtime.ts`, `services/api/src/app.ts`

- [ ] Create `createLedgerStore(deps: { supabase: SupabaseClient | null; runtimeMode: RuntimeMode; organizationId: string; workspaceId: string }): LedgerStore`:
  - `demo` → `new MemoryLedgerStore()`.
  - `normal` + supabase client present → `new SupabaseLedgerStore(supabase, { organizationId, workspaceId })`.
  - else → `new UnavailableLedgerStore(reason)`.
- [ ] `createApiRuntimeDependencies` returns `{ runtimeMode, createLedgerStore, supabase, aiRuntime }` — a **shared** service client + a **factory**, not a single store. Delete the hardcoded `organizationId: "org_default"` (`runtime.ts:103-104`).
- [ ] In `app.ts`, add middleware **after** `authMiddleware` that does `c.set("store", createLedgerStore({ supabase, runtimeMode, organizationId: c.get("organizationId"), workspaceId: c.get("workspaceId") }))`.
- [ ] Replace route handlers' shared-store references with `c.get("store")`. Keep a demo-only singleton path for `POST /api/testing/reset`.
- [ ] `pnpm typecheck && pnpm test:unit`.

### Task 0.3: Tenant identity from `app_metadata` + `getClaims` (security)

**Files:** `services/api/src/middleware/auth.ts`, `supabase/config.toml`, `.gitignore`, `.env.example`

- [ ] **Local signing keys** (enables local asymmetric verification):

```bash
supabase gen signing-key --algorithm ES256 > supabase/signing_keys.json
```

In `config.toml` `[auth]` uncomment/set:

```toml
signing_keys_path = "./signing_keys.json"
```

Add `supabase/signing_keys.json` to `.gitignore`. (Hosted: dashboard → JWT signing keys → "Migrate JWT secret" → rotate.)

- [ ] Rewrite the normal-mode branch of `authMiddleware` to verify locally and read **`app_metadata`**:

```ts
// services/api/src/middleware/auth.ts (normal-mode branch)
const supabase = createClient(options.supabaseUrl, options.supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// getClaims verifies the JWT signature locally against the project JWKS
// (asymmetric keys) — no per-request round-trip to the Auth server.
const { data, error } = await supabase.auth.getClaims(token);
if (error || !data?.claims) {
  return context.json({ error: "Invalid or expired token" }, 401);
}
const claims = data.claims;

// app_metadata is admin/hook-controlled and safe for authorization.
// NEVER read organization_id from user_metadata (user-editable).
const appMeta = (claims.app_metadata ?? {}) as Record<string, unknown>;
const organizationId = (appMeta.organization_id as string) ?? "org_jpx";
const workspaceId = (appMeta.workspace_id as string) ?? "workspace_main";

context.set("userId", claims.sub as string);
context.set("userEmail", (claims.email as string) ?? "");
context.set("organizationId", organizationId);
context.set("workspaceId", workspaceId);
```

- [ ] Demo branch unchanged (`org_jpx` / `workspace_main`).
- [ ] Dev fallback when `app_metadata` missing → `org_jpx` (not `org_default`) so it lines up with `MemoryLedgerStore` and the seed. Document this in `.env.example`.
- [ ] **Test:** unit test with a token whose `user_metadata.organization_id = "evil_org"` but `app_metadata.organization_id = "org_jpx"` → middleware resolves `org_jpx`. This test is the regression guard for C2.

### Task 0.4: Await evidence persistence, fail loud

**Files:** `packages/domain/src/supabase-store.ts`, `tests/unit/supabase-store.test.ts`

- [ ] Make `createEvidence` and `composeEvidence` `async`; `await this.persistCreateEvidence(...)` / `persistComposeEvidence(...)` — delete the fire-and-forget `.catch(console.error)` (`supabase-store.ts:218`, `:344`).
- [ ] On any insert error, `throw new Error(...)` so the API returns 500 — no silent swallow. (This is also why C1's bug was invisible; fixing both together is correct.)
- [ ] In `appendEvent`, change `.single()` → `.maybeSingle()` (C5): zero events for a tenant must yield `null`, not a thrown `PGRST116`.
- [ ] **Test:** async test with a mock `SupabaseClient` capturing inserts; assert (a) all 6 inserts + 3 events fire, (b) a forced insert error rejects the returned promise.

### Task 0.5: Make the event hash chain concurrency-safe

> The hash is a DJB2 variant in `packages/domain/src/hash-chain.ts` (`buildEventHash(prev, payload) = h_<djb2(prev:payload)>`). Do **not** port it to plpgsql — use optimistic concurrency instead.

**Files:** `supabase/migrations/<ts>_event_chain_unique.sql`, `packages/domain/src/supabase-store.ts`, `tests/unit/supabase-store.test.ts`

- [ ] `supabase migration new event_chain_unique`:

```sql
-- Two concurrent appends that read the same latest event would both write a
-- row with the same previous_hash, forking the legal chain. This unique
-- index makes the second insert fail so the store can retry from fresh state.
create unique index ledger_events_chain_link_uidx
  on ledger.events (organization_id, workspace_id, previous_hash);
```

- [ ] Wrap the read-compute-insert in `appendEvent` in a bounded retry: on a unique-violation (`error.code === "23505"`) re-read the latest hash, recompute, retry (max 5 attempts, then throw).

```ts
for (let attempt = 0; attempt < 5; attempt++) {
  const { data: last } = await this.supabase.schema("ledger").from("events")
    .select("event_hash")
    .eq("organization_id", this.ctx.organizationId)
    .eq("workspace_id", this.ctx.workspaceId)
    .order("sequence_number", { ascending: false }).limit(1).maybeSingle();

  const previousHash = last?.event_hash ?? "GENESIS";
  const eventHash = buildEventHash(previousHash, JSON.stringify(event.payload));
  const { error } = await this.supabase.schema("ledger").from("events")
    .insert({ /* …row…, previous_hash: previousHash, event_hash: eventHash */ });

  if (!error) return this.mapEventRow(/* row */);
  if (error.code !== "23505") throw new Error(`Failed to append event: ${error.message}`);
  // else: chain advanced under us — loop and rebuild from fresh latest
}
throw new Error("append_event: exceeded retry budget on hash-chain contention");
```

- [ ] **Test:** fire `Promise.all` of two `appendEvent` calls against a mock that rejects the second with `{ code: "23505" }` once; assert both ultimately succeed and `previous_hash` values form a chain (no duplicate `previous_hash`).

### Phase 0 acceptance

- [ ] `pnpm typecheck && pnpm test:unit && pnpm lint` pass
- [ ] Demo E2E green (`pnpm build && pnpm test:e2e`)
- [ ] Normal mode without Supabase env → API still 503 (fail-closed unchanged)
- [ ] Task 0.0 smoke insert succeeds against local `ledger` schema
- [ ] DEV_STATUS.md Track B row → Phase 0 Done

---

## Phase 1 — Read path (workspace & review feed)

**Goal:** `/api/workspace`, `/api/reviews/feed`, evidence lookups return real Supabase data.

**Estimated effort:** 2–3 days. **Depends on:** Phase 0.

### Task 1.1: Row mappers + shared `LedgerLine`

**Files:** `packages/domain/src/supabase-mappers.ts`, `packages/domain/src/ledger-line.ts`, `packages/domain/src/index.ts`

- [ ] `ledger-line.ts`: export the `LedgerLine` type (today it's an inferred `Parameters<typeof buildJournal>[0][number]` in `store.ts:28` — promote it to a named exported type so both stores and mappers share it).
- [ ] `supabase-mappers.ts`: `mapReviewRow`, `mapVoucherRow`, `mapEvidenceRow`, `mapSuggestionRow`, `mapJournalRowToLedgerLine` — snake_case columns → `@jpx-accounting/contracts` types; JSON columns (`voucher_fields`, `extracted_fields`, `provenance_timeline`, `suggestion`, `citations`, `rule_hits`) parsed/validated with the matching Zod schema (fail loud on shape drift).
- [ ] **Test:** each mapper round-trips a representative DB row → contract type.

### Task 1.2: `getReviewFeed`

- [ ] Query `ledger.review_tasks` `.eq("organization_id", …).eq("workspace_id", …).order("created_at", { ascending: false })`.
- [ ] When `suggestion` column is null, secondary-query `ledger.suggestions` by `voucher_id`.
- [ ] **Test:** mock rows → mapped `ReviewTask[]`; org-A query cannot see an org-B row (org-filter checklist).

### Task 1.3: `getSnapshot`

- [ ] `reviews` ← `getReviewFeed()`; `evidence` ← `ledger.evidence_objects` (limit 100, org/workspace filtered); `vouchers` ← `ledger.vouchers`; `reports` ← `getReports()` (empty until Phase 2 — acceptable if no approvals yet); `alerts` ← `ledger.compliance_alerts` or `[]`; `assistantExamples` ← `ledger.assistant_sessions` limit 5 or `[]`; `closeRun` ← keep `MemoryLedgerStore`'s static checklist shape until Phase 7 (document).

### Task 1.4: Evidence lookups

- [ ] `getEvidenceContext(evidenceId)` — evidence + packet via `evidence_packet_items` + voucher by `evidence_packet_id` (all org-filtered).
- [ ] `findReviewByVoucher(voucherId)` — `review_tasks` where `voucher_id = ?` and org matches.
- [ ] `suggestVoucher(voucherId)` — `ledger.suggestions`, else regenerate via `buildDeterministicSuggestion(voucher, ruleHits)` from the voucher row.

### Task 1.5: `getEvents`

- [ ] `ledger.events` org/workspace filtered, `order by sequence_number asc`, cap 500.

### Phase 1 acceptance

- [ ] Manual: `POST /api/evidence` then `GET /api/reviews/feed` shows the new review
- [ ] Unit tests for mappers + `getReviewFeed` (incl. cross-org isolation)
- [ ] Track A Capture phase can rely on the feed after evidence POST

---

## Phase 2 — Review decisions & projections (core loop)

**Goal:** Approve / reject / book-without-vat persists; Books & Reports show journal/VAT in normal mode.

**Estimated effort:** 3–4 days. **Depends on:** Phase 1.

### Task 2.1: Extract shared posting logic

**Files:** `packages/domain/src/posting.ts`, `packages/domain/src/store.ts`, `packages/domain/src/index.ts`, `tests/unit/posting.test.ts`

- [ ] Move `buildPostingLines` (`store.ts:142-188`) verbatim into `posting.ts`, export it, import it back into `MemoryLedgerStore` (zero behaviour change — assert via existing tests).
- [ ] **Test:** posting lines for `approve` (3 lines incl. VAT) vs `book-without-vat` (VAT line debit 0, `deductible: false`).

### Task 2.2: `applyReviewDecision`

**Files:** `packages/domain/src/supabase-store.ts`

- [ ] Load review + voucher (org-filtered). If `review.status !== "needs-review"` return the review unchanged (idempotent replay — mirrors `MemoryLedgerStore:485`).
- [ ] Update `ledger.review_tasks.status` + `ledger.vouchers.status`; append `provenance_timeline` entry.
- [ ] `appendEvent` `ReviewApproved`/`ReviewRejected`.
- [ ] If not reject and `review.suggestion`: `buildPostingLines` → insert one `projections.journal_entries` row per line (`numeric(18,2)`; map `bookedAt`→`booked_at`, set org/workspace) → `appendEvent` `PostedToLedger`.
- [ ] **Test:** approve → 3 journal rows inserted; double-approve → still 3 (idempotent).

### Task 2.3: `getReports`

- [ ] Select all `projections.journal_entries` org/workspace filtered → `mapJournalRowToLedgerLine[]` → `buildJournal`/`buildBalances`/`buildVat`.
- [ ] (Optional, deferred) upsert `projections.account_balances`/`vat_summary` for future SQL reporting — not required for beta.

### Task 2.4: SIE export sanity

- [ ] After a manual approve, confirm `GET /api/exports/sie` includes the posted lines.

### Task 2.5: Tests

**Files:** `tests/unit/supabase-projections.test.ts`, expand `tests/unit/supabase-store.test.ts`

- [ ] approve → `getReports().journal` non-empty; double approve → no duplicate lines.

### Phase 2 acceptance

- [ ] Manual normal-mode: create evidence → approve from Today → `/api/reports/journal` non-empty
- [ ] Demo regression green
- [ ] **Track B milestone:** demo↔normal parity for the ledger loop (sans blob bytes)

---

## Phase 3 — Organization settings (DB + API)

**Goal:** Company settings form persists in normal mode. **Effort:** 1 day. **Depends on:** Phase 0 (can run parallel to Phase 2).

### Task 3.1: Migration

```bash
supabase migration new organization_settings
```

```sql
create table ledger.organization_settings (
  organization_id text primary key,
  settings        jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      text not null
);
alter table ledger.organization_settings enable row level security;
-- Phase 7 will replace this with a JWT-claim policy; until then the API
-- service key bypasses RLS and filters in app code.
create policy org_isolation on ledger.organization_settings
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));
```

- [ ] Add a default `org_jpx` row to `seed.sql` (Phase 6).

### Task 3.2: Store methods

- [ ] `getCompanySettings` — select `settings` for `this.ctx.organizationId`, parse with `companySettingsSchema`, return `null` if absent (match `MemoryLedgerStore` contract).
- [ ] `saveCompanySettings` — upsert on `organization_id`; append `OrganizationSettingsUpdated` event (audit).
- [ ] **Test:** round-trip save→load; cross-org isolation.

### Task 3.3: Track A handoff

- [ ] Document: `GET/PUT /api/settings/company` work in normal mode; fiscal-year fields stay UI-only until Track A Phase 8.

### Phase 3 acceptance

- [ ] Company form save/load against local Supabase in normal mode
- [ ] Unit tests for settings round-trip

---

## Phase 4 — Web auth (Supabase Auth + API proxy)

**Goal:** Browser users log in; API receives a Bearer JWT; `app_metadata` tenant flows to the store factory. **Effort:** 2–3 days. **Depends on:** Phase 0.

### Task 4.1: Web Supabase clients (`@supabase/ssr`, current cookie API)

**Files:** `apps/web/lib/supabase/server.ts`, `apps/web/lib/supabase/client.ts`, web `package.json`

- [ ] `pnpm --filter @jpx-accounting/web add @supabase/ssr`.
- [ ] Browser client (`client.ts`): `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)`.
- [ ] Server client (`server.ts`): `createServerClient` with the **`getAll`/`setAll`** cookie adapter (the old `get/set/remove` API is removed in current `@supabase/ssr`):

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            /* called from a Server Component — middleware refreshes instead */
          }
        },
      },
    },
  );
}
```

### Task 4.2: Auth routes & middleware

**Files:** `apps/web/middleware.ts`, `apps/web/app/auth/login/page.tsx`, `apps/web/app/auth/callback/route.ts`

- [ ] Login page — Swedish labels, email + password (magic link optional later).
- [ ] Callback route — exchange the auth code for a session.
- [ ] `middleware.ts` — refresh the session and **use `getClaims()` (never `getSession()`)** to gate routes; redirect unauthenticated users to `/auth/login` when `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal`; exclude `/auth/*`, `/share`, static assets. Forward the `setAll` cache headers on the response. Demo mode → middleware is a no-op (no forced login; protects demo E2E).

### Task 4.3: API proxy Bearer injection

**Files:** `apps/web/app/api-proxy/[...path]/route.ts`

- [ ] Server-side: read the session via the server client; set `Authorization: Bearer <access_token>` on the proxied request (the proxy already forwards an `authorization` header — now populate it from the session rather than the incoming request).
- [ ] Normal mode + no session → return `401` JSON from the proxy without hitting the API.

### Task 4.4: Fix `createScopedClient`

**Files:** `packages/supabase-client/src/index.ts`

- [ ] `createScopedClient` currently passes the **service key** + a user Bearer header (`index.ts:24-31`) — RLS is bypassed, so the user token is meaningless. Change it to take the **publishable key** + user JWT so RLS actually applies (for the future direct-client read path).

### Task 4.5: Dev user bootstrap (`app_metadata`)

**Files:** `scripts/create-dev-user.mjs`, `.env.example`

- [ ] Script using the **secret key** Admin API to create a dev user with tenant claims in **`app_metadata`** (admin-only — this is the safe field):

```js
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
await admin.auth.admin.createUser({
  email: "johan@jpx.nu",
  password: process.env.DEV_USER_PASSWORD,
  email_confirm: true,
  app_metadata: { organization_id: "org_jpx", workspace_id: "workspace_main", role: "Admin" },
});
```

- [ ] Document in `.env.example`: tenant claims live in `app_metadata`; for production, set them via a `custom_access_token` auth hook or the Admin API on invite — never client-side.

### Phase 4 acceptance

- [ ] Normal mode: login → Today loads workspace from Supabase
- [ ] Demo mode: no login required; demo E2E unchanged
- [ ] API returns 401 without a Bearer in normal mode
- [ ] Regression: a user editing `user_metadata` cannot change their effective org (C2 guard from Task 0.3 still green)

---

## Phase 5 — Azure Blob evidence upload (user-delegation SAS)

**Goal:** Evidence rows point at real Azure blobs (swedencentral); `POST /api/uploads/init` returns a short-lived SAS the client PUTs to. **No account keys / connection strings** — managed identity. **Effort:** 2–3 days. **Depends on:** Phases 0–1. Coordinate with Track A Phase 5 on the API shape.

### Task 5.1: API config & SDK

**Files:** `services/api/package.json`, `services/api/src/config.ts`, `.env.example`

- [ ] `pnpm --filter @jpx-accounting/api add @azure/storage-blob @azure/identity`.
- [ ] `config.ts`: read `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER` (default `evidence`). Credential = `new DefaultAzureCredential()` (App Service managed identity in prod; `az login` / env creds locally). No secret in env.

### Task 5.2: `POST /api/uploads/init` — user-delegation SAS

**Files:** `services/api/src/blob-upload.ts`, `services/api/src/app.ts`

- [ ] Validate `uploadInitSchema`; mint a **user-delegation SAS** (signed with a key Azure issues to the managed identity — no account key on the box):

```ts
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobServiceClient, ContainerSASPermissions,
  generateBlobSASQueryParameters, SASProtocol, UserDelegationKeyCredential,
} from "@azure/storage-blob";

const account = config.storage.account;
const svc = new BlobServiceClient(
  `https://${account}.blob.core.windows.net`,
  new DefaultAzureCredential(),
);

const now = new Date();
const expiresOn = new Date(now.getTime() + 15 * 60_000);
const udk = await svc.getUserDelegationKey(now, expiresOn);

const blobPath = `${organizationId}/${evidenceId}/${filename}`;
const sas = generateBlobSASQueryParameters(
  {
    containerName: config.storage.container,
    blobName: blobPath,
    permissions: ContainerSASPermissions.parse("cw"), // create + write only
    startsOn: now,
    expiresOn,
    protocol: SASProtocol.Https,
  },
  new UserDelegationKeyCredential(account, udk),
).toString();

return c.json({
  uploadId: evidenceId,
  uploadUrl: `https://${account}.blob.core.windows.net/${config.storage.container}/${blobPath}?${sas}`,
  blobPath,
  expiresInSeconds: 900,
});
```

> Lock the response shape with Track A before either side lands ([risk register](#risk-register)).

### Task 5.3: Wire `createEvidence`

- [ ] Two-step: client calls `/api/uploads/init` → PUTs bytes to `uploadUrl` (header `x-ms-blob-type: BlockBlob`) → calls `POST /api/evidence` with `blobPath`. Server stores `blob_path` from init; never trusts a client-supplied absolute URL.

### Task 5.4: Bicep / deploy

**Files:** `infra/azure/main.bicep`, `.github/workflows/deploy.yml`

- [ ] Give the API App Service a system-assigned managed identity; assign it the **Storage Blob Data Contributor** role on the storage account (role assignment in Bicep). No connection-string app setting.

### Phase 5 acceptance

- [ ] Upload file → create evidence → `blob_path` resolvable in the Azure portal; SAS expires after 15 min
- [ ] No storage account key or connection string anywhere in env/app settings
- [ ] Demo mode: endpoint may return a stub or the same implementation

---

## Phase 6 — Seed data, integration tests & normal-mode E2E

**Goal:** Repeatable bootstrap + CI signal for Track B. **Effort:** 2 days. **Depends on:** Phases 0–2 (min), 3–4 for full auth E2E.

### Task 6.1: Seed script

**Files:** `supabase/seed.sql`

> `config.toml` **already** wires `[db.seed] sql_paths = ["./seed.sql"]` with `enabled = true` (C7). You only need to create the file; `supabase db reset` will pick it up automatically.

- [ ] Seed for `org_jpx` / `workspace_main`: 1–2 vouchers + review tasks + journal lines using the same BAS accounts as `MemoryLedgerStore.initialLedgerLines` (6540/2641/1930) so demo↔normal screenshots match.
- [ ] Default `ledger.organization_settings` row for `org_jpx` (Phase 3).

### Task 6.2: Integration test (local Supabase)

**Files:** `tests/integration/supabase-ledger.test.ts`, root `package.json`

- [ ] `pnpm test:integration` runs only when `SUPABASE_URL` is set (skip cleanly in CI without the service).
- [ ] Flow: createEvidence → getReviewFeed → applyReviewDecision(approve) → `getReports().journal.length > 0`; assert hash chain has no duplicate `previous_hash` (Task 0.5 guard at integration level).

### Task 6.3: Playwright normal-mode project

**Files:** `playwright.config.ts`, `tests/e2e/normal-mode.spec.ts`

- [ ] Second `webServer`/env profile: API `normal` + local Supabase (optional CI job, documented). Minimal spec: `/health`, workspace JSON has reviews after seed.

### Task 6.4: Hosted Supabase checklist

- [ ] Create project **eu-north-1**; `supabase link` then `supabase db push`.
- [ ] Dashboard → **Migrate JWT secret** to asymmetric signing keys, then rotate (Task 0.3 prod equivalent).
- [ ] Dashboard → API settings → confirm `ledger`, `projections` in **Exposed schemas** (Task 0.0 prod equivalent).
- [ ] Set GitHub secrets: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
- [ ] Smoke-test Azure-deployed API against hosted Supabase.

### Phase 6 acceptance

- [ ] `supabase db reset` → seed → normal API manual flow works
- [ ] Integration test passes locally
- [ ] DEV_STATUS.md Track B table → Phases 0–6 Done

---

## Phase 7 — Hardening (post-beta)

**Goal:** Production hygiene without blocking beta. Pick items as time allows. **Effort:** 2–4 days (optional slices).

### Task 7.1: JWT-claim RLS (replace the `current_setting` GUC)

> The original `schema_v2.sql` policies use `current_setting('app.organization_id', true)`, which requires a transaction-scoped `SET LOCAL`. PostgREST connection pooling makes session GUCs unsafe/leaky. Use JWT claims instead — no per-request SQL setup.

**Files:** `supabase/migrations/<ts>_rls_jwt_claims.sql`

- [ ] Replace each `org_isolation` policy with:

```sql
using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'))
```

- [ ] Document that the API service-key path still bypasses RLS and relies on the app-level org filters (defence in depth, not the primary control, until a scoped-client path exists).

### Task 7.2: Assistant & compliance persistence

- [ ] `answerAssistantQuestion` → insert `ledger.assistant_sessions`. Compliance refresh → `ledger.compliance_alerts`.

### Task 7.3: Simulations

- [ ] `runSimulation` — read-only projection diff; no ledger mutation.

### Task 7.4: supa_audit

- [ ] Enable the extension in the dashboard; uncomment the tracking block in `schema_v2.sql` for vouchers/reviews/alerts/assistant_sessions.

### Task 7.5: Projection rebuild job (optional)

- [ ] Admin script: replay `ledger.events` → rebuild `projections.journal_entries` (recovery path; proves events remain the true source).

### Task 7.6: Azure Postgres migration prep (docs only)

- [ ] `docs/architecture.md` note: keep SQL portable; migrate connection + auth to Entra later; no code this phase.

---

## End-to-end acceptance (Track B complete)

| Flow | Demo (`MemoryLedgerStore`) | Normal (`SupabaseLedgerStore`) |
|------|---------------------------|--------------------------------|
| Open Today | Seeded reviews | Seed or created reviews |
| Create evidence | Works | Works + persisted (awaited, fail-loud) |
| Approve review | Posts lines | Posts lines + `projections.journal_entries` |
| Books / Reports | Shows journal/VAT | Same APIs, Supabase-backed |
| SIE export | Non-empty | Non-empty after approvals |
| Company settings | In-memory | Postgres `organization_settings` |
| Login | Not required | Supabase Auth, `app_metadata` tenant |
| Token check | n/a | Local `getClaims()` (no Auth round-trip) |
| File bytes | Not stored | Azure Blob via user-delegation SAS |
| Hash chain under load | n/a | No forked `previous_hash` |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Custom schema not reachable (was silently failing) | **Task 0.0** (config + grants + `.schema()`) is blocking, with a smoke test |
| Cross-tenant access via editable `user_metadata` | `app_metadata` only; Task 0.3 regression test |
| Forked legal hash chain on concurrent writes | Task 0.5 unique index + retry; integration assertion |
| Silent write failures (fire-and-forget) | Task 0.4 await + throw |
| `getClaims` falls back to a round-trip if signing keys not migrated | Task 0.3 / 6.4 migrate to asymmetric keys locally and hosted |
| Service key bypasses RLS → one missing `.eq` leaks a tenant | [Org-filter checklist](#mandatory-org-filter-checklist) per query + isolation unit tests |
| Track A + B both edit `uploads/init` | Agree response shape in Phase 5 kickoff |
| Demo regression | Demo E2E gate on every PR; "never break demo" prime directive |

---

## Timeline estimate (single developer, sequential)

| Phase | Days | Cumulative |
|-------|------|------------|
| 0 | 2–3 | 3 |
| 1 | 2–3 | 6 |
| 2 | 3–4 | 10 |
| 3 | 1 | 11 |
| 4 | 2–3 | 14 |
| 5 | 2–3 | 17 |
| 6 | 2 | 19 |
| 7 | optional | — |

With **Track A in parallel**, ≈ 3–4 weeks wall-clock with one backend + one frontend contributor.

---

## Open questions

- **ORM:** `project_dev_tooling_upgrades` memory lists Drizzle as planned. This plan deliberately stays on raw `supabase-js` to avoid coupling the backend track to an ORM migration. Decide before Phase 7 whether the projection-rebuild job is the first Drizzle surface. **Not a blocker for beta.**
- **`closeRun`:** kept as a static checklist (mirrors `MemoryLedgerStore`) until a real period-close model exists — confirm with product before Phase 7.

---

## Verified references (checked May 2026)

- Supabase — custom schemas (`config.toml [api] schemas`, GRANTs, `.schema()`): `supabase.com/docs/guides/api/using-custom-schemas`
- Supabase — Next.js SSR (`@supabase/ssr`, `getAll`/`setAll`, "never `getSession()` in server code, use `getClaims()`"): `supabase.com/docs/guides/auth/server-side/nextjs`
- Supabase — JWT signing keys (asymmetric, local verification, `supabase gen signing-key`): `supabase.com/docs/guides/auth/signing-keys`
- Supabase — API keys (`sb_publishable_…` / `sb_secret_…`, legacy `anon`/`service_role` deprecated): `supabase.com/docs/guides/api/api-keys`
- Supabase security checklist — `user_metadata` is user-editable, use `app_metadata`; views bypass RLS; UPDATE needs SELECT policy (from the `supabase` skill, product-security index)
- Azure — `@azure/storage-blob` user-delegation SAS via `getUserDelegationKey` + `UserDelegationKeyCredential` + `DefaultAzureCredential` (Azure SDK for JS docs, Context7 `/azure/azure-sdk-for-js`)
- Codebase grounding: `packages/domain/src/{store,supabase-store,hash-chain,ids,index}.ts`, `services/api/src/{runtime,middleware/auth}.ts`, `packages/supabase-client/src/index.ts`, `apps/web/app/api-proxy/[...path]/route.ts`, `supabase/{config.toml,migrations/20260324000000_schema_v2.sql}`

---

## Self-review

- Every previous-revision claim cross-checked against the live codebase and current docs; corrections logged in the [changelog](#️-corrections-applied-vs-the-previous-revision-read-this-first).
- Blocking schema-exposure bug promoted from a footnote to gated Task 0.0; security `user_metadata`→`app_metadata` fix carries a regression test.
- Preserves demo mode, event-sourced + append-only constraints, and the demo↔normal parity goal.
- Defers Azure Postgres migration and ORM explicitly; phases independently shippable with acceptance criteria.
- No placeholders: each code step shows real, repo-accurate code; verification commands included.
