import assert from "node:assert/strict";
import { test } from "node:test";

import { EXCERPT_TARGET_CHARS, buildExcerpt, toFlowingText } from "@jpx-accounting/advisor";

/** Pre-consolidation query-centered excerpt (`retrieval.ts:135`, Task 2.4 pin). */
function legacyQueryCenteredExcerpt(flowingText: string, queryTokens: string[]): string {
  const lower = flowingText.toLowerCase();
  let matchAt = -1;
  for (const token of queryTokens) {
    const at = lower.indexOf(token);
    if (at !== -1 && (matchAt === -1 || at < matchAt)) matchAt = at;
  }

  let start = 0;
  if (matchAt > 100) {
    start = flowingText.lastIndexOf(" ", matchAt - 80);
    if (start === -1) start = 0;
    else start += 1;
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

/** Pre-consolidation start-anchored excerpt (`knowledge.ts:110`, Task 2.4 pin). */
function legacyStartAnchoredExcerpt(text: string): string {
  const flowing = text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (flowing.length <= EXCERPT_TARGET_CHARS) return flowing;
  let end = flowing.lastIndexOf(" ", EXCERPT_TARGET_CHARS);
  if (end <= 0) end = EXCERPT_TARGET_CHARS;
  return `${flowing.slice(0, end)}…`;
}

const LONG_FLOWING =
  "Första stycket om bokföring och arkivering enligt Bokföringslagen. " +
  "Mittensektionen beskriver verifikationer och konton i BAS. " +
  "Avslutande rader om momsdeklaration och representation med avdragsregler för 300 kronor per person och kväll. " +
  "Ytterligare stycken om deklarationstider, preliminärskatt och årsredovisning för aktiebolag enligt gällande regelverk.";

const MARKDOWN_CHUNK = ["- Första punkt om moms", "- Andra punkt om avdrag", "Avslutande rad utan punktlista."].join(
  "\n",
);

test("buildExcerpt matches legacy query-centered retrieval behavior", () => {
  const flowing = toFlowingText(LONG_FLOWING);
  const tokens = ["representation", "300"];

  assert.equal(buildExcerpt(LONG_FLOWING, tokens), legacyQueryCenteredExcerpt(flowing, tokens));
  assert.match(buildExcerpt(LONG_FLOWING, tokens), /^…/);
  assert.match(buildExcerpt(LONG_FLOWING, tokens), /representation/);
});

test("buildExcerpt matches legacy start-anchored pgvector behavior when tokens omitted", () => {
  assert.equal(buildExcerpt(LONG_FLOWING), legacyStartAnchoredExcerpt(LONG_FLOWING));
  assert.equal(buildExcerpt(MARKDOWN_CHUNK), legacyStartAnchoredExcerpt(MARKDOWN_CHUNK));
  assert.match(buildExcerpt(LONG_FLOWING), /^Första stycket/);
  assert.match(buildExcerpt(LONG_FLOWING), /…$/);
});

test("buildExcerpt collapses markdown bullets before excerpting", () => {
  const flowing = toFlowingText(MARKDOWN_CHUNK);
  assert.equal(buildExcerpt(MARKDOWN_CHUNK), legacyStartAnchoredExcerpt(MARKDOWN_CHUNK));
  assert.ok(flowing.includes("Första punkt om moms"));
  assert.ok(!flowing.includes("\n"));
});

test("short excerpts omit ellipsis", () => {
  const short = "Kort text om moms.";
  assert.equal(buildExcerpt(short), short);
  assert.equal(buildExcerpt(short, ["moms"]), short);
});

test("query tokens with no match fall back to start-anchored window", () => {
  assert.equal(buildExcerpt(LONG_FLOWING, ["xylofon"]), legacyStartAnchoredExcerpt(LONG_FLOWING));
});
