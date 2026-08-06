import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { DEFAULT_RETRIEVAL_TOP_K, retrieveKnowledge, type ReviewActionProposal } from "@jpx-accounting/advisor";
import type { KnowledgePassage } from "@jpx-accounting/contracts";
import { DEMO_ACTOR_ID, MemoryLedgerStore } from "@jpx-accounting/domain";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";
import {
  MockOpenAiResponsesServer,
  messageItemAdded,
  outputTextDelta,
  responseCreated,
  textTurnScript,
  toolCallTurnScript,
} from "./helpers/mock-openai-responses-server";

/**
 * WS-D item 8: the advisor's PRODUCTION normal-mode path, end-to-end through
 * the Hono app — `createApp` builds the real `createAzure` model wired at a
 * mock OpenAI-compatible Responses endpoint (plain `node:http`, ephemeral
 * 127.0.0.1 port; the E2E ports 3200/3201 are never touched).
 *
 * Unlike the unit suite (which injects a fake `LanguageModel`), these tests
 * exercise the actual provider stack: URL construction, api-key header, SSE
 * chunk parsing, HMAC-signed tool approvals, mid-stream failure handling, and
 * client-abort propagation down to the provider socket.
 *
 * ALWAYS runs in the integration suite — no SUPABASE_DB_URL needed
 * (MemoryLedgerStore; knowledge retrieval deterministically falls back to the
 * bundled keyword corpus because the env below stays demo for config readers).
 */

// knowledge.ts resolves its vector retriever lazily from process.env — pin it
// to the keyword path so the test is deterministic regardless of ambient
// SUPABASE_DB_URL/AZURE_* values in CI or a developer shell.
process.env.ACCOUNTING_RUNTIME_MODE = "demo";
delete process.env.ADVISOR_MAX_OUTPUT_TOKENS;
delete process.env.ADVISOR_STREAM_TIMEOUT_MS;

const MOCK_API_KEY = "test-mock-azure-key";
const TOOL_APPROVAL_SECRET = "integration-test-tool-approval-secret";
const PROPOSE_TOOL_NAME = "proposeReviewAction";
const PROPOSAL_QUESTION = "Kan du godkänna granskningen i kön?";

// The API must stay alive through provider failures — track stray rejections.
const unhandledRejections: unknown[] = [];
process.on("unhandledRejection", (reason) => {
  unhandledRejections.push(reason);
});

async function assertNoUnhandledRejections(): Promise<void> {
  await delay(50); // let queued microtasks/timers settle first
  assert.deepEqual(unhandledRejections, [], "no unhandled rejection may escape the advisor stream");
}

function createNormalModeApp(mock: MockOpenAiResponsesServer) {
  const store = new MemoryLedgerStore();
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "normal",
    allowTestReset: false,
    corsPolicy: { kind: "allowlist", origins: ["http://localhost:3002"] },
    // The REAL model wiring under test: createApp calls createAdvisorModel
    // with this slice, so the advisor streams through createAzure against the
    // mock endpoint (POST {endpoint}/openai/responses with the api-key header).
    azureOpenAi: { endpoint: mock.endpoint, apiKey: MOCK_API_KEY, model: "mock-deployment" },
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: TOOL_APPROVAL_SECRET, maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  const app = createApp({ ...dependencies, store, allowTestReset: false });
  return { app, store };
}

function userMessage(text: string, id = "user-1") {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function chatRequest(messages: unknown[], signal?: AbortSignal): Request {
  return new Request("http://localhost/api/advisor/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    ...(signal ? { signal } : {}),
  });
}

type UiChunk = { type: string } & Record<string, unknown>;

/**
 * Drain a UI-message SSE response. Read errors are captured, not thrown —
 * the failure tests assert on the chunks that DID arrive plus the error.
 */
