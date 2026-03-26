import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@jpx-accounting/api-client",
    "@jpx-accounting/contracts",
    "@jpx-accounting/domain",
    "@jpx-accounting/reporting",
    "@jpx-accounting/ui-tokens",
  ],
};

export default nextConfig;
