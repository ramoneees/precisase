/**
 * PostService — implements the Post state machine from
 * docs/ARCHITECTURE.md §5.3:
 *
 *   [*]      --> pending  : author creates (FR01)
 *   pending  --> active   : moderator approves (FR15)
 *   pending  --> rejected : moderator rejects (FR15)
 *   active   --> closed   : author or moderator closes (FR04, BR03)
 *   closed   --> active   : author reopens (FR05)
 *   rejected --> pending  : author edits & resubmits (FR03)
 *
 * A Post is in exactly one state at a time (BR02). This module is
 * intentionally decoupled from Prisma: it depends on the `PostRepository`
 * port below, so unit tests can supply an in-memory fake instead of a live
 * database (see post-service.test.ts). A Prisma-backed implementation of
 * `PostRepository` lives alongside the route handlers that wire this
 * service up to `src/generated/prisma`.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention — do not import
// app-layer types that may not exist yet).
// ---------------------------------------------------------------------

export type ActorRole = "user" | "moderator" | "admin";

export type PostStatusValue = "pending" | "active" | "closed" | "rejected";

export type PostTypeValue = "request" | "offer";

export type ContactMethodValue = "phone" | "whatsapp" | "email";

export interface Actor {
  id: string;
  role: ActorRole;
}

export interface PostRecord {
  id: string;
  authorId: string;
  categoryId: string;
  type: PostTypeValue;
  status: PostStatusValue;
  title: string;
  description: string;
  /**
   * How the author prefers to be reached (§5.1). Plaintext at the
   * service/domain boundary — only the Prisma-backed repository
   * implementation deals with encrypted bytes (§7.4).
   */
  contactMethod: ContactMethodValue;
  /** Plaintext contact value (see note on `contactMethod` above). */
  contactValue: string;
  locale: string;
  /**
   * Phase-2 extension hook (§5.4) — free-form JSON, `{}` by default. The
   * only key the UI currently understands is `photos: string[]` (relative
   * upload paths for post photos, an MVP scope decision recorded in the
   * shop-window UI build, not a schema migration).
   */
  extraAttributes: Record<string, unknown>;
  publishedAt: Date | null;
  closedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationActionRecord {
  postId: string;
  moderatorId: string;
  action: "approve" | "reject" | "remove";
  reason?: string | null;
}

export interface NotificationRecord {
  recipientId: string;
  postId?: string | null;
  type: "interest_received" | "post_approved" | "post_rejected" | "post_closed";
  channel: "email" | "in_app";
  payload: Record<string, unknown>;
}

