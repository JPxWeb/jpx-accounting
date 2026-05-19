import assert from "node:assert/strict";
import { test } from "node:test";
import { SupabaseLedgerStore } from "@jpx-accounting/domain";

type ChainResult = { data: unknown; error: { code?: string; message: string } | null };

function createMockSupabaseClient(options?: { failTable?: string; chainConflictOnce?: boolean }) {
  let chainReads = 0;
  let conflictInjected = false;

  function mockTable(table: string) {
    const chain = {
      eq() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle: async (): Promise<ChainResult> => {
        if (table === "events") {
          chainReads++;
          return { data: chainReads > 1 ? { event_hash: "h_prev" } : null, error: null };
        }
        return { data: null, error: null };
      },
      single: async (): Promise<ChainResult> => ({ data: null, error: null }),
      select: () => chain,
      insert: async (_row: unknown): Promise<{ error: { code?: string; message: string } | null }> => {
        if (options?.failTable === table) {
          return { error: { message: `insert failed on ${table}` } };
        }
        if (options?.chainConflictOnce && table === "events" && !conflictInjected) {
          conflictInjected = true;
          return { error: { code: "23505", message: "duplicate key" } };
        }
        return { error: null };
      },
      update: () => chain,
      upsert: async () => ({ error: null }),
    };
    return chain;
  }

  return {
    client: {
      schema: (_name: string) => ({
        from: (table: string) => mockTable(table),
      }),
    } as never,
  };
}

test("SupabaseLedgerStore.createEvidence returns evidence, voucher, and review", async () => {
  const { client } = createMockSupabaseClient();
  const store = new SupabaseLedgerStore(client, { organizationId: "org_test", workspaceId: "ws_test" });

  const result = await store.createEvidence({
    organizationId: "org_test",
    workspaceId: "ws_test",
    actorId: "user_1",
    title: "Test invoice",
    originalFilename: "test.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
  });

  assert.ok(result.evidence);
  assert.ok(result.voucher);
  assert.ok(result.review);
  assert.ok(result.voucherId);
});

test("SupabaseLedgerStore.createEvidence rejects when persistence fails", async () => {
  const { client } = createMockSupabaseClient({ failTable: "evidence_objects" });
  const store = new SupabaseLedgerStore(client, { organizationId: "org_test", workspaceId: "ws_test" });

  await assert.rejects(
    () =>
      store.createEvidence({
        organizationId: "org_test",
        workspaceId: "ws_test",
        actorId: "user_1",
        title: "Test invoice",
        originalFilename: "test.pdf",
        mimeType: "application/pdf",
        modalities: ["pdf", "upload"],
      }),
    /Failed to persist evidence/,
  );
});

test("appendEvent retries on hash-chain unique violation", async () => {
  const { client } = createMockSupabaseClient({ chainConflictOnce: true });
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a" });

  await assert.doesNotReject(() =>
    store.createEvidence({
      organizationId: "org_a",
      workspaceId: "ws_a",
      actorId: "user_1",
      title: "Chain test",
      originalFilename: "chain.pdf",
      mimeType: "application/pdf",
      modalities: ["pdf", "upload"],
    }),
  );
});