async function collectSseChunks(response: Response): Promise<{ chunks: UiChunk[]; readError?: unknown }> {
  const chunks: UiChunk[] = [];
  assert.ok(response.body, "SSE response must have a body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (eventBlock: string) => {
    for (const line of eventBlock.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice("data: ".length);
      if (payload === "[DONE]") continue;
      chunks.push(JSON.parse(payload) as UiChunk);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorAt: number;
      while ((separatorAt = buffer.indexOf("\n\n")) !== -1) {
        consume(buffer.slice(0, separatorAt));
        buffer = buffer.slice(separatorAt + 2);
      }
    }
    return { chunks };
  } catch (readError) {
    return { chunks, readError };
  }
}

function textOf(chunks: UiChunk[]): string {
  return chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => String(chunk.delta ?? ""))
    .join("");
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

/** The streamed proposal + HMAC approval envelope a (correct) web client replays. */
type StreamedApproval = { toolCallId: string; approvalId: string; signature: string; input: unknown };

function extractStreamedApproval(chunks: UiChunk[]): StreamedApproval {
  const inputAvailable = chunks.find((chunk) => chunk.type === "tool-input-available");
  assert.ok(inputAvailable, "expected a tool-input-available chunk for the proposal");
  assert.equal(inputAvailable.toolName, PROPOSE_TOOL_NAME);
  const approvalRequest = chunks.find((chunk) => chunk.type === "tool-approval-request");
  assert.ok(approvalRequest, "expected a tool-approval-request chunk");
  assert.equal(approvalRequest.toolCallId, inputAvailable.toolCallId);
  const signature = approvalRequest.signature;
  assert.equal(typeof signature, "string", "toolApprovalSecret is set — the approval request must be HMAC-signed");
  assert.ok(String(signature).length > 0);
  return {
    toolCallId: String(inputAvailable.toolCallId),
    approvalId: String(approvalRequest.approvalId),
    signature: String(signature),
    input: inputAvailable.input,
  };
}

type AdvisorTestApp = ReturnType<typeof createNormalModeApp>["app"];

/** Turn 1: model proposes a review action; stream stops at the HMAC approval request. */
async function streamProposeReviewActionTurn(
  app: AdvisorTestApp,
  mock: MockOpenAiResponsesServer,
  store: MemoryLedgerStore,
): Promise<{ proposal: ReviewActionProposal; approval: StreamedApproval }> {
  const proposal = await buildProposalFromStore(store);
  mock.enqueue(toolCallTurnScript(PROPOSE_TOOL_NAME, proposal));
  const response = await app.request(chatRequest([userMessage(PROPOSAL_QUESTION)]));
  assert.equal(response.status, 200);
  const { chunks, readError } = await collectSseChunks(response);
  assert.equal(readError, undefined);
  const approval = extractStreamedApproval(chunks);
  assert.deepEqual(approval.input, proposal);
  assert.ok(
    !chunks.some((chunk) => chunk.type === "tool-output-available"),
    "nothing may execute before the human responds",
  );
  return { proposal, approval };
}

async function assertReviewNeedsReview(store: MemoryLedgerStore, reviewId: string): Promise<void> {
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.reviews.find((item) => item.id === reviewId)?.status, "needs-review");
}

