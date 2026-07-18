import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  // Enables the standalone build output (self-contained server.js + minimal
  // node_modules) consumed by the production Dockerfile. See ARCHITECTURE.md §8.
  output: "standalone",
};

export default withNextIntl(nextConfig);
