/**
 * PasswordService — wraps argon2id password hashing, the OWASP-recommended
 * algorithm chosen in docs/ARCHITECTURE.md §4.4 ("Auth.js (NextAuth v5)
 * with a credentials provider, argon2id password hashing") and §7.1
 * (Authentication).
 *
 * Uses `@node-rs/argon2` (Rust bindings via NAPI-RS, prebuilt binaries —
 * no native build toolchain required). `hash()` embeds algorithm, version,
 * cost parameters, and a random salt in the returned PHC-format string
 * (`$argon2id$...`), so `verify()` needs no separately stored salt/params.
 */

import { hash, verify } from "@node-rs/argon2";

// `@node-rs/argon2`'s `Algorithm` is a `const enum`, which Next.js's
// `isolatedModules: true` TS setting cannot inline across module
// boundaries. Argon2id's underlying value (2) is used directly instead —
// see node_modules/@node-rs/argon2/index.d.ts for the source enum.
const ARGON2ID = 2;

export class PasswordService {
  /**
   * Hashes a plaintext password with argon2id. Each call uses a fresh
   * random salt, so hashing the same password twice yields different
   * output — this is expected and is what makes rainbow-table attacks
   * infeasible.
   */
  async hash(password: string): Promise<string> {
    return hash(password, { algorithm: ARGON2ID });
  }

  /**
   * Verifies a plaintext password against a previously produced argon2id
   * hash. Returns `false` (never throws) for a non-matching password;
   * malformed hash strings are also treated as a verification failure
   * rather than propagated as an error, so callers can branch on a single
   * boolean.
   */
  async verify(password: string, passwordHash: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
