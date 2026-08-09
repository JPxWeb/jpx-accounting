import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { buildListProjection, buildValuedMovementList } from "@jpx-accounting/domain";

function event(id: string, eventType: LedgerEvent["eventType"], payload: Record<string, unknown>): LedgerEvent {
  return {
    id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: "sku_1",
    eventType,
    actorId: "user:test",
    occurredAt: "2026-08-09T10:00:00.000Z",
    payload,
    previousHash: id === "evt_value" ? "GENESIS" : "sha256_inventory",
    eventHash: `sha256_${id.padEnd(64, "0").slice(0, 64)}`,
    digestDate: "2026-08-09",
  };
}

const valuedPayload = {
  movementId: "mov_value_1",
  skuId: "sku_1",
  quantity: 2,
  uom: "st",
  direction: "in",
  lineId: "ln_value_1",
  unitCost: 15.555,
  currency: "SEK",
  bookedAt: "2026-08-09",
} as const;

function recorded(id: string, enrichmentId: string, payload: Record<string, unknown> = valuedPayload): LedgerEvent {
  return event(id, "LineEnrichmentRecorded", {
    lineId: payload.lineId,
    enrichmentId,
    enrichmentType: "valued_inventory_movement",
    payload,
  });
}

test("valued list derives rounded extended amount and excludes quantity-only events", () => {
  const rows = buildValuedMovementList([
    event("evt_quantity", "InventoryMovementRecorded", {
      movementId: "mov_quantity",
      skuId: "sku_1",
      quantity: 9,
      uom: "st",
      direction: "in",
      lineId: "ln_quantity",
      bookedAt: "2026-08-09",
    }),
    recorded("evt_value", "enr_value"),
  ]);

  assert.deepEqual(rows, [
    {
      id: "mov_value_1",
      kind: "valued_movement",
      ...valuedPayload,
      extendedAmount: 31.11,
    },
  ]);
});

test("valued replay preserves UOM and first movement identity", () => {
  const kgPayload = {
    ...valuedPayload,
    movementId: "mov_value_2",
    quantity: 3,
    uom: "kg",
    lineId: "ln_value_2",
    unitCost: 4,
  } as const;

  const rows = buildValuedMovementList([
    recorded("evt_value", "enr_value"),
    recorded("evt_kg", "enr_kg", kgPayload),
    recorded("evt_duplicate", "enr_duplicate", {
      ...kgPayload,
      quantity: 99,
      unitCost: 99,
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.uom, row.quantity, row.extendedAmount]),
    [
      ["st", 2, 31.11],
      ["kg", 3, 12],
    ],
  );
});

test("valued replay excludes superseded and mismatched line payloads", () => {
  const replacementPayload = {
    ...valuedPayload,
    movementId: "mov_value_2",
    lineId: "ln_value_1",
    unitCost: 20,
  } as const;

  const rows = buildValuedMovementList([
    recorded("evt_value", "enr_value"),
    event("evt_supersede", "LineEnrichmentSuperseded", {
      lineId: "ln_value_1",
      priorEnrichmentId: "enr_value",
      replacementEnrichmentId: "enr_replacement",
    }),
    recorded("evt_replacement", "enr_replacement", replacementPayload),
    event("evt_mismatch", "LineEnrichmentRecorded", {
      lineId: "ln_wrapper",
      enrichmentId: "enr_mismatch",
      enrichmentType: "valued_inventory_movement",
      payload: {
        ...valuedPayload,
        movementId: "mov_mismatch",
        lineId: "ln_payload",
      },
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.movementId),
    ["mov_value_2"],
  );
});

test("valued movement builder is registered on the generic projection seam", () => {
  const events = [recorded("evt_value", "enr_value")];
  assert.deepEqual(buildListProjection("valued_movement", events), buildValuedMovementList(events));
});
