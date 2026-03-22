import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

test("demo runtime exposes the seeded workspace", async () => {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    azureOpenAi: {},
  });
  const app = createApp({
    ...dependencies,
    allowTestReset: false,
  });

  const response = await app.request("http://localhost/api/workspace");
  assert.equal(response.status, 200);

  const payload = (await response.json()) as { reviews: unknown[] };
  assert.equal(payload.reviews.length, 1);
});

test("normal runtime fails closed instead of returning demo data", async () => {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "normal",
    allowTestReset: false,
    azureOpenAi: {},
  });
  const app = createApp({
    ...dependencies,
    allowTestReset: false,
  });

  const workspace = await app.request("http://localhost/api/workspace");
  assert.equal(workspace.status, 503);
  assert.match(await workspace.text(), /unavailable/i);

  const health = await app.request("http://localhost/health");
  assert.equal(health.status, 200);
  assert.match(await health.text(), /normal/);
});
