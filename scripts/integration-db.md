# Integration-test Postgres (local + CI)

How to stand up a throwaway Postgres for `pnpm test:integration` — the exact
commands used to prove migrations 0001–0007 against a real database. The
suite skips silently when `SUPABASE_DB_URL` is unset, so running it without
this setup proves nothing.

## Requirements

- Image: `pgvector/pgvector:pg17` — vanilla Postgres 17 plus the `vector`
  extension that migration `0003_pgvector.sql` requires (`halfvec` + HNSW).
  Plain `postgres:17` will NOT work (no pgvector). PG >= 15 is also required
  by `0004`'s `NULLS NOT DISTINCT` unique index.
- `pgaudit` is NOT in this image; migration `0001_init.sql` skips it with a
  NOTICE (`DO` block with a narrow exception catch — CONVENTIONS Rules 9/19).
  Expect `NOTICE: pgaudit not available on this server, skipping` — that is
  success, not failure.

## 1. Start the container

```bash
docker run -d --name jpx-itest-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 54329:5432 \
  pgvector/pgvector:pg17
```

Port 54329 avoids colliding with any local Postgres/Supabase on 5432/54322.

## 2. Wait for readiness

The official image restarts the server once after init, so check the log
marker as well as `pg_isready` (a bare `pg_isready` can report ready during
the pre-restart init window):

```bash
until docker exec jpx-itest-pg pg_isready -h localhost -U postgres -d postgres >/dev/null 2>&1 \
  && [ "$(docker logs jpx-itest-pg 2>&1 | grep -c 'database system is ready to accept connections')" -ge 2 ]; do
  sleep 1
done
```

In a GitHub Actions **service container**, use the equivalent health options
instead: `--health-cmd="pg_isready -U postgres" --health-interval=2s
--health-timeout=5s --health-retries=15`.

## 3. Apply migrations 0001 → 0007 in order

From the repo root (POSIX shell; `< file` works from PowerShell via
`Get-Content file | docker exec -i ...` too):

```bash
for f in infra/supabase/migrations/000*.sql; do
  echo "applying $f"
  docker exec -i jpx-itest-pg psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f"
done
```

`ON_ERROR_STOP=1` matters: without it psql exits 0 on SQL errors and a broken
schema goes undetected until the tests fail confusingly. Migrations are
idempotent — replaying all seven on an already-provisioned database is safe
(re-verified whenever a migration changes). One deliberate exception: if
`0006`'s `ADD CONSTRAINT ledger_events_chain_fork_key` fails with a 23505
unique violation, the database already contains a forked hash chain — that is
a real integrity incident the migration surfaces on purpose, not a replay
artifact (see the header comment in `0006_chain_serialization.sql`).

## 4. Run the suite

```bash
SUPABASE_DB_URL=postgres://postgres:postgres@localhost:54329/postgres corepack pnpm test:integration
```

PowerShell:

```powershell
$env:SUPABASE_DB_URL = "postgres://postgres:postgres@localhost:54329/postgres"; corepack pnpm test:integration
```

Expected: all tests pass, none skipped (34 as of migration 0007). Tests
namespace their rows per run (`org_test_*`) and clean up in `finally`, so
re-runs against the same container are deterministic.

## 5. Teardown (optional)

```bash
docker rm -f jpx-itest-pg
```

Leave the container running between local iterations — re-applying migrations
is cheap and step 3 is replay-safe.

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
  waiter resumed with its original snapshot and chained onto a STALE tail
  (EvalPlanQual rechecks the locked row, it does not re-run the query), and
  at GENESIS there was no row to lock at all. Every chain-appending store
  transaction now takes `pg_advisory_xact_lock(hashtextextended(org/ws, 0))`
  BEFORE reading the tail, `ledger.events` carries
  `seq bigint generated always as identity` (the final ORDER BY tiebreak —
  `occurred_at`/`created_at` are wall-clock and tie inside multi-row
  inserts), and `UNIQUE (organization_id, workspace_id, previous_hash)`
  (`ledger_events_chain_fork_key`) makes any fork a retryable 23505. The
  store retries a fork ONCE internally, then surfaces a typed
  `HashChainForkError` that presents the PostgresError structural face
  (`name`/`code`) so services/api's existing 23505 → 409 mapping applies.
  The R15 tests in `tests/integration/postgres-ledger.test.ts` prove chain
  linearity under two genuinely concurrent connections; only a real DB can
  exercise any of this (Rules 1/2).
- `knowledge.documents` is tenant-scoped since `0007_knowledge_tenant_pk.sql`:
  the PK is `(organization_id, workspace_id, id)` and the ingest upsert's
  `ON CONFLICT` targets the composite key — the old global `(id)` PK let one
  workspace's re-ingest silently steal another tenant's rows.