/** The assistant replay message a web client sends after the human clicks approve. */
function approvalRespondedMessage(approval: StreamedApproval, input: unknown, approved: boolean) {
  return {
    id: "assistant-turn-1",
    role: "assistant" as const,
    parts: [
      {
        type: `tool-${PROPOSE_TOOL_NAME}` as const,
        toolCallId: approval.toolCallId,
        state: "approval-responded" as const,
        input,
        approval: { id: approval.approvalId, approved, signature: approval.signature },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// (a) Streaming: data-provenance first, then the mock model's text
// ---------------------------------------------------------------------------

test("normal mode streams UI-message SSE through the real Azure provider wiring, provenance part first", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app } = createNormalModeApp(mock);
    mock.enqueue(textTurnScript("Representation ger begränsat momsavdrag."));

    const question = "Vad gäller för representation och moms?";
    const response = await app.request(chatRequest([userMessage(question)]));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");

    const { chunks, readError } = await collectSseChunks(response);
    assert.equal(readError, undefined);
    assert.equal(chunks[0]?.type, "start");

    // R23: provenance is the FIRST content part, before any model text.
    const provenanceIndex = chunks.findIndex((chunk) => chunk.type === "data-provenance");
    const textStartIndex = chunks.findIndex((chunk) => chunk.type === "text-start");
    assert.ok(provenanceIndex > 0, "expected a data-provenance part");
    assert.ok(textStartIndex > provenanceIndex, "provenance must precede the streamed text");
    const provenanceData = (chunks[provenanceIndex] as { data?: { passages?: KnowledgePassage[] } }).data;
    // No DB in this run → deterministic keyword fallback over the bundled corpus.
    assert.deepEqual(provenanceData?.passages, retrieveKnowledge(question, { topK: DEFAULT_RETRIEVAL_TOP_K }));

    assert.equal(textOf(chunks), "Representation ger begränsat momsavdrag.");
    assert.ok(
      chunks.some((chunk) => chunk.type === "finish"),
      "stream must finish cleanly",
    );

    // Provider-wiring parity: one POST to {endpoint}/openai/responses carrying
    // the api-key header, the deployment name, and the advisor's tool.
    assert.equal(mock.requests.length, 1);
    const modelCall = mock.requests[0]!;
    assert.equal(modelCall.method, "POST");
    assert.equal(modelCall.url, "/openai/responses");
    assert.equal(modelCall.headers["api-key"], MOCK_API_KEY);
    assert.equal(modelCall.body.model, "mock-deployment");
    assert.equal(modelCall.body.stream, true);
    const serializedBody = JSON.stringify(modelCall.body);
    assert.match(serializedBody, new RegExp(PROPOSE_TOOL_NAME));
    assert.match(serializedBody, /FAKTAUNDERLAG/, "the grounded system prompt must reach the provider");

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});

// ---------------------------------------------------------------------------
// (b) proposeReviewAction round trip with a signed human approval
// ---------------------------------------------------------------------------

test("a signed tool approval executes through the review gate and continues the stream", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app, store } = createNormalModeApp(mock);
    const { proposal, approval } = await streamProposeReviewActionTurn(app, mock, store);
    await assertReviewNeedsReview(store, proposal.reviewId);

    // Turn 2: replay the history with the HMAC-signed approval, exactly like
    // the web's approval card → the tool executes applyReviewDecision, then
    // the model is called again with the tool result.
    mock.enqueue(textTurnScript("Klart! Granskningen är godkänd via granskningskön."));
    const turn2 = await app.request(
      chatRequest([userMessage(PROPOSAL_QUESTION), approvalRespondedMessage(approval, proposal, true)]),
    );
    assert.equal(turn2.status, 200);
    const { chunks: turn2Chunks, readError: turn2Error } = await collectSseChunks(turn2);
    assert.equal(turn2Error, undefined);

    const outputChunk = turn2Chunks.find((chunk) => chunk.type === "tool-output-available");
    assert.ok(outputChunk, "the approved tool call must stream its outcome");
    const output = outputChunk.output as { approved?: boolean; resultText?: string };
    assert.equal(output.approved, true);
    assert.match(String(output.resultText), /godkändes via granskningskön/);
    assert.ok(
      !turn2Chunks.some((chunk) => chunk.type === "data-provenance"),
      "continuation turns do not re-emit provenance",
    );
    assert.equal(textOf(turn2Chunks), "Klart! Granskningen är godkänd via granskningskön.");

    // The mutation went through the ONE review gate with server-derived attribution.
    const after = await store.getSnapshot();
    assert.equal(after.reviews.find((item) => item.id === proposal.reviewId)?.status, "approved");
    const decisionEvent = (await store.getEvents()).find(
      (event) => event.eventType === "ReviewApproved" && event.aggregateId === proposal.reviewId,
    );
    assert.ok(decisionEvent, "the approval must append a ReviewApproved event");
    assert.equal(decisionEvent.actorId, DEMO_ACTOR_ID, "auth off → the demo sentinel, never a client-sent identity");

    // The follow-up model call carries the executed tool result back to the LLM.
    assert.equal(mock.requests.length, 2);
    const followUpBody = JSON.stringify(mock.requests[1]!.body);
    assert.match(followUpBody, /function_call_output/);
    assert.match(followUpBody, /call_mock_1/);

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});

