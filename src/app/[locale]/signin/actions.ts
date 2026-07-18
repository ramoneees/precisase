"use server";

/**
 * Sign-in Server Action — delegates to Auth.js's server-side `signIn()`
 * (docs/ARCHITECTURE.md §4.4). On success, `signIn()` throws Next.js's
 * internal redirect signal (not an `AuthError`), which we deliberately let
 * propagate so the navigation actually happens. On invalid credentials it
 * throws an `AuthError` (`CredentialsSignin`), which we catch and turn into
 * a translatable error code for the form.
 */

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export type SigninErrorCode = "invalidCredentials" | "generic";

export type SigninResult = { ok: true } | { ok: false; error: SigninErrorCode };

export interface SigninInput {
  email: string;
  password: string;
}

export async function signin(input: SigninInput): Promise<SigninResult> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: "invalidCredentials" };
    }
    // Auth.js's server-side `signIn()` signals a successful redirect by
    // throwing Next.js's internal `NEXT_REDIRECT` error — not an
    // `AuthError` — so it must be re-thrown here, not swallowed.
    throw error;
  }

  return { ok: true };
}
