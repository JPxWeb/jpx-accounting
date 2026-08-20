import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BlobUploaderUnavailableError,
  createBlobUploader,
  inferLocalBlobContentType,
  LocalBlobConflictError,
  LocalBlobNotFoundError,
  LocalBlobTokenError,
  LocalDiskBlobUploader,
  StubBlobUploader,
  UnavailableBlobUploader,
} from "../../services/api/src/blob";

function tempBlobRoot(t: test.TestContext): string {
  const rootDir = mkdtempSync(path.join(tmpdir(), "jpx-blob-test-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test("createBlobUploader returns azure kind when account + container are set", () => {
  const uploader = createBlobUploader({
    accountName: "jpxstorage",
    containerName: "evidence",
  });
  assert.equal(uploader.kind, "azure");
});

test("createBlobUploader returns stub when env missing and failClosed is off", () => {
  const uploader = createBlobUploader({});
  assert.equal(uploader.kind, "stub");
  assert.ok(uploader instanceof StubBlobUploader);
});

test("createBlobUploader returns unavailable when failClosed and env missing", async () => {
  const uploader = createBlobUploader({ failClosed: true });
  assert.equal(uploader.kind, "unavailable");
  assert.ok(uploader instanceof UnavailableBlobUploader);

  await assert.rejects(
    () =>
      uploader.initUpload({
        filename: "kvitto.jpg",
        mimeType: "image/jpeg",
        size: 1024,
      }),
    (error: unknown) => error instanceof BlobUploaderUnavailableError && error.code === "blob_unavailable",
  );

  await assert.rejects(
    () => uploader.mintReadSas("evidence-uploads/u/kvitto.jpg"),
    (error: unknown) => error instanceof BlobUploaderUnavailableError,
  );
});

test("failClosed is ignored when Azure storage config is present", () => {
  const uploader = createBlobUploader({
    accountName: "jpxstorage",
    containerName: "evidence",
    failClosed: true,
  });
  assert.equal(uploader.kind, "azure");
});

test("createBlobUploader returns local kind when ACCOUNTING_BLOB_DIR is set and Azure env is absent", (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = createBlobUploader({ blobDir: rootDir });
  assert.equal(uploader.kind, "local");
  assert.ok(uploader instanceof LocalDiskBlobUploader);
});

test("createBlobUploader returns local kind even with failClosed (normal mode) when ACCOUNTING_BLOB_DIR is set", (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = createBlobUploader({ blobDir: rootDir, failClosed: true });
  assert.equal(uploader.kind, "local");
});

test("createBlobUploader prefers Azure over ACCOUNTING_BLOB_DIR when both are configured", () => {
  const uploader = createBlobUploader({
    accountName: "jpxstorage",
    containerName: "evidence",
    blobDir: "/some/local/dir",
  });
  assert.equal(uploader.kind, "azure");
});

test("LocalDiskBlobUploader.initUpload mints a PUT token whose blobPath matches the Azure/stub convention", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });

  const result = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
  assert.match(result.blobPath, /^evidence-uploads\/[^/]+\/kvitto\.jpg$/);
  assert.match(result.uploadUrl, /^\/api\/blobs\/local\/[^.]+\.[^.]+$/);
  assert.equal(result.requiredBlobType, "BlockBlob");
  assert.equal(result.expiresInSeconds, 600);

  const token = result.uploadUrl.slice("/api/blobs/local/".length);
  assert.equal(uploader.verifyToken(token, "PUT"), result.blobPath);
});

test("LocalDiskBlobUploader writeOnce -> readBlob round trip; a second write to the same path conflicts", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });
  const blobPath = "evidence-uploads/u1/kvitto.jpg";
  const bytes = new TextEncoder().encode("fake-jpeg-bytes");

  await uploader.writeOnce(blobPath, bytes);
  assert.deepEqual(new Uint8Array(await uploader.readBlob(blobPath)), bytes);

  await assert.rejects(() => uploader.writeOnce(blobPath, bytes), LocalBlobConflictError);
});

test("LocalDiskBlobUploader.readBlob rejects with LocalBlobNotFoundError when nothing was written", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });
  await assert.rejects(() => uploader.readBlob("evidence-uploads/u1/missing.jpg"), LocalBlobNotFoundError);
});

test("LocalDiskBlobUploader.verifyToken rejects a token minted for the other HTTP method", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });
  const init = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
  const token = init.uploadUrl.slice("/api/blobs/local/".length);
  assert.throws(() => uploader.verifyToken(token, "GET"), LocalBlobTokenError);
});

test("LocalDiskBlobUploader.verifyToken rejects an expired token", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir, tokenExpirySeconds: -1 });
  const { url } = await uploader.mintReadSas("evidence-uploads/u1/kvitto.jpg");
  const token = url.slice("/api/blobs/local/".length);
  assert.throws(() => uploader.verifyToken(token, "GET"), /expired/i);
});

test("LocalDiskBlobUploader.verifyToken rejects a tampered signature", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });
  const { url } = await uploader.mintReadSas("evidence-uploads/u1/kvitto.jpg");
  const token = url.slice("/api/blobs/local/".length);
  const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.throws(() => uploader.verifyToken(tampered, "GET"), LocalBlobTokenError);
});

test("LocalDiskBlobUploader rejects a blobPath resolving outside the configured root (defense in depth)", async (t) => {
  const rootDir = tempBlobRoot(t);
  const uploader = new LocalDiskBlobUploader({ rootDir });
  const { url } = await uploader.mintReadSas("../outside.txt");
  const token = url.slice("/api/blobs/local/".length);
  assert.throws(() => uploader.verifyToken(token, "GET"), /escapes/i);
});

test("inferLocalBlobContentType maps known extensions and falls back to octet-stream", () => {
  assert.equal(inferLocalBlobContentType("evidence-uploads/u1/kvitto.jpg"), "image/jpeg");
  assert.equal(inferLocalBlobContentType("evidence-uploads/u1/kvitto.JPEG"), "image/jpeg");
  assert.equal(inferLocalBlobContentType("evidence-uploads/u1/faktura.pdf"), "application/pdf");
  assert.equal(inferLocalBlobContentType("evidence-uploads/u1/data.bin"), "application/octet-stream");
});
