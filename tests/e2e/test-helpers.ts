import type { APIRequestContext } from "@playwright/test";

export const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";

export const createEvidencePayload = {
  organizationId: "org_jpx",
  workspaceId: "workspace_main",
  actorId: "user_founder",
  title: "Playwright evidence sample",
  originalFilename: "playwright-receipt.jpg",
  mimeType: "image/jpeg",
  modalities: ["camera", "screenshot"] as const,
  extractedText: "Receipt captured during browser test coverage",
};

export async function resetApiState(request: APIRequestContext) {
  const response = await request.post(`${apiBaseUrl}/api/testing/reset`);

  if (!response.ok()) {
    throw new Error(`Failed to reset test API state: ${response.status()} ${response.statusText()}`);
  }
}
