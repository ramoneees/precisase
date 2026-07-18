"use server";

/**
 * Sign-up Server Action — creates a `User` row plus the `terms`/`privacy`
 * `ConsentRecord` rows required by docs/ARCHITECTURE.md §7.5 / BR06
 * (docs/MVP.md). All validation here is authoritative: the client form
 * (signup-form.tsx) mirrors these checks for a snappier UX, but this
 * action re-validates independently — a request that skips the client
 * entirely (e.g. a raw fetch) must still be rejected here (defense in
 * depth, §7.2).
 */

import { PasswordService } from "@/server/services/password-service";
import {
  createUserWithConsent,
  EmailAlreadyRegisteredError,
} from "@/server/auth/user-repository";
import {
  defaultCurrencyFor,
  defaultTimeZoneFor,
  deriveCountryFromUiLocale,
} from "@/lib/region-defaults";
import { routing, type AppLocale } from "@/i18n/routing";

export type SignupErrorCode =
  | "invalidInput"
  | "passwordMismatch"
  | "passwordTooShort"
  | "consentRequired"
  | "emailTaken"
  | "generic";

export type SignupResult = { ok: true } | { ok: false; error: SignupErrorCode };

export interface SignupInput {
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  consent: boolean;
  locale: string;
  /** IANA time zone sniffed client-side at signup. Optional — the server derives a fallback if absent. */
  timeZone?: string;
}

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const passwordService = new PasswordService();

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

export async function signup(input: SignupInput): Promise<SignupResult> {
  const displayName = input.displayName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  const password = input.password ?? "";
  const confirmPassword = input.confirmPassword ?? "";
  const locale = isSupportedLocale(input.locale)
    ? input.locale
    : routing.defaultLocale;

  if (!displayName || !email || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "invalidInput" };
  }

  if (!password || password !== confirmPassword) {
    return { ok: false, error: "passwordMismatch" };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "passwordTooShort" };
  }

  if (!input.consent) {
    return { ok: false, error: "consentRequired" };
  }

  const passwordHash = await passwordService.hash(password);

  try {
    await createUserWithConsent({
      email,
      passwordHash,
      displayName,
      uiLocale: locale,
      country: deriveCountryFromUiLocale(locale),
      timeZone: input.timeZone ?? defaultTimeZoneFor(deriveCountryFromUiLocale(locale)),
      currency: defaultCurrencyFor(deriveCountryFromUiLocale(locale)),
    });
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return { ok: false, error: "emailTaken" };
    }
    throw error;
  }

  return { ok: true };
}
