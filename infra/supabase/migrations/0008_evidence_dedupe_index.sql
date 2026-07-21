-- 0008: evidence content-dedupe lookup index (WS-D R19).
--
-- `createEvidence` now checks for an existing evidence row with the identical
-- (organization_id, workspace_id, hash) before creating, inside the chain
-- transaction (advisory lock held). evidence_objects only has its `id` PK, so
-- without this index every file create seq-scans the table. Plain btree, NOT
-- unique: pre-dedupe data may already hold duplicates, and legacy rows carry
-- synthetic (non-content) hashes — uniqueness is enforced by the store's
-- serialized lookup, not the schema. sizeBytes lives in the metadata jsonb and
-- is re-checked in application code after the indexed narrow.
--
-- Idempotent: safe to replay on partial environments.

create index if not exists ledger_evidence_objects_dedupe_idx
  on ledger.evidence_objects (organization_id, workspace_id, hash);