test("a signed tool DENIAL streams tool-output-denied and never mutates the review gate", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app, store } = createNormalModeApp(mock);
    const { proposal, approval } = await streamProposeReviewActionTurn(app, mock, store);

    // Turn 2: human denies the tool proposal — AI suggests, never mutates.
    // The SDK still continues the stream after a denial (may call the model);
    // enqueue a short text turn so the mock does not 500 on an empty queue.
    mock.enqueue(textTurnScript("Okej — jag lämnar granskningen orörd."));
    const turn2 = await app.request(
      chatRequest([userMessage(PROPOSAL_QUESTION), approvalRespondedMessage(approval, proposal, false)]),
    );
    assert.equal(turn2.status, 200);
    const { chunks: turn2Chunks, readError: turn2Error } = await collectSseChunks(turn2);
    assert.equal(turn2Error, undefined);

    // AI SDK 7.0.15–7.0.55: toUIMessageStream() does NOT emit tool-output-denied on
    // the Azure/normal path (demo mode does — see local-demo-transport). The
    // deny-flow tripwire for vercel/ai#13670 is: stream finishes (no hang) and
    // the review gate never mutates. When a released SDK emits
    // tool-output-denied here, strengthen this assert.
    const denied = turn2Chunks.find((chunk) => chunk.type === "tool-output-denied");
    if (denied) {
      assert.equal(denied.toolCallId, approval.toolCallId);
    }
    assert.ok(
      !turn2Chunks.some((chunk) => chunk.type === "tool-output-available"),
      "a denial must never execute applyReviewDecision",
    );
    assert.ok(
      !turn2Chunks.some((chunk) => chunk.type === "error"),
      `denial must not surface as a stream error; got types: ${turn2Chunks.map((c) => c.type).join(",")}`,
    );
    assert.ok(
      turn2Chunks.some((chunk) => chunk.type === "finish"),
      "denial stream must terminate (no hang — vercel/ai#13670 tripwire)",
    );

    await assertReviewNeedsReview(store, proposal.reviewId);
    const events = await store.getEvents();
    assert.ok(
      !events.some(
        (event) =>
          (event.eventType === "ReviewApproved" || event.eventType === "ReviewRejected") &&
          event.aggregateId === proposal.reviewId,
      ),
      "denial must append no review decision event",
    );

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});

test("a tampered approval replay fails the HMAC check: no mutation, no model call, API stays alive", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app, store } = createNormalModeApp(mock);
    const { proposal, approval } = await streamProposeReviewActionTurn(app, mock, store);

    // The signature covers a digest of the tool input — replaying an ALTERED
    // proposal under the original signature must be rejected server-side.
    const tampered = { ...proposal, grossAmount: (proposal.grossAmount ?? 0) + 1000 };
    const turn2 = await app.request(
      chatRequest([userMessage(PROPOSAL_QUESTION), approvalRespondedMessage(approval, tampered, true)]),
    );
    const { chunks: turn2Chunks } = await collectSseChunks(turn2);

    assert.ok(
      turn2Chunks.some((chunk) => chunk.type === "error"),
      "the stream must surface the signature failure as an error part",
    );
    assert.ok(
      !turn2Chunks.some((chunk) => chunk.type === "tool-output-available"),
      "a forged approval must never execute",
    );
    await assertReviewNeedsReview(store, proposal.reviewId);
    assert.equal(mock.requests.length, 1, "the rejected replay must not reach the model");

    // The API instance survives and serves the next advisor request.
    mock.enqueue(textTurnScript("Fortfarande i tjänst."));
    const followUp = await app.request(chatRequest([userMessage("Hur ser kassan ut?")]));
    assert.equal(followUp.status, 200);
    const { chunks: followUpChunks, readError } = await collectSseChunks(followUp);
    assert.equal(readError, undefined);
    assert.equal(textOf(followUpChunks), "Fortfarande i tjänst.");

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});

