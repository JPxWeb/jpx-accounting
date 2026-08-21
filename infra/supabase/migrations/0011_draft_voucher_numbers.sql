-- 0011_draft_voucher_numbers.sql — allow many unposted vouchers to share the
-- draft-number sentinel (KFR Phase E / Task E.1, readiness doc G8).
--
-- Problem being fixed: 0001 created
--   create unique index ledger_vouchers_number_idx
--     on ledger.vouchers (organization_id, workspace_id, voucher_number);
-- a FULL unique index, which was correct while every voucher was numbered at
-- INTAKE (`V-<count+1001>`, unique by construction). Task E.1 moves numbering
-- to POSTING time: an unposted voucher carries the shared sentinel 'Utkast'
-- (packages/domain/src/store-shared.ts `DRAFT_VOUCHER_NUMBER`) until it is
-- approved or booked-without-vat. With the full index, the SECOND draft in a
-- workspace fails with 23505 on (org, workspace, 'Utkast').
--
-- The fix: the same index, made PARTIAL on `voucher_number <> 'Utkast'`. Real
-- numbers — native `V-<n>` and SIE-imported "<series> <number>" — keep their
-- per-workspace uniqueness guarantee (the safety net under the posting-time
-- COUNT(*), which runs inside the workspace advisory lock); only the sentinel
-- is allowed to repeat.
--
-- CONVENTIONS Rule 3 check (partial unique indexes cannot be ON CONFLICT
-- targets): nothing upserts into ledger.vouchers. Every write is a plain
-- INSERT (createEvidence / createManualVoucher / importSie) or a keyed UPDATE,
-- so no `ON CONFLICT` inference depends on this index.
--
-- Existing-data normalization: pre-E.1 rows carry an intake-assigned `V-<n>`
-- even when they never posted, and a rejected draft kept its number forever.
-- Those stale numbers are both wrong under the new model AND a collision
-- hazard (the posting-time counter can re-mint a number a rejected row still
-- holds), so every voucher that has NOT posted is normalized to the sentinel.
-- Only `V-%` values are touched: SIE-imported vouchers (status 'posted',
-- "<series> <number>") are excluded by the status filter and by the LIKE guard.
-- Ledger EVENTS are never rewritten — `voucher_number` is a read-model label,
-- and its VoucherCreated payload stays exactly as it was appended.
--
-- Residual, documented risk on a legacy database: pre-E.1 numbering counted
-- ALL vouchers, so the surviving POSTED numbers can be sparse (V-1001, V-1003
-- with V-1002 rejected). The posting-time counter is dense, so the next mint
-- could land on an already-used number and hit this index. Fresh databases and
-- the FY1 import path (docs runbook) are unaffected; a legacy database with
-- sparse posted numbers must be renumbered before this migration.
--
-- Idempotency (CLAUDE.md migration rules): the index is inspected via
-- pg_get_indexdef and only replaced when it is not already the partial form,
-- and the UPDATE is a no-op once every unposted row already holds the sentinel.

do $$
declare
  existing_def text;
begin
  select pg_get_indexdef(i.indexrelid)
    into existing_def
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'ledger'
    and c.relname = 'ledger_vouchers_number_idx';

  -- Present but not yet partial on the sentinel → replace it.
  if existing_def is not null and position('Utkast' in existing_def) = 0 then
    execute 'drop index ledger.ledger_vouchers_number_idx';
    existing_def := null;
  end if;

  if existing_def is null then
    execute 'create unique index ledger_vouchers_number_idx'
         || ' on ledger.vouchers (organization_id, workspace_id, voucher_number)'
         || ' where voucher_number <> ''Utkast''';
  end if;
end $$;

-- Normalize pre-E.1 intake numbers on vouchers that never posted.
update ledger.vouchers
   set voucher_number = 'Utkast'
 where voucher_number like 'V-%'
   and voucher_number <> 'Utkast'
   and status not in ('approved', 'booked-without-vat', 'posted');

comment on index ledger.ledger_vouchers_number_idx is
  'Per-workspace uniqueness for REAL voucher numbers only (KFR Phase E / Task E.1): unposted vouchers all share the DRAFT_VOUCHER_NUMBER sentinel ''Utkast'', which the partial predicate excludes.';