export interface AuditLogRecord {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Fields a caller supplies when creating a new post (FR01).
 * `extraAttributes` is optional at creation time (defaults to `{}`, mirroring
 * the DB column default) — most callers (e.g. the create-post form) won't
 * set it explicitly.
 */
export type CreatePostData = Omit<
  PostRecord,
  | "id"
  | "status"
  | "publishedAt"
  | "closedAt"
  | "rejectedReason"
  | "createdAt"
  | "updatedAt"
  | "extraAttributes"
> & { extraAttributes?: Record<string, unknown> };

/** Filter accepted by the shop-window listing query (FR06–FR08). */
export interface ListActivePostsFilter {
  categoryId?: string;
  type?: PostTypeValue;
  search?: string;
}

/**
 * Data-access port consumed by `PostService`. Keeping this narrow (rather
 * than depending on the full Prisma client) is what makes the state machine
 * unit-testable without a database.
 */
export interface PostRepository {
  findById(id: string): Promise<PostRecord | null>;
  update(id: string, data: Partial<PostRecord>): Promise<PostRecord>;
  /**
   * Creates a new post. Always persisted as `pending` regardless of what a
   * caller passes in `data` (BR01) — `PostService.createPost` never lets a
   * caller-supplied status through. The repository implementation
   * (Prisma-backed) is responsible for encrypting `contactValue` before
   * writing it; this port only ever sees plaintext.
   */
  create(data: CreatePostData): Promise<PostRecord>;
  /**
   * Shop-window listing query (FR06–FR08) — read-only, filtering/search is
   * a query concern left to the repository implementation (e.g. Postgres
   * full-text/trigram search per §5.1). Must only ever return `active`
   * posts.
   */
  listActive(filter: ListActivePostsFilter): Promise<PostRecord[]>;
  /**
   * "My posts" query (author dashboard) — returns every post belonging to
   * `authorId` regardless of status (pending/active/closed/rejected), newest
   * first. Unlike `listActive`, this is intentionally not filtered by
   * status: the whole point of the my-posts view is to let an author see
   * posts still awaiting moderation or rejected.
   */
  listByAuthor(authorId: string): Promise<PostRecord[]>;
  /**
   * Moderation queue (FR15) — every post currently awaiting a moderation
   * decision, oldest first (so moderators clear the longest-waiting posts
   * first). Must only ever return `pending` posts.
   */
  listPending(): Promise<PostRecord[]>;
  addModerationAction(action: ModerationActionRecord): Promise<void>;
  addNotification(notification: NotificationRecord): Promise<void>;
  addAuditLog(log: AuditLogRecord): Promise<void>;
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class PostNotFoundError extends Error {
  constructor(postId: string) {
    super(`Post ${postId} was not found.`);
    this.name = "PostNotFoundError";
  }
}

export class InvalidPostTransitionError extends Error {
  constructor(from: PostStatusValue, to: PostStatusValue) {
    super(`Cannot transition post from "${from}" to "${to}".`);
    this.name = "InvalidPostTransitionError";
  }
}

export class UnauthorizedPostActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedPostActionError";
  }
}

export class ModerationReasonRequiredError extends Error {
  constructor() {
    super("A reason is required to reject a post.");
    this.name = "ModerationReasonRequiredError";
  }
}

/** BR04 — every post must include at least one valid contact method. */
export class ContactInfoRequiredError extends Error {
  constructor() {
    super("A post must include a contact method and a non-empty contact value.");
    this.name = "ContactInfoRequiredError";
  }
}

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export interface ApprovePostInput {
  postId: string;
  moderator: Actor;
}

export interface RejectPostInput {
  postId: string;
  moderator: Actor;
  reason: string;
}

export interface ClosePostInput {
  postId: string;
  actor: Actor;
}

export interface ReopenPostInput {
  postId: string;
  actor: Actor;
}

export interface ResubmitPostInput {
  postId: string;
  actor: Actor;
  updates: Partial<Pick<PostRecord, "title" | "description" | "categoryId" | "type">>;
}

/** FR01 — a new post always starts `pending` (BR01); the caller cannot set status. */
export type CreatePostInput = CreatePostData;

/**
 * `viewer: null` represents an unauthenticated visitor browsing the shop
 * window anonymously (Q15 — anonymous browsing is assumed).
 */
export interface GetPostInput {
  postId: string;
  viewer: Actor | null;
}

export interface EditActivePostInput {
  postId: string;
  actor: Actor;
  updates: Partial<
    Pick<PostRecord, "title" | "description" | "contactMethod" | "contactValue">
  >;
}

function isModerator(actor: Actor): boolean {
  return actor.role === "moderator" || actor.role === "admin";
}

export class PostService {
  constructor(private readonly repo: PostRepository) {}

  private async requirePost(postId: string): Promise<PostRecord> {
    const post = await this.repo.findById(postId);
    if (!post) {
      throw new PostNotFoundError(postId);
    }
    return post;
  }

  /** pending -> active (FR15). Only a moderator/admin may approve. */
  async approvePost({ postId, moderator }: ApprovePostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (!isModerator(moderator)) {
      throw new UnauthorizedPostActionError(
        "Only a moderator or admin can approve a post.",
      );
    }

    if (post.status !== "pending") {
      throw new InvalidPostTransitionError(post.status, "active");
    }

    const publishedAt = new Date();
    const updated = await this.repo.update(postId, {
      status: "active",
      publishedAt,
    });

    await this.repo.addModerationAction({
      postId,
      moderatorId: moderator.id,
      action: "approve",
    });

    await this.repo.addNotification({
      recipientId: post.authorId,
      postId,
      type: "post_approved",
      channel: "email",
      payload: { postId, title: post.title },
    });

    await this.repo.addAuditLog({
      actorId: moderator.id,
      action: "post.approve",
      targetType: "Post",
      targetId: postId,
      before: { status: post.status },
      after: { status: updated.status },
    });

    return updated;
  }

