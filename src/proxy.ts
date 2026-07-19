import createIntlMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { routing } from "@/i18n/routing";
import { logger } from "@/server/logger";

// Handles locale negotiation (`NEXT_LOCALE` cookie, `Accept-Language`
// fallback). With `localePrefix: "never"` this never rewrites the URL —
// it only sets the cookie on first visit (docs/ARCHITECTURE.md §10).
const handleI18nRouting = createIntlMiddleware(routing);

/**
 * Routes reachable without an authenticated session. Everything else falls
 * through to the redirect-to-`/signin` branch below (T6, mvp-launch-readiness).
 *
 * `/posts/:id*` covers post detail pages (e.g. `/posts/abc123`) but
 * deliberately excludes `/posts/new`, which requires auth. `/signin` and
 * `/signup` must stay public too — otherwise a signed-out visitor could
 * never reach the page that lets them sign in.
 *
 * `/uploads/branding/*` (site branding assets) is public;
 * `/uploads/posts/*` (user-uploaded content) is intentionally NOT — it
 * falls through to the auth-gated default.
 */
function isPublicPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/posts" ||
    pathname === "/privacy" ||
    pathname === "/signin" ||
    // Second step of the two-call MFA sign-in (T16): the user has passed
    // step 1 but does not yet hold a full session, so this must be reachable
    // signed-out — same tier as `/signin`.
    pathname === "/signin/mfa-challenge" ||
    pathname === "/signup" ||
    pathname === "/favicon.ico"
  ) {
    return true;
  }

  if (pathname === "/api/health" || pathname === "/api/webhooks/resend") {
    return true;
  }

  if (pathname.startsWith("/api/auth/")) {
    return true;
  }

  if (pathname.startsWith("/uploads/branding/")) {
    return true;
  }

  if (
    pathname.startsWith("/posts/") &&
    pathname !== "/posts/new" &&
    !pathname.startsWith("/posts/new/")
  ) {
    return true;
  }

  return false;
}

/**
 * Runs next-intl (or a passthrough for API/upload routes) for a request that
 * has already cleared the auth gate. Extracted so the MFA warn-branch (T18)
 * can decorate the same response with the `x-mfa-warn` header without
 * duplicating this routing decision.
 */
function routeResponse(req: Parameters<typeof handleI18nRouting>[0]): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/uploads/")) {
    return NextResponse.next();
  }
  return handleI18nRouting(req);
}

export default auth((req) => {
  const { pathname, search, origin } = req.nextUrl;

  if (!isPublicPath(pathname) && !req.auth) {
    const callbackUrl = encodeURIComponent(`${pathname}${search}`);
    return NextResponse.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, origin));
  }

  // Moderator/admin MFA enrollment gate (T18). Warn-only until
  // `MFA_ENFORCE_BEGIN_AT` (an ISO timestamp) passes; unset means warn-only
  // forever. Once enforcing, a privileged account without MFA is redirected
  // to `/account/mfa` for every page route until it enrolls.
  const user = req.auth?.user;
  if (
    user &&
    (user.role === "moderator" || user.role === "admin") &&
    !user.mfaEnabledAt
  ) {
    const enforceBeginAt = process.env.MFA_ENFORCE_BEGIN_AT;
    const enforcing =
      Boolean(enforceBeginAt) && new Date(enforceBeginAt as string).getTime() < Date.now();

    if (enforcing) {
      // `/account/mfa` itself and API routes must stay reachable, otherwise
      // the user can never enroll (and API clients would get HTML redirects).
      if (pathname !== "/account/mfa" && !pathname.startsWith("/api/")) {
        return NextResponse.redirect(new URL("/account/mfa?force=1", origin));
      }
      return routeResponse(req);
    }

    // Warn-only window: let the request through but flag it so the header
    // renders the "set up MFA" banner. `logger` is dependency-free
    // (console.log only), so it's safe in the middleware runtime.
    logger.warn({ module: "proxy", event: "mfa_not_enrolled", userId: user.id });
    const response = routeResponse(req);
    response.headers.set("x-mfa-warn", "1");
    return response;
  }

  return routeResponse(req);
});

export const config = {
  // Match everything except Next.js's own static/image internals — this
  // intentionally includes paths with file extensions (e.g.
  // `/uploads/posts/<uuid>.jpg`) so the auth gate above still applies to
  // user-uploaded content.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
