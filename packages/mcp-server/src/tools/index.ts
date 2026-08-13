export const MCP_TOOL_NAMES = [
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

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
