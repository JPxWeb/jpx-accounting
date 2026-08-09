-- 0009: post-post enrichment work items.
--
-- Work items are human-confirmed proposals for enriching already-posted
-- vouchers or lines. They are intentionally separate from the review posting
-- path and never create another PostedToLedger event.
--
-- Idempotent: safe to replay on partial environments.

create table if not exists ledger.enrichment_work_items (
  id                         text        primary key,
  organization_id            text        not null,
  workspace_id               text        not null,
  target_kind                text        not null,
  target_id                  text        not null,
  proposed_change            jsonb       not null,
  status                     text        not null,
  source                     text        not null,
  idempotency_key            text        not null,
  created_at                 timestamptz not null,
  created_by                 text        not null,
  confirmed_at               timestamptz,
  confirmed_by               text,
  resulting_event_ids        jsonb,
  superseded_by_work_item_id text,
  unique (organization_id, workspace_id, idempotency_key)
);

do $$ begin
  alter table ledger.enrichment_work_items
    add constraint enrichment_work_items_status_check
    check (status in ('pending_confirmation', 'confirmed', 'rejected', 'superseded'));
exception when duplicate_object then null;
end $$;
