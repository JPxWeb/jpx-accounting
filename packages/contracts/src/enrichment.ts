import { z } from "zod";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", { message: "URL must use https" });

export const enrichmentProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("noop") }),
  z.object({
    kind: z.literal("external_reference_link"),
    url: httpsUrlSchema,
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("external_reference_unlink"),
    refId: z.string().min(1),
  }),
]);

export const externalReferenceLinkedPayloadSchema = z.object({
  refId: z.string().min(1),
  voucherId: z.string().min(1),
  url: httpsUrlSchema,
  label: z.string().optional(),
});

export const externalReferenceRemovedPayloadSchema = z.object({
  refId: z.string().min(1),
  voucherId: z.string().min(1),
});

export const externalReferenceProjectionSchema = externalReferenceLinkedPayloadSchema.extend({
  linkedAt: z.string().min(1),
  linkedBy: z.string().min(1),
  removed: z.boolean(),
  removedAt: z.string().min(1).optional(),
  removedBy: z.string().min(1).optional(),
});

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
export type ExternalReferenceLinkedPayload = z.infer<typeof externalReferenceLinkedPayloadSchema>;
export type ExternalReferenceRemovedPayload = z.infer<typeof externalReferenceRemovedPayloadSchema>;
export type ExternalReferenceProjection = z.infer<typeof externalReferenceProjectionSchema>;
export type EnrichmentTargetKind = z.infer<typeof enrichmentTargetKindSchema>;
export type EnrichmentWorkItemStatus = z.infer<typeof enrichmentWorkItemStatusSchema>;
export type EnrichmentWorkItemSource = z.infer<typeof enrichmentWorkItemSourceSchema>;
export type EnrichmentWorkItem = z.infer<typeof enrichmentWorkItemSchema>;
export type ProposeEnrichmentWorkItemInput = z.infer<typeof proposeEnrichmentWorkItemInputSchema>;
