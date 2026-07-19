"use server";

/**
 * Forgot-password Server Action — delegates to
 * `PasswordResetService.requestReset`. Always returns `{ ok: true }` on the
 * happy path regardless of whether the email matched a user, mirroring
 * `requestReset`'s own anti-email-enumeration contract (see
 * password-reset-service.ts): the UI must look identical either way, so a
 * caller can never learn from the response whether an address is
 * registered. Only an unexpected failure of the service call itself yields
 * `{ ok: false, error: "generic" }`.
 */

import { passwordResetService } from "@/server/service-instances";

export type RequestResetErrorCode = "generic";

export type RequestResetResult = { ok: true } | { ok: false; error: RequestResetErrorCode };

export interface RequestResetInput {
  email: string;
}

export async function requestResetAction(input: RequestResetInput): Promise<RequestResetResult> {
  try {
    await passwordResetService.requestReset(input.email);
  } catch {
    return { ok: false, error: "generic" };
  }

  return { ok: true };
}
