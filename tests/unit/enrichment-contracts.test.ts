import assert from "node:assert/strict";
import { test } from "node:test";

import { enrichmentWorkItemSchema, proposeEnrichmentWorkItemInputSchema } from "@jpx-accounting/contracts";

test("enrichmentWorkItemSchema parses pending voucher proposal", () => {
  const parsed = enrichmentWorkItemSchema.parse({
    id: "ewi_1",
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    targetKind: "voucher",
    targetId: "voucher_1",
    proposedChange: { kind: "noop" },
    status: "pending_confirmation",
    source: "mcp",
    idempotencyKey: "mcp:prop:1",
    createdAt: "2026-08-09T10:00:00.000Z",
    createdBy: "user:abc",
  });

  assert.equal(parsed.status, "pending_confirmation");
});

test("proposeEnrichmentWorkItemInputSchema strips client actorId if present", () => {
  const parsed = proposeEnrichmentWorkItemInputSchema.parse({
    targetKind: "voucher",
    targetId: "voucher_1",
    proposedChange: { kind: "noop" },
    source: "ui",
    idempotencyKey: "ui:1",
    actorId: "user:forged-client",
  });

  assert.equal(parsed.source, "ui");
  assert.equal(Object.hasOwn(parsed, "actorId"), false);
  assert.equal((parsed as { actorId?: string }).actorId, undefined);
});
