import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAccountingApiClient } from "@jpx-accounting/api-client";
import type { UploadInitResult } from "@jpx-accounting/contracts";

// ---------------------------------------------------------------------------
// WS-C R12: Authorization bearer threading through the api-client token seam
// ---------------------------------------------------------------------------

const BASE_URL = "http://api.test";

type CapturedRequest = { url: string; init: RequestInit | undefined };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RUNTIME_INFO_BODY = { runtimeMode: "normal", ai: { operational: true, provider: "azure-openai" } };

function mockFetch(t: test.TestContext, respond: (url: string) => Response): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    captured.push({ url, init });
    return respond(url);
  });
  return captured;
}

function authorizationOf(request: CapturedRequest): string | null {
  return new Headers(request.init?.headers).get("authorization");
}

test("requestJson path attaches Authorization: Bearer when the provider yields a token", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(RUNTIME_INFO_BODY));
  const providerCalls: number[] = [];
  const client = createAccountingApiClient({
    baseUrl: BASE_URL,
    runtimeMode: "normal",
    getAuthToken: async () => {
      providerCalls.push(1);
      return "session-token-123";
    },
  });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "normal");
  assert.equal(captured.length, 1);
  const first = captured[0];
  assert.ok(first);
  assert.equal(first.url, `${BASE_URL}/api/runtime-info`);
  assert.equal(authorizationOf(first), "Bearer session-token-123");
  // Token resolved per request — never cached at construction.
  assert.equal(providerCalls.length, 1);
  await client.getRuntimeInfo();
  assert.equal(providerCalls.length, 2);
});

test("direct-fetch paths (getCompanySettings) attach the same bearer token", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(null));
  const client = createAccountingApiClient({
    baseUrl: BASE_URL,
    runtimeMode: "normal",
    getAuthToken: () => "sync-token",
  });

  const settings = await client.getCompanySettings();

  assert.equal(settings, null);
  const first = captured[0];
  assert.ok(first);
  assert.equal(first.url, `${BASE_URL}/api/settings/company`);
  assert.equal(authorizationOf(first), "Bearer sync-token");
});

test("no provider configured → no authorization header (pre-auth behavior unchanged)", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(RUNTIME_INFO_BODY));
  const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

  await client.getRuntimeInfo();

  const first = captured[0];
  assert.ok(first);
  assert.equal(authorizationOf(first), null);
});

test("provider resolving undefined (signed out / auth unconfigured) sends no header", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(RUNTIME_INFO_BODY));
  const client = createAccountingApiClient({
    baseUrl: BASE_URL,
    runtimeMode: "normal",
    getAuthToken: async () => undefined,
  });

  await client.getRuntimeInfo();

  const first = captured[0];
  assert.ok(first);
  assert.equal(authorizationOf(first), null);
});

test("provider failure degrades to an unauthenticated request instead of throwing", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(RUNTIME_INFO_BODY));
  const warn = t.mock.method(console, "warn", () => {});
  const client = createAccountingApiClient({
    baseUrl: BASE_URL,
    runtimeMode: "normal",
    getAuthToken: async () => {
      throw new Error("token backend down");
    },
  });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "normal");
  const first = captured[0];
  assert.ok(first);
  assert.equal(authorizationOf(first), null);
  assert.equal(warn.mock.callCount(), 1);
});

const UPLOAD_RESULT_BASE = {
  uploadId: "upload_1",
  filename: "receipt.pdf",
  blobPath: "evidence-uploads/upload_1/receipt.pdf",
  requiredContentType: "application/pdf",
  requiredBlobType: "BlockBlob" as const,
  expiresInSeconds: 600,
};

test("uploadBlob attaches the token for API-relative stub uploads only", async (t) => {
  const captured = mockFetch(t, () => new Response(null, { status: 201 }));
  const client = createAccountingApiClient({
    baseUrl: BASE_URL,
    runtimeMode: "normal",
    getAuthToken: () => "upload-token",
  });

  const stubUpload: UploadInitResult = { ...UPLOAD_RESULT_BASE, uploadUrl: "/api/uploads/upload_1" };
  await client.uploadBlob(stubUpload, new Uint8Array([1, 2, 3]));

  const stubRequest = captured[0];
  assert.ok(stubRequest);
  assert.equal(stubRequest.url, `${BASE_URL}/api/uploads/upload_1`);
  assert.equal(authorizationOf(stubRequest), "Bearer upload-token");

  // Azure SAS URLs are their own credential — the session token must NOT leak
  // to the storage host.
  const sasUpload: UploadInitResult = {
    ...UPLOAD_RESULT_BASE,
    uploadUrl: "https://account.blob.core.windows.net/evidence/receipt.pdf?sig=abc",
  };
  await client.uploadBlob(sasUpload, new Uint8Array([1, 2, 3]));

  const sasRequest = captured[1];
  assert.ok(sasRequest);
  assert.match(sasRequest.url, /^https:\/\/account\.blob\.core\.windows\.net\//);
  assert.equal(authorizationOf(sasRequest), null);
  // The SAS request keeps its blob headers.
  assert.equal(new Headers(sasRequest.init?.headers).get("x-ms-blob-type"), "BlockBlob");
});

test("demo fallback store bypasses the network — provider is never consulted", async (t) => {
  const captured = mockFetch(t, () => jsonResponse(RUNTIME_INFO_BODY));
  let providerCalls = 0;
  const client = createAccountingApiClient({
    runtimeMode: "demo",
    getAuthToken: () => {
      providerCalls += 1;
      return "unused";
    },
  });

  const info = await client.getRuntimeInfo();

  assert.equal(info.runtimeMode, "demo");
  assert.equal(captured.length, 0);
  assert.equal(providerCalls, 0);
});

// ---------------------------------------------------------------------------
// The api-proxy must forward the Authorization header upstream — otherwise the
// bearer token dies at the Next server and every normal-mode request 401s.
// The route module imports "server-only" (unimportable under node:test), so
// pin the request-header allowlist at source level instead.
// ---------------------------------------------------------------------------

test("api-proxy request-header allowlist forwards authorization upstream", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const routeSource = readFileSync(
    path.join(repoRoot, "apps", "web", "app", "api-proxy", "[...path]", "route.ts"),
    "utf8",
  );
  const allowlist = routeSource.match(/const requestHeaders = \[(?<entries>[^\]]*)\]/)?.groups?.entries;
  assert.ok(allowlist, "api-proxy route.ts must declare the requestHeaders allowlist");
  assert.match(allowlist, /"authorization"/);
});
