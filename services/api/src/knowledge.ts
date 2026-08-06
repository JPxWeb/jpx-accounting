import { retrieveKnowledge } from "@jpx-accounting/advisor";
import { createAiRuntime, isAiRuntimeOperational } from "@jpx-accounting/ai-core";
import {
  knowledgeQueryResultSchema,
  type KnowledgePassage,
  type KnowledgeQueryResult,
} from "@jpx-accounting/contracts";
import { queryKnowledgeByEmbedding, type PostgresClient } from "@jpx-accounting/persistence-postgres";

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
 *   DB-backed store (`DATABASE_URL`, or the legacy `SUPABASE_DB_URL` alias)
 *   AND an operational AI runtime (`AZURE_OPENAI_*`) — the same env surface
 *   `runtime.ts` wires, which also injects the shared Postgres client via
 *   `configureKnowledgeDatabaseClient` (Task 3 connection ownership: one
 *   pool, not a second one opened here). ANY vector failure (embedding call,
 *   DB query, empty index) falls back to keyword with a structured warn:
 *   retrieval must never 500 the advisor.
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
 * The ONE shared Postgres client `createApiRuntimeDependencies` (runtime.ts) creates for the
 * ledger store — injected here so vector retrieval reuses it instead of opening its own second,
 * never-closed pool (Task 3 connection ownership). `null` means "no client available": demo mode,
 * normal mode without a runtime DB URL, or not yet wired (e.g. this module used standalone).
 */
let injectedDatabaseClient: PostgresClient | null = null;

/**
 * Called once by `createApiRuntimeDependencies` at boot. Resets the memoized default retriever so
 * the next `queryKnowledge()` call picks up the newly injected (or cleared) client.
 */
export function configureKnowledgeDatabaseClient(client: PostgresClient | null): void {
  injectedDatabaseClient = client;
  defaultVectorRetriever = undefined;
}

/**
 * Build the vector retriever from env + the injected shared client, or null when vector mode
 * should stay off (demo mode, no injected client, or unconfigured AI). Any downstream failure
 * (embedding call, DB query, empty index) still lands in the keyword fallback in `queryKnowledge`
 * rather than failing the boot or the request.
 */
function buildVectorRetriever(): VectorKnowledgeRetriever | null {
  const config = readApiRuntimeConfig();
  if (config.runtimeMode !== "normal") return null;
  if (!config.database.runtimeUrl) return null;
  const client = injectedDatabaseClient;
  if (!client) return null;

  const aiRuntime = createAiRuntime({
    runtimeMode: config.runtimeMode,
    endpoint: config.azureOpenAi.endpoint,
    apiKey: config.azureOpenAi.apiKey,
    model: config.azureOpenAi.model,
  });
  if (!isAiRuntimeOperational(aiRuntime)) return null;

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
    defaultVectorRetriever = buildVectorRetriever();
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