// ---------------------------------------------------------------------------
// (c) Mid-stream provider failure
// ---------------------------------------------------------------------------

test("a mid-stream provider crash terminates the SSE cleanly and leaves the API alive", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app } = createNormalModeApp(mock);

    mock.enqueue(async (writer) => {
      writer.send(responseCreated());
      writer.send(messageItemAdded("msg_mock_1"));
      writer.send(outputTextDelta("msg_mock_1", "Momsen för representation är"));
      // Let the chunks flush so the failure is genuinely MID-stream (a
      // pre-response connection error would be retried by the SDK instead),
      // then sever the socket — the provider "crashes".
      await delay(50);
      writer.destroy();
    });

    const response = await app.request(chatRequest([userMessage("Vad gäller för representation och moms?")]));
    assert.equal(response.status, 200, "headers are already committed before the provider fails");
    const { chunks } = await collectSseChunks(response);

    // The stream terminates with an explicit error part instead of hanging.
    assert.ok(
      chunks.some((chunk) => chunk.type === "error"),
      `expected an error part, got: ${chunks.map((chunk) => chunk.type).join(", ")}`,
    );

    // The API stays alive: the very next advisor call streams normally.
    mock.enqueue(textTurnScript("Återhämtad och redo."));
    const followUp = await app.request(chatRequest([userMessage("Hur ser kassan ut?")]));
    assert.equal(followUp.status, 200);
    const { chunks: followUpChunks, readError } = await collectSseChunks(followUp);
    assert.equal(readError, undefined);
    assert.equal(textOf(followUpChunks), "Återhämtad och redo.");

    // A genuinely mid-stream failure is NOT retried: one crashed call, one follow-up.
    assert.equal(mock.requests.length, 2);

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});

// ---------------------------------------------------------------------------
// (d) Client abort propagates to the provider socket
// ---------------------------------------------------------------------------

test("a client disconnect aborts the model call — the mock sees its socket close", async () => {
  const mock = await MockOpenAiResponsesServer.start();
  try {
    const { app } = createNormalModeApp(mock);

    let providerClosed: Promise<void> | undefined;
    mock.enqueue((writer) => {
      providerClosed = writer.closed;
      writer.send(responseCreated());
      writer.send(messageItemAdded("msg_mock_1"));
      writer.send(outputTextDelta("msg_mock_1", "Det korta svaret är"));
      // ...then hold the connection open: only the client abort may end it.
    });

    const controller = new AbortController();
    const response = await app.request(
      chatRequest([userMessage("Vad gäller för representation och moms?")], controller.signal),
    );
    assert.equal(response.status, 200);

    // Read until the first model text arrives, then disconnect the client.
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes("text-delta")) {
      const { done, value } = await reader.read();
      assert.ok(!done, "stream must not finish before the abort");
      seen += decoder.decode(value, { stream: true });
    }
    controller.abort();

    // The abort must propagate through streamText's AbortSignal into the
    // provider fetch: the mock's response socket closes.
    assert.ok(providerClosed, "the mock never received the model call");
    await Promise.race([
      providerClosed,
      delay(5000).then(() => {
        throw new Error("provider socket did not close within 5s of the client abort");
      }),
    ]);

    // Drain whatever remains of the client stream; abort-time read errors are fine.
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // aborted reads may reject — that IS the clean termination
    }

    await assertNoUnhandledRejections();
  } finally {
    await mock.close();
  }
});
