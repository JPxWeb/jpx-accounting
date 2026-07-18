-- Align ledger.events.id with what PostgresLedgerStore actually inserts.
--
-- 0001_init.sql created the column as `uuid primary key default gen_random_uuid()`,
-- but PostgresLedgerStore.appendEvent inserts `createId('evt')` ids of the form
-- `evt_<uuid>` (text) — so EVERY event insert failed with 22P02 (invalid input
-- syntax for type uuid). All other tables already use text primary keys.
--
-- References audit (0001–0004): no foreign key points at ledger.events(id) and
-- no secondary index includes the id column (ledger_events_aggregate_idx and
-- ledger_events_org_workspace_idx cover other columns). The primary-key index
-- is rebuilt implicitly by the type change, so nothing else needs migrating.
--
-- Idempotency: DROP DEFAULT is a no-op when no default exists, and
-- `TYPE text USING id::text` succeeds whether the column is still uuid or
-- already text — the file can be replayed on partial environments.
--
-- The default must be dropped BEFORE the type change: gen_random_uuid()
-- returns uuid, which has no implicit cast to text, so ALTER TYPE would fail
-- trying to convert the default expression.

alter table ledger.events alter column id drop default;

alter table ledger.events alter column id type text using id::text;

-- Ordering determinism for same-transaction event batches. createEvidence
-- appends four events in ONE transaction with the SAME app-supplied
-- occurred_at; `now()` is frozen at transaction start, so created_at tied too
-- and both read paths that tiebreak on it — getEvents' ORDER BY
-- (occurred_at, created_at) and lockWorkspaceTail's ORDER BY ... DESC LIMIT 1
-- (the hash-chain tail pick) — became nondeterministic. clock_timestamp()
-- advances per statement (µs resolution), restoring the insertion-order total
-- order the store's reads rely on. Safe to replay; no existing rows are
-- affected (every insert 22P02-failed before the id fix above, so the table
-- is empty on any environment that ran 0001 as shipped).
alter table ledger.events alter column created_at set default clock_timestamp();
