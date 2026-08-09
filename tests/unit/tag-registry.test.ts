import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildVoucherTagsFromEvents,
  DEFAULT_TAG_DEFINITIONS,
  MAX_TAGS_PER_REQUEST,
  MAX_TAGS_PER_VOUCHER,
  planVoucherTagsAppend,
} from "@jpx-accounting/domain";

const scope = {
  organizationId: "org_1",
  workspaceId: "workspace_1",
  now: "2026-08-09T10:00:00.000Z",
};

test("default tag registry is bounded and includes the planned travel tag", () => {
  assert.equal(MAX_TAGS_PER_REQUEST, 10);
  assert.equal(MAX_TAGS_PER_VOUCHER, 50);
  assert.deepEqual(DEFAULT_TAG_DEFINITIONS, [{ id: "tag_travel", name: "Travel" }]);
});

test("planVoucherTagsAppend rejects more than 10 tagIds", () => {
  const tooMany = Array.from({ length: 11 }, () => "tag_travel");

  assert.throws(
    () =>
      planVoucherTagsAppend(
        {
          voucherId: "voucher_1",
          tagIds: tooMany,
          mode: "add",
          existingActiveTagCount: 0,
          tagDefinitions: DEFAULT_TAG_DEFINITIONS,
          actorId: "user:test",
        },
        scope,
      ),
    /bounded/i,
  );
});

test("planVoucherTagsAppend rejects unknown tag ids and voucher overflow", () => {
  assert.throws(
    () =>
      planVoucherTagsAppend(
        {
          voucherId: "voucher_1",
          tagIds: ["tag_unbounded"],
          mode: "add",
          existingActiveTagCount: 0,
          tagDefinitions: DEFAULT_TAG_DEFINITIONS,
          actorId: "user:test",
        },
        scope,
      ),
    /registry/i,
  );
  assert.throws(
    () =>
      planVoucherTagsAppend(
        {
          voucherId: "voucher_1",
          tagIds: ["tag_travel"],
          mode: "add",
          existingActiveTagCount: 50,
          tagDefinitions: DEFAULT_TAG_DEFINITIONS,
          actorId: "user:test",
        },
        scope,
      ),
    /bounded/i,
  );
});

test("planVoucherTagsAppend emits only an append-only tag event", () => {
  const plan = planVoucherTagsAppend(
    {
      voucherId: "voucher_1",
      tagIds: ["tag_travel", "tag_travel"],
      mode: "add",
      existingActiveTagCount: 0,
      tagDefinitions: DEFAULT_TAG_DEFINITIONS,
      actorId: "user:test",
    },
    scope,
  );

  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0]?.eventType, "VoucherTagsAdded");
  assert.deepEqual(plan.events[0]?.payload.tagIds, ["tag_travel"]);
  assert.equal(
    plan.events.some((event) => event.eventType === "PostedToLedger"),
    false,
  );
});

test("buildVoucherTagsFromEvents derives active tags without rewriting history", () => {
  const events = [
    {
      eventType: "VoucherTagsAdded" as const,
      payload: { voucherId: "voucher_1", tagIds: ["tag_travel"], actorId: "user:add" },
    },
    {
      eventType: "VoucherTagsRemoved" as const,
      payload: { voucherId: "voucher_1", tagIds: ["tag_travel"], actorId: "user:remove" },
    },
  ];

  const projected = buildVoucherTagsFromEvents(events);

  assert.deepEqual(projected, [{ voucherId: "voucher_1", tagIds: [] }]);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.eventType, "VoucherTagsAdded");
});
