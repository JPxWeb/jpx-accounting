# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Cross-tool contract:** [`AGENTS.md`](AGENTS.md) is the compact agent contract shared by all coding tools and wins on conflict; this file is the deeper Claude-specific project memory. (Per JPx ADR DL-001 — the ADR ledger lives in the private JPx brain repo, external to this public repo.)

Prefer **official docs**: use Context7 (e.g. `/vercel/next.js` pinned to the repo Next version) or vendor docs before relying on recalled API details — especially ESLint flat config, pnpm lifecycle policy, Playwright wiring, Azure deploy.

## Build & Dev Commands

```bash
pnpm install                  # Install all workspace dependencies (esbuild/sharp builds allowlisted — see pnpm-workspace.yaml)
pnpm dev                     # Parallel: Next + API (root scripts use corepack pnpm when bare pnpm is not on PATH)
pnpm dev:web                  # Start Next.js dev server (http://localhost:3002 — see apps/web/package.json)
pnpm dev:api                  # Start Hono API with tsx watch (default http://localhost:3001)
pnpm lint                     # ESLint (root eslint.config.mjs)
pnpm lint:fix
pnpm format                   # Prettier write
pnpm format:check             # Prettier CI check
pnpm typecheck                # TypeScript check across all 11 workspace packages
pnpm typecheck:tests          # Typecheck the tests/ directory (separate tsconfig — added in PR-B)
pnpm build                    # Build web + API (`services/api` is typecheck-only; deploy bundles API with esbuild)
pnpm check                    # lint + format:check + typecheck + typecheck:tests + unit tests + build
pnpm build:knowledge          # Regenerate packages/advisor/src/corpus.generated.ts from docs/knowledge/sv (generated file is checked in — commit the diff)
pnpm ingest:knowledge         # Embed + upsert the knowledge corpus into Postgres pgvector (needs SUPABASE_DB_URL + AZURE_OPENAI_*)

# Testing
pnpm test:unit                # Unit tests: tsx --test 'tests/unit/**/*.test.ts'
pnpm test:unit:coverage       # Same suite under c8 coverage
pnpm test:integration          # Postgres integration tests (skip silently when SUPABASE_DB_URL is unset)
pnpm test:e2e                 # Playwright E2E (builds first, starts both servers)
pnpm test:e2e:headed          # E2E with visible browser
pnpm test:e2e:install          # Install Chromium for Playwright

# Run a single E2E test (build:e2e bakes the demo/proxy env the specs assume)
pnpm build:e2e && npx playwright test tests/e2e/home.spec.ts

# Visual baselines (20 themed screenshots; [data-visual-mask] regions are masked)
pnpm test:e2e:visual          # compare against baselines
pnpm test:e2e:visual:update   # re-baseline — only after reviewing every diff image

# Run a single unit test
tsx --test tests/unit/some-file.test.ts

# Run a single integration test (still gated on SUPABASE_DB_URL)
tsx --test tests/integration/postgres-ledger.test.ts

# Run integration tests against a real Postgres
# (throwaway pgvector/pgvector:pg17 container + migrations 0001-0008 — exact
# commands in scripts/integration-db.md; then export SUPABASE_DB_URL)
pnpm test:integration

# Other checks
pnpm check:corpus             # Knowledge-corpus freshness tripwire (not yet part of `pnpm check`/CI)
pnpm bundle:api               # esbuild-bundle the API into api-deploy/server.cjs (what deploy.yml ships)
```

## Architecture

pnpm monorepo (Node >=24, pnpm 10.29.2) — mobile-first Swedish accounting PWA with AI assistance.

### Workspace layout

