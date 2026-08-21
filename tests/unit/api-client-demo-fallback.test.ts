import assert from "node:assert/strict";
import test from "node:test";

import { AccountingApiError, createAccountingApiClient } from "@jpx-accounting/api-client";
import type { EvidenceCreateInput, ManualVoucherInput } from "@jpx-accounting/contracts";
import { evidencePacketSchema, manualVoucherResultSchema, uploadInitResultSchema } from "@jpx-accounting/contracts";
import { decodeSieBuffer } from "@jpx-accounting/domain";

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
// KFR Phase E / Task 2: manual vouchers + evidence composition. Both halves of
// each seam matter — the demo fallback drives the in-memory store directly (this
// is what the E2E demo build exercises) and the networked path posts the exact
// contract body to the exact route.
// ---------------------------------------------------------------------------

const MANUAL_VOUCHER_INPUT: ManualVoucherInput = {
  description: "Kontorsmaterial, kontant",
  bookedAt: "2026-08-10",
  lines: [
    { accountNumber: "6110", debit: 100, credit: 0, vatCode: "NA" },
    { accountNumber: "1930", debit: 0, credit: 100, vatCode: "NA" },
  ],
};

test("demo createManualVoucher posts through MemoryLedgerStore.createManualVoucher without network", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({}));
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const result = await client.createManualVoucher(MANUAL_VOUCHER_INPUT);

  manualVoucherResultSchema.parse(result);
  const snapshot = await client.getSnapshot();
  const review = snapshot.reviews.find((r) => r.id === result.reviewId);
  assert.ok(review, "manual voucher review must appear in the workspace snapshot");
  assert.equal(review.status, "needs-review");
  assert.equal(review.voucherId, result.voucherId);
  // Nothing posts until a human approves — the manual entry lands in the SAME
  // review gate as captured evidence (AI/manual both suggest, never mutate).
  const voucher = snapshot.vouchers.find((v) => v.id === result.voucherId);
  assert.equal(voucher?.origin, "manual");
  assert.equal(captured.length, 0, "demo createManualVoucher must not fetch");
});

test("demo composeEvidence relinks evidence via MemoryLedgerStore.composeEvidence without network", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({}));
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const created = await client.createEvidence(EVIDENCE_INPUT);
  const result = await client.composeEvidence({
    evidenceIds: [created.evidence.id],
    targetVoucherId: created.voucher.id,
  });

  evidencePacketSchema.parse(result.packet);
  assert.deepEqual(result.packet.evidenceIds, [created.evidence.id]);
  // Attaching evidence back onto its OWN intake voucher orphans nothing, so
  // nothing is discarded (KFR E.5 — the target is excluded from the search).
  assert.deepEqual(result.discardedReviewIds, []);
  // The relink is observable: the target voucher now points at the new packet.
  const context = await client.getEvidenceContext(created.evidence.id);
  assert.equal(context?.voucher?.evidencePacketId, result.packet.id);
  assert.equal(captured.length, 0, "demo composeEvidence must not fetch");
});

test("demo composeEvidence surfaces an unknown targetVoucherId as VoucherNotFoundError", async () => {
  const client = createAccountingApiClient({ runtimeMode: "demo" });
  const created = await client.createEvidence(EVIDENCE_INPUT);

  await assert.rejects(
    () => client.composeEvidence({ evidenceIds: [created.evidence.id], targetVoucherId: "voucher_missing" }),
    // Cross-boundary: assert on the error's NAME, not `instanceof` against a
    // class the api-client re-exports through a different module instance.
    (error: unknown) => {
      assert.equal((error as Error).name, "VoucherNotFoundError");
      return true;
    },
  );
});

