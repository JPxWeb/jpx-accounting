"use client";

import { openDB } from "idb";

import { createDraftQueue, type CaptureDraft, type DraftQueueAdapter } from "./draft-queue-core";

const databaseName = "jpx-accounting-drafts";
const storeName = "capture-drafts";
const sessionStorageKey = "jpx-accounting-drafts:session";
const inMemoryDrafts = new Map<string, CaptureDraft>();

async function getDatabase() {
  return openDB(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    },
  });
}

const indexedDbAdapter: DraftQueueAdapter = {
  async save(draft) {
    const db = await getDatabase();
    await db.put(storeName, draft);
    return {
      storage: "indexeddb",
      scope: "persistent",
    };
  },
  async list() {
    const db = await getDatabase();
    return db.getAll(storeName);
  },
  async remove(id) {
    const db = await getDatabase();
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
    inMemoryDrafts.set(draft.id, draft);

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
