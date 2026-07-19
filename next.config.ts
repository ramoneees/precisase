import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  // Enables the standalone build output (self-contained server.js + minimal
  // node_modules) consumed by the production Dockerfile. See ARCHITECTURE.md §8.
  output: "standalone",
};

// Sentry build-time options (source map upload, release tagging, etc.).
// Org/project are read from env so local/CI builds without a Sentry auth
// token don't crash — see `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`
// in `.env.example`. `silent: true` avoids noisy build output when no auth
// token is configured. Note: Sentry's Next.js 16 support (SDK 10.20.0+)
// only covers webpack builds, hence `"build": "next build --webpack"` in
// package.json — turbopack isn't GA for Sentry yet.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
});
