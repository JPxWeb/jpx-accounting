# JPX Accounting

Mobile-first, AI-native Swedish accounting platform scaffold.

## Included

- `apps/web`: Next.js 16 mobile-first PWA shell
- `services/api`: Hono API with typed contracts
- `packages/contracts`: shared schemas and DTOs
- `packages/domain`: append-only ledger model, rules, projections, demo store
- `packages/ai-core`: Azure Responses-first AI abstraction with local fallback
- `packages/reporting`: report helpers
- `packages/ui-tokens`: shared design tokens and glass theme variables
- `infra`: Azure and Supabase scaffolding

## Commands

- `pnpm install`
- `pnpm dev:web`
- `pnpm dev:api`
- `pnpm typecheck`
- `pnpm build`

## Notes

- The API currently uses an in-memory development store plus a Supabase migration scaffold.
- All ledger mutations are append-only in the domain layer.
- Azure/OpenAI integrations are wrapped so local development works without cloud credentials.
