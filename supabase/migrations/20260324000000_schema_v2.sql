-- =============================================================================
-- JPX Accounting — Production Schema v2
-- Swedish-compliant, event-sourced, multi-tenant accounting ledger
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Schemas
-- ---------------------------------------------------------------------------
create schema if not exists ledger;
create schema if not exists projections;

-- ---------------------------------------------------------------------------
-- 2. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;       -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 3. Core tables — ledger.*
-- ---------------------------------------------------------------------------

-- 3a. Append-only event store (legal source of truth)
-- Future: range-partition by month on occurred_at when data volume justifies it
create table ledger.events (
  id              uuid          primary key default gen_random_uuid(),
  sequence_number bigint        generated always as identity,
  organization_id text          not null,
  workspace_id    text          not null,
  aggregate_type  text          not null,
  aggregate_id    text          not null,
  event_type      text          not null,
  actor_id        text          not null,
  occurred_at     timestamptz   not null default now(),
  payload         jsonb         not null,
  previous_hash   text          not null,
  event_hash      text          not null,
  digest_date     date          not null,
  created_at      timestamptz   not null default now()
);

comment on table  ledger.events is 'Append-only legal source of truth for all bookkeeping and review mutations.';
comment on column ledger.events.sequence_number is 'Monotonic insert order; useful for cursor-based pagination and replay.';
comment on column ledger.events.previous_hash is 'Hash chain link to prior event (or "GENESIS" for the first).';

-- B-tree indexes for aggregate replay and org-scoped queries
create index ledger_events_aggregate_idx
  on ledger.events (aggregate_type, aggregate_id, occurred_at desc);

create index ledger_events_org_workspace_idx
  on ledger.events (organization_id, workspace_id, occurred_at desc);

create index ledger_events_type_idx
  on ledger.events (event_type, occurred_at desc);

-- BRIN index: tiny footprint for time-range scans on append-only data
create index ledger_events_occurred_brin
  on ledger.events using brin (occurred_at);

-- Enforce append-only: reject UPDATE and DELETE at the database level
create or replace function ledger.enforce_append_only()
  returns trigger language plpgsql as $$
begin
  raise exception 'ledger.events is append-only: % not allowed', TG_OP;
end;
$$;

create trigger events_append_only
  before update or delete on ledger.events
  for each row execute function ledger.enforce_append_only();


-- 3b. Evidence objects (captured documents)
create table ledger.evidence_objects (
  id                text        primary key,
  organization_id   text        not null,
  workspace_id      text        not null,
  title             text        not null,
  modalities        text[]      not null default '{}',
  created_by        text        not null,
  created_at        timestamptz not null default now(),
  original_filename text        not null,
  mime_type         text        not null,
  blob_path         text        not null,
  hash              text        not null,
  trust_level       text        not null default 'user-upload'
    check (trust_level in ('official', 'internal', 'user-upload')),
  metadata          jsonb       not null default '{}'::jsonb
);

create index ledger_evidence_org_ws_idx
  on ledger.evidence_objects (organization_id, workspace_id, created_at desc);

create index ledger_evidence_hash_idx
  on ledger.evidence_objects (hash);


-- 3c. Evidence packets (logical grouping before voucher creation)
create table ledger.evidence_packets (
  id                text        primary key,
  organization_id   text        not null,
  workspace_id      text        not null,
  note              text,
  voice_transcript  text,
  created_at        timestamptz not null default now()
);

create index ledger_packets_org_ws_idx
  on ledger.evidence_packets (organization_id, workspace_id, created_at desc);


-- 3d. Evidence packet ↔ evidence object junction
create table ledger.evidence_packet_items (
  evidence_packet_id text not null references ledger.evidence_packets(id) on delete cascade,
  evidence_object_id text not null references ledger.evidence_objects(id) on delete cascade,
  primary key (evidence_packet_id, evidence_object_id)
);


-- 3e. Vouchers (accounting transactions awaiting approval)
create table ledger.vouchers (
  id                  text        primary key,
  organization_id     text        not null,
  workspace_id        text        not null,
  evidence_packet_id  text        not null references ledger.evidence_packets(id),
  voucher_number      text        not null,
  accounting_method   text        not null
    check (accounting_method in ('invoice', 'cash')),
  status              text        not null
    check (status in ('needs-review', 'approved', 'rejected', 'booked-without-vat')),
  voucher_fields      jsonb       not null,
  extracted_fields    jsonb       not null,
  created_by          text        not null,
  created_at          timestamptz not null default now()
);

