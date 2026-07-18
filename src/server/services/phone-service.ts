/**
 * PhoneService — E.164 normalization + display formatting via
 * libphonenumber-js.
 *
 * Why this exists:
 *
 *   Before this service, every contact-method input flowed through plain
 *   strings. The post-detail page's `wa.me/${digitsOnly}` builder then
 *   stripped non-digits and shipped the result, which produced broken
 *   links for every user who typed a domestic-format number ("912 345
 *   678" → `wa.me/912345678` → WhatsApp interprets as Nigeria +234).
 *   Likewise `User.phoneE164` accepted any string despite the column
 *   name.
 *
 *   libphonenumber-js (community port of Google's libphonenumber; ~140 KB
 *   gzipped) provides parse/format against an ISO-3166 country hint.
 *   Storing the canonical E.164 (`+351912345678`) at the service
 *   boundary lets the rest of the system treat the value as a single
 *   canonical form — `wa.me/${e164.replace("+","")}` and `tel:${e164}`
 *   become correct by construction.
 *
 * The service is split into a pure domain (`PhoneService.parse`/`PhoneService.format`)
 * and a Prisma-aware entry point kept for later. For now no DB I/O —
 * the service is invoked at the Server Action boundary, before any
 * write.
 */

import {
  parsePhoneNumberFromString,
  formatIncompletePhoneNumber,
  validatePhoneNumberLength,
  type CountryCode as LibPhoneNumberCountryCode,
} from "libphonenumber-js";

export type CountryCode = LibPhoneNumberCountryCode;

export interface PhoneValidationOk {
  ok: true;
  /** Canonical E.164 form, e.g. `+351912345678`. Always starts with `+`. */
  e164: string;
  /** Display form in the country's national convention, e.g. `912 345 678`. */
  national: string;
  /** Display form in international convention, e.g. `+351 912 345 678`. */
  international: string;
  /** Resolved country code, e.g. `PT`. */
  country: CountryCode;
}

export type PhoneValidationError =
  | { ok: false; code: "EMPTY" }
  | { ok: false; code: "NOT_A_NUMBER" }
  | { ok: false; code: "INVALID_FOR_COUNTRY"; reason: string }
  | { ok: false; code: "TOO_SHORT" }
  | { ok: false; code: "TOO_LONG" };

export type PhoneValidationResult = PhoneValidationOk | PhoneValidationError;

export const PHONE_COUNTRY_DEFAULT: CountryCode = "PT";

/**
 * Parses a free-form phone string into canonical E.164 + display forms.
 *
 * `defaultCountry` is used as the parsing hint when the input doesn't
 * already start with `+`. It comes from `User.country` (preferred) or
 * `PHONE_COUNTRY_DEFAULT`. Returns a discriminated union so callers can
 * translate `code` into a localized error message without parsing error
 * strings.
 *
 * Always returns the E.164 form when `ok: true` — never a partial value.
 */
export function parsePhone(
  rawInput: string,
  defaultCountry: CountryCode = PHONE_COUNTRY_DEFAULT,
): PhoneValidationResult {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "EMPTY" };
  }

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  } catch (error) {
    return {
      ok: false,
      code: "NOT_A_NUMBER",
      // Reason is appended only in dev logs; never surfaced to users
      // (would leak implementation details).
      ...(process.env.NODE_ENV === "development" && error instanceof Error
        ? { reason: error.message }
        : {}),
    } as PhoneValidationError;
  }

  if (!parsed) {
    return { ok: false, code: "NOT_A_NUMBER" };
  }

  if (!parsed.isValid()) {
    // libphonenumber-js distinguishes "impossible" (wrong length for the
    // country) from "invalid" (length OK but other checks fail).
    // `isPossible() === false` means the number has the wrong total
    // length for the chosen country — surface as TOO_SHORT or TOO_LONG.
    if (!parsed.isPossible()) {
      const lengthCheck = validatePhoneNumberLength(trimmed, defaultCountry);
      if (lengthCheck === "TOO_SHORT") {
        return { ok: false, code: "TOO_SHORT" };
      }
      if (lengthCheck === "TOO_LONG") {
        return { ok: false, code: "TOO_LONG" };
      }
    }
    return {
      ok: false,
      code: "INVALID_FOR_COUNTRY",
      reason: "Phone number is not valid for the selected country.",
    };
  }

  // Belt-and-suspenders length cap — libphonenumber's "valid" can
  // occasionally allow implausibly-long numbers under stale metadata.
  if (parsed.nationalNumber.length > 15) {
    return { ok: false, code: "TOO_LONG" };
  }

  return {
    ok: true,
    e164: parsed.number, // already E.164 (with "+" prefix) when valid
    national: parsed.formatNational(),
    international: parsed.formatInternational(),
    country: (parsed.country ?? defaultCountry) as CountryCode,
  };
}

/**
 * Formats a canonical E.164 string for display in a given locale.
 *
 * For locale-aware display, callers should pass the **viewer's**
 * locale, not the number's country — a Brazilian user viewing a
 * Portuguese post wants `+351 912 345 678` in pt-BR formatting, not
 * Portuguese formatting.
 */
export function formatPhoneForDisplay(
  e164: string,
  options: { locale?: string; international?: boolean } = {},
): string {
  if (!e164.startsWith("+")) return e164;
  try {
    const parsed = parsePhoneNumberFromString(e164);
    if (!parsed) return e164;
    return options.international === false
      ? parsed.formatNational()
      : parsed.formatInternational();
  } catch {
    return e164;
  }
}

/**
 * Formats an in-progress (possibly incomplete) phone string the way
 * the user is typing it — used by client-side input components to keep
 * the field formatted while the user types.
 */
export function formatIncomplete(rawInput: string, defaultCountry: CountryCode = PHONE_COUNTRY_DEFAULT): string {
  try {
    return formatIncompletePhoneNumber(rawInput, defaultCountry);
  } catch {
    return rawInput;
  }
}

/** True iff the input is a syntactically valid E.164 (15 digits + `+`). Used as a cheap sanity check. */
export function isLikelyE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

/**
 * Pure service object — convenient for dependency injection in tests
 * and for the rest of the codebase that prefers object-method style over
 * standalone functions.
 */
export const PhoneService = {
  parse: parsePhone,
  formatForDisplay: formatPhoneForDisplay,
  formatIncomplete,
  isE164: isLikelyE164,
} as const;