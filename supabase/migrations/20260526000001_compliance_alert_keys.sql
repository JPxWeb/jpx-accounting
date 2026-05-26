-- Adds the columns + unique index needed for idempotent compliance-alert upserts.
-- `kind` defaults to 'legacy' so existing rows backfill cleanly.

alter table ledger.compliance_alerts add column if not exists kind text not null default 'legacy';
alter table ledger.compliance_alerts add column if not exists target_id text;

-- Partial unique index: rows with target_id form a per-(org, workspace, kind, target) singleton.
-- Rows without target_id (e.g. seeded informational alerts) are not deduplicated.
create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  where target_id is not null;
