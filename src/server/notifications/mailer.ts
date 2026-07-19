/**
 * Mailer implementations for the `Mailer` port
 * (src/server/services/notification-dispatch-service.ts). ARCHITECTURE.md
 * §4.5: "Resend for transactional email... WhatsApp is link-out only,
 * never a Notification channel in the MVP."
 *
 * `createMailer()` is the only thing production code (the worker) should
 * call — it picks the real `ResendMailer` when `RESEND_API_KEY` is
 * configured, and falls back to `ConsoleMailer` otherwise, so the worker
 * (and any local/manual-QA run of it) never needs real Resend credentials
 * to function.
 *
 * Suppression (T22): before sending, `ResendMailer` consults an
 * `EmailSuppressionChecker` (production-wired to
 * `PrismaEmailSuppressionChecker`) and short-circuits with
 * `EmailAddressSuppressedError` if the recipient has a bounce/complaint
 * flag set by the Resend webhook (T21). This keeps us from re-sending to
 * an address we already know will bounce, and avoids burning a Resend
 * quota call for the privilege. `ConsoleMailer` deliberately has no
 * suppression check — local dev should always be able to send, otherwise
 * a stale bounce flag from a previous prod migration would break QA.
 */

import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Resend } from "resend";
import { PrismaEmailSuppressionChecker } from "@/server/repositories/prisma-email-suppression-checker";
import type {
  EmailSuppressionChecker,
  Mailer,
  MailMessage,
} from "@/server/services/notification-dispatch-service";

/**
 * Returns the first 12 hex chars of SHA-256(email) — enough to uniquely
 * correlate a delivery failure to a notification row in triage, not
 * enough to recover the address. Used in `ResendDeliveryError.message`
 * so the recipient's email isn't persisted into `Notification.lastError`
 * (which bypasses the logger's PII redaction at `src/server/logger.ts`).
 */
function hashRecipientForLog(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}

export class MissingResendApiKeyError extends Error {
  constructor() {
    super(
      "ResendMailer was used without RESEND_API_KEY configured. Set RESEND_API_KEY " +
        "in the environment, or let createMailer() fall back to ConsoleMailer for local dev.",
    );
    this.name = "MissingResendApiKeyError";
  }
}

/**
 * Thrown by `ResendMailer.send` when the recipient is currently suppressed
 * (bounce or complaint flag set). The dispatch loop treats this as terminal
 * — no retry — because re-trying a known-bouncing address is wasted quota
 * and risks a downstream provider escalation. Distinct error class so the
 * dispatcher can `instanceof`-check and skip the retry path.
 */
export class EmailAddressSuppressedError extends Error {
  constructor(public reason: "bounced" | "complained") {
    // Message includes the class name so the dispatch loop's
    // `lastError` record (which stores `error.message`, not `.name`)
    // is searchable for "EmailAddressSuppressedError" in logs/DB.
    super(`EmailAddressSuppressedError: email suppressed (${reason})`);
    this.name = "EmailAddressSuppressedError";
  }
}

/**
 * Thrown by `ResendMailer.send` when the Resend API returns a non-zero
 * `error` from `emails.send`. Named class per AGENTS.md convention
 * (callers can `instanceof`-check), and critically: the recipient's
 * email address is NOT in the `message` — `error.message` gets
 * persisted into `Notification.lastError` by the dispatch loop, and
 * `email` is in the logger's PII redaction list (`src/server/logger.ts`).
 * Embedding it here would bypass that redaction at the DB layer.
 */
export class ResendDeliveryError extends Error {
  constructor(
    public readonly resendMessage: string,
    public readonly recipientHash: string,
  ) {
    // `recipientHash` is a short SHA-256 prefix (non-reversible) so an
    // operator triaging a delivery failure can correlate to a specific
    // notification row without the email itself landing in `lastError`.
    super(
      `ResendDeliveryError: API rejected send (recipient=${recipientHash}): ${resendMessage}`,
    );
    this.name = "ResendDeliveryError";
  }
}

/**
 * Real transactional email delivery via Resend
 * (https://resend.com/docs/api-reference/emails/send-email). Reads
 * `RESEND_API_KEY`/`RESEND_FROM_EMAIL` from the environment (see
 * .env.example) — never hardcode a key.
 *
 * The optional `checker` and `client` constructor args are test seams —
 * prod code calls `createMailer()` (which wires the real
 * `PrismaEmailSuppressionChecker`); tests inject a fake checker and a
 * fake `Resend` client to avoid hitting either service.
 */
export class ResendMailer implements Mailer {
  private readonly client: Resend;
  private readonly from: string;
  private readonly checker?: EmailSuppressionChecker;

  constructor(
    apiKey: string | undefined,
    from: string | undefined,
    options?: {
      /** Test seam: inject a fake Resend client instead of constructing one. */
      client?: Resend;
      /** Test/prod seam: inject the suppression checker. */
      checker?: EmailSuppressionChecker;
    },
  ) {
    if (!apiKey) {
      throw new MissingResendApiKeyError();
    }
    this.client = options?.client ?? new Resend(apiKey);
    // Falls back to a placeholder sender rather than throwing — a missing
    // RESEND_FROM_EMAIL is a config mistake best surfaced by Resend's own
    // API error (which includes exactly what's wrong with the address)
    // rather than a second bespoke error class here.
    this.from = from || "notificacoes@casadacidade.example";
    this.checker = options?.checker;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.checker) {
      const reason = await this.checker.checkStatus(message.to);
      if (reason !== null) {
        throw new EmailAddressSuppressedError(reason);
      }
    }

    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

    if (error) {
      // Do NOT embed `message.to` in the error message — `error.message`
      // is persisted into Notification.lastError by the dispatch loop,
      // and `email` is PII (per `src/server/logger.ts` REDACTED_KEYS).
      // Instead, hash the recipient so an operator triaging a failed
      // send can correlate to a notification row without leaking PII.
      const recipientHash = hashRecipientForLog(message.to);
      throw new ResendDeliveryError(error.message, recipientHash);
    }
  }
}

/**
 * Dev/CI-friendly `Mailer` — no real email infrastructure required.
 * Every send is:
 *   1. Logged clearly to stdout (recipient, subject, body).
 *   2. Appended as a JSON line to `.dev-outbox/emails.jsonl` (gitignored),
 *      so a manual QA pass (someone clicking through the app in a
 *      browser) can open that file and confirm a notification actually
 *      "fired" without needing a real inbox.
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly outboxPath: string = join(process.cwd(), ".dev-outbox", "emails.jsonl")) {}

  async send(message: MailMessage): Promise<void> {
    console.log(
      `[ConsoleMailer] would send email\n  to:      ${message.to}\n  subject: ${message.subject}\n  body:\n${indent(message.text)}`,
    );

    await mkdir(dirname(this.outboxPath), { recursive: true });
    const line =
      JSON.stringify({
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html ?? null,
        sentAt: new Date().toISOString(),
      }) + "\n";
    await appendFile(this.outboxPath, line, "utf8");
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

/**
 * Picks `ResendMailer` when `RESEND_API_KEY` is set, else `ConsoleMailer`
 * — so the worker never needs Resend credentials to run locally/in CI.
 * When picking `ResendMailer`, wires the production
 * `PrismaEmailSuppressionChecker` so bounce/complaint flags set by the
 * Resend webhook (T21) short-circuit sends before they hit the API.
 */
export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendMailer(apiKey, process.env.RESEND_FROM_EMAIL, {
      checker: new PrismaEmailSuppressionChecker(),
    });
  }
  return new ConsoleMailer();
}
