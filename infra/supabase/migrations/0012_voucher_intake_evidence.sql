-- 0012_voucher_intake_evidence.sql — record WHICH evidence spawned a voucher
-- at intake (KFR Phase E / Task E.5).
--
-- Why a column and not a derivation: `ledger.vouchers.evidence_packet_id`
-- follows every re-attach (`composeEvidence` repoints it at the newly composed
-- packet), so once a receipt has been attached elsewhere there is no surviving
-- link that says "this draft only exists because that receipt arrived". The
-- attach flow has to discard the receipt's OWN orphaned intake draft without
-- touching an unrelated voucher the receipt happened to be attached to a
-- moment earlier, and that distinction is only decidable from a fact recorded
-- at creation time.
--
-- NULL semantics: manual (`origin = 'manual'`) and SIE-imported
-- (`origin = 'import'`) vouchers stand on their own with no spawning evidence,
-- so they are NULL by definition — as are all pre-0012 rows, which is exactly
-- the conservative backfill we want: a pre-existing draft is never auto-
-- discarded by a later attach, it just stays in the review queue for a human.
--
-- Deliberately NO foreign key to ledger.evidence_objects. This column is an
-- append-only historical fact about how the voucher came to exist; an FK would
-- couple a voucher's survival to the evidence row's, and evidence is never
-- deleted anyway. Nothing joins on it — it is read as an equality filter
-- inside the workspace-locked compose transaction.
--
-- Idempotency (CLAUDE.md migration rules): ADD COLUMN IF NOT EXISTS, and the
-- comment is replayable.

alter table ledger.vouchers
  add column if not exists intake_evidence_id text null;

comment on column ledger.vouchers.intake_evidence_id is
  'The evidence object that spawned this voucher at intake (KFR Phase E / E.5); NULL for manual, imported, and pre-0012 rows. Recorded fact, not derivable — evidence_packet_id follows every re-attach.';
