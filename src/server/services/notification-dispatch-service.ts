/**
 * NotificationDispatchService — reads `queued` `Notification` rows written
 * by `PostService`/`InterestService` (via their respective repositories'
 * `addNotification()`) and actually delivers them, closing the gap
 * described in docs/ARCHITECTURE.md §3.1 ("a separate worker process
 * handles asynchronous notifications") and §6.1–6.3.
 *
 * Like `PostService`/`InterestService`, this module depends on narrow
 * ports (`NotificationDispatchRepository`, `Mailer`, `NotificationEmailBuilder`)
 * rather than Prisma/Resend directly, so the batch-processing and
 * retry/max-attempts logic is unit-testable with in-memory fakes — no
 * live DB or real email needed (see notification-dispatch-service.test.ts).
 * The production wiring (Prisma-backed repository, Resend-backed mailer,
 * next-intl-backed email builder) lives in `src/worker/notification-worker.ts`.
 *
 * Retry policy: a failed delivery attempt increments `attempts` and
 * records `lastError`, but the row is only moved to a terminal `failed`
 * status once `attempts` reaches `MAX_DELIVERY_ATTEMPTS` (5) — otherwise it
 * is left `queued` so the next poll picks it up again. Five attempts gives
 * a transient failure (e.g. Resend hiccup, momentary network blip) several
 * chances to succeed on a later pass without a human ever seeing a
 * "notification failed" state for what was really a 30-second outage,
 * while still bounding retries so a permanently-broken address (or a
 * misconfigured mailer) doesn't retry forever.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention — mirrors
// PostService/InterestService: no import of app-layer types that may not
// exist yet). The ONE exception is the error type imported below — it's
// a sentinel thrown by `ResendMailer` so the dispatch loop can detect
// "this address is suppressed, don't retry" without parsing error
// messages. Same pattern as `MissingResendApiKeyError`.
// ---------------------------------------------------------------------

import { EmailAddressSuppressedError } from "@/server/notifications/mailer";

export type NotificationTypeValue =
  | "interest_received"
  | "post_approved"
  | "post_rejected"
  | "post_closed"
  | "password_reset";

export type NotificationChannelValue = "email" | "in_app";

export type NotificationStatusValue = "queued" | "sent" | "failed";

/**
 * A queued notification, joined with just enough of its recipient (`User`)
 * to actually deliver it — email address and locale (for the email
 * template) and display name (for template greetings). Repository
 * implementations are responsible for producing this join; the service
 * itself never queries `User` directly.
 */
export interface NotificationRecord {
  id: string;
  recipientId: string;
  recipientEmail: string;
  recipientDisplayName: string;
  recipientLocale: string;
  postId: string | null;
  type: NotificationTypeValue;
  channel: NotificationChannelValue;
  payload: Record<string, unknown>;
  status: NotificationStatusValue;
  attempts: number;
  lastError: string | null;
}

/** A fully-built email, ready to hand to a `Mailer`. */
export interface EmailContent {
  subject: string;
  text: string;
  html?: string;
}

/**
 * Builds the email for a given notification (subject/body per `type` and
 * `payload`, localized via `recipientLocale`). Kept as its own port (rather
 * than inlined in the service) so the dispatch/retry logic can be unit
 * tested independently of i18n/template concerns.
 */
export interface NotificationEmailBuilder {
  build(notification: NotificationRecord): Promise<EmailContent>;
}

/** A message ready to be handed to an email provider. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Delivery port. `ResendMailer`/`ConsoleMailer` (src/server/notifications/mailer.ts)
 * implement this against a real/dev-friendly backend respectively.
 */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Port for the suppression check `ResendMailer` does before sending (T22).
 * Read-side of the columns set by the Resend webhook (T21). Returns
 * `"bounced"` / `"complained"` if the address has a current suppression
 * flag, or `null` if it's clear. Declared here (alongside `Mailer`)
 * rather than in `mailer.ts` so the dispatch service's domain contract
 * for "what does a mailer need to know about a recipient?" stays in one
 * place — same pattern as `NotificationDispatchRepository`.
 */
