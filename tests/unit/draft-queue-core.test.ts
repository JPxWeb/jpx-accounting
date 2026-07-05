import assert from "node:assert/strict";
import test from "node:test";

import { createDraftQueue, stripDraftFile, type CaptureDraft } from "../../apps/web/lib/draft-queue-core";

const draft: CaptureDraft = {
  id: "draft_1",
  mode: "camera",
  title: "Camera draft",
  createdAt: "2026-03-19T10:00:00.000Z",
};

const fileBlob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });

const fileDraft: CaptureDraft = {
  id: "draft_file",
  mode: "upload",
  title: "Receipt photo",
  createdAt: "2026-03-19T12:00:00.000Z",
  filename: "receipt.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 48211,
  file: fileBlob,
};

const shareDraft: CaptureDraft = {
  id: "draft_share",
  mode: "share",
  title: "Shared link",
  createdAt: "2026-03-19T11:00:00.000Z",
  text: "Kvitto från OpenAI",
  sourceUrl: "https://example.com/receipt",
};

test("draft queue falls back when IndexedDB storage fails", async () => {
  const queue = createDraftQueue({
    primary: {
      async save() {
        throw new Error("IndexedDB unavailable");
      },
      async list() {
        return [];
      },
      async remove() {},
    },
    fallback: {
      async save() {
        return {
          storage: "session",
          scope: "tab",
        } as const;
      },
      async list() {
        return [draft];
      },
      async remove() {},
    },
  });

  const result = await queue.saveCaptureDraft(draft);
  assert.deepEqual(result, {
    storage: "session",
    scope: "tab",
    fallbackUsed: true,
  });
});

test("draft queue merges drafts from primary and fallback adapters", async () => {
  const queue = createDraftQueue({
    primary: {
      async save() {
        return {
          storage: "indexeddb",
          scope: "persistent",
        } as const;
      },
      async list() {
        return [draft];
      },
      async remove() {},
    },
    fallback: {
      async save() {
        return {
          storage: "memory",
          scope: "tab",
        } as const;
      },
      async list() {
        return [
          {
            ...draft,
            id: "draft_2",
            createdAt: "2026-03-19T11:00:00.000Z",
          },
        ];
      },
      async remove() {},
    },
  });

  const drafts = await queue.listCaptureDrafts();
  assert.deepEqual(
    drafts.map((item) => item.id),
    ["draft_2", "draft_1"],
  );
});

test("draft queue merges and sorts drafts carrying file and share metadata", async () => {
  const queue = createDraftQueue({
    primary: {
      async save() {
        return {
          storage: "indexeddb",
          scope: "persistent",
        } as const;
      },
      async list() {
        return [draft, fileDraft];
      },
      async remove() {},
    },
    fallback: {
      async save() {
        return {
          storage: "memory",
          scope: "tab",
        } as const;
      },
      async list() {
        return [shareDraft];
      },
      async remove() {},
    },
  });

  const drafts = await queue.listCaptureDrafts();
  assert.deepEqual(
    drafts.map((item) => item.id),
    ["draft_file", "draft_share", "draft_1"],
  );

  const mergedFileDraft = drafts.find((item) => item.id === "draft_file");
  assert.ok(mergedFileDraft);
  assert.equal(mergedFileDraft.filename, "receipt.jpg");
  assert.equal(mergedFileDraft.mimeType, "image/jpeg");
  assert.equal(mergedFileDraft.sizeBytes, 48211);
  // The Blob must pass through the queue untouched (same instance, no clone/serialize).
  assert.equal(mergedFileDraft.file, fileBlob);

  const mergedShareDraft = drafts.find((item) => item.id === "draft_share");
  assert.ok(mergedShareDraft);
  assert.equal(mergedShareDraft.text, "Kvitto från OpenAI");
  assert.equal(mergedShareDraft.sourceUrl, "https://example.com/receipt");
});

test("stripDraftFile drops only the blob so fallback drafts stay JSON-safe", () => {
  const stripped = stripDraftFile(fileDraft);

  assert.deepEqual(stripped, {
    id: "draft_file",
    mode: "upload",
    title: "Receipt photo",
    createdAt: "2026-03-19T12:00:00.000Z",
    filename: "receipt.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 48211,
  });
  assert.equal("file" in stripped, false);
  // Metadata-only degradation: the JSON round-trip the session fallback performs is lossless.
  assert.deepEqual(JSON.parse(JSON.stringify(stripped)), stripped);
  // The input draft is not mutated — its blob is still attached for the primary path.
  assert.equal(fileDraft.file, fileBlob);
});

test("stripDraftFile returns metadata-only drafts unchanged", () => {
  assert.equal(stripDraftFile(draft), draft);
  assert.equal(stripDraftFile(shareDraft), shareDraft);
});
