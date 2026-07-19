import assert from "node:assert/strict";
import test from "node:test";

import { AccountingApiError, createAccountingApiClient } from "@jpx-accounting/api-client";
import type { EvidenceCreateInput } from "@jpx-accounting/contracts";
import { uploadInitResultSchema } from "@jpx-accounting/contracts";

// ---------------------------------------------------------------------------
// WS-E: api-client demo-fallback store behaviors beyond auth (the bearer-token
// seam is pinned in tests/unit/api-client-auth.test.ts) + HTTP error mapping.
// ---------------------------------------------------------------------------

const BASE_URL = "http://api.test";

type CapturedRequest = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(t: test.TestContext, respond: (url: string) => Response): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, init });
    return respond(url);
  });
  return captured;
}

const EVIDENCE_INPUT: EvidenceCreateInput = {
  organizationId: "org_demo",
  workspaceId: "ws_demo",
  title: "Kvitto ICA",
  originalFilename: "kvitto-ica.jpg",
  mimeType: "image/jpeg",
  modalities: ["upload"],
  sizeBytes: 2048,
};

// ---------------------------------------------------------------------------
// Demo fallback: the two-step upload flow never touches the network.
// ---------------------------------------------------------------------------

test("demo initUpload mints a contract-valid stub upload without network", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({}));
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const result = await client.initUpload({ filename: "kvitto.pdf", mimeType: "application/pdf", size: 1234 });

  uploadInitResultSchema.parse(result);
  assert.equal(result.filename, "kvitto.pdf");
  // blobPath and uploadUrl are both derived from the SAME minted uploadId.
  assert.equal(result.blobPath, `evidence-uploads/${result.uploadId}/kvitto.pdf`);
  assert.equal(result.uploadUrl, `/api/uploads/${result.uploadId}`);
  assert.equal(result.requiredContentType, "application/pdf");
  assert.equal(result.requiredBlobType, "BlockBlob");
  assert.equal(result.expiresInSeconds, 600);
  assert.equal(captured.length, 0, "demo initUpload must not fetch");

  // Each init mints a fresh uploadId.
  const second = await client.initUpload({ filename: "kvitto.pdf", mimeType: "application/pdf", size: 1234 });
  assert.notEqual(second.uploadId, result.uploadId);
});

test("demo uploadBlob is a no-op that never fetches", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({}));
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const init = await client.initUpload({ filename: "a.pdf", mimeType: "application/pdf", size: 10 });
  const outcome = await client.uploadBlob(init, new Uint8Array([1, 2, 3]));

  assert.equal(outcome, undefined);
  assert.equal(captured.length, 0, "demo uploadBlob must not fetch");
});

// ---------------------------------------------------------------------------
// Demo fallback: evidence lifecycle against the in-memory store.
// ---------------------------------------------------------------------------

test("demo evidence flow: create → context → deterministic extraction refresh", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({}));
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const created = await client.createEvidence(EVIDENCE_INPUT);
  assert.equal(created.evidence.originalFilename, "kvitto-ica.jpg");
  assert.equal(created.voucherId, created.voucher.id);

  const context = await client.getEvidenceContext(created.evidence.id);
  assert.ok(context, "created evidence must be retrievable");
  assert.equal(context.evidence.id, created.evidence.id);
  assert.equal(context.voucher?.id, created.voucher.id);
  assert.equal(context.review?.id, created.review.id, "review joined via the voucher");

  // Extraction refresh over freshly created evidence is a stable no-op on values
  // (both derive from the same {filename, sizeBytes} seed).
  const extracted = await client.extractEvidence(created.evidence.id);
  assert.ok(extracted);
  assert.deepEqual(extracted.voucher?.extractedFields, created.voucher.extractedFields);

  // No preview URLs exist offline — null, not a throw.
  assert.equal(await client.getEvidenceFileUrl(created.evidence.id), null);

  // Unknown ids resolve to undefined rather than throwing.
  assert.equal(await client.getEvidenceContext("evidence_missing"), undefined);
  assert.equal(await client.extractEvidence("evidence_missing"), undefined);

  assert.equal(captured.length, 0, "demo evidence flow must not fetch");
});

