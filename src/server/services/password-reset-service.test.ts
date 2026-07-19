import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidResetTokenError,
  PasswordResetService,
  type AuditLogRecord,
  type PasswordHasher,
  type PasswordResetRepository,
} from "./password-reset-service";

interface StoredToken {
  id: string;
  userId: string;
  hashedToken: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * Lightweight in-memory fake implementing the `PasswordResetRepository`
 * port, so these tests exercise real `PasswordResetService` logic without
 * a live Postgres/Prisma connection — same pattern as
 * `InMemoryInterestRepository` in interest-service.test.ts.
 */
interface QueuedNotification {
  recipientId: string;
  type: "password_reset";
  payload: Record<string, unknown>;
}

class InMemoryPasswordResetRepository implements PasswordResetRepository {
  readonly users = new Map<string, { id: string; email: string; displayName: string }>();
  readonly tokens: StoredToken[] = [];
  readonly passwordHashes = new Map<string, string>();
  readonly auditLogs: AuditLogRecord[] = [];
  readonly queuedNotifications: QueuedNotification[] = [];
  private nextTokenId = 1;

  seedUser(email: string, id: string, displayName = "Ana"): void {
    this.users.set(email, { id, email, displayName });
  }

  async findUserByEmail(
    email: string,
  ): Promise<{ id: string; email: string; displayName: string } | null> {
    return this.users.get(email) ?? null;
  }

  async createToken(data: {
    userId: string;
    hashedToken: string;
    expiresAt: Date;
  }): Promise<void> {
    this.tokens.push({
      id: `token-${this.nextTokenId++}`,
      userId: data.userId,
      hashedToken: data.hashedToken,
      expiresAt: data.expiresAt,
      usedAt: null,
    });
  }

  async findTokenByHash(
    hashedToken: string,
  ): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
    const token = this.tokens.find((t) => t.hashedToken === hashedToken);
    return token ? { ...token } : null;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    this.passwordHashes.set(userId, passwordHash);
  }

  async markTokenUsed(tokenId: string, usedAt: Date): Promise<void> {
    const token = this.tokens.find((t) => t.id === tokenId);
    if (token) {
      token.usedAt = usedAt;
    }
  }

  async addAuditLog(log: AuditLogRecord): Promise<void> {
    this.auditLogs.push(log);
  }

  async queueEmailNotification(input: QueuedNotification): Promise<void> {
    this.queuedNotifications.push(input);
  }
}

/** Fake password hasher — deterministic, no real argon2id cost in tests. */
class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }
}

describe("PasswordResetService", () => {
  let repo: InMemoryPasswordResetRepository;
  let hasher: FakePasswordHasher;
  let service: PasswordResetService;

  beforeEach(() => {
    repo = new InMemoryPasswordResetRepository();
    hasher = new FakePasswordHasher();
    service = new PasswordResetService(repo, hasher);
  });

  describe("requestReset", () => {
    it("issues a token and writes an audit log for a known email", async () => {
      repo.seedUser("ana@example.com", "user-1");

      const token = await service.requestReset("ana@example.com");

      expect(token).not.toBeNull();
      expect(typeof token).toBe("string");
      expect(repo.tokens).toHaveLength(1);
      expect(repo.tokens[0]!.userId).toBe("user-1");
      expect(repo.auditLogs).toEqual([
        expect.objectContaining({
          actorId: "user-1",
          action: "password.reset_request",
          targetType: "User",
          targetId: "user-1",
        }),
      ]);
    });

    it("resolves silently with null for an unknown email — no token, no audit log", async () => {
      const token = await service.requestReset("unknown@example.com");

      expect(token).toBeNull();
      expect(repo.tokens).toHaveLength(0);
      expect(repo.auditLogs).toHaveLength(0);
      expect(repo.queuedNotifications).toHaveLength(0);
    });

    it("queues a password_reset email notification with the correct payload shape for a known email", async () => {
      repo.seedUser("ana@example.com", "user-1", "Ana Rios");

      await service.requestReset("ana@example.com");

      expect(repo.queuedNotifications).toHaveLength(1);
      const notification = repo.queuedNotifications[0]!;
      expect(notification.recipientId).toBe("user-1");
      expect(notification.type).toBe("password_reset");
      expect(notification.payload.displayName).toBe("Ana Rios");
      expect(typeof notification.payload.resetUrl).toBe("string");
      expect(notification.payload.resetUrl as string).toContain("/reset-password?token=");
    });
  });

  describe("consumeReset", () => {
    it("updates the password and marks the token used on a valid token", async () => {
      repo.seedUser("ana@example.com", "user-1");
      const token = await service.requestReset("ana@example.com");

      await service.consumeReset(token!, "new-password-123");

      expect(repo.passwordHashes.get("user-1")).toBe("hashed:new-password-123");
      expect(repo.tokens[0]!.usedAt).not.toBeNull();
      expect(repo.auditLogs).toContainEqual(
        expect.objectContaining({
          actorId: "user-1",
          action: "password.reset_consume",
          targetType: "User",
          targetId: "user-1",
        }),
      );
    });

    it("throws InvalidResetTokenError for an expired token", async () => {
      repo.seedUser("ana@example.com", "user-1");
      const token = await service.requestReset("ana@example.com");
      // Force the freshly issued token to already be expired — we can't
      // seed an expired row directly with a known raw token, since only
      // the service knows how to derive `hashedToken` from a raw value.
      repo.tokens[0]!.expiresAt = new Date(Date.now() - 1000);

      await expect(service.consumeReset(token!, "new-password")).rejects.toThrow(
        InvalidResetTokenError,
      );
    });

    it("throws InvalidResetTokenError for an already-used token", async () => {
      repo.seedUser("ana@example.com", "user-1");
      const token = await service.requestReset("ana@example.com");
      repo.tokens[0]!.usedAt = new Date();

      await expect(service.consumeReset(token!, "new-password")).rejects.toThrow(
        InvalidResetTokenError,
      );
    });

    it("throws InvalidResetTokenError when the same token is consumed twice", async () => {
      repo.seedUser("ana@example.com", "user-1");
      const token = await service.requestReset("ana@example.com");

      await service.consumeReset(token!, "first-new-password");

      await expect(service.consumeReset(token!, "second-new-password")).rejects.toThrow(
        InvalidResetTokenError,
      );
    });

    it("throws InvalidResetTokenError for a completely bogus token", async () => {
      await expect(
        service.consumeReset("this-token-does-not-exist", "new-password"),
      ).rejects.toThrow(InvalidResetTokenError);
    });
  });
});
