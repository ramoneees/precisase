import { describe, expect, it } from "vitest";
import { PasswordService } from "./password-service";

/**
 * PasswordService wraps argon2id hashing (docs/ARCHITECTURE.md §4.4, §7.1 —
 * OWASP-recommended password hash). These tests exercise the real
 * implementation directly (no fakes needed — it has no external
 * dependencies beyond the argon2 bindings).
 */
describe("PasswordService", () => {
  const service = new PasswordService();

  it("produces a hash that verify() accepts for the correct password", async () => {
    const hash = await service.hash("correct horse battery staple");

    await expect(
      service.verify("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await service.hash("correct horse battery staple");

    await expect(service.verify("wrong password", hash)).resolves.toBe(
      false,
    );
  });

  it("produces a different hash each time for the same password (random salt)", async () => {
    const first = await service.hash("correct horse battery staple");
    const second = await service.hash("correct horse battery staple");

    expect(first).not.toBe(second);
  });

  it("encodes the argon2id algorithm identifier in the hash (OWASP-recommended, §4.4)", async () => {
    const hash = await service.hash("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
  });
});
