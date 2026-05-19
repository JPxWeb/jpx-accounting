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

test("getReviewFeed skips the suggestion batch when all rows carry embedded suggestions", async () => {
  let suggestionReads = 0;
  const reviews = [
    {
      id: "r1",
      voucher_id: "v1",
      title: "a",
      status: "needs-review",
      suggested_action: "x",
      provenance_timeline: [],
      suggestion: {
        id: "s1",
        voucherId: "v1",
        accountNumber: "6540",
        accountName: "IT-tjänster",
        vatCode: "VAT25",
        confidence: 0.9,
        reasoning: "r",
        kind: "recommendation",
        citations: [],
        ruleHits: [],
      },
    },
  ];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = { _table: table };
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.order = async () => ({ data: reviews, error: null });
        chain.in = async () => {
          suggestionReads++;
          return { data: [], error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const feed = await store.getReviewFeed();
  assert.equal(feed.length, 1);
  assert.equal(suggestionReads, 0);
});

test("getReviewFeed fetches suggestions in one batched query", async () => {
  let suggestionReads = 0;
  const reviews = [
    {
      id: "r1",
      voucher_id: "v1",
      title: "a",
      status: "needs-review",
      suggested_action: "x",
      provenance_timeline: [],
    },
    {
      id: "r2",
      voucher_id: "v2",
      title: "b",
      status: "needs-review",
      suggested_action: "x",
      provenance_timeline: [],
    },
  ];
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = { _table: table };
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.order = async () => ({ data: reviews, error: null });
        chain.in = async () => {
          suggestionReads++;
          return { data: [], error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const feed = await store.getReviewFeed();
  assert.equal(feed.length, 2);
  assert.equal(suggestionReads, 1);
});

test("getBalances reads the maintained aggregate table, not journal_entries", async () => {
  let journalReads = 0;
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.order = async () => {
          if (table === "journal_entries") {
            journalReads++;
            return { data: [], error: null };
          }
          if (table === "account_balances")
            return {
              data: [
                {
                  account_number: "6540",
                  account_name: "IT-tjänster",
                  debit: 1000,
                  credit: 0,
                  balance: 1000,
                },
              ],
              error: null,
            };
          return { data: [], error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const balances = await store.getBalances();
  assert.equal(balances[0]?.accountNumber, "6540");
  assert.equal(journalReads, 0);
});

test("getVat reads the maintained aggregate table, not journal_entries", async () => {
  let journalReads = 0;
  const client = {
    schema: () => ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq"]) chain[m] = () => chain;
        chain.order = async () => {
          if (table === "journal_entries") {
            journalReads++;
            return { data: [], error: null };
          }
          if (table === "vat_summary")
            return {
              data: [{ vat_code: "VAT25", base_amount: 1000, vat_amount: 250, deductible: true }],
              error: null,
            };
          return { data: [], error: null };
        };
        return chain;
      },
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const vat = await store.getVat();
  assert.equal(vat[0]?.vatCode, "VAT25");
  assert.equal(vat[0]?.baseAmount, 1000);
  assert.equal(vat[0]?.vatAmount, 250);
  assert.equal(vat[0]?.deductible, true);
  assert.equal(journalReads, 0);
});

test("getEvidenceContext resolves voucher across multiple packet links without per-packet queries", async () => {
  let voucherReads = 0;

  // The new implementation issues these queries in order:
  //   1. evidence_objects  → .maybeSingle()
  //   2. evidence_packet_items (link discovery) → terminal .eq("evidence_object_id", …)
  //   3. evidence_packets  (Promise.all[0]) → terminal .in("id", packetIds)
  //   4. evidence_packet_items (batch items) → terminal .in("evidence_packet_id", packetIds)
  //   5. vouchers          (Promise.all[2]) → terminal .in("evidence_packet_id", packetIds)
  //
  // We make .in() return a Promise so it can be awaited directly, and we make
  // the link-discovery chain also resolve by returning a Promise from its terminal
  // .eq() call. No `then` property is assigned to any plain object.
  function makeChain(table: string): Record<string, unknown> {
    const resolveIn = (): Promise<{ data: unknown; error: null }> => {
      if (table === "evidence_packets") {
        // Return both packets so the find/fallback has multiple candidates
        return Promise.resolve({
          data: [
            {
              id: "p1",
              organization_id: "o",
              workspace_id: "w",
              created_at: "2026-01-01T00:00:00.000Z",
              note: null,
              voice_transcript: null,
            },
            {
              id: "p2",
              organization_id: "o",
              workspace_id: "w",
              created_at: "2026-01-02T00:00:00.000Z",
              note: null,
              voice_transcript: null,
            },
          ],
          error: null,
        });
      }
      if (table === "evidence_packet_items") {
        // Batched items query (Promise.all[1])
        return Promise.resolve({
          data: [{ evidence_packet_id: "p1", evidence_object_id: "e1" }],
          error: null,
        });
      }
      if (table === "vouchers") {
        voucherReads++;
        return Promise.resolve({
          data: [
            {
              id: "v1",
              organization_id: "o",
              workspace_id: "w",
              evidence_packet_id: "p2",
              voucher_number: "V-1",
              status: "needs-review",
              accounting_method: "invoice",
              extracted_fields: [],
              voucher_fields: {},
              created_at: "2026-01-01T00:00:00.000Z",
              created_by: "u",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    };

    // The link-discovery query ends at .eq("evidence_object_id", …).
    // To avoid assigning a `then` property we wrap the whole builder in a real
    // Promise by returning Promise.resolve({data, error}) from the terminal .eq().
    // Any subsequent chained .eq() calls after the first are for org/workspace
    // filters — those don't appear on the link-discovery path (it only has one .eq).
    let eqCallCount = 0;

    const chain: Record<string, unknown> = {};
    chain.select = (_arg: string) => {
      return chain;
    };
    chain.eq = (_col: string, _val: string) => {
      eqCallCount++;
      // The link-discovery query: evidence_packet_items with one .eq() call
      if (table === "evidence_packet_items" && eqCallCount === 1) {
        return Promise.resolve({
          data: [{ evidence_packet_id: "p1" }, { evidence_packet_id: "p2" }],
          error: null,
        });
      }
      return chain;
    };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.in = () => {
      // All three .in() calls in getEvidenceContext are followed by .order(),
      // so we return a mini-chain whose .order() resolves with the table data.
      const resultPromise = resolveIn();
      return { order: () => resultPromise };
    };
    chain.maybeSingle = async () => {
      if (table === "evidence_objects")
        return {
          data: {
            id: "e1",
            organization_id: "o",
            workspace_id: "w",
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "u",
            title: "t",
            modalities: ["pdf"],
            original_filename: "f.pdf",
            mime_type: "application/pdf",
            blob_path: "b",
            hash: "h",
            trust_level: "user-upload",
          },
          error: null,
        };
      return { data: null, error: null };
    };
    return chain;
  }

  const client = {
    schema: () => ({
      from: (table: string) => makeChain(table),
    }),
  } as never;
  const store = new SupabaseLedgerStore(client, { organizationId: "o", workspaceId: "w", userId: "u" });
  const ctx = await store.getEvidenceContext("e1");
  assert.equal(ctx?.voucher?.id, "v1");
  assert.equal(voucherReads, 1); // ONE .in(...) query, not one per packet
  assert.equal(ctx?.packet?.id, "p2"); // coherent: packet matches the returned voucher
});
