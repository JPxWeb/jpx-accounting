import assert from "node:assert/strict";
import { test } from "node:test";

import { MissingTenantClaimError, parseTenantFromClaims } from "../../services/api/src/middleware/tenant";

test("cross-org isolation guard: app_metadata wins over user_metadata", () => {
  const orgA = parseTenantFromClaims({
    sub: "u1",
    app_metadata: { organization_id: "org_a", workspace_id: "ws_a" },
    user_metadata: { organization_id: "org_b", workspace_id: "ws_b" },
  });
  assert.equal(orgA.organizationId, "org_a");
  assert.notEqual(orgA.organizationId, "org_b");
});

test("parseTenantFromClaims throws when organization_id is absent", () => {
  assert.throws(
    () => parseTenantFromClaims({ sub: "u1", app_metadata: { workspace_id: "ws_a" } }),
    MissingTenantClaimError,
  );
});

test("parseTenantFromClaims throws when sub is absent", () => {
  assert.throws(
    () => parseTenantFromClaims({ app_metadata: { organization_id: "org_a", workspace_id: "ws_a" } }),
    MissingTenantClaimError,
  );
});

test("parseTenantFromClaims never falls back to a default org", () => {
  assert.throws(() => parseTenantFromClaims({ sub: "u1", app_metadata: {} }), MissingTenantClaimError);
});

test("parseTenantFromClaims throws when workspace_id is absent", () => {
  assert.throws(
    () => parseTenantFromClaims({ sub: "u1", app_metadata: { organization_id: "org_a" } }),
    MissingTenantClaimError,
  );
});

test("parseTenantFromClaims rejects a non-string organization_id", () => {
  assert.throws(
    () => parseTenantFromClaims({ sub: "u1", app_metadata: { organization_id: 1, workspace_id: "ws_a" } }),
    MissingTenantClaimError,
  );
});
