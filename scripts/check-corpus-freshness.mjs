/**
 * Corpus freshness tripwire (WS-D item 9).
 *
 * Two checks over the sourced Swedish knowledge corpus:
 *
 * 1. **Drift** — regenerates the corpus module from `docs/knowledge/sv/*.md`
 *    (same chunker + renderer + Prettier pass as `pnpm build:knowledge`, held
 *    in memory instead of a temp file) and fails when it differs from the
 *    checked-in `packages/advisor/src/corpus.generated.ts`.
 * 2. **Staleness** — fails when any doc's front-matter `effective` date is
 *    missing, unparseable, or older than 12 months. The doc format carries no
 *    separate last-verified key (see `parseFrontMatter` in
 *    packages/advisor/src/corpus-source.ts), so `effective` doubles as the
 *    verification marker: when a flagged doc's content is still correct,
 *    re-verify it against its cited source and refresh `effective`.
 *
 * Run with: pnpm check:corpus   (tsx — the chunker is workspace TypeScript)
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCorpusChunks, parseFrontMatter } from "../packages/advisor/src/corpus-source.ts";

import { GENERATED_CORPUS_PATH, KNOWLEDGE_DOCS_DIR, renderCorpusModule } from "./build-knowledge-corpus.mjs";

/** Docs older than this are due for re-verification against their source. */
export const MAX_DOC_AGE_MONTHS = 12;

/** Line endings must not decide drift — git checkouts may rewrite them. */
function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

/** Render + format the corpus module exactly like `pnpm build:knowledge` does. */
export async function renderFormattedCorpusModule() {
  const source = renderCorpusModule(buildCorpusChunks(KNOWLEDGE_DOCS_DIR));
  const prettier = await import("prettier");
  const config = await prettier.resolveConfig(GENERATED_CORPUS_PATH);
  return prettier.format(source, { ...config, filepath: GENERATED_CORPUS_PATH });
}

/**
 * The UTC cutoff instant: front-matter dates on or after this are fresh.
 * Exported for tests; `now` is injectable for determinism.
 */
export function freshnessCutoffMs(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MAX_DOC_AGE_MONTHS, now.getUTCDate());
}

/** Collect staleness failures across every doc in the corpus directory. */
export function collectStalenessFailures(docsDir = KNOWLEDGE_DOCS_DIR, now = new Date()) {
  const cutoffMs = freshnessCutoffMs(now);
  const failures = [];
  const files = readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .sort();
  for (const name of files) {
    const docId = name.replace(/\.md$/, "");
    let effective;
    try {
      ({
        frontMatter: { effective },
      } = parseFrontMatter(readFileSync(path.join(docsDir, name), "utf8"), docId));
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    // Rule 12: Date.parse returns NaN for malformed input — never let a bad
    // date slip through a numeric comparison silently.
    const effectiveMs = Date.parse(`${effective}T00:00:00.000Z`);
    if (Number.isNaN(effectiveMs)) {
      failures.push(`${name}: front-matter "effective" (${JSON.stringify(effective)}) is not a parseable date`);
      continue;
    }
    if (effectiveMs < cutoffMs) {
      failures.push(
        `${name}: effective ${effective} is older than ${MAX_DOC_AGE_MONTHS} months — ` +
          `re-verify the doc against its cited source and refresh "effective"`,
      );
    }
  }
  return failures;
}

async function main() {
  const failures = [];

  const regenerated = normalizeEol(await renderFormattedCorpusModule());
  const checkedIn = normalizeEol(readFileSync(GENERATED_CORPUS_PATH, "utf8"));
  if (regenerated !== checkedIn) {
    failures.push("corpus drift — run pnpm build:knowledge");
  }

  failures.push(...collectStalenessFailures());

  if (failures.length > 0) {
    console.error("check:corpus FAILED:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }
  console.log("check:corpus OK — generated corpus matches docs/knowledge/sv and every doc is fresh.");
}

// Rule 4 (CONVENTIONS): pathToFileURL, never hand-built file:// strings.
const argv1 = process.argv[1];
const isMain = argv1 !== undefined && import.meta.url === pathToFileURL(path.resolve(argv1)).href;
if (isMain) {
  await main();
}
