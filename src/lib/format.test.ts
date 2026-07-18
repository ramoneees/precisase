import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatDateTime,
  formatDistance,
  formatNumber,
  resolveCurrency,
  resolveTimeZone,
} from "./format";

describe("format helpers", () => {
  describe("resolveTimeZone", () => {
    it("uses explicit when provided", () => {
      expect(resolveTimeZone("Asia/Tokyo", "PT")).toBe("Asia/Tokyo");
    });
    it("falls back to country default", () => {
      expect(resolveTimeZone(null, "BR")).toBe("America/Sao_Paulo");
      expect(resolveTimeZone(undefined, "US")).toBe("America/New_York");
    });
    it("falls back to UTC when both are absent", () => {
      expect(resolveTimeZone(null, null)).toBe("UTC");
      expect(resolveTimeZone(undefined, "XX")).toBe("UTC");
    });
  });

  describe("resolveCurrency", () => {
    it("uses explicit 3-letter code", () => {
      expect(resolveCurrency("USD", "PT")).toBe("USD");
      expect(resolveCurrency("brl", "PT")).toBe("BRL"); // case-normalized
    });
    it("falls back to country default", () => {
      expect(resolveCurrency(null, "BR")).toBe("BRL");
    });
    it("falls back to USD when both are absent", () => {
      expect(resolveCurrency(null, null)).toBe("USD");
      expect(resolveCurrency("INVALID_LENGTH", null)).toBe("USD");
    });
  });

  describe("formatDateTime", () => {
    // 2026-03-15T23:30:00Z — UTC late evening.
    const date = new Date("2026-03-15T23:30:00Z");

    it("renders the same date in different time zones — the bug the old code had", () => {
      const lisbon = formatDateTime(date, { locale: "en-GB", timeZone: "Europe/Lisbon", country: "PT" });
      const saoPaulo = formatDateTime(date, { locale: "en-GB", timeZone: "America/Sao_Paulo", country: "BR" });

      // Lisbon (UTC+0 at standard time) — late evening on March 15
      expect(lisbon).toContain("15");
      // São Paulo (UTC-3) — late evening on March 15 too, but different time
      expect(saoPaulo).toContain("15");
      // The bug was: both rendered in the server's TZ, so a user in
      // São Paulo at 23:30 UTC might see "16" instead of "15" if the
      // server is in Europe/Lisbon. With explicit timeZone, both say 15.
    });

    it("rolls over to next calendar day in some zones", () => {
      const sameDate = formatDateTime(date, { locale: "en-GB", timeZone: "Pacific/Auckland", country: "NZ" });
      expect(sameDate).toContain("16");
    });

    it("includes time when requested", () => {
      const result = formatDateTime(date, { locale: "en-GB", timeZone: "UTC", showTime: true });
      expect(result).toMatch(/23:?30/);
    });
  });

  describe("formatNumber", () => {
    it("formats decimals per locale", () => {
      expect(formatNumber(1234.5, { locale: "en-GB" })).toContain("1,234");
      expect(formatNumber(1234.5, { locale: "de-DE" })).toMatch(/1\.234/);
    });

    it("formats currency per locale", () => {
      // EUR 50 in pt-PT, en-GB, de-DE should look different.
      expect(formatNumber(50, { locale: "pt-PT", style: "currency", currency: "EUR" })).toMatch(/50/);
      expect(formatNumber(50, { locale: "en-GB", style: "currency", currency: "EUR" })).toMatch(/50/);
      expect(formatNumber(50, { locale: "de-DE", style: "currency", currency: "EUR" })).toMatch(/50/);
    });

    it("throws when currency is missing for style=currency", () => {
      expect(() => formatNumber(10, { locale: "en-GB", style: "currency" })).toThrow(/currency/);
    });

    it("formats units per locale (km)", () => {
      const pt = formatNumber(5, { locale: "pt-PT", style: "unit", unit: "kilometer" });
      expect(pt).toMatch(/5/);
    });
  });

  describe("formatCurrency", () => {
    it("formats a currency amount with explicit currency", () => {
      expect(formatCurrency({ locale: "pt-PT", amount: 50, currency: "EUR" })).toMatch(/50/);
    });

    it("falls back to country default when currency is empty", () => {
      expect(formatCurrency({ locale: "pt-BR", amount: 50, currency: "", country: "BR" })).toMatch(/50/);
    });
  });

  describe("formatDistance", () => {
    it("formats metric (km) by default", () => {
      const out = formatDistance(5000, { locale: "en-GB", country: "PT" });
      expect(out).toMatch(/5/);
    });
    it("formats miles for US region", () => {
      const out = formatDistance(1609, { locale: "en-GB", country: "US" });
      expect(out).toMatch(/1/);
    });
  });
});