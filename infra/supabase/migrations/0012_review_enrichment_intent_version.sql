-- Optimistic-concurrency token for pre-post review enrichment intents.
-- An approval may only consume an intent whose `version` it echoes back, so a
-- concurrent producer (second tab, another reviewer, MCP proposal, advisor)
-- cannot slip unseen enrichment into a human approval.
alter table ledger.review_enrichment_intents
  add column if not exists version text;

-- Rows written before this migration carry no token. Backfill an UNGUESSABLE
-- value: a derivable one such as 'rei_legacy_' || review_id could be forged by
-- any client that knows the review id from the URL, so it would NOT fail closed.
update ledger.review_enrichment_intents
set version = 'rei_legacy_' || gen_random_uuid()
where version is null;

alter table ledger.review_enrichment_intents
  alter column version set not null;
