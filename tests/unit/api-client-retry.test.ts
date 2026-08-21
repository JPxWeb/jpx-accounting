import assert from "node:assert/strict";
import test from "node:test";

import { AccountingApiError, createAccountingApiClient } from "@jpx-accounting/api-client";

// ---------------------------------------------------------------------------
// Readiness G9 (bulk capture): bounded 429 retry-with-backoff in the api-client.
// A ~70-receipt drop costs ~4 mutating calls per receipt against a 60/min
// budget, so 429s are EXPECTED backpressure, not failures — the client waits
// out the window the server advertises instead of stranding drafts.
// ---------------------------------------------------------------------------

const BASE_URL = "http://api.test";
const RUNTIME_INFO_BODY = { runtimeMode: "normal", ai: { operational: true, provider: "azure-openai" } };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type FetchLog = { calls: number; urls: string[] };

/** Replay `responses` in order; the LAST one repeats for every further call. */
function mockFetchSequence(t: test.TestContext, responses: Response[]): FetchLog {
  const log: FetchLog = { calls: 0, urls: [] };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const response = responses[Math.min(log.calls, responses.length - 1)]!;
    log.calls += 1;
    log.urls.push(String(input));
    return response;
  });
  return log;
}

/** Flush pending microtasks without depending on the (mocked) timer queue. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("requestJson retries a 429 honoring Retry-After, then succeeds", async (t) => {
  const state = mockFetchSequence(t, [
    jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "0" }),
    jsonResponse(RUNTIME_INFO_BODY),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "normal");
  assert.equal(state.calls, 2, "one retry after the 429");
});

test("requestJson honors the draft-7 combined RateLimit reset= header when Retry-After is absent", async (t) => {
  // Exactly what hono-rate-limiter emits with standardHeaders: "draft-7".
  const state = mockFetchSequence(t, [
    jsonResponse({ error: "rate_limited" }, 429, {
      "ratelimit-policy": "60;w=60",
      ratelimit: "limit=60, remaining=0, reset=0",
    }),
    jsonResponse(RUNTIME_INFO_BODY),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "normal");
  assert.equal(state.calls, 2, "the reset= hint drives the wait when Retry-After is missing");
});

test("requestJson gives up after the bounded retry limit and surfaces AccountingApiError(429)", async (t) => {
  const state = mockFetchSequence(t, [jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "0" })]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(client.getRuntimeInfo(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AccountingApiError");
    assert.equal((error as AccountingApiError).status, 429);
    return true;
  });
  assert.equal(state.calls, 4, "1 initial attempt + 3 bounded retries");
});

test("a non-429 error is never retried", async (t) => {
  const state = mockFetchSequence(t, [jsonResponse({ error: "boom" }, 500)]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(client.getRuntimeInfo(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, "AccountingApiError");
    assert.equal((error as AccountingApiError).status, 500, "a 5xx may already have executed — surfaced, not retried");
    return true;
  });
  assert.equal(state.calls, 1);
});

test("a header-less 429 falls back to exponential backoff (fake timers — no real sleep)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = mockFetchSequence(t, [jsonResponse({ error: "rate_limited" }, 429), jsonResponse(RUNTIME_INFO_BODY)]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const pending = client.getRuntimeInfo();
  await flushMicrotasks();
  assert.equal(state.calls, 1, "the first attempt fired");

  t.mock.timers.tick(499);
  await flushMicrotasks();
  assert.equal(state.calls, 1, "still waiting out the 500 ms fallback delay");

  t.mock.timers.tick(1);
  const info = await pending;
  assert.equal(info.runtimeMode, "normal");
  assert.equal(state.calls, 2);
});

test("an absurd Retry-After is clamped to the max delay (fake timers — no real sleep)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const state = mockFetchSequence(t, [
    jsonResponse({ error: "rate_limited" }, 429, { "retry-after": "3600" }),
    jsonResponse(RUNTIME_INFO_BODY),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const pending = client.getRuntimeInfo();
  await flushMicrotasks();
  assert.equal(state.calls, 1);

  // Cap is just past the API's 60 s rate-limit window — never the advertised hour.
  t.mock.timers.tick(64_999);
  await flushMicrotasks();
  assert.equal(state.calls, 1, "still waiting");

  t.mock.timers.tick(1);
  const info = await pending;
  assert.equal(info.runtimeMode, "normal");
  assert.equal(state.calls, 2, "the clamped wait elapsed at 65 s, not 3600 s");
});

test("the blob PUT retries a 429 too — it is the second of four mutating calls per receipt", async (t) => {
  const state = mockFetchSequence(t, [
    new Response(null, { status: 429, headers: { "retry-after": "0" } }),
    new Response(null, { status: 201 }),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await client.uploadBlob(
    {
      uploadId: "upl_1",
      filename: "kvitto.pdf",
      blobPath: "evidence-uploads/upl_1/kvitto.pdf",
      uploadUrl: "/api/uploads/upl_1",
      requiredContentType: "application/pdf",
      requiredBlobType: "BlockBlob",
      expiresInSeconds: 600,
    },
    new Uint8Array([1, 2, 3]),
  );

  assert.equal(state.calls, 2, "the upload retried instead of stranding the draft");
});

test("extractEvidence retries a 429 so bulk drops keep their extractions", async (t) => {
  const context = {
    evidence: {
      id: "evi_1",
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      createdAt: "2026-08-20T10:00:00.000Z",
      createdBy: "user:test",
      title: "Kvitto",
      modalities: ["upload"],
      originalFilename: "kvitto.pdf",
      mimeType: "application/pdf",
      blobPath: "evidence-uploads/upl_1/kvitto.pdf",
      hash: "sha256_abc",
    },
  };
  const state = mockFetchSequence(t, [
    jsonResponse({ error: "rate_limited" }, 429, { ratelimit: "limit=60, remaining=0, reset=0" }),
    jsonResponse(context),
  ]);
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const result = await client.extractEvidence("evi_1");

  assert.equal(result?.evidence.id, "evi_1");
  assert.equal(state.calls, 2);
});
