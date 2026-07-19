import assert from "node:assert/strict";
import { test } from "node:test";

import { createAiRuntime, isAiRuntimeOperational } from "@jpx-accounting/ai-core";
import { buildAssistantScaffold } from "@jpx-accounting/domain";

test("buildAssistantScaffold returns a grounded session with one citation", () => {
  const session = buildAssistantScaffold("Can we deduct VAT?");
  assert.equal(session.question, "Can we deduct VAT?");
  assert.equal(session.status, "grounded");
  assert.equal(session.citations.length, 1);
  assert.match(session.id, /^assistant_/);
  assert.ok(session.answer.length > 0);
});

test("buildAssistantScaffold answer/citation deterministic; ids unique", () => {
  const a = buildAssistantScaffold("Q");
  const b = buildAssistantScaffold("Q");
  assert.equal(a.answer, b.answer);
  assert.equal(a.citations[0]?.title, b.citations[0]?.title);
  assert.notEqual(a.id, b.id);
});

// WS-D: the advisor's vector retrieval embeds queries via ai-core `embed()`.
// Pin the demo runtime's embedding seam: deterministic vectors at the pgvector
// dimensionality (halfvec(1536) in migration 0003).
test("demo ai-core embed() is deterministic and 1536-dimensional", async () => {
  const runtime = createAiRuntime({ runtimeMode: "demo" });
  assert.equal(isAiRuntimeOperational(runtime), true);

  const first = await runtime.embed({ texts: ["Hur mycket moms får jag dra av?"] });
  const second = await runtime.embed({ texts: ["Hur mycket moms får jag dra av?"] });
  assert.equal(first.model, "text-embedding-3-small");
  assert.equal(first.dimensions, 1536);
  assert.equal(first.vectors.length, 1);
  assert.equal(first.vectors[0]?.length, 1536);
  assert.deepEqual(first.vectors, second.vectors, "same input must embed identically");

  const other = await runtime.embed({ texts: ["Något helt annat"] });
  assert.notDeepEqual(first.vectors, other.vectors, "different inputs must embed differently");
});

test("unconfigured normal-mode ai-core runtime fails closed on embed()", async () => {
  const runtime = createAiRuntime({ runtimeMode: "normal" });
  assert.equal(isAiRuntimeOperational(runtime), false);
  await assert.rejects(() => runtime.embed({ texts: ["q"] }), /unavailable/i);
});
