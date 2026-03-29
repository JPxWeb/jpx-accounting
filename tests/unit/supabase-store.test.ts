import assert from "node:assert/strict";
import { test } from "node:test";
import { SupabaseLedgerStore } from "@jpx-accounting/domain";

function createMockSupabaseClient() {
  function mockTable(_table: string) {
    return {
      insert: (data: unknown) => {
        return {
          select: () => ({ single: async () => ({ data, error: null }) }),
        };
      },
      select: (_columns?: string) => {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          single: async () => ({ data: null, error: null }),
        };
        return chain;
      },
      update: (data: unknown) => {
        return { eq: () => ({ select: () => ({ single: async () => ({ data, error: null }) }) }) };
      },
    };
  }

  return { client: { from: (t: string) => mockTable(t) } as never };
}

test("SupabaseLedgerStore.createEvidence returns evidence, voucher, and review", () => {
  const { client } = createMockSupabaseClient();
  const store = new SupabaseLedgerStore(client, { organizationId: "org_test", workspaceId: "ws_test" });

  const result = store.createEvidence({
    organizationId: "org_test",
    workspaceId: "ws_test",
    actorId: "user_1",
    title: "Test invoice",
    originalFilename: "test.pdf",
    mimeType: "application/pdf",
    modalities: ["pdf", "upload"],
  });

  assert.ok(result.evidence, "should return evidence");
  assert.ok(result.voucher, "should return voucher");
  assert.ok(result.review, "should return review");
  assert.ok(result.voucherId, "should return voucherId");
});
