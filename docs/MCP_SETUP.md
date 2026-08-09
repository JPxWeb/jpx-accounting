# MCP stdio setup

JPx Accounting provides a local stdio MCP server in
`packages/mcp-server`. Wave 7 supports stdio only. Streamable HTTP at
`/api/mcp` is planned for Wave 8 and is not available yet.

## Prerequisites

- Node.js 24 and pnpm 10
- A running JPx Accounting API
- A bearer token accepted by that API

On Windows, make the repository's Corepack shims available before using pnpm:

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
```

Install the workspace dependencies from the repository root:

```powershell
pnpm install
```

## Configuration

The MCP host must provide both environment variables:

| Variable                  | Purpose                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `ACCOUNTING_API_BASE_URL` | Absolute base URL of the JPx Accounting API, for example `http://127.0.0.1:3001` |
| `JPX_MCP_BEARER_TOKEN`    | Bearer token forwarded only to authenticated JPx API requests                    |

Startup fails closed if either variable is missing. Keep the bearer token in
the MCP host's environment or secret store; do not commit it or place it in
tool arguments.

Example host configuration:

```json
{
  "mcpServers": {
    "jpx-accounting": {
      "command": "corepack",
      "args": ["pnpm", "exec", "tsx", "packages/mcp-server/src/index.ts"],
      "env": {
        "ACCOUNTING_API_BASE_URL": "http://127.0.0.1:3001",
        "JPX_MCP_BEARER_TOKEN": "${JPX_MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

The command must run with the repository root as its working directory. If the
host does not expand `${JPX_MCP_BEARER_TOKEN}`, use its supported secret
reference syntax rather than writing a token into a tracked file.

## Tool inventory

The Wave 7 stdio surface is fixed to these 13 names:

### Capture and evidence

- `initialize_upload`
- `register_evidence`
- `compose_evidence_packet`
- `extract_evidence`
- `get_evidence`

`initialize_upload` returns a short-lived HTTPS SAS URL and blob identity. The
MCP server does not accept or return base64 file bodies, and it does not send
the JPx bearer token to blob storage.

### Proposals

- `submit_enrichment_proposal`
- `submit_review_proposal`
- `get_review_deep_link`

These tools create pending work only. `submit_review_proposal` requires an open
review and returns the exact opaque intent version attached to it. The later
human approval must consume that same version or fail closed. An enrichment
proposal remains `pending_confirmation` until a human confirms it.

### Read-only projections

- `list_reviews`
- `get_journal`
- `get_trial_balance`
- `get_integrity`
- `query_knowledge`

## Safety boundary

The MCP adapter contains no ledger logic. The API validates contracts, derives
the actor from the verified token subject, and applies tenant scope.

MCP can register evidence, read bounded projections, or create proposals. It
cannot approve a review, confirm an enrichment work item, post a voucher, or
directly apply tags or external references. A posted voucher still requires
explicit human approval through the review queue. Post-post metadata can affect
projections only after explicit human confirmation and can never append
`PostedToLedger`.

See
[`packages/mcp-server/src/tools/threat-model.md`](../packages/mcp-server/src/tools/threat-model.md)
for the complete allowed and excluded effects.