// ---------------------------------------------------------------------------
// Fail-closed wiring: normal mode without a baseUrl is a 503, not a fallback.
// ---------------------------------------------------------------------------

test("normal mode without baseUrl throws AccountingApiError 503 instead of falling back to the demo store", async () => {
  const client = createAccountingApiClient({ runtimeMode: "normal" });

  for (const call of [
    () => client.getSnapshot(),
    () => client.initUpload({ filename: "a.pdf", mimeType: "application/pdf", size: 1 }),
    () => client.getEvidenceContext("evidence_1"),
  ]) {
    await assert.rejects(call, (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 503);
      assert.match(error.detail, /base URL is not configured/);
      return true;
    });
  }
});

// ---------------------------------------------------------------------------
// HTTP error mapping (requestJson / parseJsonBody).
// ---------------------------------------------------------------------------

test("non-ok responses map to AccountingApiError with the server's error/message detail", async (t) => {
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  // `error` field wins.
  mockFetch(t, () => jsonResponse({ error: "period token is invalid", message: "unused" }, 422));
  await assert.rejects(
    () => client.getReportPack("nonsense"),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 422);
      assert.equal(error.detail, "period token is invalid");
      return true;
    },
  );

  // `message` is the fallback detail.
  mockFetch(t, () => jsonResponse({ message: "workspace not found" }, 404));
  await assert.rejects(
    () => client.getRuntimeInfo(),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 404);
      assert.equal(error.detail, "workspace not found");
      return true;
    },
  );

  // Unparseable error body degrades to a generic status line.
  mockFetch(t, () => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(
    () => client.getRuntimeInfo(),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 502);
      assert.match(error.detail, /Request failed: 502/);
      return true;
    },
  );
});

test("2xx responses that are not valid JSON map to an invalid-JSON AccountingApiError", async (t) => {
  mockFetch(t, () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(
    () => client.getRuntimeInfo(),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 200);
      assert.match(error.detail, /invalid JSON/);
      return true;
    },
  );
});

test("2xx responses that break the shared contract map to a 502 AccountingApiError", async (t) => {
  mockFetch(t, () => jsonResponse({ runtimeMode: "normal" })); // missing `ai` → schema violation
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(
    () => client.getRuntimeInfo(),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 502);
      assert.match(error.detail, /did not match the shared contract/);
      return true;
    },
  );
});

test("uploadBlob maps a failed PUT to AccountingApiError with the upstream status", async (t) => {
  mockFetch(t, () => new Response(null, { status: 403, statusText: "Forbidden" }));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await assert.rejects(
    () =>
      client.uploadBlob(
        {
          uploadId: "upload_1",
          filename: "a.pdf",
          blobPath: "evidence-uploads/upload_1/a.pdf",
          uploadUrl: "https://account.blob.core.windows.net/evidence/a.pdf?sig=abc",
          requiredContentType: "application/pdf",
          requiredBlobType: "BlockBlob",
          expiresInSeconds: 600,
        },
        new Uint8Array([1]),
      ),
    (error: unknown) => {
      assert.ok(error instanceof AccountingApiError);
      assert.equal(error.status, 403);
      assert.match(error.detail, /Blob upload failed: 403/);
      return true;
    },
  );
});

test("getEvidenceContext returns undefined on HTTP 404 (unknown evidence is not an error)", async (t) => {
  const captured = mockFetch(t, () => new Response(null, { status: 404 }));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  assert.equal(await client.getEvidenceContext("evidence_unknown"), undefined);
  assert.equal(captured[0]?.url, `${BASE_URL}/api/evidence/evidence_unknown`);
});
