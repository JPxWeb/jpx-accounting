import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendVoucherTagsInputSchema,
  eventTypeSchema,
  voucherTagsAddedPayloadSchema,
  voucherTagsProjectionSchema,
  voucherTagsRemovedPayloadSchema,
} from "@jpx-accounting/contracts";

test("eventTypeSchema includes voucher tag events", () => {
  assert.ok(eventTypeSchema.options.includes("VoucherTagsAdded"));
  assert.ok(eventTypeSchema.options.includes("VoucherTagsRemoved"));
});

test("voucher tag payloads require voucher, tags, and actor attribution", () => {
  const added = voucherTagsAddedPayloadSchema.parse({
    voucherId: "voucher_1",
    tagIds: ["tag_travel"],
    actorId: "user:abc",
  });
  const removed = voucherTagsRemovedPayloadSchema.parse({
    voucherId: "voucher_1",
    tagIds: ["tag_travel"],
    actorId: "user:def",
  });

  assert.deepEqual(added.tagIds, ["tag_travel"]);
  assert.equal(removed.actorId, "user:def");
});

test("voucher tag payloads reject missing, empty, and unbounded identifiers", () => {
  assert.throws(() =>
    voucherTagsAddedPayloadSchema.parse({
      voucherId: "",
      tagIds: ["tag_travel"],
      actorId: "user:abc",
    }),
  );
  assert.throws(() =>
    voucherTagsRemovedPayloadSchema.parse({
      voucherId: "voucher_1",
      tagIds: [""],
      actorId: "user:abc",
    }),
  );
  assert.throws(() =>
    voucherTagsAddedPayloadSchema.parse({
      voucherId: "voucher_1",
      tagIds: [],
      actorId: "user:abc",
    }),
  );
  assert.throws(() =>
    voucherTagsAddedPayloadSchema.parse({
      voucherId: "voucher_1",
      tagIds: Array.from({ length: 11 }, (_, index) => `tag_${index}`),
      actorId: "user:abc",
    }),
  );
});

test("voucher tag API contracts strip attribution and allow an empty active projection", () => {
  const input = appendVoucherTagsInputSchema.parse({
    tagIds: ["tag_travel"],
    mode: "remove",
    actorId: "user:forged-client",
  });
  const projection = voucherTagsProjectionSchema.parse({
    voucherId: "voucher_1",
    tagIds: [],
  });

  assert.equal(Object.hasOwn(input, "actorId"), false);
  assert.deepEqual(projection.tagIds, []);
  assert.throws(() =>
    voucherTagsProjectionSchema.parse({
      voucherId: "voucher_1",
      tagIds: Array.from({ length: 51 }, (_, index) => `tag_${index}`),
    }),
  );
});
