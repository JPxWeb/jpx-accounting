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

import type { McpHttpToolDefinition, McpHttpToolHandlers } from "./http-adapter";
import { handleInitializeUpload, handleSubmitEnrichmentProposal, handleSubmitReviewProposal } from "./tools/handlers";

const idInputSchema = z.object({ evidenceId: z.string().min(1) });
const reviewIdInputSchema = z.object({ reviewId: z.string().min(1) });
const reportRangeInputSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
const emptyInputSchema = z.object({});
const enrichmentInputSchema = proposeEnrichmentWorkItemInputSchema.omit({ source: true });

const tools = [
  {
    name: "initialize_upload",
    description: "Mint a short-lived HTTPS SAS credential for an evidence upload.",
    schema: uploadInitSchema,
  },
  {
    name: "register_evidence",
    description: "Register uploaded evidence and create its pending human review.",
    schema: evidenceCreateInputSchema,
  },
  {
    name: "compose_evidence_packet",
    description: "Compose existing evidence into a packet without posting to the ledger.",
    schema: evidenceComposeInputSchema,
  },
  {
    name: "extract_evidence",
    description: "Run evidence extraction; resulting suggestions still require human review.",
    schema: idInputSchema,
  },
  {
    name: "submit_enrichment_proposal",
    description: "Create a pending enrichment work item that requires explicit human confirmation.",
    schema: enrichmentInputSchema,
  },
  {
    name: "submit_review_proposal",
    description: "Attach a proposal to an open review for later human approval.",
    schema: submitReviewProposalInputSchema,
  },
  {
    name: "get_review_deep_link",
    description: "Build the application deep link for a human to inspect a review.",
    schema: reviewIdInputSchema,
    readOnly: true,
  },
  {
    name: "get_evidence",
    description: "Read evidence context without triggering extraction.",
    schema: idInputSchema,
    readOnly: true,
  },
  {
    name: "list_reviews",
    description: "List the bounded review feed.",
    schema: emptyInputSchema,
    readOnly: true,
  },
  {
    name: "get_journal",
    description: "Read journal projections, optionally bounded by booking date.",
    schema: reportRangeInputSchema,
    readOnly: true,
  },
  {
    name: "get_trial_balance",
    description: "Read trial-balance projections, optionally bounded by booking date.",
    schema: reportRangeInputSchema,
    readOnly: true,
  },
  {
    name: "get_integrity",
    description: "Read the append-only ledger hash-chain integrity summary.",
    schema: emptyInputSchema,
    readOnly: true,
  },
  {
    name: "query_knowledge",
    description: "Query sourced accounting knowledge and return passage provenance.",
    schema: knowledgeQuerySchema,
    readOnly: true,
  },
] as const;

function definitions(): McpHttpToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema) as Record<string, unknown>,
    ...("readOnly" in tool ? { annotations: { readOnlyHint: true } } : {}),
  }));
}

function compactReportRange(range: { from?: string | undefined; to?: string | undefined }) {
  return {
    ...(range.from !== undefined ? { from: range.from } : {}),
    ...(range.to !== undefined ? { to: range.to } : {}),
  };
}

export function createMcpHttpToolHandlers(
  clientForRequest: (request: Request) => AccountingApiClient,
): McpHttpToolHandlers {
  return {
    async list() {
      return definitions();
    },
    async call(name, input, request) {
      const client = clientForRequest(request);
      switch (name) {
        case "initialize_upload":
          return handleInitializeUpload(client, uploadInitSchema.parse(input));
        case "register_evidence":
          return client.createEvidence(evidenceCreateInputSchema.parse(input));
        case "compose_evidence_packet": {
          const parsed = evidenceComposeInputSchema.parse(input);
          return client.composeEvidence({
            evidenceIds: parsed.evidenceIds,
            ...(parsed.note !== undefined ? { note: parsed.note } : {}),
            ...(parsed.voiceTranscript !== undefined ? { voiceTranscript: parsed.voiceTranscript } : {}),
          });
        }
        case "extract_evidence":
          return client.extractEvidence(idInputSchema.parse(input).evidenceId);
        case "submit_enrichment_proposal":
          return handleSubmitEnrichmentProposal(client, enrichmentInputSchema.parse(input));
        case "submit_review_proposal":
          return handleSubmitReviewProposal(client, submitReviewProposalInputSchema.parse(input));
        case "get_review_deep_link": {
          const { reviewId } = reviewIdInputSchema.parse(input);
          return { reviewId, deepLink: `/today?view=queue&review=${encodeURIComponent(reviewId)}` };
        }
        case "get_evidence":
          return client.getEvidenceContext(idInputSchema.parse(input).evidenceId);
        case "list_reviews":
          emptyInputSchema.parse(input);
          return client.getReviewFeed();
        case "get_journal":
          return client.getJournal(compactReportRange(reportRangeInputSchema.parse(input)));
        case "get_trial_balance":
          return client.getTrialBalance(compactReportRange(reportRangeInputSchema.parse(input)));
        case "get_integrity":
          emptyInputSchema.parse(input);
          return client.getIntegritySummary();
        case "query_knowledge":
          return client.queryKnowledge(knowledgeQuerySchema.parse(input).query);
        default:
          throw new Error(`Unknown MCP tool: ${name}`);
      }
    },
  };
}
