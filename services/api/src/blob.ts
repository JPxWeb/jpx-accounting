import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  type UserDelegationKey,
} from "@azure/storage-blob";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, promises as fsPromises } from "node:fs";
import path from "node:path";

import type { UploadInit, UploadInitResult } from "@jpx-accounting/contracts";

// User-Delegation SAS minter. Account-key SAS is intentionally not used — production stores must
// reach Azure via Managed Identity + Storage Blob Delegator role (see infra/azure/main.bicep RBAC).
//
// Trust boundary: the API mints a short-lived (default 10 min) write-only SAS for a single blob
// under `evidence-uploads/{uploadId}/{filename}`. After the client PUTs the blob it must call
// /api/evidence with the same uploadId so the server can record the blob path.

/**
 * Discriminator for blob backends (Wave G′ / P1-4).
 * - `stub` — accept-and-discard demo / missing-env fallback (demo only)
 * - `azure` — live User-Delegation SAS against Azure Blob
 * - `local` — filesystem-backed self-host store under ACCOUNTING_BLOB_DIR (D1)
 * - `unavailable` — fail-closed normal mode when storage env is missing
 */
export type BlobUploaderKind = "stub" | "azure" | "local" | "unavailable";

export interface BlobUploader {
  /** Which implementation backs this uploader — the API branches on it for the stub PUT route, file-url minting, and `/ready.checks.blob`. */
  readonly kind: BlobUploaderKind;
  initUpload(input: UploadInit): Promise<UploadInitResult>;
  /**
   * Mint a short-lived read-only SAS URL for an existing blob path. Used by
   * Document Intelligence so the OCR service can fetch the receipt without
   * storage account keys. The stub returns a placeholder URL so the call site
   * can be wired before Azure Storage is available.
   */
  mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }>;
}

export class BlobUploaderUnavailableError extends Error {
  readonly code = "blob_unavailable" as const;
  constructor(message: string) {
    super(message);
    this.name = "BlobUploaderUnavailableError";
  }
}

/** Fail-closed peripheral for normal mode when Azure Storage env is missing. */
export class UnavailableBlobUploader implements BlobUploader {
  readonly kind = "unavailable" as const;

  constructor(private readonly reason: string) {}

  async initUpload(_input: UploadInit): Promise<UploadInitResult> {
    throw new BlobUploaderUnavailableError(this.reason);
  }

  async mintReadSas(_blobPath: string): Promise<{ url: string; expiresInSeconds: number }> {
    throw new BlobUploaderUnavailableError(this.reason);
  }
}

const DEFAULT_SAS_EXPIRY_SECONDS = 600;
// Refresh the user-delegation key every 50 minutes — Azure caps issuance at 7 days but caching
// briefly keeps init latency low without making revocation hard to reason about.
const DELEGATION_KEY_LIFETIME_MS = 50 * 60 * 1000;

/** Shared upload ceiling — the stub PUT route in app.ts mounts a body limit matching this value. */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/csv",
]);

export class UploadValidationError extends Error {
  readonly code = "upload_validation_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export class LocalBlobTokenError extends Error {
  readonly code = "local_blob_token_invalid" as const;
  constructor(message: string) {
    super(message);
    this.name = "LocalBlobTokenError";
  }
}

export class LocalBlobConflictError extends Error {
  readonly code = "local_blob_conflict" as const;
  constructor(message: string) {
    super(message);
    this.name = "LocalBlobConflictError";
  }
}

export class LocalBlobNotFoundError extends Error {
  readonly code = "local_blob_not_found" as const;
  constructor(message: string) {
    super(message);
    this.name = "LocalBlobNotFoundError";
  }
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
}

function validateInput(input: UploadInit): void {
  if (!ALLOWED_CONTENT_TYPES.has(input.mimeType)) {
    throw new UploadValidationError(`Unsupported content type: ${input.mimeType}`);
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(`Upload exceeds ${MAX_UPLOAD_BYTES} bytes.`);
  }
}

export class StubBlobUploader implements BlobUploader {
  readonly kind = "stub" as const;

