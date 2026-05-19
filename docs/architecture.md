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

- **Demo:** `MemoryLedgerStore` — full in-memory event sourcing with seeded sample data.
- **Normal (configured):** `SupabaseLedgerStore` — append-only writes to `ledger.*` tables; read paths and review decisions are still being implemented (see `packages/domain/src/supabase-store.ts` TODOs).
- **Normal (unconfigured):** `UnavailableLedgerStore` — fails closed; no synthetic data.
- Org/workspace context is currently fixed in API runtime wiring; JWT-derived tenancy is planned in the auth-and-database track.
- Later immutable blob storage migration should occur behind the `LedgerStore` abstraction, not by rewriting product logic.
- Share-target capture remains scaffold-only until upload wiring lands and is called out explicitly in the UI.

## Web information architecture

Five-tab shell: **Today** (review queue), **Capture**, **Books**, **Reports**, **Settings**. Legacy routes redirect via `apps/web/proxy.ts` (`/` → `/today`). Implementation progress is tracked in [DEV_STATUS.md](./DEV_STATUS.md).
