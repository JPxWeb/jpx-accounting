import { expect, test } from "@playwright/test";

test.skip(
  process.env.PLAYWRIGHT_NORMAL_MODE !== "true",
  "Set PLAYWRIGHT_NORMAL_MODE=true with local Supabase + normal API/web servers.",
);

test("health and workspace respond in normal mode", async ({ request }) => {
  const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? "http://127.0.0.1:3201";

  const health = await request.get(`${apiBaseUrl}/health`);
  expect(health.ok()).toBeTruthy();
  const healthBody = await health.json();
  expect(healthBody.runtimeMode).toBe("normal");

  const workspace = await request.get(`${apiBaseUrl}/api/workspace`, {
    headers: { Authorization: `Bearer ${process.env.PLAYWRIGHT_BEARER_TOKEN ?? "test"}` },
  });

  if (workspace.status() === 401) {
    test.skip(true, "Provide PLAYWRIGHT_BEARER_TOKEN for authenticated normal-mode workspace check.");
  }

  expect(workspace.ok()).toBeTruthy();
  const snapshot = await workspace.json();
  expect(Array.isArray(snapshot.reviews)).toBeTruthy();
});
