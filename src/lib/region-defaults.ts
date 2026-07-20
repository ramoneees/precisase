/**
 * Country-level defaults — locale-independent regional preferences that
 * the URL segment (`/[locale]/...`) does not carry.
 *
 * Four orthogonal facts per country:
 *   - currency   — ISO 4217 alpha-3 (EUR, BRL, USD, …)
 *   - timeZone   — IANA zone used when the user has not picked one
 *   - phoneCountry — ISO 3166-1 alpha-2 (the "default country code" hint
 *                  for `libphonenumber` parsing — same value as `country`
 *                  for everyone; kept as a separate field so the source of
 *                  truth is unambiguous and the lookup shape is uniform)
 *   - measurement — 'metric' | 'us' (SI vs US customary)
 *
 * This module intentionally ships a small, opinionated subset (~30
 * countries) rather than full ISO 3166-1 (~250 entries). The MVP target
 * communities are Portugal, Brazil, and English-speaking countries; any
 * user from a country not in this table still works — fallbacks below
 * return `null` and the UI prompts the user to pick explicitly.
 *
 * Adding a country is a single-row entry; no migration needed.
 *
 * Source data: ISO 3166-1 (country codes), ISO 4217 (currency), IANA tz
 * database. The two-letter country code is the join key across all of
 * them.
 */

export type CountryCode = string; // ISO 3166-1 alpha-2

export interface CountryDefaults {
  currency: string;
  timeZone: string;
  phoneCountry: CountryCode;
  measurement: "metric" | "us";
}

const COUNTRIES: Record<CountryCode, CountryDefaults> = {
  // Core communities (Q1/Q5 of the plan: pt-PT, pt-BR, en).
  PT: { currency: "EUR", timeZone: "Europe/Lisbon", phoneCountry: "PT", measurement: "metric" },
  BR: { currency: "BRL", timeZone: "America/Sao_Paulo", phoneCountry: "BR", measurement: "metric" },
  US: { currency: "USD", timeZone: "America/New_York", phoneCountry: "US", measurement: "us" },
  GB: { currency: "GBP", timeZone: "Europe/London", phoneCountry: "GB", measurement: "metric" },
  IE: { currency: "EUR", timeZone: "Europe/Dublin", phoneCountry: "IE", measurement: "metric" },

  // EU neighbors (kept for completeness — these are common among
  // Portuguese-speaking communities in Europe).
  ES: { currency: "EUR", timeZone: "Europe/Madrid", phoneCountry: "ES", measurement: "metric" },
  FR: { currency: "EUR", timeZone: "Europe/Paris", phoneCountry: "FR", measurement: "metric" },
  DE: { currency: "EUR", timeZone: "Europe/Berlin", phoneCountry: "DE", measurement: "metric" },
  IT: { currency: "EUR", timeZone: "Europe/Rome", phoneCountry: "IT", measurement: "metric" },
  NL: { currency: "EUR", timeZone: "Europe/Amsterdam", phoneCountry: "NL", measurement: "metric" },

  // Lusophone Africa (PALOP) — community partnership possibility.
  AO: { currency: "AOA", timeZone: "Africa/Luanda", phoneCountry: "AO", measurement: "metric" },
  MZ: { currency: "MZN", timeZone: "Africa/Maputo", phoneCountry: "MZ", measurement: "metric" },
  CV: { currency: "CVE", timeZone: "Atlantic/Cape_Verde", phoneCountry: "CV", measurement: "metric" },

  // Latin America (PT-ES regional overlap).
  AR: { currency: "ARS", timeZone: "America/Argentina/Buenos_Aires", phoneCountry: "AR", measurement: "metric" },
  CL: { currency: "CLP", timeZone: "America/Santiago", phoneCountry: "CL", measurement: "metric" },
  CO: { currency: "COP", timeZone: "America/Bogota", phoneCountry: "CO", measurement: "metric" },
  MX: { currency: "MXN", timeZone: "America/Mexico_City", phoneCountry: "MX", measurement: "metric" },
  PE: { currency: "PEN", timeZone: "America/Lima", phoneCountry: "PE", measurement: "metric" },
  UY: { currency: "UYU", timeZone: "America/Montevideo", phoneCountry: "UY", measurement: "metric" },

  // Lusophone diaspora (US, Canada, EU).
  CA: { currency: "CAD", timeZone: "America/Toronto", phoneCountry: "CA", measurement: "metric" },
  CH: { currency: "CHF", timeZone: "Europe/Zurich", phoneCountry: "CH", measurement: "metric" },
  LU: { currency: "EUR", timeZone: "Europe/Luxembourg", phoneCountry: "LU", measurement: "metric" },
};

