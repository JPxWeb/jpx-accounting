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
  expect(snapshot.closeRun.id).toBe("close_unavailable");
  expect(snapshot.closeRun.period).toMatch(/^\d{4}-\d{2}$/);
  expect(snapshot.closeRun.checklist).toHaveLength(0);

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
    data: {},
  });
  expect(suggestion.ok()).toBeTruthy();
  expect(await suggestion.json()).toMatchObject({
    voucherId: createdPayload.voucher.id,
  });

  const journalBefore = await request.get(`${apiBaseUrl}/api/reports/journal`);
  const journalBeforeData = await journalBefore.json();
  expect(journalBeforeData).toHaveLength(3);

  const approve = await request.post(`${apiBaseUrl}/api/reviews/${createdPayload.review.id}/approve`, {
    data: { notes: "Reviewed in Playwright" },
  });
  expect(approve.ok()).toBeTruthy();
  expect(await approve.json()).toMatchObject({
    status: "approved",
  });

  const journalAfterApprove = await request.get(`${apiBaseUrl}/api/reports/journal`);
  const journalAfterApproveData = await journalAfterApprove.json();
  expect(journalAfterApproveData).toHaveLength(6);

  const approveAgain = await request.post(`${apiBaseUrl}/api/reviews/${createdPayload.review.id}/approve`, {
    data: { notes: "Replay should be safe" },
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

test("knowledge, simulation, close, and import endpoints round-trip", async ({ request }) => {
  // `/api/assistant/sessions` was retired in Phase 6 — superseded by the
  // streaming `/api/advisor/chat` (pinned below): gone means 404.
  const retiredAssistant = await request.post(`${apiBaseUrl}/api/assistant/sessions`, {
    data: { question: "retired?" },
  });
  expect(retiredAssistant.status()).toBe(404);

  // Knowledge query returns real sourced passages from the bundled corpus
  // (BM25-lite keyword mode until the pgvector loop lands in Task 5.11).
  // "representation" ranks a Skatteverket-sourced chunk first per the corpus
  // retrieval unit tests.
  const knowledge = await request.post(`${apiBaseUrl}/api/knowledge/query`, {
    data: {
      query: "representation",
    },
  });
  expect(knowledge.ok()).toBeTruthy();
  const knowledgeJson = await knowledge.json();
  expect(knowledgeJson.mode).toBe("keyword");
  expect(knowledgeJson.passages.length).toBeGreaterThanOrEqual(1);
  expect(knowledgeJson.passages[0].source).toMatch(/Skatteverket|Bokföringslagen|BAS/);
  expect(knowledgeJson.passages[0].excerpt.length).toBeGreaterThan(0);

  // simulationRequestSchema now requires reviewIds + action (Phase 7 port). Pick a real
  // review from the demo seed instead of hardcoding an ID, since createId() is random.
  const simReviews = await request.get(`${apiBaseUrl}/api/reviews/feed`);
  const simReviewList = (await simReviews.json()) as Array<{ id: string }>;
  expect(simReviewList.length).toBeGreaterThan(0);

  const simulation = await request.post(`${apiBaseUrl}/api/simulations/run`, {
    data: {
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
  expect(closeRunData).toMatchObject({
    id: "close_unavailable",
    checklist: [],
  });
  expect(closeRunData.period).toMatch(/^\d{4}-\d{2}$/);

  const closeRunById = await request.get(`${apiBaseUrl}/api/close-runs/close_unavailable`);
  expect(closeRunById.ok()).toBeTruthy();
  expect((await closeRunById.json()).id).toBe("close_unavailable");

  const wrongCloseRun = await request.get(`${apiBaseUrl}/api/close-runs/playwright-close`);
  expect(wrongCloseRun.status()).toBe(404);

  // SIE import: a real #VER block (the parser ignores bare #TRANS lines — the
  // old placeholder fixture posted those and would import nothing).
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 77 20260315 "SIE import via Playwright"',
    "{",
    "#TRANS 6110 {} 100.00",
    "#TRANS 1930 {} -100.00",
    "}",
  ].join("\n");
  const sieImport = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: {
      "content-type": "text/plain",
    },
    data: sieFixture,
  });
  expect(sieImport.ok()).toBeTruthy();
  expect(await sieImport.json()).toMatchObject({
    accepted: true,
    importedVouchers: 1,
    importedTransactions: 2,
    skipped: [],
  });

  // Re-posting the same file is idempotent: the voucher is skipped as a duplicate.
  const sieReimport = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: {
      "content-type": "text/plain",
    },
    data: sieFixture,
  });
  expect(sieReimport.ok()).toBeTruthy();
  expect(await sieReimport.json()).toMatchObject({
    accepted: true,
    importedVouchers: 0,
    importedTransactions: 0,
    skipped: [{ reference: "A 77", reason: "duplicate" }],
  });

  // Export is spec-valid SIE 4 in PC8: the byte-identical #PROGRAM pin, the
  // #SIETYP 4 header, and the imported voucher's lines all present.
  const sieExport = await request.get(`${apiBaseUrl}/api/exports/sie`);
  expect(sieExport.ok()).toBeTruthy();
  expect(sieExport.headers()["content-type"]).toContain("ibm437");
  const sieExportText = await sieExport.text();
  expect(sieExportText).toContain('#PROGRAM "JPX Accounting" "0.1.0"');
  expect(sieExportText).toContain("#SIETYP 4");
  expect(sieExportText).toContain("#TRANS 6110 {} 100.00");
});

