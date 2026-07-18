/**
 * Locale-aware formatting helpers — dates, numbers, currencies.
 *
 * Why this exists instead of `new Intl.DateTimeFormat(locale, …)` at each
 * call site:
 *
 * 1. **timeZone is always required.** The pre-existing ad-hoc sites
 *    (`posts/[id]/page.tsx`, `moderation-card.tsx`) called `new Intl.DateTimeFormat(locale, …)`
 *    with no `timeZone` option, falling back to the runtime's default — which is
 *    the server's TZ, leading to wrong calendar dates for non-server-TZ
 *    users. The test output already shows `ENVIRONMENT_FALLBACK` warnings.
 *
 * 2. **One place to swap for `next-intl`'s `useFormatter`/`getFormatter` if
 *    we later want access to the catalog-driven date formatter.** For now
 *    `Intl.DateTimeFormat` is the canonical source — next-intl's helpers
 *    ultimately call it.
 *
 * 3. **Currency/region decoupling.** The same date renders differently for
 *    a Brazilian user viewing a Portuguese post; the same amount of
 *    money looks different in different locales (€50 / 50 € / € 50,00).
 *    Centralizing the `Intl` calls keeps the locale+region argument
 *    tuple in one place.
 */

import { defaultCurrencyFor, defaultMeasurementFor, defaultTimeZoneFor } from "./region-defaults";

/** Time zone fallback chain: explicit → country-derived → UTC. */
export function resolveTimeZone(
  explicit: string | null | undefined,
  country: string | null | undefined,
): string {
  if (explicit && explicit.length > 0) return explicit;
  const fromCountry = defaultTimeZoneFor(country);
  if (fromCountry) return fromCountry;
  return "UTC";
}

/** Currency fallback chain: explicit → country-derived → "USD" (last-resort display default). */
export function resolveCurrency(
  explicit: string | null | undefined,
  country: string | null | undefined,
): string {
  if (explicit && explicit.length === 3) return explicit.toUpperCase();
  return defaultCurrencyFor(country) ?? "USD";
}

export interface FormatDateTimeOptions {
  locale: string;
  /** IANA time zone (e.g. "Europe/Lisbon"). Defaults to `resolveTimeZone`. */
  timeZone?: string | null;
  country?: string | null;
  /** Defaults to `"medium"`. */
  dateStyle?: "short" | "medium" | "long" | "full";
  /** If true, includes hours/minutes. */
  showTime?: boolean;
}

/** Formats a date for display. The time zone is always explicit — never implicit. */
export function formatDateTime(date: Date, options: FormatDateTimeOptions): string {
  const timeZone = resolveTimeZone(options.timeZone, options.country);
  const style: Intl.DateTimeFormatOptions = options.showTime
    ? { dateStyle: options.dateStyle ?? "medium", timeStyle: "short", timeZone }
    : { dateStyle: options.dateStyle ?? "medium", timeZone };
  return new Intl.DateTimeFormat(options.locale, style).format(date);
}

export interface FormatNumberOptions {
  locale: string;
  /** Defaults to `0` (integer). */
  maximumFractionDigits?: number;
  /** Defaults to `"decimal"`. */
  style?: "decimal" | "currency" | "percent" | "unit";
  /** Currency code, required when `style === "currency"`. */
  currency?: string;
  unit?: string;
}

/** Formats a number. Currency formatting follows locale conventions: €50 / 50 € / $50.00 etc. */
export function formatNumber(value: number, options: FormatNumberOptions): string {
  if (options.style === "currency") {
    if (!options.currency) {
      throw new Error("formatNumber: `currency` is required when style is 'currency'.");
    }
    return new Intl.NumberFormat(options.locale, {
      style: "currency",
      currency: options.currency,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
    }).format(value);
  }
  if (options.style === "unit") {
    if (!options.unit) {
      throw new Error("formatNumber: `unit` is required when style is 'unit'.");
    }
    return new Intl.NumberFormat(options.locale, {
      style: "unit",
      unit: options.unit,
      maximumFractionDigits: options.maximumFractionDigits ?? 1,
    }).format(value);
  }
  return new Intl.NumberFormat(options.locale, {
    style: options.style ?? "decimal",
    maximumFractionDigits: options.maximumFractionDigits,
  }).format(value);
}

export interface FormatCurrencyOptions {
  locale: string;
  amount: number;
  currency: string;
  country?: string | null;
}

/**
 * Convenience wrapper around `formatNumber` for currency. If `country` is
 * given and `currency` is null, the country-derived default is used.
 */
export function formatCurrency(options: FormatCurrencyOptions): string {
  return formatNumber(options.amount, {
    locale: options.locale,
    style: "currency",
    currency: resolveCurrency(options.currency, options.country),
  });
}

/** Length-style distance: meters internally, formatted to km/mi per region. */
export function formatDistance(meters: number, options: { locale: string; country?: string | null }): string {
  const measurement = defaultMeasurementFor(options.country);
  if (measurement === "us") {
    const miles = meters / 1609.344;
    return new Intl.NumberFormat(options.locale, { style: "unit", unit: "mile", maximumFractionDigits: 1 }).format(miles);
  }
  const km = meters / 1000;
  return new Intl.NumberFormat(options.locale, { style: "unit", unit: "kilometer", maximumFractionDigits: 1 }).format(km);
}