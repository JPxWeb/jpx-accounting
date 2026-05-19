import assert from "node:assert/strict";
import { test } from "node:test";

import { parseTenantFromClaims } from "../../services/api/src/middleware/tenant";

test("cross-org isolation guard: app_metadata wins over user_metadata", () => {
  const orgA = parseTenantFromClaims({
    sub: "u1",
    app_metadata: { organization_id: "org_a", workspace_id: "ws_a" },
    user_metadata: { organization_id: "org_b", workspace_id: "ws_b" },
  });
  assert.equal(orgA.organizationId, "org_a");
  assert.notEqual(orgA.organizationId, "org_b");
});