test("advisor chat streams a UI-message SSE turn in demo mode", async ({ request }) => {
  const response = await request.post(`${apiBaseUrl}/api/advisor/chat`, {
    data: {
      id: "advisor-smoke",
      trigger: "submit-message",
      messages: [
        {
          id: "advisor-smoke-q1",
          role: "user",
          parts: [{ type: "text", text: "Hur ser kassan ut just nu?" }],
        },
      ],
    },
  });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toContain("text/event-stream");
  expect(headers["x-vercel-ai-ui-message-stream"]).toBe("v1");

  // The demo turn is deterministic and finite: data: frames carrying text
  // deltas, a finish frame, and the SSE [DONE] terminator.
  const body = await response.text();
  expect(body).toContain("data: ");
  expect(body).toContain('"type":"text-delta"');
  expect(body).toContain('"type":"finish"');
  expect(body).toContain("data: [DONE]");

  // Bounded body: exceeding the 40-message ceiling is a well-formed but
  // unprocessable request → 422 with the validation_error shape (Rule 16).
  const oversized = await request.post(`${apiBaseUrl}/api/advisor/chat`, {
    data: {
      id: "advisor-smoke-oversized",
      trigger: "submit-message",
      messages: Array.from({ length: 41 }, (_, index) => ({
        id: `advisor-smoke-m${index}`,
        role: "user",
        parts: [{ type: "text", text: `fråga ${index}` }],
      })),
    },
  });
  expect(oversized.status()).toBe(422);
  expect((await oversized.json()).code).toBe("validation_error");
});

test("integrity and runtime-info endpoints surface a linked chain and the demo AI posture", async ({ request }) => {
  // Fresh reset → the demo seed's four events (EvidenceReceived,
  // FieldsExtracted, VoucherCreated, SuggestionGenerated) in one linked chain.
  const integrity = await request.get(`${apiBaseUrl}/api/integrity`);
  expect(integrity.ok()).toBeTruthy();
  const integrityJson = await integrity.json();
  expect(integrityJson.chainLinked).toBe(true);
  expect(integrityJson.eventCount).toBe(4);
  expect(typeof integrityJson.headHash).toBe("string");
  expect(integrityJson.recentEvents).toHaveLength(4);
  // Newest-first: the seed's last append leads.
  expect(integrityJson.recentEvents[0].eventType).toBe("SuggestionGenerated");
  expect(integrityJson.bas).toMatchObject({ template: "bas-2026" });
  expect(integrityJson.bas.accountCount).toBeGreaterThan(0);

  // A mutation extends the chain and keeps it linked.
  const created = await request.post(`${apiBaseUrl}/api/evidence`, { data: createEvidencePayload });
  expect(created.ok()).toBeTruthy();
  const integrityAfter = await request.get(`${apiBaseUrl}/api/integrity`);
  const integrityAfterJson = await integrityAfter.json();
  expect(integrityAfterJson.chainLinked).toBe(true);
  expect(integrityAfterJson.eventCount).toBe(8);
  expect(integrityAfterJson.recentEvents).toHaveLength(8);

  const runtimeInfo = await request.get(`${apiBaseUrl}/api/runtime-info`);
  expect(runtimeInfo.ok()).toBeTruthy();
  expect(await runtimeInfo.json()).toMatchObject({
    runtimeMode: "demo",
    ai: { operational: true, provider: "local-demo" },
  });
});

