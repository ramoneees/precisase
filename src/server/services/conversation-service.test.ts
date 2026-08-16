import { describe, it, expect } from "vitest";
import {
  ConversationService,
  type ConversationRepository,
  type ConversationRecord,
  type ConversationSummary,
  ConversationNotFoundError,
} from "./conversation-service";

// In-memory fake following the InterestService test pattern.
class InMemoryConversationRepository implements ConversationRepository {
  store = new Map<string, ConversationRecord>();
  summaries = new Map<string, ConversationSummary[]>();
  unreadCounts = new Map<string, number>();

  async findByInterestId(interestId: string) {
    for (const c of this.store.values()) {
      if (c.interestId === interestId) return c;
    }
    return null;
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
    return this.summaries.get(userId) ?? [];
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
        count++;
      }
    }
    return count;
  }

  async countUnreadForUser(userId: string) {
    return this.unreadCounts.get(userId) ?? 0;
  }
}

describe("ConversationService", () => {
  it("creates a conversation for a new interest", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    const conv = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    expect(conv.interestId).toBe("int-1");
    expect(conv.postId).toBe("post-1");
    expect(conv.archived).toBe(false);
  });

  it("is idempotent — returns existing conversation for same interest", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    const first = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    const second = await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    expect(second.id).toBe(first.id);
  });

  it("throws when user is not a participant", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });

    await expect(
      service.getByIdForUser("conv-1", "intruder")
    ).rejects.toThrow(ConversationNotFoundError);
  });

  it("archives conversations for a closed post", async () => {
    const repo = new InMemoryConversationRepository();
    const service = new ConversationService(repo);

    await service.getOrCreateForInterest({
      interestId: "int-1",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-1",
    });
    await service.getOrCreateForInterest({
      interestId: "int-2",
      postId: "post-1",
      authorId: "author-1",
      interestedUserId: "user-2",
    });

    const count = await service.archiveForPost("post-1");
    expect(count).toBe(2);
  });

  it("returns unread count for user", async () => {
    const repo = new InMemoryConversationRepository();
    repo.unreadCounts.set("user-1", 3);
    const service = new ConversationService(repo);

    const count = await service.countUnread("user-1");
    expect(count).toBe(3);
  });
});
