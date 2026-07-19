import assert from "node:assert/strict";
import test from "node:test";

import { UNTRUSTED_DATA_PROMPT_CLAUSE, retrieveKnowledge } from "@jpx-accounting/advisor";
import type { KnowledgePassage } from "@jpx-accounting/contracts";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

import {
  ADVISOR_VECTOR_MIN_SIMILARITY,
  DEFAULT_ADVISOR_MAX_OUTPUT_TOKENS,
  DEFAULT_ADVISOR_STREAM_TIMEOUT_MS,
  MAX_MODEL_HISTORY_MESSAGES,
  buildSystemPrompt,
  createAdvisorChatHandler,
  executeReviewApproval,
  resolveAdvisorStreamLimits,
  selectChatPassages,
  truncateAdvisorHistory,
  validateProposalAgainstStore,
  type AdvisorChatHandlerOptions,
} from "../../services/api/src/advisor/chat";
import type { ReviewActionProposal } from "@jpx-accounting/advisor";

/**
 * WS-D regression tests for the advisor chat route: R23 (provenance parts in
 * normal mode), R21 (execute-time re-validation of model-authored tool args),
 * the cost/abort envelope, and the retrieval wiring.
 */

type RecordedStreamCall = {
  prompt: { role: string; content: unknown }[];
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
};

function createRecordingModel(recorded: RecordedStreamCall[]): NonNullable<AdvisorChatHandlerOptions["model"]> {
  return {
    specificationVersion: "v3",
    provider: "mock-provider",
    modelId: "mock-model",
    supportedUrls: Promise.resolve({}),
    doStream: async (options: RecordedStreamCall) => {
      recorded.push(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({ type: "text-delta", id: "text-1", delta: "ok" });
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: { total: 11, noCache: 11, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 7, text: 7, reasoning: undefined },
              },
            });
            controller.close();
          },
        }),
      };
    },
  } as unknown as NonNullable<AdvisorChatHandlerOptions["model"]>;
}

function userMessage(text: string, id = "user-1") {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function chatRequest(messages: unknown[], headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/advisor/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ messages }),
    ...(signal ? { signal } : {}),
  });
}

type SseChunk = { type: string } & Record<string, unknown>;

function parseSseChunks(body: string): SseChunk[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .filter((payload) => payload !== "[DONE]")
    .map((payload) => JSON.parse(payload) as SseChunk);
}

function systemPromptOf(call: RecordedStreamCall): string {
  const system = call.prompt.find((message) => message.role === "system");
  assert.ok(system, "expected a system message in the model prompt");
  return String(system.content);
}

type HandlerOverrides = Partial<Omit<AdvisorChatHandlerOptions, "getStore" | "model">>;

function createNormalHandler(store: MemoryLedgerStore, overrides: HandlerOverrides = {}) {
  const recorded: RecordedStreamCall[] = [];
  const handler = createAdvisorChatHandler({
    getStore: () => store,
    runtimeMode: "normal",
    model: createRecordingModel(recorded),
    toolApprovalSecret: "test-advisor-approval-secret",
    ...overrides,
  });
  return { handler, recorded };
}

async function buildProposalFromStore(store: MemoryLedgerStore): Promise<ReviewActionProposal> {
  const snapshot = await store.getSnapshot();
  const review = snapshot.reviews.find((item) => item.status === "needs-review");
  assert.ok(review?.suggestion, "seeded review with suggestion required");
  const voucher = snapshot.vouchers.find((item) => item.id === review.voucherId);
  return {
    reviewId: review.id,
    voucherId: review.voucherId,
    reviewTitle: review.title,
    action: "approve",
    edited: {
      accountNumber: review.suggestion.accountNumber,
      accountName: review.suggestion.accountName,
      vatCode: review.suggestion.vatCode,
    },
    reasoning: review.suggestion.reasoning,
    confidence: review.suggestion.confidence,
    grossAmount: voucher?.voucherFields.grossAmount ?? null,
  };
}

function spyOnApply(store: MemoryLedgerStore): { count: () => number } {
  let calls = 0;
  const original = store.applyReviewDecision.bind(store);
  store.applyReviewDecision = async (...args: Parameters<typeof original>) => {
    calls += 1;
    return original(...args);
  };
  return { count: () => calls };
}

