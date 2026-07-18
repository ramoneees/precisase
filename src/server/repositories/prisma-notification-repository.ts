/**
 * Prisma-backed implementation of the `NotificationDispatchRepository` port
 * (src/server/services/notification-dispatch-service.ts). This is the
 * "read" half of the notification pipeline — `PrismaPostRepository`/
 * `PrismaInterestRepository` already write `queued` `Notification` rows via
 * `addNotification()`; this repository is how the worker
 * (src/worker/notification-worker.ts) finds and processes them.
 */

import { Prisma } from "@/generated/prisma/client";
import type {
  NotificationDispatchRepository,
  NotificationRecord,
} from "@/server/services/notification-dispatch-service";
import { prisma } from "./prisma-client";

type NotificationWithRecipient = Prisma.NotificationGetPayload<{
  include: { recipient: { select: { email: true; displayName: true; locale: true } } };
}>;

interface QueuedNotificationRow {
  id: string;
  createdAt: Date;
  recipientId: string;
  postId: string | null;
  type: NotificationWithRecipient["type"];
  payload: NotificationWithRecipient["payload"];
  channel: NotificationWithRecipient["channel"];
  status: NotificationWithRecipient["status"];
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  updatedAt: Date;
  email: string;
  displayName: string;
  locale: string;
}

function toNotificationRecord(row: QueuedNotificationRow): NotificationRecord {
  return {
    id: row.id,
    recipientId: row.recipientId,
    recipientEmail: row.email,
    recipientDisplayName: row.displayName,
    recipientLocale: row.locale,
    postId: row.postId,
    type: row.type,
    channel: row.channel,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
  };
}

export class PrismaNotificationRepository implements NotificationDispatchRepository {
  /**
   * Oldest-first queued notifications, joined with the recipient's
   * email/display name/locale. Restricted to `channel: "email"` — that's
   * the only channel this worker knows how to deliver (§4.5: WhatsApp is
   * link-out only, never a Notification channel); `in_app` rows are left
   * for a future in-app inbox.
   *
   * Raw SQL because the per-row backoff (`updated_at < now() -
   * 30s*2^(attempts-1)`) is not expressible in Prisma's `where` API — it
   * requires comparing a per-row function of `attempts` against
   * `updated_at`, which Prisma's filter language can't do. Without this
   * guard, the worker re-picks every failing row every 10s and burns
   * through `MAX_DELIVERY_ATTEMPTS` in under a minute — turning a
   * 30-second Resend outage into permanent notification failures.
   */
  async listQueued(limit: number): Promise<NotificationRecord[]> {
    const rows = await prisma.$queryRaw<QueuedNotificationRow[]>`
      SELECT
        n.id, n.created_at AS "createdAt", n.recipient_id AS "recipientId",
        n.post_id AS "postId", n.type, n.payload, n.channel, n.status,
        n.attempts, n.last_error AS "lastError", n.sent_at AS "sentAt",
        n.updated_at AS "updatedAt",
        u.email, u.display_name AS "displayName", u.locale
      FROM notifications n
      JOIN users u ON u.id = n.recipient_id
      WHERE n.status = 'queued'::notification_status
        AND n.channel = 'email'::notification_channel
        AND (
          n.attempts = 0
          OR n.updated_at < (now() - make_interval(secs => 30 * power(2, n.attempts - 1)))
        )
      ORDER BY n.created_at ASC
      LIMIT ${limit}
    `;

    return rows.map(toNotificationRecord);
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    await prisma.notification.update({
      where: { id },
      data: { status: "sent", sentAt },
    });
  }

  async recordFailedAttempt(id: string, error: string): Promise<void> {
    await prisma.notification.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error,
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await prisma.notification.update({
      where: { id },
      data: {
        status: "failed",
        attempts: { increment: 1 },
        lastError: error,
      },
    });
  }
}
