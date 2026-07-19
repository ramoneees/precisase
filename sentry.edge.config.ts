// This file configures the initialization of Sentry for edge features (e.g.
// middleware, edge routes). The config here is loaded by `@sentry/nextjs`'s
// Next.js integration, wired up via `withSentryConfig` in `next.config.ts`.
//
// See docs/MVP.md / .omo/plans/mvp-launch-readiness.md (T1) for context.
// If `SENTRY_DSN` is unset, `Sentry.init` no-ops gracefully — no error
// tracking happens locally unless the env var is configured.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console
  // while you're setting up Sentry.
  debug: false,
});
