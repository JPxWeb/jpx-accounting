import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import test from "node:test";

import {
  evidenceCreateInputSchema,
  evidenceComposeInputSchema,
  knowledgeQuerySchema,
  reviewDecisionInputSchema,
  simulationRequestSchema,
  suggestionRequestSchema,
} from "@jpx-accounting/contracts";
import { DEMO_ACTOR_ID, MemoryLedgerStore, type LedgerStore } from "@jpx-accounting/domain";

import { createAdvisorChatHandler } from "../../services/api/src/advisor/chat";
import { clientIpKey, createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

/**
 * WS-C R5 + WS-C 3 regression tests: actor attribution is SERVER-derived
 * (verified JWT subject as `user:<sub>`, else the demo sentinel), client-posted
 * actorId is never honored, and the rate limiters key on the verified subject
 * with a spoof-resistant client-address fallback.
 */

type TestAppOverrides = {
  jwksUrl?: string;
  allowTestReset?: boolean;
  store?: LedgerStore;
};

function createTestApiApp(runtimeMode: "demo" | "normal", overrides: TestAppOverrides = {}) {
  const corsPolicy =
    runtimeMode === "demo"
      ? ({ kind: "wildcard" } as const)
      : { kind: "allowlist" as const, origins: ["http://localhost:3002"] };

  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode,
    allowTestReset: overrides.allowTestReset ?? false,
    corsPolicy,
    azureOpenAi: {},
    supabase: { poolerTransactionMode: false },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: { jwksUrl: overrides.jwksUrl },
    advisor: { toolApprovalSecret: "test-advisor-approval-secret" },
  });

  return createApp({
    ...dependencies,
    ...(overrides.store !== undefined ? { store: overrides.store } : {}),
    allowTestReset: overrides.allowTestReset ?? false,
  });
}

const JWKS_TEST_URL = "https://project.supabase.test/auth/v1/keys";

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Real ES256 key pair + signer so the hono/jwk verification path runs end-to-end. */
function createEs256TestKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "ES256" };
  const signToken = (payload: Record<string, unknown>) => {
    const signingInput = `${base64UrlJson({ alg: "ES256", typ: "JWT", kid: "test-kid" })}.${base64UrlJson(payload)}`;
    // ieee-p1363 = raw r||s, the JWS wire format (Node's default DER would not verify).
    const signature = signBytes("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" });
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

function evidenceBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    title: "Attribution test receipt",
    originalFilename: "attribution-test.jpg",
    mimeType: "image/jpeg",
    modalities: ["camera"],
    ...extra,
  });
}

const TINY_SIE_FIXTURE = [
  "#SIETYP 4",
  '#KONTO 6110 "Kontorsmateriel"',
  '#VER A 99 20260315 "Actor attribution import"',
  "{",
  "#TRANS 6110 {} 100.00",
  "#TRANS 1930 {} -100.00",
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// Contract sweep: request schemas carry no actorId and strip a posted one
// ---------------------------------------------------------------------------

test("request schemas have no actorId field and strip a client-posted one", () => {
  const evidence = evidenceCreateInputSchema.parse(
    JSON.parse(evidenceBody({ actorId: "user_hacker" })) as Record<string, unknown>,
  );
  assert.ok(!("actorId" in evidence), "evidenceCreateInputSchema must strip actorId");

  const compose = evidenceComposeInputSchema.parse({
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    evidenceIds: ["evidence_1"],
    actorId: "user_hacker",
  });
  assert.ok(!("actorId" in compose), "evidenceComposeInputSchema must strip actorId");

  const decision = reviewDecisionInputSchema.parse({ actorId: "user_hacker", notes: "n" });
  assert.deepEqual(decision, { notes: "n" });

  const simulation = simulationRequestSchema.parse({
    actorId: "user_hacker",
    title: "t",
    scenario: "s",
    reviewIds: ["r1"],
    action: "approve",
  });
  assert.ok(!("actorId" in simulation), "simulationRequestSchema must strip actorId");

  assert.deepEqual(knowledgeQuerySchema.parse({ actorId: "user_hacker", query: "moms" }), { query: "moms" });
  // The suggestion schema's only field WAS the client actorId — now an empty object that still strips it.
  assert.deepEqual(suggestionRequestSchema.parse({ actorId: "user_hacker" }), {});
});

// ---------------------------------------------------------------------------
// Demo mode (auth off): sentinel attribution, spoofed actorId ignored
// ---------------------------------------------------------------------------

test("demo mutation attributes to the demo sentinel and ignores a posted actorId", async () => {
  const store = new MemoryLedgerStore();
  const app = createTestApiApp("demo", { store });

  const response = await app.request("http://localhost/api/evidence", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: evidenceBody({ actorId: "user_hacker" }),
  });
  assert.equal(response.status, 201);
  const created = (await response.json()) as { evidence: { id: string; createdBy: string } };
  assert.equal(created.evidence.createdBy, DEMO_ACTOR_ID);

  const events = await store.getEvents();
  const received = events.find(
    (event) => event.eventType === "EvidenceReceived" && event.aggregateId === created.evidence.id,
  );
  assert.ok(received, "EvidenceReceived event expected");
  assert.equal(received.actorId, DEMO_ACTOR_ID, "the spoofed body actorId must never reach the event log");
});

