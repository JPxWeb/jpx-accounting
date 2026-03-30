import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { authMiddleware } from "../../services/api/src/middleware/auth";

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
      supabaseServiceRoleKey: "fake-key",
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
  app.get("/test", (c) => c.json({ userId: c.get("userId") }));

  const res = await app.request("/test", {
    headers: { Authorization: "Bearer test-token" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, "user_test");
});
