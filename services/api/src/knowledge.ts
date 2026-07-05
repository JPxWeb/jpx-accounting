import { retrieveKnowledge } from "@jpx-accounting/advisor";
import { createAiRuntime, isAiRuntimeOperational } from "@jpx-accounting/ai-core";
import {
  knowledgeQueryResultSchema,
  type KnowledgePassage,
  type KnowledgeQueryResult,
} from "@jpx-accounting/contracts";
import { createPostgresClient, queryKnowledgeByEmbedding } from "@jpx-accounting/persistence-postgres";

import { readApiRuntimeConfig } from "./config";

/**
 * Knowledge retrieval behind `POST /api/knowledge/query` (Tasks 5.7 + 5.11).
 *
 * Two modes, honestly reported via the result's `mode` field:
 *
 * - **keyword** — BM25-lite over the bundled sourced corpus
 *   (`@jpx-accounting/advisor`); every passage carries verbatim source
 *   provenance (CONVENTIONS Rule 10). Always available; the only mode in demo.
 * - **vector** — pgvector cosine search over `knowledge.documents`
 *   (`pnpm ingest:knowledge` fills it). Active only in normal mode with a
 *   DB-backed store (`SUPABASE_DB_URL`) AND an operational AI runtime
 *   (`AZURE_OPENAI_*`) — the same env surface `runtime.ts` wires. ANY vector
 *   failure (embedding call, DB query, empty index) falls back to keyword
 *   with a structured warn: retrieval must never 500 the advisor.
 */

const RETRIEVAL_TOP_K = 4;

/** Fixed normal-mode workspace — mirrors the PostgresLedgerStore scope in `runtime.ts` and `scripts/ingest-knowledge.mjs`. */
const KNOWLEDGE_SCOPE = { organizationId: "org_jpx", workspaceId: "workspace_main" };

/** Injectable seam for tests; production resolves a default lazily from env. */
export type VectorKnowledgeRetriever = {
  embedQuery(query: string): Promise<number[]>;
  search(embedding: number[], topK: number): Promise<KnowledgePassage[]>;
};

/**
 * Build the vector retriever from env, or null when vector mode should stay
 * off (demo mode, no DB URL, or unconfigured AI). The postgres-js client
 * connects lazily, so misconfiguration surfaces at query time and lands in
 * the keyword fallback rather than failing the boot.
 */
function buildVectorRetrieverFromEnv(): VectorKnowledgeRetriever | null {
  const config = readApiRuntimeConfig();
  if (config.runtimeMode !== "normal") return null;
  const databaseUrl = config.supabase.databaseUrl;
  if (!databaseUrl) return null;

  const aiRuntime = createAiRuntime({
    runtimeMode: config.runtimeMode,
    endpoint: config.azureOpenAi.endpoint,
    apiKey: config.azureOpenAi.apiKey,
    model: config.azureOpenAi.model,
  });
  if (!isAiRuntimeOperational(aiRuntime)) return null;

  // Small dedicated pool: the ledger store owns the main one in runtime.ts,
  // and retrieval is a single read per advisor/knowledge request.
  const client = createPostgresClient({
    connectionString: databaseUrl,
    prepare: !config.supabase.poolerTransactionMode,
    max: 2,
  });

  return {
    embedQuery: async (query) => {
      const result = await aiRuntime.embed({ texts: [query] });
      const vector = result.vectors[0];
      if (!vector) throw new Error(`embed() returned no vector for the query (model ${result.model})`);
      return vector;
    },
    search: (embedding, topK) => queryKnowledgeByEmbedding(client, KNOWLEDGE_SCOPE, embedding, { topK }),
  };
}

/** `undefined` = not resolved yet; `null` = resolved to "vector mode off". */
let defaultVectorRetriever: VectorKnowledgeRetriever | null | undefined;

function resolveDefaultVectorRetriever(): VectorKnowledgeRetriever | null {
  if (defaultVectorRetriever === undefined) {
    defaultVectorRetriever = buildVectorRetrieverFromEnv();
  }
  return defaultVectorRetriever;
}

function warnVectorFallback(reason: string, error?: unknown): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      component: "api.knowledge",
      message: `Vector retrieval unavailable — answering in keyword mode (${reason})`,
      ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}),
    }),
  );
}

/**
 * Answer a knowledge query. Pass `vectorRetriever` explicitly to inject (or
 * disable with `null`) the vector path; omit it to use the env-derived
 * default. The keyword path is the universal fallback and never throws.
 */
export async function queryKnowledge(
  query: string,
  vectorRetriever?: VectorKnowledgeRetriever | null,
): Promise<KnowledgeQueryResult> {
  const retriever = vectorRetriever === undefined ? resolveDefaultVectorRetriever() : vectorRetriever;

  if (retriever) {
    try {
      const embedding = await retriever.embedQuery(query);
      const passages = await retriever.search(embedding, RETRIEVAL_TOP_K);
      if (passages.length > 0) {
        return knowledgeQueryResultSchema.parse({ query, mode: "vector", passages });
      }
      // Empty index (nothing ingested yet) → the bundled corpus still answers.
      warnVectorFallback("knowledge.documents returned no rows — run `pnpm ingest:knowledge`");
    } catch (error) {
      warnVectorFallback("vector retrieval failed", error);
    }
  }

  const passages = retrieveKnowledge(query, { topK: RETRIEVAL_TOP_K });
  return knowledgeQueryResultSchema.parse({ query, mode: "keyword", passages });
}
