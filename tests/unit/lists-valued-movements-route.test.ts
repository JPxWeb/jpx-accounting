import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccountingApiClient } from "@jpx-accounting/api-client";
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

test("valued movement list route exists independently of the web flag", async () => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];

  const response = await appWith(store).request("http://localhost/api/lists/valued-movements");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.deepEqual(await store.getEvents(), []);
});

test("valued movement list clients validate HTTP and offline rows", async (t) => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];
  const app = appWith(store);
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) =>
    app.request(String(input), init),
  );
  const httpClient = createAccountingApiClient({
    baseUrl: "http://localhost",
    runtimeMode: "normal",
  });
  const offlineClient = createAccountingApiClient({ runtimeMode: "demo" });

  assert.deepEqual(await httpClient.getValuedMovementsList(), []);
  assert.deepEqual(await offlineClient.getValuedMovementsList(), []);
});
