import { knowledgeQueryResultSchema, type KnowledgeQueryResult } from "@jpx-accounting/contracts";
import { retrieveKnowledge } from "@jpx-accounting/advisor";

/**
 * Knowledge retrieval behind `POST /api/knowledge/query` (Task 5.7).
 *
 * Keyword mode runs BM25-lite over the bundled sourced corpus
 * (`@jpx-accounting/advisor`), so every passage carries verbatim source
 * provenance (CONVENTIONS Rule 10). The vector branch (pgvector + embeddings)
 * lands in Task 5.11 — until then every request answers in keyword mode and
 * says so honestly via the `mode` field.
 */
export async function queryKnowledge(query: string): Promise<KnowledgeQueryResult> {
  // Task 5.11 wires: normal mode + SUPABASE_DB_URL + operational AI →
  // embed(query) → cosine search over knowledge.documents → mode "vector",
  // falling back to this keyword path on any failure.
  const passages = retrieveKnowledge(query, { topK: 4 });
  return knowledgeQueryResultSchema.parse({ query, mode: "keyword", passages });
}
