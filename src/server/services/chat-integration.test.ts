import { describe, expect, it } from "vitest";
import {
  InterestService,
  type InterestPostSummary,
  type InterestRecord,
  type InterestRepository,
  type NotificationRecord as InterestNotificationRecord,
} from "./interest-service";
import {
  ConversationService,
  ConversationArchivedError,
  type ConversationRepository,
  type ConversationRecord,
  type ConversationSummary,
} from "./conversation-service";
import {
  MessageService,
  type MessageRepository,
  type MessageRecord,
  type MessageNotificationPort,
  type MessageNotificationRecord,
  type ConversationLookupPort,
} from "./message-service";
import {
  PostService,
  type AuditLogRecord,
  type CreatePostData,
  type ListActivePostsFilter,
  type ModerationActionRecord,
  type NotificationRecord as PostNotificationRecord,
  type PaginatedPosts,
  type PostRecord,
  type PostRepository,
  type PostSummary,
} from "./post-service";

/**
 * End-to-end chat flow across the real services, wired together exactly
 * the way the Server Actions do it (posts/[id]/actions.ts for interest →
 * conversation, my-posts/actions.ts for close → archive):
 *
 *   expressInterest → getOrCreateForInterest → sendMessage →
 *   markAsRead → closePost → archiveForPost
 *
 * Every port is backed by an in-memory fake (no live Postgres/Prisma —
 * same convention as the per-service unit tests); the fakes for
 * Interest/Conversation/Message mirror the ones in their unit-test
 * files, so behavior agreed there holds here too.
 */

class InMemoryInterestRepository implements InterestRepository {
  readonly posts = new Map<string, InterestPostSummary>();
  readonly interests: InterestRecord[] = [];
  readonly notifications: InterestNotificationRecord[] = [];

  async findPostById(postId: string) {
    return this.posts.get(postId) ?? null;
  }

  async findInterest(postId: string, userId: string) {
    return this.interests.find((i) => i.postId === postId && i.userId === userId) ?? null;
  }

  async createInterest(data: {
    postId: string;
    userId: string;
    message: string | null;
  }): Promise<{ record: InterestRecord; created: boolean }> {
    const existing = this.interests.find(
      (i) => i.postId === data.postId && i.userId === data.userId,
    );
    if (existing) {
      return { record: existing, created: false };
    }
    const record: InterestRecord = {
      id: `interest-${this.interests.length + 1}`,
      postId: data.postId,
      userId: data.userId,
      message: data.message,
      createdAt: new Date(),
    };
    this.interests.push(record);
    return { record, created: true };
  }

  async addNotification(notification: InterestNotificationRecord) {
    this.notifications.push(notification);
  }
}

class InMemoryConversationRepository implements ConversationRepository {
  readonly store = new Map<string, ConversationRecord>();

  async findByInterestId(interestId: string) {
    for (const c of this.store.values()) {
      if (c.interestId === interestId) return c;
    }
    return null;
  }

  async findIdByInterestId(interestId: string) {
    const existing = await this.findByInterestId(interestId);
    return existing?.id ?? null;
  }

  async createConversation(data: {
    interestId: string;
    postId: string;
    participantAId: string;
    participantBId: string;
  }) {
    const record: ConversationRecord = {
      id: `conv-${this.store.size + 1}`,
      interestId: data.interestId,
      postId: data.postId,
      participantAId: data.participantAId,
      participantBId: data.participantBId,
      archived: false,
      archivedAt: null,
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(record.id, record);
    return record;
  }

  async findByParticipant(userId: string, limit: number, cursor?: Date) {
    const rows = [...this.store.values()].filter(
      (c) => c.participantAId === userId || c.participantBId === userId,
    );
    const summaries: ConversationSummary[] = rows.map((c) => ({
      id: c.id,
      postId: c.postId,
      postTitle: "Post",
      postStatus: "active",
      otherParticipantName: "Other",
      otherParticipantId: c.participantAId === userId ? c.participantBId : c.participantAId,
      lastMessageContent: null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: 0,
      archived: c.archived,
    }));
    return summaries;
  }

  async findById(id: string) {
    return this.store.get(id) ?? null;
  }

  async findByIdForUser(id: string, userId: string) {
    const c = this.store.get(id);
    if (!c) return null;
    if (c.participantAId !== userId && c.participantBId !== userId) return null;
    return c;
  }

  async archiveByPostId(postId: string) {
    let count = 0;
    for (const c of this.store.values()) {
      if (c.postId === postId && !c.archived) {
        c.archived = true;
        c.archivedAt = new Date();
        c.updatedAt = new Date();
        count++;
      }
    }
    return count;
  }

  async countUnreadForUser(userId: string) {
    return 0;
  }
}

class InMemoryMessageRepository implements MessageRepository {
  readonly messages: MessageRecord[] = [];
  readonly lastMessageAtUpdates: { conversationId: string; date: Date }[] = [];

