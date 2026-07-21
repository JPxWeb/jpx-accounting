# Architecture Overview

_Last verified against code: 2026-07-19._

## Runtime shape

- `apps/web` is the mobile-first PWA shell.
- `services/api` is the typed Hono application layer; routes in [`src/app.ts`](../services/api/src/app.ts), runtime wiring in [`src/runtime.ts`](../services/api/src/runtime.ts), Azure Blob SAS minting in [`src/blob.ts`](../services/api/src/blob.ts).
- `packages/domain` owns append-only bookkeeping behavior, rules, projections, and the **async** `LedgerStore` abstraction with the in-memory reference impl (`MemoryLedgerStore`).
- `packages/persistence-postgres` implements `LedgerStore` against Supabase Postgres using `postgres-js`. Each mutation runs in `sql.begin(...)` and takes `pg_advisory_xact_lock` on the workspace key **before** reading the chain tail, so appenders serialize per workspace; migration `0006` adds a `seq` identity column (the final ORDER BY tiebreak on every events read) and a `UNIQUE (organization_id, workspace_id, previous_hash)` constraint so any residual fork attempt fails as a retryable `23505` instead of committing.
- `packages/document-intelligence` wraps `@azure-rest/ai-document-intelligence` (REST client, GA `2024-11-30`). `pickModelForDocument` defaults to `prebuilt-invoice` (Swedish _fakturer_) and falls back to `prebuilt-receipt` for till receipts. All requests use `getLongRunningPoller` so the contract scales with throughput.
- `packages/contracts` owns API shapes and shared view models (Zod v4 — single source of truth).
- `packages/ai-core` hides provider-specific AI wiring behind a Responses-first abstraction. Exposes `embed()` for retrieval (default `text-embedding-3-small`, 1536 dims).

## Design constraints

- **Append-only events** are the source of truth. The hash chain (`previous_hash → event_hash`) is global per workspace; mutating handlers serialize through a transaction-scoped advisory lock taken before the tail read (the old tail-row `SELECT … FOR UPDATE` let a blocked waiter resume on a stale snapshot and fork the chain), backed by the `0006` fork constraint. Event hashes are SHA-256 over canonical JSON (`sha256_` + 64 hex); chains created before the cutover keep their legacy djb2 links (`h_` + 8 hex) as a valid older prefix.
- **Evidence is immutable** and stored separately from derived artifacts (Azure Blob `evidence` container).
- **AI explains and suggests, but cannot silently mutate accounting state** — Document Intelligence extractions and Azure OpenAI suggestions both flow through the review queue.
- **Projections drive the UI and reports.** The Postgres store currently re-derives reports per request from `PostedToLedger` events (strategy B); incremental writes to `projections.*` are a follow-up if read latency demands.
- **Swedish-first infrastructure** for accounting and retention posture.
- **Runtime mode is explicit:**
  - `demo` intentionally uses scaffold fallbacks: `MemoryLedgerStore`, `LocalAiRuntime`, `StubBlobUploader`, `StubDocumentIntelligenceClient`.
  - `normal` does not substitute demo data when store, AI, or storage configuration is missing — it returns 503 via `UnavailableLedgerStore` / `UnavailableAiRuntime` and `/ready.checks` reflects the gap.

## Persistence and the migration path

The current scaffold has two production-ready `LedgerStore` implementations behind the same async interface:

- `MemoryLedgerStore` — used in `demo` mode and as the demo fallback in `packages/api-client`.
- `PostgresLedgerStore` — used in `normal` mode when `SUPABASE_DB_URL` is set. Wraps `postgres-js` and writes to the schema in [`infra/supabase/migrations/0001_init.sql`](../infra/supabase/migrations/0001_init.sql) plus the alignment patch in [`0002_schema_alignment.sql`](../infra/supabase/migrations/0002_schema_alignment.sql).

The hash-chain helper (`buildEventHash` in `packages/domain/src/hash-chain.ts`) is shared between stores; `PostgresLedgerStore` reuses the helper rather than forking it. Hashes are SHA-256 over `canonicalJson({ payload, previousHash })` — canonicalization is byte-stable across the Postgres jsonb round trip, so `GET /api/integrity` (`packages/domain/src/integrity.ts`) verifies linkage for every event **and recomputes payload hashes** for SHA-256 events; legacy djb2 events (pre-cutover appends, `h_` + 8 hex) stay linkage-only and are reported as `legacyEventCount`. A djb2-format hash appearing after any SHA-256 hash breaks the chain. Future immutable-storage migrations should continue to land behind `LedgerStore`, not by rewriting product logic.

### Why `postgres-js` instead of `@supabase/supabase-js` for the write path

PostgREST cannot run multi-statement transactions outside `rpc()`. Event + projection updates that must commit atomically therefore use `postgres-js` (or `pg`) directly — Supabase explicitly endorses this for server-side code. `@supabase/supabase-js` is reserved for auth/admin helpers if/when needed.

