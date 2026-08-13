# Wave 7 Task 7.4 MCP documentation Sol review

**Verdict: REQUEST_CHANGES**

Reviewed `1159a0e` (MCP setup and repo-map documentation) and `915b38c`
(Task 7.4 checkpoint) against the implemented Wave 7 state through `36dfa7d`.

## Important finding

### 1. The setup guide documents a callable 13-tool stdio server that is not implemented (confidence 100)

- `docs/MCP_SETUP.md:27-34` says startup requires the API URL and bearer token
  and fails closed if either is absent.
- `docs/MCP_SETUP.md:59-92` presents the 13 names as the available Wave 7
  stdio tool surface.
- `docs/REPO_MAP.md:214` says the stdio entrypoint forwards authenticated
  calls through `api-client`.

The actual `packages/mcp-server/src/index.ts` only creates an `McpServer` and
connects `StdioServerTransport`. It never calls `createMcpApiClientFromEnv`,
never imports `MCP_TOOL_NAMES`, and never registers a tool. Therefore the
documented command starts successfully without either environment variable,
and an MCP host sees zero callable tools. Only three standalone handler
functions exist; the remaining ten names have no handler implementation.

Fix by wiring and registering the documented 13-tool stdio surface (including
input schemas and the existing proposal/human-gate behavior) before presenting
it as available. If registration is intentionally deferred, rewrite both docs
to state that Wave 7 currently provides only a scaffold/reserved inventory and
that the launch command exposes no callable tools; however, that would not
deliver the stated stdio pilot.

## Verified invariants

- The documented 13 names exactly match `MCP_TOOL_NAMES`.
- No approval, confirmation, posting, direct-tag, or direct-reference name is
  present in the inventory.
- The proposal documentation correctly preserves explicit human approval and
  confirmation gates.
- The review-proposal handler returns the exact API-provided opaque
  `intentVersion`; the docs correctly require approval to consume that version.
- Streamable HTTP remains explicitly deferred to Wave 8.

## Verification

- Focused MCP inventory and handler tests: PASS (9/9).
- Prettier check for `MCP_SETUP.md`, `REPO_MAP.md`, and `progress.md`: PASS.
- Manual entrypoint trace confirmed zero tool registrations and no startup
  environment validation.

Task 7.5 may run independently as a sibling gate, but Task 7.4 is not approved
until the documented stdio behavior matches the implementation.
