import assert from "node:assert/strict";
import test from "node:test";

import { knowledgePassageSchema } from "@jpx-accounting/contracts";
import {
  closePostgresClient,
  createPostgresClient,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  queryKnowledgeByEmbedding,
  upsertKnowledgeDocuments,
  type KnowledgeDocumentInput,
} from "@jpx-accounting/persistence-postgres";

// Integration test: gated on `SUPABASE_DB_URL` (same pattern as
// postgres-ledger.test.ts) — skips silently when unset so CI without a live
// DB still passes. Requires migration 0003_pgvector.sql (knowledge.documents
// + halfvec(1536) + HNSW cosine index).
//
// Manual end-to-end smoke for the full RAG loop (real embeddings instead of
// the fixture vectors used here): export SUPABASE_DB_URL + AZURE_OPENAI_*,
// run `pnpm ingest:knowledge`, start the API in normal mode, and POST
// /api/knowledge/query — the response should report `mode: "vector"`.

const databaseUrl = process.env.SUPABASE_DB_URL;
const skip = !databaseUrl;

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
    // Ids are a global PK on knowledge.documents — namespace per run so
    // parallel/aborted runs never collide.
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
  if (!databaseUrl) return; // belt-and-braces for the type narrower

  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const scope = { organizationId: orgId, workspaceId: wsId };
  const runId = `${orgId}_${wsId}`;

  const client = createPostgresClient({ connectionString: databaseUrl });
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
    await client`delete from knowledge.documents where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});

test("upsertKnowledgeDocuments is idempotent — re-ingest updates in place, no duplicates", { skip }, async () => {
  if (!databaseUrl) return;

  const orgId = `org_test_${Date.now().toString(36)}`;
  const wsId = `ws_${Math.random().toString(36).slice(2, 8)}`;
  const scope = { organizationId: orgId, workspaceId: wsId };
  const runId = `${orgId}_${wsId}`;

  const client = createPostgresClient({ connectionString: databaseUrl });
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
    await client`delete from knowledge.documents where organization_id = ${orgId}`;
    await closePostgresClient(client);
  }
});
