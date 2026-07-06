/** Target excerpt length in characters (approximate — cut at word boundaries). */
export const EXCERPT_TARGET_CHARS = 300;

/** Collapse a markdown section body into one flowing line for excerpts. */
export function toFlowingText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/**
 * Build a ~300-character excerpt from chunk text.
 *
 * **Query-centered (optional `queryTokens`):** when tokens are supplied and at
 * least one appears in the text, the window is centered on the earliest match
 * with ellipsis on clipped sides — used by BM25 keyword retrieval where the
 * query string is always available.
 *
 * **Start-anchored (no tokens):** truncates from the beginning at a word
 * boundary — used by the pgvector path, which ranks by embedding distance and
 * does not receive query tokens at excerpt time today; omitting tokens keeps
 * historical pgvector excerpt output stable (§A C7).
 *
 * When tokens are supplied but none match, behavior matches start-anchored
 * (window begins at character 0).
 */
export function buildExcerpt(text: string, queryTokens?: readonly string[]): string {
  const flowingText = toFlowingText(text);
  const tokens = queryTokens?.filter((token) => token.length > 0) ?? [];

  let start = 0;
  if (tokens.length > 0) {
    const lower = flowingText.toLowerCase();
    let matchAt = -1;
    for (const token of tokens) {
      const at = lower.indexOf(token.toLowerCase());
      if (at !== -1 && (matchAt === -1 || at < matchAt)) matchAt = at;
    }
    if (matchAt > 100) {
      start = flowingText.lastIndexOf(" ", matchAt - 80);
      if (start === -1) start = 0;
      else start += 1;
    }
  }

  if (flowingText.length - start <= EXCERPT_TARGET_CHARS) {
    const tail = flowingText.slice(start);
    return start > 0 ? `…${tail}` : tail;
  }

  let end = flowingText.lastIndexOf(" ", start + EXCERPT_TARGET_CHARS);
  if (end <= start) end = start + EXCERPT_TARGET_CHARS;
  const body = flowingText.slice(start, end);
  return `${start > 0 ? "…" : ""}${body}…`;
}
