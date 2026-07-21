import assert from "node:assert/strict";
import { test } from "node:test";

import type { KnowledgeChunk } from "@jpx-accounting/advisor";
import { SWEDISH_QUERY_STOPWORDS, hasRetrievableContent, retrieveKnowledge } from "@jpx-accounting/advisor";

/**
 * WS-D retrieval-quality regression tests: smalltalk must yield ZERO sources
 * (the advisor must not dress greetings in Skatteverket citations) while real
 * accounting questions keep their passages.
 */

const GREETINGS = [
  "Hej!",
  "Hej, hur mår du?",
  "Tack så mycket!",
  "Tack för hjälpen",
  "God morgon",
  "Hallå där",
  "Vad heter du?",
  "Kan du hjälpa mig?",
  "Vad kan du göra?",
  "ok tack",
  "ja",
];

test("greetings and courtesy phrases retrieve zero passages", () => {
  for (const greeting of GREETINGS) {
    assert.deepEqual(retrieveKnowledge(greeting), [], `expected no sources for ${JSON.stringify(greeting)}`);
    assert.equal(
      hasRetrievableContent(greeting),
      false,
      `expected no retrievable content in ${JSON.stringify(greeting)}`,
    );
  }
});

test("real VAT questions keep their sources", () => {
  const questions = [
    "Hur mycket moms får jag dra av för representation?",
    "När ska momsdeklarationen lämnas?",
    "Får jag dra av moms på personbil?",
    "Vad är F-skatt?",
  ];
  for (const question of questions) {
    const passages = retrieveKnowledge(question);
    assert.ok(passages.length > 0, `expected sources for ${JSON.stringify(question)}`);
    assert.ok(hasRetrievableContent(question));
  }
  // The representation question ranks representation content on top.
  const top = retrieveKnowledge("Hur mycket moms får jag dra av för representation?")[0];
  assert.ok(top);
  assert.match(top.docId, /representation|moms-avdrag-grunder/);
});

test("a greeting prefix does not suppress a real question", () => {
  const passages = retrieveKnowledge("Hej! Kan du hjälpa mig med momsen på representation?");
  assert.ok(passages.length > 0, "content terms after the greeting must still retrieve");
  assert.ok(passages.some((passage) => passage.docId === "representation"));
});

test("stopword filtering only touches the query — content-word scores are unchanged", () => {
  // "för" and "och" are stopwords; dropping them must not change which doc wins
  // for a content query, and pure content queries behave as before.
  const withStopwords = retrieveKnowledge("Vad gäller för representation och moms?");
  const contentOnly = retrieveKnowledge("gäller representation moms");
  assert.deepEqual(
    withStopwords.map((passage) => passage.id),
    contentOnly.map((passage) => passage.id),
  );
});

test("function words that double as content stay retrievable through real terms", () => {
  // "god" is a stopword (greeting "God morgon") but "god redovisningssed"
  // still retrieves through "redovisningssed".
  const passages = retrieveKnowledge("Vad är god redovisningssed?");
  assert.ok(passages.length > 0);
  assert.equal(passages[0]?.docId, "bokforingslagen-verifikationer");
});

test("minScore floors out weak matches", () => {
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
  const corpus = [chunk("a#0"), chunk("b#0")];
  const unfloored = retrieveKnowledge("moms", { corpus });
  assert.equal(unfloored.length, 2, "fixture sanity: both chunks match without a floor");
  const firstScore = unfloored[0]?.score ?? 0;
  assert.ok(firstScore > 0);
  assert.deepEqual(retrieveKnowledge("moms", { corpus, minScore: firstScore + 1 }), []);
  assert.equal(retrieveKnowledge("moms", { corpus, minScore: firstScore }).length, 2);
});

test("the stopword list is lowercase and covers the greeting vocabulary", () => {
  for (const word of SWEDISH_QUERY_STOPWORDS) {
    assert.equal(word, word.toLowerCase(), `stopword ${JSON.stringify(word)} must be lowercase (tokenizer lowercases)`);
  }
  for (const expected of ["hej", "tack", "god", "morgon", "du", "hur", "vad", "kan"]) {
    assert.ok(SWEDISH_QUERY_STOPWORDS.has(expected), `expected stopword ${expected}`);
  }
});
