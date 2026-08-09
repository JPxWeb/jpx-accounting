import {
  externalReferenceLinkedPayloadSchema,
  externalReferenceRemovedPayloadSchema,
  voucherTagsAddedPayloadSchema,
  voucherTagsRemovedPayloadSchema,
  type ExternalReferenceProjection,
  type LedgerEvent,
  type VoucherTagsProjection as ContractVoucherTagsProjection,
} from "@jpx-accounting/contracts";

export type TagDefinition = { id: string; name: string; color?: string };
export type VoucherTagsProjection = ContractVoucherTagsProjection;

export const MAX_TAGS_PER_REQUEST = 10;
export const MAX_TAGS_PER_VOUCHER = 50;
export const DEFAULT_TAG_DEFINITIONS = [
  { id: "tag_travel", name: "Travel" },
] as const satisfies readonly TagDefinition[];

export type ExternalReferenceEvent = Pick<LedgerEvent, "eventType" | "payload" | "occurredAt" | "actorId">;
export type VoucherTagEvent = Pick<LedgerEvent, "eventType" | "payload">;

export function buildVoucherTagsFromEvents(events: VoucherTagEvent[]): VoucherTagsProjection[] {
  const tagsByVoucher = new Map<string, Set<string>>();

  for (const event of events) {
    if (event.eventType === "VoucherTagsAdded") {
      const payload = voucherTagsAddedPayloadSchema.parse(event.payload);
      const activeTags = tagsByVoucher.get(payload.voucherId) ?? new Set<string>();
      for (const tagId of payload.tagIds) activeTags.add(tagId);
      tagsByVoucher.set(payload.voucherId, activeTags);
      continue;
    }

    if (event.eventType === "VoucherTagsRemoved") {
      const payload = voucherTagsRemovedPayloadSchema.parse(event.payload);
      const activeTags = tagsByVoucher.get(payload.voucherId) ?? new Set<string>();
      for (const tagId of payload.tagIds) activeTags.delete(tagId);
      tagsByVoucher.set(payload.voucherId, activeTags);
    }
  }

  return [...tagsByVoucher].map(([voucherId, tagIds]) => ({ voucherId, tagIds: [...tagIds] }));
}

export function buildExternalReferencesFromEvents(events: ExternalReferenceEvent[]): ExternalReferenceProjection[] {
  const references = new Map<string, ExternalReferenceProjection>();

  for (const event of events) {
    if (event.eventType === "ExternalReferenceLinked") {
      const payload = externalReferenceLinkedPayloadSchema.parse(event.payload);
      references.set(payload.refId, {
        ...payload,
        linkedAt: event.occurredAt,
        linkedBy: event.actorId,
        removed: false,
      });
      continue;
    }

    if (event.eventType === "ExternalReferenceRemoved") {
      const payload = externalReferenceRemovedPayloadSchema.parse(event.payload);
      const linked = references.get(payload.refId);
      if (!linked || linked.voucherId !== payload.voucherId) continue;
      references.set(payload.refId, {
        ...linked,
        removed: true,
        removedAt: event.occurredAt,
        removedBy: event.actorId,
      });
    }
  }

  return [...references.values()];
}

export function findActiveExternalReference(
  events: ExternalReferenceEvent[],
  voucherId: string,
  refId: string,
): ExternalReferenceProjection | undefined {
  return buildExternalReferencesFromEvents(events).find(
    (reference) => reference.voucherId === voucherId && reference.refId === refId && !reference.removed,
  );
}
