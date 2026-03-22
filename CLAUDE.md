# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm install                  # Install all workspace dependencies
pnpm dev:web                  # Start Next.js dev server
pnpm dev:api                  # Start Hono API with tsx watch
pnpm typecheck                # TypeScript check across all packages
pnpm build                    # Build web + API
pnpm check                    # Typecheck + build

# Testing
pnpm test:unit                # Unit tests: tsx --test tests/unit/*.test.ts
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
- **services/api** — Hono HTTP server (port 3001). Routes in `src/app.ts`, runtime wiring in `src/runtime.ts`.
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

### E2E test setup

Playwright runs sequentially (1 worker) against dedicated test servers: API on port 3201 (demo mode, test reset enabled), web on port 3200. Both desktop and mobile (Pixel 7) projects. Tests must `pnpm build` first since the web server uses `next start`.

## Environment

Key env vars (see `.env.example` for full list):
- `ACCOUNTING_RUNTIME_MODE`: `demo` | `normal` (default: demo)
- `ACCOUNTING_API_BASE_URL`: Internal API URL for server-side proxy (e.g., http://localhost:3001)
- `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE`: Must match API's runtime mode
- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`: Required for normal mode AI
