"use server";

/**
 * MFA enrollment Server Actions (T17). The current user is always derived
 * from the session (`auth()`) — never from a client-supplied id — so a
 * caller can only ever enroll/enable/disable MFA for their own account.
 *
 * Known limitation: enabling/disabling MFA mutates `User.mfaEnabledAt`, but
 * the JWT session strategy caches the old `mfaEnabledAt` claim on the
 * existing token and doesn't auto-refresh mid-session. The header's MFA
 * warning banner and the moderator RBAC gate (T18) therefore only see the
 * fresh state after the next sign-in (or JWT refresh). This is an accepted
 * MVP gap — the user signs out/in once to fully propagate the change.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { mfaService } from "@/server/service-instances";
import {
  InvalidPasswordError,
  InvalidTotpError,
  MfaNotEnrolledError,
} from "@/server/services/mfa-service";

export type EnrollResult =
  | { ok: true; secret: string; otpauthUrl: string }
  | { ok: false };

export type EnableResult =
  | { ok: true }
  | { ok: false; error: "invalidToken" | "notEnrolled" };

export type DisableResult =
  | { ok: true }
  | { ok: false; error: "invalidPassword" };

export async function enrollAction(): Promise<EnrollResult> {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) {
    return { ok: false };
  }

  try {
    const { secret, otpauthUrl } = await mfaService.enroll(userId, email);
    return { ok: true, secret, otpauthUrl };
  } catch {
    return { ok: false };
  }
}

export async function enableAction(input: { token: string }): Promise<EnableResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: "notEnrolled" };
  }

  try {
    await mfaService.enableMfa(userId, input.token);
  } catch (error) {
    if (error instanceof InvalidTotpError) {
      return { ok: false, error: "invalidToken" };
    }
    if (error instanceof MfaNotEnrolledError) {
      return { ok: false, error: "notEnrolled" };
    }
    throw error;
  }

  revalidatePath("/account/mfa");
  return { ok: true };
}

export async function disableAction(input: { password: string }): Promise<DisableResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, error: "invalidPassword" };
  }

  try {
    await mfaService.disableMfa(userId, input.password);
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      return { ok: false, error: "invalidPassword" };
    }
    throw error;
  }

  revalidatePath("/account/mfa");
  return { ok: true };
}
