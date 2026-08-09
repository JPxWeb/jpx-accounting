# MCP setup (stdio and Streamable HTTP)

JPx Accounting ships MCP adapters in `packages/mcp-server`:

- **stdio** — local MCP hosts spawn `packages/mcp-server/src/index.ts`.
- **Streamable HTTP** — authenticated `POST` and `GET` on `/api/mcp` on the
  running API (Wave 8). v1 has **no `DELETE` session route**; sessions expire
  by TTL and bounded store capacity only.

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

## Streamable HTTP (Wave 8)

Use this when the MCP host connects to a deployed or local API over HTTP instead
of spawning the stdio process.

### Endpoints

| Method | Path                                    | Purpose                                                                                   |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/api/mcp`                              | JSON-RPC requests (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`) |
| GET    | `/api/mcp`                              | Session SSE stream — replay buffered events, then live delivery                           |
| GET    | `/.well-known/oauth-protected-resource` | RFC 9728 metadata for the MCP resource (header bearer only)                               |

There is **no `DELETE /api/mcp` in v1**. Clients must rely on session TTL expiry
and reconnect with a fresh `initialize` when a session is gone.

### Authentication and guards

- **JWT** — when `SUPABASE_JWKS_URL` is configured, `/api/mcp` inherits the same
  `/api/*` bearer verification as every other authenticated route. Send
  `Authorization: Bearer <token>`.
- **Origin and Host** — both `POST` and `GET` reject requests whose `Origin`
  header is absent or not on the API CORS allowlist, and whose `Host` header is
  not on the configured MCP host allowlist (DNS-rebinding guard).
- **Rate limit** — `POST /api/mcp` uses the existing mutation limiter keyed by
  verified JWT subject (or client IP when unauthenticated in demo).

Fetch RFC 9728 metadata before configuring the host:

```http
GET /.well-known/oauth-protected-resource
```

The response advertises the MCP resource URL, authorization servers, and
`bearer_methods_supported: ["header"]` only.

### Session contract

1. **Initialize** — `POST /api/mcp` with JSON-RPC `initialize`. Required
   headers include `Accept: application/json, text/event-stream`,
   `Content-Type: application/json`, a permitted `Origin`, and a permitted
   `Host`. The response includes `Mcp-Session-Id`.
2. **Acknowledge** — send `notifications/initialized` on the same session
   (`Mcp-Session-Id` header on subsequent POSTs).
3. **Tools** — call `tools/list` and `tools/call` on POST; the adapter exposes
   the same fixed 13 names as stdio.
4. **SSE resume** — open `GET /api/mcp` with `Mcp-Session-Id`. Optionally send
   `Last-Event-ID` to replay buffered events with a higher id, then remain
   subscribed for live session events until the client cancels the stream.

Each session keeps at most 100 buffered SSE events. The server store caps total
live sessions (default 1,000) and sweeps expired entries on creation.

### Upload posture (unchanged)

`initialize_upload` still returns a short-lived HTTPS SAS URL. The HTTP adapter
does not accept base64 bodies and does not send the JPx bearer token to blob
storage.
