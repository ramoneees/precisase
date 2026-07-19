import { beforeEach, describe, expect, it } from "vitest";
import { EmailAddressSuppressedError } from "@/server/notifications/mailer";
import {
  MAX_DELIVERY_ATTEMPTS,
  NotificationDispatchService,
  type EmailContent,
  type MailMessage,
  type Mailer,
  type NotificationDispatchRepository,
  type NotificationEmailBuilder,
  type NotificationRecord,
} from "./notification-dispatch-service";

/**
 * Lightweight in-memory fake implementing the `NotificationDispatchRepository`
 * port, so these tests exercise real `NotificationDispatchService` batch/retry
 * logic without a live Postgres/Prisma connection — same pattern as
 * `InMemoryPostRepository`/`InMemoryInterestRepository`.
 */
class InMemoryNotificationDispatchRepository implements NotificationDispatchRepository {
  readonly notifications = new Map<string, NotificationRecord>();
  readonly markSentCalls: { id: string; sentAt: Date }[] = [];
  readonly recordFailedAttemptCalls: { id: string; error: string }[] = [];
  readonly markFailedCalls: { id: string; error: string }[] = [];

  seed(notification: NotificationRecord): void {
    this.notifications.set(notification.id, notification);
  }

  async listQueued(limit: number): Promise<NotificationRecord[]> {
    return Array.from(this.notifications.values())
      .filter((n) => n.status === "queued")
      .slice(0, limit);
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    this.markSentCalls.push({ id, sentAt });
    const existing = this.notifications.get(id);
    if (existing) {
      this.notifications.set(id, { ...existing, status: "sent" });
    }
  }

  async recordFailedAttempt(id: string, error: string): Promise<void> {
    this.recordFailedAttemptCalls.push({ id, error });
    const existing = this.notifications.get(id);
    if (existing) {
      this.notifications.set(id, {
        ...existing,
        attempts: existing.attempts + 1,
        lastError: error,
      });
    }
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.markFailedCalls.push({ id, error });
    const existing = this.notifications.get(id);
    if (existing) {
      this.notifications.set(id, {
        ...existing,
        status: "failed",
        attempts: existing.attempts + 1,
        lastError: error,
      });
    }
  }
}

/** Records every call; sends succeed unless configured to throw for a `to`. */
class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  private readonly failFor = new Set<string>();
  private readonly suppressedFor = new Map<string, "bounced" | "complained">();

  failWhenSendingTo(to: string): void {
    this.failFor.add(to);
  }

  suppressWhenSendingTo(to: string, reason: "bounced" | "complained"): void {
    this.suppressedFor.set(to, reason);
  }

  async send(message: MailMessage): Promise<void> {
    const suppression = this.suppressedFor.get(message.to);
    if (suppression !== undefined) {
      throw new EmailAddressSuppressedError(suppression);
    }
    if (this.failFor.has(message.to)) {
      throw new Error(`Simulated mailer failure for ${message.to}`);
    }
    this.sent.push(message);
  }
}

