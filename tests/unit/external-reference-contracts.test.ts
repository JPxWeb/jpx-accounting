import assert from "node:assert/strict";
import { test } from "node:test";

import {
  enrichmentProposalSchema,
  eventTypeSchema,
  externalReferenceLinkedPayloadSchema,
  externalReferenceProjectionSchema,
  externalReferenceRemovedPayloadSchema,
} from "@jpx-accounting/contracts";

test("eventTypeSchema includes external reference events", () => {
  assert.ok(eventTypeSchema.options.includes("ExternalReferenceLinked"));
  assert.ok(eventTypeSchema.options.includes("ExternalReferenceRemoved"));
});

test("external reference link contracts accept https URLs", () => {
  const payload = externalReferenceLinkedPayloadSchema.parse({
    refId: "eref_1",
    voucherId: "voucher_1",
    url: "https://example.com/invoice/1",
    label: "Supplier portal",
  });
  const proposal = enrichmentProposalSchema.parse({
    kind: "external_reference_link",
    url: "https://example.com/invoice/1",
    label: "Supplier portal",
  });

  assert.equal(payload.refId, "eref_1");
  assert.equal(proposal.kind, "external_reference_link");
});

test("external reference link contracts reject non-https URLs", () => {
  assert.throws(() =>
    externalReferenceLinkedPayloadSchema.parse({
      refId: "eref_1",
      voucherId: "voucher_1",
      url: "http://example.com/invoice/1",
    }),
  );
  assert.throws(() =>
    enrichmentProposalSchema.parse({
      kind: "external_reference_link",
      url: "javascript:alert(1)",
    }),
  );
});

test("external reference remove and projection contracts preserve audit fields", () => {
  const removed = externalReferenceRemovedPayloadSchema.parse({
    refId: "eref_1",
    voucherId: "voucher_1",
  });
  const projection = externalReferenceProjectionSchema.parse({
    refId: "eref_1",
    voucherId: "voucher_1",
    url: "https://example.com/invoice/1",
    label: "Supplier portal",
    linkedAt: "2026-08-01T10:00:00.000Z",
    linkedBy: "user:abc",
    removed: true,
    removedAt: "2026-08-02T10:00:00.000Z",
    removedBy: "user:def",
  });
  const proposal = enrichmentProposalSchema.parse({
    kind: "external_reference_unlink",
    refId: "eref_1",
  });

  assert.equal(removed.refId, "eref_1");
  assert.equal(projection.removed, true);
  assert.equal(proposal.kind, "external_reference_unlink");
});
