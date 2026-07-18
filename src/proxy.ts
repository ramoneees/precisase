import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

// Handles locale-prefixed routing (`/pt-PT/...`, `/en/...`, `/pt-BR/...`).
// Requests to `/` are negotiated against `Accept-Language` and redirected
// to the closest supported locale, falling back to `pt-PT` (docs/ARCHITECTURE.md §10).
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except for:
  // - API routes (`/api/...`)
  // - Next.js internals (`/_next/...`)
  // - Files with an extension (e.g. `favicon.ico`, `robots.txt`)
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
