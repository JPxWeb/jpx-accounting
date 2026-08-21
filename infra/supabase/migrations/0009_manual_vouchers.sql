-- 0009_manual_vouchers.sql — manual N-line journal entries go through the
-- review gate (KFR Phase B / D2).
--
-- ledger.vouchers.evidence_packet_id becomes nullable: a manual voucher has
-- no evidence packet at creation time (Phase D's evidenceComposeInputSchema
-- targetVoucherId later lets a user attach one after the fact). The
-- existing FK to ledger.evidence_packets(id) already tolerates NULL — FK
-- constraints never fire on a NULL value, so no FK change is needed.
--
-- ledger.vouchers.origin distinguishes how a voucher was created: 'capture'
-- (the existing evidence-driven flow, DEFAULT so every pre-existing row
-- backfills correctly on this ADD COLUMN), 'manual' (this phase), 'import'
-- (SIE — reserved for KFR Phase D, when importSie starts materializing
-- voucher rows for imported vouchers). NOT NULL is load-bearing:
-- `rowToVoucher` in packages/persistence-postgres/src/store.ts casts
-- `row.origin` straight into the union with no runtime guard, so the column
-- must never yield null.
--
-- Idempotency: DROP NOT NULL is a no-op when already nullable (safe to
-- replay); ADD COLUMN IF NOT EXISTS and the DO-block CHECK guard (Rule 18)
-- make the rest of the file replay clean on partial environments.

alter table ledger.vouchers
  alter column evidence_packet_id drop not null;

alter table ledger.vouchers
  add column if not exists origin text not null default 'capture';

do $$ begin
  alter table ledger.vouchers
    add constraint ledger_vouchers_origin_check
    check (origin in ('capture', 'manual', 'import'));
exception when duplicate_object then null;
end $$;

comment on column ledger.vouchers.origin is
  'How the voucher was created: capture (evidence-driven), manual (KFR Phase B N-line entry), import (SIE, reserved for Phase D).';
