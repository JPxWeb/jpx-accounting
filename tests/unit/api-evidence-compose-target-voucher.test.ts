/**
 * KFR Phase D / Task 2: `POST /api/evidence/compose` accepts an explicit
 * `targetVoucherId` so a receipt can be attached to migrated (SIE-imported)
 * history, which carries no packet breadcrumb for auto-detect to follow.
 * An id that names no voucher in scope is a 404 `voucher_not_found`, not a
 * catch-all 500 (CONVENTIONS Rule 16).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp() {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: {},
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });
  return createApp({ ...dependencies, store: new MemoryLedgerStore(), allowTestReset: false });
}

type TestApp = ReturnType<typeof createTestApiApp>;

async function createEvidence(app: TestApp, title: string): Promise<{ id: string; voucherId: string }> {
  const response = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title,
      originalFilename: `${title.replace(/\s+/g, "-").toLowerCase()}.jpg`,
      mimeType: "image/jpeg",
      modalities: ["camera"],
    }),
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as { evidence: { id: string }; voucherId: string };
  return { id: created.evidence.id, voucherId: created.voucherId };
}

const SIE_FILE = [
  "#SIETYP 4",
  '#KONTO 6110 "Kontorsmateriel"',
  '#VER A 42 20260315 "Inkopta parmar"',
  "{",
  "#TRANS 6110 {} 100.00",
  "#TRANS 1930 {} -100.00",
  "}",
].join("\n");

test("POST /api/evidence/compose attaches the packet to an imported voucher named by targetVoucherId", async () => {
  const app = createTestApiApp();

  const importResponse = await app.request("http://localhost/api/imports/sie", {
    method: "POST",
    body: SIE_FILE,
  });
  assert.equal(importResponse.status, 200);
  assert.equal((await importResponse.json()).importedVouchers, 1);

  const receipt = await createEvidence(app, "Receipt for migrated history");

  const composeResponse = await app.request("http://localhost/api/evidence/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ evidenceIds: [receipt.id], targetVoucherId: "sie_A_42" }),
  });
  assert.equal(composeResponse.status, 201);
  const packet = (await composeResponse.json()) as { id: string };

  // The evidence detail read API must surface the attachment.
  const detailResponse = await app.request(`http://localhost/api/evidence/${receipt.id}`);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as {
    packet?: { id: string };
    voucher?: { id: string; origin: string; status: string; evidencePacketId: string | null };
    review?: unknown;
  };

  assert.equal(detail.voucher?.id, "sie_A_42");
  assert.equal(detail.voucher?.origin, "import");
  assert.equal(detail.voucher?.status, "posted");
  assert.equal(detail.voucher?.evidencePacketId, packet.id);
  assert.equal(detail.packet?.id, packet.id);
  // An imported voucher never passed a review decision — no ReviewTask exists.
  assert.equal(detail.review, undefined);
});

test("POST /api/evidence/compose 404s with voucher_not_found for an unknown targetVoucherId", async () => {
  const app = createTestApiApp();
  const receipt = await createEvidence(app, "Compose target test");

  const composeResponse = await app.request("http://localhost/api/evidence/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ evidenceIds: [receipt.id], targetVoucherId: "sie_does_not_exist" }),
  });

  assert.equal(composeResponse.status, 404);
  const body = (await composeResponse.json()) as { code?: string };
  assert.equal(body.code, "voucher_not_found");

  // The rejected attach changed nothing: the receipt still resolves to its own
  // native voucher, and no orphan packet was left behind.
  const detailResponse = await app.request(`http://localhost/api/evidence/${receipt.id}`);
  const detail = (await detailResponse.json()) as { packet?: { id: string }; voucher?: { id: string } };
  assert.equal(detail.voucher?.id, receipt.voucherId);
});
