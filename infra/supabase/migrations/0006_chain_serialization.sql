-- 0006_chain_serialization.sql — make hash-chain forks structurally impossible (WS-B R15).
--
-- Problem being fixed (see PostgresLedgerStore.lockWorkspaceTail): the old
-- `SELECT … FOR UPDATE` on the tail row serialized appenders only while the
-- lock was held, but a blocked waiter resumed with its ORIGINAL snapshot —
-- EvalPlanQual rechecks the locked row, it does NOT re-run the query — so the
-- waiter chained onto a STALE tail and silently forked the chain. At GENESIS
-- there is no row to lock at all, so two first-appenders raced freely. The
-- store-side fix is a pg_advisory_xact_lock taken BEFORE the tail read; this
-- migration adds the two structural guarantees underneath it:
--
--   1. `seq bigint generated always as identity` — a monotone, gap-tolerant
--      insertion-order key. (occurred_at, created_at) are both wall-clock
--      (created_at is clock_timestamp() since 0005) and can tie within a
--      multi-row statement (µs resolution) or invert on clock steps; `seq`
--      is the deterministic FINAL tiebreak for every events ORDER BY and the
--      thing that keeps batched inserts (importSie) totally ordered.
--   2. UNIQUE (organization_id, workspace_id, previous_hash) — in a linear
--      chain every hash is the predecessor of exactly one event, and exactly
--      one event per workspace descends from 'GENESIS'. Any fork attempt now
--      dies as a retryable 23505 instead of committing silent corruption.
--
-- Existing-data safety:
--   * Identity backfill: ADD COLUMN … GENERATED ALWAYS AS IDENTITY rewrites
--     the table assigning 1..N in heap-scan order. ledger.events is
--     append-only and never UPDATEd (tamper tests do, but only in throwaway
--     test workspaces), so heap order == insertion order in practice; and
--     `seq` is only ever the FINAL tiebreak after (occurred_at, created_at),
--     which post-0005 already strictly order all real single-row appends.
--   * Uniqueness holds by construction for honestly-appended data: every
--     append chained previous_hash onto the then-current tail's event_hash,
--     and event hashes are collision-resistant (SHA-256 post-R14), so no two
--     events share a predecessor unless a fork already happened. If the
--     ADD CONSTRAINT below fails with 23505/unique_violation, that is a REAL
--     pre-existing fork — the migration aborts loudly on purpose (do not
--     wrap the failure away; investigate the workspace instead). Legacy djb2
--     chains (32-bit hashes) have a small birthday-collision risk on very
--     large workspaces; none exist in current environments (all pre-0005
--     inserts failed with 22P02, so every persisted chain is post-0005).
--
-- Idempotency: ADD COLUMN IF NOT EXISTS replays clean (Rule 18 caveat: it
-- only checks the column NAME — a partial environment that somehow added a
-- non-identity `seq` would no-op; the schema-pin integration test asserts
-- is_identity = 'YES' to catch that drift). The constraint + index adds are
-- wrapped per the 0004 pattern.

alter table ledger.events add column if not exists seq bigint generated always as identity;

-- ORDER BY-stable covering index for the per-workspace insertion-order scans
-- (tail pick, getEvents, collectLedgerLines). Includes organization_id: every
-- store query filters on (organization_id, workspace_id).
create index if not exists ledger_events_org_ws_seq_idx
  on ledger.events (organization_id, workspace_id, seq);

-- Fork guard. Constraint (not a bare index) so the violation surfaces with
-- constraint_name = 'ledger_events_chain_fork_key', which
-- PostgresLedgerStore matches to retry once and then raise its typed
-- retryable error. duplicate_table is included alongside duplicate_object
-- because ADD CONSTRAINT UNIQUE materializes an index and some PG versions
-- report the "already exists" replay as 42P07.
do $$ begin
  alter table ledger.events
    add constraint ledger_events_chain_fork_key
    unique (organization_id, workspace_id, previous_hash);
exception when duplicate_object or duplicate_table then null;
end $$;
