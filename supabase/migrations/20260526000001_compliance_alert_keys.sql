-- Compliance alerts: schema alignment for the v1 detection rules.
--
-- 1. Add `kind` (rule identifier) and `target_id` (the voucher/review the alert
--    points at) for idempotent upserts.
-- 2. Add `severity` and `body` columns that the contract now persists.
-- 3. CHECK constraints are added as SEPARATE statements rather than inline on
--    ADD COLUMN, because `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ... CHECK
--    (...)` suppresses the entire clause (column + default + CHECK) when the
--    column already exists from a prior partial run (CONVENTIONS Rule 18).
--    Splitting ensures the CHECK lands even if the column was added previously.
-- 4. Unique index uses NULLS NOT DISTINCT so future detectors that emit alerts
--    with `target_id = NULL` are still deduplicated by (org, workspace, kind)
--    (CONVENTIONS Rule 18). Without this, every refresh would insert a fresh
--    duplicate null-target row.

alter table ledger.compliance_alerts add column if not exists kind text not null default 'legacy';
alter table ledger.compliance_alerts add column if not exists target_id text;
alter table ledger.compliance_alerts add column if not exists severity text not null default 'info';
alter table ledger.compliance_alerts add column if not exists body text;

-- Severity CHECK as a separate statement so re-applying this migration on a
-- DB where `severity` was added by a prior partial run still attaches the
-- constraint. Wrapped to ignore duplicate-object so the migration is idempotent.
do $$ begin
  alter table ledger.compliance_alerts
    add constraint ledger_alerts_severity_check
    check (severity in ('info', 'warning', 'critical'));
exception when duplicate_object then null;
end $$;

create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  nulls not distinct;
