-- 0010_voucher_tenant_pk.sql — tenant-scope the ledger.vouchers PK
-- (KFR Phase D / Task 1).
--
-- Problem being fixed: 0001 created `ledger.vouchers` with `id text primary
-- key` — a GLOBAL key — while the table carries tenant columns
-- (organization_id, workspace_id) and every read path filters on them. That
-- was harmless for as long as every voucher id came out of `createId('vou')`,
-- which is collision-free by construction. KFR Phase D / Task 1 breaks that
-- assumption: `importSie` now materializes a voucher row whose id IS the SIE
-- aggregate id, `sie_<series>_<number>` — DETERMINISTIC, and unique only per
-- workspace. Two workspaces importing files that both contain `#VER A 42`
-- would collide on the global PK, and the second tenant's ENTIRE import
-- transaction would abort with 23505. Rescoping the PK to
-- (organization_id, workspace_id, id) makes each tenant's voucher identity
-- independent — the same fix, for the same reason, that 0007 applied to
-- knowledge.documents and its deterministic `<docId>#<n>` chunk ids.
--
-- FK consequence: `ledger.review_tasks.voucher_id` references
-- `ledger.vouchers(id)`, and Postgres refuses to drop a constraint that an FK
-- depends on. The FK is therefore dropped and re-added as the matching
-- COMPOSITE key (organization_id, workspace_id, voucher_id). That is strictly
-- STRONGER than what it replaces: it now also pins a review task to its
-- voucher's tenant, which the single-column FK never checked.
--
-- Existing-data safety: rescoping a PK from (id) to a superset that starts
-- with other columns can never break existing rows — any set of rows unique on
-- `id` is unique on (organization_id, workspace_id, id) by construction. No
-- data is rewritten; only constraints (and their backing indexes) are
-- replaced. The composite FK is satisfied by existing rows because a review
-- task and its voucher are always written in one transaction from the same
-- resolved tenant scope.
--
-- Idempotency (replayed on partial environments, CLAUDE.md migration rules):
-- every step inspects the CURRENT catalog state and only acts when it differs
-- from the target, so a re-run after success is a no-op, and a run against a
-- pre-0010 database performs the swap.

do $$
declare
  fk record;
  current_pk record;
begin
  -- 1. Drop any FK from ledger.review_tasks to ledger.vouchers that is not
  --    already the tenant-scoped triple (0001 named it implicitly, so it is
  --    discovered from the catalog rather than assumed).
  for fk in
    select c.conname,
           (
             select string_agg(a.attname, ',' order by k.ord)
             from unnest(c.conkey) with ordinality as k(attnum, ord)
             join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
           ) as cols
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class rt on rt.oid = c.confrelid
    join pg_namespace rn on rn.oid = rt.relnamespace
    where n.nspname = 'ledger'
      and t.relname = 'review_tasks'
      and rn.nspname = 'ledger'
      and rt.relname = 'vouchers'
      and c.contype = 'f'
  loop
    if fk.cols is distinct from 'organization_id,workspace_id,voucher_id' then
      execute format('alter table ledger.review_tasks drop constraint %I', fk.conname);
    end if;
  end loop;

  -- 2. Swap the primary key to the tenant-scoped triple.
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
  where n.nspname = 'ledger'
    and t.relname = 'vouchers'
    and c.contype = 'p';

  if current_pk.conname is not null and current_pk.cols is distinct from 'organization_id,workspace_id,id' then
    execute format('alter table ledger.vouchers drop constraint %I', current_pk.conname);
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'ledger'
      and t.relname = 'vouchers'
      and c.contype = 'p'
  ) then
    alter table ledger.vouchers
      add constraint ledger_vouchers_tenant_pk primary key (organization_id, workspace_id, id);
  end if;

  -- 3. Re-add the review-task FK against the new composite key.
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'ledger'
      and t.relname = 'review_tasks'
      and c.contype = 'f'
      and c.conname = 'ledger_review_tasks_voucher_fk'
  ) then
    alter table ledger.review_tasks
      add constraint ledger_review_tasks_voucher_fk
      foreign key (organization_id, workspace_id, voucher_id)
      references ledger.vouchers (organization_id, workspace_id, id);
  end if;
end $$;

comment on constraint ledger_vouchers_tenant_pk on ledger.vouchers is
  'Tenant-scoped voucher identity (KFR Phase D / Task 1): SIE-imported ids are deterministic (sie_<series>_<number>), so uniqueness holds per (org, workspace), never globally.';
