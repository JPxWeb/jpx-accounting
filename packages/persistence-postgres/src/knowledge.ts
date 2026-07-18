import { buildExcerpt } from "@jpx-accounting/advisor";
import type { KnowledgePassage } from "@jpx-accounting/contracts";

import type { PostgresClient } from "./client";

/**
 * pgvector-backed knowledge retrieval (Task 5.11) over `knowledge.documents`
 * from migration `0003_pgvector.sql` (PK tenant-scoped by `0007`):
 *
 *   id text · organization_id · workspace_id · source_type · title ·
 *   effective_date date · content text · url · embedding halfvec(1536) ·
 *   embedding_model · created_at · updated_at
 *   PK (organization_id, workspace_id, id) — the chunk id is only unique
 *   WITHIN a tenant scope, so two workspaces can each carry the same corpus
 *   chunk (WS-B B7c; migration 0007 rescopes the pre-0007 global `id` PK).
 *
 * The table has no columns for the chunk's `docId`, `heading`, or verbatim
 * `source` citation — and Task 5.11 deliberately adds no migration — so
 * `content` stores a small JSON envelope (`{ docId, heading, text, source }`)
 * that round-trips them. Rows written by other paths (plain text content)
 * degrade gracefully at read time: `docId` derives from the id, `source`
 * falls back to the title, and the whole content becomes the excerpt text.
 * Source provenance stays verbatim either way (CONVENTIONS Rule 10).
 */

/** Must match the `halfvec(1536)` column — `text-embedding-3-small` dimensions. */
export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;

export type KnowledgeWorkspaceScope = {
  organizationId: string;
  workspaceId: string;
};

export type KnowledgeSourceType = "official" | "internal" | "user-upload";

/** One embedded corpus chunk ready for upsert — field names mirror `KnowledgeChunk` in `@jpx-accounting/advisor`. */
export type KnowledgeDocumentInput = {
  /** Stable chunk id (`<docId>#<n>`) — with the workspace scope it forms the upsert conflict key, so re-ingestion is idempotent per tenant. */
  id: string;
  docId: string;
  title: string;
  heading: string;
  text: string;
  /** Verbatim source citation from the doc's front matter. */
  source: string;
  url?: string | undefined;
  /** `YYYY-MM-DD` — maps to the effective-dated `effective_date` column. */
  effective?: string | undefined;
  /** Source trust tier. Defaults to "official" — the bundled corpus cites Skatteverket/BFN/etc. */
  sourceType?: KnowledgeSourceType | undefined;
  embedding: number[];
  embeddingModel: string;
};

export type QueryKnowledgeByEmbeddingOptions = {
  /** Maximum number of passages to return. Default 4 (matches keyword mode). */
  topK?: number;
};

type ContentEnvelope = {
  docId: string;
  heading: string;
  text: string;
  source: string;
};

