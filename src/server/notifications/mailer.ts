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
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Resend } from "resend";
import type { Mailer, MailMessage } from "@/server/services/notification-dispatch-service";

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
 * Real transactional email delivery via Resend
 * (https://resend.com/docs/api-reference/emails/send-email). Reads
 * `RESEND_API_KEY`/`RESEND_FROM_EMAIL` from the environment (see
 * .env.example) — never hardcode a key.
 */
export class ResendMailer implements Mailer {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string | undefined, from: string | undefined) {
    if (!apiKey) {
      throw new MissingResendApiKeyError();
    }
    this.client = new Resend(apiKey);
    // Falls back to a placeholder sender rather than throwing — a missing
    // RESEND_FROM_EMAIL is a config mistake best surfaced by Resend's own
    // API error (which includes exactly what's wrong with the address)
    // rather than a second bespoke error class here.
    this.from = from || "notificacoes@casadacidade.example";
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

    if (error) {
      throw new Error(`Resend failed to send email to ${message.to}: ${error.message}`);
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
 */
export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    return new ResendMailer(apiKey, process.env.RESEND_FROM_EMAIL);
  }
  return new ConsoleMailer();
}
