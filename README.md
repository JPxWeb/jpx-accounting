# JPX Accounting

Mobile-first, AI-native Swedish accounting platform scaffold.

## Included

- `apps/web`: Next.js 16 mobile-first PWA shell
- `services/api`: Hono API with typed contracts
- `packages/contracts`: shared schemas and DTOs
- `packages/domain`: append-only ledger model, rules, projections, and the `LedgerStore` contract
- `packages/ai-core`: Azure Responses-first AI abstraction with explicit demo-vs-normal behavior
- `packages/reporting`: report helpers
- `packages/ui-tokens`: shared design tokens and glass theme variables
- `infra`: Azure and Supabase scaffolding

## Commands

- `pnpm install`
- `pnpm dev:web`
- `pnpm dev:api`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`

## Notes

- Runtime mode is explicit:
  - `demo` keeps the in-memory store and local AI fallback available on purpose.
  - `normal` uses the real API path and fails closed when non-demo runtime dependencies are missing.
- The API currently ships a demo in-memory store plus a Supabase migration scaffold; normal mode stays unavailable until a non-demo `LedgerStore` is configured.
- All ledger mutations are append-only in the domain layer.
- The web shell uses clear unavailable states instead of silent synthetic fallbacks in normal mode.
