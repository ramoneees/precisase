import { describe, it, expect } from "vitest";
import {
  MessageService,
  type MessageRepository,
  type MessageNotificationPort,
  type ConversationLookupPort,
  type MessageRecord,
  type ConversationRecord,
  EmptyMessageError,
  MessageTooLongError,
  MAX_MESSAGE_LENGTH,
} from "./message-service";
import type { ConversationRecord as ConvRecord } from "./conversation-service";

class InMemoryMessageRepository implements MessageRepository {
  messages: MessageRecord[] = [];
  lastMessageAtUpdates: { conversationId: string; date: Date }[] = [];

  async createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
  }) {
    const msg: MessageRecord = {
      id: `msg-${this.messages.length + 1}`,
      conversationId: data.conversationId,
      senderId: data.senderId,
      content: data.content,
      readAt: null,
      createdAt: new Date(),
    };
    this.messages.push(msg);
    return msg;
  }

  async listByConversation(conversationId: string, limit: number, before?: Date) {
    let filtered = this.messages.filter(m => m.conversationId === conversationId);
    if (before) {
      filtered = filtered.filter(m => m.createdAt < before);
    }
    const sliced = filtered.slice(-limit);
    // Newest-first, mirroring the Prisma impl's `orderBy createdAt desc` —
    // the service reverses to oldest-first for display.
    return sliced.reverse().map(m => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderName: `User-${m.senderId}`,
      content: m.content,
      readAt: m.readAt,
      createdAt: m.createdAt,
    }));
  }

  async markAsRead(conversationId: string, userId: string) {
    let count = 0;
    for (const m of this.messages) {
      if (m.conversationId === conversationId && m.senderId !== userId && !m.readAt) {
        m.readAt = new Date();
        count++;
      }
    }
    return count;
  }

  async hasUnreadForRecipient(conversationId: string, recipientId: string) {
    return this.messages.some(
      m => m.conversationId === conversationId
        && m.senderId !== recipientId
        && !m.readAt
    );
  }

  async updateLastMessageAt(conversationId: string, date: Date) {
    this.lastMessageAtUpdates.push({ conversationId, date });
  }

  async deleteByUserId(userId: string) {
    const before = this.messages.length;
    this.messages = this.messages.filter(m => m.senderId !== userId);
    return before - this.messages.length;
  }
}

class InMemoryNotificationPort implements MessageNotificationPort {
  queued: { recipientId: string; conversationId: string }[] = [];
  async queueNotification(n: { recipientId: string; conversationId: string }) {
    this.queued.push(n);
  }
}

class InMemoryConversationLookup implements ConversationLookupPort {
  conversations = new Map<string, ConversationRecord>();
  async findByIdForUser(id: string, userId: string) {
    const c = this.conversations.get(id);
    if (!c) return null;
    if (c.participantAId !== userId && c.participantBId !== userId) return null;
    return c;
  }
}

function makeConv(overrides: Partial<ConvRecord> = {}): ConvRecord {
  return {
    id: "conv-1",
    interestId: "int-1",
    postId: "post-1",
    participantAId: "author-1",
    participantBId: "user-1",
    archived: false,
    archivedAt: null,
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("MessageService", () => {
  async function setup() {
    const repo = new InMemoryMessageRepository();
    const notif = new InMemoryNotificationPort();
    const lookup = new InMemoryConversationLookup();
    lookup.conversations.set("conv-1", makeConv());
    const service = new MessageService(repo, lookup, notif);
    return { service, repo, notif, lookup };
  }

  it("sends a message and queues notification on first unread", async () => {
    const { service, notif } = await setup();

    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Olá!",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Preciso de voluntários",
    });

    expect(notif.queued).toHaveLength(1);
    expect(notif.queued[0]!.recipientId).toBe("author-1");
  });

  it("does not queue notification when recipient already has unread", async () => {
    const { service, notif } = await setup();

    // First message (unread)
    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Primeira mensagem",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    // Second message (recipient still has unread from first)
    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Segunda mensagem",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    expect(notif.queued).toHaveLength(1);
  });

  it("rejects empty messages", async () => {
    const { service } = await setup();

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "   ",
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow(EmptyMessageError);
  });

  it("rejects messages over max length", async () => {
    const { service } = await setup();

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "a".repeat(MAX_MESSAGE_LENGTH + 1),
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow(MessageTooLongError);
  });

  it("rejects messages to archived conversations", async () => {
    const { service, lookup } = await setup();
    lookup.conversations.set("conv-1", makeConv({ archived: true, archivedAt: new Date() }));

    await expect(
      service.sendMessage({
        conversationId: "conv-1",
        senderId: "user-1",
        content: "Olá",
        senderName: "User One",
        recipientId: "author-1",
        postTitle: "Test",
      })
    ).rejects.toThrow("archived");
  });

  it("marks messages as read", async () => {
    const { service } = await setup();

    await service.sendMessage({
      conversationId: "conv-1",
      senderId: "user-1",
      content: "Olá",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: "Test",
    });

    const count = await service.markAsRead("conv-1", "author-1");
    expect(count).toBe(1);
  });

  it("lists messages oldest first", async () => {
    const { service } = await setup();

    await service.sendMessage({
      conversationId: "conv-1", senderId: "user-1", content: "A",
      senderName: "U1", recipientId: "author-1", postTitle: "T",
    });
    await service.sendMessage({
      conversationId: "conv-1", senderId: "author-1", content: "B",
      senderName: "A1", recipientId: "user-1", postTitle: "T",
    });

    const messages = await service.listMessages("conv-1", 50);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe("A");
    expect(messages[1]!.content).toBe("B");
  });
});
