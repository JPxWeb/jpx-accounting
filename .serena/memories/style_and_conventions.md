# Code Style and Conventions

## Language & Types
- TypeScript throughout, strict mode
- Zod v4 for schema validation (packages/contracts is single source of truth)
- No explicit return types needed where inference is clear

## Naming
- camelCase for variables, functions, methods
- PascalCase for types, interfaces, classes, React components
- kebab-case for file names
- Swedish locale for UI strings and formatting

## Architecture Patterns
- Event sourcing: append-only events, never overwrite history
- Projections derived from events (never stored as source of truth)
- LedgerStore interface for storage abstraction
- Runtime mode pattern: demo (in-memory) vs normal (real services)
- AI abstraction: factory pattern selecting runtime based on mode

## React / Frontend
- Next.js App Router with `(shell)` route group for tab layout
- API calls proxy through `app/api-proxy/[...path]/route.ts`
- React Query for server state
- TailwindCSS 4 for styling
- Mobile-first responsive design

## Testing
- Unit tests use Node built-in test runner (tsx --test)
- E2E uses Playwright with 1 worker, dedicated test ports (API: 3201, web: 3200)
- E2E requires `pnpm build` first (uses `next start`)
