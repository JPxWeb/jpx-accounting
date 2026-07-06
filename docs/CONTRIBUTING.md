# Contributing / architecture notes

JPX Accounting is a **pnpm workspace** targeting **Node 24** (`.node-version`; match CI and `engines.node`).

## Repo map

| Path                                                           | Responsibility                                                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                                     | Next.js 16 App Router PWA (`pnpm dev` / `pnpm dev:web`; default dev port **3002** via `apps/web/package.json`).                         |
| `services/api`                                                 | Hono HTTP API (default dev port **3001** via `PORT` / `.env`). Routes, blob SAS minting, runtime wiring, rate limiter, JWKS auth.       |
| `packages/contracts`                                           | Shared Zod v4 schemas and exported types — **single source** for HTTP bodies and client parsing. Includes `uploadInitResultSchema`.     |
| `packages/domain`                                              | Async `LedgerStore` interface, `MemoryLedgerStore`, hash-chain helper, projections (no Express/Next coupling).                          |
| `packages/persistence-postgres`                                | `PostgresLedgerStore` against Supabase (`postgres-js`). Used in normal mode when `SUPABASE_DB_URL` is set; otherwise fail-closed.       |
| `packages/document-intelligence`                               | Adapter for `@azure-rest/ai-document-intelligence` with model picker (`prebuilt-invoice` default, `prebuilt-receipt` for receipts).     |
| `packages/api-client`                                          | Thin `fetch` client; validates JSON **when `baseUrl` is set** with the same schemas as `contracts`. Includes `initUpload`/`uploadBlob`. |
| `packages/ai-core`, `packages/reporting`, `packages/ui-tokens` | AI boundary (chat + embeddings), summaries, tokens.                                                                                     |

## Trust boundaries

```text
Browser  →  Next (same-origin)  →  /api-proxy  →  Hono API  →  Zod parse (body) → LedgerStore
```

The **web bundle** reads `NEXT_PUBLIC_*` runtime mode; server-side routes use [`apps/web/lib/server-runtime-config.ts`](../apps/web/lib/server-runtime-config.ts) for `ACCOUNTING_API_BASE_URL` and [`apps/web/app/api-proxy/[...path]/route.ts`](../apps/web/app/api-proxy/[...path]/route.ts) for forwarding.

Implementation changes that touch frameworks or toolchain should cross-check against **Current Next.js/pnpm/typescript-eslint docs** (e.g. Context7 `/vercel/next.js` pinned to the repo Next version).

## Runtime modes (`demo` vs `normal`)

- **`demo`**: `MemoryLedgerStore`, `LocalAiRuntime`, `StubBlobUploader`, `StubDocumentIntelligenceClient`. **Open API CORS** for convenience. Embeddings produce deterministic mock vectors so indexing tests stay reproducible offline.
- **`normal`**: real storage/AI prerequisites are required; ledger calls fail closed when not configured. The API picks `PostgresLedgerStore` only when `SUPABASE_DB_URL` is set, otherwise `UnavailableLedgerStore` makes `/ready.checks.ledger=false` and `/api/*` reads return `503` with the structured error shape. **`ACCOUNTING_CORS_ORIGINS`** (comma-separated) controls which browser origins may call `/api/*` directly; same-origin `/api-proxy` traffic from Next does not rely on browser CORS to the API.

### Env matrix (normal mode)