test("SIE import no longer honors the ?actorId= override", async () => {
  const store = new MemoryLedgerStore();
  const app = createTestApiApp("demo", { store });

  const response = await app.request("http://localhost/api/imports/sie?actorId=user_evil", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: TINY_SIE_FIXTURE,
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as { importedVouchers: number };
  assert.equal(result.importedVouchers, 1);

  const imported = (await store.getEvents()).find((event) => event.eventType === "VoucherImported");
  assert.ok(imported, "VoucherImported event expected");
  assert.equal(imported.actorId, DEMO_ACTOR_ID);
});

// ---------------------------------------------------------------------------
// Auth on: the VERIFIED subject becomes the actor (user:<sub>)
// ---------------------------------------------------------------------------

test("JWT mutations attribute to the verified subject, not the posted actorId", async () => {
  const { publicJwk, signToken } = createEs256TestKey();
  await withStubbedFetch((async () => Response.json({ keys: [publicJwk] })) as typeof fetch, async () => {
    const store = new MemoryLedgerStore();
    const app = createTestApiApp("demo", { jwksUrl: JWKS_TEST_URL, store });
    const token = signToken({ sub: "9f8d7c6b-user", exp: Math.floor(Date.now() / 1000) + 3600 });
    const authHeaders = { authorization: `Bearer ${token}` };

    const created = await app.request("http://localhost/api/evidence", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: evidenceBody({ actorId: "user_hacker" }),
    });
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as {
      evidence: { id: string; createdBy: string };
      review: { id: string };
    };
    assert.equal(createdPayload.evidence.createdBy, "user:9f8d7c6b-user");

    const receivedEvent = (await store.getEvents()).find(
      (event) => event.eventType === "EvidenceReceived" && event.aggregateId === createdPayload.evidence.id,
    );
    assert.equal(receivedEvent?.actorId, "user:9f8d7c6b-user");

    // The review decision records the same server-derived subject.
    const approved = await app.request(`http://localhost/api/reviews/${createdPayload.review.id}/approve`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ actorId: "user_hacker", notes: "attribution test" }),
    });
    assert.equal(approved.status, 200);

    const decisionEvent = (await store.getEvents()).find(
      (event) => event.eventType === "ReviewApproved" && event.aggregateId === createdPayload.review.id,
    );
    assert.equal(decisionEvent?.actorId, "user:9f8d7c6b-user");
    const postedEvent = (await store.getEvents()).find(
      (event) => event.eventType === "PostedToLedger" && event.actorId === "user:9f8d7c6b-user",
    );
    assert.ok(postedEvent, "the posting event must carry the verified subject too");
  });
});

test("a verified token without a usable sub claim fails closed with 401 on mutations", async () => {
  const { publicJwk, signToken } = createEs256TestKey();
  await withStubbedFetch((async () => Response.json({ keys: [publicJwk] })) as typeof fetch, async () => {
    const app = createTestApiApp("demo", { jwksUrl: JWKS_TEST_URL });
    // Signature-valid, but no attributable subject: sub missing entirely.
    const token = signToken({ exp: Math.floor(Date.now() / 1000) + 3600 });

    const response = await app.request("http://localhost/api/evidence", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: evidenceBody(),
    });
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /sub/i);
  });
});

// ---------------------------------------------------------------------------
// Advisor: approved proposeReviewAction executes with the SAME derivation
// ---------------------------------------------------------------------------

test("advisor approval execution attributes to the actor threaded from the route", async () => {
  const store = new MemoryLedgerStore();
  const snapshot = await store.getSnapshot();
  const review = snapshot.reviews.find((item) => item.status === "needs-review");
  assert.ok(review?.suggestion, "seeded review with suggestion required");
  const voucher = snapshot.vouchers.find((item) => item.id === review.voucherId);

  const proposal = {
    reviewId: review.id,
    voucherId: review.voucherId,
    reviewTitle: review.title,
    action: "approve" as const,
    edited: {
      accountNumber: review.suggestion.accountNumber,
      accountName: review.suggestion.accountName,
      vatCode: review.suggestion.vatCode,
    },
    reasoning: review.suggestion.reasoning,
    confidence: review.suggestion.confidence,
    grossAmount: voucher?.voucherFields.grossAmount ?? null,
  };

  const handler = createAdvisorChatHandler({
    getStore: () => store,
    runtimeMode: "demo",
    model: undefined,
    toolApprovalSecret: "test-advisor-approval-secret",
  });

  const toolCallId = "attribution-tool-call";
  const messages = [
    { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text: "godkänn granskningen" }] },
    {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        {
          type: "tool-proposeReviewAction" as const,
          toolCallId,
          state: "approval-responded" as const,
          input: proposal,
          approval: { id: `${toolCallId}-approval`, approved: true },
        },
      ],
    },
  ];

  const response = await handler(
    new Request("http://localhost/api/advisor/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
    }),
    { actorId: "user:advisor-subject" },
  );
  assert.equal(response.status, 200);
  await response.text();

  const decisionEvent = (await store.getEvents()).find(
    (event) => event.eventType === "ReviewApproved" && event.aggregateId === review.id,
  );
  assert.equal(decisionEvent?.actorId, "user:advisor-subject");
});

