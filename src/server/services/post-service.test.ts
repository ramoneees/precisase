import { beforeEach, describe, expect, it } from "vitest";
import {
  ContactInfoRequiredError,
  InvalidPostTransitionError,
  ModerationReasonRequiredError,
  PostNotFoundError,
  PostService,
  UnauthorizedPostActionError,
  type Actor,
  type ActorRole,
  type AuditLogRecord,
  type ModerationActionRecord,
  type NotificationRecord,
  type PostRecord,
  type PostRepository,
} from "./post-service";

/**
 * Lightweight in-memory fake implementing the `PostRepository` port, so
 * these tests exercise real `PostService` state-machine logic (§5.3) without
 * a live Postgres/Prisma connection.
 */
class InMemoryPostRepository implements PostRepository {
  readonly posts = new Map<string, PostRecord>();
  readonly moderationActions: ModerationActionRecord[] = [];
  readonly notifications: NotificationRecord[] = [];
  readonly auditLogs: AuditLogRecord[] = [];
  private nextId = 1;

  seed(post: PostRecord): void {
    this.posts.set(post.id, post);
  }

  async findById(id: string): Promise<PostRecord | null> {
    return this.posts.get(id) ?? null;
  }

  async update(id: string, data: Partial<PostRecord>): Promise<PostRecord> {
    const existing = this.posts.get(id);
    if (!existing) {
      throw new Error(`fake repository: post ${id} not found`);
    }
    const updated: PostRecord = { ...existing, ...data };
    this.posts.set(id, updated);
    return updated;
  }

