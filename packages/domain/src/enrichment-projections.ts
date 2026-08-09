import {
  externalReferenceLinkedPayloadSchema,
  externalReferenceRemovedPayloadSchema,
  type ExternalReferenceProjection,
  type LedgerEvent,
} from "@jpx-accounting/contracts";

type ExternalReferenceEvent = Pick<LedgerEvent, "eventType" | "payload" | "occurredAt" | "actorId">;

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
