# Architecture Overview

## Runtime shape

- `apps/web` is the mobile-first PWA shell.
- `services/api` is the typed Hono application layer.
- `packages/domain` owns append-only bookkeeping behavior, rules, projections, and dev-store behavior.
- `packages/contracts` owns API shapes and shared view models.
- `packages/ai-core` hides provider-specific AI wiring behind a Responses-first abstraction.

## Design constraints

- Append-only events are the source of truth.
- Evidence is immutable and stored separately from derived artifacts.
- AI explains and suggests, but cannot silently mutate accounting state.
- Projections drive the UI and reports.
- Infrastructure is Sweden-first for accounting and retention posture.

## Migration path

- The current scaffold uses an in-memory development store and a Supabase migration skeleton.
- Production persistence should implement the same domain interface using Postgres append-only writes.
- Later immutable storage migration should occur behind the `LedgerStore` abstraction, not by rewriting product logic.

