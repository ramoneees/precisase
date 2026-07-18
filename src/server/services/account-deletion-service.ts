/**
 * AccountDeletionService — self-service GDPR/LGPD account deletion
 * (NFR08, docs/MVP.md; docs/ARCHITECTURE.md §6.4, §7.5, Q8/Q9).
 *
 * Deviation from §6.4's sequence diagram: the architecture draft describes
 * an email-token confirmation step ("INSERT deletion token, email user" ->
 * "Confirm via signed token"). This implementation uses **password
 * re-entry** as the confirmation step instead — the user must supply their
 * current password to confirm deletion. This is a standard, secure,
 * self-contained confirmation pattern that avoids a cross-dependency on the
 * notification worker (owned by a concurrent workstream) and needs no new
 * token/email plumbing. See the account-settings build report for the full
 * rationale.
 *
 * Like PostService/InterestService, this module is decoupled from Prisma:
 * it depends on the narrow `AccountDeletionRepository` port below, so the
 * redaction behavior is unit-testable with an in-memory fake (see
 * account-deletion-service.test.ts) rather than a live database. The
 * Prisma-backed implementation of `AccountDeletionRepository`
 * (src/server/repositories/prisma-account-deletion-repository.ts) wraps the
 * actual redaction in a single `$transaction`, so a partial failure never
 * leaves an account half-redacted.
 *
 * Redaction scope (§6.4/Q9 — anonymize-in-place is the recommended policy,
 * applied here):
 *   - User: email -> stable-but-unusable placeholder (still satisfies the
 *     unique constraint), displayName -> locale-neutral placeholder,
 *     phoneE164 -> null, churchAffiliation -> null, passwordHash -> a hash
 *     of a random, never-typed value (so the account can never authenticate
 *     again), deletedAt -> now.
 *   - ConsentRecord: withdrawnAt set on every still-active row for this
 *     user.
 *   - Interest: deleted (the user's own expressions of interest carry no
 *     value once the account is gone, and the DB's `Interest.userId` FK
 *     would otherwise still point at an identifiable-by-inference row).
 *   - Post: **not** modified by this service. The PII risk on Post rows was
 *     already limited to the encrypted `contactValue` (§7.4) and the
 *     `authorId` FK, which now points at an anonymized User row — there is
 *     no separate author name/email copied onto Post. Post content
 *     (title/description) is left as-authored so other users' Interest
 *     rows and the shop window's historical integrity are preserved, per
 *     §6.4's "anonymize-in-place" recommendation for Q9. If a user typed
 *     PII directly into a post's free-text fields, that is user-generated
 *     content outside this service's redaction scope (same as it would be
 *     for a live, non-deleted account).
 *   - AuditLog: one `user.gdpr_delete` row recorded (§7.6, Q8 — retention
 *     suggested at 12 months pending legal guidance).
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention).
// ---------------------------------------------------------------------

/** The subset of `User` fields needed to authenticate the deletion request. */
export interface AccountDeletionUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  deletedAt: Date | null;
}

/** The redacted values written to the `User` row on confirmed deletion. */
export interface AccountRedaction {
  email: string;
  displayName: string;
  passwordHash: string;
  deletedAt: Date;
}

/**
 * Data-access port consumed by `AccountDeletionService`. Keeping this
 * narrow (rather than depending on the full Prisma client) is what makes
 * the redaction behavior unit-testable without a database.
 */
export interface AccountDeletionRepository {
  findUserById(userId: string): Promise<AccountDeletionUserRecord | null>;
  /**
   * Performs the full redaction (User fields, ConsentRecord withdrawal,
   * Interest deletion, AuditLog row) as a single atomic operation. The
   * Prisma-backed implementation wraps this in `$transaction`.
   */
  redactAndDeleteAccount(userId: string, redaction: AccountRedaction): Promise<void>;
}

/** Password-verification port — `PasswordService.verify` satisfies this. */
export interface PasswordVerifier {
  verify(password: string, passwordHash: string): Promise<boolean>;
}

/** Password-hashing port — `PasswordService.hash` satisfies this. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`User ${userId} was not found.`);
    this.name = "UserNotFoundError";
  }
}

/** Thrown for either a wrong password or an already-deleted account. */
export class InvalidPasswordError extends Error {
  constructor() {
    super("The supplied password does not match the account's current password.");
    this.name = "InvalidPasswordError";
  }
}

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export interface DeleteOwnAccountInput {
  userId: string;
  password: string;
}

/** Locale-neutral display-name placeholder left on a redacted account. */
export const REDACTED_DISPLAY_NAME = "Utilizador removido";

/** Email placeholder format — still unique per user, never a real mailbox. */
export function redactedEmailFor(userId: string): string {
  return `deleted-${userId}@precisase.invalid`;
}

export class AccountDeletionService {
  constructor(
    private readonly repo: AccountDeletionRepository,
    private readonly passwordVerifier: PasswordVerifier,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  /**
   * NFR08 — self-service GDPR/LGPD deletion. Verifies the caller's current
   * password (the re-entry confirmation step — see the module doc comment
   * for the deviation from §6.4's email-token flow), then redacts the
   * account in place. Throws without touching any data if the account
   * doesn't exist, is already deleted, or the password doesn't match.
   */
  async deleteOwnAccount({ userId, password }: DeleteOwnAccountInput): Promise<void> {
    const user = await this.repo.findUserById(userId);
    if (!user || user.deletedAt) {
      throw new UserNotFoundError(userId);
    }

    const passwordMatches = await this.passwordVerifier.verify(password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidPasswordError();
    }

    // A random, never-typed value — hashed and stored in place of the real
    // password hash so no password (old or new) can ever authenticate as
    // this account again.
    const unusablePasswordHash = await this.passwordHasher.hash(
      `gdpr-delete:${userId}:${randomUUID()}`,
    );

    await this.repo.redactAndDeleteAccount(userId, {
      email: redactedEmailFor(userId),
      displayName: REDACTED_DISPLAY_NAME,
      passwordHash: unusablePasswordHash,
      deletedAt: new Date(),
    });
  }
}
