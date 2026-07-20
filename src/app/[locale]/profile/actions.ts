"use server";

/**
 * Account-settings Server Actions — profile update (FR13) and self-service
 * GDPR/LGPD account deletion (NFR08, docs/ARCHITECTURE.md §6.4/§7.5).
 */

import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { prisma } from "@/server/repositories/prisma-client";
import { accountDeletionService } from "@/server/service-instances";
import {
  InvalidPasswordError,
  UserNotFoundError,
} from "@/server/services/account-deletion-service";
import { PhoneService, type CountryCode } from "@/server/services/phone-service";
import { routing, type AppLocale } from "@/i18n/routing";
import {
  PROFILE_COUNTRY_CODES,
  timeZoneOptionsForCountry,
} from "@/lib/region-defaults";

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

function isValidCountry(value: string): boolean {
  return PROFILE_COUNTRY_CODES.has(value.toUpperCase());
}

// ---------------------------------------------------------------------
// Update profile (FR13)
// ---------------------------------------------------------------------

export type UpdateProfileErrorCode =
  | "unauthenticated"
  | "invalidInput"
  | "invalidPhone"
  | "invalidRegion"
  | "generic";

export type UpdateProfileResult = { ok: true } | { ok: false; error: UpdateProfileErrorCode };

export interface UpdateProfileInput {
  displayName: string;
  /** ISO 3166-1 alpha-2 — parsing hint for `phoneE164`. */
  phoneCountry: string;
  /** Free-form phone value (will be normalized server-side). */
  phoneE164: string;
  churchAffiliation: string;
  /** ISO 3166-1 alpha-2 — the user's country (drives defaults). */
  country: string;
  /** IANA zone — must be valid for the chosen `country`. */
  timeZone: string;
  locale: string;
}

/**
 * FR13 — "Basic profile: Name, contact info, optional community/church
 * affiliation". Email is deliberately not editable here — it's the login
 * identifier, and changing it safely (re-verification, uniqueness) is out
 * of scope for this build (documented limitation). `role`/`locale` are
 * surfaced read-only on the page but not writable through this action.
 */
export async function updateProfileAction(
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) {
    return { ok: false, error: "invalidInput" };
  }

  const trimmedPhone = input.phoneE164?.trim() ?? "";
  let normalizedPhoneE164: string | null = null;
  if (trimmedPhone.length > 0) {
    const result = PhoneService.parse(trimmedPhone, input.phoneCountry as CountryCode);
    if (!result.ok) {
      return { ok: false, error: "invalidPhone" };
    }
    normalizedPhoneE164 = result.e164;
  }
  const churchAffiliation = input.churchAffiliation?.trim() || null;

  // Country + time-zone validation (FR13 region fields). The country must
  // be in the supported set; the time zone must be one of the zones offered
  // for that country (see `timeZoneOptionsForCountry`). Rejecting here
  // keeps the column from receiving arbitrary user-supplied IANA strings.
  const country = input.country?.trim().toUpperCase() ?? "";
  const timeZone = input.timeZone?.trim() ?? "";
  if (!isValidCountry(country) || !timeZoneOptionsForCountry(country).includes(timeZone)) {
    return { ok: false, error: "invalidRegion" };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { displayName, phoneE164: normalizedPhoneE164, churchAffiliation, country, timeZone },
    });
  } catch {
    return { ok: false, error: "generic" };
  }

  const resolvedLocale = isSupportedLocale(input.locale) ? input.locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/profile`);

  return { ok: true };
}

// ---------------------------------------------------------------------
// Delete account (NFR08)
// ---------------------------------------------------------------------

export type DeleteAccountErrorCode = "unauthenticated" | "invalidPassword" | "generic";

export type DeleteAccountResult = { ok: true } | { ok: false; error: DeleteAccountErrorCode };

/**
 * NFR08 — self-service GDPR/LGPD account deletion. Confirmation is the
 * user's current password (see account-deletion-service.ts's module doc
 * comment for the deviation from ARCHITECTURE.md §6.4's email-token flow).
 * Signs the caller out (`redirect: false` — the client component handles
 * navigation after showing a confirmation toast) so a deleted account never
 * remains a "ghost" active session.
 */
export async function deleteAccountAction(password: string): Promise<DeleteAccountResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    await accountDeletionService.deleteOwnAccount({ userId: session.user.id, password });
  } catch (error) {
    if (error instanceof InvalidPasswordError || error instanceof UserNotFoundError) {
      return { ok: false, error: "invalidPassword" };
    }
    return { ok: false, error: "generic" };
  }

  await signOut({ redirect: false });

  return { ok: true };
}
