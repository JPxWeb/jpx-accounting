"use client";

import type { EvidenceCreateResult, EvidenceModality } from "@jpx-accounting/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "./client";
import { removeCaptureDraft, saveCaptureDraft } from "./draft-queue";
import type { CaptureDraft, DraftQueueSaveResult } from "./draft-queue-core";
import { putEvidenceBlob } from "./evidence-blob-cache";
import { sha256Hex } from "./hash";
import { invalidateLedgerDerived } from "./query-invalidation";

/**
 * THE promotion pipeline. Every intake surface (quick-add tiles, capture sheet, drop-zone,
 * paste listener, drafts-table retry, share intake) funnels through `captureFiles` /
 * `promoteDraft` so evidence always carries honest metadata: the real filename, MIME type,
 * byte size, client-side SHA-256, and the server-minted upload identity. The old
 * `${id}.bin` / `application/octet-stream` placeholder path is gone.
 */

/** Client-side mirror of the API's `MAX_UPLOAD_BYTES` body limit (16 MB). */
export const MAX_CAPTURE_FILE_BYTES = 16 * 1024 * 1024;

/** Accept attribute shared by every capture file input (drop-zone, camera, sheet). */
export const CAPTURE_ACCEPT = "image/*,application/pdf";

export type CaptureFileRejection = {
  file: File;
  reason: "type" | "size";
};

export function isAcceptedCaptureFile(file: File): "ok" | CaptureFileRejection["reason"] {
  if (!(file.type.startsWith("image/") || file.type === "application/pdf")) {
    return "type";
  }
  if (file.size > MAX_CAPTURE_FILE_BYTES) {
    return "size";
  }
  return "ok";
}

function modalityFromMode(mode: string): EvidenceModality {
  if (mode === "camera" || mode === "paste" || mode === "share") {
    return mode;
  }
  return "upload";
}

/** Build a real-file draft: title/filename/MIME/size come from the file, and the Blob rides along. */
export function buildFileDraft(file: File, mode: string): CaptureDraft {
  const filename = file.name || `${mode}-${Date.now()}`;
  return {
    id: crypto.randomUUID(),
    mode,
    title: filename,
    createdAt: new Date().toISOString(),
    filename,
    mimeType: file.type,
    sizeBytes: file.size,
    file,
  };
}

function invalidateCaptureQueries(queryClient: QueryClient | undefined) {
  if (!queryClient) {
    return;
  }
  // Narrow extra: the local draft queue is not ledger-derived.
  void queryClient.invalidateQueries({ queryKey: ["capture-drafts"] });
  // Promotion creates evidence + voucher + review — refresh everything derived
  // from the ledger (R18), not just the workspace snapshot.
  invalidateLedgerDerived(queryClient);
}

export type PromoteDraftOptions = {
  /** When provided, `capture-drafts` + `workspace` queries refresh as the pipeline lands data. */
  queryClient?: QueryClient;
};

async function promoteFileDraft(draft: CaptureDraft, file: Blob): Promise<EvidenceCreateResult> {
  const filename = draft.filename ?? draft.title;
  const mimeType = draft.mimeType || file.type;
  const sizeBytes = draft.sizeBytes ?? file.size;

  const sha256 = await sha256Hex(await file.arrayBuffer());
  const upload = await apiClient.initUpload({ filename, mimeType, size: sizeBytes });
  await apiClient.uploadBlob(upload, file);

  return apiClient.createEvidence({
    title: draft.title,
    originalFilename: filename,
    mimeType,
    modalities: [modalityFromMode(draft.mode)],
    sizeBytes,
    ...(sha256 ? { sha256 } : {}),
    uploadId: upload.uploadId,
    blobPath: upload.blobPath,
    ...(draft.text ? { extractedText: draft.text } : {}),
    ...(draft.sourceUrl ? { note: draft.sourceUrl } : {}),
  });
}

/**
 * Metadata-only drafts (share params, degraded fallback storage that stripped the Blob)
 * become honest text evidence: `text/plain` with the captured text carried as
 * `extractedText`, never a fake binary.
 */
async function promoteMetadataDraft(draft: CaptureDraft): Promise<EvidenceCreateResult> {
  return apiClient.createEvidence({
    title: draft.title,
    originalFilename: draft.filename ?? `${draft.mode}-note.txt`,
    mimeType: "text/plain",
    modalities: [modalityFromMode(draft.mode)],
    ...(draft.text ? { extractedText: draft.text } : {}),
    ...(draft.sourceUrl ? { note: draft.sourceUrl } : {}),
  });
}

/**
 * Join-or-start seam for the in-flight promotion registry (WS-D R19). Pure over the
 * passed `registry` Map so unit tests can exercise the race semantics directly:
 * while a run for `key` is in flight every subsequent call returns THAT promise
 * (settling with the same result or rejection) instead of starting a parallel run;
 * the entry clears on settle, so a post-failure retry starts a fresh run.
 */
export function joinInFlight<T>(registry: Map<string, Promise<T>>, key: string, task: () => Promise<T>): Promise<T> {
  const existing = registry.get(key);
  if (existing) {
    return existing;
  }

  // `Promise.resolve().then(task)` also routes synchronous throws into the promise.
  const run = Promise.resolve()
    .then(task)
    .finally(() => {
      registry.delete(key);
    });
  registry.set(key, run);
  return run;
}

