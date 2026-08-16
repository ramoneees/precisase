/**
 * MessageService — send and read messages within a Conversation.
 *
 * Follows the same port-driven pattern as ConversationService and
 * InterestService. The repository port is the only Prisma boundary;
 * unit tests use an in-memory fake (see message-service.test.ts).
 *
 * Messages are plaintext (max 4000 chars). Not encrypted at rest in MVP
 * (D4 — encryption deferred). Archived with the parent Conversation;
 * never hard-deleted unless GDPR account deletion.
 *
 * Notifications: a `chat_message_received` notification is queued for
 * the recipient on the FIRST unread message only — not on every
 * message — to avoid notification spam (D2). The "first" check runs
 * BEFORE the new message is inserted: "did the recipient already have
 * unread messages from before?". If not, this message is the first
 * unread one and a notification is queued.
 */

import type { ConversationRecord } from "./conversation-service";
import { ConversationAccessError, ConversationArchivedError } from "./conversation-service";

// Re-exported so consumers of this module (and its tests) can reference
// the conversation shape without importing the sibling service file.
export type { ConversationRecord } from "./conversation-service";

// ---------------------------------------------------------------------
// Local domain types
// ---------------------------------------------------------------------

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface MessageSummary {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Data-access port consumed by MessageService.
 */
export interface MessageRepository {
  createMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
  }): Promise<MessageRecord>;
  listByConversation(conversationId: string, limit: number, before?: Date): Promise<MessageSummary[]>;
  markAsRead(conversationId: string, userId: string): Promise<number>;
  hasUnreadForRecipient(conversationId: string, recipientId: string): Promise<boolean>;
  updateLastMessageAt(conversationId: string, date: Date): Promise<void>;
  deleteByUserId(userId: string): Promise<number>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export const MAX_MESSAGE_LENGTH = 4000;

export class MessageTooLongError extends Error {
  constructor(maxLength: number) {
    super(`Message must be at most ${maxLength} characters.`);
    this.name = "MessageTooLongError";
  }
}

export class EmptyMessageError extends Error {
  constructor() {
    super("Message cannot be empty.");
    this.name = "EmptyMessageError";
  }
}

// ---------------------------------------------------------------------
// Notification port (mirrors the InterestService addNotification shape)
// ---------------------------------------------------------------------

export interface MessageNotificationRecord {
  recipientId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  postTitle: string;
}

export interface MessageNotificationPort {
  queueNotification(notification: MessageNotificationRecord): Promise<void>;
}

// ---------------------------------------------------------------------
// Conversation lookup port (to validate access)
// ---------------------------------------------------------------------

export interface ConversationLookupPort {
  findByIdForUser(conversationId: string, userId: string): Promise<ConversationRecord | null>;
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly conversationLookup: ConversationLookupPort,
    private readonly notificationPort: MessageNotificationPort,
  ) {}

  /**
   * Send a message in a conversation. Validates that the sender is a
   * participant and the conversation is not archived. Queues a
   * notification for the recipient on the first unread message only.
   */
  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    content: string;
    senderName: string;
    recipientId: string;
    postTitle: string;
  }): Promise<MessageRecord> {
    const trimmed = data.content.trim();
    if (!trimmed) {
      throw new EmptyMessageError();
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new MessageTooLongError(MAX_MESSAGE_LENGTH);
    }

    const conv = await this.conversationLookup.findByIdForUser(data.conversationId, data.senderId);
    if (!conv) {
      throw new ConversationAccessError();
    }
    if (conv.archived) {
      throw new ConversationArchivedError();
    }

    // D2 anti-spam: notify only if the recipient had NO unread messages
    // before this one — i.e. this is the first unread message. Checked
    // BEFORE the insert, otherwise the just-inserted message would always
    // make the check true and no notification would ever be queued.
    const recipientHadUnread = await this.repo.hasUnreadForRecipient(
      data.conversationId,
      data.recipientId,
    );

    const message = await this.repo.createMessage({
      conversationId: data.conversationId,
      senderId: data.senderId,
      content: trimmed,
    });

    await this.repo.updateLastMessageAt(data.conversationId, message.createdAt);

    if (!recipientHadUnread) {
      await this.notificationPort.queueNotification({
        recipientId: data.recipientId,
        conversationId: data.conversationId,
        senderId: data.senderId,
        senderName: data.senderName,
        postTitle: data.postTitle,
      });
    }

    return message;
  }

  /**
   * List messages in a conversation (paginated, oldest first).
   */
  async listMessages(conversationId: string, limit = 50, before?: Date): Promise<MessageSummary[]> {
    const messages = await this.repo.listByConversation(conversationId, limit, before);
    return messages.reverse(); // oldest first for display
  }

  /**
   * Mark all unread messages in a conversation as read for a user.
   */
  async markAsRead(conversationId: string, userId: string): Promise<number> {
    return this.repo.markAsRead(conversationId, userId);
  }
}
