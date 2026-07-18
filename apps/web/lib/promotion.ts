"use client";

import type { EvidenceCreateResult, EvidenceModality } from "@jpx-accounting/contracts";
import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "./client";
import { removeCaptureDraft, saveCaptureDraft } from "./draft-queue";
import type { CaptureDraft, DraftQueueSaveResult } from "./draft-queue-core";
import { putEvidenceBlob } from "./evidence-blob-cache";
import { sha256Hex } from "./hash";
import { invalidateLedgerDerived } from "./query-invalidation";
import { WORKSPACE_IDENTITY } from "./workspace-identity";

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
    ...WORKSPACE_IDENTITY,
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
    ...WORKSPACE_IDENTITY,
    title: draft.title,
    originalFilename: draft.filename ?? `${draft.mode}-note.txt`,
    mimeType: "text/plain",
    modalities: [modalityFromMode(draft.mode)],
    ...(draft.text ? { extractedText: draft.text } : {}),
    ...(draft.sourceUrl ? { note: draft.sourceUrl } : {}),
  });
}

/**
 * Promote a local draft into ledger evidence:
 * sha256 → initUpload → uploadBlob → createEvidence → putEvidenceBlob → removeCaptureDraft,
 * then fire-and-forget extraction. Throws when the create fails — the draft stays local so
 * the drafts-table promote button doubles as the retry path.
 */
export async function promoteDraft(
  draft: CaptureDraft,
  options: PromoteDraftOptions = {},
): Promise<EvidenceCreateResult> {
  const created = draft.file ? await promoteFileDraft(draft, draft.file) : await promoteMetadataDraft(draft);

  if (draft.file) {
    // Local preview cache for the device that captured the file (bounded LRU, best-effort).
    await putEvidenceBlob(created.evidence.id, draft.file);
  }

  await removeCaptureDraft(draft.id);
  invalidateCaptureQueries(options.queryClient);

  // Fire-and-forget: extraction enriches the voucher in the background. The create-time
  // fields are already reviewable, so an extraction failure must never fail the promotion.
  void apiClient
    .extractEvidence(created.evidence.id)
    .catch(() => undefined)
    .then(() => invalidateCaptureQueries(options.queryClient));

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

  for (const { draft } of saved) {
    void promoteDraft(draft, options)
      .then((result) => options.onPromoted?.(draft, result))
      .catch(() => options.onPromoteError?.(draft));
  }

  return { saved, rejected };
}
