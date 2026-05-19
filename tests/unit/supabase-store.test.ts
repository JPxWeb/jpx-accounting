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
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_test",
    workspaceId: "ws_test",
    userId: "user_test",
  });

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
  const store = new SupabaseLedgerStore(client, {
    organizationId: "org_test",
    workspaceId: "ws_test",
    userId: "user_test",
  });

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
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a", userId: "user_test" });

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

test("suggestVoucher returns undefined for a voucher outside the caller's org", async () => {
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () =>
          table === "vouchers" ? { data: null, error: null } : { data: { id: "s1", voucher_id: "v1" }, error: null };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a", userId: "user_test" });
  assert.equal(await store.suggestVoucher("v1"), undefined);
});

test("Supabase runSimulation/getCloseRun reject instead of returning fake data", async () => {
  const client = { schema: () => ({ from: () => ({}) }) } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  await assert.rejects(() => store.runSimulation({ title: "t", scenario: "s", actorId: "u" }), /not yet implemented/);
  await assert.rejects(() => store.getCloseRun(), /not yet implemented/);
});

test("saveCompanySettings attributes the audit event to the authenticated user", async () => {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    schema: () => ({
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.upsert = async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        };
        chain.insert = async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "org_a", workspaceId: "ws_a", userId: "user_real" });
  await store.saveCompanySettings({
    organizationId: "org_a",
    organizationName: "X AB",
    organizationNumber: "556677-8899",
    addressLine1: "A 1",
    postalCode: "111 22",
    city: "Stockholm",
    contactEmail: "attacker@evil.test",
  });
  const settingsRow = inserted.find((r) => "updated_by" in r);
  assert.equal(settingsRow?.updated_by, "user_real");
});
