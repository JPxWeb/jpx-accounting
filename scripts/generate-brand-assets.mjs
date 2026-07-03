// Generates the PWA icon set, apple-touch icon, and og-image from the brand SVG.
//
// Usage: node scripts/generate-brand-assets.mjs
//
// Source of truth: apps/web/public/brand/logo.svg (teal rounded square + white ledger-J mark).
// Outputs (all committed, regenerate after editing the SVG):
//   apps/web/public/icons/icon-192.png              192x192, transparent corners
//   apps/web/public/icons/icon-512.png              512x512, transparent corners
//   apps/web/public/icons/icon-maskable-192.png     192x192, full-bleed teal, mark at 60% (20% safe zone)
//   apps/web/public/icons/icon-maskable-512.png     512x512, full-bleed teal, mark at 60% (20% safe zone)
//   apps/web/public/apple-touch-icon.png            180x180, non-transparent teal background
//   apps/web/public/og-image.png                    1200x630, teal-on-light composition

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(repoRoot, "apps", "web", "public");
const iconsDir = path.join(publicDir, "icons");
const logoPath = path.join(publicDir, "brand", "logo.svg");

const TEAL = "#0f766e";
const LIGHT = "#e9eff2";
const LOGO_INTRINSIC_SIZE = 64;

const logoSvg = await readFile(logoPath);

/** Render the brand mark SVG to a square PNG buffer (transparent corners). */
function renderMark(size) {
  // Raise the rasterization density so librsvg renders at target resolution
  // instead of upscaling a 64px bitmap.
  const density = (72 * size) / LOGO_INTRINSIC_SIZE;
  return sharp(logoSvg, { density }).resize(size, size).png().toBuffer();
}

/** Full-bleed teal square with the mark scaled to 60%, honoring the maskable 20% safe zone. */
async function renderMaskable(size) {
  const markSize = Math.round(size * 0.6);
  const offset = Math.round((size - markSize) / 2);
  const mark = await renderMark(markSize);
  return sharp({ create: { width: size, height: size, channels: 4, background: TEAL } })
    .composite([{ input: mark, left: offset, top: offset }])
    .png()
    .toBuffer();
}

/** 180x180 apple-touch icon; iOS requires an opaque background. */
async function renderAppleTouch() {
  const mark = await renderMark(180);
  return sharp(mark).flatten({ background: TEAL }).png().toBuffer();
}

/** 1200x630 og-image: light background, centered mark above the wordmark. */
async function renderOgImage() {
  const markSize = 220;
  const background = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${LIGHT}" />
  <text x="600" y="460" text-anchor="middle" font-family="Manrope, 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="64" letter-spacing="-1" fill="#134e4a">JPX Accounting</text>
  <text x="600" y="520" text-anchor="middle" font-family="Manrope, 'Segoe UI', system-ui, sans-serif" font-weight="500" font-size="27" fill="#52716d">AI advisory accounting for European small businesses</text>
</svg>`;
  const mark = await renderMark(markSize);
  return sharp(Buffer.from(background))
    .composite([{ input: mark, left: Math.round((1200 - markSize) / 2), top: 110 }])
    .png()
    .toBuffer();
}

await mkdir(iconsDir, { recursive: true });

const outputs = [
  [path.join(iconsDir, "icon-192.png"), await renderMark(192)],
  [path.join(iconsDir, "icon-512.png"), await renderMark(512)],
  [path.join(iconsDir, "icon-maskable-192.png"), await renderMaskable(192)],
  [path.join(iconsDir, "icon-maskable-512.png"), await renderMaskable(512)],
  [path.join(publicDir, "apple-touch-icon.png"), await renderAppleTouch()],
  [path.join(publicDir, "og-image.png"), await renderOgImage()],
];

for (const [filePath, buffer] of outputs) {
  await writeFile(filePath, buffer);
  const { width, height } = await sharp(buffer).metadata();
  console.log(`${path.relative(repoRoot, filePath)} — ${width}x${height}`);
}
