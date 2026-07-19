// @vitest-environment node
//
// libsodium-wrappers' internal type checks (`instanceof Uint8Array`) break
// under jsdom because jsdom's realm provides its own Uint8Array global,
// distinct from Node's (see contact-encryption.test.ts). `MfaService`
// encrypts/decrypts the TOTP secret via that module, so this suite also
// needs the `node` environment instead of the project-wide `jsdom` default.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidPasswordError,
  InvalidTotpError,
  MfaNotEnrolledError,
  MfaService,
  type AuditLogRecord,
  type MfaRepository,
  type MfaState,
} from "./mfa-service";

/**
 * Lightweight in-memory fake implementing the `MfaRepository` port,
 * following the same "port + in-memory fake" pattern used by
 * PostService/InterestService/AuthService (see post-service.test.ts,
 * interest-service.test.ts, auth-service.test.ts) — no live database
 * needed.
 */
class InMemoryMfaRepository implements MfaRepository {
  private readonly states = new Map<string, MfaState>();
  private readonly passwordHashes = new Map<string, string>();
  readonly auditLogs: AuditLogRecord[] = [];

  seed(userId: string, state: MfaState, passwordHash: string): void {
    this.states.set(userId, state);
    this.passwordHashes.set(userId, passwordHash);
  }

  async getMfaState(userId: string): Promise<MfaState | null> {
    return this.states.get(userId) ?? null;
  }

  async savePendingSecret(userId: string, encryptedSecretBase64: string): Promise<void> {
    this.states.set(userId, { mfaSecret: encryptedSecretBase64, mfaEnabledAt: null });
  }

  async enableMfa(userId: string, enabledAt: Date): Promise<void> {
    const current = this.states.get(userId);
    this.states.set(userId, { mfaSecret: current?.mfaSecret ?? null, mfaEnabledAt: enabledAt });
  }

  async disableMfa(userId: string): Promise<void> {
    this.states.set(userId, { mfaSecret: null, mfaEnabledAt: null });
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    return this.passwordHashes.get(userId) ?? null;
  }

  async addAuditLog(log: AuditLogRecord): Promise<void> {
    this.auditLogs.push(log);
  }
}

/** Fake password verifier — avoids depending on real argon2 hashing here. */
class FakePasswordVerifier {
  async verify(password: string, passwordHash: string): Promise<boolean> {
    return `hashed:${password}` === passwordHash;
  }
}

const USER_ID = "user-1";
const USER_EMAIL = "ana@example.com";