  // Demo / unconfigured normal mode: returns a shape compatible with the contract so the web app
  // does not branch on runtime mode. The URL is a same-origin path served by the API's stub PUT
  // route (accept-and-discard); the blobPath is canonical so the create flow is exercised for real.
  async initUpload(input: UploadInit): Promise<UploadInitResult> {
    validateInput(input);
    const uploadId = crypto.randomUUID();
    return {
      uploadId,
      filename: input.filename,
      blobPath: `evidence-uploads/${uploadId}/${sanitizeFilename(input.filename)}`,
      uploadUrl: `/api/uploads/${uploadId}`,
      requiredContentType: input.mimeType,
      requiredBlobType: "BlockBlob",
      expiresInSeconds: DEFAULT_SAS_EXPIRY_SECONDS,
    };
  }

  async mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }> {
    // Placeholder URL — Document Intelligence cannot actually fetch this. Real OCR requires
    // AzureBlobUploader configured with an account name and container.
    return {
      url: `https://stub-storage.invalid/${blobPath}`,
      expiresInSeconds: DEFAULT_SAS_EXPIRY_SECONDS,
    };
  }
}

const LOCAL_BLOB_EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
};

/**
 * The local disk store has no blob-level content-type metadata the way Azure Blob does (a real
 * blob remembers what it was uploaded as); the GET route infers it from the filename extension
 * instead. Unrecognized extensions fall back to a generic binary type rather than guessing wrong.
 */
export function inferLocalBlobContentType(blobPath: string): string {
  return LOCAL_BLOB_EXTENSION_CONTENT_TYPES[path.extname(blobPath).toLowerCase()] ?? "application/octet-stream";
}

type LocalBlobTokenMethod = "PUT" | "GET";
type LocalBlobTokenPayload = { blobPath: string; exp: number; method: LocalBlobTokenMethod };

export type LocalDiskBlobUploaderConfig = {
  rootDir: string;
  /** Override the HMAC token lifetime (seconds). Defaults to 600 (10 min), matching Azure's SAS default. */
  tokenExpirySeconds?: number;
};

/**
 * D1 — local self-host ops: a third BlobUploader backend, used when ACCOUNTING_BLOB_DIR is set
 * and Azure Storage env is absent. Stores bytes under `rootDir` using the SAME
 * `evidence-uploads/{uploadId}/{sanitizedFilename}` blobPath convention Azure uses (see
 * sanitizeFilename above) so a later bulk upload to Azure Blob needs no event-history rewrite.
 *
 * Upload/read URLs are same-origin API routes (`/api/blobs/local/:token`) guarded by a
 * short-lived HMAC-signed token embedded in the URL — the token itself IS the credential,
 * mirroring how an Azure SAS query string is its own credential. The signing secret is random
 * per process boot (never persisted, never read from env): tokens do not survive a restart,
 * same short-lived-credential spirit as a 10-minute SAS without needing a stored key.
 */
export class LocalDiskBlobUploader implements BlobUploader {
  readonly kind = "local" as const;

  private readonly rootDir: string;
  private readonly tokenExpirySeconds: number;
  private readonly hmacSecret: Buffer;

  constructor(config: LocalDiskBlobUploaderConfig) {
    this.rootDir = path.resolve(config.rootDir);
    // Fail fast at boot if the configured root is not writable, rather than at first upload.
    mkdirSync(this.rootDir, { recursive: true });
    this.tokenExpirySeconds = config.tokenExpirySeconds ?? DEFAULT_SAS_EXPIRY_SECONDS;
    this.hmacSecret = randomBytes(32);
  }

