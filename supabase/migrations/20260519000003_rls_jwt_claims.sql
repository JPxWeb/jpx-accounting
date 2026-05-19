-- Replace session GUC policies with JWT app_metadata claims (Phase 7 hardening).

drop policy if exists org_isolation on ledger.events;
drop policy if exists org_isolation on ledger.evidence_objects;
drop policy if exists org_isolation on ledger.evidence_packets;
drop policy if exists packet_owner_isolation on ledger.evidence_packet_items;
drop policy if exists org_isolation on ledger.vouchers;
drop policy if exists org_isolation on ledger.review_tasks;
drop policy if exists org_isolation on ledger.suggestions;
drop policy if exists org_isolation on ledger.assistant_sessions;
drop policy if exists org_isolation on ledger.compliance_alerts;
drop policy if exists org_isolation on projections.journal_entries;
drop policy if exists org_isolation on projections.account_balances;
drop policy if exists org_isolation on projections.vat_summary;

create policy org_isolation on ledger.events
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on ledger.evidence_objects
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on ledger.evidence_packets
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy packet_owner_isolation on ledger.evidence_packet_items
  for all to authenticated
  using (
    evidence_packet_id in (
      select id from ledger.evidence_packets
      where organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')
    )
  );

create policy org_isolation on ledger.vouchers
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on ledger.review_tasks
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on ledger.suggestions
  for all to authenticated
  using (
    voucher_id in (
      select id from ledger.vouchers
      where organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')
    )
  );

create policy org_isolation on ledger.assistant_sessions
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on ledger.compliance_alerts
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on projections.journal_entries
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on projections.account_balances
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));

create policy org_isolation on projections.vat_summary
  for all to authenticated
  using (organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id'));
