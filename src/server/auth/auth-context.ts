/**
 * Auth context for Server Components / Server Actions that need to render
 * or behave differently for anonymous vs. signed-in visitors (T7,
 * mvp-launch-readiness — anon-browse on the shop window).
 *
 * Mirrors the `session.user` shape from `next-auth.d.ts` so callers don't
 * need to reach into `next-auth` themselves.
 */

import { auth } from "@/auth";
import type { AuthRole } from "@/server/services/auth-service";

export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Display name (`session.user.name` in next-auth's shape). */
  displayName: string;
  role: AuthRole;
  country: string | null;
  timeZone: string | null;
  currency: string | null;
}

export type AuthContext = { kind: "anon" } | { kind: "user"; user: AuthenticatedUser };

export async function getAuthContext(): Promise<AuthContext> {
  const session = await auth();

  if (!session?.user) {
    return { kind: "anon" };
  }

  const { user } = session;

  return {
    kind: "user",
    user: {
      id: user.id,
      email: user.email ?? "",
      displayName: user.name ?? "",
      role: user.role,
      country: user.country ?? null,
      timeZone: user.timeZone ?? null,
      currency: user.currency ?? null,
    },
  };
}