  private signToken(payload: LocalBlobTokenPayload): string {
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies signature, method binding, and expiry; returns the embedded (already
   * root-checked) blobPath. Throws LocalBlobTokenError on any failure — deliberately generic
   * ("invalid blob token") rather than naming which check failed, so a probing client learns
   * nothing about why a guess was rejected.
   */
  verifyToken(token: string, expectedMethod: LocalBlobTokenMethod): string {
    const separatorIndex = token.lastIndexOf(".");
    if (separatorIndex <= 0) {
      throw new LocalBlobTokenError("Invalid blob token.");
    }
    const payloadB64 = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);
    const expectedSignature = createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
      throw new LocalBlobTokenError("Invalid blob token.");
    }
    let payload: LocalBlobTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as LocalBlobTokenPayload;
    } catch {
      throw new LocalBlobTokenError("Invalid blob token.");
    }
    if (
      typeof payload.blobPath !== "string" ||
      typeof payload.exp !== "number" ||
      (payload.method !== "PUT" && payload.method !== "GET")
    ) {
      throw new LocalBlobTokenError("Invalid blob token.");
    }
    if (payload.method !== expectedMethod) {
      throw new LocalBlobTokenError(`Blob token is not valid for ${expectedMethod}.`);
    }
    if (Date.now() > payload.exp) {
      throw new LocalBlobTokenError("Blob token has expired.");
    }
    // Throws if the path escapes the root; the caller gets the logical blobPath back (not the
    // resolved filesystem path) so it can hand it straight to writeOnce/readBlob and to evidence
    // records, which store the same Azure-compatible `evidence-uploads/...` convention.
    this.assertPathWithinRoot(payload.blobPath);
    return payload.blobPath;
  }

  private assertPathWithinRoot(blobPath: string): string {
    const resolved = path.resolve(this.rootDir, blobPath);
    const rootPrefix = this.rootDir.endsWith(path.sep) ? this.rootDir : `${this.rootDir}${path.sep}`;
    if (resolved !== this.rootDir && !resolved.startsWith(rootPrefix)) {
      // blobPath is always server-generated (never client input) — this check is defense in
      // depth only, exercised via a deliberately adversarial blobPath in tests.
      throw new LocalBlobTokenError(`Resolved blob path escapes the configured storage root: ${blobPath}`);
    }
    return resolved;
  }

  async initUpload(input: UploadInit): Promise<UploadInitResult> {
    validateInput(input);
    const uploadId = crypto.randomUUID();
    const blobPath = `evidence-uploads/${uploadId}/${sanitizeFilename(input.filename)}`;
    const exp = Date.now() + this.tokenExpirySeconds * 1000;
    const token = this.signToken({ blobPath, exp, method: "PUT" });
    return {
      uploadId,
      filename: input.filename,
      blobPath,
      uploadUrl: `/api/blobs/local/${token}`,
      requiredContentType: input.mimeType,
      requiredBlobType: "BlockBlob",
      expiresInSeconds: this.tokenExpirySeconds,
    };
  }

  async mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }> {
    const exp = Date.now() + this.tokenExpirySeconds * 1000;
    const token = this.signToken({ blobPath, exp, method: "GET" });
    return { url: `/api/blobs/local/${token}`, expiresInSeconds: this.tokenExpirySeconds };
  }

  /** Write-once: rejects with LocalBlobConflictError if a blob already exists at this path. */
  async writeOnce(blobPath: string, bytes: Uint8Array): Promise<void> {
    const filePath = this.assertPathWithinRoot(blobPath);
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    try {
      // "wx" = write, fail if the path already exists — the write-once guarantee.
      await fsPromises.writeFile(filePath, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new LocalBlobConflictError(`A blob already exists at "${blobPath}".`);
      }
      throw error;
    }
  }

  async readBlob(blobPath: string): Promise<Uint8Array> {
    const filePath = this.assertPathWithinRoot(blobPath);
    try {
      return await fsPromises.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new LocalBlobNotFoundError(`No blob found at "${blobPath}".`);
      }
      throw error;
    }
  }
}

export type AzureBlobUploaderConfig = {
  accountName: string;
  containerName: string;
  /** Override the SAS lifetime (seconds). Defaults to 600. */
  sasExpirySeconds?: number;
};

export class AzureBlobUploader implements BlobUploader {
  readonly kind = "azure" as const;

  private readonly serviceClient: BlobServiceClient;
  private readonly accountName: string;
  private readonly containerName: string;
  private readonly sasExpirySeconds: number;
  private cachedKey: { key: UserDelegationKey; expiresAt: number } | null = null;

