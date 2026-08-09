import { AccountingApiClient, createAccountingApiClient } from "@jpx-accounting/api-client";

type InitializeUploadClient = Pick<AccountingApiClient, "initUpload">;
type ReviewProposalClient = Pick<AccountingApiClient, "submitReviewProposal">;
type EnrichmentProposalClient = Pick<AccountingApiClient, "proposeEnrichmentWorkItem">;

type InitializeUploadInput = Parameters<AccountingApiClient["initUpload"]>[0];
type ReviewProposalInput = Parameters<AccountingApiClient["submitReviewProposal"]>[0];
type EnrichmentProposalInput = Parameters<AccountingApiClient["proposeEnrichmentWorkItem"]>[0];

export type McpUploadCredential = {
  uploadId: string;
  sasUrl: string;
  blobPath: string;
};

export class McpToolHandlerError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "McpToolHandlerError";
  }
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

export async function handleInitializeUpload(
  client: InitializeUploadClient,
  input: InitializeUploadInput,
): Promise<McpUploadCredential> {
  const upload = await client.initUpload(input);
  let protocol: string | undefined;
  try {
    protocol = new URL(upload.uploadUrl).protocol;
  } catch {
    protocol = undefined;
  }
  if (protocol !== "https:") {
    throw new McpToolHandlerError(
      "upload_sas_unavailable",
      503,
      "The Accounting API did not return an HTTPS SAS upload URL.",
    );
  }
  return {
    uploadId: upload.uploadId,
    sasUrl: upload.uploadUrl,
    blobPath: upload.blobPath,
  };
}

export async function handleSubmitReviewProposal(
  client: ReviewProposalClient,
  input: ReviewProposalInput,
): ReturnType<AccountingApiClient["submitReviewProposal"]> {
  try {
    return await client.submitReviewProposal(input);
  } catch (error) {
    if (errorStatus(error) === 409) {
      throw new McpToolHandlerError(
        "review_not_open",
        409,
        "The proposal was not attached because this is no longer an open review. A human must review proposals before posting.",
      );
    }
    throw error;
  }
}

export async function handleSubmitEnrichmentProposal(
  client: EnrichmentProposalClient,
  input: EnrichmentProposalInput,
): ReturnType<AccountingApiClient["proposeEnrichmentWorkItem"]> {
  return client.proposeEnrichmentWorkItem({
    ...input,
    source: "mcp",
  });
}

export function createMcpApiClientFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AccountingApiClient {
  const baseUrl = env.ACCOUNTING_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new McpToolHandlerError(
      "mcp_api_url_missing",
      503,
      "ACCOUNTING_API_BASE_URL is required to start the MCP server.",
    );
  }
  const bearerToken = env.JPX_MCP_BEARER_TOKEN?.trim();
  if (!bearerToken) {
    throw new McpToolHandlerError(
      "mcp_bearer_token_missing",
      401,
      "JPX_MCP_BEARER_TOKEN is required to authenticate MCP API requests.",
    );
  }

  return createAccountingApiClient({
    baseUrl,
    runtimeMode: "normal",
    getAuthToken: () => bearerToken,
  });
}
