/**
 * Prisma-backed implementation of the `ConversationRepository` port
 * (src/server/services/conversation-service.ts).
 *
 * `findByParticipant` builds the inbox summary in a single query: the
 * post relation supplies title/status, both participant relations supply
 * display names (the mapper picks the "other" side), a nested
 * `take: 1` message read supplies the last-message preview, and a
 * filtered `_count` supplies the unread badge count. Keyset pagination
 * rides the `(participant_a_id, updated_at)` /
 * `(participant_b_id, updated_at)` composite indexes.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  type ConversationRecord,
  type ConversationRepository,
  type ConversationSummary,
} from "@/server/services/conversation-service";
import { prisma } from "./prisma-client";

const CONVERSATION_SELECT = {
  id: true,
  interestId: true,
  postId: true,
  participantAId: true,
  participantBId: true,
  archived: true,
  archivedAt: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof CONVERSATION_SELECT }>;

function toConversationRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    interestId: row.interestId,
    postId: row.postId,
    participantAId: row.participantAId,
    participantBId: row.participantBId,
    archived: row.archived,
    archivedAt: row.archivedAt,
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  async findByInterestId(interestId: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({
      where: { interestId },
      select: CONVERSATION_SELECT,
    });
    return row ? toConversationRecord(row) : null;
  }

  async findIdByInterestId(interestId: string): Promise<string | null> {
    const row = await prisma.conversation.findUnique({
      where: { interestId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async createConversation(data: {
    interestId: string;
    postId: string;
    participantAId: string;
    participantBId: string;
  }): Promise<ConversationRecord> {
    const row = await prisma.conversation.create({ data, select: CONVERSATION_SELECT });
    return toConversationRecord(row);
  }

  async findByParticipant(
    userId: string,
    limit: number,
    cursor?: Date,
  ): Promise<ConversationSummary[]> {
    const rows = await prisma.conversation.findMany({
      where: {
        OR: [{ participantAId: userId }, { participantBId: userId }],
        ...(cursor ? { updatedAt: { lt: cursor } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        postId: true,
        archived: true,
        updatedAt: true,
        post: { select: { title: true, status: true } },
        participantA: { select: { id: true, displayName: true } },
        participantB: { select: { id: true, displayName: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
        _count: {
          select: {
            messages: { where: { senderId: { not: userId }, readAt: null } },
          },
        },
      },
    });

    return rows.map((row) => {
      const other =
        row.participantA.id === userId ? row.participantB : row.participantA;
      const lastMessage = row.messages[0] ?? null;
      return {
        id: row.id,
        postId: row.postId,
        postTitle: row.post.title,
        postStatus: row.post.status,
        otherParticipantName: other.displayName,
        otherParticipantId: other.id,
        lastMessageContent: lastMessage?.content ?? null,
        lastMessageAt: lastMessage?.createdAt ?? null,
        unreadCount: row._count.messages,
        archived: row.archived,
      };
    });
  }

  async findById(id: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({
      where: { id },
      select: CONVERSATION_SELECT,
    });
    return row ? toConversationRecord(row) : null;
  }

  async findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null> {
    const row = await prisma.conversation.findUnique({
      where: { id },
      select: CONVERSATION_SELECT,
    });
    if (!row) {
      return null;
    }
    if (row.participantAId !== userId && row.participantBId !== userId) {
      return null;
    }
    return toConversationRecord(row);
  }

  async archiveByPostId(postId: string): Promise<number> {
    const result = await prisma.conversation.updateMany({
      where: { postId, archived: false },
      data: { archived: true, archivedAt: new Date() },
    });
    return result.count;
  }

  async countUnreadForUser(userId: string): Promise<number> {
    return prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        conversation: {
          OR: [{ participantAId: userId }, { participantBId: userId }],
        },
      },
    });
  }
}
