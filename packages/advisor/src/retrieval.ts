import { KNOWLEDGE_CORPUS } from "./corpus.generated";
import { buildExcerpt, toFlowingText } from "./excerpt";

export { EXCERPT_TARGET_CHARS } from "./excerpt";

/**
 * One retrievable chunk of the bundled Swedish knowledge corpus. Chunks are
 * generated from `docs/knowledge/sv/*.md` by `scripts/build-knowledge-corpus.mjs`
 * (one chunk per `##` section, ≤ 1500 characters) and checked in as
 * `corpus.generated.ts`. Every field is copied verbatim from the source
 * document's front matter or body — nothing is synthesized at build time.
 */
export interface KnowledgeChunk {
  /** Stable id `<docId>#<n>` in document order (n is the chunk index within the doc). */
  id: string;
  /** Source document slug (the markdown filename without extension). */
  docId: string;
  /** Document title from front matter. */
  title: string;
  /** The `##` heading this chunk belongs to. */
  heading: string;
  /** Chunk body text (heading line excluded). */
  text: string;
  /** Verbatim source citation from front matter. */
  source: string;
  /** Official page for the source. */
  url: string;
  /** Date the facts were verified or took effect (front matter `effective`). */
  effective: string;
}

/**
 * One ranked retrieval hit. Shape mirrors the `knowledgePassageSchema`
 * contract (`{ id, docId, title, excerpt, source, url?, score }`) so API
 * routes can validate the result without re-mapping.
 */
export interface KnowledgePassage {
  id: string;
  docId: string;
  title: string;
  excerpt: string;
  source: string;
  // `| undefined` keeps the zod-inferred contract twin (`string | undefined`)
  // assignable under exactOptionalPropertyTypes — the chat route feeds
  // contract-validated vector passages into the same advisor surfaces.
  url?: string | undefined;
  score: number;
}

export interface RetrieveKnowledgeOptions {
  /** Maximum number of passages to return. Default 4. */
  topK?: number;
  /** Corpus to search. Defaults to the bundled `KNOWLEDGE_CORPUS`. */
  corpus?: KnowledgeChunk[];
  /**
   * Minimum BM25 score a passage must reach to be returned. Default 0 (any
   * positive-scoring overlap qualifies) — the smalltalk gate is the stopword
   * filter, not this floor. Callers with their own quality bar can raise it.
   */
  minScore?: number;
}

/**
 * Swedish query stopwords (WS-D retrieval quality): function words (Snowball
 * Swedish list), near-content-free light verbs, and phatic/greeting tokens.
 * Filtered from the QUERY only — corpus indexing is untouched, so content-term
 * scores are unchanged. Greetings and courtesy phrases ("Hej!", "Tack för
 * hjälpen", "God morgon") consist entirely of these tokens and therefore
 * retrieve ZERO passages instead of matching corpus function words ("god"
 * otherwise matches "god redovisningssed"). Curated against the bundled
 * corpus: real accounting questions keep their content terms ("Vad är god
 * redovisningssed?" → "redovisningssed" survives the filter).
 */
export const SWEDISH_QUERY_STOPWORDS: ReadonlySet<string> = new Set(
  [
    // Snowball Swedish function words.
    ..."och det att i en jag hon som han på den med var sig för så till är men ett om hade de av icke mig du henne då sin nu har inte hans honom skulle hennes där min man ej vid kunde något från ut när efter upp vi dem vara vad över än dig kan sina här ha mot alla under någon eller allt mycket sedan ju denna själv detta åt utan varit hur ingen mitt ni bli blev oss din dessa några deras blir mina samma vilken er sådan vår blivit dess inom mellan sådant varför varje vilka ditt vem vilket sådana vart dina vars vårt våra ert era vilkas".split(
      " ",
    ),
    // Light verbs and hedges that carry no retrieval signal.
    ..."ska skall vill fick får få gör göra gjort gjorde behöver behövde kanske bara lite gärna snälla".split(" "),
    // Phatic / greeting / courtesy tokens.
    ..."hej hejsan hallå tja tjena tack god morgon kväll okej ok ja nej jo visst mår bra dåligt trevlig trevligt kul heter hjälp hjälpa hjälpen".split(
      " ",
    ),
  ].filter(Boolean),
);

/**
 * True when the query contains at least one non-stopword token — i.e. there is
 * something content-bearing to retrieve on. Smalltalk ("Hej, hur mår du?")
 * returns false. Shared gate for the keyword path (which applies it inside
 * `retrieveKnowledge`) and the vector path (which should skip the embedding
 * call entirely when this is false).
 */
export function hasRetrievableContent(query: string): boolean {
  return tokenizeSwedish(query).some((token) => !SWEDISH_QUERY_STOPWORDS.has(token));
}