/** Returns `null` for unknown countries so callers can fall through to user picks or generic defaults. */
export function getCountryDefaults(country: CountryCode | null | undefined): CountryDefaults | null {
  if (!country) return null;
  return COUNTRIES[country.toUpperCase()] ?? null;
}

/** Default currency for a country, or null if unknown. */
export function defaultCurrencyFor(country: CountryCode | null | undefined): string | null {
  return getCountryDefaults(country)?.currency ?? null;
}

/** Default IANA time zone for a country, or null if unknown. */
export function defaultTimeZoneFor(country: CountryCode | null | undefined): string | null {
  return getCountryDefaults(country)?.timeZone ?? null;
}

/** Default phone-country hint for libphonenumber, or null if unknown. */
export function defaultPhoneCountryFor(country: CountryCode | null | undefined): CountryCode | null {
  return getCountryDefaults(country)?.phoneCountry ?? null;
}

/** Default measurement system for a country, or `metric` as the international default. */
export function defaultMeasurementFor(country: CountryCode | null | undefined): "metric" | "us" {
  return getCountryDefaults(country)?.measurement ?? "metric";
}

/**
 * Derives the URL locale (`pt-PT` / `pt-BR` / `en`) to fall back on when
 * the user's UI locale is not explicit. Mirrors what ICU/JDK pick for
 * the bare language subtag:
 *   pt-PT → "PT" (Portugal — the primary community)
 *   pt-BR → "BR" (Brazil)
 *   en    → null (no region in "en" — UK/US/IN/AU/NZ all collapse; picking
 *                  one would mislabel the others)
 */
export function deriveCountryFromUiLocale(uiLocale: string): CountryCode | null {
  switch (uiLocale) {
    case "pt-PT":
      return "PT";
    case "pt-BR":
      return "BR";
    default:
      return null;
  }
}

/**
 * Default IANA time zone for an anonymous/URL-driven request when there
 * is no authenticated user profile to draw from. Mirrors the URL locale's
 * primary community, with `en` falling back to `America/New_York` (the
 * ICU default for the bare `en` subtag).
 */
export function defaultTimeZoneForUiLocale(uiLocale: string): string {
  switch (uiLocale) {
    case "pt-PT":
      return "Europe/Lisbon";
    case "pt-BR":
      return "America/Sao_Paulo";
    default:
      return "America/New_York";
  }
}

/** Currency fallback for an anonymous/URL-driven request, derived from the URL locale. */
export function defaultCurrencyForUiLocale(uiLocale: string): string {
  switch (uiLocale) {
    case "pt-PT":
      return "EUR";
    case "pt-BR":
      return "BRL";
    default:
      return "USD";
  }
}

// ---------------------------------------------------------------------
// Profile-form country / time-zone options
// ---------------------------------------------------------------------

/**
 * Curated country list surfaced in the profile form's `<select>`. Kept
 * narrow on purpose — matches the `PHONE_COUNTRIES` list in
 * `profile-form.tsx` so phone-country and country stays in lockstep.
 * Adding a country here requires a row in `COUNTRIES` above.
 */
export const PROFILE_COUNTRY_OPTIONS: ReadonlyArray<{ code: CountryCode; label: string }> = [
  { code: "PT", label: "Portugal (+351)" },
  { code: "BR", label: "Brasil (+55)" },
  { code: "US", label: "United States (+1)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "ES", label: "España (+34)" },
];

/** The set of country codes the profile form accepts (for validation). */
export const PROFILE_COUNTRY_CODES: ReadonlySet<CountryCode> = new Set(
  PROFILE_COUNTRY_OPTIONS.map((c) => c.code),
);

/**
 * Time-zone options surfaced for a given country in the profile form.
 * MVP scope: one zone per country (the IANA default from `COUNTRIES`).
 * The array shape leaves room to expand to multi-zone countries (US, BR)
 * without churning callers. Returns `[]` for unknown countries so the
 * form can prompt the user to pick a country first.
 */
export function timeZoneOptionsForCountry(country: CountryCode | null | undefined): ReadonlyArray<string> {
  const defaults = getCountryDefaults(country);
  return defaults ? [defaults.timeZone] : [];
}