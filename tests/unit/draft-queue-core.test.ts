import assert from "node:assert/strict";
import test from "node:test";

import { createDraftQueue, type CaptureDraft } from "../../apps/web/lib/draft-queue-core";

const draft: CaptureDraft = {
  id: "draft_1",
  mode: "camera",
  title: "Camera draft",
  createdAt: "2026-03-19T10:00:00.000Z",
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
