# Architecture Overview

## Runtime shape

- `apps/web` is the mobile-first PWA shell.
- `services/api` is the typed Hono application layer.
- `packages/domain` owns append-only bookkeeping behavior, rules, projections, and the `LedgerStore` abstraction.
- `packages/contracts` owns API shapes and shared view models.
- `packages/ai-core` hides provider-specific AI wiring behind a Responses-first abstraction.

## Design constraints

- Append-only events are the source of truth.
- Evidence is immutable and stored separately from derived artifacts.
- AI explains and suggests, but cannot silently mutate accounting state.
- Projections drive the UI and reports.
- Infrastructure is Sweden-first for accounting and retention posture.
- Runtime mode is explicit:
  - `demo` intentionally uses scaffold fallbacks such as `MemoryLedgerStore` and the local AI runtime.
  - `normal` does not substitute demo data when store or AI configuration is missing.

## Migration path

- The current scaffold exposes `MemoryLedgerStore` as the demo implementation of `LedgerStore`.
- Production persistence should implement the same interface using Postgres append-only writes.
- Later immutable storage migration should occur behind the `LedgerStore` abstraction, not by rewriting product logic.
- Share-target capture remains scaffold-only until upload wiring lands and is called out explicitly in the UI.
