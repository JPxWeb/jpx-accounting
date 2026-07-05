"use client";

import { openDB } from "idb";

import { createDraftQueue, stripDraftFile, type CaptureDraft, type DraftQueueAdapter } from "./draft-queue-core";

const databaseName = "jpx-accounting-drafts";
const databaseVersion = 2;
const storeName = "capture-drafts";
const sessionStorageKey = "jpx-accounting-drafts:session";
const inMemoryDrafts = new Map<string, CaptureDraft>();

/**
 * Object store for promoted-evidence file blobs (previews), added in v2.
 * Records are `{ evidenceId, blob, storedAt }` keyed by `evidenceId` — see `evidence-blob-cache.ts`.
 */
export const EVIDENCE_BLOB_STORE = "evidence-blobs";

export async function getDraftDatabase() {
  return openDB(databaseName, databaseVersion, {
    upgrade(db) {
      // Idempotent: v1 databases already have `capture-drafts` (untouched by v2); only create what's missing.
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(EVIDENCE_BLOB_STORE)) {
        db.createObjectStore(EVIDENCE_BLOB_STORE, { keyPath: "evidenceId" });
      }
    },
  });
}

const indexedDbAdapter: DraftQueueAdapter = {
  async save(draft) {
    const db = await getDraftDatabase();
    // IndexedDB structured-clones Blobs, so `file` persists with the draft here.
    await db.put(storeName, draft);
    return {
      storage: "indexeddb",
      scope: "persistent",
    };
  },
  async list() {
    const db = await getDraftDatabase();
    return db.getAll(storeName);
  },
  async remove(id) {
    const db = await getDraftDatabase();
    await db.delete(storeName, id);
  },
};

function readSessionDrafts() {
  try {
    if (typeof window === "undefined") {
      return [...inMemoryDrafts.values()];
    }

    const rawValue = window.sessionStorage.getItem(sessionStorageKey);
    if (!rawValue) {
      return [...inMemoryDrafts.values()];
    }

    const parsed = JSON.parse(rawValue) as CaptureDraft[];
    for (const draft of parsed) {
      inMemoryDrafts.set(draft.id, draft);
    }
  } catch {
    // Session storage is only a best-effort tab-scoped mirror; the in-memory copy is still usable.
  }

  return [...inMemoryDrafts.values()];
}

async function writeSessionDrafts() {
  if (typeof window === "undefined") {
    return "memory" as const;
  }

  window.sessionStorage.setItem(sessionStorageKey, JSON.stringify([...inMemoryDrafts.values()]));
  return "session" as const;
}

const sessionAdapter: DraftQueueAdapter = {
  async save(draft) {
    // The fallback tiers round-trip through JSON, which cannot carry a Blob —
    // degrade to a metadata-only draft (surfaced by the existing session/memory status messages).
    inMemoryDrafts.set(draft.id, stripDraftFile(draft));

    try {
      const storage = await writeSessionDrafts();
      return {
        storage,
        scope: "tab",
      };
    } catch {
      return {
        storage: "memory",
        scope: "tab",
      };
    }
  },
  async list() {
    return readSessionDrafts();
  },
  async remove(id) {
    inMemoryDrafts.delete(id);

    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(sessionStorageKey, JSON.stringify([...inMemoryDrafts.values()]));
      }
    } catch {
      // In-memory removal still succeeds even if the tab-scoped mirror cannot be persisted.
    }
  },
};

const draftQueue = createDraftQueue({
  primary: indexedDbAdapter,
  fallback: sessionAdapter,
});

export async function saveCaptureDraft(draft: CaptureDraft) {
  return draftQueue.saveCaptureDraft(draft);
}

export async function listCaptureDrafts() {
  return draftQueue.listCaptureDrafts();
}

export async function removeCaptureDraft(id: string) {
  await draftQueue.removeCaptureDraft(id);
}
