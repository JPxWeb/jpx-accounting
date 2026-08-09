import { z } from "zod";

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:", { message: "URL must use https" });

const lineEnrichmentValueSchema = z.object({
  enrichmentType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

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
  z.object({
    kind: z.literal("voucher_tags_add"),
    tagIds: z.array(z.string().min(1)).min(1).max(10),
  }),
  z.object({
    kind: z.literal("voucher_tags_remove"),
    tagIds: z.array(z.string().min(1)).min(1).max(10),
  }),
  lineEnrichmentValueSchema.extend({
    kind: z.literal("line_enrichment_record"),
    lineId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("line_enrichment_supersede"),
    lineId: z.string().min(1),
    priorEnrichmentId: z.string().min(1),
    replacement: lineEnrichmentValueSchema,
  }),
]);

export const lineEnrichmentRecordedPayloadSchema = lineEnrichmentValueSchema.extend({
  lineId: z.string().min(1),
  enrichmentId: z.string().min(1),
});

export const lineEnrichmentSupersededPayloadSchema = z.object({
  lineId: z.string().min(1),
  priorEnrichmentId: z.string().min(1),
  replacementEnrichmentId: z.string().min(1),
});

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

const voucherTagsPayloadSchema = z.object({
  voucherId: z.string().min(1),
  tagIds: z.array(z.string().min(1)).min(1).max(10),
  actorId: z.string().min(1),
});

export const voucherTagsAddedPayloadSchema = voucherTagsPayloadSchema;
export const voucherTagsRemovedPayloadSchema = voucherTagsPayloadSchema;
export const appendVoucherTagsInputSchema = voucherTagsPayloadSchema
  .pick({ tagIds: true })
  .extend({ mode: z.enum(["add", "remove"]) });
export const voucherTagsProjectionSchema = z.object({
  voucherId: z.string().min(1),
  tagIds: z.array(z.string().min(1)).max(50),
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

export const reviewEnrichmentIntentSchema = z.object({
  reviewId: z.string().min(1),
  voucherId: z.string().min(1),
  proposals: z.array(enrichmentProposalSchema).min(1),
  updatedAt: z.string().min(1),
  updatedBy: z.string().min(1),
});

/**
 * Actor attribution is server-owned. Zod strips unknown client keys, including
 * a forged actorId, before this input reaches a store.
 */
export const attachReviewEnrichmentIntentInputSchema = z.object({
  reviewId: z.string().min(1),
  proposals: z.array(enrichmentProposalSchema).min(1),
});

/**
 * Review proposals remain pre-post intents. Actor attribution is server-owned;
 * unknown client keys are stripped before the request reaches the store.
 */
export const submitReviewProposalInputSchema = z.object({
  reviewId: z.string().min(1),
  voucherId: z.string().min(1),
  proposals: z.array(enrichmentProposalSchema).min(1),
});

export const submitReviewProposalResultSchema = z.object({
  reviewId: z.string().min(1),
  deepLink: z.string().min(1),
  status: z.literal("pending_review"),
});

export type EnrichmentProposal = z.infer<typeof enrichmentProposalSchema>;
export type LineEnrichmentRecordedPayload = z.infer<typeof lineEnrichmentRecordedPayloadSchema>;
export type LineEnrichmentSupersededPayload = z.infer<typeof lineEnrichmentSupersededPayloadSchema>;
export type ExternalReferenceLinkedPayload = z.infer<typeof externalReferenceLinkedPayloadSchema>;
export type ExternalReferenceRemovedPayload = z.infer<typeof externalReferenceRemovedPayloadSchema>;
export type ExternalReferenceProjection = z.infer<typeof externalReferenceProjectionSchema>;
export type VoucherTagsAddedPayload = z.infer<typeof voucherTagsAddedPayloadSchema>;
export type VoucherTagsRemovedPayload = z.infer<typeof voucherTagsRemovedPayloadSchema>;
export type AppendVoucherTagsInput = z.infer<typeof appendVoucherTagsInputSchema>;
export type VoucherTagsProjection = z.infer<typeof voucherTagsProjectionSchema>;
export type EnrichmentTargetKind = z.infer<typeof enrichmentTargetKindSchema>;
export type EnrichmentWorkItemStatus = z.infer<typeof enrichmentWorkItemStatusSchema>;
export type EnrichmentWorkItemSource = z.infer<typeof enrichmentWorkItemSourceSchema>;
export type EnrichmentWorkItem = z.infer<typeof enrichmentWorkItemSchema>;
export type ProposeEnrichmentWorkItemInput = z.infer<typeof proposeEnrichmentWorkItemInputSchema>;
export type ReviewEnrichmentIntent = z.infer<typeof reviewEnrichmentIntentSchema>;
export type AttachReviewEnrichmentIntentInput = z.infer<typeof attachReviewEnrichmentIntentInputSchema>;
export type SubmitReviewProposalInput = z.infer<typeof submitReviewProposalInputSchema>;
export type SubmitReviewProposalResult = z.infer<typeof submitReviewProposalResultSchema>;
