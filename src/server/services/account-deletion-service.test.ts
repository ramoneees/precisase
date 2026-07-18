import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountDeletionService,
  InvalidPasswordError,
  REDACTED_DISPLAY_NAME,
  UserNotFoundError,
  redactedEmailFor,
  type AccountDeletionRepository,
  type AccountDeletionUserRecord,
  type AccountRedaction,
  type PasswordHasher,
  type PasswordVerifier,
} from "./account-deletion-service";

/**
 * Lightweight in-memory fake implementing the `AccountDeletionRepository`
 * port, following the same "port + in-memory fake" pattern already used by
 * PostService/InterestService/verifyCredentials (see post-service.test.ts,
 * interest-service.test.ts, auth-service.test.ts). Unlike those fakes,
 * `redactAndDeleteAccount` here actually performs the redaction against its
 * in-memory store (rather than just recording the call), so the tests can
 * assert the exact post-redaction field values the Prisma-backed
 * implementation is expected to persist.
 */
class InMemoryAccountDeletionRepository implements AccountDeletionRepository {
  readonly users = new Map<string, AccountDeletionUserRecord & { deletedAt: Date | null }>();
  /** Tracked separately since `AccountDeletionUserRecord` (the read port)
   * deliberately omits `displayName` — the service never needs to read it,
   * only to write a redacted replacement. */
  readonly displayNameByUserId = new Map<string, string>();
  readonly consentWithdrawnAtByUserId = new Map<string, Date>();
  readonly interestsByUserId = new Map<string, string[]>();
  readonly auditLogs: Array<{ actorId: string; action: string; targetType: string; targetId: string }> = [];
  redactAndDeleteAccountCalls = 0;

  seed(user: AccountDeletionUserRecord, displayName = "Ana Silva"): void {
    this.users.set(user.id, { ...user });
    this.displayNameByUserId.set(user.id, displayName);
  }

  seedInterests(userId: string, interestIds: string[]): void {
    this.interestsByUserId.set(userId, interestIds);
  }

  async findUserById(userId: string): Promise<AccountDeletionUserRecord | null> {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  async redactAndDeleteAccount(userId: string, redaction: AccountRedaction): Promise<void> {
    this.redactAndDeleteAccountCalls += 1;

    const existing = this.users.get(userId);
    if (!existing) {
      throw new Error(`fake repository: user ${userId} not found`);
    }

    this.users.set(userId, {
      ...existing,
      email: redaction.email,
      passwordHash: redaction.passwordHash,
      deletedAt: redaction.deletedAt,
    });
    this.displayNameByUserId.set(userId, redaction.displayName);

    this.consentWithdrawnAtByUserId.set(userId, redaction.deletedAt);
    this.interestsByUserId.set(userId, []);
    this.auditLogs.push({
      actorId: userId,
      action: "user.gdpr_delete",
      targetType: "User",
      targetId: userId,
    });
  }
}

/** Fake password verifier/hasher — avoids depending on real argon2 hashing. */
class FakePasswordService implements PasswordVerifier, PasswordHasher {
  async verify(password: string, passwordHash: string): Promise<boolean> {
    return `hashed:${password}` === passwordHash;
  }

  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }
}

function makeUser(overrides: Partial<AccountDeletionUserRecord> = {}): AccountDeletionUserRecord {
  return {
    id: "user-1",
    email: "ana@example.com",
    passwordHash: "hashed:correct-password",
    deletedAt: null,
    ...overrides,
  };
}