/** BM25 term-frequency saturation. */
export const BM25_K1 = 1.2;
/** BM25 length normalization. */
export const BM25_B = 0.75;
const TOKEN_PATTERN = /[a-z0-9åäöéü]+/g;

/**
 * Swedish-aware tokenizer: lowercases and keeps å/ä/ö (plus é/ü for loan
 * words) as letter characters, so "förfrågan" or "Årsredovisning" survive
 * intact instead of being split on the non-ASCII letters. Digits are kept —
 * amounts and dates ("300", "12") are meaningful query terms here.
 */
export function tokenizeSwedish(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

interface IndexedChunk {
  chunk: KnowledgeChunk;
  /** Flowing plain-text body (markdown bullets collapsed) used for excerpts. */
  flowingText: string;
  termFrequencies: Map<string, number>;
  length: number;
}

interface CorpusIndex {
  chunks: IndexedChunk[];
  documentFrequencies: Map<string, number>;
  averageLength: number;
}

function indexChunk(chunk: KnowledgeChunk): IndexedChunk {
  const tokens = tokenizeSwedish(`${chunk.title} ${chunk.heading} ${chunk.text}`);
  const termFrequencies = new Map<string, number>();
  for (const token of tokens) {
    termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
  }
  return { chunk, flowingText: toFlowingText(chunk.text), termFrequencies, length: tokens.length };
}

const indexCache = new WeakMap<KnowledgeChunk[], CorpusIndex>();

function indexCorpus(corpus: KnowledgeChunk[]): CorpusIndex {
  const cached = indexCache.get(corpus);
  if (cached) return cached;

  const chunks = corpus.map(indexChunk);
  const documentFrequencies = new Map<string, number>();
  for (const entry of chunks) {
    for (const term of entry.termFrequencies.keys()) {
      documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
    }
  }
  const totalLength = chunks.reduce((sum, entry) => sum + entry.length, 0);
  const index: CorpusIndex = {
    chunks,
    documentFrequencies,
    averageLength: chunks.length > 0 ? totalLength / chunks.length : 0,
  };
  indexCache.set(corpus, index);
  return index;
}

/** Always-positive BM25 idf variant: ln(1 + (N − df + 0.5) / (df + 0.5)). */
function inverseDocumentFrequency(corpusSize: number, documentFrequency: number): number {
  return Math.log(1 + (corpusSize - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

/**
 * BM25-lite retrieval over the bundled corpus (k1 = 1.2, b = 0.75). Fully
 * deterministic: unique query tokens, a fixed idf formula, and a stable
 * tie-break on chunk id make the ranking a pure function of (query, corpus).
 * Chunks with no term overlap are never returned.
 *
 * Relevance gate (WS-D): stopword tokens are removed from the query before
 * scoring — a query with ONLY stopword tokens (greetings, courtesy phrases)
 * yields zero passages, so smalltalk never dresses itself in sources.
 */
export function retrieveKnowledge(query: string, options: RetrieveKnowledgeOptions = {}): KnowledgePassage[] {
  const { topK = 4, corpus = KNOWLEDGE_CORPUS, minScore = 0 } = options;
  if (topK <= 0 || corpus.length === 0) return [];

  const index = indexCorpus(corpus);
  const queryTokens = [...new Set(tokenizeSwedish(query))].filter((token) => !SWEDISH_QUERY_STOPWORDS.has(token));
  if (queryTokens.length === 0) return [];

  const scored: { entry: IndexedChunk; score: number }[] = [];
  for (const entry of index.chunks) {
    let score = 0;
    for (const token of queryTokens) {
      const termFrequency = entry.termFrequencies.get(token);
      if (!termFrequency) continue;
      const documentFrequency = index.documentFrequencies.get(token) ?? 0;
      const idf = inverseDocumentFrequency(index.chunks.length, documentFrequency);
      const lengthNorm = 1 - BM25_B + BM25_B * (entry.length / index.averageLength);
      score += idf * ((termFrequency * (BM25_K1 + 1)) / (termFrequency + BM25_K1 * lengthNorm));
    }
    if (score > 0 && score >= minScore) scored.push({ entry, score });
  }

  scored.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return left.entry.chunk.id < right.entry.chunk.id ? -1 : 1;
  });

  return scored.slice(0, topK).map(({ entry, score }) => ({
    id: entry.chunk.id,
    docId: entry.chunk.docId,
    title: entry.chunk.title,
    excerpt: buildExcerpt(entry.chunk.text, queryTokens),
    source: entry.chunk.source,
    url: entry.chunk.url,
    score: Math.round(score * 10000) / 10000,
  }));
}