function assertEmbeddingDimensions(embedding: number[], context: string): void {
  if (embedding.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${context}: embedding has ${embedding.length} dimensions but knowledge.documents.embedding is halfvec(${KNOWLEDGE_EMBEDDING_DIMENSIONS}) ` +
        `(text-embedding-3-small). Switching embedding models requires a deliberate column-type migration first.`,
    );
  }
}

/** pgvector text input format: `[x,y,z]` — cast to halfvec in SQL. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

function toContentEnvelope(document: KnowledgeDocumentInput): string {
  const envelope: ContentEnvelope = {
    docId: document.docId,
    heading: document.heading,
    text: document.text,
    source: document.source,
  };
  return JSON.stringify(envelope);
}

function parseContentEnvelope(content: string): ContentEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object") return undefined;
    const candidate = parsed as Partial<Record<keyof ContentEnvelope, unknown>>;
    if (
      typeof candidate.docId === "string" &&
      typeof candidate.heading === "string" &&
      typeof candidate.text === "string" &&
      typeof candidate.source === "string"
    ) {
      return { docId: candidate.docId, heading: candidate.heading, text: candidate.text, source: candidate.source };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Idempotently upsert embedded corpus chunks into `knowledge.documents`,
 * keyed on (organization_id, workspace_id, chunk id) — the tenant-scoped PK
 * from migration 0007. Re-running the ingestion refreshes content,
 * embedding, and `updated_at` in place — no duplicate rows. All rows land in
 * one transaction so a failed ingest never leaves a half-written corpus.
 * Returns the number of documents written.
 */
export async function upsertKnowledgeDocuments(
  client: PostgresClient,
  scope: KnowledgeWorkspaceScope,
  documents: KnowledgeDocumentInput[],
): Promise<number> {
  if (documents.length === 0) return 0;
  for (const document of documents) {
    assertEmbeddingDimensions(document.embedding, `upsertKnowledgeDocuments("${document.id}")`);
  }

  await client.begin(async (tx) => {
    for (const document of documents) {
      await tx`
        insert into knowledge.documents
          (id, organization_id, workspace_id, source_type, title, effective_date, content, url, embedding, embedding_model, updated_at)
        values
          (
            ${document.id},
            ${scope.organizationId},
            ${scope.workspaceId},
            ${document.sourceType ?? "official"},
            ${document.title},
            ${document.effective ?? null},
            ${toContentEnvelope(document)},
            ${document.url ?? null},
            ${toVectorLiteral(document.embedding)}::halfvec,
            ${document.embeddingModel},
            now()
          )
        on conflict (organization_id, workspace_id, id) do update set
          source_type = excluded.source_type,
          title = excluded.title,
          effective_date = excluded.effective_date,
          content = excluded.content,
          url = excluded.url,
          embedding = excluded.embedding,
          embedding_model = excluded.embedding_model,
          updated_at = now()
      `;
    }
  });

  return documents.length;
}

type KnowledgeQueryRow = {
  id: string;
  title: string;
  content: string;
  url: string | null;
  distance: number;
};

function rowToPassage(row: KnowledgeQueryRow): KnowledgePassage {
  const envelope = parseContentEnvelope(row.content);
  // Score = 1 − cosine distance (= cosine similarity), rounded like the
  // keyword path so both modes present comparable 4-decimal scores.
  const score = Math.round((1 - row.distance) * 10000) / 10000;
  return {
    id: row.id,
    docId: envelope?.docId ?? row.id.split("#")[0] ?? row.id,
    title: row.title,
    // No query tokens here — pgvector ranks by embedding, so start-anchored
    // excerpts preserve historical output (shared util, §A C7).
    excerpt: buildExcerpt(envelope?.text ?? row.content),
    source: envelope?.source ?? row.title,
    ...(row.url ? { url: row.url } : {}),
    score,
  };
}

/**
 * Cosine nearest-neighbour search (`<=>` on the halfvec column, served by the
 * HNSW index from 0003) scoped to one workspace. Rows come back shaped like
 * `knowledgePassageSchema` so API routes can validate without re-mapping.
 * The secondary `id` tie-break keeps ranking deterministic when distances tie
 * (the corpus is small enough that losing the pure index scan is irrelevant).
 */
export async function queryKnowledgeByEmbedding(
  client: PostgresClient,
  scope: KnowledgeWorkspaceScope,
  embedding: number[],
  options: QueryKnowledgeByEmbeddingOptions = {},
): Promise<KnowledgePassage[]> {
  const { topK = 4 } = options;
  if (topK <= 0) return [];
  assertEmbeddingDimensions(embedding, "queryKnowledgeByEmbedding");

  const literal = toVectorLiteral(embedding);
  const rows = await client<KnowledgeQueryRow[]>`
    select
      id,
      title,
      content,
      url,
      (embedding <=> ${literal}::halfvec)::float8 as distance
    from knowledge.documents
    where organization_id = ${scope.organizationId}
      and workspace_id = ${scope.workspaceId}
    order by embedding <=> ${literal}::halfvec asc, id asc
    limit ${topK}
  `;

  return rows.map(rowToPassage);
}
