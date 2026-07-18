/**
 * Type augmentation for NextAuth v5 (docs/ARCHITECTURE.md §4.4) so
 * `session.user.role` / `session.user.id` are typed on the server (RSC,
 * Route Handlers) and client alike, matching the RBAC roles enforced in
 * `src/server/services/auth-service.ts` and prisma/schema.prisma `Role`.
 */

import type { AuthRole } from "@/server/services/auth-service";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    role: AuthRole;
  }

  interface Session {
    user: {
      id: string;
      role: AuthRole;
    } & DefaultSession["user"];
  }
}

// Note: `next-auth/jwt` re-exports its `JWT` interface from `@auth/core/jwt`,
// a transitive dependency pnpm does not hoist to the project root, so
// `declare module "@auth/core/jwt"` here would not reliably merge with the
// module next-auth's own code resolves internally. `token.id`/`token.role`
// are read back with an explicit cast at the call site in `src/auth.ts`
// instead of relying on that augmentation.
