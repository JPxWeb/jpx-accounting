import assert from "node:assert/strict";
import { test } from "node:test";

import { AiRuntimeUnavailableError, createAiRuntime, isAiRuntimeOperational } from "@jpx-accounting/ai-core";
import type { Citation, Voucher } from "@jpx-accounting/contracts";

// ---------------------------------------------------------------------------
// WS-E: ai-core runtime factory matrix + fail-closed and local behaviors.
// Extends tests/unit/assistant.test.ts (which pins demo embed determinism/dims
// and the unavailable embed rejection) — no duplication of those cases here.
// ---------------------------------------------------------------------------

function voucherFixture(fields: Partial<Voucher["voucherFields"]> = {}): Voucher {
  return {
    id: "voucher_test_1",
    organizationId: "org_demo",
    workspaceId: "ws_demo",
    evidencePacketId: "packet_test_1",
    voucherNumber: "V-2026-0001",
    status: "needs-review",
    accountingMethod: "invoice",
    extractedFields: [],
    voucherFields: { currency: "SEK", ...fields },
    createdAt: "2026-07-01T10:00:00.000Z",
    createdBy: "user:test",
  };
}

const CITATION: Citation = {
  id: "cit_bfl",
  title: "Bokföringslagen 5 kap.",
  sourceType: "official",
  excerpt: "Affärshändelser ska bokföras så att de kan presenteras i registreringsordning.",
};

test("createAiRuntime selection matrix: demo→Local, normal+config→Responses, normal without config→Unavailable", () => {
  const matrix: Array<{
    options: Parameters<typeof createAiRuntime>[0];
    expected: string;
    operational: boolean;
  }> = [
    { options: { runtimeMode: "demo" }, expected: "LocalAiRuntime", operational: true },
    // Demo wins even when Azure config is present — offline determinism is intentional.
    {
      options: { runtimeMode: "demo", apiKey: "key", endpoint: "https://aoai.example.test" },
      expected: "LocalAiRuntime",
      operational: true,
    },
    {
      options: { runtimeMode: "normal", apiKey: "key", endpoint: "https://aoai.example.test" },
      expected: "ResponsesAiRuntime",
      operational: true,
    },
    // Fail-closed: normal mode with missing/partial config never falls back to Local.
    { options: { runtimeMode: "normal" }, expected: "UnavailableAiRuntime", operational: false },
    { options: { runtimeMode: "normal", apiKey: "key" }, expected: "UnavailableAiRuntime", operational: false },
    {
      options: { runtimeMode: "normal", endpoint: "https://aoai.example.test" },
      expected: "UnavailableAiRuntime",
      operational: false,
    },
  ];

  for (const { options, expected, operational } of matrix) {
    const runtime = createAiRuntime(options);
    assert.equal(runtime.constructor.name, expected, `createAiRuntime(${JSON.stringify(options)})`);
    assert.equal(isAiRuntimeOperational(runtime), operational, `operational flag for ${JSON.stringify(options)}`);
  }
});

test("UnavailableAiRuntime fails closed on suggestPosting and answerQuestion with the typed error", async () => {
  const runtime = createAiRuntime({ runtimeMode: "normal" });

  for (const call of [() => runtime.suggestPosting(voucherFixture()), () => runtime.answerQuestion("Fråga?", [])]) {
    await assert.rejects(call, (error: unknown) => {
      assert.ok(error instanceof AiRuntimeUnavailableError, "must reject with AiRuntimeUnavailableError");
      assert.equal((error as Error).name, "AiRuntimeUnavailableError");
      assert.match((error as Error).message, /normal mode/);
      return true;
    });
  }
});

