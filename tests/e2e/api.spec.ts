import { expect, test } from "@playwright/test";

import { apiBaseUrl, createEvidencePayload, resetApiState } from "./test-helpers";

test.skip(({ isMobile }) => isMobile, "API coverage is device-agnostic and only needs one project.");

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("workspace, reporting, export, compliance, and MCP endpoints respond", async ({ request }) => {
  const health = await request.get(`${apiBaseUrl}/health`);
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).ok).toBe(true);

  const workspace = await request.get(`${apiBaseUrl}/api/workspace`);
  expect(workspace.ok()).toBeTruthy();
  const snapshot = await workspace.json();
  expect(snapshot.reviews).toHaveLength(1);
  expect(snapshot.closeRun.period).toBe("2026-03");

  for (const path of [
    "/api/reports/journal",
    "/api/reports/general-ledger",
    "/api/reports/trial-balance",
    "/api/reports/vat-prep",
  ]) {
    const response = await request.get(`${apiBaseUrl}${path}`);
    expect(response.ok()).toBeTruthy();
    expect(Array.isArray(await response.json())).toBeTruthy();
  }

  const compliance = await request.post(`${apiBaseUrl}/api/compliance-watch/refresh`);
  expect(compliance.ok()).toBeTruthy();
  expect((await compliance.json()).length).toBeGreaterThan(0);

  const exportResponse = await request.get(`${apiBaseUrl}/api/exports/sie`);
  expect(exportResponse.ok()).toBeTruthy();
  expect(await exportResponse.text()).toContain('#PROGRAM "JPX Accounting" "0.1.0"');

  const mcp = await request.post(`${apiBaseUrl}/mcp`, {
    data: { tool: "query_reports" },
  });
  expect(mcp.ok()).toBeTruthy();
  expect(await mcp.json()).toMatchObject({
    server: "jpx-accounting",
  });
});

test("evidence, extraction, suggestion, and review endpoints stay coherent and idempotent", async ({ request }) => {
  const upload = await request.post(`${apiBaseUrl}/api/uploads/init`, {
    data: {
      filename: "playwright-receipt.jpg",
      mimeType: "image/jpeg",
      size: 2048,
    },
  });
  expect(upload.ok()).toBeTruthy();
  const uploadJson = await upload.json();
  expect(uploadJson).toMatchObject({
    filename: "playwright-receipt.jpg",
  });
  expect(uploadJson.blobPath).toMatch(/^evidence-uploads\/[A-Za-z0-9-]+\/playwright-receipt\.jpg$/);

  const created = await request.post(`${apiBaseUrl}/api/evidence`, {
    data: createEvidencePayload,
  });
  expect(created.ok()).toBeTruthy();
  const createdPayload = await created.json();

  const composed = await request.post(`${apiBaseUrl}/api/evidence/compose`, {
    data: {
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      actorId: "user_founder",
      evidenceIds: [createdPayload.evidence.id],
      note: "Bundled for review",
    },
  });
  expect(composed.ok()).toBeTruthy();

  const extracted = await request.post(`${apiBaseUrl}/api/evidence/${createdPayload.evidence.id}/extract`);
  expect(extracted.ok()).toBeTruthy();
  const extraction = await extracted.json();
  expect(extraction.extracted).toBe(true);
  expect(extraction.evidence.id).toBe(createdPayload.evidence.id);
  expect(extraction.voucher.id).toBe(createdPayload.voucher.id);

  const suggestion = await request.post(`${apiBaseUrl}/api/vouchers/${createdPayload.voucher.id}/suggest`, {
    data: { actorId: "user_founder" },
  });
  expect(suggestion.ok()).toBeTruthy();
  expect(await suggestion.json()).toMatchObject({
    voucherId: createdPayload.voucher.id,
  });

  const journalBefore = await request.get(`${apiBaseUrl}/api/reports/journal`);
  const journalBeforeData = await journalBefore.json();
  expect(journalBeforeData).toHaveLength(3);

  const approve = await request.post(`${apiBaseUrl}/api/reviews/${createdPayload.review.id}/approve`, {
    data: { actorId: "user_founder", notes: "Reviewed in Playwright" },
  });
  expect(approve.ok()).toBeTruthy();
  expect(await approve.json()).toMatchObject({
    status: "approved",
  });

  const journalAfterApprove = await request.get(`${apiBaseUrl}/api/reports/journal`);
  const journalAfterApproveData = await journalAfterApprove.json();
  expect(journalAfterApproveData).toHaveLength(6);

  const approveAgain = await request.post(`${apiBaseUrl}/api/reviews/${createdPayload.review.id}/approve`, {
    data: { actorId: "user_founder", notes: "Replay should be safe" },
  });
  expect(approveAgain.ok()).toBeTruthy();
  expect(await approveAgain.json()).toMatchObject({
    status: "approved",
  });

  const journalAfterReplay = await request.get(`${apiBaseUrl}/api/reports/journal`);
  const journalAfterReplayData = await journalAfterReplay.json();
  expect(journalAfterReplayData).toHaveLength(6);

  const feed = await request.get(`${apiBaseUrl}/api/reviews/feed`);
  expect(feed.ok()).toBeTruthy();
  expect((await feed.json()).length).toBeGreaterThan(0);
});

