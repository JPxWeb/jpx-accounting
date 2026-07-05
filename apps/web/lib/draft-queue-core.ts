export type CaptureDraft = {
  id: string;
  mode: string;
  title: string;
  createdAt: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  text?: string;
  sourceUrl?: string;
  file?: Blob;
};

/**
 * Session/memory fallbacks JSON-serialize drafts, and `JSON.stringify` cannot carry a `Blob`
 * (it would serialize as `{}` and no longer be a usable file). Stripping the `file` field keeps
 * the fallback copy a valid metadata-only draft — the existing session/memory capture-status
 * messaging already tells the user this storage tier is degraded.
 */
export function stripDraftFile(draft: CaptureDraft): CaptureDraft {
  if (draft.file === undefined) {
    return draft;
  }

  const metadataOnly = { ...draft };
  delete metadataOnly.file;
  return metadataOnly;
}

export type DraftQueueStorage = "indexeddb" | "session" | "memory";
export type DraftQueueScope = "persistent" | "tab";

export type DraftQueueSaveResult = {
  storage: DraftQueueStorage;
  scope: DraftQueueScope;
  fallbackUsed: boolean;
};

export type DraftQueueAdapter = {
  save(draft: CaptureDraft): Promise<{ storage: DraftQueueStorage; scope: DraftQueueScope }>;
  list(): Promise<CaptureDraft[]>;
  remove(id: string): Promise<void>;
};

type DraftQueueOptions = {
  primary: DraftQueueAdapter;
  fallback: DraftQueueAdapter;
};

function mergeDrafts(primaryDrafts: CaptureDraft[], fallbackDrafts: CaptureDraft[]) {
  const merged = new Map<string, CaptureDraft>();
  for (const draft of [...primaryDrafts, ...fallbackDrafts]) {
    merged.set(draft.id, draft);
  }

  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function createDraftQueue({ primary, fallback }: DraftQueueOptions) {
  return {
    async saveCaptureDraft(draft: CaptureDraft): Promise<DraftQueueSaveResult> {
      try {
        const result = await primary.save(draft);
        return {
          ...result,
          fallbackUsed: false,
        };
      } catch {
        const result = await fallback.save(draft);
        return {
          ...result,
          fallbackUsed: true,
        };
      }
    },

    async listCaptureDrafts() {
      const [primaryResult, fallbackResult] = await Promise.allSettled([primary.list(), fallback.list()]);
      return mergeDrafts(
        primaryResult.status === "fulfilled" ? primaryResult.value : [],
        fallbackResult.status === "fulfilled" ? fallbackResult.value : [],
      );
    },

    async removeCaptureDraft(id: string) {
      await Promise.allSettled([primary.remove(id), fallback.remove(id)]);
    },
  };
}
