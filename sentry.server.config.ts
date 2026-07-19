// This file configures the initialization of Sentry on the server (RSC
// rendering + Route Handlers). The config here is loaded by `@sentry/nextjs`'s
// Next.js integration, wired up via `withSentryConfig` in `next.config.ts`.
//
// See docs/MVP.md / .omo/plans/mvp-launch-readiness.md (T1) for context.
// If `SENTRY_DSN` is unset, `Sentry.init` no-ops gracefully — no error
// tracking happens locally unless the env var is configured.
//
// Pinned to `@sentry/nextjs` (see package.json for the exact resolved
// version) — Next.js 16 support landed in SDK 10.20.0+; only webpack builds
// are supported (no turbopack GA yet), hence `"build": "next build --webpack"`.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console
  // while you're setting up Sentry.
  debug: false,
});
