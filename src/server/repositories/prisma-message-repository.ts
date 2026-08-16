/**
 * Prisma-backed implementation of the `MessageRepository` port
 * (src/server/services/message-service.ts).
 *
 * Ordering contract: `listByConversation` returns messages NEWEST-first
 * (`orderBy createdAt desc`) so the service can reverse to oldest-first
 * for display — the in-memory fake in message-service.test.ts mirrors
 * this. `updateLastMessageAt` writes the parent Conversation row, which
 * also bumps its `@updatedAt` and keeps the inbox ordering fresh.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  type MessageRecord,
  type MessageRepository,
  type MessageSummary,
} from "@/server/services/message-service";
import { prisma } from "./prisma-client";

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.MessageSelect;

function toMessageRecord(row: Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    content: row.content,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export class PrismaMessageRepository implements MessageRepository {
  async createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
  }): Promise<MessageRecord> {
    const row = await prisma.message.create({ data, select: MESSAGE_SELECT });
    return toMessageRecord(row);
  }

  async listByConversation(
    conversationId: string,
    limit: number,
    before?: Date,
  ): Promise<MessageSummary[]> {
    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        ...MESSAGE_SELECT,
        sender: { select: { displayName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      senderName: row.sender.displayName,
      content: row.content,
      readAt: row.readAt,
      createdAt: row.createdAt,
    }));
  }

  async markAsRead(conversationId: string, userId: string): Promise<number> {
    const result = await prisma.message.updateMany({
      where: {
        conversationId,
        senderId: { not: userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async hasUnreadForRecipient(conversationId: string, recipientId: string): Promise<boolean> {
    const unread = await prisma.message.findFirst({
      where: {
        conversationId,
        senderId: { not: recipientId },
        readAt: null,
      },
      select: { id: true },
    });
    return unread !== null;
  }

  async updateLastMessageAt(conversationId: string, date: Date): Promise<void> {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: date },
    });
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await prisma.message.deleteMany({ where: { senderId: userId } });
    return result.count;
  }
}