- **apps/web** — Next.js 16 PWA (React 19, TailwindCSS 4, React Query 5, Motion 12, shadcn/ui via `@base-ui/react`, Sonner toaster, react-hook-form, nuqs, @tanstack/react-table). Swedish locale throughout. `@/*` path alias resolves to `apps/web/*` (see `apps/web/tsconfig.json` and `components.json`).
- **services/api** — Hono HTTP server (port 3001). Routes in `src/app.ts`, dependency injection in `src/runtime.ts`, blob SAS minting in `src/blob.ts`. `GET /health` = liveness; `GET /ready` = readiness (`ledger` + `ai` checks). JSON errors carry `requestId`; `400`s use `code: "validation_error"` + `issues[]`. When `SUPABASE_JWKS_URL` is set (**required in normal mode** — the API refuses to boot without it), `hono/jwk` gates **ALL `/api/*` routes and methods** (sole exemption: `GET /api/runtime-info`, the public AI-transparency panel); actor attribution is derived server-side from the verified token subject (`user:<sub>`, demo sentinel with auth off) and mutating routes go through `hono-rate-limiter` keyed by verified subject (client-address bucket when unauthenticated) — `POST /api/advisor/chat` (AI SDK 7 UI-message SSE, `src/advisor/`, output/token + stream-timeout cost envelope) inherits that same stack. `GET /api/integrity` + `GET /api/runtime-info` are the Phase-5 trust endpoints; `src/knowledge.ts` serves `POST /api/knowledge/query` (keyword always, pgvector in normal mode with keyword fallback).
- **packages/contracts** — Zod v4 schemas: the single source of truth for all API shapes and domain types.
- **packages/domain** — Core accounting logic: `LedgerStore` interface (**async**), append-only event sourcing with hash chain, BAS accounts, Swedish rules (incl. `confidenceBand()` 0.85/0.6 — the ONE confidence-tier source), projections, statutory tax calendar (`src/tax/calendar.ts`), hash-chain integrity summary (`src/integrity.ts` — linkage always, payload recomputation for SHA-256 events), `MemoryLedgerStore` reference impl.
- **packages/persistence-postgres** — `PostgresLedgerStore` against Supabase Postgres using `postgres-js`. Each mutation runs in `sql.begin(...)` taking `pg_advisory_xact_lock` on the workspace key **before** reading the chain tail (`lockWorkspaceTail`); migration `0006` backs it with a `seq` identity column (final ORDER BY tiebreak on every events read) and a `UNIQUE (organization_id, workspace_id, previous_hash)` constraint that turns any fork attempt into a retryable 23505. The old `SELECT … FOR UPDATE` tail-row lock is gone — a blocked FOR-UPDATE waiter resumed on a stale snapshot and could silently fork the chain. Also `src/knowledge.ts`: `upsertKnowledgeDocuments` + `queryKnowledgeByEmbedding` (cosine `<=>` on `halfvec(1536)`) for the RAG loop.
- **packages/document-intelligence** — Adapter for `@azure-rest/ai-document-intelligence` (REST client, GA `2024-11-30`). `pickModelForDocument` picks `prebuilt-invoice` for Swedish _fakturer_, falls back to `prebuilt-receipt` for till receipts. Uses `getLongRunningPoller` for all calls.
- **packages/ai-core** — Provider-agnostic AI abstraction. Factory selects `LocalAiRuntime` (demo), `ResponsesAiRuntime` (Azure OpenAI), or `UnavailableAiRuntime` based on runtime mode + config. Exposes `embed()` for retrieval (default `text-embedding-3-small`, 1536 dims). Advisor **chat** does not go through ai-core — it uses AI SDK 7 in `services/api/src/advisor/`; both read the same `AZURE_OPENAI_*` env.
- **packages/advisor** — Pure, isomorphic advisor brain (deps: contracts + reporting only — **never** ai-core, whose `openai` import must not reach the web bundle). Bundled sourced Swedish knowledge corpus (`src/corpus.generated.ts`, regenerated via `pnpm build:knowledge` from `docs/knowledge/sv`), BM25-lite retrieval, grounding builder, deterministic demo advisor turns, suggested prompts. One brain, two thin adapters: the API wraps it in UI-message SSE; the web replays it via `LocalDemoChatTransport`.
- **packages/api-client** — TypeScript client with demo-mode fallback to in-memory store. `initUpload` + `uploadBlob` cover the two-step Azure Blob signed-upload flow.
- **packages/reporting** — Report summarization helpers (journal, balances, VAT) + the deterministic six-detector observation engine (`src/observations.ts`) feeding the dashboard, advisor grounding, and suggested prompts.
- **packages/ui-tokens** — Design tokens (colors, fonts, formatters). Theme: Manrope + IBM Plex Mono, teal accent.