// ---------------------------------------------------------------------------
// R23 — provenance parts in normal mode
// ---------------------------------------------------------------------------

test("normal mode streams the demo-shaped data-provenance part up front", async () => {
  const question = "Vad gäller för representation och moms?";

  // Demo reference stream for part-shape parity.
  const demoHandler = createAdvisorChatHandler({
    getStore: () => new MemoryLedgerStore(),
    runtimeMode: "demo",
    model: undefined,
    toolApprovalSecret: "test-advisor-approval-secret",
  });
  const demoChunks = parseSseChunks(await (await demoHandler(chatRequest([userMessage(question)]))).text());
  const demoProvenance = demoChunks.find((chunk) => chunk.type === "data-provenance");
  assert.ok(demoProvenance, "demo mode must stream a data-provenance part");

  const { handler } = createNormalHandler(new MemoryLedgerStore());
  const response = await handler(chatRequest([userMessage(question)]));
  assert.equal(response.status, 200);
  const chunks = parseSseChunks(await response.text());

  const provenance = chunks.find((chunk) => chunk.type === "data-provenance");
  assert.ok(provenance, "normal mode must stream a data-provenance part");
  // SAME part name and SAME payload shape as the demo stream (both fall back
  // to the bundled keyword corpus here, so the passages are identical too).
  assert.deepEqual(provenance.data, demoProvenance.data);

  // Emitted up front: start first, provenance before any text part.
  assert.equal(chunks[0]?.type, "start");
  const provenanceIndex = chunks.findIndex((chunk) => chunk.type === "data-provenance");
  const textIndex = chunks.findIndex((chunk) => chunk.type === "text-start");
  assert.ok(textIndex > 0, "mock model text expected");
  assert.ok(provenanceIndex < textIndex, "provenance must precede the streamed text");
});

test("smalltalk yields no provenance part and an honest empty passage block", async () => {
  const { handler, recorded } = createNormalHandler(new MemoryLedgerStore());
  const response = await handler(chatRequest([userMessage("Hej, hur mår du?")]));
  assert.equal(response.status, 200);
  const chunks = parseSseChunks(await response.text());
  assert.ok(!chunks.some((chunk) => chunk.type === "data-provenance"));
  assert.match(systemPromptOf(recorded[0]!), /KUNSKAPSUTDRAG: inga träffar/);
});

test("continuation turns (assistant last) do not re-emit provenance", async () => {
  const { handler } = createNormalHandler(new MemoryLedgerStore());
  const response = await handler(
    chatRequest([
      userMessage("Vad gäller för representation och moms?"),
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Här är svaret." }] },
    ]),
  );
  assert.equal(response.status, 200);
  const chunks = parseSseChunks(await response.text());
  assert.ok(!chunks.some((chunk) => chunk.type === "data-provenance"));
});

// ---------------------------------------------------------------------------
// R22 — the LLM-bound prompt is delimited and clause-guarded
// ---------------------------------------------------------------------------

test("normal-mode system prompt delimits review titles and carries the DATA clause", async () => {
  const { handler, recorded } = createNormalHandler(new MemoryLedgerStore());
  await (await handler(chatRequest([userMessage("Vad väntar i granskningskön?")]))).text();
  const system = systemPromptOf(recorded[0]!);
  assert.ok(system.includes(UNTRUSTED_DATA_PROMPT_CLAUSE), "prompt must declare delimited content as DATA");
  // The seeded review title is evidence-derived → delimited in the prompt.
  assert.ok(system.includes("«Approve AI subscription posting»"), "review titles must be delimited");
});

test("buildSystemPrompt strips control characters from passage fields", () => {
  const passage: KnowledgePassage = {
    id: "doc#0",
    docId: "doc",
    title: "Titel\u0000 med\u200b kontrolltecken",
    excerpt: "Utdrag\r\nmed rader",
    source: "Källa\u202e",
    score: 1,
  };
  const prompt = buildSystemPrompt("GROUNDING", [passage]);
  assert.ok(prompt.includes("Titel med kontrolltecken"));
  assert.ok(prompt.includes('"Utdrag med rader"'));
  assert.ok(!/[\u0000-\u0008\u200b\u202e]/.test(prompt));
});

