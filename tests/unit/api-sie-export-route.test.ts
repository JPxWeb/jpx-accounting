/**
 * KFR Phase D / Task 7: `GET /api/exports/sie?period=<token>` scopes the SIE
 * export to a period — the token is validated through the SAME
 * `resolvePeriodToken` the reports pack uses (so a bad token is a 422
 * `invalid_period_token`, not a silent full-history export), and the
 * `content-disposition` filename names the period instead of today.
 * Omitting `?period=` keeps the untouched full-history export.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { decodeSieBuffer } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain/store";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function createTestApiApp(store: MemoryLedgerStore) {
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
  return createApp({ ...dependencies, store, allowTestReset: false });
}

test("GET /api/exports/sie?period=bad-token -> 422 invalid_period_token", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  const response = await app.request("http://localhost/api/exports/sie?period=not-a-period");
  assert.equal(response.status, 422);
  const body = (await response.json()) as { code?: string };
  assert.equal(body.code, "invalid_period_token");
});

test("GET /api/exports/sie?period=fy-2026 -> filename reflects the period, body carries the scoped #RAR 0", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  const response = await app.request("http://localhost/api/exports/sie?period=fy-2026");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /filename="jpx-export-fy-2026\.se"/);
  assert.match(response.headers.get("content-type") ?? "", /charset=ibm437/);

  // The bytes are still PC8/CP437, and the declared window is the resolved
  // fiscal year — not the fiscal year containing the export timestamp.
  const text = decodeSieBuffer(new Uint8Array(await response.arrayBuffer()));
  assert.match(text, /^#RAR 0 20260101 20261231$/m);
});

test("GET /api/exports/sie?period=fy-YYYY floors #RAR 0 to the profile's firstFiscalYearStart", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  // Company incorporated 2025-10-15 on a 09-01 fiscal anchor: FY1 is the short
  // 2025-10-15…2026-08-31 window, not the full 2025-09-01…2026-08-31 one. The
  // export must inherit the D6 clamp rather than re-deriving the anchor.
  const saved = await app.request("http://localhost/api/settings/company", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationName: "Sen Start AB",
      organizationNumber: "556677-8899",
      addressLine1: "Kungsgatan 1",
      postalCode: "111 22",
      city: "Stockholm",
      contactEmail: "sen@example.com",
      profile: {
        country: "SE",
        locale: "sv-SE",
        currency: "SEK",
        fiscalYearStart: "09-01",
        firstFiscalYearStart: "2025-10-15",
        vatPeriod: "quarterly",
      },
      aiPosture: { advisorEnabled: true, suggestionsEnabled: true },
    }),
  });
  assert.equal(saved.status, 200);

  const response = await app.request("http://localhost/api/exports/sie?period=fy-2025");
  assert.equal(response.status, 200);
  const text = decodeSieBuffer(new Uint8Array(await response.arrayBuffer()));
  assert.match(text, /^#RAR 0 20251015 20260831$/m);
});

test("GET /api/exports/sie without ?period= keeps the full-history export (no #IB/#UB/#RES)", async () => {
  const app = createTestApiApp(new MemoryLedgerStore());
  const response = await app.request("http://localhost/api/exports/sie");
  assert.equal(response.status, 200);
  assert.doesNotMatch(response.headers.get("content-disposition") ?? "", /period/);

  const text = decodeSieBuffer(new Uint8Array(await response.arrayBuffer()));
  assert.doesNotMatch(text, /^#(IB|UB|RES) /m, "balance blocks belong to period-scoped exports only");
});
