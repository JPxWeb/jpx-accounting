/**
 * Thin in-process Hono ↔ PostgresLedgerStore smoke (Local Postgres Dev DB plan, Task 5).
 *
 * Uses the existing ES256 test-key / stubbed JWKS pattern (no standalone JWKS server).
 * Proves create-evidence → review-approve → server-derived actor attribution against a
 * real Postgres store, plus /ready ledger health.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import test from "node:test";

import { PostgresLedgerStore } from "@jpx-accounting/persistence-postgres";

import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";
import {
  openPostgresTestContext,
  preparePostgresIntegrationGate,
  type PostgresTestContext,
} from "./helpers/postgres-test-context";

const gate = preparePostgresIntegrationGate();
const skip = gate.skip;

let ctx: PostgresTestContext | undefined;

test.before(async () => {
  if (!gate.skip) {
    ctx = await openPostgresTestContext(gate);
  }
});

test.after(async () => {
  await ctx?.close();
  ctx = undefined;
});

function requireCtx(): PostgresTestContext {
  if (!ctx) {
    throw new Error("Postgres test context was not opened — gate.skip should have skipped this test");
  }
  return ctx;
}

const JWKS_TEST_URL = "https://project.supabase.test/auth/v1/keys";

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createEs256TestKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "ES256" };
  const signToken = (payload: Record<string, unknown>) => {
    const signingInput = `${base64UrlJson({ alg: "ES256", typ: "JWT", kid: "test-kid" })}.${base64UrlJson(payload)}`;
    const signature = signBytes("sha256", Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${signingInput}.${signature.toString("base64url")}`;
  };
  return { publicJwk, signToken };
}

async function withStubbedFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createPostgresApiApp(store: PostgresLedgerStore, jwksUrl: string) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: { jwksUrl },
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
  });

  return createApp({
    ...dependencies,
    store,
    allowTestReset: false,
  });
}

test(
  "API + PostgresLedgerStore: create evidence, approve via review gate, attribute to JWT subject, ready",
  { skip },
  async () => {
    const { organizationId, workspaceId } = requireCtx().createNamespace("api_smoke");
    const store = new PostgresLedgerStore(requireCtx().client, { organizationId, workspaceId });
    const { publicJwk, signToken } = createEs256TestKey();

    try {
      await withStubbedFetch((async () => Response.json({ keys: [publicJwk] })) as typeof fetch, async () => {
        const app = createPostgresApiApp(store, JWKS_TEST_URL);
        const token = signToken({
          sub: "smoke-user-42",
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        const authHeaders = {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        };

        const ready = await app.request("http://localhost/ready");
        assert.equal(ready.status, 200);
        const readyBody = (await ready.json()) as { ready: boolean; checks: { ledger: boolean } };
        assert.equal(readyBody.checks.ledger, true, "PostgresLedgerStore must satisfy /ready ledger probe");

        const created = await app.request("http://localhost/api/evidence", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            organizationId,
            workspaceId,
            title: "API postgres smoke receipt",
            originalFilename: "smoke.jpg",
            mimeType: "image/jpeg",
            modalities: ["camera"],
            actorId: "user_hacker",
          }),
        });
        assert.equal(created.status, 201);
        const createdPayload = (await created.json()) as {
          evidence: { id: string; createdBy: string };
          review: { id: string };
          voucher: { id: string; status: string };
        };
        assert.equal(createdPayload.evidence.createdBy, "user:smoke-user-42");
        assert.equal(createdPayload.voucher.status, "needs-review");

        const approved = await app.request(`http://localhost/api/reviews/${createdPayload.review.id}/approve`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ actorId: "user_hacker", notes: "api-postgres smoke" }),
        });
        assert.equal(approved.status, 200);
        const approvedPayload = (await approved.json()) as { status: string };
        assert.equal(approvedPayload.status, "approved");

        const events = await store.getEvents();
        const received = events.find(
          (event) => event.eventType === "EvidenceReceived" && event.aggregateId === createdPayload.evidence.id,
        );
        assert.equal(received?.actorId, "user:smoke-user-42");
        const decision = events.find(
          (event) => event.eventType === "ReviewApproved" && event.aggregateId === createdPayload.review.id,
        );
        assert.equal(decision?.actorId, "user:smoke-user-42");
        const posted = events.find(
          (event) => event.eventType === "PostedToLedger" && event.actorId === "user:smoke-user-42",
        );
        assert.ok(posted, "PostedToLedger must carry the verified JWT subject");

        const journal = (await store.getReports()).journal;
        assert.ok(journal.length >= 3, "approval must post ledger lines through the review gate");
      });
    } finally {
      await requireCtx().cleanupOrganization(organizationId);
    }
  },
);
