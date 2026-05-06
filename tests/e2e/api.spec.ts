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
  expect(await upload.json()).toMatchObject({
    filename: "playwright-receipt.jpg",
  });

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

  const simulation = await request.post(`${apiBaseUrl}/api/simulations/run`, {
    data: {
      actorId: "user_founder",
      title: "Representation reclassification",
      scenario: "Treat a lunch receipt as representation and compare VAT impact.",
    },
  });
  expect(simulation.ok()).toBeTruthy();
  expect(await simulation.json()).toMatchObject({
    title: "Representation reclassification",
  });

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
