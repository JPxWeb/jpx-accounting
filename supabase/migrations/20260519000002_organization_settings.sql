create table ledger.organization_settings (
  organization_id text primary key,
  settings        jsonb not null,
  updated_at      timestamptz not null default now(),
  updated_by      text not null
);

alter table ledger.organization_settings enable row level security;

create policy org_isolation on ledger.organization_settings
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));
