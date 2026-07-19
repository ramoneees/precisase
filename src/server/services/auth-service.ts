/**
 * Authentication — credential verification per docs/ARCHITECTURE.md §4.4
 * ("Auth.js (NextAuth v5) with a credentials provider, argon2id password
 * hashing") and §7.1 (Authentication).
 *
 * Like PostService/InterestService, this module is decoupled from Prisma:
 * it depends on the narrow `AuthUserRepository` port below, so
 * `verifyCredentials` is unit-testable with an in-memory fake (see
 * auth-service.test.ts) rather than a live database. A Prisma-backed
 * implementation of `AuthUserRepository` lives alongside the NextAuth
 * configuration that wires this up to `src/generated/prisma` (read-only
 * queries against the `User` model).
 */

export type AuthRole = "user" | "moderator" | "admin";

/**
 * The subset of the `User` model (prisma/schema.prisma) needed to
 * authenticate a credentials login.
 */
export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: AuthRole;
  /** ISO 3166-1 alpha-2 country code — threaded onto `session.user` for locale-aware rendering. */
  country: string | null;
  /** IANA time zone — threaded onto `session.user` for date/time display. */
  timeZone: string | null;
  /** ISO 4217 currency code — threaded onto `session.user` for currency formatting. */
  currency: string | null;
  /** Soft-delete marker (§5.1) — a deleted user may never authenticate. */
  deletedAt: Date | null;
  /**
   * Decrypted TOTP secret (plaintext at this layer, same convention as
   * `PostRecord.contactValue` — decryption happens only at the repository
   * boundary), or `null` if MFA has never been enrolled/is pending. Never
   * forwarded onto `AuthenticatedUser`.
   */
  mfaSecret: string | null;
  /** Set once MFA enrollment is confirmed (see `MfaService.enableMfa`); `null` while unenrolled or pending. */
  mfaEnabledAt: Date | null;
}

/**
 * Data-access port consumed by `verifyCredentials`. Keeping this narrow
 * (rather than depending on the full Prisma client) is what makes
 * credential verification unit-testable without a database.
 */
export interface AuthUserRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
}

/**
 * Password-verification port consumed by `verifyCredentials`. `PasswordService`
 * (password-service.ts) satisfies this interface; tests can supply a fake
 * instead of hashing/verifying real argon2id hashes.
 */
export interface PasswordVerifier {
  verify(password: string, passwordHash: string): Promise<boolean>;
}

export interface VerifyCredentialsInput {
  email: string;
  password: string;
}

/**
 * The authenticated user, deliberately excluding `passwordHash` — and,
 * deliberately, `mfaSecret`. `mfaEnabledAt` is kept (a later wave's
 * two-call sign-in flow branches on whether it's set to decide whether to
 * challenge for a TOTP code); the raw secret must never leave this
 * function's internal scope.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: AuthRole;
  country: string | null;
  timeZone: string | null;
  currency: string | null;
  mfaEnabledAt: Date | null;
}

/**
 * Verifies an email + password pair against the `AuthUserRepository` port,
 * returning the authenticated user on success or `null` on any failure
 * (unknown email, wrong password, or a soft-deleted account) — the caller
 * cannot distinguish which, by design, so failed-login responses don't leak
 * whether an email is registered.
 */
export async function verifyCredentials(
  { email, password }: VerifyCredentialsInput,
  repo: AuthUserRepository,
  passwordVerifier: PasswordVerifier,
): Promise<AuthenticatedUser | null> {
  const user = await repo.findUserByEmail(email);
  if (!user || user.deletedAt) {
    return null;
  }

  const passwordMatches = await passwordVerifier.verify(
    password,
    user.passwordHash,
  );
  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    country: user.country,
    timeZone: user.timeZone,
    currency: user.currency,
    mfaEnabledAt: user.mfaEnabledAt,
  };
}
