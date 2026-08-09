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

test("invoice list routes return exact derived JSON without appending", async () => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];
  const app = appWith(store);

  const open = await app.request("http://localhost/api/lists/open-invoices");
  const history = await app.request("http://localhost/api/lists/payment-history");

  assert.equal(open.status, 200);
  assert.equal(history.status, 200);
  assert.deepEqual(await open.json(), []);
  assert.deepEqual(await history.json(), []);
  assert.deepEqual(await store.getEvents(), []);
});
