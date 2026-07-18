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

const passwordService = new PasswordService();
const authUserRepository = new PrismaAuthUserRepository();

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
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

        // Shape expected by NextAuth's `User` type (augmented in
        // next-auth.d.ts to require `id` and `role`).
        return {
          id: user.id,
          email: user.email,
          name: user.displayName,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
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
      }
      return session;
    },
  },
});
