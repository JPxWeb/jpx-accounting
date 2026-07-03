"use client";

import { EVIDENCE_BLOB_STORE, getDraftDatabase } from "./draft-queue";

/**
 * Bounded local cache of promoted-evidence file blobs, used for instant previews on the
 * device that captured the file (Azure read-SAS / honest empty state are the fallbacks).
 *
 * Bounded accumulation (Rule 25): the cache holds at most `MAX_EVIDENCE_BLOBS` entries,
 * evicting the oldest `storedAt` first, and is pruned on every put.
 */
export const MAX_EVIDENCE_BLOBS = 50;

type EvidenceBlobRecord = {
  evidenceId: string;
  blob: Blob;
  storedAt: string;
};

export async function putEvidenceBlob(evidenceId: string, blob: Blob): Promise<void> {
  try {
    const db = await getDraftDatabase();
    const record: EvidenceBlobRecord = {
      evidenceId,
      blob,
      storedAt: new Date().toISOString(),
    };
    await db.put(EVIDENCE_BLOB_STORE, record);
    await pruneEvidenceBlobs();
  } catch {
    // Best-effort cache: when IndexedDB is unavailable the preview simply falls back.
  }
}

export async function getEvidenceBlob(evidenceId: string): Promise<Blob | undefined> {
  try {
    const db = await getDraftDatabase();
    const record = (await db.get(EVIDENCE_BLOB_STORE, evidenceId)) as EvidenceBlobRecord | undefined;
    return record?.blob;
  } catch {
    return undefined;
  }
}

export async function pruneEvidenceBlobs(max: number = MAX_EVIDENCE_BLOBS): Promise<void> {
  const db = await getDraftDatabase();
  const tx = db.transaction(EVIDENCE_BLOB_STORE, "readwrite");
  // Reading records does not materialize blob bytes — IndexedDB returns Blob handles lazily.
  const records = (await tx.store.getAll()) as EvidenceBlobRecord[];

  if (records.length > max) {
    const evicted = [...records]
      .sort((left, right) => left.storedAt.localeCompare(right.storedAt))
      .slice(0, records.length - max);
    for (const record of evicted) {
      await tx.store.delete(record.evidenceId);
    }
  }

  await tx.done;
}
