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
pnpm typecheck                # TypeScript check across all packages
pnpm build                    # Build web + API (`services/api` is typecheck-only; deploy bundles API with esbuild)
pnpm check                    # lint + format:check + typecheck + unit tests + build

# Testing
pnpm test:unit                # Unit tests: tsx --test 'tests/unit/**/*.test.ts'
pnpm test:e2e                 # Playwright E2E (builds first, starts both servers)
pnpm test:e2e:headed          # E2E with visible browser
pnpm test:e2e:install          # Install Chromium for Playwright

# Run a single E2E test
pnpm build && npx playwright test tests/e2e/home.spec.ts

# Run a single unit test
tsx --test tests/unit/some-file.test.ts
```

## Architecture

pnpm monorepo (Node >=24, pnpm 10.29.2) — mobile-first Swedish accounting PWA with AI assistance.

### Workspace layout

- **apps/web** — Next.js 16 PWA (React 19, TailwindCSS 4, React Query 5, Motion 12). Swedish locale throughout.
- **services/api** — Hono HTTP server (port 3001). Routes in `src/app.ts`, runtime wiring in `src/runtime.ts`. **`GET /health`** = liveness; **`GET /ready`** = readiness (`ledger` + `ai` checks). JSON errors carry **`requestId`**; **`400`** validation responses use **`issues`** (+ **`code: "validation_error"`**).
- **packages/contracts** — Zod v4 schemas: the single source of truth for all API shapes and domain types.
- **packages/domain** — Core accounting logic: `LedgerStore` interface, append-only event sourcing, BAS accounts, Swedish rules, projections.
- **packages/ai-core** — Provider-agnostic AI abstraction. Factory selects `LocalAiRuntime` (demo), `ResponsesAiRuntime` (Azure OpenAI), or `UnavailableAiRuntime` based on runtime mode + config.
- **packages/api-client** — TypeScript client with demo-mode fallback to in-memory store.
- **packages/reporting** — Report summarization helpers (journal, balances, VAT).
- **packages/ui-tokens** — Design tokens (colors, fonts, formatters). Theme: Manrope + IBM Plex Mono, teal accent.

### Key design rules

- **Append-only events** are the source of truth; never overwrite evidence or ledger history.
- **AI suggests, never mutates** — AI outputs require human review before affecting ledger state.
- **Runtime mode is explicit**: `demo` uses scaffold fallbacks (MemoryLedgerStore, LocalAiRuntime); `normal` fails closed if config is missing.
- **Projections are derived** — journal, balances, VAT reports are calculated from events via `packages/domain/src/projections.ts`.
- **Swedish compliance first** — BAS chart of accounts, Bokföringslagen citations, VAT deductibility rules.

### Web app routing

The web app uses Next.js App Router with a `(shell)` route group for the main tab-based layout. API calls proxy through `app/api-proxy/[...path]/route.ts` to the Hono API.

`apps/web/next.config.ts` sets baseline security **`headers()`** (CSP is stricter in production than in dev because of `unsafe-eval` / websocket needs). **`output: "standalone"`** targets container deploys; prefer the standalone `server.js` entry when running production images, not `next start`.

### E2E test setup

Playwright runs sequentially (1 worker) against dedicated test servers: API on port 3201 (demo mode, test reset enabled), web on port 3200. Both desktop and mobile (Pixel 7) projects. Tests must `pnpm build` first since the web server uses `next start`.

## Environment

Key env vars (see `.env.example` for full list):

- `ACCOUNTING_RUNTIME_MODE`: `demo` | `normal` (default: demo)
- `ACCOUNTING_CORS_ORIGINS`: comma-separated browser origins permitted for `/api/*` in **`normal`** (ignored for `demo` open CORS)
- `ACCOUNTING_API_BASE_URL`: Internal API URL for server-side proxy (e.g., http://localhost:3001)
- `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`: Must match API's runtime mode
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`: Required for normal mode AI

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for trust boundaries and build/deploy subtleties.