  /** pending -> rejected (FR15). Only a moderator/admin may reject; a reason is required. */
  async rejectPost({ postId, moderator, reason }: RejectPostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (!isModerator(moderator)) {
      throw new UnauthorizedPostActionError(
        "Only a moderator or admin can reject a post.",
      );
    }

    if (post.status !== "pending") {
      throw new InvalidPostTransitionError(post.status, "rejected");
    }

    if (!reason || reason.trim().length === 0) {
      throw new ModerationReasonRequiredError();
    }

    const updated = await this.repo.update(postId, {
      status: "rejected",
      rejectedReason: reason,
    });

    await this.repo.addModerationAction({
      postId,
      moderatorId: moderator.id,
      action: "reject",
      reason,
    });

    await this.repo.addNotification({
      recipientId: post.authorId,
      postId,
      type: "post_rejected",
      channel: "email",
      payload: { postId, title: post.title, reason },
    });

    await this.repo.addAuditLog({
      actorId: moderator.id,
      action: "post.reject",
      targetType: "Post",
      targetId: postId,
      before: { status: post.status },
      after: { status: updated.status, rejectedReason: reason },
    });

    return updated;
  }

  /**
   * active -> closed (FR04, BR03). Only the post's author or a
   * moderator/admin may close it.
   */
  async closePost({ postId, actor }: ClosePostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    const isAuthor = actor.id === post.authorId;
    if (!isAuthor && !isModerator(actor)) {
      throw new UnauthorizedPostActionError(
        "Only the post's author or a moderator can close it.",
      );
    }

    if (post.status !== "active") {
      throw new InvalidPostTransitionError(post.status, "closed");
    }

    const closedAt = new Date();
    const updated = await this.repo.update(postId, {
      status: "closed",
      closedAt,
    });

    await this.repo.addAuditLog({
      actorId: actor.id,
      action: "post.close",
      targetType: "Post",
      targetId: postId,
      before: { status: post.status },
      after: { status: updated.status },
    });

    return updated;
  }

  /** closed -> active (FR05). Only the post's author may reopen it. */
  async reopenPost({ postId, actor }: ReopenPostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (actor.id !== post.authorId) {
      throw new UnauthorizedPostActionError(
        "Only the post's author can reopen it.",
      );
    }

    if (post.status !== "closed") {
      throw new InvalidPostTransitionError(post.status, "active");
    }

    const updated = await this.repo.update(postId, {
      status: "active",
      closedAt: null,
    });

    await this.repo.addAuditLog({
      actorId: actor.id,
      action: "post.reopen",
      targetType: "Post",
      targetId: postId,
      before: { status: post.status },
      after: { status: updated.status },
    });

    return updated;
  }

  /**
   * rejected -> pending (FR03). Only the post's author may edit and
   * resubmit; re-approval is required (safer than auto-re-publishing).
   */
  async resubmitPost({ postId, actor, updates }: ResubmitPostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (actor.id !== post.authorId) {
      throw new UnauthorizedPostActionError(
        "Only the post's author can edit and resubmit it.",
      );
    }

    if (post.status !== "rejected") {
      throw new InvalidPostTransitionError(post.status, "pending");
    }

    const updated = await this.repo.update(postId, {
      ...updates,
      status: "pending",
      rejectedReason: null,
    });

    await this.repo.addAuditLog({
      actorId: actor.id,
      action: "post.resubmit",
      targetType: "Post",
      targetId: postId,
      before: { status: post.status, rejectedReason: post.rejectedReason },
      after: { status: updated.status },
    });

    return updated;
  }