/**
 * Bounded-concurrency runner (readiness G9 — bulk capture backlog): promoting ~70 receipts at
 * once fired unbounded parallel initUpload→uploadBlob→createEvidence pipelines and tripped the
 * API's 60/min per-subject mutation limiter within seconds, leaving a tail of failed drafts to
 * retry by hand. `limit` lanes pull from a shared cursor, so a lane starts its next item the
 * moment ITS own worker settles (completion order is duration-driven, never input-ordered).
 *
 * A rejecting worker does NOT kill its lane: the lane records the failure and keeps draining, so
 * every item still runs and one bad file can't strand the rest of the drop. The first failure is
 * rethrown once the pool is empty (`Promise.all`'s reason semantics, deferred to full drain).
 * Pure over its inputs, same testing style as `joinInFlight`.
 */
export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  let firstError: { reason: unknown } | undefined;

  async function runLane(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index]!);
      } catch (error) {
        firstError ??= { reason: error };
      }
    }
  }

  // A non-positive limit degrades to one sequential lane — silently dropping the whole batch
  // would be the worse failure mode. An empty list opens no lane at all.
  const laneCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: laneCount }, runLane));

  if (firstError) {
    throw firstError.reason;
  }
}

/** Bulk-capture concurrency cap (readiness G9): 4 in-flight promotions per drop. */
const CAPTURE_PROMOTION_CONCURRENCY = 4;

/**
 * In-flight promotions keyed by draft id. Draft ids are stable across the auto-promote →
 * drafts-table-retry lifecycle, so a retry click (or double-click) while the original
 * fire-and-forget promotion is still running joins it instead of racing a second
 * initUpload→createEvidence pipeline into duplicate evidence. Per-tab only: drafts
 * synced into ANOTHER tab (BroadcastChannel) can still race across tabs — those are
 * absorbed server-side by the (workspace, sha256, sizeBytes) createEvidence dedupe.
 */
const inFlightPromotions = new Map<string, Promise<EvidenceCreateResult>>();

/**
 * Promote a local draft into ledger evidence:
 * sha256 → initUpload → uploadBlob → createEvidence → putEvidenceBlob → removeCaptureDraft,
 * then fire-and-forget extraction. Throws when the create fails — the draft stays local so
 * the drafts-table promote button doubles as the retry path. Re-entrant per draft: a call
 * for a draft that is already promoting awaits the in-flight run (registry above); the
 * first caller's `options` win for the joined run.
 */
export async function promoteDraft(
  draft: CaptureDraft,
  options: PromoteDraftOptions = {},
): Promise<EvidenceCreateResult> {
  return joinInFlight(inFlightPromotions, draft.id, () => runPromotionPipeline(draft, options));
}

async function runPromotionPipeline(draft: CaptureDraft, options: PromoteDraftOptions): Promise<EvidenceCreateResult> {
  const created = draft.file ? await promoteFileDraft(draft, draft.file) : await promoteMetadataDraft(draft);

  if (draft.file) {
    // Local preview cache for the device that captured the file (bounded LRU, best-effort).
    // Useful on a dedup hit too: THIS device now holds the bytes for the existing evidence.
    await putEvidenceBlob(created.evidence.id, draft.file);
  }

  await removeCaptureDraft(draft.id);
  invalidateCaptureQueries(options.queryClient);

  // Fire-and-forget: extraction enriches the voucher in the background. The create-time
  // fields are already reviewable, so an extraction failure must never fail the promotion.
  // Skipped on a dedup hit (WS-D R19): the existing evidence already ran extraction, and a
  // duplicate promote must leave the append-only chain untouched.
  if (!created.deduped) {
    void apiClient
      .extractEvidence(created.evidence.id)
      .catch(() => undefined)
      .then(() => invalidateCaptureQueries(options.queryClient));
  }

  return created;
}

export type CaptureFilesOptions = PromoteDraftOptions & {
  onPromoted?: (draft: CaptureDraft, result: EvidenceCreateResult) => void;
  onPromoteError?: (draft: CaptureDraft) => void;
};

export type CaptureFilesOutcome = {
  saved: { draft: CaptureDraft; save: DraftQueueSaveResult }[];
  rejected: CaptureFileRejection[];
};

/**
 * Intake entry point for file-bearing surfaces: filter (image/* + PDF, 16 MB cap), save
 * local drafts first (offline-safe, ≤3 taps), then fire-and-forget promotion of each.
 * Returns synchronously-known results (saved drafts + rejected files) so callers can toast;
 * promotion outcomes arrive via the callbacks.
 */
export async function captureFiles(
  files: Iterable<File>,
  mode: string,
  options: CaptureFilesOptions = {},
): Promise<CaptureFilesOutcome> {
  const saved: CaptureFilesOutcome["saved"] = [];
  const rejected: CaptureFileRejection[] = [];

  for (const file of files) {
    const verdict = isAcceptedCaptureFile(file);
    if (verdict !== "ok") {
      rejected.push({ file, reason: verdict });
      continue;
    }

    const draft = buildFileDraft(file, mode);
    const save = await saveCaptureDraft(draft);
    saved.push({ draft, save });
  }

  if (saved.length > 0) {
    invalidateCaptureQueries(options.queryClient);
  }

  // Fire-and-forget, but capped (readiness G9): at most CAPTURE_PROMOTION_CONCURRENCY pipelines
  // run at a time so a bulk drop paces itself against the API's mutation budget instead of
  // stampeding into 429s. The worker never rejects (per-draft outcomes go to the callbacks), so
  // the pool always drains.
  void runWithConcurrencyLimit(saved, CAPTURE_PROMOTION_CONCURRENCY, ({ draft }) =>
    promoteDraft(draft, options)
      .then((result) => options.onPromoted?.(draft, result))
      .catch(() => options.onPromoteError?.(draft)),
  );

  return { saved, rejected };
}
