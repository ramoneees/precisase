/**
 * PasswordResetService — implements the "forgot password" flow described
 * in docs/ARCHITECTURE.md: a user requests a reset link by email, we mint
 * a single-use token, and later they redeem that token for a new password.
 *
 * Like `PostService`/`InterestService`/`NotificationDispatchService`, this
 * module is decoupled from Prisma: it depends on the narrow
 * `PasswordResetRepository` port below, so it is unit-testable with an
 * in-memory fake instead of a live database (see
 * password-reset-service.test.ts). A Prisma-backed implementation of
 * `PasswordResetRepository` lives at
 * `src/server/repositories/prisma-password-reset-repository.ts`.
 */

import { randomBytes, createHash } from "node:crypto";

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention — mirrors
// PostService/InterestService: no import of app-layer types that may not
// exist yet).
// ---------------------------------------------------------------------

export interface AuditLogRecord {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Data-access port consumed by `PasswordResetService`. Keeping this narrow
 * (rather than depending on the full Prisma client, or reusing
 * `AuthUserRepository`) is what makes the reset flow unit-testable without
 * a database — same pattern as `PostRepository`/`InterestRepository`. This
 * port intentionally owns its own methods rather than cross-importing
 * `AuthUserRepository`: each service owns its own narrow port onto exactly
 * the data it needs.
 */
export interface PasswordResetRepository {
  /**
   * Email/displayName are needed (not just id) so `requestReset` can queue
   * the reset email notification with a resolved display name.
   */
  findUserByEmail(email: string): Promise<{ id: string; email: string; displayName: string } | null>;
  createToken(data: { userId: string; hashedToken: string; expiresAt: Date }): Promise<void>;
  findTokenByHash(
    hashedToken: string,
  ): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  markTokenUsed(tokenId: string, usedAt: Date): Promise<void>;
  addAuditLog(log: AuditLogRecord): Promise<void>;
  /**
   * Queues the `password_reset` email notification for the notification
   * worker to pick up and send — same "insert a `Notification` row, worker
   * dispatches it later" pattern `PostRepository.addNotification` uses.
   */
  queueEmailNotification(input: {
    recipientId: string;
    type: "password_reset";
    payload: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Password-hashing port consumed by `consumeReset`. `PasswordService`
 * (password-service.ts) satisfies this interface; tests can supply a fake
 * instead of hashing real argon2id hashes. Injected (rather than importing
 * the concrete class) so the service stays unit-testable without paying
 * for real argon2id hashing in every test — same DI pattern as
 * `NotificationDispatchService`'s `Mailer`/`NotificationEmailBuilder`.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

/** Reset tokens expire one hour after being issued. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Thrown by `consumeReset` when the supplied token doesn't exist, has
 * already been used, or has expired. A single error type deliberately
 * covers all three cases — mirroring `verifyCredentials`'s
 * indistinguishable-failure pattern in auth-service.ts — so a caller/UI
 * can never learn from the error shape alone whether a token existed at
 * all, was reused, or simply expired.
 */
export class InvalidResetTokenError extends Error {
  constructor() {
    super("This password reset link is invalid or has expired.");
    this.name = "InvalidResetTokenError";
  }
}

export class PasswordResetService {
  constructor(
    private readonly repo: PasswordResetRepository,
    private readonly passwordService: PasswordHasher,
  ) {}

  /**
   * Looks up `email` and, if a matching user exists, mints a single-use
   * reset token (1 hour TTL) and returns the raw (unhashed) token so the
   * caller can build a reset URL for the email.
   *
   * If no user matches `email`, this resolves silently — no token is
   * created, no audit log is written, and no error is thrown — returning
   * `null` instead. This is deliberate anti-email-enumeration behavior
   * (matches `verifyCredentials`'s indistinguishable-failure pattern): the
   * HTTP-facing caller must present the same UI either way ("check your
   * email if that address is registered"), it just has nothing to send
   * when this returns `null`.
   */
  async requestReset(email: string): Promise<string | null> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      return null;
    }

    const rawToken = randomBytes(32).toString("base64url");
    const hashedToken = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.repo.createToken({ userId: user.id, hashedToken, expiresAt });

    await this.repo.queueEmailNotification({
      recipientId: user.id,
      type: "password_reset",
      payload: { displayName: user.displayName, resetUrl: buildResetUrl(rawToken) },
    });

    await this.repo.addAuditLog({
      actorId: user.id,
      action: "password.reset_request",
      targetType: "User",
      targetId: user.id,
    });

    return rawToken;
  }

  /**
   * Redeems a raw reset `token` for a `newPassword`. Throws
   * `InvalidResetTokenError` if the token doesn't exist, was already used,
   * or has expired — see the class doc for why these three cases aren't
   * distinguished. On success, updates the user's password hash, marks the
   * token used, and writes an audit log entry.
   */
  async consumeReset(token: string, newPassword: string): Promise<void> {
    const hashedToken = hashResetToken(token);
    const record = await this.repo.findTokenByHash(hashedToken);

    if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
      throw new InvalidResetTokenError();
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.repo.updateUserPassword(record.userId, passwordHash);
    await this.repo.markTokenUsed(record.id, new Date());

    await this.repo.addAuditLog({
      actorId: record.userId,
      action: "password.reset_consume",
      targetType: "User",
      targetId: record.userId,
    });
  }
}

/**
 * Deliberately deterministic SHA-256 (NOT `PasswordService.hash`/argon2id).
 * argon2id embeds a fresh random salt on every call, so hashing the same
 * raw token twice produces different output — that's exactly right for
 * passwords (rainbow-table resistance) but wrong here: `hashedToken` is
 * looked up with an exact-match `findUnique`, so we need the same raw
 * token to hash to the same value every time or an incoming reset link
 * could never be found again. SHA-256 without a salt is the standard,
 * correct approach for high-entropy random tokens (a 32-byte
 * `crypto.randomBytes` value has no guessable structure for a rainbow
 * table to exploit) — unlike a user-chosen password, which needs a slow,
 * salted KDF.
 */
function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Builds the reset link embedded in the password_reset email. Mirrors
 * `postLink()` in email-templates.ts: locale-agnostic (no locale segment —
 * this app runs with `localePrefix: "never"`, so URLs never carry a locale
 * prefix), reading `APP_URL` with a localhost fallback for dev.
 */
function buildResetUrl(token: string): string {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${appUrl}/reset-password?token=${token}`;
}
