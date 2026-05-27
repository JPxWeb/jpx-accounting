-- Enables supa_audit row-history tracking on the four mutable ledger tables.
-- The append-only ledger.events table does not need this (already immutable
-- via the existing INSERT-only trigger from schema_v2.sql).
--
-- Exception scope (CONVENTIONS Rule 19): we catch ONLY the conditions that
-- correspond to "extension not available on this project" (feature_not_supported,
-- undefined_object, insufficient_privilege). Transient errors (lock_not_available,
-- statement_timeout, serialization_failure, deadlock_detected, etc.) still abort
-- the migration so the operator investigates rather than silently shipping with
-- partial audit coverage.
--
-- Pre-flight: on hosted Supabase, verify with
--   select * from pg_available_extensions where name = 'supa_audit';
-- If absent, file a support request; row-history will be off until enabled.

do $$
begin
  create extension if not exists supa_audit;

  perform audit.enable_tracking('ledger.vouchers'::regclass);
  perform audit.enable_tracking('ledger.review_tasks'::regclass);
  perform audit.enable_tracking('ledger.compliance_alerts'::regclass);
  perform audit.enable_tracking('ledger.assistant_sessions'::regclass);
exception
  when feature_not_supported or undefined_object or insufficient_privilege then
    raise notice 'supa_audit setup skipped (extension unavailable): %', sqlerrm;
end
$$;
