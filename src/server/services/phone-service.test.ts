import { describe, expect, it } from "vitest";
import { PhoneService, parsePhone, formatPhoneForDisplay, isLikelyE164 } from "./phone-service";

describe("PhoneService.parse", () => {
  describe("happy paths", () => {
    it("normalizes a Portuguese domestic number using the PT default", () => {
      const result = parsePhone("912 345 678");
      expect(result).toEqual({
        ok: true,
        e164: "+351912345678",
        national: "912 345 678",
        international: expect.stringMatching(/351/),
        country: "PT",
      });
    });

    it("normalizes a Brazilian number when country hint is BR", () => {
      // Typed mobile format with explicit BR area code (São Paulo 11).
      const result = parsePhone("(11) 99123-4567", "BR");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.e164).toBe("+5511991234567");
        expect(result.country).toBe("BR");
      }
    });

    it("accepts an already-E.164 input", () => {
      const result = parsePhone("+1 415 555 0123", "US");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.e164).toBe("+14155550123");
        expect(result.country).toBe("US");
      }
    });

    it("accepts 00-prefixed international format (PT) and normalizes", () => {
      const result = parsePhone("00 44 20 7946 0958", "PT");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.e164).toBe("+442079460958");
        expect(result.country).toBe("GB");
      }
    });
  });

  describe("error paths", () => {
    it("rejects empty input", () => {
      expect(parsePhone("")).toEqual({ ok: false, code: "EMPTY" });
      expect(parsePhone("   ")).toEqual({ ok: false, code: "EMPTY" });
    });

    it("rejects pure-garbage input as NOT_A_NUMBER", () => {
      const result = parsePhone("not a phone", "PT");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["NOT_A_NUMBER", "INVALID_FOR_COUNTRY", "TOO_SHORT"]).toContain(result.code);
      }
    });

    it("rejects a too-short number", () => {
      const result = parsePhone("123", "PT");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TOO_SHORT");
      }
    });

    it("rejects a too-long number", () => {
      const result = parsePhone("1".repeat(20), "US");
      expect(result.ok).toBe(false);
    });

    it("rejects a number that's invalid for the country", () => {
      // Real Brazilian landlines don't start with 0. libphonenumber-js
      // catches this as invalid-for-country or too-short.
      const result = parsePhone("0900-1234", "BR");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["INVALID_FOR_COUNTRY", "TOO_SHORT"]).toContain(result.code);
      }
    });
  });

  describe("country-hint precedence", () => {
    it("uses the explicit country hint when the input is domestic-format", () => {
      // PT mobile: 9 digits starting with 9. BR landline: 8 digits; the
      // library only knows the format from the country hint.
      const pt = parsePhone("912 345 678", "PT");
      const br = parsePhone("91234-5678", "BR");
      expect(pt.ok && br.ok).toBe(true);
      if (pt.ok && br.ok) {
        expect(pt.e164).toBe("+351912345678");
        expect(br.e164).toBe("+55912345678");
      }
    });

    it("overrides the country hint when the input starts with +", () => {
      // User typed "+44 ..." but their stored country is PT — accept GB.
      const result = parsePhone("+44 20 7946 0958", "PT");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.country).toBe("GB");
      }
    });
  });
});

describe("PhoneService.formatForDisplay", () => {
  it("formats an E.164 to the locale's national convention", () => {
    expect(formatPhoneForDisplay("+351912345678", { international: false })).toMatch(/912/);
  });

  it("formats an E.164 internationally by default", () => {
    expect(formatPhoneForDisplay("+351912345678")).toMatch(/\+351|351/);
  });

  it("falls back to the raw input on parse failure", () => {
    expect(formatPhoneForDisplay("not-a-number")).toBe("not-a-number");
  });
});

describe("PhoneService.isE164", () => {
  it("accepts canonical E.164", () => {
    expect(isLikelyE164("+351912345678")).toBe(true);
    expect(isLikelyE164("+14155550123")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isLikelyE164("912 345 678")).toBe(false);
    expect(isLikelyE164("+0123456789")).toBe(false);
    expect(isLikelyE164("+1")).toBe(false);
    expect(isLikelyE164("")).toBe(false);
  });
});

describe("PhoneService object form", () => {
  it("delegates to the standalone functions", () => {
    expect(PhoneService.parse("912 345 678", "PT")).toEqual(parsePhone("912 345 678", "PT"));
    expect(PhoneService.isE164("+351912345678")).toBe(isLikelyE164("+351912345678"));
  });
});