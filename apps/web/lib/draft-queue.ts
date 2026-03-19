"use client";

import { openDB } from "idb";

const databaseName = "jpx-accounting-drafts";
const storeName = "capture-drafts";

export type CaptureDraft = {
  id: string;
  mode: string;
  title: string;
  createdAt: string;
};

async function getDatabase() {
  return openDB(databaseName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    },
  });
}

export async function saveCaptureDraft(draft: CaptureDraft) {
  const db = await getDatabase();
  await db.put(storeName, draft);
}

export async function listCaptureDrafts() {
  const db = await getDatabase();
  return db.getAll(storeName);
}

export async function removeCaptureDraft(id: string) {
  const db = await getDatabase();
  await db.delete(storeName, id);
}

