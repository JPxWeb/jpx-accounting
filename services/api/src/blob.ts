import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  type UserDelegationKey,
} from "@azure/storage-blob";
import type { UploadInit, UploadInitResult } from "@jpx-accounting/contracts";

// User-Delegation SAS minter. Account-key SAS is intentionally not used — production stores must
// reach Azure via Managed Identity + Storage Blob Delegator role (see infra/azure/main.bicep RBAC).
//
// Trust boundary: the API mints a short-lived (default 10 min) write-only SAS for a single blob
// under `evidence-uploads/{uploadId}/{filename}`. After the client PUTs the blob it must call
// /api/evidence with the same uploadId so the server can record the blob path.

export interface BlobUploader {
  /** Which implementation backs this uploader — the API branches on it for the stub PUT route and file-url minting. */
  readonly kind: "stub" | "azure";
  initUpload(input: UploadInit): Promise<UploadInitResult>;
  /**
   * Mint a short-lived read-only SAS URL for an existing blob path. Used by
   * Document Intelligence so the OCR service can fetch the receipt without
   * storage account keys. The stub returns a placeholder URL so the call site
   * can be wired before Azure Storage is available.
   */
  mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }>;
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
};

export function createBlobUploader(config: BlobUploaderConfig): BlobUploader {
  if (config.accountName && config.containerName) {
    return new AzureBlobUploader({
      accountName: config.accountName,
      containerName: config.containerName,
    });
  }
  return new StubBlobUploader();
}