When connecting through Supavisor, prefer **session mode (port 5432)** over **transaction mode (port 6543)**. Transaction mode does not support named prepared statements; if it must be used, set `SUPABASE_POOLER_TRANSACTION_MODE=true` so `postgres-js` runs with `prepare:false`.

## Evidence upload (Azure Blob)

[`/api/uploads/init`](../services/api/src/app.ts) mints short-lived **User-Delegation SAS** URLs via the API's Managed Identity. Account-key SAS is intentionally not used.

```text
Client → POST /api/uploads/init
                    ↓
                  API ── DefaultAzureCredential ──→ getUserDelegationKey()
                    ↓                                       ↓
            generateBlobSASQueryParameters()         (cached ~50 min)
                    ↓
       { uploadUrl, requiredContentType, requiredBlobType, expiresInSeconds }
                    ↓
Client → PUT uploadUrl   (x-ms-blob-type: BlockBlob)   → Azure Blob
                    ↓
Client → POST /api/evidence    (registers the blob path with the LedgerStore)
```

[`infra/azure/main.bicep`](../infra/azure/main.bicep) provisions both required role assignments on the API's system-assigned identity:

- **Storage Blob Delegator** (storage-account scope) — required to call `getUserDelegationKey`. Without it, SAS minting returns 403.
- **Storage Blob Data Contributor** (evidence-container scope) — required for the actual PUT.

The storage account also carries a CORS rule allowing `PUT, OPTIONS, GET` from `storageCorsAllowedOrigins`.

## Extraction (Document Intelligence)

`packages/document-intelligence` wraps `@azure-rest/ai-document-intelligence`. The adapter is constructed in `createApiRuntimeDependencies`; when `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` + `_API_KEY` are absent, a stub is wired so demo flows continue to render canned fields.

`/api/evidence/:id/extract` calls the adapter when the evidence's `blobPath` looks real (starts with `evidence-uploads/`); the result is persisted via `LedgerStore.updateEvidenceExtraction` (`packages/domain/src/store.ts`), which appends an `ExtractionRefreshed` event to the hash chain and regenerates the suggestion — append-only, with a decided-voucher guard. The trust boundary is unchanged: extractions only feed suggestions, and the review queue remains the only path to a posted voucher.

## Retrieval (pgvector)

[`infra/supabase/migrations/0003_pgvector.sql`](../infra/supabase/migrations/0003_pgvector.sql) installs `pgvector` and creates `knowledge.documents` with a `halfvec(1536)` embedding column and an HNSW index using `halfvec_cosine_ops`. Inserts/queries use the same `postgres-js` client as the ledger store; the Python `vecs` library is irrelevant here. `AiRuntime.embed()` produces vectors via Azure OpenAI in normal mode and deterministic mock vectors in demo so indexing tests stay deterministic offline. Retrieval is live: `POST /api/knowledge/query` (`services/api/src/knowledge.ts`) serves keyword search always and pgvector cosine search in normal mode with a keyword fallback that never 500s; ingestion runs via `pnpm ingest:knowledge` (`upsertKnowledgeDocuments` in `packages/persistence-postgres/src/knowledge.ts`).

## API and edge behavior

- Browser traffic is usually **same-origin** to Next, then [`apps/web/app/api-proxy/[...path]/route.ts`](../apps/web/app/api-proxy/[...path]/route.ts) forwards to the Hono API (see the trust diagram in [CONTRIBUTING.md](CONTRIBUTING.md)).
- **`demo`** uses permissive CORS on `/api/*`; **`normal`** restricts direct browser origins via **`ACCOUNTING_CORS_ORIGINS`**.
- The API sets **`x-request-id`**, structured validation errors, bounded request bodies, and default security headers; the Next app applies baseline **`headers()`** (CSP differs in dev vs prod; `/sw.js` uses `no-store`).
- **Auth**: when `SUPABASE_JWKS_URL` is set — **required in `normal` mode**, where the API fails closed at boot without it; optional in `demo` — `hono/jwk` verifies a JWT on **all `/api/*` routes and methods**, with `GET /api/runtime-info` as the sole public exemption (the AI-transparency panel). Accepted algorithms default to `RS256` + `ES256`, overridable via comma-separated `SUPABASE_JWT_ALGS` (see `services/api/src/config.ts`). Actor attribution is derived server-side from the verified token subject (`user:<sub>`; demo sentinel with auth off) — request bodies carry no `actorId`. The web side signs in at `/login` (Supabase Auth, enabled by the `NEXT_PUBLIC_SUPABASE_*` build-time pair) and threads `Authorization: Bearer` through the api-proxy; sign-out clears every registered client-side store (`apps/web/lib/local-data.ts`).
- **Mutating routes** (`POST/PUT/PATCH/DELETE` on `/api/*`) are rate-limited via `hono-rate-limiter` (60 requests/minute), keyed by the verified JWT subject when auth is on and by client address otherwise.
- **JSON 4xx/5xx** carry `error`, `runtimeMode`, `requestId`. Validation 400s add `code: "validation_error"` + `issues[]`. Rate-limit 429s carry the `draft-7` standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