create unique index ledger_vouchers_number_idx
  on ledger.vouchers (organization_id, workspace_id, voucher_number);

create index ledger_vouchers_status_idx
  on ledger.vouchers (organization_id, workspace_id, status, created_at desc);

create index ledger_vouchers_packet_idx
  on ledger.vouchers (evidence_packet_id);


-- 3f. Review tasks (approval queue)
create table ledger.review_tasks (
  id                   text        primary key,
  organization_id      text        not null,
  workspace_id         text        not null,
  voucher_id           text        not null references ledger.vouchers(id),
  title                text        not null default '',
  status               text        not null
    check (status in ('needs-review', 'approved', 'rejected', 'booked-without-vat')),
  blocked_reason       text,
  suggested_action     text        not null,
  suggestion           jsonb,
  provenance_timeline  jsonb       not null default '[]'::jsonb,
  created_at           timestamptz not null default now(),
  unique (voucher_id)
);

create index ledger_reviews_status_idx
  on ledger.review_tasks (organization_id, workspace_id, status, created_at desc);

create index ledger_reviews_voucher_idx
  on ledger.review_tasks (voucher_id);


-- 3g. Suggestions (normalized AI posting recommendations)
create table ledger.suggestions (
  id              text          primary key,
  voucher_id      text          not null references ledger.vouchers(id),
  account_number  text          not null,
  account_name    text          not null,
  vat_code        text          not null,
  confidence      numeric(3,2)  not null default 0,
  reasoning       text          not null default '',
  kind            text          not null default 'recommendation'
    check (kind in ('explanation', 'recommendation', 'automation-request')),
  citations       jsonb         not null default '[]'::jsonb,
  rule_hits       jsonb         not null default '[]'::jsonb,
  created_at      timestamptz   not null default now()
);

create index ledger_suggestions_voucher_idx
  on ledger.suggestions (voucher_id);


-- 3h. Assistant sessions (AI Q&A history)
create table ledger.assistant_sessions (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  question        text          not null,
  answer          text          not null,
  status          text          not null default 'grounded'
    check (status in ('grounded', 'ungrounded', 'error')),
  citations       jsonb         not null default '[]'::jsonb,
  actor_id        text,
  created_at      timestamptz   not null default now()
);

create index ledger_assistant_org_ws_idx
  on ledger.assistant_sessions (organization_id, workspace_id, created_at desc);


-- 3i. Compliance alerts (policy violations and warnings)
create table ledger.compliance_alerts (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  title           text          not null,
  source          text          not null,
  detected_at     timestamptz   not null default now(),
  impact_summary  text          not null default '',
  status          text          not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolved_by     text,
  resolved_at     timestamptz,
  created_at      timestamptz   not null default now()
);

create index ledger_alerts_org_ws_idx
  on ledger.compliance_alerts (organization_id, workspace_id, status, detected_at desc);


-- ---------------------------------------------------------------------------
-- 4. Projection tables — projections.*
-- ---------------------------------------------------------------------------

-- 4a. Journal entries (denormalized ledger lines derived from events)
create table projections.journal_entries (
  id              text          primary key,
  organization_id text          not null,
  workspace_id    text          not null,
  voucher_id      text          not null,
  account_number  text          not null,
  account_name    text          not null,
  description     text          not null,
  debit           numeric(18,2) not null default 0,
  credit          numeric(18,2) not null default 0,
  vat_code        text          not null default 'NA',
  deductible      boolean       not null default false,
  booked_at       timestamptz   not null
);

comment on table projections.journal_entries is 'Derived read model rebuilt from ledger.events. Do not treat as source of truth.';

create index proj_journal_account_idx
  on projections.journal_entries (organization_id, workspace_id, account_number, booked_at desc);

create index proj_journal_timeline_idx
  on projections.journal_entries (organization_id, workspace_id, booked_at desc);

create index proj_journal_voucher_idx
  on projections.journal_entries (voucher_id);


