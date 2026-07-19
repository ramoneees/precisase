/**
 * Sentry smoke-test route (T1, .omo/plans/mvp-launch-readiness.md).
 *
 * Visiting `/test/sentry-throw` renders this Server Component, which always
 * throws a synthetic error. Next.js's error boundary / global-error handling
 * hands the thrown error to Sentry's server instrumentation (see
 * `sentry.server.config.ts`), so this route exists purely to verify that
 * error capture is wired up end-to-end — no real Sentry DSN required to see
 * the `[sentry] capturing` line in server logs.
 *
 * Not linked from any nav — intentionally only reachable by direct URL.
 *
 * `force-dynamic` keeps this out of the build's static export step (it
 * would otherwise throw during `next build`'s prerendering and fail the
 * build); the throw only happens on an actual request to the route.
 */
export const dynamic = "force-dynamic";

export default function SentryThrowTestPage(): never {
  const error = new Error("sentry-test");
  console.error("[sentry] capturing:", error);
  throw error;
}
