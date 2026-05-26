-- Enables supa_audit row-history tracking on the four mutable ledger tables.
-- The append-only ledger.events table does not need this (already immutable
-- via the existing INSERT-only trigger from schema_v2.sql).
--
-- The CREATE EXTENSION + enable_tracking calls are wrapped in a DO block with
-- exception handling so that a Supabase project where supa_audit is not on
-- the extension allowlist can still apply this migration (logged as NOTICE)
-- without aborting the migration transaction. The next migration in the
-- batch (20260526000001_compliance_alert_keys.sql) carries code dependencies
-- that must not be blocked by an optional audit feature being unavailable.
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
exception when others then
  raise notice 'supa_audit setup skipped: %', sqlerrm;
end
$$;
