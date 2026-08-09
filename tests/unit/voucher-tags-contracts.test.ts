import assert from "node:assert/strict";
import { test } from "node:test";

import {
  eventTypeSchema,
  voucherTagsAddedPayloadSchema,
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
