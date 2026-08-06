# Local PostgreSQL (dev + integration tests)

Compose-first workflow for a reproducible PostgreSQL 17 + pgvector environment.
The canonical orchestrator is [`scripts/db.mts`](db.mts) (`pnpm db:*` scripts).
Manual `docker run` recipes below are legacy fallbacks only.

## Requirements

- Docker + Compose v2 plugin
- Image (pinned in [`compose.db.yml`](../compose.db.yml)): `pgvector/pgvector:0.8.5-pg17-bookworm`
- PostgreSQL **15–17** (17 is the local/primary target); `0004`'s `NULLS NOT DISTINCT` needs ≥15
- `pgaudit` is **not** required — migration `0001_init.sql` skips it with a NOTICE on vanilla images

## Operating modes

| Mode                           | Command / env                                                                                                   | Database                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Demo / UI                      | no Docker                                                                                                       | `MemoryLedgerStore` (no Postgres)   |
| Local database development     | `pnpm db:up` → `db:migrate` → `db:seed`                                                                         | stable tool-managed `jpx_dev`       |
| Strict verification            | `pnpm db:test`                                                                                                  | throwaway `jpx_test_<uuid>` per run |
| External provider verification | `DATABASE_TEST_URL=…` (name **must** be `jpx_test_*`) + `JPX_REQUIRE_DATABASE_TESTS=true pnpm test:integration` | never CREATE/DROP via `db:test`     |

Canonical connection env var: **`DATABASE_URL`**. Legacy `SUPABASE_DB_URL` remains an alias during the migration window (see `.env.example`). Integration tests also accept `DATABASE_TEST_URL` (highest precedence).

## Preferred: Compose lifecycle

From the repo root (Windows: prepend `$env:LOCALAPPDATA\corepack-shims` to `PATH` before `pnpm`):

```bash
pnpm db:doctor    # Docker/Compose availability, project name, port, capabilities
pnpm db:up        # start/reuse this clone's isolated Postgres (dynamic host port)
pnpm db:url       # print the jpx_dev URL (capture for DATABASE_URL)
pnpm db:migrate   # apply infra/supabase/migrations 0001–0008 via scripts/db-migrations.mts
pnpm db:seed      # idempotent v1 seed through PostgresLedgerStore (org_jpx / workspace_main)
pnpm db:test      # create jpx_test_*, migrate, JPX_REQUIRE_DATABASE_TESTS=true, drop in finally
pnpm db:down      # stop containers (named volume preserved)
pnpm db:reset     # down -v, up again (then migrate + seed as needed)
```

`JPX_DB_INSTANCE` isolates concurrent agents/worktrees against the same clone
(distinct Compose project, port, and volume).

### Migration CLI (direct)

```bash
tsx scripts/db-migrations.mts status  --database-url <url>
tsx scripts/db-migrations.mts migrate --database-url <url>
tsx scripts/db-migrations.mts verify  --database-url <url>
tsx scripts/db-migrations.mts replay  --database-url <url>
```

### Seed CLI (direct)

```bash
tsx scripts/db-seed.mts seed --database-url <url>
```

Re-running the same seed version is a no-op (`jpx_meta.seed_versions`).

## Strict integration tests

`pnpm db:test` is the one-command gate. It:

1. Starts/reuses this instance's Compose server
2. Creates `jpx_test_<uuid>`
3. Migrates that database
4. Pins `DATABASE_TEST_URL`, `DATABASE_URL`, and `SUPABASE_DB_URL` to that throwaway URL and sets `JPX_REQUIRE_DATABASE_TESTS=true` (so an ambient `DATABASE_TEST_URL` cannot redirect the gate)
5. Runs `pnpm test:integration`
6. Drops only that test database in `finally`

Ordinary `pnpm test:integration` (without the require flag) **skips** Postgres cases when no URL is set. When a URL **is** set, the database name must start with `jpx_test_`. With `JPX_REQUIRE_DATABASE_TESTS=true`, a missing or unreachable database **throws** (no silent skip).

URL precedence inside the suite: `DATABASE_TEST_URL` → `DATABASE_URL` → `SUPABASE_DB_URL`.

## Docker unavailable

Do **not** use `pnpm db:test` without Docker — it always starts Compose. Instead, set
`DATABASE_TEST_URL` to an already-provisioned disposable database named `jpx_test_*`
(migrations applied), then run:

```bash
JPX_REQUIRE_DATABASE_TESTS=true pnpm test:integration
```

Without Docker **and** without that URL, the DB gate must fail explicitly — do not claim
full verification from Memory-only runs.

## Legacy manual container (fallback only)

Prefer `pnpm db:up`. If you must stand up a one-off container by hand:

```bash
docker run -d --name jpx-itest-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 54329:5432 \
  pgvector/pgvector:0.8.5-pg17-bookworm
```

Wait for readiness (the image restarts once during init), create a `jpx_test_*`
database, then:

```bash
tsx scripts/db-migrations.mts migrate --database-url postgres://postgres:postgres@127.0.0.1:54329/jpx_test_manual
DATABASE_TEST_URL=postgres://postgres:postgres@127.0.0.1:54329/jpx_test_manual \
  JPX_REQUIRE_DATABASE_TESTS=true \
  corepack pnpm test:integration
```

## Schema gotchas this setup exists to catch

- `ledger.events.id` was `uuid` until `0005_events_id_text.sql`; the store
  inserts `createId('evt')` text ids, so every event insert failed with
  22P02. Unit tests (MemoryLedgerStore) cannot catch this class of bug —
  see CONVENTIONS Rules 1/2.
- `ledger.events.created_at` defaults to `clock_timestamp()` (not `now()`)
  since 0005: `now()` is frozen per transaction, which made same-transaction
  event-batch ordering and the hash-chain tail pick nondeterministic.
- Hash-chain serialization is advisory-lock + constraint based since 0006
  (WS-B R15). `SELECT … FOR UPDATE` on the tail row was dropped: a blocked
  waiter resumed with its original snapshot and chained onto a STALE tail.
  Every chain-appending store transaction now takes
  `pg_advisory_xact_lock(hashtextextended(org/ws, 0))` BEFORE reading the
  tail; `UNIQUE (organization_id, workspace_id, previous_hash)` makes any
  fork a retryable 23505.
- `knowledge.documents` is tenant-scoped since `0007_knowledge_tenant_pk.sql`:
  the PK is `(organization_id, workspace_id, id)`.
- `0008_evidence_dedupe_index.sql` adds the btree backing idempotent
  evidence content-dedupe.
