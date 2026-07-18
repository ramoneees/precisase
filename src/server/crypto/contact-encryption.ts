/**
 * Contact encryption — app-layer encryption of `Post.contact_value` per
 * docs/ARCHITECTURE.md §7.4:
 *
 *   "Contact values are encrypted at the application layer (libsodium
 *   crypto_secretbox, key from an env var) before being written to
 *   Post.contact_value. This means a DB dump alone does not leak contacts."
 *
 * Only `PrismaPostRepository` (src/server/repositories/prisma-post-repository.ts)
 * imports this module — `PostRecord.contactValue` stays plaintext at the
 * service/domain boundary; the service layer never touches ciphertext.
 *
 * Wire format: `nonce (crypto_secretbox_NONCEBYTES) || secretbox(plaintext)`,
 * concatenated into a single Buffer stored in the `bytea` column.
 *
 * libsodium-wrappers initializes asynchronously (`sodium.ready`), so
 * `encrypt`/`decrypt` here are async — both call sites (the Prisma
 * repository) already run in an async context.
 */
import sodium from "libsodium-wrappers";

export class ContactEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactEncryptionKeyError";
  }
}

export class ContactDecryptionError extends Error {
  constructor(
    message = "Failed to decrypt contact value: ciphertext is invalid or has been tampered with.",
  ) {
    super(message);
    this.name = "ContactDecryptionError";
  }
}

let sodiumReady: Promise<typeof sodium> | null = null;

async function loadSodium(): Promise<typeof sodium> {
  if (!sodiumReady) {
    sodiumReady = sodium.ready.then(() => sodium);
  }
  return sodiumReady;
}

let cachedKey: Uint8Array | null = null;

/**
 * Reads and validates `CONTACT_ENCRYPTION_KEY` (base64-encoded 32-byte key).
 * Throws a clear, actionable error at first use if it's missing or the
 * wrong length — never silently falls back to plaintext.
 */
function loadKey(): Uint8Array {
  if (cachedKey) {
    return cachedKey;
  }

  const raw = process.env.CONTACT_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new ContactEncryptionKeyError(
      "CONTACT_ENCRYPTION_KEY is not set. Contact values cannot be encrypted or " +
        "decrypted without it. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new ContactEncryptionKeyError(
      `CONTACT_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decoded.length}). ` +
        "It must be a base64-encoded 32-byte key.",
    );
  }

  cachedKey = new Uint8Array(decoded);
  return cachedKey;
}

/**
 * Test-only escape hatch: clears the cached key so tests can flip
 * `process.env.CONTACT_ENCRYPTION_KEY` between cases. Not used in
 * production code paths.
 */
export function __resetContactEncryptionKeyCacheForTests(): void {
  cachedKey = null;
}

/** Encrypts `plaintext` with a fresh random nonce on every call. */
export async function encrypt(plaintext: string): Promise<Buffer> {
  const lib = await loadSodium();
  const key = loadKey();

  const nonce = lib.randombytes_buf(lib.crypto_secretbox_NONCEBYTES);
  const message = lib.from_string(plaintext);
  const box = lib.crypto_secretbox_easy(message, nonce, key);

  return Buffer.concat([Buffer.from(nonce), Buffer.from(box)]);
}

/**
 * Decrypts a buffer produced by `encrypt`. Throws `ContactDecryptionError`
 * if the ciphertext is malformed or has been tampered with (secretbox's
 * MAC verification fails).
 */
export async function decrypt(ciphertext: Buffer): Promise<string> {
  const lib = await loadSodium();
  const key = loadKey();

  const nonceBytes = lib.crypto_secretbox_NONCEBYTES;
  const macBytes = lib.crypto_secretbox_MACBYTES;

  if (ciphertext.length < nonceBytes + macBytes) {
    throw new ContactDecryptionError();
  }

  const nonce = new Uint8Array(ciphertext.subarray(0, nonceBytes));
  const box = new Uint8Array(ciphertext.subarray(nonceBytes));

  try {
    const plaintext = lib.crypto_secretbox_open_easy(box, nonce, key);
    return lib.to_string(plaintext);
  } catch {
    throw new ContactDecryptionError();
  }
}
