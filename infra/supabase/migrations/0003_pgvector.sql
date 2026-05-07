-- pgvector setup for grounded retrieval (assistant + knowledge query).
--
-- Design choices (validated 2026-05-06 against Supabase docs):
--  * `halfvec` over `vector` — 16-bit floats halve index memory with negligible recall loss and
--    support up to 4000 dims (covers `text-embedding-3-large` at 3072). Default to 1536 for
--    `text-embedding-3-small` since cost/quality tradeoff favors small for the internal corpus.
--  * HNSW index over IVFFLAT — IVFFLAT requires `lists` tuning that gets awkward as the corpus
--    grows; HNSW is the 2025/26 default with better out-of-the-box recall.
--  * `halfvec_cosine_ops` — cosine similarity matches OpenAI embeddings' guidance.

create extension if not exists vector;

create schema if not exists knowledge;

create table if not exists knowledge.documents (
  id text primary key,
  organization_id text not null,
  workspace_id text not null,
  -- Source tier matters for grounded answers: official > internal > user-upload. The runtime
  -- prefers higher-trust hits when relevance ties.
  source_type text not null check (source_type in ('official', 'internal', 'user-upload')),
  title text not null,
  -- Effective-dated content (Skatteverket rules change quarterly). The embedding is regenerated
  -- when `effective_date` shifts so old vectors stop showing up in recent queries.
  effective_date date,
  content text not null,
  url text,
  embedding halfvec(1536) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-workspace lookup index on top of the HNSW vector index — most queries are scoped to a
-- single workspace, so a btree on (organization_id, workspace_id) avoids a full-table scan
-- when the planner picks the vector index second.
create index if not exists knowledge_documents_workspace_idx
  on knowledge.documents (organization_id, workspace_id);

create index if not exists knowledge_documents_source_idx
  on knowledge.documents (source_type);

-- HNSW with cosine distance — match the metric the embedding model is trained for.
create index if not exists knowledge_documents_embedding_idx
  on knowledge.documents using hnsw (embedding halfvec_cosine_ops);

comment on table knowledge.documents is 'Effective-dated knowledge corpus indexed for grounded retrieval — feeds the assistant and knowledge query routes.';