  /**
   * [*] -> pending (FR01). A new post always starts `pending`, since every
   * post requires moderator approval by default (BR01) — there is no
   * "trusted author" bypass in the MVP. Enforces BR04 (contact method +
   * value required) at the service level: the DB also enforces `not null`
   * on both columns, but a descriptive error here beats a constraint
   * violation surfacing to the user.
   */
  async createPost(input: CreatePostInput): Promise<PostRecord> {
    this.requireContactInfo(input.contactMethod, input.contactValue);

    const created = await this.repo.create(input);

    await this.repo.addAuditLog({
      actorId: input.authorId,
      action: "post.create",
      targetType: "Post",
      targetId: created.id,
      after: { status: created.status },
    });

    return created;
  }

  /**
   * active -> active (FR03). Editing an *active* post keeps it `active`
   * rather than resetting to `pending` — the recorded default for Q7 in
   * ARCHITECTURE.md §5.3/§12. Only the author may edit. Writes an
   * `AuditLog` entry (not a `ModerationAction` — there is no moderator
   * involved in a self-edit, and `ModerationAction.moderatorId` is
   * non-nullable in the schema).
   */
  async editActivePost({ postId, actor, updates }: EditActivePostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (actor.id !== post.authorId) {
      throw new UnauthorizedPostActionError("Only the post's author can edit it.");
    }

    if (post.status !== "active") {
      throw new InvalidPostTransitionError(post.status, "active");
    }

    if (updates.contactMethod !== undefined || updates.contactValue !== undefined) {
      this.requireContactInfo(
        updates.contactMethod ?? post.contactMethod,
        updates.contactValue ?? post.contactValue,
      );
    }

    const updated = await this.repo.update(postId, updates);

    await this.repo.addAuditLog({
      actorId: actor.id,
      action: "post.edit",
      targetType: "Post",
      targetId: postId,
      before: {
        title: post.title,
        description: post.description,
        contactMethod: post.contactMethod,
      },
      after: {
        title: updated.title,
        description: updated.description,
        contactMethod: updated.contactMethod,
      },
    });

    return updated;
  }

  /**
   * FR08 — single-post read (detail view). Visibility rule (§7.2
   * defense-in-depth): `active` posts are visible to anyone, including an
   * anonymous visitor (`viewer: null`). A `pending`/`rejected`/`closed` post
   * is visible only to its author or a moderator/admin — anyone else gets
   * the *same* `PostNotFoundError` a genuinely missing post would raise, so
   * existence of a non-active post is never leaked via a different error
   * shape (a 404-shaped response either way is the correct security
   * posture).
   */
  async getPost({ postId, viewer }: GetPostInput): Promise<PostRecord> {
    const post = await this.requirePost(postId);

    if (post.status === "active") {
      return post;
    }

    const canSeeNonActivePost =
      viewer !== null && (viewer.id === post.authorId || isModerator(viewer));

    if (!canSeeNonActivePost) {
      throw new PostNotFoundError(postId);
    }

    return post;
  }

  /**
   * Shop-window listing (FR06–FR08). Thin delegation to the repository —
   * filtering/search is mostly a query concern (Postgres full-text +
   * trigram search per §5.1) — but the port contract guarantees only
   * `active` posts are ever returned.
   */
  async listActivePosts(filter: ListActivePostsFilter = {}): Promise<PostRecord[]> {
    return this.repo.listActive(filter);
  }

  /**
   * "My posts" view — thin delegation to the repository, same pattern as
   * `listActivePosts`, but returns posts of any status belonging to
   * `authorId` (an author needs to see pending/rejected posts too, not just
   * active ones).
   */
  async listMyPosts(authorId: string): Promise<PostRecord[]> {
    return this.repo.listByAuthor(authorId);
  }

  /**
   * Moderation queue (FR15) — thin delegation to the repository, same
   * pattern as `listActivePosts`/`listMyPosts`. Only pending posts are ever
   * returned (enforced by the port contract on `listPending`).
   */
  async listPendingPosts(): Promise<PostRecord[]> {
    return this.repo.listPending();
  }

  private requireContactInfo(contactMethod: string, contactValue: string): void {
    if (!contactMethod || !contactValue || contactValue.trim().length === 0) {
      throw new ContactInfoRequiredError();
    }
  }
}
