import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiRuntime } from "@jpx-accounting/ai-core";
import { MemoryLedgerStore, SupabaseLedgerStore } from "@jpx-accounting/domain";

import { createApp } from "../../services/api/src/app";
import { readApiRuntimeConfig } from "../../services/api/src/config";

type RowSink = { events: Record<string, unknown>[] };

function makeMockSupabase(sink: RowSink) {
  return {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "in"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.insert = async (row: Record<string, unknown>) => {
          if (table === "events") sink.events.push(row);
          return { error: null };
        };
        chain.update = () => chain;
        chain.upsert = async () => ({ error: null });
        return chain;
      },
    }),
  } as never;
}

test("normal-mode: createEvidence audit events attribute to skip-verification sentinel user, not request body", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "normal", PORT: "0" });
  const sink: RowSink = { events: [] };
  const mockSupabase = makeMockSupabase(sink);

  const demoStoreRef = { current: new MemoryLedgerStore() };
  const aiRuntime = createAiRuntime({ runtimeMode: "demo" }); // AI not exercised in this test

  const app = createApp({
    runtimeMode: "normal",
    aiRuntime,
    createLedgerStore: (scope) => new SupabaseLedgerStore(mockSupabase, scope),
    demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
    skipAuthVerification: true,
  });

  const response = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: {
      Authorization: "Bearer fake-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      organizationId: "org_test",
      workspaceId: "workspace_test",
      actorId: "attacker_from_body",
      title: "Integration evidence",
      originalFilename: "i.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
    }),
  });

  assert.equal(response.status, 201, await response.text());

  const evidenceEvent = sink.events.find((e) => e.event_type === "EvidenceReceived");
  const voucherEvent = sink.events.find((e) => e.event_type === "VoucherCreated");

  assert.ok(evidenceEvent, "EvidenceReceived must have been recorded");
  assert.ok(voucherEvent, "VoucherCreated must have been recorded");
  assert.equal(
    evidenceEvent.actor_id,
    "user_test",
    "EvidenceReceived actor must be the authenticated sentinel, not the body's actorId",
  );
  assert.equal(
    voucherEvent.actor_id,
    "user_test",
    "VoucherCreated actor must be the authenticated sentinel, not the body's actorId",
  );
});

test("normal-mode: request without Authorization header returns 401", async () => {
  const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "normal", PORT: "0" });
  const sink: RowSink = { events: [] };
  const mockSupabase = makeMockSupabase(sink);

  const demoStoreRef = { current: new MemoryLedgerStore() };
  const aiRuntime = createAiRuntime({ runtimeMode: "demo" });

  const app = createApp({
    runtimeMode: "normal",
    aiRuntime,
    createLedgerStore: (scope) => new SupabaseLedgerStore(mockSupabase, scope),
    demoStoreRef,
    apiConfig: config,
    allowTestReset: false,
    supabaseUrl: "https://example.supabase.co",
    supabaseSecretKey: "fake-key",
    // NOT setting skipAuthVerification — we want the real header check.
  });

  const response = await app.request("http://localhost/api/workspace");
  assert.equal(response.status, 401);
});