test("honest upload pipeline: init → PUT → create with metadata → persisted extraction → evidence context", async ({
  request,
}) => {
  // init mints the canonical blobPath the client echoes back at create time.
  const uploadInit = await request.post(`${apiBaseUrl}/api/uploads/init`, {
    data: { filename: "uploaded-receipt.jpg", mimeType: "image/jpeg", size: 48211 },
  });
  expect(uploadInit.ok()).toBeTruthy();
  const uploadInitJson = await uploadInit.json();
  expect(uploadInitJson.blobPath).toMatch(/^evidence-uploads\/[A-Za-z0-9-]+\/uploaded-receipt\.jpg$/);

  // Bytes really travel: the stub PUT route accepts (and discards) them.
  const stubPut = await request.put(`${apiBaseUrl}${uploadInitJson.uploadUrl}`, {
    headers: { "content-type": "image/jpeg" },
    data: Buffer.alloc(48211, 7),
  });
  expect(stubPut.status()).toBe(201);

  const sha256 = "ab".repeat(32);
  const created = await request.post(`${apiBaseUrl}/api/evidence`, {
    data: {
      organizationId: "org_jpx",
      workspaceId: "workspace_main",
      actorId: "user_founder",
      title: "Uploaded receipt",
      originalFilename: "uploaded-receipt.jpg",
      mimeType: "image/jpeg",
      modalities: ["upload"],
      sizeBytes: 48211,
      sha256,
      uploadId: uploadInitJson.uploadId,
      blobPath: uploadInitJson.blobPath,
    },
  });
  expect(created.ok()).toBeTruthy();
  const createdPayload = await created.json();
  expect(createdPayload.evidence.blobPath).toBe(uploadInitJson.blobPath);
  expect(createdPayload.evidence.hash).toBe(sha256);
  expect(createdPayload.evidence.sizeBytes).toBe(48211);
  // File-seeded deterministic fields, not the legacy 1249 canned amount.
  expect(createdPayload.voucher.voucherFields.grossAmount).not.toBe(1249);

  // Extraction is persisted (not discarded): response is a superset of the legacy shape + review.
  const extracted = await request.post(`${apiBaseUrl}/api/evidence/${createdPayload.evidence.id}/extract`);
  expect(extracted.ok()).toBeTruthy();
  const extraction = await extracted.json();
  expect(extraction.extracted).toBe(true);
  expect(extraction.liveExtraction).toBeTruthy();
  expect(extraction.review).toBeTruthy();

  // GET /api/evidence/:id (read-only) shows the stub supplier on the voucher + the review.
  const contextResponse = await request.get(`${apiBaseUrl}/api/evidence/${createdPayload.evidence.id}`);
  expect(contextResponse.ok()).toBeTruthy();
  const contextJson = await contextResponse.json();
  const supplierField = (contextJson.voucher.extractedFields as Array<{ key: string; value: string }>).find(
    (field) => field.key === "supplierName",
  );
  expect(supplierField?.value).toBe(createdPayload.voucher.voucherFields.supplierName);
  expect(contextJson.review).toBeTruthy();
  expect(contextJson.review.suggestion.voucherId).toBe(createdPayload.voucher.id);

  // Stub storage has no preview: file-url answers an honest 404.
  const fileUrl = await request.get(`${apiBaseUrl}/api/evidence/${createdPayload.evidence.id}/file-url`);
  expect(fileUrl.status()).toBe(404);
  expect((await fileUrl.json()).code).toBe("preview_unavailable");

  // Unknown evidence → 404.
  const missing = await request.get(`${apiBaseUrl}/api/evidence/evidence_missing`);
  expect(missing.status()).toBe(404);

  // Seed stability: the legacy create path still produces the canned 1249 amounts.
  const legacyCreate = await request.post(`${apiBaseUrl}/api/evidence`, { data: createEvidencePayload });
  expect(legacyCreate.ok()).toBeTruthy();
  expect((await legacyCreate.json()).voucher.voucherFields.grossAmount).toBe(1249);
});

