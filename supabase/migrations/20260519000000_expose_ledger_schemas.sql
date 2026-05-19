-- Expose custom schemas to PostgREST (service role still needs USAGE grants).
grant usage on schema ledger, projections to anon, authenticated, service_role;
grant all on all tables in schema ledger, projections to anon, authenticated, service_role;
grant all on all sequences in schema ledger, projections to anon, authenticated, service_role;
grant all on all routines in schema ledger, projections to anon, authenticated, service_role;

alter default privileges for role postgres in schema ledger
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema projections
  grant all on tables to anon, authenticated, service_role;