-- 4b. Account balances (aggregated trial balance)
create table projections.account_balances (
  organization_id text          not null,
  workspace_id    text          not null,
  account_number  text          not null,
  account_name    text          not null,
  debit           numeric(18,2) not null default 0,
  credit          numeric(18,2) not null default 0,
  balance         numeric(18,2) not null default 0,
  primary key (organization_id, workspace_id, account_number)
);


-- 4c. VAT summary (aggregated by VAT code)
create table projections.vat_summary (
  organization_id text          not null,
  workspace_id    text          not null,
  vat_code        text          not null,
  base_amount     numeric(18,2) not null default 0,
  vat_amount      numeric(18,2) not null default 0,
  deductible      boolean       not null default false,
  primary key (organization_id, workspace_id, vat_code)
);


-- ---------------------------------------------------------------------------
-- 5. Row-Level Security (RLS)
-- ---------------------------------------------------------------------------
-- Organization-based isolation on all tables.
-- The API server sets `app.organization_id` via SET LOCAL per transaction.

alter table ledger.events             enable row level security;
alter table ledger.evidence_objects   enable row level security;
alter table ledger.evidence_packets   enable row level security;
alter table ledger.evidence_packet_items enable row level security;
alter table ledger.vouchers           enable row level security;
alter table ledger.review_tasks       enable row level security;
alter table ledger.suggestions        enable row level security;
alter table ledger.assistant_sessions enable row level security;
alter table ledger.compliance_alerts  enable row level security;
alter table projections.journal_entries   enable row level security;
alter table projections.account_balances  enable row level security;
alter table projections.vat_summary       enable row level security;

-- Service-role bypass: the API server uses the service_role key which
-- bypasses RLS by default. These policies apply to the `authenticated` role
-- (direct client access via Supabase JS SDK).

create policy org_isolation on ledger.events
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on ledger.evidence_objects
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on ledger.evidence_packets
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

-- Junction table: RLS via packet ownership
create policy packet_owner_isolation on ledger.evidence_packet_items
  for all to authenticated
  using (
    evidence_packet_id in (
      select id from ledger.evidence_packets
      where organization_id = current_setting('app.organization_id', true)
    )
  );

create policy org_isolation on ledger.vouchers
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on ledger.review_tasks
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on ledger.suggestions
  for all to authenticated
  using (
    voucher_id in (
      select id from ledger.vouchers
      where organization_id = current_setting('app.organization_id', true)
    )
  );

create policy org_isolation on ledger.assistant_sessions
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on ledger.compliance_alerts
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on projections.journal_entries
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on projections.account_balances
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));

create policy org_isolation on projections.vat_summary
  for all to authenticated
  using (organization_id = current_setting('app.organization_id', true));


-- ---------------------------------------------------------------------------
-- 6. Audit tracking (supa_audit)
-- ---------------------------------------------------------------------------
-- Track mutations on mutable tables. Events table is append-only so we skip it.
-- Note: supa_audit must be enabled in the Supabase dashboard extensions first.
-- Uncomment these lines after enabling the extension:
--
-- create extension if not exists supa_audit;
-- select audit.enable_tracking('ledger.vouchers'::regclass);
-- select audit.enable_tracking('ledger.review_tasks'::regclass);
-- select audit.enable_tracking('ledger.compliance_alerts'::regclass);
-- select audit.enable_tracking('ledger.assistant_sessions'::regclass);


-- ---------------------------------------------------------------------------
-- 7. Table comments
-- ---------------------------------------------------------------------------
comment on table ledger.evidence_objects     is 'Immutable evidence documents (receipts, invoices, voice notes).';
comment on table ledger.evidence_packets     is 'Logical grouping of evidence before voucher creation.';
comment on table ledger.vouchers             is 'Accounting transactions with extracted fields, pending review.';
comment on table ledger.review_tasks         is 'Human approval queue with provenance timeline and AI suggestions.';
comment on table ledger.suggestions          is 'Normalized AI posting recommendations with rule hits and citations.';
comment on table ledger.assistant_sessions   is 'AI advisory Q&A history with grounded citations.';
comment on table ledger.compliance_alerts    is 'Policy violations and compliance warnings.';
comment on table projections.account_balances is 'Derived trial balance rebuilt from journal entries.';
comment on table projections.vat_summary     is 'Derived VAT aggregation by code for Skatteverket reporting.';
