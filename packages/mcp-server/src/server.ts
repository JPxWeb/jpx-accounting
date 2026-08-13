import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AccountingApiClient } from "@jpx-accounting/api-client";
import {
  evidenceComposeInputSchema,
  evidenceCreateInputSchema,
  knowledgeQuerySchema,
  proposeEnrichmentWorkItemInputSchema,
  submitReviewProposalInputSchema,
  uploadInitSchema,
} from "@jpx-accounting/contracts";

import {
  createMcpApiClientFromEnv,
  handleInitializeUpload,
  handleSubmitEnrichmentProposal,
  handleSubmitReviewProposal,
} from "./tools/handlers";

const idInput = {
  evidenceId: z.string().min(1).describe("Evidence identifier"),
};
const reviewIdInput = {
  reviewId: z.string().min(1).describe("Open review identifier"),
};
const reportRangeInput = {
  from: z.iso.date().optional().describe("Inclusive first booking day"),
  to: z.iso.date().optional().describe("Inclusive last booking day"),
};

function compactReportRange(range: { from?: string | undefined; to?: string | undefined }) {
  return {
    ...(range.from !== undefined ? { from: range.from } : {}),
    ...(range.to !== undefined ? { to: range.to } : {}),
  };
}

function success(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

function failure(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "The MCP tool request failed.",
      },
    ],
    isError: true,
  };
}

async function invoke(operation: () => Promise<unknown>) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

export function createMcpServer(client: AccountingApiClient): McpServer {
  const server = new McpServer({
    name: "jpx-accounting",
    version: "0.0.0",
  });

  server.registerTool(
    "initialize_upload",
    {
      description: "Mint a short-lived HTTPS SAS credential for an evidence upload.",
      inputSchema: uploadInitSchema.shape,
    },
    (input) => invoke(() => handleInitializeUpload(client, input)),
  );

  server.registerTool(
    "register_evidence",
    {
      description: "Register uploaded evidence and create its pending human review.",
      inputSchema: evidenceCreateInputSchema.shape,
    },
    (input) => invoke(() => client.createEvidence(input)),
  );

  server.registerTool(
    "compose_evidence_packet",
    {
      description: "Compose existing evidence into a packet without posting to the ledger.",
      inputSchema: evidenceComposeInputSchema.shape,
    },
    (input) =>
      invoke(() =>
        client.composeEvidence({
          evidenceIds: input.evidenceIds,
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.voiceTranscript !== undefined ? { voiceTranscript: input.voiceTranscript } : {}),
        }),
      ),
  );

  server.registerTool(
    "extract_evidence",
    {
      description: "Run evidence extraction; resulting suggestions still require human review.",
      inputSchema: idInput,
    },
    ({ evidenceId }) => invoke(async () => (await client.extractEvidence(evidenceId)) ?? null),
  );

  server.registerTool(
    "submit_enrichment_proposal",
    {
      description: "Create a pending enrichment work item that requires explicit human confirmation.",
      inputSchema: proposeEnrichmentWorkItemInputSchema.omit({ source: true }).shape,
    },
    (input) => invoke(() => handleSubmitEnrichmentProposal(client, input)),
  );

  server.registerTool(
    "submit_review_proposal",
    {
      description:
        "Attach a proposal to an open review and return the exact intent version a later human approval must echo.",
      inputSchema: submitReviewProposalInputSchema.shape,
    },
    (input) => invoke(() => handleSubmitReviewProposal(client, input)),
  );

  server.registerTool(
    "get_review_deep_link",
    {
      description: "Build the application deep link for a human to inspect a review.",
      inputSchema: reviewIdInput,
      annotations: { readOnlyHint: true },
    },
    async ({ reviewId }) => success({ reviewId, deepLink: `/today?view=queue&review=${encodeURIComponent(reviewId)}` }),
  );

  server.registerTool(
    "get_evidence",
    {
      description: "Read evidence context without triggering extraction.",
      inputSchema: idInput,
      annotations: { readOnlyHint: true },
    },
    ({ evidenceId }) => invoke(async () => (await client.getEvidenceContext(evidenceId)) ?? null),
  );

  server.registerTool(
    "list_reviews",
    {
      description: "List the bounded review feed.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => invoke(() => client.getReviewFeed()),
  );

  server.registerTool(
    "get_journal",
    {
      description: "Read journal projections, optionally bounded by booking date.",
      inputSchema: reportRangeInput,
      annotations: { readOnlyHint: true },
    },
    (range) => invoke(() => client.getJournal(compactReportRange(range))),
  );

  server.registerTool(
    "get_trial_balance",
    {
      description: "Read trial-balance projections, optionally bounded by booking date.",
      inputSchema: reportRangeInput,
      annotations: { readOnlyHint: true },
    },
    (range) => invoke(() => client.getTrialBalance(compactReportRange(range))),
  );

  server.registerTool(
    "get_integrity",
    {
      description: "Read the append-only ledger hash-chain integrity summary.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => invoke(() => client.getIntegritySummary()),
  );

  server.registerTool(
    "query_knowledge",
    {
      description: "Query sourced accounting knowledge and return passage provenance.",
      inputSchema: knowledgeQuerySchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ query }) => invoke(() => client.queryKnowledge(query)),
  );

  return server;
}

export function createMcpServerFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): McpServer {
  return createMcpServer(createMcpApiClientFromEnv(env));
}
