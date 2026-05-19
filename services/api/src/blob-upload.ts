import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
} from "@azure/storage-blob";

import type { ApiRuntimeConfig } from "./config";

export type UploadInitResult = {
  uploadId: string;
  filename: string;
  uploadUrl: string;
  blobPath: string;
  expiresInSeconds: number;
};

export async function createBlobUploadInit(
  config: ApiRuntimeConfig,
  input: { filename: string; mimeType: string; size: number },
  scope: { organizationId: string; evidenceId: string },
): Promise<UploadInitResult> {
  const expiresInSeconds = 900;

  if (!config.storage.account) {
    const blobPath = `${scope.organizationId}/${scope.evidenceId}/${input.filename}`;
    return {
      uploadId: scope.evidenceId,
      filename: input.filename,
      uploadUrl: `/api/uploads/stub/${encodeURIComponent(blobPath)}`,
      blobPath,
      expiresInSeconds,
    };
  }

  const account = config.storage.account;
  const container = config.storage.container;
  const svc = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());

  const now = new Date();
  const expiresOn = new Date(now.getTime() + expiresInSeconds * 1000);
  const udk = await svc.getUserDelegationKey(now, expiresOn);
  const blobPath = `${scope.organizationId}/${scope.evidenceId}/${input.filename}`;

  const sas = generateBlobSASQueryParameters(
    {
      containerName: container,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("cw"),
      startsOn: now,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    udk,
    account,
  ).toString();

  return {
    uploadId: scope.evidenceId,
    filename: input.filename,
    uploadUrl: `https://${account}.blob.core.windows.net/${container}/${blobPath}?${sas}`,
    blobPath,
    expiresInSeconds,
  };
}