test("LocalAiRuntime.suggestPosting is deterministic and stays tied to the voucher", async () => {
  const runtime = createAiRuntime({ runtimeMode: "demo" });
  const voucher = voucherFixture({ supplierName: "Microsoft Sverige AB", description: "Subscription renewal" });

  const first = await runtime.suggestPosting(voucher);
  const second = await runtime.suggestPosting(voucher);

  assert.equal(first.voucherId, voucher.id);
  assert.equal(first.kind, "recommendation");
  assert.match(first.accountNumber, /^\d{4}$/);
  assert.ok(first.confidence >= 0 && first.confidence <= 1);
  assert.ok(first.citations.length > 0, "suggestions must carry citations");

  // Deterministic modulo random ids (suggestion id + per-evaluation rule-hit ids).
  const stable = (suggestion: typeof first) => {
    const { id: _id, ruleHits, ...rest } = suggestion;
    return { ...rest, ruleHits: ruleHits.map(({ id: _hitId, ...hit }) => hit) };
  };
  assert.deepEqual(stable(first), stable(second));
});

test("LocalAiRuntime.answerQuestion echoes the question and the supplied citations, honestly labeled as fallback", async () => {
  const runtime = createAiRuntime({ runtimeMode: "demo" });
  const session = await runtime.answerQuestion("Får jag dra av momsen?", [CITATION]);

  assert.equal(session.question, "Får jag dra av momsen?");
  assert.equal(session.status, "grounded");
  assert.deepEqual(session.citations, [CITATION]);
  assert.match(session.answer, /Local AI fallback/);
});

test("LocalAiRuntime.embed honors the model override and bounds vector components to [-1, 1]", async () => {
  const runtime = createAiRuntime({ runtimeMode: "demo" });
  const result = await runtime.embed({ texts: ["första", "andra"], model: "custom-embedding-model" });

  assert.equal(result.model, "custom-embedding-model");
  // Dimensionality is pinned to the pgvector column (halfvec(1536)) regardless of model label.
  assert.equal(result.dimensions, 1536);
  assert.equal(result.vectors.length, 2);
  for (const vector of result.vectors) {
    assert.equal(vector.length, 1536);
    assert.ok(
      vector.every((component) => component >= -1 && component <= 1),
      "mock embedding components stay within [-1, 1]",
    );
  }
});

/**
 * The OpenAI SDK requests `encoding_format: "base64"` by default and decodes the
 * payload back into number vectors — the mock must answer with Float32 LE bytes.
 */
function base64Embedding(values: number[]): string {
  return Buffer.from(new Float32Array(values).buffer).toString("base64");
}

test("ResponsesAiRuntime.embed calls the Azure OpenAI v1 endpoint and maps the response", async (t) => {
  const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: base64Embedding([0.25, -0.5, 0.75]) }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 3, total_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  // Trailing slash on the endpoint must not produce a double slash in the base URL.
  const runtime = createAiRuntime({
    runtimeMode: "normal",
    apiKey: "test-key",
    endpoint: "https://aoai.example.test/",
  });
  const result = await runtime.embed({ texts: ["hej"] });

  assert.equal(result.model, "text-embedding-3-small");
  assert.equal(result.dimensions, 3);
  assert.equal(result.vectors.length, 1);
  // 0.25 / -0.5 / 0.75 are exactly representable in float32, so the base64
  // roundtrip is lossless. Array.from normalizes Float32Array vs number[].
  assert.deepEqual(Array.from(result.vectors[0] ?? []), [0.25, -0.5, 0.75]);

  const request = captured[0];
  assert.ok(request, "embed must issue exactly one HTTP request");
  assert.equal(request.url, "https://aoai.example.test/openai/v1/embeddings");
  const body = JSON.parse(String(request.init?.body)) as { model: string; input: string[] };
  assert.equal(body.model, "text-embedding-3-small");
  assert.deepEqual(body.input, ["hej"]);
});

test("ResponsesAiRuntime.embed per-call model override wins over the factory default", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ object: "embedding", index: 0, embedding: base64Embedding([1, 2]) }],
          model: "text-embedding-3-large",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );

  const runtime = createAiRuntime({
    runtimeMode: "normal",
    apiKey: "test-key",
    endpoint: "https://aoai.example.test",
    embeddingModel: "factory-default-model",
  });
  const result = await runtime.embed({ texts: ["hej"], model: "text-embedding-3-large" });
  assert.equal(result.model, "text-embedding-3-large");
  assert.equal(result.dimensions, 2);
});
