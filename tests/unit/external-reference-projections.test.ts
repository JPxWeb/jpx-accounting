import assert from "node:assert/strict";
import { test } from "node:test";

import { buildExternalReferencesFromEvents } from "@jpx-accounting/domain";

test("external reference replay projects linked references", () => {
  const rows = buildExternalReferencesFromEvents([
    {
      eventType: "ExternalReferenceLinked",
      occurredAt: "2026-08-01T10:00:00.000Z",
      actorId: "user:abc",
      payload: {
        refId: "eref_1",
        voucherId: "voucher_1",
        url: "https://example.com/a",
        label: "Supplier portal",
      },
    },
  ]);

  assert.deepEqual(rows, [
    {
      refId: "eref_1",
      voucherId: "voucher_1",
      url: "https://example.com/a",
      label: "Supplier portal",
      linkedAt: "2026-08-01T10:00:00.000Z",
      linkedBy: "user:abc",
      removed: false,
    },
  ]);
});

test("unlink marks a projection removed without deleting link history", () => {
  const rows = buildExternalReferencesFromEvents([
    {
      eventType: "ExternalReferenceLinked",
      occurredAt: "2026-08-01T10:00:00.000Z",
      actorId: "user:abc",
      payload: { refId: "eref_1", voucherId: "voucher_1", url: "https://example.com/a" },
    },
    {
      eventType: "ExternalReferenceRemoved",
      occurredAt: "2026-08-02T10:00:00.000Z",
      actorId: "user:def",
      payload: { refId: "eref_1", voucherId: "voucher_1" },
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.removed, true);
  assert.equal(rows[0]?.url, "https://example.com/a");
  assert.equal(rows[0]?.removedAt, "2026-08-02T10:00:00.000Z");
  assert.equal(rows[0]?.removedBy, "user:def");
});

test("external reference replay ignores unrelated events and unknown removals", () => {
  const rows = buildExternalReferencesFromEvents([
    {
      eventType: "VoucherCreated",
      occurredAt: "2026-08-01T09:00:00.000Z",
      actorId: "user:abc",
      payload: { refId: "eref_unrelated" },
    },
    {
      eventType: "ExternalReferenceRemoved",
      occurredAt: "2026-08-01T10:00:00.000Z",
      actorId: "user:abc",
      payload: { refId: "eref_missing", voucherId: "voucher_1" },
    },
  ]);

  assert.deepEqual(rows, []);
});
