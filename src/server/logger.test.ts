import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

/**
 * `logger` writes a single JSON string to `console.log`; these tests spy on
 * `console.log`, parse the JSON argument, and assert on shape + PII
 * redaction (docs/ARCHITECTURE.md PII inventory: email/phone/password/
 * contactValue/mfaSecret/hashedToken).
 */
describe("logger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function loggedEntry(): Record<string, unknown> {
    expect(logSpy).toHaveBeenCalledTimes(1);
    const arg = logSpy.mock.calls[0]?.[0];
    return JSON.parse(arg as string);
  }

  it("redacts the email field", () => {
    logger.info({ module: "test", event: "x", email: "a@b.c" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).email).toBe("[REDACTED]");
  });

  it("redacts the phone field", () => {
    logger.info({ module: "test", event: "x", phone: "+351911111111" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).phone).toBe("[REDACTED]");
  });

  it("redacts the password field", () => {
    logger.warn({ module: "test", event: "x", password: "hunter2" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).password).toBe("[REDACTED]");
  });

  it("redacts the contactValue field", () => {
    logger.info({ module: "test", event: "x", contactValue: "call me" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).contactValue).toBe("[REDACTED]");
  });

  it("redacts the mfaSecret field", () => {
    logger.info({ module: "test", event: "x", mfaSecret: "JBSWY3DPEHPK3PXP" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).mfaSecret).toBe("[REDACTED]");
  });

  it("redacts the hashedToken field", () => {
    logger.info({ module: "test", event: "x", hashedToken: "abc123" });
    const entry = loggedEntry();
    expect((entry.fields as Record<string, unknown>).hashedToken).toBe("[REDACTED]");
  });

  it("passes through non-PII keys unchanged", () => {
    logger.info({ module: "test", event: "poll_complete", count: 3, durationMs: 42 });
    const entry = loggedEntry();
    const fields = entry.fields as Record<string, unknown>;
    expect(fields.count).toBe(3);
    expect(fields.durationMs).toBe(42);
    expect(fields.event).toBe("poll_complete");
  });

  it("produces the expected overall JSON shape", () => {
    logger.error({ module: "notification-worker", event: "poll_failed", error: "boom" });
    const entry = loggedEntry();
    expect(entry).toHaveProperty("ts");
    expect(entry).toHaveProperty("level", "error");
    expect(entry).toHaveProperty("msg");
    expect(entry).toHaveProperty("fields");
    expect(entry).toHaveProperty("module", "notification-worker");
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts as string).toString()).not.toBe("Invalid Date");
  });

  it("derives msg from fields.event when msg is not passed explicitly", () => {
    logger.info({ module: "test", event: "poll_complete" });
    const entry = loggedEntry();
    expect(entry.msg).toBe("poll_complete");
  });

  it("defaults msg to an empty string when no event or msg is passed", () => {
    logger.info({ module: "test", count: 1 });
    const entry = loggedEntry();
    expect(entry.msg).toBe("");
  });
});
