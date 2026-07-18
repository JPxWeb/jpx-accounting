-- 0007_knowledge_tenant_pk.sql — tenant-scope the knowledge.documents PK (WS-B B7c).
--
-- Problem being fixed: 0003 created `knowledge.documents` with `id text
-- primary key` — a GLOBAL key — while the table carries tenant columns
-- (organization_id, workspace_id) and every read path filters on them. Chunk
-- ids are deterministic (`<docId>#<n>`), so the moment a second workspace
-- ingests the same corpus, its upsert would silently STEAL the first
-- workspace's rows (the old `on conflict (id) do update` rewrote
-- organization_id/workspace_id to the excluded values) — cross-tenant data
-- clobbering. Rescoping the PK to (organization_id, workspace_id, id) makes
-- each tenant's corpus independent; `upsertKnowledgeDocuments` targets the
-- new composite key.
--
-- Existing-data safety: rescoping a PK from (id) to a superset that STARTS
-- with other columns can never break existing rows — any set of rows unique
-- on `id` is unique on (organization_id, workspace_id, id) by construction.
-- No data rewrite happens; only the constraint (and its backing index) is
-- replaced.
--
-- Idempotency (replayed on partial environments, CLAUDE.md migration rules):
-- the DO block inspects the CURRENT primary-key column list and only
-- drops/recreates when it differs from the target. A re-run after success is
-- a no-op; a run on a pre-0007 database performs the swap; a database that
-- never had the table fails loudly (0003 must run first — migrations apply
-- in numeric order).

do $$
declare
  current_pk record;
begin
  select c.conname,
         (
           select string_agg(a.attname, ',' order by k.ord)
           from unnest(c.conkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         ) as cols
    into current_pk
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'knowledge'
    and t.relname = 'documents'
    and c.contype = 'p';

  if current_pk.conname is not null and current_pk.cols is distinct from 'organization_id,workspace_id,id' then
    execute format('alter table knowledge.documents drop constraint %I', current_pk.conname);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'knowledge'
      and t.relname = 'documents'
      and c.contype = 'p'
  ) then
    alter table knowledge.documents
      add constraint knowledge_documents_tenant_pk primary key (organization_id, workspace_id, id);
  end if;
end $$;

comment on constraint knowledge_documents_tenant_pk on knowledge.documents is
  'Tenant-scoped chunk identity (WS-B B7c): chunk ids are deterministic per corpus, so uniqueness holds per (org, workspace), never globally.';
