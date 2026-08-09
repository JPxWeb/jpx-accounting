create table if not exists ledger.review_enrichment_intents (
  organization_id text not null,
  workspace_id text not null,
  review_id text not null,
  voucher_id text not null,
  proposals jsonb not null,
  updated_at timestamptz not null,
  updated_by text not null,
  primary key (organization_id, workspace_id, review_id)
);

create index if not exists review_enrichment_intents_voucher_idx
  on ledger.review_enrichment_intents (organization_id, workspace_id, voucher_id);