### Key design rules

- **Append-only events** are the source of truth; never overwrite evidence or ledger history. The hash chain (`previous_hash → event_hash`) is global per workspace. Event hashes are **SHA-256 over canonical JSON** (`packages/domain/src/hash-chain.ts`: `sha256_` + 64 hex; `canonicalJson` is byte-stable across the Postgres jsonb round trip, so `GET /api/integrity` recomputes payload hashes, not just linkage). Pre-cutover chains keep their legacy djb2 links (`h_` + 8 hex, linkage-only) — a valid chain is a djb2 prefix followed by a SHA-256 suffix; a djb2 hash AFTER any SHA-256 hash is a break. Postgres mutations serialize via `pg_advisory_xact_lock` before the tail read (see persistence-postgres above), never via tail-row `FOR UPDATE`.
- **Actor attribution is server-derived** — request schemas carry NO `actorId` (a client-posted key is stripped by Zod). The API derives the actor from the verified JWT subject (`user:<sub>`), or the demo sentinel when auth is off. Never reintroduce client-supplied attribution.
- **Booking dates come from the business event, not the click** — approved vouchers are dated by `deriveBookedAt` (`packages/domain/src/store.ts`): `transactionDate`, falling back to `receiptDate`, never the approval timestamp.
- **AI suggests, never mutates** — AI outputs (LLM responses, Document Intelligence extractions) require human review before affecting ledger state. The review queue stays the only path to a posted voucher. The advisor's `proposeReviewAction` tool is no exception: it executes only the existing `applyReviewDecision(...)` and only after an explicit, HMAC-signed human tool-approval (`ADVISOR_TOOL_APPROVAL_SECRET`).
- **`LedgerStore` is async** — every method returns `Promise<T>`. Postgres + future async stores were the driver; `MemoryLedgerStore` matches the interface by wrapping its sync logic.
- **Runtime mode is explicit**: `demo` uses scaffold fallbacks (`MemoryLedgerStore`, `LocalAiRuntime`, `StubBlobUploader`, `StubDocumentIntelligenceClient`); `normal` fails closed if `SUPABASE_DB_URL` / Azure config is missing (`UnavailableLedgerStore` + `/ready.checks.ledger=false`).
- **Use User-Delegation SAS for blob uploads, not account keys** — the API mints a 10-minute write-only SAS via Managed Identity (`DefaultAzureCredential`). Bicep grants `Storage Blob Delegator` + `Storage Blob Data Contributor` to the API's system-assigned identity; without both, SAS minting returns 403.
- **Database client policy**: server-side ledger writes go through `postgres-js` direct (or Supavisor session mode). PostgREST cannot run multi-statement transactions — `@supabase/supabase-js` is reserved for auth/admin helpers, not the write path.
- **Projections are derived** — journal, balances, VAT reports are calculated from events via `packages/domain/src/projections.ts`. The Postgres store currently re-derives reports per request (strategy B in the persistence plan); incremental projection writes are a follow-up if read latency demands.
- **Swedish compliance first** — BAS chart of accounts, Bokföringslagen citations, VAT deductibility rules.

### Web app routing

The web app uses Next.js App Router with a `(shell)` route group for the main tab-based layout. API calls proxy through `app/api-proxy/[...path]/route.ts` to the Hono API. The proxy **streams** `response.body` through unbuffered and forwards the `x-vercel-ai-ui-message-stream` header — advisor SSE hangs behind an `arrayBuffer()` drain, so don't reintroduce buffering (streaming is byte-identical for buffered JSON routes).

