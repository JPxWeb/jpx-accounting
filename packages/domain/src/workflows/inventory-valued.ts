import {
  valuedInventoryMovementPayloadSchema,
  type LedgerEvent,
  type ValuedMovementListRow,
} from "@jpx-accounting/contracts";

import { buildLineEnrichmentsFromEvents } from "../enrichment-projections";
import { round2 } from "../store-shared";

export type { ValuedMovementListRow } from "@jpx-accounting/contracts";

export function buildValuedMovementList(events: LedgerEvent[]): ValuedMovementListRow[] {
  const seenMovementIds = new Set<string>();
  const rows: ValuedMovementListRow[] = [];

  for (const enrichment of buildLineEnrichmentsFromEvents(events)) {
    if (enrichment.superseded || enrichment.enrichmentType !== "valued_inventory_movement") continue;

    const payload = valuedInventoryMovementPayloadSchema.parse(enrichment.payload);
    if (payload.lineId !== enrichment.lineId || seenMovementIds.has(payload.movementId)) continue;

    seenMovementIds.add(payload.movementId);
    rows.push({
      id: payload.movementId,
      kind: "valued_movement",
      ...payload,
      extendedAmount: round2(payload.quantity * payload.unitCost),
    });
  }

  return rows;
}
