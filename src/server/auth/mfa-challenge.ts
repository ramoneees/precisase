/**
 * MFA gate for the credentials `authorize` flow (T16), kept in its own
 * module so its three branches are unit-testable without booting NextAuth or
 * the Prisma/libsodium service graph (see `mfa-challenge.test.ts`), and so
 * `src/auth.ts` — which the edge middleware (`src/proxy.ts`) imports — stays
 * lean.
 */

import { CredentialsSignin } from "next-auth";

/**
 * Thrown when the password is correct but the user has MFA enabled and no
 * `mfaToken` was supplied — i.e. the first of the two sign-in calls. It
 * subclasses `CredentialsSignin` (an `AuthError`), so @auth/core re-throws
 * the *same instance* out through `signIn()` in "raw" mode (an `AuthError`
 * thrown from `authorize` is re-thrown as-is; non-`AuthError`s get wrapped in
 * `CallbackRouteError`). The sign-in Server Action discriminates on
 * `error.name === "MfaRequiredSigninError"` (the base `AuthError` constructor
 * sets `this.name = this.constructor.name`); `.type` is inherited as
 * `"CredentialsSignin"` and therefore cannot distinguish this from a genuine
 * wrong-code/wrong-password failure, so `name` is the reliable discriminator.
 */
export class MfaRequiredSigninError extends CredentialsSignin {
  code = "mfa_required";
}

interface MfaChallengeDeps {
  findUserByEmail: (
    email: string,
  ) => Promise<{ mfaEnabledAt: Date | null; mfaSecret: string | null } | null>;
  verifyTotp: (token: string, secret: string) => Promise<boolean>;
}

/**
 * Assumes the password has already been verified. It:
 *   - returns immediately when the user has no MFA enabled (or the re-fetched
 *     record has a null/undecryptable secret — the repository fail-safes a
 *     corrupt secret to null, which must never lock the user out);
 *   - throws `MfaRequiredSigninError` when a code is required but absent
 *     (first of the two sign-in calls);
 *   - throws the generic `CredentialsSignin` when a supplied code is wrong.
 */
export async function enforceMfaChallenge(
  email: string,
  mfaToken: unknown,
  user: { mfaEnabledAt: Date | null },
  deps: MfaChallengeDeps,
): Promise<void> {
  if (!user.mfaEnabledAt) {
    return;
  }
  const fullRecord = await deps.findUserByEmail(email);
  if (!fullRecord?.mfaEnabledAt || !fullRecord.mfaSecret) {
    return;
  }
  if (typeof mfaToken !== "string" || mfaToken.length === 0) {
    throw new MfaRequiredSigninError();
  }
  const isValid = await deps.verifyTotp(mfaToken, fullRecord.mfaSecret);
  if (!isValid) {
    throw new CredentialsSignin();
  }
}