test("createManualVoucher posts the contract body to /api/vouchers/manual and parses the result", async (t) => {
  const captured = mockFetch(t, () => jsonResponse({ voucherId: "voucher_1", reviewId: "review_1" }, 201));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const result = await client.createManualVoucher(MANUAL_VOUCHER_INPUT);

  assert.deepEqual(result, { voucherId: "voucher_1", reviewId: "review_1" });
  assert.equal(captured[0]?.url, `${BASE_URL}/api/vouchers/manual`);
  assert.equal(captured[0]?.init?.method, "POST");
  const body = JSON.parse(String(captured[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, MANUAL_VOUCHER_INPUT);
  assert.equal("actorId" in body, false, "attribution is server-derived, never client-supplied (WS-C R5)");
});

test("composeEvidence round-trips targetVoucherId on the wire and parses packet + discards", async (t) => {
  // KFR E.5: the response is `{ packet, discardedReviewIds }` — the ids of the
  // intake drafts the server rejected inside the attach transaction.
  const captured = mockFetch(t, () =>
    jsonResponse({ packet: { id: "packet_1", evidenceIds: ["evidence_1"] }, discardedReviewIds: ["review_9"] }, 201),
  );
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  const result = await client.composeEvidence({ evidenceIds: ["evidence_1"], targetVoucherId: "voucher_7" });

  assert.deepEqual(result, {
    packet: { id: "packet_1", evidenceIds: ["evidence_1"] },
    discardedReviewIds: ["review_9"],
  });
  assert.equal(captured[0]?.url, `${BASE_URL}/api/evidence/compose`);
  assert.equal(captured[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(captured[0]?.init?.body)), {
    evidenceIds: ["evidence_1"],
    targetVoucherId: "voucher_7",
  });
});

test("manual voucher + compose failures surface the server's status and detail", async (t) => {
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  // 422 invalid_manual_voucher (the domain öre gate, past Zod's ±0.005 wire
  // tolerance). `jsonError` puts the human text in `error`, the machine tag in `code`.
  mockFetch(t, () => jsonResponse({ error: "Manual voucher does not balance.", code: "invalid_manual_voucher" }, 422));
  await assert.rejects(
    () => client.createManualVoucher(MANUAL_VOUCHER_INPUT),
    (error: unknown) => {
      assert.equal((error as Error).name, "AccountingApiError");
      assert.equal((error as AccountingApiError).status, 422);
      assert.equal((error as AccountingApiError).detail, "Manual voucher does not balance.");
      return true;
    },
  );

  // 404 voucher_not_found on an unknown compose target.
  mockFetch(t, () => jsonResponse({ error: "Voucher not found", code: "voucher_not_found" }, 404));
  await assert.rejects(
    () => client.composeEvidence({ evidenceIds: ["evidence_1"], targetVoucherId: "voucher_missing" }),
    (error: unknown) => {
      assert.equal((error as Error).name, "AccountingApiError");
      assert.equal((error as AccountingApiError).status, 404);
      assert.equal((error as AccountingApiError).detail, "Voucher not found");
      return true;
    },
  );
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
    () => client.createManualVoucher(MANUAL_VOUCHER_INPUT),
    () => client.composeEvidence({ evidenceIds: ["evidence_1"] }),
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

// ---------------------------------------------------------------------------
// KFR Phase D / Task 7: the period argument on fetchSieExport. Both halves of
// the seam matter — the demo fallback builds the scoped bytes locally (this is
// what the E2E demo build downloads), and the networked path forwards the
// token as `?period=` so the API scopes and names the file.
// ---------------------------------------------------------------------------

test("fetchSieExport(period): demo fallback emits a period-scoped file; no period keeps full history", async () => {
  const client = createAccountingApiClient({ runtimeMode: "demo" });

  const scoped = decodeSieBuffer(await client.fetchSieExport("2026-03"));
  // I-2b: #RAR 0 declares the fiscal year the window belongs to (calendar year
  // on the default profile), never the one-month window itself.
  assert.match(scoped, /^#RAR 0 20260101 20261231$/m, "the containing fiscal year is declared");

  const full = decodeSieBuffer(await client.fetchSieExport());
  assert.doesNotMatch(full, /^#(IB|UB|RES) /m, "full history carries no balance blocks");
});

test("fetchSieExport(period) forwards the token as ?period= over the wire", async (t) => {
  const captured = mockFetch(t, () => new Response(new Uint8Array([0x23, 0x46]), { status: 200 }));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await client.fetchSieExport("fy-2026");
  assert.equal(captured[0]?.url, `${BASE_URL}/api/exports/sie?period=fy-2026`);

  await client.fetchSieExport();
  assert.equal(captured[1]?.url, `${BASE_URL}/api/exports/sie`, "no period = no query string");
});
