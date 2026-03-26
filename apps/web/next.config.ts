import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Required for pnpm monorepo: trace dependencies from the monorepo root
  // so standalone build includes hoisted packages like @swc/helpers
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: [
    "@jpx-accounting/api-client",
    "@jpx-accounting/contracts",
    "@jpx-accounting/domain",
    "@jpx-accounting/reporting",
    "@jpx-accounting/ui-tokens",
  ],
};

export default nextConfig;
