# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Prefer **official docs**: use Context7 (e.g. `/vercel/next.js` pinned to the repo Next version) or vendor docs before relying on recalled API details — especially ESLint flat config, pnpm lifecycle policy, Playwright wiring, Azure deploy.

## Build & Dev Commands

```bash
pnpm install                  # Install all workspace dependencies (esbuild/sharp builds allowlisted — see pnpm-workspace.yaml)
pnpm dev                     # Parallel: Next + API
pnpm dev:web                  # Start Next.js dev server (http://localhost:3002 — see apps/web/package.json)
pnpm dev:api                  # Start Hono API with tsx watch (default http://localhost:3001)
pnpm lint                     # ESLint (root eslint.config.mjs)
pnpm lint:fix
pnpm format                   # Prettier write
pnpm format:check             # Prettier CI check
pnpm typecheck                # TypeScript check across all 10 workspace packages
pnpm typecheck:tests          # Typecheck the tests/ directory (separate tsconfig — added in PR-B)
pnpm build                    # Build web + API (`services/api` is typecheck-only; deploy bundles API with esbuild)
pnpm check                    # lint + format:check + typecheck + typecheck:tests + unit tests + build

# Testing
pnpm test:unit                # Unit tests: tsx --test 'tests/unit/**/*.test.ts'
pnpm test:integration          # Postgres integration tests (skip silently when SUPABASE_DB_URL is unset)
pnpm test:e2e                 # Playwright E2E (builds first, starts both servers)
pnpm test:e2e:headed          # E2E with visible browser
pnpm test:e2e:install          # Install Chromium for Playwright

# Run a single E2E test
pnpm build && npx playwright test tests/e2e/home.spec.ts

# Run a single unit test
tsx --test tests/unit/some-file.test.ts

# Run a single integration test (still gated on SUPABASE_DB_URL)
tsx --test tests/integration/postgres-ledger.test.ts

# Run integration tests against a local Supabase
# (run `supabase start`, apply migrations 0001-0004, then export SUPABASE_DB_URL)
pnpm test:integration
```

## Architecture

pnpm monorepo (Node >=24, pnpm 10.29.2) — mobile-first Swedish accounting PWA with AI assistance.

### Workspace layout

- **apps/web** — Next.js 16 PWA (React 19, TailwindCSS 4, React Query 5, Motion 12, shadcn/ui via `@base-ui/react`, Sonner toaster, react-hook-form, nuqs, @tanstack/react-table). Swedish locale throughout. `@/*` path alias resolves to `apps/web/*` (see `apps/web/tsconfig.json` and `components.json`).
- **services/api** — Hono HTTP server (port 3001). Routes in `src/app.ts`, dependency injection in `src/runtime.ts`, blob SAS minting in `src/blob.ts`. `GET /health` = liveness; `GET /ready` = readiness (`ledger` + `ai` checks). JSON errors carry `requestId`; `400`s use `code: "validation_error"` + `issues[]`. Mutating routes go through `hono-rate-limiter` and (when `SUPABASE_JWKS_URL` is set) `hono/jwk`.
- **packages/contracts** — Zod v4 schemas: the single source of truth for all API shapes and domain types.
- **packages/domain** — Core accounting logic: `LedgerStore` interface (**async**), append-only event sourcing with hash chain, BAS accounts, Swedish rules, projections, `MemoryLedgerStore` reference impl.
- **packages/persistence-postgres** — `PostgresLedgerStore` against Supabase Postgres using `postgres-js`. Each mutation runs in `sql.begin(...)` with `SELECT … FOR UPDATE` on the workspace tail row to keep the hash chain serializable.
- **packages/document-intelligence** — Adapter for `@azure-rest/ai-document-intelligence` (REST client, GA `2024-11-30`). `pickModelForDocument` picks `prebuilt-invoice` for Swedish _fakturer_, falls back to `prebuilt-receipt` for till receipts. Uses `getLongRunningPoller` for all calls.
- **packages/ai-core** — Provider-agnostic AI abstraction. Factory selects `LocalAiRuntime` (demo), `ResponsesAiRuntime` (Azure OpenAI), or `UnavailableAiRuntime` based on runtime mode + config. Exposes `embed()` for retrieval (default `text-embedding-3-small`, 1536 dims).
- **packages/api-client** — TypeScript client with demo-mode fallback to in-memory store. `initUpload` + `uploadBlob` cover the two-step Azure Blob signed-upload flow.
- **packages/reporting** — Report summarization helpers (journal, balances, VAT).
- **packages/ui-tokens** — Design tokens (colors, fonts, formatters). Theme: Manrope + IBM Plex Mono, teal accent.