  async create(
    data: Omit<
      PostRecord,
      "id" | "status" | "publishedAt" | "closedAt" | "rejectedReason" | "createdAt" | "updatedAt" | "extraAttributes"
    > & { extraAttributes?: Record<string, unknown> },
  ): Promise<PostRecord> {
    const now = new Date();
    const post: PostRecord = {
      ...data,
      extraAttributes: data.extraAttributes ?? {},
      id: `post-${this.nextId++}`,
      status: "pending",
      publishedAt: null,
      closedAt: null,
      rejectedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.posts.set(post.id, post);
    return post;
  }

  async listActive(filter: { categoryId?: string; type?: PostRecord["type"]; search?: string }): Promise<PostRecord[]> {
    return [...this.posts.values()].filter((post) => {
      if (post.status !== "active") return false;
      if (filter.categoryId && post.categoryId !== filter.categoryId) return false;
      if (filter.type && post.type !== filter.type) return false;
      if (filter.search) {
        const haystack = `${post.title} ${post.description}`.toLowerCase();
        if (!haystack.includes(filter.search.toLowerCase())) return false;
      }
      return true;
    });
  }

  async listPending(): Promise<PostRecord[]> {
    return [...this.posts.values()]
      .filter((post) => post.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  listByAuthorCalls: string[] = [];

  async listByAuthor(authorId: string): Promise<PostRecord[]> {
    this.listByAuthorCalls.push(authorId);
    return [...this.posts.values()]
      .filter((post) => post.authorId === authorId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async addModerationAction(action: ModerationActionRecord): Promise<void> {
    this.moderationActions.push(action);
  }

  async addNotification(notification: NotificationRecord): Promise<void> {
    this.notifications.push(notification);
  }

  async addAuditLog(log: AuditLogRecord): Promise<void> {
    this.auditLogs.push(log);
  }
}

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1",
    authorId: "author-1",
    categoryId: "category-1",
    type: "request",
    status: "pending",
    title: "Preciso de ajuda a mudar um sofá",
    description: "Descrição do pedido de ajuda.",
    contactMethod: "whatsapp",
    contactValue: "+351 912 345 678",
    locale: "pt-PT",
    extraAttributes: {},
    publishedAt: null,
    closedAt: null,
    rejectedReason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<Parameters<PostService["createPost"]>[0]> = {}) {
  return {
    authorId: "author-1",
    categoryId: "category-1",
    type: "request" as const,
    title: "Preciso de ajuda a mudar um sofá",
    description: "Descrição do pedido de ajuda.",
    contactMethod: "whatsapp" as const,
    contactValue: "+351 912 345 678",
    locale: "pt-PT",
    ...overrides,
  };
}

function actor(id: string, role: ActorRole = "user") {
  return { id, role };
}

describe("PostService state machine (ARCHITECTURE.md §5.3)", () => {
  let repo: InMemoryPostRepository;
  let service: PostService;

  beforeEach(() => {
    repo = new InMemoryPostRepository();
    service = new PostService(repo);
  });

  describe("approvePost — pending -> active (FR15)", () => {
    it("moves a pending post to active, sets publishedAt, and records the moderator decision", async () => {
      repo.seed(makePost({ status: "pending" }));

      const result = await service.approvePost({
        postId: "post-1",
        moderator: actor("moderator-1", "moderator"),
      });

      expect(result.status).toBe("active");
      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(repo.moderationActions).toEqual([
        expect.objectContaining({
          postId: "post-1",
          moderatorId: "moderator-1",
          action: "approve",
        }),
      ]);
      expect(repo.notifications).toEqual([
        expect.objectContaining({
          recipientId: "author-1",
          postId: "post-1",
          type: "post_approved",
        }),
      ]);
    });

    it("rejects a non-moderator/non-admin actor", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.approvePost({ postId: "post-1", moderator: actor("user-1", "user") }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });

    it("rejects approving a post that is not pending", async () => {
      repo.seed(makePost({ status: "active" }));

      await expect(
        service.approvePost({ postId: "post-1", moderator: actor("moderator-1", "moderator") }),
      ).rejects.toThrow(InvalidPostTransitionError);
    });

    it("throws when the post does not exist", async () => {
      await expect(
        service.approvePost({ postId: "missing", moderator: actor("moderator-1", "moderator") }),
      ).rejects.toThrow(PostNotFoundError);
    });
  });

  describe("rejectPost — pending -> rejected (FR15)", () => {
    it("moves a pending post to rejected with a required reason", async () => {
      repo.seed(makePost({ status: "pending" }));

      const result = await service.rejectPost({
        postId: "post-1",
        moderator: actor("moderator-1", "moderator"),
        reason: "Duplicate post already active.",
      });

      expect(result.status).toBe("rejected");
      expect(result.rejectedReason).toBe("Duplicate post already active.");
      expect(repo.moderationActions).toEqual([
        expect.objectContaining({ action: "reject", reason: "Duplicate post already active." }),
      ]);
      expect(repo.notifications).toEqual([
        expect.objectContaining({ type: "post_rejected", recipientId: "author-1" }),
      ]);
    });

    it("requires a non-empty reason", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.rejectPost({
          postId: "post-1",
          moderator: actor("moderator-1", "moderator"),
          reason: "   ",
        }),
      ).rejects.toThrow(ModerationReasonRequiredError);
    });

    it("rejects a non-moderator/non-admin actor", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.rejectPost({
          postId: "post-1",
          moderator: actor("user-1", "user"),
          reason: "not allowed",
        }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });
  });

  describe("closePost — active -> closed (FR04, BR03)", () => {
    it("allows the author to close their own post", async () => {
      repo.seed(makePost({ status: "active" }));

      const result = await service.closePost({ postId: "post-1", actor: actor("author-1", "user") });

      expect(result.status).toBe("closed");
      expect(result.closedAt).toBeInstanceOf(Date);
    });

    it("allows a moderator to close someone else's post", async () => {
      repo.seed(makePost({ status: "active" }));

      const result = await service.closePost({
        postId: "post-1",
        actor: actor("moderator-1", "moderator"),
      });

      expect(result.status).toBe("closed");
    });

    it("rejects an actor who is neither the author nor a moderator (BR03)", async () => {
      repo.seed(makePost({ status: "active" }));

      await expect(
        service.closePost({ postId: "post-1", actor: actor("stranger-1", "user") }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });

    it("rejects closing a post that is not active", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.closePost({ postId: "post-1", actor: actor("author-1", "user") }),
      ).rejects.toThrow(InvalidPostTransitionError);
    });
  });

  describe("reopenPost — closed -> active (FR05)", () => {
    it("allows the author to reopen a closed post", async () => {
      repo.seed(makePost({ status: "closed", closedAt: new Date("2026-01-02T00:00:00Z") }));

      const result = await service.reopenPost({ postId: "post-1", actor: actor("author-1", "user") });

      expect(result.status).toBe("active");
      expect(result.closedAt).toBeNull();
    });

    it("rejects a non-author actor", async () => {
      repo.seed(makePost({ status: "closed" }));

      await expect(
        service.reopenPost({ postId: "post-1", actor: actor("stranger-1", "user") }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });

    it("rejects reopening a post that is not closed", async () => {
      repo.seed(makePost({ status: "active" }));

      await expect(
        service.reopenPost({ postId: "post-1", actor: actor("author-1", "user") }),
      ).rejects.toThrow(InvalidPostTransitionError);
    });
  });

  describe("resubmitPost — rejected -> pending (FR03)", () => {
    it("lets the author edit and resubmit a rejected post", async () => {
      repo.seed(
        makePost({
          status: "rejected",
          rejectedReason: "Missing contact info.",
          title: "Old title",
        }),
      );

      const result = await service.resubmitPost({
        postId: "post-1",
        actor: actor("author-1", "user"),
        updates: { title: "New title", description: "New description with contact info." },
      });

      expect(result.status).toBe("pending");
      expect(result.rejectedReason).toBeNull();
      expect(result.title).toBe("New title");
      expect(result.description).toBe("New description with contact info.");
    });

    it("rejects a non-author actor", async () => {
      repo.seed(makePost({ status: "rejected" }));

      await expect(
        service.resubmitPost({
          postId: "post-1",
          actor: actor("stranger-1", "user"),
          updates: { title: "New title" },
        }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });

    it("rejects resubmitting a post that is not rejected", async () => {
      repo.seed(makePost({ status: "active" }));

      await expect(
        service.resubmitPost({
          postId: "post-1",
          actor: actor("author-1", "user"),
          updates: { title: "New title" },
        }),
      ).rejects.toThrow(InvalidPostTransitionError);
    });
  });

  describe("createPost — [*] -> pending (FR01, BR01)", () => {
    it("creates a new post that always starts pending, regardless of caller", async () => {
      const result = await service.createPost(makeCreateInput());

      expect(result.status).toBe("pending");
      expect(result.publishedAt).toBeNull();
      expect(result.authorId).toBe("author-1");
      expect(result.categoryId).toBe("category-1");
      expect(result.title).toBe("Preciso de ajuda a mudar um sofá");
      expect(result.contactMethod).toBe("whatsapp");
      expect(result.contactValue).toBe("+351 912 345 678");
      expect(result.locale).toBe("pt-PT");
    });

    it("writes an AuditLog entry for the creation", async () => {
      const result = await service.createPost(makeCreateInput());

      expect(repo.auditLogs).toEqual([
        expect.objectContaining({
          actorId: "author-1",
          action: "post.create",
          targetType: "Post",
          targetId: result.id,
        }),
      ]);
    });

    it("rejects a post missing a contact method (BR04)", async () => {
      await expect(
        service.createPost(makeCreateInput({ contactMethod: "" as never })),
      ).rejects.toThrow(ContactInfoRequiredError);
    });

    it("rejects a post with an empty contact value (BR04)", async () => {
      await expect(
        service.createPost(makeCreateInput({ contactValue: "   " })),
      ).rejects.toThrow(ContactInfoRequiredError);
    });

    it("does not persist anything when contact info is missing", async () => {
      await expect(
        service.createPost(makeCreateInput({ contactValue: "" })),
      ).rejects.toThrow(ContactInfoRequiredError);

      expect(repo.posts.size).toBe(0);
      expect(repo.auditLogs).toHaveLength(0);
    });
  });

  describe("editActivePost — active -> active (FR03, ARCHITECTURE.md §5.3 Q7)", () => {
    it("lets the author edit title/description/contact while active, keeping it active", async () => {
      repo.seed(makePost({ status: "active" }));

      const result = await service.editActivePost({
        postId: "post-1",
        actor: actor("author-1", "user"),
        updates: {
          title: "Novo título",
          description: "Nova descrição.",
          contactMethod: "email",
          contactValue: "someone@example.com",
        },
      });

      expect(result.status).toBe("active");
      expect(result.title).toBe("Novo título");
      expect(result.description).toBe("Nova descrição.");
      expect(result.contactMethod).toBe("email");
      expect(result.contactValue).toBe("someone@example.com");
    });

    it("writes an AuditLog entry, not a ModerationAction, for a self-edit", async () => {
      repo.seed(makePost({ status: "active" }));

      await service.editActivePost({
        postId: "post-1",
        actor: actor("author-1", "user"),
        updates: { title: "Novo título" },
      });

      expect(repo.auditLogs).toEqual([
        expect.objectContaining({
          actorId: "author-1",
          action: "post.edit",
          targetType: "Post",
          targetId: "post-1",
        }),
      ]);
      expect(repo.moderationActions).toHaveLength(0);
    });

    it("rejects a non-author actor", async () => {
      repo.seed(makePost({ status: "active" }));

      await expect(
        service.editActivePost({
          postId: "post-1",
          actor: actor("stranger-1", "user"),
          updates: { title: "Novo título" },
        }),
      ).rejects.toThrow(UnauthorizedPostActionError);
    });

    it("rejects editing a post that is not active", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.editActivePost({
          postId: "post-1",
          actor: actor("author-1", "user"),
          updates: { title: "Novo título" },
        }),
      ).rejects.toThrow(InvalidPostTransitionError);
    });

    it("throws when the post does not exist", async () => {
      await expect(
        service.editActivePost({
          postId: "missing",
          actor: actor("author-1", "user"),
          updates: { title: "Novo título" },
        }),
      ).rejects.toThrow(PostNotFoundError);
    });
  });

  describe("listActivePosts — shop window listing (FR06–FR08)", () => {
    it("delegates to the repository and only returns active posts", async () => {
      repo.seed(makePost({ id: "post-1", status: "active", categoryId: "category-1" }));
      repo.seed(makePost({ id: "post-2", status: "pending", categoryId: "category-1" }));
      repo.seed(makePost({ id: "post-3", status: "closed", categoryId: "category-1" }));

      const result = await service.listActivePosts({ categoryId: "category-1" });

      expect(result.map((p) => p.id)).toEqual(["post-1"]);
    });

    it("passes filter (category, type, search) through to the repository", async () => {
      repo.seed(makePost({ id: "post-1", status: "active", type: "offer", categoryId: "category-2" }));
      repo.seed(
        makePost({
          id: "post-2",
          status: "active",
          type: "request",
          categoryId: "category-1",
          title: "Sofá disponível",
        }),
      );

      const result = await service.listActivePosts({ type: "offer", categoryId: "category-2" });

      expect(result.map((p) => p.id)).toEqual(["post-1"]);
    });
  });

  describe("listPendingPosts — moderation queue (FR15)", () => {
    it("delegates to the repository's listPending and only returns pending posts, oldest first", async () => {
      repo.seed(
        makePost({
          id: "post-1",
          status: "pending",
          createdAt: new Date("2026-01-03T00:00:00Z"),
        }),
      );
      repo.seed(
        makePost({
          id: "post-2",
          status: "pending",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        }),
      );
      repo.seed(makePost({ id: "post-3", status: "active" }));

      const result = await service.listPendingPosts();

      expect(result.map((p) => p.id)).toEqual(["post-2", "post-1"]);
    });

    it("returns an empty array when there are no pending posts", async () => {
      repo.seed(makePost({ id: "post-1", status: "active" }));

      const result = await service.listPendingPosts();

      expect(result).toEqual([]);
    });
  });

  describe("listMyPosts — author's own posts regardless of status (my-posts view)", () => {
    it("delegates to the repository's listByAuthor with the given author id", async () => {
      repo.seed(makePost({ id: "post-1", authorId: "author-1", status: "pending" }));
      repo.seed(makePost({ id: "post-2", authorId: "author-1", status: "active" }));
      repo.seed(makePost({ id: "post-3", authorId: "author-2", status: "active" }));

      const result = await service.listMyPosts("author-1");

      expect(repo.listByAuthorCalls).toEqual(["author-1"]);
      expect(result.map((p) => p.id).sort()).toEqual(["post-1", "post-2"]);
    });

    it("returns posts of any status, not just active ones", async () => {
      repo.seed(makePost({ id: "post-1", authorId: "author-1", status: "rejected" }));
      repo.seed(makePost({ id: "post-2", authorId: "author-1", status: "closed" }));

      const result = await service.listMyPosts("author-1");

      expect(result.map((p) => p.status).sort()).toEqual(["closed", "rejected"]);
    });
  });

  describe("getPost — single-post read with visibility rules (FR08, §7.2 defense-in-depth)", () => {
    function viewer(id: string, role: ActorRole = "user"): Actor {
      return { id, role };
    }

    it("returns an active post to an anonymous visitor (viewer: null)", async () => {
      repo.seed(makePost({ status: "active" }));

      const result = await service.getPost({ postId: "post-1", viewer: null });

      expect(result.id).toBe("post-1");
    });

    it("returns an active post to any authenticated user, author or not", async () => {
      repo.seed(makePost({ status: "active" }));

      const result = await service.getPost({
        postId: "post-1",
        viewer: viewer("stranger-1", "user"),
      });

      expect(result.id).toBe("post-1");
    });

    it("throws PostNotFoundError for a pending post viewed by an anonymous visitor", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.getPost({ postId: "post-1", viewer: null }),
      ).rejects.toThrow(PostNotFoundError);
    });

    it("throws PostNotFoundError for a pending post viewed by a stranger user (not the author, not a moderator)", async () => {
      repo.seed(makePost({ status: "pending" }));

      await expect(
        service.getPost({ postId: "post-1", viewer: viewer("stranger-1", "user") }),
      ).rejects.toThrow(PostNotFoundError);
    });

    it("returns a pending post to its own author", async () => {
      repo.seed(makePost({ status: "pending", authorId: "author-1" }));

      const result = await service.getPost({
        postId: "post-1",
        viewer: viewer("author-1", "user"),
      });

      expect(result.status).toBe("pending");
    });

    it("returns a pending post to a moderator", async () => {
      repo.seed(makePost({ status: "pending" }));

      const result = await service.getPost({
        postId: "post-1",
        viewer: viewer("moderator-1", "moderator"),
      });

      expect(result.status).toBe("pending");
    });

    it("returns a rejected post to an admin", async () => {
      repo.seed(makePost({ status: "rejected", rejectedReason: "Duplicate." }));

      const result = await service.getPost({
        postId: "post-1",
        viewer: viewer("admin-1", "admin"),
      });

      expect(result.status).toBe("rejected");
    });

    it("throws PostNotFoundError for a rejected post viewed by a stranger", async () => {
      repo.seed(makePost({ status: "rejected" }));

      await expect(
        service.getPost({ postId: "post-1", viewer: viewer("stranger-1", "user") }),
      ).rejects.toThrow(PostNotFoundError);
    });

    it("returns a closed post to its own author", async () => {
      repo.seed(makePost({ status: "closed", authorId: "author-1" }));

      const result = await service.getPost({
        postId: "post-1",
        viewer: viewer("author-1", "user"),
      });

      expect(result.status).toBe("closed");
    });

    it("throws PostNotFoundError for a closed post viewed by an anonymous visitor", async () => {
      repo.seed(makePost({ status: "closed" }));

      await expect(
        service.getPost({ postId: "post-1", viewer: null }),
      ).rejects.toThrow(PostNotFoundError);
    });

    it("throws PostNotFoundError when the post does not exist, regardless of viewer", async () => {
      await expect(
        service.getPost({ postId: "missing", viewer: null }),
      ).rejects.toThrow(PostNotFoundError);

      await expect(
        service.getPost({ postId: "missing", viewer: viewer("admin-1", "admin") }),
      ).rejects.toThrow(PostNotFoundError);
    });
  });
});
