import path from "path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const monorepoRoot = path.join(__dirname, "../../");

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

function buildContentSecurityPolicy(isDev: boolean): string {
  const base = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ];
  const scriptConnectWorker = isDev
    ? ["script-src 'self' 'unsafe-inline' 'unsafe-eval'", "connect-src 'self' ws: wss:", "worker-src 'self' blob:"]
    : ["script-src 'self' 'unsafe-inline'", "connect-src 'self'", "worker-src 'self'"];
  return [...base, ...scriptConnectWorker].join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const contentSecurityPolicy = buildContentSecurityPolicy(isDev);

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