describe("AccountDeletionService.deleteOwnAccount (NFR08, docs/ARCHITECTURE.md §6.4/§7.5, Q8/Q9)", () => {
  let repo: InMemoryAccountDeletionRepository;
  let passwordService: FakePasswordService;
  let service: AccountDeletionService;

  beforeEach(() => {
    repo = new InMemoryAccountDeletionRepository();
    passwordService = new FakePasswordService();
    service = new AccountDeletionService(repo, passwordService, passwordService);
  });

  describe("wrong password", () => {
    it("rejects deletion and leaves the account untouched", async () => {
      repo.seed(makeUser());
      repo.seedInterests("user-1", ["interest-1", "interest-2"]);

      await expect(
        service.deleteOwnAccount({ userId: "user-1", password: "wrong-password" }),
      ).rejects.toThrow(InvalidPasswordError);

      const user = await repo.findUserById("user-1");
      expect(user).toEqual(makeUser());
      expect(repo.redactAndDeleteAccountCalls).toBe(0);
      expect(repo.consentWithdrawnAtByUserId.has("user-1")).toBe(false);
      expect(repo.interestsByUserId.get("user-1")).toEqual(["interest-1", "interest-2"]);
      expect(repo.auditLogs).toHaveLength(0);
    });
  });

  describe("unknown or already-deleted account", () => {
    it("throws UserNotFoundError for a user id that does not exist", async () => {
      await expect(
        service.deleteOwnAccount({ userId: "missing", password: "anything" }),
      ).rejects.toThrow(UserNotFoundError);

      expect(repo.redactAndDeleteAccountCalls).toBe(0);
    });

    it("throws UserNotFoundError for an already soft-deleted account, never re-verifying the password", async () => {
      repo.seed(makeUser({ deletedAt: new Date("2026-01-01T00:00:00Z") }));

      await expect(
        service.deleteOwnAccount({ userId: "user-1", password: "correct-password" }),
      ).rejects.toThrow(UserNotFoundError);

      expect(repo.redactAndDeleteAccountCalls).toBe(0);
    });
  });

  describe("correct password", () => {
    it("redacts email, displayName, and passwordHash, and sets deletedAt", async () => {
      repo.seed(makeUser(), "Ana Silva");

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(repo.redactAndDeleteAccountCalls).toBe(1);
      const user = await repo.findUserById("user-1");
      expect(user?.email).toBe(redactedEmailFor("user-1"));
      expect(user?.email).toMatch(/^deleted-user-1@precisase\.invalid$/);
      // Still a syntactically distinct value from the original — never the
      // real password hash left in place.
      expect(user?.passwordHash).not.toBe("hashed:correct-password");
      expect(user?.deletedAt).toBeInstanceOf(Date);
      expect(repo.displayNameByUserId.get("user-1")).toBe(REDACTED_DISPLAY_NAME);
      expect(repo.displayNameByUserId.get("user-1")).not.toBe("Ana Silva");
    });

    it("produces a passwordHash that can never again verify the user's real password", async () => {
      repo.seed(makeUser());

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      const user = await repo.findUserById("user-1");
      await expect(
        passwordService.verify("correct-password", user!.passwordHash),
      ).resolves.toBe(false);
    });

    it("withdraws consent for the user", async () => {
      repo.seed(makeUser());

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(repo.consentWithdrawnAtByUserId.get("user-1")).toBeInstanceOf(Date);
    });

    it("clears the user's Interest rows", async () => {
      repo.seed(makeUser());
      repo.seedInterests("user-1", ["interest-1", "interest-2"]);

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(repo.interestsByUserId.get("user-1")).toEqual([]);
    });

    it("writes a single user.gdpr_delete AuditLog row", async () => {
      repo.seed(makeUser());

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(repo.auditLogs).toEqual([
        {
          actorId: "user-1",
          action: "user.gdpr_delete",
          targetType: "User",
          targetId: "user-1",
        },
      ]);
    });

    it("uses the locale-neutral REDACTED_DISPLAY_NAME placeholder", async () => {
      repo.seed(makeUser());

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(REDACTED_DISPLAY_NAME).toBe("Utilizador removido");
    });

    it("only ever calls redactAndDeleteAccount once per request, atomically", async () => {
      repo.seed(makeUser());

      await service.deleteOwnAccount({ userId: "user-1", password: "correct-password" });

      expect(repo.redactAndDeleteAccountCalls).toBe(1);
    });
  });
});
