-- Compliance alerts: schema alignment for the v1 detection rules.
--
-- 1. Add `kind` (rule identifier) and `target_id` (the voucher/review the alert
--    points at) for idempotent upserts.
-- 2. Add `severity` and `body` columns that the contract now persists.
-- 3. Widen the `status` CHECK to include the values the schema_v2 table already
--    permitted on insert ('acknowledged', 'dismissed') but that the contract
--    now enumerates explicitly.
-- 4. Create a FULL (not partial) unique index on (org, workspace, kind, target_id).
--    PostgreSQL's default NULLS DISTINCT means rows with target_id=NULL still
--    don't collide, so the partial WHERE predicate is unnecessary — and
--    partial indices cannot be used as ON CONFLICT targets via PostgREST.

alter table ledger.compliance_alerts add column if not exists kind text not null default 'legacy';
alter table ledger.compliance_alerts add column if not exists target_id text;
alter table ledger.compliance_alerts add column if not exists severity text not null default 'info'
  check (severity in ('info', 'warning', 'critical'));
alter table ledger.compliance_alerts add column if not exists body text;

-- The original schema_v2 CHECK was already
--   ('open','acknowledged','resolved','dismissed')
-- so no DB action is needed; the contract now mirrors it.

create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id);
