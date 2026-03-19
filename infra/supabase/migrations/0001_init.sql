create schema if not exists ledger;
create schema if not exists projections;

create extension if not exists pgcrypto;
create extension if not exists pgaudit;

create table if not exists ledger.events (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  workspace_id text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  actor_id text not null,
  occurred_at timestamptz not null default now(),
  payload jsonb not null,
  previous_hash text not null,
  event_hash text not null,
  digest_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_events_aggregate_idx
  on ledger.events (aggregate_type, aggregate_id, occurred_at desc);

create index if not exists ledger_events_org_workspace_idx
  on ledger.events (organization_id, workspace_id, occurred_at desc);

create table if not exists ledger.evidence_objects (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  title text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  original_filename text not null,
  mime_type text not null,
  blob_path text not null,
  hash text not null,
  trust_level text not null default 'user-upload',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists ledger.evidence_packets (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  note text,
  voice_transcript text,
  created_at timestamptz not null default now()
);

create table if not exists ledger.evidence_packet_items (
  evidence_packet_id text not null references ledger.evidence_packets(id) on delete cascade,
  evidence_object_id text not null references ledger.evidence_objects(id) on delete cascade,
  primary key (evidence_packet_id, evidence_object_id)
);

create table if not exists ledger.vouchers (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  evidence_packet_id text not null references ledger.evidence_packets(id),
  voucher_number text not null,
  accounting_method text not null,
  status text not null,
  voucher_fields jsonb not null,
  extracted_fields jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ledger_vouchers_number_idx
  on ledger.vouchers (organization_id, workspace_id, voucher_number);

create table if not exists ledger.review_tasks (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  voucher_id text not null references ledger.vouchers(id),
  status text not null,
  blocked_reason text,
  suggested_action text not null,
  suggestion jsonb,
  provenance_timeline jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists projections.journal_entries (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  voucher_id text not null,
  account_number text not null,
  account_name text not null,
  description text not null,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  booked_at timestamptz not null
);

create table if not exists projections.account_balances (
  organization_id text not null,
  workspace_id text not null,
  account_number text not null,
  account_name text not null,
  debit numeric(18,2) not null default 0,
  credit numeric(18,2) not null default 0,
  balance numeric(18,2) not null default 0,
  primary key (organization_id, workspace_id, account_number)
);

create table if not exists projections.vat_summary (
  organization_id text not null,
  workspace_id text not null,
  vat_code text not null,
  base_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  deductible boolean not null default false,
  primary key (organization_id, workspace_id, vat_code)
);

comment on table ledger.events is 'Append-only legal source of truth for all bookkeeping and review mutations.';
comment on table projections.journal_entries is 'Derived read model rebuilt from ledger.events.';

