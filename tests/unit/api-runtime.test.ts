import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../services/api/src/app";
import { readApiRuntimeConfig } from "../../services/api/src/config";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

test("demo runtime exposes the seeded workspace", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo", PORT: "0" });
  const dependencies = createApiRuntimeDependencies(config);
  const app = createApp({
    runtimeMode: dependencies.runtimeMode,
    aiRuntime: dependencies.aiRuntime,
    createLedgerStore: dependencies.createLedgerStore,
    demoStoreRef: dependencies.demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
  });

  const response = await app.request("http://localhost/api/workspace");
  assert.equal(response.status, 200);

  const payload = (await response.json()) as { reviews: unknown[] };
  assert.equal(payload.reviews.length, 1);
});

test("normal runtime fails closed instead of returning demo data", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "normal", PORT: "0" });
  const dependencies = createApiRuntimeDependencies(config);
  const app = createApp({
    runtimeMode: dependencies.runtimeMode,
    aiRuntime: dependencies.aiRuntime,
    createLedgerStore: dependencies.createLedgerStore,
    demoStoreRef: dependencies.demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
    skipAuthVerification: true,
  });

  const workspace = await app.request("http://localhost/api/workspace", {
    headers: { Authorization: "Bearer test-token" },
  });
  assert.equal(workspace.status, 503);
  assert.match(await workspace.text(), /unavailable/i);

  const health = await app.request("http://localhost/health");
  assert.equal(health.status, 200);
  assert.match(await health.text(), /normal/);
});
