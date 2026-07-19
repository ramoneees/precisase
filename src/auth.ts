/**
 * NextAuth v5 (Auth.js) configuration — docs/ARCHITECTURE.md §4.4, §7.1.
 *
 * - Credentials provider only (no OAuth providers in MVP scope), backed by
 *   `verifyCredentials` (src/server/services/auth-service.ts) and
 *   `PasswordService` (argon2id, §7.1).
 * - JWT session strategy: no database session table is needed since the
 *   only provider is credentials-based.
 * - `role` and `id` are copied onto the JWT and then the session object
 *   (see next-auth.d.ts for the type augmentation) so server components
 *   and Route Handlers can read `session.user.role` for RBAC (§7.2).
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials, type AuthRole } from "@/server/services/auth-service";
import { PasswordService } from "@/server/services/password-service";
import { PrismaAuthUserRepository } from "@/server/auth/user-repository";
import { enforceMfaChallenge } from "@/server/auth/mfa-challenge";
import { mfaService } from "@/server/service-instances";

const passwordService = new PasswordService();
const authUserRepository = new PrismaAuthUserRepository();

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Declared so NextAuth accepts it in `signIn()` calls, even though
        // we never use its built-in form. The two-call MFA flow (T16) sends
        // this on the *second* call from `/signin/mfa-challenge`.
        mfaToken: { label: "MFA code", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;

        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await verifyCredentials(
          { email, password },
          authUserRepository,
          passwordService,
        );

        if (!user) {
          return null;
        }

        // MFA challenge (T16). `verifyCredentials` intentionally never
        // exposes the raw secret, so `enforceMfaChallenge` re-fetches the
        // record to get the decrypted `mfaSecret` (cheap). Throws to signal
        // "code required" (first call) or "code wrong".
        await enforceMfaChallenge(email, credentials?.mfaToken, user, {
          findUserByEmail: (lookupEmail) => authUserRepository.findUserByEmail(lookupEmail),
          verifyTotp: (token, secret) => mfaService.verifyTotp(token, secret),
        });

        // Shape expected by NextAuth's `User` type (augmented in
        // next-auth.d.ts). Region preferences are copied through to the
        // JWT/session so locale-aware rendering doesn't need a per-render
        // DB lookup.
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
          country: user.country,
          timeZone: user.timeZone,
          currency: user.currency,
          // JWT/session values must stay JSON-serializable, so this is an
          // ISO string, not a `Date`. Threaded through so a later wave's
          // two-call sign-in flow can branch on it — the actual MFA
          // challenge is not implemented here (T16).
          mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.country = user.country ?? null;
        token.timeZone = user.timeZone ?? null;
        token.currency = user.currency ?? null;
        token.mfaEnabledAt = user.mfaEnabledAt ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // token.id/token.role are typed `unknown` here — see the note in
        // next-auth.d.ts on why the JWT ambient augmentation doesn't merge
        // under pnpm's non-hoisted @auth/core layout.
        session.user.id = token.id as string;
        session.user.role = token.role as AuthRole;
        session.user.country = (token.country as string | null | undefined) ?? null;
        session.user.timeZone = (token.timeZone as string | null | undefined) ?? null;
        session.user.currency = (token.currency as string | null | undefined) ?? null;
        session.user.mfaEnabledAt = (token.mfaEnabledAt as string | null | undefined) ?? null;
      }
      return session;
    },
  },
});
