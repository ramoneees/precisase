"use server";

/**
 * Reset-password Server Action — validates a new password's strength (same
 * minimum-length rule as signup's `signup` action, ../signup/actions.ts,
 * §MIN_PASSWORD_LENGTH) and redeems the reset token via
 * `PasswordResetService.consumeReset`. Distinguishes an invalid/expired
 * token from an unexpected failure so the form can show the right message
 * — see `InvalidResetTokenError`'s doc in password-reset-service.ts for why
 * that single error type deliberately doesn't distinguish "doesn't exist"
 * from "expired" from "already used".
 */

import { InvalidResetTokenError } from "@/server/services/password-reset-service";
import { passwordResetService } from "@/server/service-instances";

export type ResetPasswordErrorCode = "invalidToken" | "weakPassword" | "generic";

export type ResetPasswordResult = { ok: true } | { ok: false; error: ResetPasswordErrorCode };

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

const MIN_PASSWORD_LENGTH = 8;

export async function resetPasswordAction(
  input: ResetPasswordInput,
): Promise<ResetPasswordResult> {
  if (!input.newPassword || input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "weakPassword" };
  }

  try {
    await passwordResetService.consumeReset(input.token, input.newPassword);
  } catch (error) {
    if (error instanceof InvalidResetTokenError) {
      return { ok: false, error: "invalidToken" };
    }
    return { ok: false, error: "generic" };
  }

  return { ok: true };
}