// ---------------------------------------------------------------------------
// WS-C 3: rate-limit key derivation
// ---------------------------------------------------------------------------

test("clientIpKey takes the rightmost XFF hop, strips ports, and falls back honestly", () => {
  // Rightmost hop wins: the leftmost entries are attacker-controlled input.
  assert.equal(clientIpKey("6.6.6.6, 198.51.100.7", undefined), "198.51.100.7");
  assert.equal(clientIpKey("spoofed, more-spoof, 203.0.113.9:49152", undefined), "203.0.113.9");
  // Azure App Service formats the appended hop as ip:port — the port must not fragment buckets.
  assert.equal(clientIpKey("203.0.113.9:49152", undefined), "203.0.113.9");
  assert.equal(clientIpKey("[2001:db8::1]:8443", undefined), "2001:db8::1");
  // Bare IPv6 (multiple colons, no brackets) passes through un-mangled.
  assert.equal(clientIpKey("2001:db8::1", undefined), "2001:db8::1");
  // Fallbacks: x-real-ip, then one shared bucket.
  assert.equal(clientIpKey(undefined, "192.0.2.4"), "192.0.2.4");
  assert.equal(clientIpKey("", "192.0.2.4"), "192.0.2.4");
  assert.equal(clientIpKey(undefined, undefined), "unknown");
});

test("spoofing the leftmost XFF hop does not mint fresh rate-limit buckets", async () => {
  const app = createTestApiApp("demo");

  let limited: Response | undefined;
  for (let i = 0; i < 61; i += 1) {
    const response = await app.request("http://localhost/api/close-runs", {
      method: "POST",
      // A new leftmost hop every request; the rightmost (platform-appended) hop stays fixed.
      headers: { "x-forwarded-for": `spoof-${i}, 203.0.113.9:${40000 + i}` },
    });
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert.equal(response.status, 201);
  }
  assert.ok(limited, "the 61st mutation from one real client address must be rate limited");
});

test("with auth on, the mutation limiter keys on the verified subject", async () => {
  const { publicJwk, signToken } = createEs256TestKey();
  await withStubbedFetch((async () => Response.json({ keys: [publicJwk] })) as typeof fetch, async () => {
    const app = createTestApiApp("demo", { jwksUrl: JWKS_TEST_URL });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const tokenA = signToken({ sub: "subject-a", exp });
    const tokenB = signToken({ sub: "subject-b", exp });

    // Same (absent) client address for everyone: only the subject distinguishes them.
    let limited: Response | undefined;
    for (let i = 0; i < 61; i += 1) {
      const response = await app.request("http://localhost/api/close-runs", {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      if (response.status === 429) {
        limited = response;
        break;
      }
      assert.equal(response.status, 201);
    }
    assert.ok(limited, "subject A must exhaust its own budget");

    // Subject B shares the address but not the bucket.
    const other = await app.request("http://localhost/api/close-runs", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(other.status, 201, "a different verified subject must not inherit A's exhausted bucket");
  });
});

test("report/export GETs carry a modest read limiter; other reads stay unlimited", async () => {
  const app = createTestApiApp("demo");

  let limited: Response | undefined;
  for (let i = 0; i < 121; i += 1) {
    const response = await app.request("http://localhost/api/reports/journal");
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert.equal(response.status, 200);
  }
  assert.ok(limited, "the 121st report read in one minute must be rate limited");
  const body = (await limited.json()) as { error: string };
  assert.match(body.error, /too many requests/i);

  // The read limiter is scoped to /api/reports/* + /api/exports/*: the workspace snapshot is untouched.
  const workspace = await app.request("http://localhost/api/workspace");
  assert.equal(workspace.status, 200);

  // The export surface shares the same limiter key, so it is already exhausted for this client.
  const sieExport = await app.request("http://localhost/api/exports/sie");
  assert.equal(sieExport.status, 429);
});

test("demo E2E instances (ALLOW_TEST_RESET) bypass the read limiter like the mutation limiter", async () => {
  const app = createTestApiApp("demo", { allowTestReset: true });
  for (let i = 0; i < 121; i += 1) {
    const response = await app.request("http://localhost/api/reports/journal");
    assert.equal(response.status, 200);
  }
});
