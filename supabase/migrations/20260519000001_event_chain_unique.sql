-- Prevent forked hash chains when concurrent appends read the same latest event.
create unique index ledger_events_chain_link_uidx
  on ledger.events (organization_id, workspace_id, previous_hash);