// ---------------------------------------------------------------------------
// R21 — execute-time re-validation of model-authored args
// ---------------------------------------------------------------------------

test("a valid human-approved proposal still posts through the review gate", async () => {
  const store = new MemoryLedgerStore();
  const proposal = await buildProposalFromStore(store);
  assert.equal(await validateProposalAgainstStore(store, proposal), undefined);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, true);
  const after = await store.getSnapshot();
  assert.equal(after.reviews.find((item) => item.id === proposal.reviewId)?.status, "approved");

  // WS-C R5: with no threaded actor (demo/offline callers) the decision
  // attributes to the demo sentinel; the route-threaded subject path is
  // pinned in tests/unit/api-actor-attribution.test.ts.
  const decisionEvent = (await store.getEvents()).find(
    (event) => event.eventType === "ReviewApproved" && event.aggregateId === proposal.reviewId,
  );
  assert.equal(decisionEvent?.actorId, "user_founder");
});

test("unknown reviewId rejects with a clear tool-result error and no mutation", async () => {
  const store = new MemoryLedgerStore();
  const proposal = { ...(await buildProposalFromStore(store)), reviewId: "rev_hallucinated" };
  const spy = spyOnApply(store);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, false);
  assert.match(outcome.resultText, /finns inte/);
  assert.match(outcome.resultText, /ingenting bokfördes/);
  assert.equal(spy.count(), 0, "applyReviewDecision must not run for an unknown review");
});

test("mismatched voucherId rejects even when the review exists", async () => {
  const store = new MemoryLedgerStore();
  const proposal = { ...(await buildProposalFromStore(store)), voucherId: "v_other" };
  const spy = spyOnApply(store);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, false);
  assert.match(outcome.resultText, /fel verifikat/);
  assert.equal(spy.count(), 0);
});

test("an already-decided review rejects instead of double-posting", async () => {
  const store = new MemoryLedgerStore();
  const proposal = await buildProposalFromStore(store);
  await store.applyReviewDecision(proposal.reviewId, "approve", { actorId: "user_founder", notes: "direct" });
  const spy = spyOnApply(store);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, false);
  assert.match(outcome.resultText, /redan avgjord \(approved\)/);
  assert.equal(spy.count(), 0);
});

test("an account outside the CoA registry rejects at execute time", async () => {
  const store = new MemoryLedgerStore();
  const base = await buildProposalFromStore(store);
  const proposal = { ...base, edited: { ...base.edited, accountNumber: "9999" } };
  const spy = spyOnApply(store);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, false);
  assert.match(outcome.resultText, /Konto 9999 finns inte i kontoplanen/);
  assert.equal(spy.count(), 0);
});

test("a vatCode outside the regime vocabulary rejects at execute time", async () => {
  const store = new MemoryLedgerStore();
  const base = await buildProposalFromStore(store);
  const proposal = { ...base, edited: { ...base.edited, vatCode: "SE25" } };
  const spy = spyOnApply(store);

  const outcome = await executeReviewApproval(store, proposal);
  assert.equal(outcome.approved, false);
  assert.match(outcome.resultText, /Momskoden SE25 är inte giltig/);
  assert.equal(spy.count(), 0);
});

test("demo approval replay of a stale proposal streams a denial and never re-posts", async () => {
  const store = new MemoryLedgerStore();
  const proposal = await buildProposalFromStore(store);
  // The review gets decided between the streamed proposal and the human's
  // approval replay (e.g. approved from the review queue in another tab).
  await store.applyReviewDecision(proposal.reviewId, "approve", { actorId: "user_founder", notes: "queue" });
  const spy = spyOnApply(store);

  const handler = createAdvisorChatHandler({
    getStore: () => store,
    runtimeMode: "demo",
    model: undefined,
    toolApprovalSecret: "test-advisor-approval-secret",
  });

  const toolCallId = "demo-tool-call";
  const messages = [
    userMessage("godkänn granskningen"),
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        {
          type: "tool-proposeReviewAction" as const,
          toolCallId,
          state: "approval-responded" as const,
          input: proposal,
          approval: { id: `${toolCallId}-approval`, approved: true },
        },
      ],
    },
  ];

  const response = await handler(chatRequest(messages));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /tool-output-denied/);
  assert.doesNotMatch(body, /"approved":true/);
  assert.equal(spy.count(), 0, "stale approval must never reach applyReviewDecision");
});

