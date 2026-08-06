import assert from "node:assert/strict";
import test from "node:test";

import { knowledgePassageSchema } from "@jpx-accounting/contracts";
import {
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  queryKnowledgeByEmbedding,
  upsertKnowledgeDocuments,
  type KnowledgeDocumentInput,
} from "@jpx-accounting/persistence-postgres";

import {
  openPostgresTestContext,
  preparePostgresIntegrationGate,
  type PostgresTestContext,
} from "./helpers/postgres-test-context";

// Strict Postgres integration: DATABASE_TEST_URL → DATABASE_URL → SUPABASE_DB_URL.
// Requires migrations 0003 (pgvector) + 0007 (tenant-scoped PK). Prefer `pnpm db:test`.

const gate = preparePostgresIntegrationGate();
const skip = gate.skip;

let ctx: PostgresTestContext | undefined;

test.before(async () => {
  if (!gate.skip) {
    ctx = await openPostgresTestContext(gate);
  }
});

test.after(async () => {
  await ctx?.close();
  ctx = undefined;
});

function requireCtx(): PostgresTestContext {
  if (!ctx) {
    throw new Error("Postgres test context was not opened — gate.skip should have skipped this test");
  }
  return ctx;
}

/** Unit vector along one axis — exact cosine expectations, fp16-safe. */
function axisVector(axis: number, value = 1): number[] {
  const vector = new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = value;
  return vector;
}

function fixtureDoc(
  runId: string,
  n: number,
  embedding: number[],
  overrides: Partial<KnowledgeDocumentInput> = {},
): KnowledgeDocumentInput {
  return {
    // The PK is tenant-scoped since migration 0007 — (org, workspace, id) —
    // but ids stay namespaced per run so aborted runs never leave collisions.
    id: `${runId}-doc#${n}`,
    docId: `${runId}-doc`,
    title: "Testdokument om moms",
    heading: `Avsnitt ${n}`,
    text: `Testfakta ${n}: momsavdrag kräver en verifikation med säljarens momsregistreringsnummer.`,
    source: "Testkälla — Skatteverket (fixtur)",
    url: "https://example.test/moms",
    effective: "2026-07-04",
    embedding,
    embeddingModel: "test-fixture",
    ...overrides,
  };
}

test("knowledge.documents vector query ranks by cosine distance with passage-shaped rows", { skip }, async () => {
  const { organizationId: orgId, workspaceId: wsId, runId } = requireCtx().createNamespace("knowledge");
  const scope = { organizationId: orgId, workspaceId: wsId };
  const client = requireCtx().client;

  try {
    // Two fixture chunks with orthogonal mock embeddings: axis 0 vs axis 1.
    const near = fixtureDoc(runId, 0, axisVector(0));
    const far = fixtureDoc(runId, 1, axisVector(1));
    const written = await upsertKnowledgeDocuments(client, scope, [near, far]);
    assert.equal(written, 2);

    // Query vector leans towards axis 0: cos-sim 0.8 vs 0.6 → near first.
    const query = axisVector(0, 0.8);
    query[1] = 0.6;
    const passages = await queryKnowledgeByEmbedding(client, scope, query);

    assert.equal(passages.length, 2);
    assert.deepEqual(
      passages.map((passage) => passage.id),
      [near.id, far.id],
      "nearest neighbour first",
    );

    // Score sanity: score = 1 − cosine distance = cosine similarity.
    const [first, second] = passages;
    assert.ok(first && second);
    assert.ok(first.score > second.score, "scores must order with the ranking");
    assert.ok(Math.abs(first.score - 0.8) < 0.01, `near score ≈ 0.8, got ${first.score}`);
    assert.ok(Math.abs(second.score - 0.6) < 0.01, `far score ≈ 0.6, got ${second.score}`);

    // Rows are shaped like knowledgePassageSchema with round-tripped provenance.
    for (const passage of passages) {
      knowledgePassageSchema.parse(passage);
    }
    assert.equal(first.docId, near.docId);
    assert.equal(first.title, near.title);
    assert.equal(first.source, near.source);
    assert.equal(first.url, near.url);
    assert.ok(first.excerpt.includes("momsavdrag"), "excerpt comes from the chunk text");

    // topK bounds the result.
    const topOne = await queryKnowledgeByEmbedding(client, scope, query, { topK: 1 });
    assert.deepEqual(
      topOne.map((passage) => passage.id),
      [near.id],
    );

    // Workspace scoping: a different workspace sees nothing.
    const elsewhere = await queryKnowledgeByEmbedding(
      client,
      { organizationId: orgId, workspaceId: "ws_other" },
      query,
    );
    assert.equal(elsewhere.length, 0);
  } finally {
    await requireCtx().cleanupOrganization(orgId);
  }
});

