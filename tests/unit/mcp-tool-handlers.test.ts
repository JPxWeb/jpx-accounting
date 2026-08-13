import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMcpApiClientFromEnv,
  handleInitializeUpload,
  handleSubmitEnrichmentProposal,
  handleSubmitReviewProposal,
  McpToolHandlerError,
} from "../../packages/mcp-server/src/tools/handlers.ts";

test("initialize_upload returns only an HTTPS SAS credential and blob identity", async () => {
  const input = { filename: "invoice.pdf", mimeType: "application/pdf", size: 128 };
  const client = {
    initUpload: async (received: typeof input) => {
      assert.deepEqual(received, input);
      return {
        uploadId: "up_1",
        filename: input.filename,
        blobPath: "evidence-uploads/up_1/invoice.pdf",
        uploadUrl: "https://storage.example/container/invoice.pdf?sig=secret",
        requiredContentType: input.mimeType,
        requiredBlobType: "BlockBlob" as const,
        expiresInSeconds: 600,
      };
    },
  };

  const result = await handleInitializeUpload(client, input);

  assert.deepEqual(result, {
    uploadId: "up_1",
    sasUrl: "https://storage.example/container/invoice.pdf?sig=secret",
    blobPath: "evidence-uploads/up_1/invoice.pdf",
  });
  assert.equal(Object.hasOwn(result, "base64"), false);
});

test("initialize_upload fails closed when the API does not return an HTTPS SAS URL", async () => {
  const client = {
    initUpload: async () => ({
      uploadId: "up_1",
      filename: "invoice.pdf",
      blobPath: "evidence-uploads/up_1/invoice.pdf",
      uploadUrl: "/api/uploads/up_1",
      requiredContentType: "application/pdf",
      requiredBlobType: "BlockBlob" as const,
      expiresInSeconds: 600,
    }),
  };

  await assert.rejects(
    () => handleInitializeUpload(client, { filename: "invoice.pdf", mimeType: "application/pdf", size: 128 }),
    (error: unknown) =>
      error instanceof McpToolHandlerError && error.code === "upload_sas_unavailable" && error.status === 503,
  );
});

test("submit_review_proposal returns the exact attached intent version", async () => {
  const input = {
    reviewId: "review_1",
    voucherId: "voucher_1",
    proposals: [{ kind: "noop" as const }],
  };
  const client = {
    submitReviewProposal: async (received: typeof input) => {
      assert.deepEqual(received, input);
      return {
        reviewId: input.reviewId,
        deepLink: "/today?view=queue&review=review_1",
        status: "pending_review" as const,
        intentVersion: "intent_version_1",
      };
    },
  };

  assert.deepEqual(await handleSubmitReviewProposal(client, input), {
    reviewId: "review_1",
    deepLink: "/today?view=queue&review=review_1",
    status: "pending_review",
    intentVersion: "intent_version_1",
  });
});

test("submit_review_proposal maps a closed-review conflict to a structured MCP error", async () => {
  const client = {
    submitReviewProposal: async () => {
      const error = new Error("Review must remain open.") as Error & { status: number };
      error.status = 409;
      throw error;
    },
  };

  await assert.rejects(
    () =>
      handleSubmitReviewProposal(client, {
        reviewId: "review_closed",
        voucherId: "voucher_1",
        proposals: [{ kind: "noop" }],
      }),
    (error: unknown) =>
      error instanceof McpToolHandlerError &&
      error.code === "review_not_open" &&
      error.status === 409 &&
      /human review|open review/i.test(error.message),
  );
});

test("submit_enrichment_proposal forces MCP attribution and preserves idempotency", async () => {
  const input = {
    targetKind: "voucher" as const,
    targetId: "voucher_1",
    proposedChange: { kind: "noop" as const },
    source: "advisor" as const,
    idempotencyKey: "mcp-call-1",
  };
  const expected = {
    id: "work_1",
    organizationId: "org_jpx",
    workspaceId: "workspace_main",
    targetKind: "voucher" as const,
    targetId: "voucher_1",
    proposedChange: { kind: "noop" as const },
    status: "pending_confirmation" as const,
    source: "mcp" as const,
    idempotencyKey: "mcp-call-1",
    createdAt: "2026-08-09T10:00:00.000Z",
    createdBy: "user:test",
  };
  const client = {
    proposeEnrichmentWorkItem: async (received: Omit<typeof input, "source"> & { source: "mcp" }) => {
      assert.equal(received.source, "mcp");
      assert.equal(received.idempotencyKey, input.idempotencyKey);
      return expected;
    },
  };

  assert.deepEqual(await handleSubmitEnrichmentProposal(client, input), expected);
});

test("MCP API client propagates the host bearer token", async (t) => {
  let authorization: string | null = null;
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return Response.json({
      reviewId: "review_1",
      deepLink: "/today?view=queue&review=review_1",
      status: "pending_review",
      intentVersion: "intent_version_1",
    });
  });
  const client = createMcpApiClientFromEnv({
    ACCOUNTING_API_BASE_URL: "https://api.example",
    JPX_MCP_BEARER_TOKEN: "host-token",
  });

  const result = await handleSubmitReviewProposal(client, {
    reviewId: "review_1",
    voucherId: "voucher_1",
    proposals: [{ kind: "noop" }],
  });

  assert.equal(authorization, "Bearer host-token");
  assert.equal(result.intentVersion, "intent_version_1");
});

test("MCP API client fails closed without API URL or bearer token", () => {
  assert.throws(() => createMcpApiClientFromEnv({ JPX_MCP_BEARER_TOKEN: "token" }), /ACCOUNTING_API_BASE_URL/);
  assert.throws(
    () => createMcpApiClientFromEnv({ ACCOUNTING_API_BASE_URL: "https://api.example" }),
    /JPX_MCP_BEARER_TOKEN/,
  );
});
