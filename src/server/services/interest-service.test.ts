import { beforeEach, describe, expect, it } from "vitest";
import {
  InterestMessageTooLongError,
  InterestService,
  MAX_INTEREST_MESSAGE_LENGTH,
  PostNotAvailableError,
  PostNotFoundError,
  type InterestPostSummary,
  type InterestRecord,
  type InterestRepository,
  type NotificationRecord,
} from "./interest-service";

/**
 * Lightweight in-memory fake implementing the `InterestRepository` port, so
 * these tests exercise real `InterestService` logic (FR09, §6.2) without a
 * live Postgres/Prisma connection.
 */
class InMemoryInterestRepository implements InterestRepository {
  readonly posts = new Map<string, InterestPostSummary>();
  readonly interests: InterestRecord[] = [];
  readonly notifications: NotificationRecord[] = [];

  seedPost(post: InterestPostSummary): void {
    this.posts.set(post.id, post);
  }

  async findPostById(postId: string): Promise<InterestPostSummary | null> {
    return this.posts.get(postId) ?? null;
  }

  async findInterest(postId: string, userId: string): Promise<InterestRecord | null> {
    return (
      this.interests.find((i) => i.postId === postId && i.userId === userId) ?? null
    );
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
      // Mirrors the Prisma P2002 path: re-fetch the existing row, signal
      // `created: false`. Used by the C7 idempotency tests below.
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

  async addNotification(notification: NotificationRecord): Promise<void> {
    this.notifications.push(notification);
  }
}

function makePost(overrides: Partial<InterestPostSummary> = {}): InterestPostSummary {
  return {
    id: "post-1",
    authorId: "author-1",
    status: "active",
    title: "Preciso de um sofá",
    ...overrides,
  };
}

describe("InterestService.expressInterest (FR09, ARCHITECTURE.md §6.2)", () => {
  let repo: InMemoryInterestRepository;
  let service: InterestService;

  beforeEach(() => {
    repo = new InMemoryInterestRepository();
    service = new InterestService(repo);
  });

  it("records the interest and queues a notification for the post's author", async () => {
    repo.seedPost(makePost());

    const result = await service.expressInterest({
      postId: "post-1",
      userId: "user-2",
      message: "I have a sofa I no longer need!",
    });

    expect(result).toEqual(
      expect.objectContaining({
        postId: "post-1",
        userId: "user-2",
        message: "I have a sofa I no longer need!",
      }),
    );

    expect(repo.interests).toHaveLength(1);
    expect(repo.notifications).toEqual([
      expect.objectContaining({
        recipientId: "author-1",
        postId: "post-1",
        type: "interest_received",
        status: "queued",
      }),
    ]);
  });

  it("allows expressing interest with no optional message", async () => {
    repo.seedPost(makePost());

    const result = await service.expressInterest({ postId: "post-1", userId: "user-2" });

    expect(result.message).toBeNull();
    expect(repo.notifications).toHaveLength(1);
  });

  it("is idempotent for a duplicate (post_id, user_id) pair (C7)", async () => {
    repo.seedPost(makePost());
    const first = await service.expressInterest({ postId: "post-1", userId: "user-2" });
    const second = await service.expressInterest({ postId: "post-1", userId: "user-2" });

    // Returns the same record (same id) on the second call, no throw.
    expect(second.id).toBe(first.id);
    expect(repo.interests).toHaveLength(1);
  });

  it("queues exactly one author notification across duplicate calls (C7)", async () => {
    repo.seedPost(makePost());

    // Simulates sequential double-click: both calls complete.
    await service.expressInterest({ postId: "post-1", userId: "user-2" });
    await service.expressInterest({ postId: "post-1", userId: "user-2" });

    expect(repo.interests).toHaveLength(1);
    expect(repo.notifications).toHaveLength(1);
    expect(repo.notifications[0]).toEqual(
      expect.objectContaining({
        recipientId: "author-1",
        type: "interest_received",
      }),
    );
  });

  it("treats a concurrent race-loser as idempotent (C7)", async () => {
    repo.seedPost(makePost());

    // Two in-flight calls racing against the same repo state: both are
    // awaited together. The fake serializes the createInterest calls, so
    // the second sees the row the first inserted — mirroring the Prisma
    // P2002 path.
    const [a, b] = await Promise.all([
      service.expressInterest({ postId: "post-1", userId: "user-2" }),
      service.expressInterest({ postId: "post-1", userId: "user-2" }),
    ]);

    expect(a.id).toBe(b.id);
    expect(repo.interests).toHaveLength(1);
    expect(repo.notifications).toHaveLength(1);
  });

  it("allows the same user to express interest in a different post", async () => {
    repo.seedPost(makePost());
    repo.seedPost(makePost({ id: "post-2", authorId: "author-2" }));

    await service.expressInterest({ postId: "post-1", userId: "user-2" });
    await service.expressInterest({ postId: "post-2", userId: "user-2" });

    expect(repo.interests).toHaveLength(2);
  });

  it("throws when the post does not exist", async () => {
    await expect(
      service.expressInterest({ postId: "missing", userId: "user-2" }),
    ).rejects.toThrow(PostNotFoundError);
  });

  it("throws when the post is not active (e.g. still pending or already closed)", async () => {
    repo.seedPost(makePost({ status: "closed" }));

    await expect(
      service.expressInterest({ postId: "post-1", userId: "user-2" }),
    ).rejects.toThrow(PostNotAvailableError);
  });

  it("rejects an interest message longer than the max length", async () => {
    repo.seedPost(makePost({ status: "active" }));

    await expect(
      service.expressInterest({
        postId: "post-1",
        userId: "user-2",
        message: "x".repeat(MAX_INTEREST_MESSAGE_LENGTH + 1),
      }),
    ).rejects.toThrow(InterestMessageTooLongError);
  });

  it("trims leading/trailing whitespace before length-checking the message", async () => {
    repo.seedPost(makePost({ status: "active" }));

    const result = await service.expressInterest({
      postId: "post-1",
      userId: "user-2",
      message: "   hello world   ",
    });

    expect(result.message).toBe("hello world");
  });
});
