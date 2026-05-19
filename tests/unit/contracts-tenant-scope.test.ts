import assert from "node:assert/strict";
import { test } from "node:test";

import { tenantScopeSchema } from "@jpx-accounting/contracts";

test("tenantScopeSchema requires organizationId and workspaceId", () => {
  assert.deepEqual(tenantScopeSchema.parse({ organizationId: "org_a", workspaceId: "ws_a" }), {
    organizationId: "org_a",
    workspaceId: "ws_a",
  });
  assert.throws(() => tenantScopeSchema.parse({ organizationId: "org_a" }));
  assert.throws(() => tenantScopeSchema.parse({ workspaceId: "ws_a" }));
  assert.throws(() => tenantScopeSchema.parse({}));
});
