// This file configures the initialization of Sentry on the client (browser).
// The config here is loaded by `@sentry/nextjs`'s Next.js integration,
// which is wired up via `withSentryConfig` in `next.config.ts`.
//
// See docs/MVP.md / .omo/plans/mvp-launch-readiness.md (T1) for context.
// If `SENTRY_DSN` is unset, `Sentry.init` no-ops gracefully — no error
// tracking happens locally unless the env var is configured.
import * as Sentry from "@sentry/nextjs";

// Client bundles only ever see `NEXT_PUBLIC_`-prefixed env vars (Next.js
// inlines them at build time); a bare `SENTRY_DSN` would never reach the
// browser. `.env.example` defines both — `NEXT_PUBLIC_SENTRY_DSN` for this
// file, `SENTRY_DSN` for the server/edge configs.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console
  // while you're setting up Sentry.
  debug: false,
});
