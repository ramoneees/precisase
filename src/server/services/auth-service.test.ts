import { describe, expect, it } from "vitest";
import {
  verifyCredentials,
  type AuthUserRecord,
  type AuthUserRepository,
  type PasswordVerifier,
} from "./auth-service";

/**
 * Lightweight in-memory fake implementing the `AuthUserRepository` port,
 * following the same "port + in-memory fake" pattern already used by
 * PostService/InterestService (see post-service.test.ts,
 * interest-service.test.ts) — no live database needed.
 */
class InMemoryAuthUserRepository implements AuthUserRepository {
  private readonly usersByEmail = new Map<string, AuthUserRecord>();

  seed(user: AuthUserRecord): void {
    this.usersByEmail.set(user.email, user);
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }
}

/** Fake password verifier — avoids depending on real argon2 hashing here. */
class FakePasswordVerifier implements PasswordVerifier {
  async verify(password: string, passwordHash: string): Promise<boolean> {
    return `hashed:${password}` === passwordHash;
  }
}

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "user-1",
    email: "ana@example.com",
    passwordHash: "hashed:correct-password",
    displayName: "Ana",
    role: "user",
    country: null,
    timeZone: null,
    currency: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("verifyCredentials (docs/ARCHITECTURE.md §4.4)", () => {
  it("returns null for an unknown email", async () => {
    const repo = new InMemoryAuthUserRepository();
    const passwordService = new FakePasswordVerifier();

    const result = await verifyCredentials(
      { email: "unknown@example.com", password: "correct-password" },
      repo,
      passwordService,
    );

    expect(result).toBeNull();
  });

  it("returns null for an incorrect password", async () => {
    const repo = new InMemoryAuthUserRepository();
    repo.seed(makeUser());
    const passwordService = new FakePasswordVerifier();

    const result = await verifyCredentials(
      { email: "ana@example.com", password: "wrong-password" },
      repo,
      passwordService,
    );

    expect(result).toBeNull();
  });

  it("returns the authenticated user (without the password hash) for correct credentials", async () => {
    const repo = new InMemoryAuthUserRepository();
    repo.seed(makeUser({ role: "moderator" }));
    const passwordService = new FakePasswordVerifier();

    const result = await verifyCredentials(
      { email: "ana@example.com", password: "correct-password" },
      repo,
      passwordService,
    );

    expect(result).toEqual({
      id: "user-1",
      email: "ana@example.com",
      displayName: "Ana",
      role: "moderator",
      country: null,
      timeZone: null,
      currency: null,
    });
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("rejects a soft-deleted user even with correct credentials", async () => {
    const repo = new InMemoryAuthUserRepository();
    repo.seed(makeUser({ deletedAt: new Date("2026-01-01T00:00:00Z") }));
    const passwordService = new FakePasswordVerifier();

    const result = await verifyCredentials(
      { email: "ana@example.com", password: "correct-password" },
      repo,
      passwordService,
    );

    expect(result).toBeNull();
  });
});