export interface EmailSuppressionChecker {
  /** Returns "bounced" | "complained" | null. */
  checkStatus(email: string): Promise<"bounced" | "complained" | null>;
}

/**
 * Data-access port consumed by `NotificationDispatchService`. Keeping this
 * narrow (rather than depending on the full Prisma client) is what makes
 * the batch/retry logic unit-testable without a database — same pattern as
 * `PostRepository`/`InterestRepository`.
 */
export interface NotificationDispatchRepository {
  /** Oldest-first queued notifications, joined with recipient email/locale/name. */
  listQueued(limit: number): Promise<NotificationRecord[]>;
  /** Delivery succeeded — terminal `sent` status. */
  markSent(id: string, sentAt: Date): Promise<void>;
  /**
   * Delivery failed but the row stays `queued` for a later retry pass:
   * increments `attempts` and records `lastError` without changing
   * `status`.
   */
  recordFailedAttempt(id: string, error: string): Promise<void>;
  /**
   * Delivery failed and the max-attempts threshold has been reached:
   * increments `attempts`, records `lastError`, and moves `status` to the
   * terminal `failed` state.
   */
  markFailed(id: string, error: string): Promise<void>;
}

/**
 * Max number of delivery attempts (this failure included) before a
 * notification is given up on and marked `failed` instead of retried.
 * Exported so the worker/tests can reference the same threshold rather
 * than duplicating the magic number.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Default number of queued notifications processed per `dispatchQueued()` call. */
export const DEFAULT_BATCH_SIZE = 20;

export type NotificationDispatchOutcome = "sent" | "retrying" | "failed";

export interface NotificationDispatchResult {
  id: string;
  outcome: NotificationDispatchOutcome;
}

export class NotificationDispatchService {
  constructor(
    private readonly repo: NotificationDispatchRepository,
    private readonly mailer: Mailer,
    private readonly emailBuilder: NotificationEmailBuilder,
    private readonly options: { maxAttempts?: number } = {},
  ) {}

  private get maxAttempts(): number {
    return this.options.maxAttempts ?? MAX_DELIVERY_ATTEMPTS;
  }

  /**
   * Processes up to `limit` queued notifications: builds an email from
   * each one's `type`/`payload`, sends it, and marks the row `sent` on
   * success. A single notification's failure (email-build error or
   * mailer error) is caught and recorded — it never stops the rest of the
   * batch from being processed. No-ops cleanly when the queue is empty.
   */
  async dispatchQueued(limit: number = DEFAULT_BATCH_SIZE): Promise<NotificationDispatchResult[]> {
    const queued = await this.repo.listQueued(limit);

    const results: NotificationDispatchResult[] = [];
    for (const notification of queued) {
      results.push(await this.dispatchOne(notification));
    }
    return results;
  }

  private async dispatchOne(
    notification: NotificationRecord,
  ): Promise<NotificationDispatchResult> {
    try {
      const email = await this.emailBuilder.build(notification);
      await this.mailer.send({
        to: notification.recipientEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      await this.repo.markSent(notification.id, new Date());
      return { id: notification.id, outcome: "sent" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Suppression is terminal — re-trying a known-bouncing address wastes
      // quota and risks provider escalation. Mark failed immediately
      // without incrementing attempts beyond the implicit 1 for this pass.
      if (error instanceof EmailAddressSuppressedError) {
        await this.repo.markFailed(notification.id, message);
        return { id: notification.id, outcome: "failed" };
      }

      const attemptsAfterThisFailure = notification.attempts + 1;

      if (attemptsAfterThisFailure >= this.maxAttempts) {
        await this.repo.markFailed(notification.id, message);
        return { id: notification.id, outcome: "failed" };
      }

      await this.repo.recordFailedAttempt(notification.id, message);
      return { id: notification.id, outcome: "retrying" };
    }
  }
}