| Concern                     | Env var(s)                                                                                        | Required for                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Postgres write path         | `SUPABASE_DB_URL` (+ optional `SUPABASE_POOLER_TRANSACTION_MODE=true` for port 6543)              | `PostgresLedgerStore`; `/ready.checks.ledger=true`         |
| Azure Blob signed upload    | `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`                                                | `AzureBlobUploader` instead of stub                        |
| Azure OpenAI (chat + embed) | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`                             | `ResponsesAiRuntime` instead of `Unavailable…`             |
| Document Intelligence       | `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`                     | `AzureDocumentIntelligenceClient` instead of stub          |
| JWT auth on mutating routes | `SUPABASE_JWKS_URL` (typically `${SUPABASE_URL}/auth/v1/keys`)                                    | `hono/jwk` middleware on POST/PUT/PATCH/DELETE             |
| Advisor tool-approval HMAC  | `ADVISOR_TOOL_APPROVAL_SECRET` (must not be the demo default in `normal`)                         | AI SDK `experimental_toolApprovalSecret` signing           |
| Browser CORS (direct API)   | `ACCOUNTING_CORS_ORIGINS` (comma-separated; Bicep defaults to the deployed web origin when unset) | Browser calls to `/api/*` outside same-origin `/api-proxy` |

When deploying to Azure, [`infra/azure/main.bicep`](../infra/azure/main.bicep) wires the API App Service `appSettings` above (including `ADVISOR_TOOL_APPROVAL_SECRET`, `SUPABASE_JWKS_URL`, `ACCOUNTING_CORS_ORIGINS`, `SUPABASE_POOLER_TRANSACTION_MODE`), configures storage blob CORS for the live web origin (`storageCorsAllowedOrigins` param — defaults to the deployed web App Service origin plus localhost dev ports), and grants the Managed Identity the two RBAC roles needed for User-Delegation SAS minting (`Storage Blob Delegator`, `Storage Blob Data Contributor`). The Bicep template **asserts** that `runtimeMode=normal` cannot deploy with the demo HMAC secret.

## Build trivia

| Command                                        | Meaning                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm build` (API package)                     | `tsc --noEmit` for `services/api` — typecheck only.                                                              |
| Deploy workflow `.github/workflows/deploy.yml` | Bundles API with **esbuild** for Azure zip deploy (`server.cjs`, CommonJS — `@azure/identity` breaks under ESM). |

Keeping those aligned avoids drift between “does it typecheck locally?” vs “does the bundle compile?”.

## HTTP API probes and errors

Use these outside the ledger routes when wiring load balancers or deploy smoke tests:

| Route         | Purpose                                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health` | **Liveness** — process accepts HTTP; `{ ok: true, runtimeMode }`.                                                                                                                                  |
| `GET /ready`  | **Readiness** — `{ ready, runtimeMode, checks: { ledger, ai } }`. In **`normal`** without persistence/Azure, expect `ready: false` while `health` still returns 200 (stub store / unavailable AI). |

JSON error bodies (4xx/5xx) include **`error`**, **`runtimeMode`**, and **`requestId`** (also echoed as **`x-request-id`** when the request-scoped middleware runs). Invalid Zod payloads return **`400`** with **`code: "validation_error"`** and an **`issues`** array (`path`, `message`). Oversized bodies on bounded routes return **`413`**. Mutating routes that exceed the rate limit return **`429`** with the `draft-7` standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).

Baseline **`secureHeaders`** and **`bodyLimit`** are configured in [`services/api/src/app.ts`](../services/api/src/app.ts), alongside the `hono-rate-limiter` and the optional `hono/jwk` middleware (gated on `SUPABASE_JWKS_URL`).

## Database schema and migrations

Migrations live in [`infra/supabase/migrations`](../infra/supabase/migrations) and are applied in numeric order:

| File                               | Adds                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `0001_init.sql`                    | Schemas `ledger` + `projections`, all entity tables, hash-chain columns, vat/balance projection tables.                        |
| `0002_schema_alignment.sql`        | `ledger.evidence_objects.modalities text[]` and `ledger.review_tasks.title text` (closes gaps vs. domain types).               |
| `0003_pgvector.sql`                | `vector` extension, `knowledge.documents` with `halfvec(1536)` + HNSW index using `halfvec_cosine_ops`.                        |
| `0004_compliance_and_settings.sql` | `ledger.compliance_alerts`, `ledger.assistant_sessions`, `ledger.organization_settings` (compliance watch + company settings). |

Local development against a real DB:

```bash
supabase start
psql "$SUPABASE_DB_URL" -f infra/supabase/migrations/0001_init.sql
psql "$SUPABASE_DB_URL" -f infra/supabase/migrations/0002_schema_alignment.sql
psql "$SUPABASE_DB_URL" -f infra/supabase/migrations/0003_pgvector.sql
psql "$SUPABASE_DB_URL" -f infra/supabase/migrations/0004_compliance_and_settings.sql
export SUPABASE_DB_URL=...    # exported for the API + integration tests
pnpm test:integration         # skips silently when SUPABASE_DB_URL is unset
```

`tests/integration/postgres-ledger.test.ts` exercises evidence-create, hash-chain integrity, review approval, and replay idempotency against the live DB. CI keeps it optional / nightly to avoid PR flake.

## Knowledge retrieval (RAG)

`POST /api/knowledge/query` answers in one of two modes (the response's `mode` field reports which one actually ran):

- **keyword** — BM25-lite over the bundled sourced corpus (`packages/advisor`). Always available and the only mode in `demo`.
- **vector** — pgvector cosine search over `knowledge.documents` (migration `0003_pgvector.sql`). Active only in `normal` mode when **both** `SUPABASE_DB_URL` and Azure OpenAI (`AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`) are configured. **Any** vector failure — embedding call, DB query, or an empty index — falls back to keyword with a structured `console.warn` (`component: "api.knowledge"`); retrieval never 500s the advisor.

Populate the vector index with the ingestion script (idempotent upserts keyed on chunk id — re-running refreshes content + embeddings in place):

```bash
export SUPABASE_DB_URL=...        # migrations 0001–0004 applied
export AZURE_OPENAI_ENDPOINT=...  # embeddings use text-embedding-3-small (1536 dims = halfvec(1536))
export AZURE_OPENAI_API_KEY=...
pnpm ingest:knowledge
```

Rows land scoped to the fixed normal-mode workspace (`org_jpx` / `workspace_main`, mirroring `services/api/src/runtime.ts`). `tests/integration/knowledge-query.test.ts` covers the upsert + nearest-neighbour loop with fixture embeddings and skips silently without `SUPABASE_DB_URL`.

## Production web (`standalone`)

[`apps/web`](../apps/web) builds with **`output: "standalone"`** for Docker/Azure. Prefer running the traced server from `.next/standalone` per Next.js standalone docs (`node server.js`), not **`next start`**, which logs a mismatch with `standalone`.

### Docker image tags (demo vs production)

The [`apps/web/Dockerfile`](../apps/web/Dockerfile) accepts build-args **`NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`** (default **`normal`**) and **`NEXT_PUBLIC_API_BASE_URL`** (default **`/api-proxy`**, the same-origin proxy path — `NEXT_PUBLIC_*` values inline at build time, so runtime app settings alone cannot change the client bundle). The deploy workflow passes `normal` for CI-gated production pushes and honors `workflow_dispatch` `runtimeMode` for demo stacks.

| Image tag / build                                            | `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE` | When to use                                                           |
| ------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------- |
| `ghcr.io/jpxweb/jpx-accounting-web:latest` (deploy workflow) | `normal` (default)                    | Azure App Service production                                          |
| Local / demo-only build                                      | `demo`                                | `docker build --build-arg NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=demo …` |

The web container also receives runtime env from Bicep (`ACCOUNTING_RUNTIME_MODE`, `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`) at deploy time; the build-arg must match so the client bundle is not demo-inlined in production images.

## Local development: ports and a single dev stack

`pnpm dev` launches **both** the Next app and the API in parallel. Run **only one** such stack at a time. If startup fails with **`EADDRINUSE`** on **3001** (API, via `PORT`) or **3002** (web, from `apps/web/package.json`), terminate the old process or choose different ports.

## API body limits and Bun

[`services/api/src/app.ts`](../services/api/src/app.ts) applies Hono `bodyLimit` (default JSON routes plus a higher cap for `POST /api/imports/sie`). If you host the API on **Bun**, set the runtime’s own maximum request body size (for example Bun’s `maxRequestBodySize`) **at least** as high as those route caps; otherwise the platform may reject large bodies before middleware runs. **`@hono/node-server` on Node** only needs the middleware configuration.

## Tooling & policy

### pnpm dependency builds

pnpm v10 restricts dependency **postinstall/build scripts**. We allow **`esbuild`** and **`sharp`** in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) (`onlyBuiltDependencies`) so reproducible installs do not silently skip binaries Next relies on — see [pnpm approve-builds](https://pnpm.io/cli/approve-builds).

### ESLint / Prettier

Root [`eslint.config.mjs`](../eslint.config.mjs): Next **flat** presets for `apps/web` only + `typescript-eslint` recommended for `services/`, `packages/`, `tests/`. ESLint merges with Prettier via `eslint-config-prettier`.

### Typed routes (`next-env.d.ts`)

[`apps/web/next-env.d.ts`](../apps/web/next-env.d.ts) references `.next/dev/types/routes.d.ts`. Run **`pnpm dev --filter @jpx-accounting/web`** or **`pnpm --filter @jpx-accounting/web exec next typegen`** when that file should exist locally.

## Quick commands

See root [README.md](../README.md) and [CLAUDE.md](../CLAUDE.md).

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:integration   # Postgres integration tests; auto-skip without SUPABASE_DB_URL
pnpm check              # lint + format:check + typecheck + unit tests + build
```
