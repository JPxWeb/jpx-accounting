# JPX Accounting

AI advisory accounting for European small businesses, built Sweden-first: BAS chart of accounts, moms (VAT), and Bokföringslagen are first-class, not localizations. The AI advises, cites its sources, and drafts proposals (labeled per EU AI Act, Article 50) — it never posts. Every posting is human-approved through the review queue onto an append-only, hash-chained ledger. Ships as a mobile-first PWA.

## Included

- `apps/web`: Next.js 16 mobile-first PWA shell
- `services/api`: Hono API with typed contracts
- `packages/contracts`: shared schemas and DTOs (Zod v4)
- `packages/domain`: append-only ledger model, rules, projections, and the `LedgerStore` contract
- `packages/ai-core`: Azure Responses-first AI abstraction with explicit demo-vs-normal behavior
- `packages/api-client`: `fetch`-based client; validates responses with Zod when a `baseUrl` is configured
- `packages/reporting`: report helpers
- `packages/ui-tokens`: shared design tokens and glass theme variables
- `infra`: Azure and Supabase scaffolding

## Prerequisites

- **Node 24** (matches `engines` + CI — use `.node-version`, nvm/Volta/asdf)
- **pnpm 10** (`corepack enable` → `pnpm` uses `packageManager` from `package.json`)

## Commands

Install once:

```bash
pnpm install
```

Run locally (two servers; one terminal each or use the shortcut):

```bash
pnpm dev                 # parallel: Next + API per package scripts
pnpm dev:web             # Next dev (default URL http://localhost:3002)
pnpm dev:api             # API (default http://localhost:3001)
```

Ports: web **3002** is pinned in [`apps/web/package.json`](apps/web/package.json); API uses **`PORT`** (default `3001`). Set **`ACCOUNTING_API_BASE_URL`** on the Next server to point at your API base (see `.env.example`). If **`pnpm dev`** fails with **`EADDRINUSE`**, only one dev stack should own those ports — stop the conflicting process or override **`PORT`** / the web dev port (see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)).

Quality / CI-aligned checks:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit            # discovers tests/unit/**/*.test.ts
pnpm build
pnpm check                # lint + format:check + typecheck + unit tests + build (not E2E)
```

E2E (builds production web + starts test servers):

```bash
pnpm test:e2e:install      # Chromium for Playwright
pnpm test:e2e
```

Deeper workflows: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Notes

- Runtime mode is explicit:
  - `demo` keeps the in-memory store and local AI fallback available on purpose (open API CORS).
  - `normal` fails closed without non-demo LedgerStore/Azure configuration; **`ACCOUNTING_CORS_ORIGINS`** lists comma-separated origins when browsers call `/api/*` directly.
- Operators: **`GET /health`** (liveness) vs **`GET /ready`** (readiness with ledger/AI checks) on the API; JSON errors surface **`requestId`** and typed validation **`issues`** when relevant — see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
- Demo `/mcp` on the API is **scaffold-only** (not MCP protocol); gated to `demo` mode.
- The API currently ships a demo in-memory store plus a Supabase migration scaffold.
- All ledger mutations are append-only in the domain layer.
