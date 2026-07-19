import { AuthError, CredentialsSignin } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { MfaRequiredSigninError, enforceMfaChallenge } from "./mfa-challenge";

/**
 * Covers the three branches of the credentials `authorize()` MFA gate (T16)
 * plus the fail-safe branches, using injected fakes for the repository
 * re-fetch and TOTP verification — no NextAuth/Prisma/libsodium boot needed.
 */

const ENABLED_AT = new Date("2026-01-01T00:00:00.000Z");

function makeDeps(overrides?: {
  record?: { mfaEnabledAt: Date | null; mfaSecret: string | null } | null;
  verify?: boolean;
}) {
  const findUserByEmail = vi.fn().mockResolvedValue(
    overrides?.record === undefined
      ? { mfaEnabledAt: ENABLED_AT, mfaSecret: "PLAINTEXT-SECRET" }
      : overrides.record,
  );
  const verifyTotp = vi.fn().mockResolvedValue(overrides?.verify ?? true);
  return { findUserByEmail, verifyTotp };
}

describe("enforceMfaChallenge", () => {
  it("returns without challenge when the user has no MFA enabled", async () => {
    const deps = makeDeps();
    await expect(
      enforceMfaChallenge("a@b.c", undefined, { mfaEnabledAt: null }, deps),
    ).resolves.toBeUndefined();
    // Never even re-fetches the record — the session claim already said "no MFA".
    expect(deps.findUserByEmail).not.toHaveBeenCalled();
  });

  it("throws MfaRequiredSigninError when MFA is enabled and no token supplied", async () => {
    const deps = makeDeps();
    await expect(
      enforceMfaChallenge("a@b.c", undefined, { mfaEnabledAt: ENABLED_AT }, deps),
    ).rejects.toBeInstanceOf(MfaRequiredSigninError);
    expect(deps.verifyTotp).not.toHaveBeenCalled();
  });

  it("throws MfaRequiredSigninError for an empty-string token too", async () => {
    const deps = makeDeps();
    await expect(
      enforceMfaChallenge("a@b.c", "", { mfaEnabledAt: ENABLED_AT }, deps),
    ).rejects.toBeInstanceOf(MfaRequiredSigninError);
  });

  it("throws generic CredentialsSignin (not the MFA-required subclass) on a wrong code", async () => {
    const deps = makeDeps({ verify: false });
    const error = await enforceMfaChallenge(
      "a@b.c",
      "000000",
      { mfaEnabledAt: ENABLED_AT },
      deps,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect(error).not.toBeInstanceOf(MfaRequiredSigninError);
    expect(deps.verifyTotp).toHaveBeenCalledWith("000000", "PLAINTEXT-SECRET");
  });

  it("resolves when MFA is enabled and the supplied code is valid", async () => {
    const deps = makeDeps({ verify: true });
    await expect(
      enforceMfaChallenge("a@b.c", "123456", { mfaEnabledAt: ENABLED_AT }, deps),
    ).resolves.toBeUndefined();
  });

  it("fail-safes to no-challenge when the re-fetched record has a null secret (corrupt/tampered)", async () => {
    const deps = makeDeps({ record: { mfaEnabledAt: ENABLED_AT, mfaSecret: null } });
    await expect(
      enforceMfaChallenge("a@b.c", undefined, { mfaEnabledAt: ENABLED_AT }, deps),
    ).resolves.toBeUndefined();
    expect(deps.verifyTotp).not.toHaveBeenCalled();
  });
});

describe("MfaRequiredSigninError discriminator contract", () => {
  // The whole two-call sign-in flow hinges on `error.name` surviving so the
  // sign-in Server Action can distinguish "needs a code" from "wrong
  // password". Guard that contract against a future refactor.
  it("has name 'MfaRequiredSigninError' and is an AuthError/CredentialsSignin", () => {
    const error = new MfaRequiredSigninError();
    expect(error.name).toBe("MfaRequiredSigninError");
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toBeInstanceOf(CredentialsSignin);
  });

  it("a plain CredentialsSignin does NOT share that name", () => {
    expect(new CredentialsSignin().name).not.toBe("MfaRequiredSigninError");
  });
});