### Key design rules

- **Append-only events** are the source of truth; never overwrite evidence or ledger history. The hash chain (`previous_hash → event_hash`) is global per workspace; mutations lock the latest event row with `SELECT … FOR UPDATE` before appending.
- **AI suggests, never mutates** — AI outputs (LLM responses, Document Intelligence extractions) require human review before affecting ledger state. The review queue stays the only path to a posted voucher.
- **`LedgerStore` is async** — every method returns `Promise<T>`. Postgres + future async stores were the driver; `MemoryLedgerStore` matches the interface by wrapping its sync logic.
- **Runtime mode is explicit**: `demo` uses scaffold fallbacks (`MemoryLedgerStore`, `LocalAiRuntime`, `StubBlobUploader`, `StubDocumentIntelligenceClient`); `normal` fails closed if `SUPABASE_DB_URL` / Azure config is missing (`UnavailableLedgerStore` + `/ready.checks.ledger=false`).
- **Use User-Delegation SAS for blob uploads, not account keys** — the API mints a 10-minute write-only SAS via Managed Identity (`DefaultAzureCredential`). Bicep grants `Storage Blob Delegator` + `Storage Blob Data Contributor` to the API's system-assigned identity; without both, SAS minting returns 403.
- **Database client policy**: server-side ledger writes go through `postgres-js` direct (or Supavisor session mode). PostgREST cannot run multi-statement transactions — `@supabase/supabase-js` is reserved for auth/admin helpers, not the write path.
- **Projections are derived** — journal, balances, VAT reports are calculated from events via `packages/domain/src/projections.ts`. The Postgres store currently re-derives reports per request (strategy B in the persistence plan); incremental projection writes are a follow-up if read latency demands.
- **Swedish compliance first** — BAS chart of accounts, Bokföringslagen citations, VAT deductibility rules.

### Web app routing

The web app uses Next.js App Router with a `(shell)` route group for the main tab-based layout. API calls proxy through `app/api-proxy/[...path]/route.ts` to the Hono API.

`apps/web/next.config.ts` sets baseline security **`headers()`** (CSP is stricter in production than in dev because of `unsafe-eval` / websocket needs). **`output: "standalone"`** targets container deploys; prefer the standalone `server.js` entry when running production images, not `next start`.

### Web app UI primitives

Reuse before reinventing — the following modules already exist in `apps/web/`:

