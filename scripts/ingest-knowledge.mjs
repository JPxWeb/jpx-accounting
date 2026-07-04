/**
 * Ingest the bundled Swedish knowledge corpus into Postgres (pgvector).
 *
 * Re-chunks `docs/knowledge/sv/*.md` with the same chunker that builds
 * `corpus.generated.ts`, embeds every chunk through Azure OpenAI
 * (`text-embedding-3-small`, 1536 dims — matching `halfvec(1536)` from
 * migration 0003), and idempotently upserts the rows into
 * `knowledge.documents`. Re-running refreshes content + embeddings in place.
 * Runs under tsx so it can import the workspace TypeScript directly:
 *
 *   pnpm ingest:knowledge
 *
 * Requires SUPABASE_DB_URL (migrations 0001–0003 applied) and
 * AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY — see docs/CONTRIBUTING.md
 * ("Knowledge retrieval (RAG)").
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createAiRuntime } from "../packages/ai-core/src/index.ts";
import { buildCorpusChunks } from "../packages/advisor/src/corpus-source.ts";
import {
  closePostgresClient,
  createPostgresClient,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  upsertKnowledgeDocuments,
} from "../packages/persistence-postgres/src/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KNOWLEDGE_DOCS_DIR = path.join(repoRoot, "docs", "knowledge", "sv");

/** Azure OpenAI embeddings accept up to a few thousand inputs per call; stay well under it. */
export const EMBED_BATCH_SIZE = 64;

/**
 * Fixed normal-mode workspace scope — mirrors the PostgresLedgerStore wiring
 * in services/api/src/runtime.ts and the query scope in
 * services/api/src/knowledge.ts. Multi-workspace ingestion is a later phase.
 */
export const INGEST_SCOPE = { organizationId: "org_jpx", workspaceId: "workspace_main" };

/** Validate required env up front with actionable messages instead of failing mid-ingest. */
function readIngestEnv(env = process.env) {
  const trim = (value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const databaseUrl = trim(env.SUPABASE_DB_URL);
  const endpoint = trim(env.AZURE_OPENAI_ENDPOINT);
  const apiKey = trim(env.AZURE_OPENAI_API_KEY);

  const missing = [];
  if (!databaseUrl) {
    missing.push(
      "SUPABASE_DB_URL — direct Postgres URL (port 5432) or Supavisor session-mode URL, with migrations 0001–0003 applied (0003 creates knowledge.documents)",
    );
  }
  if (!endpoint) {
    missing.push("AZURE_OPENAI_ENDPOINT — e.g. https://<resource>.openai.azure.com (embeds the corpus chunks)");
  }
  if (!apiKey) {
    missing.push("AZURE_OPENAI_API_KEY — key for the same Azure OpenAI resource");
  }
  if (missing.length > 0) {
    throw new Error(
      [
        "Cannot ingest the knowledge corpus — missing required environment variables:",
        ...missing.map((entry) => `  - ${entry}`),
        'Export them (see .env.example and docs/CONTRIBUTING.md "Knowledge retrieval (RAG)"), then re-run: pnpm ingest:knowledge',
      ].join("\n"),
    );
  }

  return {
    databaseUrl,
    endpoint,
    apiKey,
    model: trim(env.AZURE_OPENAI_MODEL),
    poolerTransactionMode: env.SUPABASE_POOLER_TRANSACTION_MODE === "true",
  };
}

/** Embed all chunk texts in batches of ≤ EMBED_BATCH_SIZE, preserving order. */
async function embedChunks(aiRuntime, chunks) {
  // Same text the keyword index scores against: title + heading + body.
  const texts = chunks.map((chunk) => `${chunk.title}\n${chunk.heading}\n${chunk.text}`);
  const vectors = [];
  let model = "";
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const result = await aiRuntime.embed({ texts: batch });
    if (result.dimensions !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding model "${result.model}" returned ${result.dimensions}-dimensional vectors, but ` +
          `knowledge.documents.embedding is halfvec(${KNOWLEDGE_EMBEDDING_DIMENSIONS}) (text-embedding-3-small). ` +
          "Switching models requires a deliberate column-type migration first — see infra/supabase/migrations/0003_pgvector.sql.",
      );
    }
    model = result.model;
    vectors.push(...result.vectors);
  }
  return { vectors, model };
}

async function main() {
  const env = readIngestEnv();
  const chunks = buildCorpusChunks(KNOWLEDGE_DOCS_DIR);

  const aiRuntime = createAiRuntime({
    runtimeMode: "normal",
    endpoint: env.endpoint,
    apiKey: env.apiKey,
    model: env.model,
  });
  const { vectors, model } = await embedChunks(aiRuntime, chunks);

  const documents = chunks.map((chunk, index) => ({
    id: chunk.id,
    docId: chunk.docId,
    title: chunk.title,
    heading: chunk.heading,
    text: chunk.text,
    source: chunk.source,
    url: chunk.url,
    effective: chunk.effective,
    sourceType: "official",
    embedding: vectors[index],
    embeddingModel: model,
  }));

  const client = createPostgresClient({
    connectionString: env.databaseUrl,
    prepare: !env.poolerTransactionMode,
    max: 4,
  });
  try {
    const written = await upsertKnowledgeDocuments(client, INGEST_SCOPE, documents);
    const docCount = new Set(chunks.map((chunk) => chunk.docId)).size;
    console.log(
      `Upserted ${written} chunks from ${docCount} docs into knowledge.documents ` +
        `(${INGEST_SCOPE.organizationId}/${INGEST_SCOPE.workspaceId}, model ${model}, ${KNOWLEDGE_EMBEDDING_DIMENSIONS} dims).`,
    );
  } finally {
    await closePostgresClient(client);
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
