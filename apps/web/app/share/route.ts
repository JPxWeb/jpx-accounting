import { NextResponse } from "next/server";

import { sha256Hex } from "../../lib/hash";
import { getWebServerRuntimeConfig } from "../../lib/server-runtime-config";
import { WORKSPACE_IDENTITY } from "../../lib/workspace-identity";

// PWA share target intake. The manifest declares method=POST + multipart/form-data, so the
// browser POSTs shared content (text + url + files) here. Files are forwarded server-side
// through the real evidence pipeline (initUpload → PUT bytes → createEvidence → fire-and-forget
// extract) when the API is reachable, then we redirect to /capture?promoted=<n>.
//
// LIMITATION: this handler runs server-side, so there is no client context (and no service
// worker) that could stash the shared files into the local draft queue / evidence blob cache.
// When `ACCOUNTING_API_BASE_URL` is unset or the API is unreachable, the bytes have nowhere to
// go — we fall back to the legacy `shared=1&pending=<n>` params so /capture can surface an
// honest "add them again" hint. Shared-file evidence also has no local blob, so the detail
// preview falls back to the read-SAS or the honest empty state.
//
// GET requests (someone navigating to /share manually) get redirected straight to /capture.

/** Mirror of `MAX_SHARE_FILES` in the plan: never forward more than 5 files per share. */
const MAX_SHARE_FILES = 5;
/** Mirror of the API's `MAX_UPLOAD_BYTES` and the client pipeline's `MAX_CAPTURE_FILE_BYTES`. */
const MAX_SHARE_FILE_BYTES = 16 * 1024 * 1024;

/** Same allowlist as the client promotion pipeline: images + PDF, 16 MB cap. */
function isAcceptedShareFile(file: File): boolean {
  if (!(file.type.startsWith("image/") || file.type === "application/pdf")) {
    return false;
  }
  return file.size <= MAX_SHARE_FILE_BYTES;
}

type ShareForwardOutcome = { promoted: number; failed: number };

/**
 * Forward each shared file through the real pipeline. Per-file try/catch: one bad file
 * (oversized, rejected by the API, transient network error) never sinks the others.
 */
async function forwardSharedFiles(
  apiBaseUrl: string,
  files: File[],
  extractedText: string | undefined,
): Promise<ShareForwardOutcome> {
  let promoted = 0;
  let failed = 0;

  for (const file of files.slice(0, MAX_SHARE_FILES)) {
    try {
      if (!isAcceptedShareFile(file)) {
        failed += 1;
        continue;
      }
      const filename = file.name || `shared-${Date.now()}`;

      const initResponse = await fetch(`${apiBaseUrl}/api/uploads/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename, mimeType: file.type, size: file.size }),
      });
      if (!initResponse.ok) {
        throw new Error(`uploads/init failed: ${initResponse.status}`);
      }
      const upload = (await initResponse.json()) as {
        uploadId: string;
        blobPath: string;
        uploadUrl: string;
        requiredContentType: string;
        requiredBlobType: string;
      };

      // Stub uploadUrls are API-relative (`/api/uploads/{id}`) — resolve them against the API
      // base. Azure SAS URLs are absolute and pass through untouched.
      const bytes = await file.arrayBuffer();
      const uploadUrl = upload.uploadUrl.startsWith("/") ? `${apiBaseUrl}${upload.uploadUrl}` : upload.uploadUrl;
      const putResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": upload.requiredContentType,
          "x-ms-blob-type": upload.requiredBlobType,
        },
        body: bytes,
      });
      if (!putResponse.ok) {
        throw new Error(`blob PUT failed: ${putResponse.status}`);
      }

      // Node ≥ 20 exposes Web Crypto globally, so the isomorphic client helper works here too.
      const sha256 = await sha256Hex(bytes);
      const createResponse = await fetch(`${apiBaseUrl}/api/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...WORKSPACE_IDENTITY,
          title: filename,
          originalFilename: filename,
          mimeType: file.type,
          modalities: ["share"],
          sizeBytes: file.size,
          ...(sha256 ? { sha256 } : {}),
          uploadId: upload.uploadId,
          blobPath: upload.blobPath,
          ...(extractedText ? { extractedText } : {}),
        }),
      });
      if (!createResponse.ok) {
        throw new Error(`evidence create failed: ${createResponse.status}`);
      }
      const created = (await createResponse.json()) as { evidence?: { id?: string } };

      // Fire-and-forget extraction, same as the client promotion pipeline: the create-time
      // fields are already reviewable, so an extraction failure must never fail the share.
      const evidenceId = created.evidence?.id;
      if (evidenceId) {
        void fetch(`${apiBaseUrl}/api/evidence/${evidenceId}/extract`, { method: "POST" }).catch(() => undefined);
      }

      promoted += 1;
    } catch {
      failed += 1;
    }
  }

  // Files beyond the cap were never attempted — report them as pending too.
  failed += Math.max(0, files.length - MAX_SHARE_FILES);
  return { promoted, failed };
}

export async function POST(request: Request): Promise<Response> {
  const params = new URLSearchParams();
  try {
    const form = await request.formData();
    const title = String(form.get("title") ?? "");
    const text = String(form.get("text") ?? "");
    const url = String(form.get("url") ?? "");
    // Empty file parts (size 0, no name) show up when the share sheet sends no files.
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);

    const { apiBaseUrl } = getWebServerRuntimeConfig();
    let anyPromoted = false;

    if (files.length > 0 && apiBaseUrl) {
      const outcome = await forwardSharedFiles(
        apiBaseUrl,
        files,
        [title, text].filter(Boolean).join("\n") || undefined,
      );
      anyPromoted = outcome.promoted > 0;
      if (outcome.promoted > 0) {
        params.set("promoted", String(outcome.promoted));
      }
      if (outcome.failed > 0) {
        params.set("shared", "1");
        params.set("pending", String(outcome.failed));
      }
    } else if (files.length > 0) {
      // No reachable API — legacy fallback (see the limitation note above).
      params.set("shared", "1");
      params.set("pending", String(files.length));
    }

    // Param-only shares (and total staging failure) hand title/text/url to /capture, which
    // turns them into ONE local share-mode draft. When files were promoted, title/text already
    // ride along as the evidence's extractedText — don't duplicate them as a draft.
    if (!anyPromoted) {
      if (title) params.set("title", title);
      if (text) params.set("text", text);
      if (url) params.set("url", url);
    }
  } catch {
    // Malformed multipart — fall through with no params; /capture still loads cleanly.
  }

  const target = params.toString() ? `/capture?${params}` : "/capture";
  return NextResponse.redirect(new URL(target, request.url), 303);
}

export async function GET(request: Request): Promise<Response> {
  const params = new URLSearchParams();
  for (const [key, value] of new URL(request.url).searchParams) {
    params.set(key, value);
  }
  const target = params.toString() ? `/capture?${params}` : "/capture";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
