-- Maintain projections.account_balances and projections.vat_summary incrementally
-- from projections.journal_entries. Mirrors packages/domain/src/projections.ts
-- (buildBalances / buildVat): balance = debit - credit; vat base = debit or credit
-- whichever is non-zero; vat_amount accrues only on account 2641 (input VAT);
-- account_name / deductible keep their first-seen value (do-not-update on conflict).

create or replace function projections.apply_journal_aggregates()
returns trigger
language plpgsql
as $$
begin
  insert into projections.account_balances
    (organization_id, workspace_id, account_number, account_name, debit, credit, balance)
  values
    (new.organization_id, new.workspace_id, new.account_number, new.account_name,
     new.debit, new.credit, new.debit - new.credit)
  on conflict (organization_id, workspace_id, account_number) do update
    set debit   = projections.account_balances.debit  + excluded.debit,
        credit  = projections.account_balances.credit + excluded.credit,
        balance = (projections.account_balances.debit  + excluded.debit)
                - (projections.account_balances.credit + excluded.credit);

  insert into projections.vat_summary
    (organization_id, workspace_id, vat_code, base_amount, vat_amount, deductible)
  values
    (new.organization_id, new.workspace_id, new.vat_code,
     case when new.debit <> 0 then new.debit else new.credit end,
     case when new.account_number = '2641' then new.debit - new.credit else 0 end,
     new.deductible)
  on conflict (organization_id, workspace_id, vat_code) do update
    set base_amount = projections.vat_summary.base_amount
          + (case when new.debit <> 0 then new.debit else new.credit end),
        vat_amount  = projections.vat_summary.vat_amount
          + (case when new.account_number = '2641' then new.debit - new.credit else 0 end);

  return new;
end;
$$;

create trigger trg_journal_aggregates
  after insert on projections.journal_entries
  for each row execute function projections.apply_journal_aggregates();

-- Backfill any rows inserted before this trigger existed.
insert into projections.account_balances
  (organization_id, workspace_id, account_number, account_name, debit, credit, balance)
select organization_id, workspace_id, account_number, min(account_name),
       sum(debit), sum(credit), sum(debit) - sum(credit)
from projections.journal_entries
group by organization_id, workspace_id, account_number
on conflict (organization_id, workspace_id, account_number) do nothing;

insert into projections.vat_summary
  (organization_id, workspace_id, vat_code, base_amount, vat_amount, deductible)
select organization_id, workspace_id, vat_code,
       sum(case when debit <> 0 then debit else credit end),
       sum(case when account_number = '2641' then debit - credit else 0 end),
       bool_or(deductible)
from projections.journal_entries
group by organization_id, workspace_id, vat_code
on conflict (organization_id, workspace_id, vat_code) do nothing;