test("period-scoped report routes and the ReportPack endpoint", async ({ request }) => {
  // Default pack FIRST, while the workspace is seed-only: the seed books its
  // lines "now", so the no-param pack (current month) reconciles to the
  // Phase 4 finding-8 numbers. Fetching before the March import keeps the
  // cumulative cash/balance-sheet figures seed-pure.
  const defaultPack = await request.get(`${apiBaseUrl}/api/reports/pack`);
  expect(defaultPack.ok()).toBeTruthy();
  const defaultJson = await defaultPack.json();
  expect(defaultJson.period.kind).toBe("month");
  expect(defaultJson.profitLoss.periodResult).toBe(-1000);
  expect(defaultJson.cashBridge.closing).toBe(-1250);
  expect(defaultJson.balanceSheet.balanced).toBe(true);
  const boxAmount = (pack: { vatReturn: Array<{ box: string; amount: number }> }, box: string) =>
    pack.vatReturn.find((entry) => entry.box === box)?.amount;
  expect(boxAmount(defaultJson, "48")).toBe(250);
  expect(boxAmount(defaultJson, "49")).toBe(-250);

  // Pin the March fixture: seed lines are booked "now", so a 2026-03-15
  // voucher is a permanent out-of-default-period fixture (finding 8).
  const sieFixture = [
    "#FLAGGA 0",
    "#SIETYP 4",
    '#KONTO 6110 "Kontorsmateriel"',
    '#VER A 90 20260315 "March window fixture"',
    "{",
    "#TRANS 6110 {} 100.00",
    "#TRANS 1930 {} -100.00",
    "}",
  ].join("\n");
  const imported = await request.post(`${apiBaseUrl}/api/imports/sie`, {
    headers: { "content-type": "text/plain" },
    data: sieFixture,
  });
  expect(imported.ok()).toBeTruthy();
  expect(await imported.json()).toMatchObject({ accepted: true, importedVouchers: 1 });

  // March window → exactly the two imported lines.
  const march = await request.get(`${apiBaseUrl}/api/reports/journal?from=2026-03-01&to=2026-03-31`);
  expect(march.ok()).toBeTruthy();
  const marchData = (await march.json()) as Array<{ accountNumber: string; bookedAt: string }>;
  expect(marchData).toHaveLength(2);
  expect(marchData.map((entry) => entry.accountNumber)).toEqual(["6110", "1930"]);

  // April window → empty.
  const april = await request.get(`${apiBaseUrl}/api/reports/journal?from=2026-04-01&to=2026-04-30`);
  expect(april.ok()).toBeTruthy();
  expect(await april.json()).toHaveLength(0);

  // Trial balance over the window is the period movement.
  const trialBalance = await request.get(`${apiBaseUrl}/api/reports/trial-balance?from=2026-03-01&to=2026-03-31`);
  expect(trialBalance.ok()).toBeTruthy();
  const trialBalanceData = (await trialBalance.json()) as Array<{ accountNumber: string; debit: number }>;
  expect(trialBalanceData).toHaveLength(2);
  expect(trialBalanceData.find((row) => row.accountNumber === "6110")?.debit).toBe(100);

  // Malformed and inverted windows → 422 (Rule 16).
  const malformed = await request.get(`${apiBaseUrl}/api/reports/journal?from=2026-3-01`);
  expect(malformed.status()).toBe(422);
  const inverted = await request.get(`${apiBaseUrl}/api/reports/journal?from=2026-04-01&to=2026-03-01`);
  expect(inverted.status()).toBe(422);

  // ReportPack for March: the imported voucher is the whole story.
  const pack = await request.get(`${apiBaseUrl}/api/reports/pack?period=2026-03`);
  expect(pack.ok()).toBeTruthy();
  const packJson = await pack.json();
  expect(packJson.period).toMatchObject({ token: "2026-03", kind: "month", from: "2026-03-01", to: "2026-03-31" });
  expect(packJson.profitLoss.periodResult).toBe(-100);
  // The SIE subset carries no VAT semantics, so the net-VAT box stays 0 —
  // present in the return, honest about the window.
  expect(boxAmount(packJson, "49")).toBe(0);

  // Unknown period token → 422 via InvalidPeriodTokenError.
  const bogus = await request.get(`${apiBaseUrl}/api/reports/pack?period=bogus`);
  expect(bogus.status()).toBe(422);
  expect((await bogus.json()).code).toBe("invalid_period_token");
});