test("assistant, knowledge, simulation, close, and import endpoints round-trip", async ({ request }) => {
  const assistant = await request.post(`${apiBaseUrl}/api/assistant/sessions`, {
    data: {
      actorId: "user_founder",
      question: "How should we think about deductible VAT here?",
    },
  });
  expect(assistant.ok()).toBeTruthy();
  const assistantData = await assistant.json();
  expect(assistantData.status).toBe("grounded");
  expect(assistantData.citations.length).toBeGreaterThan(0);

  const knowledge = await request.post(`${apiBaseUrl}/api/knowledge/query`, {
    data: {
      actorId: "user_founder",
      query: "representation limits",
    },
  });
  expect(knowledge.ok()).toBeTruthy();
  expect((await knowledge.json()).answer).toContain("Azure AI Search");

  // simulationRequestSchema now requires reviewIds + action (Phase 7 port). Pick a real
  // review from the demo seed instead of hardcoding an ID, since createId() is random.
  const simReviews = await request.get(`${apiBaseUrl}/api/reviews/feed`);
  const simReviewList = (await simReviews.json()) as Array<{ id: string }>;
  expect(simReviewList.length).toBeGreaterThan(0);

  const simulation = await request.post(`${apiBaseUrl}/api/simulations/run`, {
    data: {
      actorId: "user_founder",
      title: "Representation reclassification",
      scenario: "Treat a lunch receipt as representation and compare VAT impact.",
      reviewIds: [simReviewList[0]!.id],
      action: "approve",
    },
  });
  expect(simulation.ok()).toBeTruthy();
  const simulationJson = await simulation.json();
  expect(simulationJson).toMatchObject({
    title: "Representation reclassification",
  });
  expect(Array.isArray(simulationJson.balanceDelta)).toBe(true);
  expect(Array.isArray(simulationJson.vatDelta)).toBe(true);

  const closeRun = await request.post(`${apiBaseUrl}/api/close-runs`);
  expect(closeRun.ok()).toBeTruthy();
  const closeRunData = await closeRun.json();
  expect(closeRunData.checklist.length).toBeGreaterThan(0);

  const closeRunById = await request.get(`${apiBaseUrl}/api/close-runs/playwright-close`);
  expect(closeRunById.ok()).toBeTruthy();
  expect((await closeRunById.json()).id).toBe("playwright-close");

  const sieImport = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: {
      "content-type": "text/plain",
    },
    data: "#FLAGGA 0\n#TRANS 1930 {} -100\n#TRANS 6540 {} 100",
  });
  expect(sieImport.ok()).toBeTruthy();
  expect(await sieImport.json()).toMatchObject({
    accepted: true,
    importedTransactions: 2,
  });
});