  async createMessage(data: { conversationId: string; senderId: string; content: string }) {
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
    let filtered = this.messages.filter((m) => m.conversationId === conversationId);
    if (before) {
      filtered = filtered.filter((m) => m.createdAt < before);
    }
    // Newest-first, mirroring the Prisma impl's `orderBy createdAt desc` —
    // the service reverses to oldest-first for display.
    return filtered.slice(-limit).reverse().map((m) => ({
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
      (m) => m.conversationId === conversationId && m.senderId !== recipientId && !m.readAt,
    );
  }

  async updateLastMessageAt(conversationId: string, date: Date) {
    this.lastMessageAtUpdates.push({ conversationId, date });
  }

  async deleteByUserId(userId: string) {
    const before = this.messages.length;
    const kept = this.messages.filter((m) => m.senderId !== userId);
    this.messages.length = 0;
    this.messages.push(...kept);
    return before - this.messages.length;
  }
}

class InMemoryMessageNotificationPort implements MessageNotificationPort {
  readonly queued: MessageNotificationRecord[] = [];

  async queueNotification(notification: MessageNotificationRecord) {
    this.queued.push(notification);
  }
}

/**
 * Minimal PostRepository fake backing `PostService.closePost`. List
 * methods behave honestly (filter the in-memory store) but only
 * `findById`/`update`/`listInterestedUserIds`/`addNotification`/
 * `addAuditLog`/`withTransaction` are exercised by this flow.
 * `listInterestedUserIds` derives from the shared Interest store — the
 * same cross-model read the Prisma-backed repository does.
 */
class InMemoryPostRepository implements PostRepository {
  readonly posts = new Map<string, PostRecord>();
  readonly notifications: PostNotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  readonly moderationActions: ModerationActionRecord[] = [];

  constructor(private readonly interests: readonly InterestRecord[]) {}

  seedPost(record: PostRecord) {
    this.posts.set(record.id, record);
  }

  async findById(id: string) {
    return this.posts.get(id) ?? null;
  }

  async update(id: string, data: Partial<PostRecord>) {
    const existing = this.posts.get(id);
    if (!existing) throw new Error(`Post ${id} not found`);
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.posts.set(id, updated);
    return updated;
  }

  async create(data: CreatePostData) {
    const record: PostRecord = {
      ...data,
      extraAttributes: data.extraAttributes ?? {},
      id: `post-${this.posts.size + 1}`,
      status: "pending",
      publishedAt: null,
      closedAt: null,
      rejectedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.posts.set(record.id, record);
    return record;
  }

  async listActive(filter: ListActivePostsFilter): Promise<PaginatedPosts> {
    const rows = [...this.posts.values()].filter((p) => p.status === "active");
    const limit = filter.limit ?? 24;
    return { items: rows.slice(0, limit), nextCursor: null };
  }

  async listByAuthor(authorId: string): Promise<PostSummary[]> {
    return [...this.posts.values()].filter((p) => p.authorId === authorId);
  }

  async listPending(): Promise<PostSummary[]> {
    return [...this.posts.values()].filter((p) => p.status === "pending");
  }

  async listInterestedUserIds(postId: string) {
    return [...new Set(this.interests.filter((i) => i.postId === postId).map((i) => i.userId))];
  }

  async addModerationAction(action: ModerationActionRecord) {
    this.moderationActions.push(action);
  }

  async addNotification(notification: PostNotificationRecord) {
    this.notifications.push(notification);
  }

  async addAuditLog(log: AuditLogRecord) {
    this.auditLogs.push(log);
  }

  async withTransaction<T>(fn: (txRepo: PostRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function makeActivePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1",
    authorId: "author-1",
    categoryId: "cat-1",
    type: "request",
    status: "active",
    title: "Preciso de ajuda com mudança",
    description: "Preciso de ajuda para mudar de casa no sábado.",
    contactMethod: "phone",
    contactValue: "+351912345678",
    locale: "pt-PT",
    extraAttributes: {},
    publishedAt: new Date(),
    closedAt: null,
    rejectedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function setup() {
  const interestRepo = new InMemoryInterestRepository();
  const conversationRepo = new InMemoryConversationRepository();
  const messageRepo = new InMemoryMessageRepository();
  const chatNotifications = new InMemoryMessageNotificationPort();
  const postRepo = new InMemoryPostRepository(interestRepo.interests);

  const post = makeActivePost();
  postRepo.seedPost(post);
  interestRepo.posts.set(
    post.id,
    { id: post.id, authorId: post.authorId, status: post.status, title: post.title },
  );

  const interestService = new InterestService(interestRepo);
  const conversationService = new ConversationService(conversationRepo);
  const messageService = new MessageService(
    messageRepo,
    conversationRepo satisfies ConversationLookupPort,
    chatNotifications,
  );
  const postService = new PostService(postRepo);

  return {
    post,
    interestService,
    conversationService,
    messageService,
    postService,
    interestRepo,
    conversationRepo,
    messageRepo,
    chatNotifications,
    postRepo,
  };
}

describe("chat end-to-end flow (interest → conversation → message → close → archive)", () => {
  it("runs the full wired flow the Server Actions drive", async () => {
    const s = await setup();
    const { post } = s;

    // 1. Express interest (FR09) — the post author is notified.
    const interest = await s.interestService.expressInterest({
      postId: post.id,
      userId: "user-1",
      message: "Posso ajudar!",
    });
    expect(interest.postId).toBe(post.id);
    expect(s.interestRepo.notifications).toHaveLength(1);
    expect(s.interestRepo.notifications[0]).toMatchObject({
      recipientId: "author-1",
      type: "interest_received",
    });

    // 2. Conversation created for the interest (posts/[id]/actions.ts
    // calls getOrCreateForInterest right after expressInterest).
    const conversation = await s.conversationService.getOrCreateForInterest({
      interestId: interest.id,
      postId: post.id,
      authorId: post.authorId,
      interestedUserId: "user-1",
    });
    expect(conversation.participantAId).toBe("author-1");
    expect(conversation.participantBId).toBe("user-1");
    expect(conversation.archived).toBe(false);

    // 3. Interested user sends a message — first unread message for the
    // author, so a chat_message_received notification is queued (D2).
    await s.messageService.sendMessage({
      conversationId: conversation.id,
      senderId: "user-1",
      content: "Olá! Em que horas precisas de ajuda?",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: post.title,
    });
    expect(s.messageRepo.messages).toHaveLength(1);
    expect(s.chatNotifications.queued).toHaveLength(1);
    expect(s.chatNotifications.queued[0]).toMatchObject({
      recipientId: "author-1",
      conversationId: conversation.id,
      senderId: "user-1",
    });
    expect(s.messageRepo.lastMessageAtUpdates.at(-1)?.conversationId).toBe(conversation.id);

    // 4. Author reads the conversation.
    const readCount = await s.messageService.markAsRead(conversation.id, "author-1");
    expect(readCount).toBe(1);
    const afterRead = await s.messageService.listMessages(conversation.id);
    expect(afterRead[0]!.readAt).not.toBeNull();

    // The read reset the recipient's unread state, so a follow-up
    // message queues a fresh notification (D2).
    await s.messageService.sendMessage({
      conversationId: conversation.id,
      senderId: "user-1",
      content: "Ainda estás aí?",
      senderName: "User One",
      recipientId: "author-1",
      postTitle: post.title,
    });
    expect(s.chatNotifications.queued).toHaveLength(2);

    // 5. Author closes the post (FR04/FR11) — every interested user is
    // notified and the transition is audited.
    const closed = await s.postService.closePost({
      postId: post.id,
      actor: { id: "author-1", role: "user" },
    });
    expect(closed.status).toBe("closed");
    expect(closed.closedAt).not.toBeNull();
    expect(s.postRepo.notifications).toHaveLength(1);
    expect(s.postRepo.notifications[0]).toMatchObject({
      recipientId: "user-1",
      type: "post_closed",
    });
    expect(s.postRepo.auditLogs.at(-1)).toMatchObject({ action: "post.close" });

    // 6. Closing archives the post's conversations (D4 — my-posts
    // actions call archiveForPost right after closePost).
    const archivedCount = await s.conversationService.archiveForPost(post.id);
    expect(archivedCount).toBe(1);
    const archived = await s.conversationService.getByIdForUser(conversation.id, "user-1");
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();

    // Archived conversations reject new sends…
    await expect(
      s.messageService.sendMessage({
        conversationId: conversation.id,
        senderId: "user-1",
        content: "Mais alguma coisa?",
        senderName: "User One",
        recipientId: "author-1",
        postTitle: post.title,
      }),
    ).rejects.toThrow(ConversationArchivedError);

    // …while the history stays readable for both participants (D1).
    const history = await s.messageService.listMessages(conversation.id);
    expect(history.map((m) => m.content)).toEqual([
      "Olá! Em que horas precisas de ajuda?",
      "Ainda estás aí?",
    ]);
  });
});