describe("MfaService (docs/ARCHITECTURE.md §7.1/§7.2)", () => {
  const originalKey = process.env.CONTACT_ENCRYPTION_KEY;

  beforeEach(async () => {
    // A fixed, valid 32-byte key so tests are deterministic across runs.
    process.env.CONTACT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { __resetContactEncryptionKeyCacheForTests } = await import("../crypto/contact-encryption");
    __resetContactEncryptionKeyCacheForTests();
  });

  afterAll(() => {
    process.env.CONTACT_ENCRYPTION_KEY = originalKey;
  });

  function makeService() {
    const repo = new InMemoryMfaRepository();
    const passwordService = new FakePasswordVerifier();
    repo.seed(USER_ID, { mfaSecret: null, mfaEnabledAt: null }, "hashed:correct-password");
    const service = new MfaService(repo, passwordService);
    return { repo, passwordService, service };
  }

  it("generateSecret returns a secret and a valid otpauth:// URL containing the issuer and account email", async () => {
    const { service } = makeService();

    const { secret, otpauthUrl } = await service.generateSecret(USER_EMAIL);

    expect(secret.length).toBeGreaterThan(0);
    expect(otpauthUrl.startsWith("otpauth://totp/")).toBe(true);
    expect(otpauthUrl).toContain(encodeURIComponent("Precisa-se"));
    expect(otpauthUrl).toContain(encodeURIComponent(USER_EMAIL));
    expect(otpauthUrl).toContain(`secret=${secret}`);
  });

  it("verifyTotp returns true for a code generated from the same secret, false for a wrong code", async () => {
    const { service } = makeService();
    const { secret } = await service.generateSecret(USER_EMAIL);

    // Generate a real, currently-valid code from the same secret to verify against.
    const { generateTOTP } = await import("@epic-web/totp");
    const { otp } = await generateTOTP({ secret });

    await expect(service.verifyTotp(otp, secret)).resolves.toBe(true);
    await expect(service.verifyTotp("000000", secret)).resolves.toBe(false);
  });

  it("enroll stores an encrypted secret without enabling MFA", async () => {
    const { repo, service } = makeService();

    const { secret } = await service.enroll(USER_ID, USER_EMAIL);

    const state = await repo.getMfaState(USER_ID);
    expect(state?.mfaEnabledAt).toBeNull();
    expect(state?.mfaSecret).not.toBeNull();
    expect(state?.mfaSecret).not.toBe(secret); // stored value is encrypted, not plaintext
  });

  it("enableMfa with the correct just-generated code succeeds, sets mfaEnabledAt, and writes an mfa.enable audit log", async () => {
    const { repo, service } = makeService();
    const { secret } = await service.enroll(USER_ID, USER_EMAIL);

    const { generateTOTP } = await import("@epic-web/totp");
    const { otp } = await generateTOTP({ secret });

    await service.enableMfa(USER_ID, otp);

    const state = await repo.getMfaState(USER_ID);
    expect(state?.mfaEnabledAt).toBeInstanceOf(Date);
    expect(repo.auditLogs).toContainEqual({
      actorId: USER_ID,
      action: "mfa.enable",
      targetType: "User",
      targetId: USER_ID,
    });
  });

  it("enableMfa with a wrong code throws InvalidTotpError and leaves mfaEnabledAt null", async () => {
    const { repo, service } = makeService();
    await service.enroll(USER_ID, USER_EMAIL);

    await expect(service.enableMfa(USER_ID, "000000")).rejects.toThrow(InvalidTotpError);

    const state = await repo.getMfaState(USER_ID);
    expect(state?.mfaEnabledAt).toBeNull();
  });

  it("enableMfa without a prior enroll throws MfaNotEnrolledError", async () => {
    const { service } = makeService();

    await expect(service.enableMfa(USER_ID, "000000")).rejects.toThrow(MfaNotEnrolledError);
  });

  it("disableMfa with the correct password succeeds, clears both fields, and writes an mfa.disable audit log", async () => {
    const { repo, service } = makeService();
    const { secret } = await service.enroll(USER_ID, USER_EMAIL);
    const { generateTOTP } = await import("@epic-web/totp");
    const { otp } = await generateTOTP({ secret });
    await service.enableMfa(USER_ID, otp);

    await service.disableMfa(USER_ID, "correct-password");

    const state = await repo.getMfaState(USER_ID);
    expect(state?.mfaSecret).toBeNull();
    expect(state?.mfaEnabledAt).toBeNull();
    expect(repo.auditLogs).toContainEqual({
      actorId: USER_ID,
      action: "mfa.disable",
      targetType: "User",
      targetId: USER_ID,
    });
  });

  it("disableMfa with the wrong password throws InvalidPasswordError and leaves fields unchanged", async () => {
    const { repo, service } = makeService();
    const { secret } = await service.enroll(USER_ID, USER_EMAIL);
    const { generateTOTP } = await import("@epic-web/totp");
    const { otp } = await generateTOTP({ secret });
    await service.enableMfa(USER_ID, otp);

    await expect(service.disableMfa(USER_ID, "wrong-password")).rejects.toThrow(InvalidPasswordError);

    const state = await repo.getMfaState(USER_ID);
    expect(state?.mfaEnabledAt).toBeInstanceOf(Date);
    expect(state?.mfaSecret).not.toBeNull();
  });
});
