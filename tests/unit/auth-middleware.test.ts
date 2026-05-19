import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

import { authMiddleware } from "../../services/api/src/middleware/auth";
import { parseTenantFromClaims } from "../../services/api/src/middleware/tenant";

test("parseTenantFromClaims prefers app_metadata over user_metadata", () => {
  const tenant = parseTenantFromClaims({
    sub: "user_1",
    email: "test@jpx.se",
    user_metadata: { organization_id: "evil_org", workspace_id: "evil_ws" },
    app_metadata: { organization_id: "org_jpx", workspace_id: "workspace_main" },
  });

  assert.equal(tenant.organizationId, "org_jpx");
  assert.equal(tenant.workspaceId, "workspace_main");
});

test("authMiddleware skips verification in demo mode", async () => {
  const app = new Hono();
  app.use("/*", authMiddleware({ runtimeMode: "demo" }));
  app.get("/test", (c) => c.json({ userId: c.get("userId") }));

  const res = await app.request("/test");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, "user_demo");
});

test("authMiddleware returns 401 when no Authorization header in normal mode", async () => {
  const app = new Hono();
  app.use(
    "/*",
    authMiddleware({
      runtimeMode: "normal",
      supabaseUrl: "https://example.supabase.co",
      supabaseSecretKey: "fake-key",
    }),
  );
  app.get("/test", (c) => c.json({ ok: true }));

  const res = await app.request("/test");
  assert.equal(res.status, 401);
});

test("authMiddleware passes with skipVerification flag", async () => {
  const app = new Hono();
  app.use(
    "/*",
    authMiddleware({
      runtimeMode: "normal",
      skipVerification: true,
    }),
  );
  app.get("/test", (c) =>
    c.json({
      userId: c.get("userId"),
      organizationId: c.get("organizationId"),
    }),
  );

  const res = await app.request("/test", {
    headers: { Authorization: "Bearer test-token" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, "user_test");
  assert.equal(body.organizationId, "org_jpx");
});
