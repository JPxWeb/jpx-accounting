-- Schema alignment for fields the domain types require but 0001_init.sql omitted.
--
-- ledger.evidence_objects needs `modalities` (text[]) — domain type EvidenceObject.modalities
--   is a non-empty array; the LedgerStore implementation must round-trip it.
-- ledger.review_tasks needs `title` (text) — ReviewTask.title is human-facing UI copy and is
--   produced at evidence intake; required, not optional in the domain type.

alter table ledger.evidence_objects
  add column if not exists modalities text[] not null default '{}'::text[];

alter table ledger.review_tasks
  add column if not exists title text not null default '';

-- Drop the defaults now that all existing rows have been backfilled. New inserts must provide
-- both fields explicitly — matches the domain contract and prevents silent drift.
alter table ledger.evidence_objects
  alter column modalities drop default;

alter table ledger.review_tasks
  alter column title drop default;
