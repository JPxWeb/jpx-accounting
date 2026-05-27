-- Phase 7 schema additions:
--   * ledger.compliance_alerts — auto-detected (stale-blocked, missing-supplier-vat)
--     and user-acknowledged compliance issues, with dedup by (org, ws, kind, target_id).
--   * ledger.assistant_sessions — Q&A history (currently scaffold; real AI advisor later).
--   * ledger.organization_settings — per-org company settings (one row per org).
--
-- Conventions (see docs/CONVENTIONS.md):
--   * Rule 18: separate ADD CONSTRAINT from ADD COLUMN IF NOT EXISTS so CHECKs
--     attach even on partial re-apply.
--   * Rule 18: unique index uses NULLS NOT DISTINCT so future null-target alerts
--     dedup correctly via the same index (requires Postgres >= 15).
--   * Rule 20: resolved_by uses a 'system:auto-resolver' sentinel for automatic
--     resolutions, not the API caller's userId. The column is text; sentinel is
--     stored as a literal value.

create table if not exists ledger.compliance_alerts (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  title           text          not null,
  source          text          not null,
  detected_at     timestamptz   not null default now(),
  impact_summary  text          not null default '',
  kind            text          not null default 'legacy',
  target_id       text,
  severity        text          not null default 'info',
  status          text          not null default 'open',
  body            text,
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz   not null default now()
);

do $$ begin
  alter table ledger.compliance_alerts
    add constraint ledger_alerts_severity_check
    check (severity in ('info', 'warning', 'critical'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table ledger.compliance_alerts
    add constraint ledger_alerts_status_check
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed'));
exception when duplicate_object then null;
end $$;

create unique index if not exists ledger_alerts_dedup_uidx
  on ledger.compliance_alerts (organization_id, workspace_id, kind, target_id)
  nulls not distinct;

create index if not exists ledger_alerts_org_ws_idx
  on ledger.compliance_alerts (organization_id, workspace_id, status, detected_at desc);

create table if not exists ledger.assistant_sessions (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  question        text          not null,
  answer          text          not null,
  status          text          not null default 'grounded',
  citations       jsonb         not null default '[]'::jsonb,
  actor_id        text,
  created_at      timestamptz   not null default now()
);

create index if not exists ledger_assistant_org_ws_idx
  on ledger.assistant_sessions (organization_id, workspace_id, created_at desc);

create table if not exists ledger.organization_settings (
  organization_id text          primary key,
  settings        jsonb         not null,
  updated_at      timestamptz   not null default now(),
  updated_by      text          not null
);
