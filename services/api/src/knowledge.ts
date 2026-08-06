import { DEFAULT_RETRIEVAL_TOP_K, retrieveKnowledge } from "@jpx-accounting/advisor";
import { isAiRuntimeOperational, type AiRuntime } from "@jpx-accounting/ai-core";
import {
  knowledgeQueryResultSchema,
  type KnowledgePassage,
  type KnowledgeQueryResult,
} from "@jpx-accounting/contracts";
import { DEFAULT_TENANT_SCOPE } from "@jpx-accounting/domain";
import { queryKnowledgeByEmbedding, type PostgresClient } from "@jpx-accounting/persistence-postgres";

/**
 * Knowledge retrieval behind `POST /api/knowledge/query` (Tasks 5.7 + 5.11 + Wave G′ P1-15).
 *
 * Two modes, honestly reported via the result's `mode` field:
 *
 * - **keyword** — BM25-lite over the bundled sourced corpus
 *   (`@jpx-accounting/advisor`); every passage carries verbatim source
 *   provenance (CONVENTIONS Rule 10). Always available; the only mode in demo.
 * - **vector** — pgvector cosine search over `knowledge.documents`
 *   (`pnpm ingest:knowledge` fills it). Active only when boot wiring injects
 *   a shared Postgres client AND an operational AiRuntime — the same surfaces
 *   `runtime.ts` builds. ANY vector failure (embedding call, DB query, empty
 *   index) falls back to keyword with a structured warn: retrieval must never
 *   500 the advisor.
 */

/** Fixed normal-mode workspace — shared DEFAULT_TENANT_SCOPE (runtime store + ingest). */
const KNOWLEDGE_SCOPE = DEFAULT_TENANT_SCOPE;

/** Injectable seam for tests; production resolves a default from boot wiring. */
export type VectorKnowledgeRetriever = {
  embedQuery(query: string): Promise<number[]>;
  search(embedding: number[], topK: number): Promise<KnowledgePassage[]>;
};

/**
 * Boot wiring from `createApiRuntimeDependencies` — the ONE shared Postgres
 * client + THE boot AiRuntime. No env re-reads and no second `createAiRuntime`
 * here (Wave G′ / P1-15).
 */
export type KnowledgeRetrievalWiring = {
  /** Shared runtime Postgres client; null = vector off (demo / no DATABASE_URL). */
  client: PostgresClient | null;
  /** THE boot AiRuntime; UnavailableAiRuntime (or null) = vector off. */
  aiRuntime: AiRuntime | null;
};

let wiring: KnowledgeRetrievalWiring = { client: null, aiRuntime: null };

/**
 * Called once per boot by `createApiRuntimeDependencies`. Resets the memoized
 * default retriever so the next `queryKnowledge()` call picks up the new wiring.
 */
export function configureKnowledgeRetrieval(next: KnowledgeRetrievalWiring): void {
  wiring = next;
  defaultVectorRetriever = undefined;
}

/**
 * Build the vector retriever from boot wiring, or null when vector mode should
 * stay off. Downstream failures still land in the keyword fallback in
 * `queryKnowledge` rather than failing the boot or the request.
 */
function buildVectorRetriever(): VectorKnowledgeRetriever | null {
  const { client, aiRuntime } = wiring;
  if (!client || !aiRuntime || !isAiRuntimeOperational(aiRuntime)) return null;

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
 * disable with `null`) the vector path; omit it to use the boot-wired default.
 * The keyword path is the universal fallback and never throws.
 */
export async function queryKnowledge(
  query: string,
  vectorRetriever?: VectorKnowledgeRetriever | null,
): Promise<KnowledgeQueryResult> {
  const retriever = vectorRetriever === undefined ? resolveDefaultVectorRetriever() : vectorRetriever;

  if (retriever) {
    try {
      const embedding = await retriever.embedQuery(query);
      const passages = await retriever.search(embedding, DEFAULT_RETRIEVAL_TOP_K);
      if (passages.length > 0) {
        return knowledgeQueryResultSchema.parse({ query, mode: "vector", passages });
      }
      // Empty index (nothing ingested yet) → the bundled corpus still answers.
      warnVectorFallback("knowledge.documents returned no rows — run `pnpm ingest:knowledge`");
    } catch (error) {
      warnVectorFallback("vector retrieval failed", error);
    }
  }

  const passages = retrieveKnowledge(query, { topK: DEFAULT_RETRIEVAL_TOP_K });
  return knowledgeQueryResultSchema.parse({ query, mode: "keyword", passages });
}
