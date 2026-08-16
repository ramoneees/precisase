/**
 * Prisma-backed implementation of the `MessageNotificationPort`
 * (src/server/services/message-service.ts). Queues an `in_app`
 * `chat_message_received` Notification row for the recipient — the
 * worker's `listQueued` deliberately filters `channel = 'email'`, so
 * these rows are never emailed (D2: the header badge, driven by
 * unread message counts, is the delivery surface for chat).
 */

import type {
  MessageNotificationPort,
  MessageNotificationRecord,
} from "@/server/services/message-service";
import { prisma } from "./prisma-client";

export class PrismaMessageNotificationPort implements MessageNotificationPort {
  async queueNotification(n: MessageNotificationRecord): Promise<void> {
    await prisma.notification.create({
      data: {
        recipientId: n.recipientId,
        type: "chat_message_received",
        channel: "in_app",
        status: "queued",
        payload: {
          conversationId: n.conversationId,
          senderId: n.senderId,
          senderName: n.senderName,
          postTitle: n.postTitle,
        },
      },
    });
  }
}
