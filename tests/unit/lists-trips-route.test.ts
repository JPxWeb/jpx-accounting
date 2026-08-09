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

test("GET /api/lists/trips returns an empty derived list without appending", async () => {
  const store = new MemoryLedgerStore();
  store.getEvents = async () => [];

  const response = await appWith(store).request("http://localhost/api/lists/trips");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.deepEqual(await store.getEvents(), []);
});

test("api-client validates the trips list response", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify([{ id: "invalid", kind: "trip" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const client = createAccountingApiClient({ baseUrl: "http://api.test", runtimeMode: "normal" });

  await assert.rejects(() => client.getTripsList(), /shared contract/);
});