/** Trivial email builder — real templating is exercised in email-templates.test.ts. */
class FakeEmailBuilder implements NotificationEmailBuilder {
  async build(notification: NotificationRecord): Promise<EmailContent> {
    return {
      subject: `Subject for ${notification.type}`,
      text: `Body for ${notification.type}`,
    };
  }
}

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "notif-1",
    recipientId: "user-1",
    recipientEmail: "author@example.com",
    recipientDisplayName: "Ana",
    recipientLocale: "pt-PT",
    postId: "post-1",
    type: "post_approved",
    channel: "email",
    payload: { postId: "post-1", title: "Preciso de um sofá" },
    status: "queued",
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("NotificationDispatchService.dispatchQueued", () => {
  let repo: InMemoryNotificationDispatchRepository;
  let mailer: FakeMailer;
  let emailBuilder: FakeEmailBuilder;
  let service: NotificationDispatchService;

  beforeEach(() => {
    repo = new InMemoryNotificationDispatchRepository();
    mailer = new FakeMailer();
    emailBuilder = new FakeEmailBuilder();
    service = new NotificationDispatchService(repo, mailer, emailBuilder);
  });

  it("no-ops cleanly when the queue is empty", async () => {
    const results = await service.dispatchQueued();

    expect(results).toEqual([]);
    expect(mailer.sent).toHaveLength(0);
    expect(repo.markSentCalls).toHaveLength(0);
  });

  it("builds an email, sends it, and marks the notification sent on success", async () => {
    repo.seed(makeNotification());

    const results = await service.dispatchQueued();

    expect(results).toEqual([{ id: "notif-1", outcome: "sent" }]);
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: "author@example.com",
        subject: "Subject for post_approved",
        text: "Body for post_approved",
      }),
    ]);
    expect(repo.markSentCalls).toHaveLength(1);
    expect(repo.markSentCalls[0].id).toBe("notif-1");
    expect(repo.markSentCalls[0].sentAt).toBeInstanceOf(Date);
  });

  it("stays queued and records the attempt/error when a delivery failure is under the max-attempts threshold", async () => {
    repo.seed(makeNotification({ id: "notif-2", attempts: 0 }));
    mailer.failWhenSendingTo("author@example.com");

    const results = await service.dispatchQueued();

    expect(results).toEqual([{ id: "notif-2", outcome: "retrying" }]);
    expect(repo.recordFailedAttemptCalls).toHaveLength(1);
    expect(repo.recordFailedAttemptCalls[0]).toEqual(
      expect.objectContaining({ id: "notif-2" }),
    );
    expect(repo.markFailedCalls).toHaveLength(0);

    const updated = repo.notifications.get("notif-2");
    expect(updated?.status).toBe("queued");
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toContain("Simulated mailer failure");
  });

  it(`marks the notification failed once attempts reach the ${MAX_DELIVERY_ATTEMPTS}-attempt threshold`, async () => {
    repo.seed(
      makeNotification({ id: "notif-3", attempts: MAX_DELIVERY_ATTEMPTS - 1 }),
    );
    mailer.failWhenSendingTo("author@example.com");

    const results = await service.dispatchQueued();

    expect(results).toEqual([{ id: "notif-3", outcome: "failed" }]);
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.recordFailedAttemptCalls).toHaveLength(0);

    const updated = repo.notifications.get("notif-3");
    expect(updated?.status).toBe("failed");
    expect(updated?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(updated?.lastError).toContain("Simulated mailer failure");
  });

  it("does not let one notification's failure stop the rest of the batch", async () => {
    repo.seed(
      makeNotification({
        id: "notif-a",
        recipientEmail: "broken@example.com",
      }),
    );
    repo.seed(
      makeNotification({
        id: "notif-b",
        recipientEmail: "ok@example.com",
      }),
    );
    mailer.failWhenSendingTo("broken@example.com");

    const results = await service.dispatchQueued();

    expect(results).toEqual([
      { id: "notif-a", outcome: "retrying" },
      { id: "notif-b", outcome: "sent" },
    ]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("ok@example.com");
    expect(repo.markSentCalls).toHaveLength(1);
    expect(repo.recordFailedAttemptCalls).toHaveLength(1);
  });

  it("also treats an email-builder failure as a delivery failure (retry, not a crash)", async () => {
    repo.seed(makeNotification({ id: "notif-4" }));
    const throwingBuilder: NotificationEmailBuilder = {
      build: async () => {
        throw new Error("Unknown notification type");
      },
    };
    service = new NotificationDispatchService(repo, mailer, throwingBuilder);

    const results = await service.dispatchQueued();

    expect(results).toEqual([{ id: "notif-4", outcome: "retrying" }]);
    expect(mailer.sent).toHaveLength(0);
    expect(repo.recordFailedAttemptCalls[0].error).toContain("Unknown notification type");
  });

  it("respects a custom limit by only asking the repository for that many queued rows", async () => {
    repo.seed(makeNotification({ id: "notif-1" }));
    repo.seed(makeNotification({ id: "notif-2", recipientEmail: "second@example.com" }));

    const results = await service.dispatchQueued(1);

    expect(results).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it("allows a custom maxAttempts threshold to be configured", async () => {
    const strictService = new NotificationDispatchService(repo, mailer, emailBuilder, {
      maxAttempts: 2,
    });
    repo.seed(makeNotification({ id: "notif-5", attempts: 1 }));
    mailer.failWhenSendingTo("author@example.com");

    const results = await strictService.dispatchQueued();

    expect(results).toEqual([{ id: "notif-5", outcome: "failed" }]);
    expect(repo.markFailedCalls).toHaveLength(1);
  });

  it("marks a suppressed-address notification as failed immediately (no retry, even on attempt 0)", async () => {
    repo.seed(makeNotification({ id: "notif-suppressed", attempts: 0 }));
    mailer.suppressWhenSendingTo("author@example.com", "bounced");

    const results = await service.dispatchQueued();

    // Outcome is `failed`, not `retrying` — suppression is terminal.
    expect(results).toEqual([{ id: "notif-suppressed", outcome: "failed" }]);
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.recordFailedAttemptCalls).toHaveLength(0);

    const updated = repo.notifications.get("notif-suppressed");
    expect(updated?.status).toBe("failed");
    expect(updated?.lastError).toContain("EmailAddressSuppressedError");
    expect(updated?.lastError).toContain("bounced");
  });

  it("marks a complaint-suppressed notification as failed immediately", async () => {
    repo.seed(makeNotification({ id: "notif-complained", attempts: 2 }));
    mailer.suppressWhenSendingTo("author@example.com", "complained");

    const results = await service.dispatchQueued();

    expect(results).toEqual([{ id: "notif-complained", outcome: "failed" }]);
    expect(repo.markFailedCalls).toHaveLength(1);
    expect(repo.recordFailedAttemptCalls).toHaveLength(0);
    // lastError mentions the suppression reason for operator review.
    expect(repo.markFailedCalls[0].error).toContain("complained");
  });
});
