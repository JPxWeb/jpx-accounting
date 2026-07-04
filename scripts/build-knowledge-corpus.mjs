/**
 * Build the bundled Swedish knowledge corpus.
 *
 * Reads `docs/knowledge/sv/*.md` (front matter + `##` sections, ≤ 1500 chars
 * per chunk) and emits `packages/advisor/src/corpus.generated.ts`, which is
 * checked in. Runs under tsx so it can import the workspace TypeScript
 * chunker directly — the same chunker the corpus-sync unit test uses:
 *
 *   pnpm build:knowledge
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCorpusChunks } from "../packages/advisor/src/corpus-source.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KNOWLEDGE_DOCS_DIR = path.join(repoRoot, "docs", "knowledge", "sv");
export const GENERATED_CORPUS_PATH = path.join(repoRoot, "packages", "advisor", "src", "corpus.generated.ts");

/** Render the generated module source (unformatted — main() runs it through Prettier). */
export function renderCorpusModule(chunks) {
  return [
    "// GENERATED FILE — do not edit by hand.",
    "// Built from docs/knowledge/sv/*.md by scripts/build-knowledge-corpus.mjs.",
    "// Regenerate with: pnpm build:knowledge",
    'import type { KnowledgeChunk } from "./retrieval";',
    "",
    `export const KNOWLEDGE_CORPUS: KnowledgeChunk[] = ${JSON.stringify(chunks, null, 2)};`,
    "",
  ].join("\n");
}

async function main() {
  const chunks = buildCorpusChunks(KNOWLEDGE_DOCS_DIR);
  const source = renderCorpusModule(chunks);

  // Format with the repo's Prettier config so `pnpm format:check` stays green
  // without a manual formatting pass after regeneration.
  const prettier = await import("prettier");
  const config = await prettier.resolveConfig(GENERATED_CORPUS_PATH);
  const formatted = await prettier.format(source, { ...config, filepath: GENERATED_CORPUS_PATH });

  writeFileSync(GENERATED_CORPUS_PATH, formatted, "utf8");
  const docCount = new Set(chunks.map((chunk) => chunk.docId)).size;
  console.log(
    `Wrote ${chunks.length} chunks from ${docCount} docs to ${path.relative(repoRoot, GENERATED_CORPUS_PATH)}`,
  );
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  await main();
}
