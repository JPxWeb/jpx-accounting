import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inventoryMovementPayloadSchema,
  valuedInventoryMovementPayloadSchema,
  valuedMovementListSchema,
} from "@jpx-accounting/contracts";

const valuedMovement = {
  movementId: "mov_value_1",
  skuId: "sku_1",
  quantity: 2,
  uom: "st",
  direction: "in",
  lineId: "ln_1",
  unitCost: 15.5,
  currency: "SEK",
  bookedAt: "2026-08-09",
} as const;

test("valued movement requires explicit unit cost and currency", () => {
  assert.deepEqual(valuedInventoryMovementPayloadSchema.parse(valuedMovement), valuedMovement);

  for (const field of ["unitCost", "currency"] as const) {
    const invalid = { ...valuedMovement } as Record<string, unknown>;
    delete invalid[field];
    assert.equal(valuedInventoryMovementPayloadSchema.safeParse(invalid).success, false);
  }
});

test("valued movement validates monetary fields and strips no unknown attribution", () => {
  assert.equal(
    valuedInventoryMovementPayloadSchema.safeParse({
      ...valuedMovement,
      unitCost: -0.01,
    }).success,
    false,
  );
  assert.equal(
    valuedInventoryMovementPayloadSchema.safeParse({
      ...valuedMovement,
      currency: "sek",
    }).success,
    false,
  );
  assert.equal(
    valuedInventoryMovementPayloadSchema.safeParse({
      ...valuedMovement,
      actorId: "user:forged",
    }).success,
    false,
  );
});

test("valued and quantity movement payloads remain distinct", () => {
  assert.equal(inventoryMovementPayloadSchema.safeParse(valuedMovement).success, false);
  assert.equal(
    valuedInventoryMovementPayloadSchema.safeParse({
      movementId: valuedMovement.movementId,
      skuId: valuedMovement.skuId,
      quantity: valuedMovement.quantity,
      uom: valuedMovement.uom,
      direction: valuedMovement.direction,
      lineId: valuedMovement.lineId,
      bookedAt: valuedMovement.bookedAt,
    }).success,
    false,
  );
});

test("valued movement list rows preserve movement identity", () => {
  const row = {
    id: valuedMovement.movementId,
    kind: "valued_movement",
    ...valuedMovement,
    extendedAmount: 31,
  } as const;

  assert.deepEqual(valuedMovementListSchema.parse([row]), [row]);
  assert.equal(valuedMovementListSchema.safeParse([{ ...row, id: "mov_other" }]).success, false);
});
