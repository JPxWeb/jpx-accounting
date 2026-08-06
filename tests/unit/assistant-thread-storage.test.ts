import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ASSISTANT_THREADS_STORAGE_KEY,
  prependAssistantThread,
  type StoredAssistantThread,
} from "../../apps/web/lib/assistant-thread-storage.ts";

afterEach(() => {
  // jsdom-less unit environment: storage helpers no-op without window, so we
  // only exercise the returned array shape here.
});

test("prependAssistantThread stamps additive aiTransparency (Art. 50(2))", () => {
  const merged = prependAssistantThread({
    id: "thr_1",
    title: "Kassaläge?",
    messages: [
      { id: "m1", role: "user", parts: [{ type: "text", text: "Kassaläge?" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "Svar" }] },
    ],
  });

  assert.equal(merged.length, 1);
  const thread = merged[0] as StoredAssistantThread;
  assert.ok(thread.aiTransparency);
  assert.equal(thread.aiTransparency.labeling, "eu-ai-act-article-50");
  assert.equal(thread.aiTransparency.source, "advisor");
  assert.equal(typeof thread.aiTransparency.markedAt, "string");
  assert.ok(Number.isFinite(Date.parse(thread.aiTransparency.markedAt)));
  // Storage key pin — registry test covers clear-on-sign-out separately.
  assert.equal(ASSISTANT_THREADS_STORAGE_KEY, "jpx.accounting.assistantThreads.v2");
});
