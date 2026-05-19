-- org_jpx demo seed aligned with MemoryLedgerStore initial ledger lines (6540 / 2641 / 1930)

insert into ledger.evidence_packets (id, organization_id, workspace_id, note)
values ('packet_seed_1', 'org_jpx', 'workspace_main', 'Seed packet')
on conflict (id) do nothing;

insert into ledger.evidence_objects (
  id, organization_id, workspace_id, title, modalities, created_by, created_at,
  original_filename, mime_type, blob_path, hash, trust_level
) values (
  'evidence_seed_1', 'org_jpx', 'workspace_main', 'Seeded SaaS subscription',
  array['pdf','upload'], 'user_founder', now(),
  'seed-subscription.pdf', 'application/pdf', 'evidence/evidence_seed_1/seed-subscription.pdf',
  'seed_hash_1', 'user-upload'
) on conflict (id) do nothing;

insert into ledger.evidence_packet_items (evidence_packet_id, evidence_object_id)
values ('packet_seed_1', 'evidence_seed_1')
on conflict do nothing;

insert into ledger.vouchers (
  id, organization_id, workspace_id, evidence_packet_id, voucher_number,
  accounting_method, status, voucher_fields, extracted_fields, created_by, created_at
) values (
  'voucher_seed_1', 'org_jpx', 'workspace_main', 'packet_seed_1', 'V-1001',
  'invoice', 'needs-review',
  '{"description":"Seeded SaaS subscription","grossAmount":1250,"netAmount":1000,"vatAmount":250,"vatRate":25,"currency":"SEK"}'::jsonb,
  '[]'::jsonb,
  'user_founder', now()
) on conflict (id) do nothing;

insert into ledger.suggestions (
  id, voucher_id, account_number, account_name, vat_code, confidence, reasoning, kind, citations, rule_hits
) values (
  'suggestion_seed_1', 'voucher_seed_1', '6540', 'IT-tjänster', 'VAT25', 0.92,
  'Seed suggestion for demo parity', 'recommendation', '[]'::jsonb, '[]'::jsonb
) on conflict (id) do nothing;

insert into ledger.review_tasks (
  id, organization_id, workspace_id, voucher_id, title, status, suggested_action, provenance_timeline
) values (
  'review_seed_1', 'org_jpx', 'workspace_main', 'voucher_seed_1',
  'Approve seeded SaaS subscription', 'needs-review', 'Approve the proposed posting.', '[]'::jsonb
) on conflict (id) do nothing;

insert into projections.journal_entries (
  id, organization_id, workspace_id, voucher_id, account_number, account_name,
  description, debit, credit, vat_code, deductible, booked_at
) values
  ('journal_seed_1', 'org_jpx', 'workspace_main', 'voucher_seed_1', '6540', 'IT-tjänster', 'Seeded SaaS subscription', 1000, 0, 'VAT25', true, now()),
  ('journal_seed_2', 'org_jpx', 'workspace_main', 'voucher_seed_1', '2641', 'Debiterad ingående moms', 'Seeded input VAT', 250, 0, 'VAT25', true, now()),
  ('journal_seed_3', 'org_jpx', 'workspace_main', 'voucher_seed_1', '1930', 'Företagskonto', 'Seeded bank outflow', 0, 1250, 'NA', false, now())
on conflict (id) do nothing;

insert into ledger.organization_settings (organization_id, settings, updated_by)
values (
  'org_jpx',
  '{"organizationId":"org_jpx","organizationName":"JPX Demo AB","organizationNumber":"556677-8899","addressLine1":"Kungsgatan 1","postalCode":"111 22","city":"Stockholm","contactEmail":"hello@example.com"}'::jsonb,
  'seed'
) on conflict (organization_id) do nothing;
