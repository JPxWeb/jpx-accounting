import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEvent } from "@jpx-accounting/contracts";
import { buildListProjection, buildSkuMovementList } from "@jpx-accounting/domain";

function event(id: string, payload: Record<string, unknown>): LedgerEvent {
  return {
    id,
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    aggregateType: "ledger",
    aggregateId: "sku_1",
    eventType: "InventoryMovementRecorded",
    actorId: "user:test",
    occurredAt: "2026-08-09T10:00:00.000Z",
    payload,
    previousHash: id === "evt_in" ? "GENESIS" : "sha256_inventory",
    eventHash: `sha256_${id.padEnd(64, "0").slice(0, 64)}`,
    digestDate: "2026-08-09",
  };
}

const movement = {
  movementId: "mov_1",
  skuId: "sku_1",
  quantity: 5,
  uom: "st",
  direction: "in",
  lineId: "ln_1",
  bookedAt: "2026-08-09",
} as const;

test("SKU movements expose quantity only and deterministic running quantities", () => {
  const rows = buildSkuMovementList([
    event("evt_in", movement),
    event("evt_out", {
      ...movement,
      movementId: "mov_2",
      quantity: 2,
      direction: "out",
      lineId: "ln_2",
      bookedAt: "2026-08-10",
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.runningQuantity),
    [5, 3],
  );
  assert.equal(Object.hasOwn(rows[0]!, "unitCost"), false);
});

test("running quantities are isolated per SKU", () => {
  const rows = buildSkuMovementList([
    event("evt_in", movement),
    event("evt_other", {
      ...movement,
      movementId: "mov_2",
      skuId: "sku_2",
      quantity: 7,
      lineId: "ln_2",
    }),
    event("evt_out", {
      ...movement,
      movementId: "mov_3",
      quantity: 2,
      direction: "out",
      lineId: "ln_3",
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.runningQuantity),
    [5, 7, 3],
  );
});

test("running quantities are isolated per unit of measure for the same SKU", () => {
  const rows = buildSkuMovementList([
    event("evt_in", movement),
    event("evt_kg_in", {
      ...movement,
      movementId: "mov_2",
      quantity: 2,
      uom: "kg",
      lineId: "ln_2",
    }),
    event("evt_st_out", {
      ...movement,
      movementId: "mov_3",
      quantity: 1,
      direction: "out",
      lineId: "ln_3",
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.uom, row.runningQuantity]),
    [
      ["st", 5],
      ["kg", 2],
      ["st", 4],
    ],
  );
});

test("first movement identity remains authoritative during replay", () => {
  const rows = buildSkuMovementList([
    event("evt_in", movement),
    event("evt_duplicate", {
      ...movement,
      quantity: 99,
      direction: "out",
    }),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.quantity, 5);
  assert.equal(rows[0]?.runningQuantity, 5);
});

test("SKU movement builder is registered on the generic projection seam", () => {
  const events = [event("evt_in", movement)];

  assert.deepEqual(buildListProjection("sku_movement", events), buildSkuMovementList(events));
});
