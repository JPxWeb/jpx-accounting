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

test("trip writers derive actors and append one registration and close", async () => {
  const store = new MemoryLedgerStore();
  const app = appWith(store);
  const registration = {
    tripId: "trip_route",
    purpose: "Customer visit",
    traveler: "Ada",
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    actorId: "user:forged",
  };

  const created = await app.request("http://localhost/api/trips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(registration),
  });
  const duplicate = await app.request("http://localhost/api/trips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...registration, purpose: "Replacement purpose" }),
  });
  const closed = await app.request("http://localhost/api/trips/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId: "trip_route", actorId: "user:forged" }),
  });
  const replayedClose = await app.request("http://localhost/api/trips/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId: "trip_route" }),
  });
  const missingClose = await app.request("http://localhost/api/trips/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tripId: "trip_missing" }),
  });

  assert.equal(created.status, 201);
  assert.equal(duplicate.status, 201);
  assert.equal(closed.status, 201);
  assert.equal(replayedClose.status, 201);
  assert.equal(missingClose.status, 404);
  assert.equal((await duplicate.json()).purpose, "Customer visit");
  const tripEvents = (await store.getEvents()).filter(
    (event) => event.eventType === "TripRegistered" || event.eventType === "TripClosed",
  );
  assert.deepEqual(
    tripEvents.map((event) => [event.eventType, event.actorId]),
    [
      ["TripRegistered", "user_founder"],
      ["TripClosed", "user_founder"],
    ],
  );
});

test("demo api-client registers, closes, and lists a trip without network", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("demo trip methods must not fetch");
  });
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  await client.registerTrip({
    tripId: "trip_client",
    purpose: "Site visit",
    traveler: "Grace",
    startDate: "2026-08-04",
    endDate: "2026-08-05",
  });
  await client.closeTrip({ tripId: "trip_client" });

  const rows = await client.getTripsList();
  assert.equal(rows[0]?.status, "closed");
  assert.equal(fetchMock.mock.callCount(), 0);
});
