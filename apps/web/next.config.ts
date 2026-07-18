import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const monorepoRoot = path.join(__dirname, "../../");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * R17: the Azure Blob origin the CSP must allow when direct-to-Azure SAS
 * traffic is in play — browser PUTs to the write SAS (connect-src) and
 * read-SAS previews (img-src for images, frame-src for PDF iframes). Unset
 * (demo mode / stub uploader) keeps the strict same-origin CSP byte-identical.
 * `new URL(...).origin` normalizes the value and rejects anything that could
 * smuggle extra CSP tokens (spaces/semicolons never survive URL parsing).
 */
function resolveStorageOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_AZURE_STORAGE_ORIGIN?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw).origin;
  } catch {
    console.warn(`Ignoring invalid NEXT_PUBLIC_AZURE_STORAGE_ORIGIN: ${raw}`);
    return undefined;
  }
}

function buildContentSecurityPolicy(isDev: boolean, storageOrigin: string | undefined): string {
  const storage = storageOrigin ? ` ${storageOrigin}` : "";
  const base = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${storage}`,
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ];
  const scriptConnectWorker = isDev
    ? [
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        `connect-src 'self' ws: wss:${storage}`,
        "worker-src 'self' blob:",
      ]
    : ["script-src 'self' 'unsafe-inline'", `connect-src 'self'${storage}`, "worker-src 'self'"];
  // PDF read-SAS previews render in an <iframe> (evidence detail). frame-src
  // falls back to default-src 'self' when omitted, so only add the directive
  // when a storage origin is configured — keeping the unset CSP byte-identical.
  const frame = storageOrigin ? [`frame-src 'self' ${storageOrigin}`] : [];
  return [...base, ...scriptConnectWorker, ...frame].join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const contentSecurityPolicy = buildContentSecurityPolicy(isDev, resolveStorageOrigin());

    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
  turbopack: {
    root: monorepoRoot,
  },
  /* Monorepo: trace hoisted deps (e.g. @swc/helpers) from workspace root — see Turbopack root / Next standalone tracing docs */
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    "/**": ["node_modules/@swc/helpers/**/*"],
  },
  transpilePackages: [
    "@jpx-accounting/api-client",
    "@jpx-accounting/contracts",
    "@jpx-accounting/domain",
    "@jpx-accounting/reporting",
    "@jpx-accounting/ui-tokens",
  ],
};

export default withNextIntl(nextConfig);
