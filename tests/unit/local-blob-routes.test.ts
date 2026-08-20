import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MAX_UPLOAD_BYTES } from "../../services/api/src/blob";
import { createApp } from "../../services/api/src/app";
import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

function withTempBlobDir(t: test.TestContext): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "jpx-local-blob-routes-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

/**
 * Returns the app AND the uploader it was wired with: read URLs are minted by the uploader
 * (`mintReadSas`), exactly like `/api/evidence/:id/extract` does server-side — there is no public
 * "give me a read URL" route, and an upload token is deliberately not usable for GET.
 */
function createLocalBlobTestApp(rootDir: string) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "demo",
    allowTestReset: false,
    corsPolicy: { kind: "wildcard" },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    auth: { jwksUrl: undefined },
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
    localBlobDir: rootDir,
  });
  if (dependencies.blobUploader.kind !== "local") throw new Error("expected the local uploader for this test");
  return { app: createApp({ ...dependencies, allowTestReset: false }), uploader: dependencies.blobUploader };
}

/** Normal mode with a JWKS URL configured — the auth gate is live on every non-exempt /api/* route. */
function createJwksGatedLocalBlobApp(rootDir: string) {
  const dependencies = createApiRuntimeDependencies({
    port: 0,
    runtimeMode: "normal",
    allowTestReset: false,
    corsPolicy: { kind: "allowlist", origins: ["http://localhost:3002"] },
    azureOpenAi: {},
    database: { poolMode: "direct", poolMax: 10 },
    azureStorage: {},
    azureDocumentIntelligence: {},
    // Never actually fetched: the exemption must short-circuit BEFORE hono/jwk calls out to it,
    // and a request without a bearer token is rejected before key resolution either way.
    auth: { jwksUrl: "https://jwks.invalid.test/keys" },
    advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
    localBlobDir: rootDir,
  });
  if (dependencies.blobUploader.kind !== "local") throw new Error("expected the local uploader for this test");
  return { app: createApp({ ...dependencies, allowTestReset: false }), uploader: dependencies.blobUploader };
}

async function initLocalUpload(app: ReturnType<typeof createApp>, filename: string, mimeType: string) {
  const response = await app.request("http://localhost/api/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filename, mimeType, size: 1024 }),
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { blobPath: string; uploadUrl: string };
}

test("PUT then GET round trip: bytes persist to disk and are served back with an inferred content-type", async (t) => {
  const { app, uploader } = createLocalBlobTestApp(withTempBlobDir(t));
  const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");
  assert.match(init.uploadUrl, /^\/api\/blobs\/local\//);

  const bytes = new TextEncoder().encode("fake-jpeg-bytes");
  const put = await app.request(`http://localhost${init.uploadUrl}`, { method: "PUT", body: bytes });
  assert.equal(put.status, 201);

  const read = await uploader.mintReadSas(init.blobPath);
  const get = await app.request(`http://localhost${read.url}`);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), bytes);
});

test("PUT is write-once: a second PUT to the same upload URL answers 409", async (t) => {
  const { app } = createLocalBlobTestApp(withTempBlobDir(t));
  const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

  const first = await app.request(`http://localhost${init.uploadUrl}`, {
    method: "PUT",
    body: new TextEncoder().encode("first"),
  });
  assert.equal(first.status, 201);

  const second = await app.request(`http://localhost${init.uploadUrl}`, {
    method: "PUT",
    body: new TextEncoder().encode("second"),
  });
  assert.equal(second.status, 409);
  const body = (await second.json()) as { code?: string };
  assert.equal(body.code, "local_blob_conflict");
});

test("GET for a blob that was never written answers 404", async (t) => {
  const { app, uploader } = createLocalBlobTestApp(withTempBlobDir(t));
  const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

  const read = await uploader.mintReadSas(init.blobPath);
  const get = await app.request(`http://localhost${read.url}`);
  assert.equal(get.status, 404);
  const body = (await get.json()) as { code?: string };
  assert.equal(body.code, "local_blob_not_found");
});

test("a PUT-scoped token is rejected when used for GET (method binding)", async (t) => {
  const { app } = createLocalBlobTestApp(withTempBlobDir(t));
  const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

  const get = await app.request(`http://localhost${init.uploadUrl}`);
  assert.equal(get.status, 401);
  const body = (await get.json()) as { code?: string };
  assert.equal(body.code, "local_blob_token_invalid");
});

test("PUT rejects a body over the 16 MiB cap with 413", async (t) => {
  const { app } = createLocalBlobTestApp(withTempBlobDir(t));
  const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

  const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  const put = await app.request(`http://localhost${init.uploadUrl}`, { method: "PUT", body: oversized });
  assert.equal(put.status, 413);
});

test("local blob byte-transfer routes bypass the JWKS auth gate while other /api/* routes still require it", async (t) => {
  const { app, uploader } = createJwksGatedLocalBlobApp(withTempBlobDir(t));

  const unauthenticatedWorkspace = await app.request("http://localhost/api/workspace");
  assert.equal(unauthenticatedWorkspace.status, 401);

  // Minted directly from the wired uploader — /api/uploads/init itself stays authenticated in
  // normal mode (matching Azure SAS minting); only the byte-transfer routes below are exempt,
  // mirroring how a real Azure SAS PUT never touches this app at all.
  const init = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
  const put = await app.request(`http://localhost${init.uploadUrl}`, {
    method: "PUT",
    body: new TextEncoder().encode("bytes"),
  });
  assert.equal(put.status, 201);

  const sas = await uploader.mintReadSas(init.blobPath);
  const get = await app.request(`http://localhost${sas.url}`);
  assert.equal(get.status, 200);
});

test("the auth exemption covers ONLY PUT/GET: another method on the same path still hits the JWT gate", async (t) => {
  const { app, uploader } = createJwksGatedLocalBlobApp(withTempBlobDir(t));
  const init = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });

  // Same path, same real token — only the method differs. No handler is mounted for DELETE, but
  // the answer must come from the auth gate (JSON 401), never a bare unauthenticated 404: an
  // exemption keyed on the path alone would hand any future handler here a silent bypass.
  const deleted = await app.request(`http://localhost${init.uploadUrl}`, { method: "DELETE" });
  assert.equal(deleted.status, 401);
  const body = (await deleted.json()) as { runtimeMode?: string; requestId?: string };
  assert.equal(body.runtimeMode, "normal");
  assert.equal(typeof body.requestId, "string");
});
