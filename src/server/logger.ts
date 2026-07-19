/**
 * Structured JSON logger — docs/ops observability (plan `mvp-launch-readiness.md`
 * T2). Deliberately dependency-free: does NOT import `@sentry/nextjs` (that
 * wiring lives in `sentry.server.config.ts`, owned by a parallel workstream).
 * Plain `console.log` JSON output only, so this module never crashes if
 * Sentry isn't installed/configured.
 *
 * Callers pass a single object, e.g.
 *   logger.info({ module: "notification-worker", event: "poll_complete", sent: 3 })
 * `module` is pulled out to its own top-level key; everything else stays
 * under `fields`. Known-PII keys are redacted before serialization — see
 * `REDACTED_KEYS` below (matches `docs/ARCHITECTURE.md` PII inventory:
 * email/phone/password/contactValue/mfaSecret/hashedToken).
 */

type LogLevel = "info" | "warn" | "error";

type LogInput = Record<string, unknown> & {
  module?: string;
  msg?: string;
};

const REDACTED_KEYS = new Set([
  "email",
  "phone",
  "password",
  "contactValue",
  "mfaSecret",
  "hashedToken",
]);

const REDACTED_VALUE = "[REDACTED]";

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = REDACTED_KEYS.has(key) ? REDACTED_VALUE : value;
  }
  return redacted;
}

function write(level: LogLevel, input: LogInput): void {
  const { module, msg, ...rest } = input;
  const fields = redactFields(rest);
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: msg ?? (typeof fields.event === "string" ? fields.event : ""),
    fields,
    module: module ?? "",
  };
  console.log(JSON.stringify(entry));
}

export const logger = {
  info(input: LogInput): void {
    write("info", input);
  },
  warn(input: LogInput): void {
    write("warn", input);
  },
  error(input: LogInput): void {
    write("error", input);
  },
};
