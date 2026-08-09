import { z } from "zod";

export const enrichmentProposalSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("noop") })]);

export const enrichmentTargetKindSchema = z.enum(["voucher", "line"]);
export const enrichmentWorkItemStatusSchema = z.enum(["pending_confirmation", "confirmed", "rejected", "superseded"]);
export const enrichmentWorkItemSourceSchema = z.enum(["ui", "mcp", "advisor"]);

export const enrichmentWorkItemSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  targetKind: enrichmentTargetKindSchema,
  targetId: z.string().min(1),
  proposedChange: enrichmentProposalSchema,
  status: enrichmentWorkItemStatusSchema,
  source: enrichmentWorkItemSourceSchema,
  idempotencyKey: z.string().min(1),
  createdAt: z.string().min(1),
  createdBy: z.string().min(1),
  confirmedAt: z.string().min(1).optional(),
  confirmedBy: z.string().min(1).optional(),
  resultingEventIds: z.array(z.string().min(1)).optional(),
  supersededByWorkItemId: z.string().min(1).optional(),
});

/**
 * Actor and tenant attribution are server-owned. Unknown client keys are
 * intentionally stripped by Zod's default object behavior.
 */
export const proposeEnrichmentWorkItemInputSchema = z.object({
  targetKind: enrichmentTargetKindSchema,
  targetId: z.string().min(1),
  proposedChange: enrichmentProposalSchema,
  source: enrichmentWorkItemSourceSchema,
  idempotencyKey: z.string().min(1),
});

export type EnrichmentProposal = z.infer<typeof enrichmentProposalSchema>;
export type EnrichmentTargetKind = z.infer<typeof enrichmentTargetKindSchema>;
export type EnrichmentWorkItemStatus = z.infer<typeof enrichmentWorkItemStatusSchema>;
export type EnrichmentWorkItemSource = z.infer<typeof enrichmentWorkItemSourceSchema>;
export type EnrichmentWorkItem = z.infer<typeof enrichmentWorkItemSchema>;
export type ProposeEnrichmentWorkItemInput = z.infer<typeof proposeEnrichmentWorkItemInputSchema>;
