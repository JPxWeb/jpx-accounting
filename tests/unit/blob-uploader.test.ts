import assert from "node:assert/strict";
import test from "node:test";

import {
  BlobUploaderUnavailableError,
  createBlobUploader,
  StubBlobUploader,
  UnavailableBlobUploader,
} from "../../services/api/src/blob";

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
