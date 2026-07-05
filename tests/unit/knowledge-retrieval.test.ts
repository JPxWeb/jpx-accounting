import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { KnowledgeChunk } from "@jpx-accounting/advisor";
import { EXCERPT_TARGET_CHARS, KNOWLEDGE_CORPUS, retrieveKnowledge, tokenizeSwedish } from "@jpx-accounting/advisor";

import { MAX_CHUNK_CHARS, buildCorpusChunks } from "../../packages/advisor/src/corpus-source";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const docsDir = path.join(repoRoot, "docs", "knowledge", "sv");

const EXPECTED_DOC_IDS = [
  "arbetsgivaravgifter",
  "arsredovisning-ab",
  "bas-konton-oversikt",
  "bokforingslagen-verifikationer",
  "f-skatt-preliminarskatt",
  "moms-avdrag-grunder",
  "moms-deklarationstider",
  "personbil-moms",
  "representation",
  "sie-format",
];

test("corpus covers the ten sourced docs with cited, bounded chunks", () => {
  const docIds = [...new Set(KNOWLEDGE_CORPUS.map((chunk) => chunk.docId))].sort();
  assert.deepEqual(docIds, EXPECTED_DOC_IDS);

  const ids = new Set<string>();
  for (const chunk of KNOWLEDGE_CORPUS) {
    assert.ok(!ids.has(chunk.id), `duplicate chunk id ${chunk.id}`);
    ids.add(chunk.id);
    assert.match(chunk.id, /^[a-z0-9-]+#\d+$/);
    assert.ok(chunk.text.length > 0, `${chunk.id} has empty text`);
    assert.ok(chunk.text.length <= MAX_CHUNK_CHARS, `${chunk.id} exceeds ${MAX_CHUNK_CHARS} chars`);
    assert.ok(chunk.title.length > 0, `${chunk.id} has no title`);
    assert.ok(chunk.heading.length > 0, `${chunk.id} has no heading`);
    assert.ok(chunk.source.length > 0, `${chunk.id} has no source citation`);
    assert.match(chunk.url, /^https:\/\//);
    assert.match(chunk.effective, /^\d{4}-\d{2}-\d{2}$/);
    // Every source must be attributable to an official Swedish body or statute.
    assert.match(chunk.source, /Skatteverket|Bokföringslagen|BAS|Årsredovisningslagen|Bolagsverket|SIE-gruppen/);
  }
});

test("corpus-sync tripwire: rebuilding from docs/knowledge/sv equals the checked-in corpus", () => {
  const rebuilt = buildCorpusChunks(docsDir);
  assert.deepEqual(
    rebuilt,
    KNOWLEDGE_CORPUS,
    "corpus.generated.ts is stale — run `pnpm build:knowledge` and commit the result",
  );
});

test("tokenizer keeps å/ä/ö and lowercases", () => {
  const tokens = tokenizeSwedish("Årsredovisning för aktiebolag — MOMS-avdrag på 300 kronor");
  assert.deepEqual(tokens, ["årsredovisning", "för", "aktiebolag", "moms", "avdrag", "på", "300", "kronor"]);
});

test("retrieval is deterministic and bounded by topK", () => {
  const first = retrieveKnowledge("När ska momsdeklarationen lämnas?");
  const second = retrieveKnowledge("När ska momsdeklarationen lämnas?");
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.ok(first.length <= 4, "default topK is 4");
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i - 1]!.score >= first[i]!.score, "scores must be non-increasing");
  }
  assert.equal(retrieveKnowledge("När ska momsdeklarationen lämnas?", { topK: 2 }).length, 2);
});

test("representation query ranks a Skatteverket-sourced representation chunk first", () => {
  const passages = retrieveKnowledge("Vad gäller för representation och moms?");
  const top = passages[0];
  assert.ok(top, "expected at least one passage");
  assert.equal(top.docId, "representation");
  assert.match(top.source, /Skatteverket/);
  assert.ok(top.score > 0);
});

test("excerpts stay near the 300-character target and carry the match", () => {
  const passages = retrieveKnowledge("representation 300 kronor moms");
  assert.ok(passages.length > 0);
  for (const passage of passages) {
    assert.ok(passage.excerpt.length > 0);
    // Target + word-boundary slack + ellipses.
    assert.ok(passage.excerpt.length <= EXCERPT_TARGET_CHARS + 20, `excerpt too long: ${passage.excerpt.length}`);
  }
});

test("no term overlap yields no passages", () => {
  assert.deepEqual(retrieveKnowledge("xylofonorkester zeppelinare"), []);
});

test("equal scores tie-break deterministically on chunk id", () => {
  const chunk = (id: string): KnowledgeChunk => ({
    id,
    docId: id,
    title: "Testdokument",
    heading: "Rubrik",
    text: "identisk text om moms",
    source: "Testkälla",
    url: "https://example.invalid/",
    effective: "2026-07-04",
  });
  const corpus = [chunk("b#0"), chunk("a#0"), chunk("c#0")];
  const passages = retrieveKnowledge("moms", { corpus });
  assert.deepEqual(
    passages.map((passage) => passage.id),
    ["a#0", "b#0", "c#0"],
  );
  assert.equal(new Set(passages.map((passage) => passage.score)).size, 1, "fixture should produce identical scores");
});
