# Compliance Playbook

## Accounting controls

- Never overwrite evidence or posted ledger history.
- Corrections are new events with actor and timestamp.
- Period locks must block retroactive posting.
- Deductible VAT requires invoice completeness checks.

## Data handling

- Treat official sources, internal policy, and user-uploaded files as separate trust classes.
- Retained evidence may stay stored for legal reasons even when day-to-day access should be minimized.
- All uploads should be malware scanned and typed before retrieval or AI usage.

## AI controls

- AI outputs must be logged with model identifier, citations, tool calls, and reviewer outcome.
- Advisory answers must cite sources or explicitly say that the basis is insufficient.
- Preview-only automation must remain isolated from production mutation paths.

## Operational drills

- Test Point-in-Time Recovery for Supabase.
- Test projection rebuild from events.
- Test evidence bundle restoration from Blob storage.
- Verify signed digest continuity after restore.