  constructor(config: AzureBlobUploaderConfig) {
    this.accountName = config.accountName;
    this.containerName = config.containerName;
    this.sasExpirySeconds = config.sasExpirySeconds ?? DEFAULT_SAS_EXPIRY_SECONDS;
    this.serviceClient = new BlobServiceClient(
      `https://${config.accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }

  private async getUserDelegationKey(): Promise<UserDelegationKey> {
    const now = Date.now();
    if (this.cachedKey && this.cachedKey.expiresAt > now + 60_000) {
      return this.cachedKey.key;
    }
    const startsOn = new Date(now - 30_000); // small skew safety
    const expiresOn = new Date(now + DELEGATION_KEY_LIFETIME_MS);
    const key = await this.serviceClient.getUserDelegationKey(startsOn, expiresOn);
    this.cachedKey = { key, expiresAt: expiresOn.getTime() };
    return key;
  }

  async initUpload(input: UploadInit): Promise<UploadInitResult> {
    validateInput(input);
    const uploadId = crypto.randomUUID();
    const blobName = `evidence-uploads/${uploadId}/${sanitizeFilename(input.filename)}`;
    const expiresOn = new Date(Date.now() + this.sasExpirySeconds * 1000);

    const userDelegationKey = await this.getUserDelegationKey();
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName,
        // Create + write only; no read/list/delete on the SAS surface.
        permissions: BlobSASPermissions.parse("cw"),
        protocol: SASProtocol.Https,
        expiresOn,
        contentType: input.mimeType,
      },
      userDelegationKey,
      this.accountName,
    ).toString();

    const blobUrl = `https://${this.accountName}.blob.core.windows.net/${this.containerName}/${blobName}`;

    return {
      uploadId,
      filename: input.filename,
      blobPath: blobName,
      uploadUrl: `${blobUrl}?${sas}`,
      requiredContentType: input.mimeType,
      requiredBlobType: "BlockBlob",
      expiresInSeconds: this.sasExpirySeconds,
    };
  }

  async mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }> {
    // Read-only SAS for Document Intelligence to fetch the receipt blob. Same User-Delegation key
    // flow as initUpload — never use account keys. Permissions are `r` only (no list/delete).
    const expiresOn = new Date(Date.now() + this.sasExpirySeconds * 1000);
    const userDelegationKey = await this.getUserDelegationKey();
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: blobPath,
        permissions: BlobSASPermissions.parse("r"),
        protocol: SASProtocol.Https,
        expiresOn,
      },
      userDelegationKey,
      this.accountName,
    ).toString();

    const blobUrl = `https://${this.accountName}.blob.core.windows.net/${this.containerName}/${blobPath}`;
    return {
      url: `${blobUrl}?${sas}`,
      expiresInSeconds: this.sasExpirySeconds,
    };
  }
}

export type BlobUploaderConfig = {
  accountName?: string | undefined;
  containerName?: string | undefined;
  /**
   * ACCOUNTING_BLOB_DIR (D1): filesystem root for LocalDiskBlobUploader, used when Azure
   * Storage env is absent. Takes precedence over the failClosed/stub fallback below.
   */
  blobDir?: string | undefined;
  /**
   * When true and neither Azure nor blobDir is configured, return `UnavailableBlobUploader`
   * instead of the demo stub. Neutral flag — callers (services/api) map
   * `runtimeMode === "normal"`; this module stays free of runtimeMode concepts.
   */
  failClosed?: boolean | undefined;
};

export function createBlobUploader(config: BlobUploaderConfig): BlobUploader {
  if (config.accountName && config.containerName) {
    return new AzureBlobUploader({
      accountName: config.accountName,
      containerName: config.containerName,
    });
  }
  if (config.blobDir) {
    return new LocalDiskBlobUploader({ rootDir: config.blobDir });
  }
  if (config.failClosed) {
    return new UnavailableBlobUploader(
      "Uploads are unavailable in normal mode until AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_CONTAINER " +
        "or ACCOUNTING_BLOB_DIR are configured.",
    );
  }
  return new StubBlobUploader();
}
