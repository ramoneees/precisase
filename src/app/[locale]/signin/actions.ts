"use server";

/**
 * Sign-in Server Action — delegates to Auth.js's server-side `signIn()`
 * (docs/ARCHITECTURE.md §4.4).
 *
 * Uses `redirect: false` so the whole flow stays inside typed Server Action
 * control flow (rather than relying on NextAuth's internal `NEXT_REDIRECT`
 * throw or on parsing its `?error=...` redirect URL, which is fragile across
 * betas). On success `signIn()` resolves with a URL string and we call
 * `redirect()` ourselves; on failure it rejects with an `AuthError`.
 *
 * The two-call MFA flow (T16): if the user has MFA enabled and no code was
 * supplied, `authorize()` throws `MfaRequiredSigninError` — we detect it by
 * `error.name` (see `src/auth.ts` for why `name`, not `type`) and return
 * `mfaRequired` so the form can route to the MFA challenge screen.
 */

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type SigninErrorCode = "invalidCredentials" | "generic";

export type SigninResult =
  | { ok: true }
  | { ok: false; error: SigninErrorCode }
  | { ok: false; mfaRequired: true; email: string };

export interface SigninInput {
  email: string;
  password: string;
  mfaToken?: string;
  callbackUrl?: string;
}

export async function signin(input: SigninInput): Promise<SigninResult> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      ...(input.mfaToken ? { mfaToken: input.mfaToken } : {}),
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // `MfaRequiredSigninError` (subclass of `CredentialsSignin`) is
      // re-thrown as its own instance by @auth/core in raw mode, so its
      // `.name` survives. `.type` is inherited as "CredentialsSignin" and
      // would collide with a genuine wrong-password failure.
      if (error.name === "MfaRequiredSigninError") {
        return { ok: false, mfaRequired: true, email: input.email };
      }
      return { ok: false, error: "invalidCredentials" };
    }
    // Any non-AuthError (e.g. an unexpected Next.js control-flow throw) must
    // propagate untouched.
    throw error;
  }

  // Relative-path only — never redirect to an attacker-supplied absolute URL
  // (open-redirect guard).
  redirect(
    input.callbackUrl && input.callbackUrl.startsWith("/") ? input.callbackUrl : "/",
  );
}
