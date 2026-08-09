# MCP tool threat model

The stdio MCP server is a thin adapter over authenticated JPx API routes. It
contains no ledger logic and never accepts client-supplied actor attribution.

## Trust boundary

- The MCP host supplies `JPX_MCP_BEARER_TOKEN`; handlers forward it to the API.
- The API validates contracts, derives the actor from the verified subject, and
  enforces tenant scope.
- File capture uses short-lived HTTPS SAS URLs. Tools never accept or return
  base64 file bodies.

## Allowed effects

- Read tools return bounded API projections.
- Capture tools register evidence or compose evidence packets without posting.
- Proposal tools create review intents or enrichment work items. They do not
  execute those proposals.
- `submit_review_proposal` is restricted to an open review. A human must still
  approve through the existing review queue before `PostedToLedger` can exist.
- Post-post enrichment proposals can change ledger projections only after a
  human confirms the work item; confirmation cannot append `PostedToLedger`.

## Excluded tools

The registry must not expose confirmation, approval, posting, direct tag,
direct external-reference, or other direct ledger mutation tools. In
particular, it excludes:

- `confirm_enrichment_work_item`
- `approve_review`
- `post_voucher`
- `apply_voucher_tags`
- `apply_external_reference`
- `direct_post`

These exclusions preserve the invariant that AI and MCP suggest while humans
approve.