// ---------------------------------------------------------------------------
// Cost/abort envelope
// ---------------------------------------------------------------------------

test("resolveAdvisorStreamLimits: defaults, env overrides, and fail-closed parsing", () => {
  assert.deepEqual(resolveAdvisorStreamLimits({}), {
    maxOutputTokens: DEFAULT_ADVISOR_MAX_OUTPUT_TOKENS,
    streamTimeoutMs: DEFAULT_ADVISOR_STREAM_TIMEOUT_MS,
  });
  assert.deepEqual(
    resolveAdvisorStreamLimits({ ADVISOR_MAX_OUTPUT_TOKENS: "512", ADVISOR_STREAM_TIMEOUT_MS: "30000" }),
    { maxOutputTokens: 512, streamTimeoutMs: 30_000 },
  );
  assert.throws(() => resolveAdvisorStreamLimits({ ADVISOR_MAX_OUTPUT_TOKENS: "unlimited" }), /positive integer/);
  assert.throws(() => resolveAdvisorStreamLimits({ ADVISOR_STREAM_TIMEOUT_MS: "-5" }), /positive integer/);
});

test("maxOutputTokens reaches the model call (default and override)", async () => {
  const savedEnv = process.env.ADVISOR_MAX_OUTPUT_TOKENS;
  delete process.env.ADVISOR_MAX_OUTPUT_TOKENS;
  try {
    const defaultCase = createNormalHandler(new MemoryLedgerStore());
    await (await defaultCase.handler(chatRequest([userMessage("Hur ser kassan ut?")]))).text();
    assert.equal(defaultCase.recorded[0]?.maxOutputTokens, DEFAULT_ADVISOR_MAX_OUTPUT_TOKENS);

    const overrideCase = createNormalHandler(new MemoryLedgerStore(), { maxOutputTokens: 128 });
    await (await overrideCase.handler(chatRequest([userMessage("Hur ser kassan ut?")]))).text();
    assert.equal(overrideCase.recorded[0]?.maxOutputTokens, 128);
  } finally {
    if (savedEnv !== undefined) process.env.ADVISOR_MAX_OUTPUT_TOKENS = savedEnv;
  }
});

test("client abort propagates into the model abortSignal", async () => {
  const { handler, recorded } = createNormalHandler(new MemoryLedgerStore());
  const controller = new AbortController();
  const response = await handler(chatRequest([userMessage("Hur ser kassan ut?")], {}, controller.signal));
  await response.text();

  const signal = recorded[0]?.abortSignal;
  assert.ok(signal, "streamText must receive an abort signal");
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true, "aborting the request must abort the model call");
});

test("the stream timeout aborts the model signal", async () => {
  const { handler, recorded } = createNormalHandler(new MemoryLedgerStore(), { streamTimeoutMs: 20 });
  const response = await handler(chatRequest([userMessage("Hur ser kassan ut?")]));
  await response.text();
  const signal = recorded[0]?.abortSignal;
  assert.ok(signal);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(signal.aborted, true, "the wall-clock timeout must abort the model call");
});

test("token usage is logged as a structured line with the requestId", async (t) => {
  const logged: string[] = [];
  t.mock.method(console, "log", (line: unknown) => {
    logged.push(String(line));
  });

  const { handler } = createNormalHandler(new MemoryLedgerStore());
  await (await handler(chatRequest([userMessage("Hur ser kassan ut?")], { "x-request-id": "req-test-123" }))).text();

  let entry: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 50 && !entry; attempt += 1) {
    entry = logged
      .filter((line) => line.includes("Advisor turn finished"))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .at(0);
    if (!entry) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(entry, "expected a structured finish log line");
  assert.equal(entry.component, "api.advisor");
  assert.equal(entry.requestId, "req-test-123");
  const usage = entry.usage as Record<string, unknown>;
  assert.equal(usage.inputTokens, 11);
  assert.equal(usage.outputTokens, 7);
});

