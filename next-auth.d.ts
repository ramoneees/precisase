/**
 * Type augmentation for NextAuth v5 (docs/ARCHITECTURE.md §4.4) so
 * `session.user.role` / `session.user.id` are typed on the server (RSC,
 * Route Handlers) and client alike, matching the RBAC roles enforced in
 * `src/server/services/auth-service.ts` and prisma/schema.prisma `Role`.
 *
 * Region preferences (`country`/`timeZone`/`currency`) live alongside
 * `role`/`id` on the session so RSC and Route Handlers can render
 * locale-aware UI (date in the user's TZ, currency in their default)
 * without re-querying the DB on every page render.
 */

import type { AuthRole } from "@/server/services/auth-service";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: AuthRole;
    /** ISO 3166-1 alpha-2 country code (e.g. "PT"), or null if not yet set. */
    country?: string | null;
    /** IANA time zone (e.g. "Europe/Lisbon"), or null if not yet set. */
    timeZone?: string | null;
    /** ISO 4217 currency code (e.g. "EUR"), or null if not yet set. */
    currency?: string | null;
  }

  interface Session {
    user: {
      id: string;
      role: AuthRole;
      country?: string | null;
      timeZone?: string | null;
      currency?: string | null;
    } & DefaultSession["user"];
  }
}

// Note: `next-auth/jwt` re-exports its `JWT` interface from `@auth/core/jwt`,
// a transitive dependency pnpm does not hoist to the project root, so
// `declare module "@auth/core/jwt"` here would not reliably merge with the
// module next-auth's own code resolves internally. `token.id`/`token.role`
// are read back with an explicit cast at the call site in `src/auth.ts`
// instead of relying on that augmentation.
