-- Enables supa_audit row-history tracking on the four mutable ledger tables.
-- The append-only ledger.events table does not need this (already immutable
-- via the existing INSERT-only trigger from schema_v2.sql).
--
-- Pre-flight: verify `supa_audit` is in pg_available_extensions on the
-- target Supabase project before applying. Pre-allowed on Supabase hosted;
-- if unavailable, file a support request before applying this migration.

create extension if not exists supa_audit;

select audit.enable_tracking('ledger.vouchers'::regclass);
select audit.enable_tracking('ledger.review_tasks'::regclass);
select audit.enable_tracking('ledger.compliance_alerts'::regclass);
select audit.enable_tracking('ledger.assistant_sessions'::regclass);