// The UI-message array type, derived from the function under test — the `ai`
// package is deliberately not a root test dependency (CONVENTIONS rule 28).
type AdvisorHistory = Parameters<typeof truncateAdvisorHistory>[0];

test("truncateAdvisorHistory drops oldest-first and keeps system messages", () => {
  const many: AdvisorHistory = Array.from({ length: 25 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    parts: [{ type: "text" as const, text: `message ${index}` }],
  }));

  const truncated = truncateAdvisorHistory(many);
  assert.equal(truncated.length, MAX_MODEL_HISTORY_MESSAGES);
  assert.equal(truncated[0]?.id, `m${25 - MAX_MODEL_HISTORY_MESSAGES}`);
  assert.equal(truncated.at(-1)?.id, "m24");

  const withSystem: AdvisorHistory = [
    { id: "sys", role: "system", parts: [{ type: "text", text: "system prompt" }] },
    ...many,
  ];
  const boundedTight = truncateAdvisorHistory(withSystem, { maxMessages: 2 });
  assert.deepEqual(
    boundedTight.map((message) => message.id),
    ["sys", "m23", "m24"],
    "system messages survive truncation; newest window follows",
  );

  // Byte bound: the newest message is always kept, older ones drop out.
  const bytesBound = truncateAdvisorHistory(many, { maxTotalBytes: 10 });
  assert.equal(bytesBound.length, 1);
  assert.equal(bytesBound[0]?.id, "m24");

  // Under the bounds: untouched.
  const few = many.slice(0, 3);
  assert.deepEqual(truncateAdvisorHistory(few), few);
});

// ---------------------------------------------------------------------------
// Retrieval wiring (pgvector + fallback)
// ---------------------------------------------------------------------------

test("selectChatPassages floors vector passages but passes keyword results through", () => {
  const passage = (id: string, score: number): KnowledgePassage => ({
    id,
    docId: id,
    title: "T",
    excerpt: "E",
    source: "S",
    score,
  });
  const vector = {
    query: "q",
    mode: "vector" as const,
    passages: [passage("strong#0", 0.62), passage("weak#0", ADVISOR_VECTOR_MIN_SIMILARITY - 0.01)],
  };
  assert.deepEqual(
    selectChatPassages(vector).map((item) => item.id),
    ["strong#0"],
  );
  const keyword = { query: "q", mode: "keyword" as const, passages: [passage("kw#0", 0.05)] };
  assert.deepEqual(
    selectChatPassages(keyword).map((item) => item.id),
    ["kw#0"],
  );
});

test("an injected retriever supplies the passages for provenance and prompt", async () => {
  const vectorPassage: KnowledgePassage = {
    id: "vec#1",
    docId: "vec",
    title: "Vektorträff",
    excerpt: "Utdrag från pgvector.",
    source: "Testkälla",
    score: 0.91,
  };
  const { handler, recorded } = createNormalHandler(new MemoryLedgerStore(), {
    retrievePassages: async () => [vectorPassage],
  });
  const response = await handler(chatRequest([userMessage("Vad gäller för representation?")]));
  const chunks = parseSseChunks(await response.text());
  const provenance = chunks.find((chunk) => chunk.type === "data-provenance");
  assert.ok(provenance);
  assert.deepEqual(provenance.data, { passages: [vectorPassage] });
  assert.ok(systemPromptOf(recorded[0]!).includes("Utdrag från pgvector."));
});

test("a failing retriever falls back to keyword passages instead of erroring", async () => {
  const question = "Vad gäller för representation och moms?";
  const { handler } = createNormalHandler(new MemoryLedgerStore(), {
    retrievePassages: async () => {
      throw new Error("pgvector down");
    },
  });
  const response = await handler(chatRequest([userMessage(question)]));
  assert.equal(response.status, 200);
  const chunks = parseSseChunks(await response.text());
  const provenance = chunks.find((chunk) => chunk.type === "data-provenance");
  assert.ok(provenance, "keyword fallback passages must still stream");
  const expected = retrieveKnowledge(question, { topK: 4 });
  assert.deepEqual(
    (provenance.data as { passages: KnowledgePassage[] }).passages.map((item) => item.id),
    expected.map((item) => item.id),
  );
});