`apps/web/next.config.ts` sets baseline security **`headers()`** (CSP is stricter in production than in dev because of `unsafe-eval` / websocket needs). **`output: "standalone"`** targets container deploys; prefer the standalone `server.js` entry when running production images, not `next start`.

### Web app UI primitives

Reuse before reinventing — the following modules already exist in `apps/web/`:

- **Focus trap for modals** — `apps/web/lib/focus-trap.ts` exports `useDialogFocusTrap(containerRef, open, onClose, initialFocusRef?)` which handles Escape, Tab/Shift+Tab wrap, and initial focus. Used by the command palette, the capture sheet in `app-shell.tsx`, the review edit sheet, and the reports drill drawer. New modals should use this hook, not roll their own keyboard logic.
- **Menu overlays** — don't use `<details>`/`<summary>` for menu overlays; they don't close on Escape or outside click. Use a controlled-open + invisible-backdrop-button pattern instead. (The former `AccountMenu`/`NotificationMenu` components this section used to describe no longer exist in `app-shell.tsx`.)
- **Command palette** — `apps/web/components/command-palette.tsx`. Globally bound to `Cmd+K` / `Ctrl+K` in `AppShell`. Searches vouchers, reviews, and account balances from the workspace snapshot; `buildHits` builds an O(R) `Map` of reviews-by-voucher, **don't** scan `data.reviews` per voucher. Shortcut hint label switches between `⌘K` and `Ctrl K` via `navigator.platform` detection.
- **Period model** — ONE fiscal-aware period system: `resolvePeriodToken`/`currentMonthToken` in `packages/domain/src/reports/period.ts` (tokens `YYYY-MM`, `YYYY-QN` fiscal quarters, `fy-YYYY`, `ytd`, `all`) consumed by `apps/web/hooks/use-period-scope.ts` (nuqs `?period=`) and the period-scoped report routes. Date formatting uses **local calendar parts**, never `toISOString().slice(0, 10)` — the old UTC path silently mis-bucketed month-edge entries (regression-pinned in `tests/unit/report-period.test.ts`). The former `apps/web/lib/report-period.ts` helpers are deleted.
- **Assistant thread history** — `apps/web/lib/assistant-thread-storage.ts`, storage **v2** (key `jpx.accounting.assistantThreads.v2`): threads are whole `UIMessage[]` conversations (`{id, title, messages, savedAt}`) so a reopened thread replays text, provenance, and tool-approval parts exactly as streamed; old v1 `{question, answer}` rows are read-migrated once. `prependAssistantThread(thread)` writes to localStorage and **returns** the merged array; callers should consume that return value instead of calling `loadAssistantThreads()` again. Capped at `MAX_THREADS = 30`.
- **Advisor chat** — `apps/web/components/advisor/` on `@ai-sdk/react` `useChat` (AI SDK 7, exact-pinned). Transport: `DefaultChatTransport` against `/api/advisor/chat`, or `LocalDemoChatTransport` (`local-demo-transport.ts`) when the demo fallback store is active — it replays the same `buildDemoAdvisorTurn` parts client-side, mirroring the server's chunk protocol. Tool approvals render as approval cards and execute only through the review gate ("AI suggests, never mutates" is unchanged). Article 50 labeling: persistent assistant badge + per-message `ai-generated-marker`. Grep gate: `ai`/`@ai-sdk` imports live only in `components/advisor/*` (web) and `services/api/src/advisor/*` (API).
- **Mobile dock + capture-pill clearance** — `.workspace-canvas` in `apps/web/app/globals.css` reserves `calc(env(safe-area-inset-bottom) + 144px)` of bottom padding on mobile and resets to `24px` at the `≥1024px` breakpoint. Locked by `tests/e2e/mobile-bottom-clearance.spec.ts`. Do not lower the mobile padding without updating both the CSS and the regression test.
- **Primary nav labels** are `Today / Capture / Books / Reports / Settings` (5-tab IA landed in PR-D3). The mobile project on Pixel 7 shares the dock semantics with desktop — both surfaces consume the same `navigation` array in `app-shell.tsx`. `/` redirects to `/today`.
- **Dashboard foundation** — `/today` is a drag-&-drop widget dashboard (the former ambient-digest parallel route is **deleted**). Layout model is `apps/web/lib/dashboard-layout-core.ts` (pure: `WIDGET_IDS` ×10 — new widgets append LAST so persisted layouts migrate; `order` + `hidden`, immutable helpers) persisted by `dashboard-layout-storage.ts` (`useDashboardLayout()` — localStorage key `jpx.accounting.dashboardLayout.v1`, BroadcastChannel sync, one `useSyncExternalStore`; client-side only, no server persistence). `components/dashboard/sortable-grid.tsx` is THE dnd abstraction — every `@dnd-kit` import lives in that one file (exit-gate grep enforces it). Widgets get uniform chrome with testids `widget-<id>`, `widget-handle-<id>`, `widget-drill-<id>`, `widget-remove-<id>`; the grid is `dashboard-canvas`. View switch via nuqs `?view=` on `/today` (`dashboard` default); the full review queue lives verbatim in `components/today/review-queue-view.tsx` at `/today?view=queue`, and a present `?review=` deep-link forces the queue. Widget mini-visuals are dependency-free inline SVG (`mini-sparkline`/`mini-bars`) — never import the recharts kit into the dashboard.
- **URL state via nuqs** — `NuqsAdapter` (from `nuqs/adapters/next/app`) is mounted in the root layout (`apps/web/app/layout.tsx`) so any client component can call `useQueryState`. Example: `apps/web/hooks/use-period-scope.ts` parses `?period=YYYY-MM` for the Books / Reports period selector. Don't wrap `useQueryState` results in `useMemo` — React Compiler errors on it; use plain functions outside the hook.
- **shadcn/ui primitives** live in `apps/web/components/ui/` alongside bespoke project components. Distinguishing them by import is the convention: shadcn primitives import `cn` from `@/lib/utils` and `cva` from `class-variance-authority`; bespoke components (`icons.tsx`, `metric-card.tsx`, `screen-header.tsx`, `section-label.tsx`, `status-badge.tsx`, `unavailable-state.tsx`) don't. Add new shadcn primitives via `pnpm dlx shadcn@latest add <name>` (config in `apps/web/components.json` is style `base-nova` / baseColor `neutral` / lucide). Skeleton is the merged exception — exports both shadcn `Skeleton` and bespoke `ScreenSkeleton`.
- **Sonner toaster + Skip-to-content link** are mounted at the root layout (`apps/web/app/layout.tsx`). Call `toast("...")` from anywhere; the toaster surfaces bottom-right. The skip-to-content link targets `#main-content` — when adding new top-level routes, render an element with `id="main-content"` to make the link functional for keyboard users.
- **useIsMobile hook** at `apps/web/hooks/use-mobile.ts` uses `useSyncExternalStore` (not `useState+useEffect` — ESLint's `react-hooks/set-state-in-effect` rule fails the latter). SSR-safe; returns `false` during render, real value after hydration.
- **Auth MVP (Supabase)** — `/login` is a standalone route outside `(shell)` (no tab chrome; `components/auth/login-screen.tsx`). Session state lives in `apps/web/lib/auth/session.ts` (`useSyncExternalStore`; Supabase `onAuthStateChange` is the single writer). Bearer threading: `apps/web/lib/client.ts` attaches `Authorization: Bearer <token>` to every API request while signed in, and the api-proxy forwards the `authorization` header. Sign-out calls `clearAllLocalData()` — `apps/web/lib/local-data.ts` is THE canonical registry of every persistent client-side store (localStorage/IndexedDB/CacheStorage), pinned by `tests/unit/local-data-registry.test.ts` which fails on any unregistered storage writer. The whole auth UI is enabled only when `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both set at web build time; unset, the app stays the auth-free demo experience.
- **Onboarding (opt-in tours)** — `apps/web/components/onboarding/` + `apps/web/lib/onboarding/`. Checklist milestones are data-derived in `getting-started-widget.tsx` (`deriveMilestones`); tour completion is opt-in localStorage (`onboarding-storage.ts`). Joyride v3: use `skipBeacon: true` on steps (not v2 `disableBeacon`). `OnboardingShell` wraps `(shell)/layout.tsx`; tour blockers via `registerGlobalTourBlocker`. E2E: `tests/e2e/onboarding.spec.ts`. See CONVENTIONS rule 29.

### E2E test setup

Playwright runs sequentially (1 worker) against dedicated test servers: API on port 3201 (demo mode, test reset enabled), web on port 3200. Both desktop and mobile (Pixel 7) projects. Tests must `pnpm build:e2e` first since the web server uses `next start`. `playwright.config.ts` webServer commands use `corepack pnpm` (bare `pnpm` is not on PATH in some Windows/agent shells). On the mobile project, activate controls via `activateControl(locator, isMobile)` from `tests/e2e/test-helpers.ts` — it clicks on desktop but uses coordinate-free keyboard activation (focus + Enter) on mobile, because Pixel 7 emulation can wedge a persistent `visualViewport.offsetTop` that makes every pointer click (and `.tap()`) hit-test 51 px above the target.

Visual regression (`tests/e2e/visual-regression.spec.ts`, 20 themed full-page shots): baselines are **per-platform** (`-win32` and `-linux` suffixes — linux is what CI compares; both sets are checked in). Clock-derived UI — topbar timestamp, journal/archive dates, event hashes, activity dates — must carry a `data-visual-mask` attribute; the spec masks those regions so baselines stay date-stable. Re-baseline only with `pnpm test:e2e:visual:update` after reviewing every diff image; the full generate/review/re-baseline workflow (including producing linux baselines from Windows) is in [`scripts/visual-baselines.md`](scripts/visual-baselines.md).

### Known deferred / Don't accidentally redo

- **Phase E.1 (`@hono/zod-validator`) has landed.** Body validation goes through `jsonValidated(schema)` in `services/api/src/validation.ts`, which wraps `@hono/zod-validator` 0.8 with a hook that throws `ApiValidationError` so `app.onError` keeps emitting the contract-pinned `{ code: "validation_error", issues: [...] }` 400 body that `tests/unit/api-runtime.test.ts` asserts on. The old `parseBody` helper is gone — don't reintroduce per-route ad-hoc parsing.
- **Phase E.4 (`hono-openapi`) is still deferred** — `@hono/zod-openapi` has an open Zod v4 incompatibility (issue #1177). Switching needs a deeper Zod v4 sweep — not a one-line dep add.
- **5 deploy-only perf/cleanup ideas already on main's PostgresLedgerStore** — projection-aggregate triggers, parallel queries on `getEvidenceContext`, batched suggestion lookups on `getReviewFeed`, org-scoped-first gate on `suggestVoucher`, settings audit attribution. PR-F was opened to port them and closed as a no-op once verified present. No action needed.
- **Track A forward-looking plans** live under [`docs/superpowers/plans/`](docs/superpowers/plans/). **Landed:** Phase 5 Capture (real `/capture` with quick-add, drafts, archive, evidence detail route); Phase 6 Advisor (superseded by pivot Phase 5 — real AI advisor shipped; Cmd-K remains a search palette); Phase 7 Reports drill-downs (superseded by pivot Phase 4 `?drill=` grammar); Phase 8 Settings depth (all 8 sub-pages render real wired components — **0 header-only stubs remain**; Profile and Billing cards on `/settings/about` are still unbuilt placeholders); unified radius (pivot Phase 1). **These are superseded where they conflict by the advisory pivot** — spec: [`docs/superpowers/specs/2026-07-03-advisory-pivot-design.md`](docs/superpowers/specs/2026-07-03-advisory-pivot-design.md), master plan: [`docs/superpowers/plans/2026-07-03-advisory-pivot-master-plan.md`](docs/superpowers/plans/2026-07-03-advisory-pivot-master-plan.md) (landed on main; the `feat/advisory-pivot` branch is merged and deleted).
- **CI E2E is opt-in on PRs** (`.github/workflows/ci.yml`). It runs automatically on **pushes to `main`** (final pre-deploy gate) and via **workflow_dispatch**, but on PRs only when the `run-e2e` label is applied. Apply the label and either push a new commit or re-run the workflow to fire it; remove the label to skip. Background: the job intermittently hung (~1h for what should be 1m20s), so routine PRs land on typecheck + unit + build only. Use `gh pr edit <N> --add-label run-e2e` before merging anything user-facing where regressions would be hard to catch otherwise.
- **Local `pnpm dev:web` port 3002 may collide** with the user's CultureDNA dev server (Vite + React Router 7). When visual inspection is needed and 3002 is taken, fall back to E2E for regression detection or coordinate the port collision before starting dev.

### Recently consolidated (2026-05-28 sweep) — Don't try to redo

- **Shared posting helpers** moved to [`packages/domain/src/evidence-defaults.ts`](packages/domain/src/evidence-defaults.ts): `buildExtractedFields`, `guessSupplier`, `guessAccountingMethod`, `initialLedgerLines`. Both `MemoryLedgerStore` and `PostgresLedgerStore` now import from there. `buildPostingLines` is also imported from `@jpx-accounting/domain` by both stores.
- **`LedgerLine` type** is exported from [`packages/domain/src/projections.ts`](packages/domain/src/projections.ts) (previously local).
- **`BlobUploader.mintReadSas(blobPath)`** added to [`services/api/src/blob.ts`](services/api/src/blob.ts) (both Stub + Azure). `/api/evidence/:id/extract` now mints a real User-Delegation SAS instead of the `https://placeholder/${blobPath}` URL. Extraction persistence landed with pivot Phase 3: `LedgerStore.updateEvidenceExtraction()` (`packages/domain/src/store.ts`) appends an `ExtractionRefreshed` event and regenerates suggestions in both stores.
- **PWA manifest share_target** is POST + multipart with file accept; [`apps/web/app/share/route.ts`](apps/web/app/share/route.ts) is the intake handler that redirects to `/capture?…`. The old `/share/page.tsx` is deleted.
- **Bicep + deploy.yml** now wire `SUPABASE_DB_URL`, `AZURE_OPENAI_*`, and `AZURE_DOCUMENT_INTELLIGENCE_*` secrets through to the API App Service env. Unused Supabase REST keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) removed since `@supabase/supabase-js` is not on the write path.

