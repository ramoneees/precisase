// @vitest-environment node
//
// libsodium-wrappers' internal type checks (`instanceof Uint8Array`) break
// under jsdom because jsdom's realm provides its own Uint8Array global,
// distinct from Node's. This module is pure backend crypto with no DOM
// dependency, so it runs under vitest's `node` environment instead of the
// project-wide `jsdom` default (see vitest.config.ts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Contact encryption (ARCHITECTURE.md §7.4) — libsodium crypto_secretbox,
 * app-layer encryption of Post.contact_value so a DB dump alone never
 * leaks contact details. Key comes from CONTACT_ENCRYPTION_KEY (base64,
 * must decode to exactly 32 bytes).
 */
describe("contact-encryption", () => {
  const originalKey = process.env.CONTACT_ENCRYPTION_KEY;

  beforeEach(async () => {
    // A fixed, valid 32-byte key so tests are deterministic across runs.
    process.env.CONTACT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { __resetContactEncryptionKeyCacheForTests } = await import("./contact-encryption");
    __resetContactEncryptionKeyCacheForTests();
  });

  afterAll(() => {
    process.env.CONTACT_ENCRYPTION_KEY = originalKey;
  });

  it("round-trips: decrypt(encrypt(plaintext)) === plaintext", async () => {
    const { encrypt, decrypt } = await import("./contact-encryption");

    const plaintext = "+351 912 345 678";
    const ciphertext = await encrypt(plaintext);

    expect(Buffer.isBuffer(ciphertext)).toBe(true);
    expect(await decrypt(ciphertext)).toBe(plaintext);
  });

  it("produces a different ciphertext each time for the same plaintext (nonce)", async () => {
    const { encrypt } = await import("./contact-encryption");

    const a = await encrypt("someone@example.com");
    const b = await encrypt("someone@example.com");

    expect(a.equals(b)).toBe(false);
  });

  it("throws when the ciphertext has been tampered with", async () => {
    const { encrypt, decrypt, ContactDecryptionError } = await import("./contact-encryption");

    const ciphertext = await encrypt("+351 912 345 678");
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(decrypt(tampered)).rejects.toThrow(ContactDecryptionError);
  });

  it("throws a clear error when CONTACT_ENCRYPTION_KEY is missing", async () => {
    delete process.env.CONTACT_ENCRYPTION_KEY;
    const { encrypt, __resetContactEncryptionKeyCacheForTests, ContactEncryptionKeyError } = await import(
      "./contact-encryption"
    );
    __resetContactEncryptionKeyCacheForTests();

    await expect(encrypt("test")).rejects.toThrow(ContactEncryptionKeyError);
  });

  it("throws a clear error when CONTACT_ENCRYPTION_KEY is the wrong length", async () => {
    process.env.CONTACT_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    const { encrypt, __resetContactEncryptionKeyCacheForTests, ContactEncryptionKeyError } = await import(
      "./contact-encryption"
    );
    __resetContactEncryptionKeyCacheForTests();

    await expect(encrypt("test")).rejects.toThrow(ContactEncryptionKeyError);
  });
});
