import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function appWith(store: MemoryLedgerStore) {
  const deps = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  return createApp({ ...deps, store, allowTestReset: false });
}

test("GET /api/lists/projects returns the derived empty list without appending", async () => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];
  const before = await store.getEvents();

  const response = await appWith(store).request("http://localhost/api/lists/projects");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.deepEqual(await store.getEvents(), before);
});

test("POST /api/projects registers a project and GET returns it", async () => {
  const store = new MemoryLedgerStore();
  const app = appWith(store);

  const created = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "proj_1", name: "Bridge retrofit" }),
  });

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    projectId: "proj_1",
    name: "Bridge retrofit",
    status: "active",
  });

  const listed = await app.request("http://localhost/api/lists/projects");
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [
    {
      id: "proj_1",
      kind: "project",
      name: "Bridge retrofit",
      status: "active",
      activityCount: 0,
    },
  ]);
});
