import { inventoryMovementPayloadSchema, type LedgerEvent, type SkuMovementListRow } from "@jpx-accounting/contracts";

export type { SkuMovementListRow } from "@jpx-accounting/contracts";

export function buildSkuMovementList(events: LedgerEvent[]): SkuMovementListRow[] {
  const balances = new Map<string, number>();
  const seenMovementIds = new Set<string>();
  const rows: SkuMovementListRow[] = [];

  for (const event of events) {
    if (event.eventType !== "InventoryMovementRecorded") continue;

    const payload = inventoryMovementPayloadSchema.parse(event.payload);
    if (seenMovementIds.has(payload.movementId)) continue;
    seenMovementIds.add(payload.movementId);

    const delta = payload.direction === "in" ? payload.quantity : -payload.quantity;
    const runningQuantity = (balances.get(payload.skuId) ?? 0) + delta;
    balances.set(payload.skuId, runningQuantity);
    rows.push({
      id: payload.movementId,
      kind: "sku_movement",
      ...payload,
      runningQuantity,
    });
  }

  return rows;
}
