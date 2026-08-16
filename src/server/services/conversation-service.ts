/**
 * ConversationService — manages 1:1 conversations between a post author
 * and an interested user. A Conversation is created automatically when
 * an Interest is expressed (FR09). It is archived (not deleted) when
 * the Post is closed (D4).
 *
 * Like InterestService, this module depends on a narrow
 * ConversationRepository port rather than Prisma, so the creation and
 * archival behavior is unit-testable with an in-memory fake (see
 * conversation-service.test.ts).
 *
 * Moderator access to conversation content is gated behind the
 * `chat.moderator_read_access` feature flag (D1) — the repository
 * exposes read paths per-participant only; any moderator view must be
 * built on top of the flag being ON.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention).
// ---------------------------------------------------------------------

export interface ConversationRecord {
  id: string;
  interestId: string;
  postId: string;
  participantAId: string;
  participantBId: string;
  archived: boolean;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummary {
  id: string;
  postId: string;
  postTitle: string;
  postStatus: string;
  otherParticipantName: string;
  otherParticipantId: string;
  lastMessageContent: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  archived: boolean;
}

/**
 * Data-access port consumed by ConversationService.
 */
export interface ConversationRepository {
  findByInterestId(interestId: string): Promise<ConversationRecord | null>;
  /**
   * Id-only projection of `findByInterestId` — null before a conversation
   * exists for the interest. Kept separate (not `findByInterestId` + `.id`)
   * so read paths like the post detail page's "Chat on platform" link can
   * fetch just the id without hydrating a full record.
   */
  findIdByInterestId(interestId: string): Promise<string | null>;
  createConversation(data: {
    interestId: string;
    postId: string;
    participantAId: string;
    participantBId: string;
  }): Promise<ConversationRecord>;
  findByParticipant(userId: string, limit: number, cursor?: Date): Promise<ConversationSummary[]>;
  findById(id: string): Promise<ConversationRecord | null>;
  findByIdForUser(id: string, userId: string): Promise<ConversationRecord | null>;
  archiveByPostId(postId: string): Promise<number>;
  countUnreadForUser(userId: string): Promise<number>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Conversation ${id} was not found.`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationAccessError extends Error {
  constructor() {
    super("You do not have access to this conversation.");
    this.name = "ConversationAccessError";
  }
}

export class ConversationArchivedError extends Error {
  constructor() {
    super("This conversation has been archived.");
    this.name = "ConversationArchivedError";
  }
}

// ---------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------

export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

  /**
   * Create a conversation for an interest. Idempotent: if a conversation
   * already exists for this interestId, returns the existing one.
   * Called by the express-interest Server Action after expressInterest.
   */
  async getOrCreateForInterest(data: {
    interestId: string;
    postId: string;
    authorId: string;
    interestedUserId: string;
  }): Promise<ConversationRecord> {
    const existing = await this.repo.findByInterestId(data.interestId);
    if (existing) {
      return existing;
    }

    return this.repo.createConversation({
      interestId: data.interestId,
      postId: data.postId,
      participantAId: data.authorId,
      participantBId: data.interestedUserId,
    });
  }

  /**
   * List conversations for a user (inbox view). Returns summaries with
   * last message preview and unread count.
   */
  async listForUser(userId: string, limit = 20, cursor?: Date): Promise<ConversationSummary[]> {
    return this.repo.findByParticipant(userId, limit, cursor);
  }

  /**
   * Id of the conversation spawned by an interest, or null if none exists
   * yet. Read path for the post detail page's "Chat on platform" link.
   */
  async getConversationIdForInterest(interestId: string): Promise<string | null> {
    return this.repo.findIdByInterestId(interestId);
  }

  /**
   * Get a conversation for a participant. Throws if the user is not a
   * participant.
   */
  async getByIdForUser(conversationId: string, userId: string): Promise<ConversationRecord> {
    const conv = await this.repo.findByIdForUser(conversationId, userId);
    if (!conv) {
      throw new ConversationNotFoundError(conversationId);
    }
    return conv;
  }

  /**
   * Archive all conversations for a post. Called when the post is closed.
   * Returns the number of archived conversations.
   */
  async archiveForPost(postId: string): Promise<number> {
    return this.repo.archiveByPostId(postId);
  }

  /**
   * Count unread messages for a user (for the notification badge).
   */
  async countUnread(userId: string): Promise<number> {
    return this.repo.countUnreadForUser(userId);
  }
}
