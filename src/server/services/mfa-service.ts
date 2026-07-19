/**
 * MfaService — TOTP-based multi-factor authentication (docs/ARCHITECTURE.md
 * §7.1/§7.2, plan `mvp-launch-readiness.md` T12). Wraps `@epic-web/totp`
 * (RFC 6238 TOTP over the HOTP algorithm), using the library's default
 * config (SHA-1, 6 digits, 30s period — Google Authenticator/1Password
 * compatible) for both enrollment and verification, so no extra config
 * needs to be persisted alongside the secret.
 *
 * Enrollment is a two-step flow, mirroring the "pending" pattern used
 * elsewhere in the codebase:
 *   1. `enroll` generates a fresh secret, encrypts it, and persists it via
 *      `repo.savePendingSecret` WITHOUT setting `mfaEnabledAt` — the user
 *      hasn't yet proven they can generate a valid code from it.
 *   2. `enableMfa` verifies a caller-supplied code against the pending
 *      secret and, on success, sets `mfaEnabledAt` (MFA becomes active).
 *
 * The TOTP secret is encrypted at rest with the same app-layer encryption
 * used for `Post.contact_value` (`src/server/crypto/contact-encryption.ts`),
 * base64-encoded before storage because `User.mfaSecret` is a text column,
 * not `bytea`.
 *
 * This file only threads the enroll/enable/disable primitives through — the
 * two-call sign-in challenge flow (checking `mfaEnabledAt` at login time and
 * prompting for a code) is a later wave's job (T16).
 */

import { generateTOTP, getTOTPAuthUri, verifyTOTP } from "@epic-web/totp";
import { decrypt, encrypt } from "@/server/crypto/contact-encryption";

/** Issuer name shown in authenticator apps (Google Authenticator, 1Password, …). */
const ISSUER = "Precisa-se";

export interface MfaState {
  mfaSecret: string | null;
  mfaEnabledAt: Date | null;
}

export interface AuditLogRecord {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface MfaRepository {
  getMfaState(userId: string): Promise<MfaState | null>;
  /** Persists the (encrypted, base64) secret WITHOUT setting `mfaEnabledAt` — "pending enrollment" state. */
  savePendingSecret(userId: string, encryptedSecretBase64: string): Promise<void>;
  /** Sets `mfaEnabledAt`; the secret itself was already saved by `savePendingSecret`. */
  enableMfa(userId: string, enabledAt: Date): Promise<void>;
  /** Clears both `mfaSecret` and `mfaEnabledAt` back to null. */
  disableMfa(userId: string): Promise<void>;
  getPasswordHash(userId: string): Promise<string | null>;
  addAuditLog(log: AuditLogRecord): Promise<void>;
}

export interface MfaPasswordVerifier {
  verify(password: string, passwordHash: string): Promise<boolean>;
}

export class MfaNotEnrolledError extends Error {
  constructor(message = "MFA has not been enrolled for this user yet; call enroll() first.") {
    super(message);
    this.name = "MfaNotEnrolledError";
  }
}

export class InvalidTotpError extends Error {
  constructor(message = "The provided TOTP code is invalid or has expired.") {
    super(message);
    this.name = "InvalidTotpError";
  }
}

export class InvalidPasswordError extends Error {
  constructor(message = "The provided password is incorrect.") {
    super(message);
    this.name = "InvalidPasswordError";
  }
}

export class UserNotFoundError extends Error {
  constructor(message = "User not found.") {
    super(message);
    this.name = "UserNotFoundError";
  }
}

export class MfaService {
  constructor(
    private readonly repo: MfaRepository,
    private readonly passwordService: MfaPasswordVerifier,
  ) {}

  /**
   * Generates a fresh TOTP secret plus the `otpauth://` URI an authenticator
   * app (or QR-code renderer, in a later wave) consumes to add the account.
   */
  async generateSecret(accountEmail: string): Promise<{ secret: string; otpauthUrl: string }> {
    const { secret, period, digits, algorithm } = await generateTOTP();
    const otpauthUrl = getTOTPAuthUri({
      period,
      digits,
      algorithm,
      secret,
      accountName: accountEmail,
      issuer: ISSUER,
    });
    return { secret, otpauthUrl };
  }

  /** Verifies a 6-digit code against a (plaintext) TOTP secret. */
  async verifyTotp(token: string, secret: string): Promise<boolean> {
    const result = await verifyTOTP({ otp: token, secret });
    return result !== null;
  }

  /**
   * Starts enrollment: generates a fresh secret, encrypts it, and stores it
   * in "pending" state (no `mfaEnabledAt` yet). Returns the plaintext
   * secret + otpauth URL so the caller can render a QR code; the plaintext
   * secret is never persisted.
   */
  async enroll(userId: string, accountEmail: string): Promise<{ secret: string; otpauthUrl: string }> {
    const { secret, otpauthUrl } = await this.generateSecret(accountEmail);
    const encryptedSecret = await encrypt(secret);
    await this.repo.savePendingSecret(userId, encryptedSecret.toString("base64"));
    return { secret, otpauthUrl };
  }

  /**
   * Completes enrollment: verifies `token` against the pending secret and,
   * on success, marks MFA as enabled.
   */
  async enableMfa(userId: string, token: string): Promise<void> {
    const state = await this.repo.getMfaState(userId);
    if (!state || !state.mfaSecret) {
      throw new MfaNotEnrolledError();
    }

    const secret = await decrypt(Buffer.from(state.mfaSecret, "base64"));
    const isValid = await this.verifyTotp(token, secret);
    if (!isValid) {
      throw new InvalidTotpError();
    }

    await this.repo.enableMfa(userId, new Date());
    await this.repo.addAuditLog({
      actorId: userId,
      action: "mfa.enable",
      targetType: "User",
      targetId: userId,
    });
  }

  /** Disables MFA after re-verifying the user's password. */
  async disableMfa(userId: string, password: string): Promise<void> {
    const passwordHash = await this.repo.getPasswordHash(userId);
    if (!passwordHash) {
      throw new UserNotFoundError();
    }

    const passwordMatches = await this.passwordService.verify(password, passwordHash);
    if (!passwordMatches) {
      throw new InvalidPasswordError();
    }

    await this.repo.disableMfa(userId);
    await this.repo.addAuditLog({
      actorId: userId,
      action: "mfa.disable",
      targetType: "User",
      targetId: userId,
    });
  }
}
