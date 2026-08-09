import assert from "node:assert/strict";
import { test } from "node:test";
import { MCP_TOOL_NAMES } from "../../packages/mcp-server/src/tools/index.ts";

const REQUIRED = [
  "initialize_upload",
  "register_evidence",
  "compose_evidence_packet",
  "extract_evidence",
  "submit_enrichment_proposal",
  "submit_review_proposal",
  "get_review_deep_link",
  "get_evidence",
  "list_reviews",
  "get_journal",
  "get_trial_balance",
  "get_integrity",
  "query_knowledge",
] as const;

const FORBIDDEN = [
  "confirm_enrichment_work_item",
  "approve_review",
  "post_voucher",
  "apply_voucher_tags",
  "apply_external_reference",
  "direct_post",
] as const;

test("MCP_TOOL_NAMES includes every required spec tool exactly once", () => {
  for (const name of REQUIRED) {
    assert.ok(MCP_TOOL_NAMES.includes(name), `missing required tool: ${name}`);
  }
  assert.equal(MCP_TOOL_NAMES.length, REQUIRED.length);
  assert.equal(new Set(MCP_TOOL_NAMES).size, MCP_TOOL_NAMES.length);
});

test("MCP_TOOL_NAMES excludes forbidden direct mutation tools", () => {
  const exposedNames: readonly string[] = MCP_TOOL_NAMES;
  for (const name of FORBIDDEN) {
    assert.ok(!exposedNames.includes(name), `forbidden tool present: ${name}`);
  }
});