### Migrations

SQL migrations live in `infra/supabase/migrations/000N_*.sql` and are applied in numeric order. Current: `0001_init.sql`, `0002_schema_alignment.sql`, `0003_pgvector.sql`, `0004_compliance_and_settings.sql`, `0005_events_id_text.sql` (events.id uuid→text to match `createId('evt')` inserts + `clock_timestamp()` created_at for in-transaction ordering), `0006_chain_serialization.sql` (`seq` identity tiebreak column + `UNIQUE (org, workspace, previous_hash)` fork constraint under the advisory lock), `0007_knowledge_tenant_pk.sql` (knowledge.documents PK rescoped to `(organization_id, workspace_id, id)` — stops cross-tenant upsert clobbering), `0008_evidence_dedupe_index.sql` (btree lookup index for idempotent evidence content-dedupe). New migrations get the next number. They must be idempotent (`if not exists` / `if exists`, CHECK constraints added via `DO $$ ... exception when duplicate_object then null; end $$;` blocks) — the same file may be replayed on partial environments.

`0004` uses `NULLS NOT DISTINCT` on its unique index, which requires Postgres 15+. Supabase ships PG 17 by default, so this is safe in normal mode; self-hosted Postgres deployments need to verify.

### Deploy

Production deploy runs through `.github/workflows/deploy.yml`: web is a Docker image (Next.js standalone), API is bundled with `esbuild` into `server.cjs` (CJS output) and zip-deployed (`WEBSITE_RUN_FROM_PACKAGE=1`). Bicep in `infra/azure/main.bicep` provisions both App Services on the existing `jpx-app-plan` and grants the API's Managed Identity the `Storage Blob Delegator` + `Storage Blob Data Contributor` RBAC roles required for User-Delegation SAS minting.

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

- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`: Required for normal-mode chat + embeddings (both ai-core and the AI SDK advisor path read these).
- `ADVISOR_TOOL_APPROVAL_SECRET`: HMAC secret signing AI SDK tool-approval requests on `/api/advisor/chat`. A demo default is baked into `services/api/src/config.ts` so offline runs work — **production must set this**.
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`: Required for live OCR via `@azure-rest/ai-document-intelligence`. Without them the adapter returns the stub.

**Storage (Phase B)**

- `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`: Required for User-Delegation SAS minting in `/api/uploads/init`. Bicep also needs `Storage Blob Delegator` + `Storage Blob Data Contributor` role assignments on the API's Managed Identity.

**Auth + hardening**

- `SUPABASE_JWKS_URL`: **REQUIRED in normal mode** (fail-closed — the API refuses to boot without it); optional in demo. When set (e.g. `${SUPABASE_URL}/auth/v1/keys`), ALL `/api/*` routes and methods require a JWT verifiable against this JWKS endpoint (`GET /api/runtime-info` exempt). Accepted algorithms default to `RS256` + `ES256`, overridable via comma-separated `SUPABASE_JWT_ALGS` (see `services/api/src/config.ts`).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Web **build-time** pair enabling the Supabase Auth UI (`/login`, bearer threading). Both unset = auth-free demo experience (auth affordances hide themselves). The URL's origin is added to the web CSP `connect-src`.
- `NEXT_PUBLIC_AZURE_STORAGE_ORIGIN`: Web **build-time** CSP allowance for direct-to-Azure SAS traffic (browser PUTs, read-SAS previews). Unset keeps the strict same-origin CSP.
- `ADVISOR_MAX_OUTPUT_TOKENS`, `ADVISOR_STREAM_TIMEOUT_MS`: Advisor cost envelope on `/api/advisor/chat` (defaults 2048 tokens / 90 s — `services/api/src/advisor/chat.ts`).
- `APPLICATIONINSIGHTS_CONNECTION_STRING`: API telemetry (Bicep injects it in deploys); unset = `services/api/src/telemetry.ts` is a strict no-op (no SDK load).

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for trust boundaries, the env matrix, and build/deploy subtleties.

