import { expect, test } from "@playwright/test";

test.skip(({ isMobile }) => isMobile, "Manifest asset checks only need one desktop project.");

test("manifest declares installable icons and every declared asset resolves", async ({ request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);

  const manifest = (await manifestResponse.json()) as { icons?: Array<{ src: string }> };
  expect(Array.isArray(manifest.icons)).toBeTruthy();
  expect(manifest.icons!.length).toBeGreaterThanOrEqual(4);

  const assetPaths = [...manifest.icons!.map((icon) => icon.src), "/apple-touch-icon.png"];
  for (const assetPath of assetPaths) {
    const assetResponse = await request.get(assetPath);
    expect(assetResponse.status(), `${assetPath} should resolve with 200`).toBe(200);
  }
});
