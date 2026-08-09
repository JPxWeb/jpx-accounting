import assert from "node:assert/strict";
import { test } from "node:test";

import { eventTypeSchema, inventoryMovementPayloadSchema, skuMovementListSchema } from "@jpx-accounting/contracts";

const movement = {
  movementId: "mov_1",
  skuId: "sku_1",
  quantity: 3,
  uom: "st",
  direction: "out",
  lineId: "ln_1",
  bookedAt: "2026-08-09",
} as const;

test("quantity inventory event types exist", () => {
  assert.ok(eventTypeSchema.options.includes("SkuRegistered"));
  assert.ok(eventTypeSchema.options.includes("InventoryMovementRecorded"));
});

test("quantity movement payload requires the locked identity and booking fields", () => {
  assert.deepEqual(inventoryMovementPayloadSchema.parse(movement), movement);
  assert.equal(
    inventoryMovementPayloadSchema.safeParse({
      ...movement,
      movementId: "",
    }).success,
    false,
  );
  assert.equal(
    inventoryMovementPayloadSchema.safeParse({
      ...movement,
      bookedAt: "2026-08-09T10:00:00.000Z",
    }).success,
    false,
  );
  assert.equal(
    inventoryMovementPayloadSchema.safeParse({
      ...movement,
      actorId: "forged-client-actor",
    }).success,
    false,
  );
});

test("quantity movement payload forbids valued inventory fields", () => {
  assert.equal(Object.hasOwn(inventoryMovementPayloadSchema.parse(movement), "unitCost"), false);
  assert.equal(
    inventoryMovementPayloadSchema.safeParse({
      ...movement,
      unitCost: 10,
    }).success,
    false,
  );
  assert.equal(
    inventoryMovementPayloadSchema.safeParse({
      ...movement,
      currency: "SEK",
    }).success,
    false,
  );
});

test("SKU movement list rows expose quantity and running quantity only", () => {
  const [row] = skuMovementListSchema.parse([
    {
      id: "mov_1",
      kind: "sku_movement",
      ...movement,
      runningQuantity: -3,
    },
  ]);

  assert.equal(row?.runningQuantity, -3);
  assert.equal(Object.hasOwn(row!, "unitCost"), false);
  assert.equal(
    skuMovementListSchema.safeParse([
      {
        id: "mov_other",
        kind: "sku_movement",
        ...movement,
        runningQuantity: -3,
      },
    ]).success,
    false,
  );
});