**Conventions / anti-patterns:** see [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for 29 rules distilled from past incidents — schema-contract sync, partial-index pitfalls, store parity between `MemoryLedgerStore` and `PostgresLedgerStore`, citation provenance, audit attribution sentinels, bounded accumulation. Consult before changes that touch contracts, migrations, or `LedgerStore` implementations.

**Development status / port progress:** see [docs/DEV_STATUS.md](docs/DEV_STATUS.md) for the advisory-pivot phase status (Phases 0–5 COMPLETE, landed on main via PR #30, each with its documented limitations), the 2026-05-27 deploy→main port history, and the remaining UI follow-ups.

**Session handovers:**

- [docs/superpowers/2026-05-27-deploy-to-main-port-session-handover.md](docs/superpowers/2026-05-27-deploy-to-main-port-session-handover.md) — first half of the `deploy → main` port (PRs A/B/C + PR-D1 shadcn foundation): what was done, what was learned, what's open.
- [docs/superpowers/2026-05-27-deploy-cleanup-junior-dev-handover.md](docs/superpowers/2026-05-27-deploy-cleanup-junior-dev-handover.md) — second half plan (PRs F/E1/G/D2/D3/H) drafted as a junior-dev handover with embedded library research. All 6 PRs subsequently executed (F as no-op).