test("upsertKnowledgeDocuments is idempotent — re-ingest updates in place, no duplicates", { skip }, async () => {
  const { organizationId: orgId, workspaceId: wsId, runId } = requireCtx().createNamespace("knowledge-idem");
  const scope = { organizationId: orgId, workspaceId: wsId };
  const client = requireCtx().client;

  try {
    const original = fixtureDoc(runId, 0, axisVector(0));
    await upsertKnowledgeDocuments(client, scope, [original, fixtureDoc(runId, 1, axisVector(1))]);

    // Re-ingest the same chunk id with refreshed text + embedding.
    const revised = fixtureDoc(runId, 0, axisVector(2), {
      text: "Uppdaterade testfakta: representation med förtäring ger inget momsavdrag över beloppsgränsen.",
    });
    await upsertKnowledgeDocuments(client, scope, [revised]);

    const rows = await client<Array<{ count: string }>>`
      select count(*)::text as count from knowledge.documents where organization_id = ${orgId}
    `;
    assert.equal(rows[0]?.count, "2", "conflict on id must update, not duplicate");

    // The refreshed embedding + content win: querying along the new axis
    // returns the revised excerpt at distance 0.
    const passages = await queryKnowledgeByEmbedding(client, scope, axisVector(2), { topK: 1 });
    assert.equal(passages[0]?.id, revised.id);
    assert.ok(Math.abs((passages[0]?.score ?? 0) - 1) < 0.01, "identical vector → score ≈ 1");
    assert.ok(passages[0]?.excerpt.includes("representation"), "updated text must replace the old excerpt");
  } finally {
    await requireCtx().cleanupOrganization(orgId);
  }
});

test(
  "migration 0007 (B7c): knowledge.documents PK is tenant-scoped — the same chunk id lives independently per workspace",
  { skip },
  async () => {
    const ns = requireCtx().createNamespace("knowledge-pk");
    const orgId = ns.organizationId;
    const wsA = `ws_a_${ns.runId.replace(/-/g, "").slice(0, 10)}`;
    const wsB = `ws_b_${ns.runId.replace(/-/g, "").slice(10, 20)}`;
    const scopeA = { organizationId: orgId, workspaceId: wsA };
    const scopeB = { organizationId: orgId, workspaceId: wsB };
    const runId = ns.runId;
    const client = requireCtx().client;

    try {
      // Schema pin: the PK covers exactly (organization_id, workspace_id, id)
      // in that order — a partial environment where 0007 silently no-opped
      // (pre-0007 global id PK) fails here loudly.
      const pkRows = await client<Array<{ cols: string }>>`
        select (
          select string_agg(a.attname, ',' order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) as cols
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'knowledge' and t.relname = 'documents' and c.contype = 'p'
      `;
      assert.equal(pkRows.length, 1, "exactly one primary key on knowledge.documents");
      assert.equal(pkRows[0]?.cols, "organization_id,workspace_id,id", "PK must be tenant-scoped (migration 0007)");

      // The SAME deterministic chunk id ingested by two workspaces → two rows.
      // Pre-0007 the second upsert stole the first workspace's row (the old
      // `on conflict (id)` rewrote organization_id/workspace_id).
      const shared = fixtureDoc(runId, 0, axisVector(0));
      await upsertKnowledgeDocuments(client, scopeA, [shared]);
      await upsertKnowledgeDocuments(client, scopeB, [
        { ...shared, text: "Workspace B:s egna testfakta om representation och moms." },
      ]);

      const countRows = await client<Array<{ count: string }>>`
        select count(*)::text as count from knowledge.documents where organization_id = ${orgId}
      `;
      assert.equal(countRows[0]?.count, "2", "one row per workspace, no cross-tenant steal");

      // Re-ingesting into A refreshes only A's row; B's content is untouched.
      await upsertKnowledgeDocuments(client, scopeA, [
        fixtureDoc(runId, 0, axisVector(2), { text: "Uppdaterade testfakta för workspace A om momsavdrag." }),
      ]);
      assert.equal(
        (
          await client<Array<{ count: string }>>`
          select count(*)::text as count from knowledge.documents where organization_id = ${orgId}
        `
        )[0]?.count,
        "2",
        "re-ingest updates in place per tenant",
      );

      const passagesA = await queryKnowledgeByEmbedding(client, scopeA, axisVector(2), { topK: 1 });
      assert.equal(passagesA[0]?.id, shared.id);
      assert.ok(passagesA[0]?.excerpt.includes("workspace A"), "A sees its refreshed content");

      const passagesB = await queryKnowledgeByEmbedding(client, scopeB, axisVector(0), { topK: 1 });
      assert.equal(passagesB[0]?.id, shared.id);
      assert.ok(passagesB[0]?.excerpt.includes("Workspace B"), "B keeps its own content after A's re-ingest");
    } finally {
      await requireCtx().cleanupOrganization(orgId);
    }
  },
);