- **Focus trap for modals** — `apps/web/lib/focus-trap.ts` exports `useDialogFocusTrap(containerRef, open, onClose, initialFocusRef?)` which handles Escape, Tab/Shift+Tab wrap, and initial focus. Used by the command palette; the capture sheet in `app-shell.tsx` still rolls its own inline trap (migration tracked in the advisory-pivot plan, Task 1.6). New modals should use this hook, not roll their own keyboard logic.
- **Menu overlays** — don't use `<details>`/`<summary>` for menu overlays; they don't close on Escape or outside click. Use a controlled-open + invisible-backdrop-button pattern instead. (The former `AccountMenu`/`NotificationMenu` components this section used to describe no longer exist in `app-shell.tsx`.)
- **Command palette** — `apps/web/components/command-palette.tsx`. Globally bound to `Cmd+K` / `Ctrl+K` in `AppShell`. Searches vouchers, reviews, and account balances from the workspace snapshot; `buildHits` builds an O(R) `Map` of reviews-by-voucher, **don't** scan `data.reviews` per voucher. Shortcut hint label switches between `⌘K` and `Ctrl K` via `navigator.platform` detection.
- **Report period helpers** — `apps/web/lib/report-period.ts` (`getPeriodDayRange`, `journalEntryInPeriod`, `ReportPeriodPreset`). Date formatting uses **local calendar parts**, not `toISOString().slice(0, 10)` — that path silently mis-bucketed entries at month edges in non-UTC timezones (the bug is documented in the file).
- **Assistant thread history** — `apps/web/lib/assistant-thread-storage.ts`. `prependAssistantThread(session)` writes to localStorage and **returns** the merged array; callers should consume that return value instead of calling `loadAssistantThreads()` again. Capped at `MAX_THREADS = 30`.
- **Mobile dock + capture-pill clearance** — `.workspace-canvas` in `apps/web/app/globals.css` reserves `calc(env(safe-area-inset-bottom) + 144px)` of bottom padding on mobile and resets to `24px` at the `≥1024px` breakpoint. Locked by `tests/e2e/mobile-bottom-clearance.spec.ts`. Do not lower the mobile padding without updating both the CSS and the regression test.
- **Primary nav labels** are `Today / Capture / Books / Reports / Settings` (5-tab IA landed in PR-D3). The mobile project on Pixel 7 shares the dock semantics with desktop — both surfaces consume the same `navigation` array in `app-shell.tsx`. `/` redirects to `/today`.
- **Ambient digest** is a Next.js parallel route at `apps/web/app/(shell)/@digest/` (slot prop `digest`). The shell layout receives both `children` and `digest` and passes the latter to `AppShell`. When adding new pages under `(shell)/`, the digest slot continues to render unless you provide a per-segment `@digest/default.tsx`.
- **URL state via nuqs** — `NuqsAdapter` (from `nuqs/adapters/next/app`) is mounted in the root layout (`apps/web/app/layout.tsx`) so any client component can call `useQueryState`. Example: `apps/web/hooks/use-period-scope.ts` parses `?period=YYYY-MM` for the Books / Reports period selector. Don't wrap `useQueryState` results in `useMemo` — React Compiler errors on it; use plain functions outside the hook.
- **shadcn/ui primitives** live in `apps/web/components/ui/` alongside bespoke project components. Distinguishing them by import is the convention: shadcn primitives import `cn` from `@/lib/utils` and `cva` from `class-variance-authority`; bespoke components (`icons.tsx`, `metric-card.tsx`, `screen-header.tsx`, `section-label.tsx`, `status-badge.tsx`, `unavailable-state.tsx`) don't. Add new shadcn primitives via `pnpm dlx shadcn@latest add <name>` (config in `apps/web/components.json` is style `base-nova` / baseColor `neutral` / lucide). Skeleton is the merged exception — exports both shadcn `Skeleton` and bespoke `ScreenSkeleton`.
- **Sonner toaster + Skip-to-content link** are mounted at the root layout (`apps/web/app/layout.tsx`). Call `toast("...")` from anywhere; the toaster surfaces bottom-right. The skip-to-content link targets `#main-content` — when adding new top-level routes, render an element with `id="main-content"` to make the link functional for keyboard users.
- **useIsMobile hook** at `apps/web/hooks/use-mobile.ts` uses `useSyncExternalStore` (not `useState+useEffect` — ESLint's `react-hooks/set-state-in-effect` rule fails the latter). SSR-safe; returns `false` during render, real value after hydration.

### E2E test setup

Playwright runs sequentially (1 worker) against dedicated test servers: API on port 3201 (demo mode, test reset enabled), web on port 3200. Both desktop and mobile (Pixel 7) projects. Tests must `pnpm build` first since the web server uses `next start`.

### Known deferred / Don't accidentally redo

- **`parseBody` in `services/api/src/app.ts` is intentional, not legacy.** Phase E.1 (replace with `@hono/zod-validator`) was deferred because the current helper produces the exact `{ code: "validation_error", issues: [...] }` 400-body shape that `tests/unit/api-runtime.test.ts` asserts on. Don't swap it without a parity test first.
- **Phase E.4 (`hono-openapi`) is deferred** because the existing `parseBody` works and `@hono/zod-openapi` has an open Zod v4 incompatibility (issue #1177). Switching needs a deeper Zod v4 sweep — not a one-line dep add.
- **5 deploy-only perf/cleanup ideas already on main's PostgresLedgerStore** — projection-aggregate triggers, parallel queries on `getEvidenceContext`, batched suggestion lookups on `getReviewFeed`, org-scoped-first gate on `suggestVoucher`, settings audit attribution. PR-F was opened to port them and closed as a no-op once verified present. No action needed.
- **Track A forward-looking plans** live under [`docs/superpowers/plans/`](docs/superpowers/plans/). **Landed:** Phase 5 Capture (real `/capture` with quick-add, drafts, archive, evidence detail route). **Remaining:** Phase 6 Advisor (Cmd-K still a basic palette — real AI advisor pending), Phase 7 Reports drill-downs, Phase 8 Settings depth (PR-D2 layout landed; 6 of 8 sub-pages still header-only stubs), unified radius refactor. **These are superseded where they conflict by the advisory pivot** — spec: [`docs/superpowers/specs/2026-07-03-advisory-pivot-design.md`](docs/superpowers/specs/2026-07-03-advisory-pivot-design.md), master plan: [`docs/superpowers/plans/2026-07-03-advisory-pivot-master-plan.md`](docs/superpowers/plans/2026-07-03-advisory-pivot-master-plan.md) (branch `feat/advisory-pivot`).
- **CI E2E is opt-in on PRs** (`.github/workflows/ci.yml`). It runs automatically on **pushes to `main`** (final pre-deploy gate) and via **workflow_dispatch**, but on PRs only when the `run-e2e` label is applied. Apply the label and either push a new commit or re-run the workflow to fire it; remove the label to skip. Background: the job intermittently hung (~1h for what should be 1m20s), so routine PRs land on typecheck + unit + build only. Use `gh pr edit <N> --add-label run-e2e` before merging anything user-facing where regressions would be hard to catch otherwise.
- **Local `pnpm dev:web` port 3002 may collide** with the user's CultureDNA dev server (Vite + React Router 7). When visual inspection is needed and 3002 is taken, fall back to E2E for regression detection or coordinate the port collision before starting dev.

### Recently consolidated (2026-05-28 sweep) — Don't try to redo

- **Shared posting helpers** moved to [`packages/domain/src/evidence-defaults.ts`](packages/domain/src/evidence-defaults.ts): `buildExtractedFields`, `guessSupplier`, `guessAccountingMethod`, `initialLedgerLines`. Both `MemoryLedgerStore` and `PostgresLedgerStore` now import from there. `buildPostingLines` is also imported from `@jpx-accounting/domain` by both stores.
- **`LedgerLine` type** is exported from [`packages/domain/src/projections.ts`](packages/domain/src/projections.ts) (previously local).
- **`BlobUploader.mintReadSas(blobPath)`** added to [`services/api/src/blob.ts`](services/api/src/blob.ts) (both Stub + Azure). `/api/evidence/:id/extract` now mints a real User-Delegation SAS instead of the `https://placeholder/${blobPath}` URL. Real OCR still pending: `LedgerStore.updateEvidenceExtraction()` + `ExtractionRefreshed` event type would persist the result.
- **PWA manifest share_target** is POST + multipart with file accept; [`apps/web/app/share/route.ts`](apps/web/app/share/route.ts) is the intake handler that redirects to `/capture?…`. The old `/share/page.tsx` is deleted.
- **Bicep + deploy.yml** now wire `SUPABASE_DB_URL`, `AZURE_OPENAI_*`, and `AZURE_DOCUMENT_INTELLIGENCE_*` secrets through to the API App Service env. Unused Supabase REST keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) removed since `@supabase/supabase-js` is not on the write path.

### Migrations

SQL migrations live in `infra/supabase/migrations/000N_*.sql` and are applied in numeric order. Current: `0001_init.sql`, `0002_schema_alignment.sql`, `0003_pgvector.sql`, `0004_compliance_and_settings.sql`. New migrations get the next number. They must be idempotent (`if not exists` / `if exists`, CHECK constraints added via `DO $$ ... exception when duplicate_object then null; end $$;` blocks) — the same file may be replayed on partial environments.

`0004` uses `NULLS NOT DISTINCT` on its unique index, which requires Postgres 15+. Supabase ships PG 17 by default, so this is safe in normal mode; self-hosted Postgres deployments need to verify.

### Deploy

Production deploy runs through `.github/workflows/deploy.yml`: web is a Docker image (Next.js standalone), API is bundled with `esbuild` into `server.mjs` and zip-deployed (`WEBSITE_RUN_FROM_PACKAGE=1`). Bicep in `infra/azure/main.bicep` provisions both App Services on the existing `jpx-app-plan` and grants the API's Managed Identity the `Storage Blob Delegator` + `Storage Blob Data Contributor` RBAC roles required for User-Delegation SAS minting.

## Environment

Key env vars (see `.env.example` for full list):

**Runtime + CORS**

- `ACCOUNTING_RUNTIME_MODE`: `demo` | `normal` (default: demo)
- `ACCOUNTING_CORS_ORIGINS`: comma-separated browser origins permitted for `/api/*` in **`normal`** (ignored for `demo` open CORS)
- `ACCOUNTING_API_BASE_URL`: Internal API URL for server-side proxy (e.g., http://localhost:3001)
- `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`: Must match API's runtime mode

**Persistence (Phase A)**

- `SUPABASE_DB_URL`: Direct Postgres URL (port 5432) or Supavisor session-mode URL — required to enable `PostgresLedgerStore` in normal mode. Without it, normal mode stays fail-closed.
- `SUPABASE_POOLER_TRANSACTION_MODE`: Set to `true` only when `SUPABASE_DB_URL` points at the Supavisor transaction-mode pooler (port 6543). Disables `postgres-js` named prepared statements, which transaction mode does not support.

**AI / extraction / retrieval (Phases C–D)**

- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`: Required for normal-mode chat + embeddings.
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`: Required for live OCR via `@azure-rest/ai-document-intelligence`. Without them the adapter returns the stub.

**Storage (Phase B)**

- `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`: Required for User-Delegation SAS minting in `/api/uploads/init`. Bicep also needs `Storage Blob Delegator` + `Storage Blob Data Contributor` role assignments on the API's Managed Identity.

**Hardening (Phase E)**

- `SUPABASE_JWKS_URL`: Optional. When set (e.g. `${SUPABASE_URL}/auth/v1/keys`), `/api/*` mutating routes require a JWT verifiable against this JWKS endpoint. Default algorithm is `RS256`.

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for trust boundaries, the env matrix, and build/deploy subtleties.

**Conventions / anti-patterns:** see [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for 26 rules distilled from past incidents — schema-contract sync, partial-index pitfalls, store parity between `MemoryLedgerStore` and `PostgresLedgerStore`, citation provenance, audit attribution sentinels, bounded accumulation. Consult before changes that touch contracts, migrations, or `LedgerStore` implementations.

**Development status / port progress:** see [docs/DEV_STATUS.md](docs/DEV_STATUS.md) for the Phase 7 + PR-D1 port status (PR-A/B/C/D1 MERGED; PR-D2/D3 pending) and the UI follow-ups the new API surfaces will need once landed.

**Session handovers:**

- [docs/superpowers/2026-05-27-deploy-to-main-port-session-handover.md](docs/superpowers/2026-05-27-deploy-to-main-port-session-handover.md) — first half of the `deploy → main` port (PRs A/B/C + PR-D1 shadcn foundation): what was done, what was learned, what's open.
- [docs/superpowers/2026-05-27-deploy-cleanup-junior-dev-handover.md](docs/superpowers/2026-05-27-deploy-cleanup-junior-dev-handover.md) — second half plan (PRs F/E1/G/D2/D3/H) drafted as a junior-dev handover with embedded library research. All 6 PRs subsequently executed (F as no-op).
