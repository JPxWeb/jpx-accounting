# Wave 7 Tasks 7.1–7.2 Sol review

**Verdict: APPROVE**

Reviewed commits `130a761` (MCP stdio scaffold), `19dfe4f` (tool registry and
threat model), and `a4bdffe` (checkpoint record) on
`feat/ledger-overview-enrichments-mcp`. The later Wave 6d documentation commit
`a2e78a4` is outside this verdict.

## Findings

No high-confidence findings.

- `packages/mcp-server` is the 12th workspace package and its stdio SDK
  entrypoint typechecks.
- `MCP_TOOL_NAMES` exactly matches the 13-name spec surface, rejects duplicates,
  and regression-pins the forbidden confirmation, approval, posting, direct-tag,
  and direct-external-reference names.
- The threat model keeps MCP ledger effects proposal-only: open-review intents
  and post-post enrichment work items require the existing explicit human
  approval/confirmation paths. Capture operations do not post vouchers, actor
  attribution remains server-derived, and no direct ledger mutation tool is
  exposed.
- No Task 7.3 handler, Task 7.4 setup/repository documentation, Task 7.5 gate,
  or Wave 8 HTTP transport is implemented or claimed complete by this
  checkpoint.
- The forward-looking handler/auth statements in `threat-model.md` describe the
  required trust boundary for Task 7.3; the progress record accurately states
  that handlers are not present yet.

No auth or mutation hole warrants escalation.

## Verification

- `pnpm --filter @jpx-accounting/mcp-server typecheck` — PASS
- `pnpm exec tsx --test tests/unit/mcp-tools.test.ts` — PASS (2/2)
- `pnpm typecheck:tests` — PASS
- Focused ESLint — PASS
- Focused Prettier check — PASS
- `git diff 130a761^..a4bdffe --check` — PASS

Tasks 7.3–7.5 may continue in plan order on the same feature branch.
