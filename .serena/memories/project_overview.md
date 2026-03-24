# JPX Accounting — Project Overview

Mobile-first, AI-native Swedish accounting PWA for a Swedish AB (private limited company).

## Purpose
- Internal bookkeeping system handling ~5-10 receipts/month
- AI-assisted receipt processing with human review before ledger mutations
- Swedish compliance first: BAS chart of accounts, Bokföringslagen, VAT rules

## Tech Stack
- **Monorepo**: pnpm 10.29.2 workspaces, Node >=24
- **Frontend**: Next.js 16, React 19, TailwindCSS 4, React Query 5, Motion 12
- **API**: Hono HTTP server (port 3001)
- **Schemas**: Zod v4 (packages/contracts)
- **AI**: Azure OpenAI Responses API (normal mode), local fallback (demo mode)
- **Language**: TypeScript throughout
- **Testing**: Node built-in test runner (unit), Playwright (E2E)

## Workspace Layout
- `apps/web` — Next.js PWA (Swedish locale)
- `services/api` — Hono API server
- `packages/contracts` — Zod schemas, single source of truth for API shapes
- `packages/domain` — Core accounting: LedgerStore, event sourcing, BAS accounts, projections
- `packages/ai-core` — Provider-agnostic AI abstraction
- `packages/api-client` — TS client with demo-mode fallback
- `packages/reporting` — Report summarization (journal, balances, VAT)
- `packages/ui-tokens` — Design tokens (Manrope + IBM Plex Mono, teal accent)
- `infra/` — Azure and Supabase scaffolding
- `docs/` — Architecture and compliance docs

## Key Design Rules
- Append-only events are source of truth (event sourcing)
- AI suggests, never mutates — human review required
- Runtime mode is explicit: `demo` vs `normal` (fails closed)
- Projections derived from events (journal, balances, VAT)
