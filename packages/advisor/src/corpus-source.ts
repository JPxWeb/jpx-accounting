/**
 * Corpus builder shared by `scripts/build-knowledge-corpus.mjs` (which emits
 * `corpus.generated.ts`) and the corpus-sync tripwire in
 * `tests/unit/knowledge-retrieval.test.ts` (which rebuilds the chunks from
 * `docs/knowledge/sv/` and deep-equals them against `KNOWLEDGE_CORPUS`).
 *
 * NOT exported from the package index on purpose: it imports `node:fs`, and
 * `@jpx-accounting/advisor` is otherwise isomorphic (the web demo transport
 * bundles it). Import it by path only from Node-side code.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { KnowledgeChunk } from "./retrieval";

/** Hard ceiling per chunk; oversized `##` sections split at paragraph boundaries. */
export const MAX_CHUNK_CHARS = 1500;

export interface KnowledgeDocFrontMatter {
  title: string;
  source: string;
  url: string;
  effective: string;
}

const FRONT_MATTER_KEYS = ["title", "source", "url", "effective"] as const;

/**
 * Parse the `--- key: value ---` front-matter block. All four keys are
 * required — a doc without a verbatim source citation must fail the build,
 * not silently produce uncited chunks.
 */
export function parseFrontMatter(
  markdown: string,
  docId: string,
): { frontMatter: KnowledgeDocFrontMatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) {
    throw new Error(`knowledge doc "${docId}" is missing its front-matter block`);
  }
  const fields: Partial<Record<(typeof FRONT_MATTER_KEYS)[number], string>> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separatorAt = line.indexOf(":");
    if (separatorAt === -1) {
      throw new Error(`knowledge doc "${docId}" has a malformed front-matter line: ${line}`);
    }
    const key = line.slice(0, separatorAt).trim() as (typeof FRONT_MATTER_KEYS)[number];
    if (!FRONT_MATTER_KEYS.includes(key)) {
      throw new Error(`knowledge doc "${docId}" has an unknown front-matter key: ${key}`);
    }
    fields[key] = line
      .slice(separatorAt + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  for (const key of FRONT_MATTER_KEYS) {
    if (!fields[key]) {
      throw new Error(`knowledge doc "${docId}" is missing front-matter key "${key}"`);
    }
  }
  return {
    frontMatter: fields as KnowledgeDocFrontMatter,
    body: markdown.slice(match[0].length),
  };
}

interface Section {
  heading: string;
  text: string;
}

/** Split the body into `##` sections (content before the first heading is dropped — docs must start with one). */
function splitSections(body: string, docId: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const rawLine of body.split(/\r?\n/)) {
    const headingMatch = /^##\s+(.*)$/.exec(rawLine);
    if (headingMatch) {
      current = { heading: headingMatch[1]!.trim(), text: "" };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (rawLine.trim().length > 0) {
        throw new Error(`knowledge doc "${docId}" has content before its first "##" heading`);
      }
      continue;
    }
    current.text += `${rawLine}\n`;
  }
  if (sections.length === 0) {
    throw new Error(`knowledge doc "${docId}" has no "##" sections`);
  }
  return sections.map((section) => ({ heading: section.heading, text: section.text.trim() }));
}

/** Split an oversized section body at blank-line paragraph boundaries so every piece fits the ceiling. */
function splitOversizedText(text: string, docId: string, heading: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const pieces: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      throw new Error(
        `knowledge doc "${docId}" section "${heading}" has a single paragraph over ${MAX_CHUNK_CHARS} chars — split it in the source doc`,
      );
    }
    const candidate = current.length > 0 ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > MAX_CHUNK_CHARS) {
      if (current.length > 0) pieces.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
}

/** Chunk one parsed document: one chunk per `##` section, split further only when over the ceiling. */
export function chunkKnowledgeDoc(markdown: string, docId: string): KnowledgeChunk[] {
  const { frontMatter, body } = parseFrontMatter(markdown, docId);
  const chunks: KnowledgeChunk[] = [];
  for (const section of splitSections(body, docId)) {
    for (const text of splitOversizedText(section.text, docId, section.heading)) {
      chunks.push({
        id: `${docId}#${chunks.length}`,
        docId,
        title: frontMatter.title,
        heading: section.heading,
        text,
        source: frontMatter.source,
        url: frontMatter.url,
        effective: frontMatter.effective,
      });
    }
  }
  return chunks;
}

/** Build the full corpus from a directory of markdown docs, in sorted filename order (deterministic). */
export function buildCorpusChunks(docsDir: string): KnowledgeChunk[] {
  const files = readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no knowledge docs found in ${docsDir}`);
  }
  return files.flatMap((name) =>
    chunkKnowledgeDoc(readFileSync(join(docsDir, name), "utf8"), name.replace(/\.md$/, "")),
  );
}
