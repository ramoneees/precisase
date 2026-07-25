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
 *
 * Atomicity (C6, commit `316bc45`): every state-transition method
 * (`createPost` / `approvePost` / `rejectPost` / `closePost` / `reopenPost`
 * / `resubmitPost` / `editActivePost`) is a thin shell that delegates to a
 * private `*Tx` body running inside `repo.withTransaction(fn)`. The full
 * read+write sequence — status guard, RBAC check, post update, audit log,
 * notification queue, moderation action — commits atomically via
 * `prisma.$transaction`, so a crash mid-transition can never leave the row
 * half-updated. New transition methods must follow the same shell+body
 * pattern.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention — do not import
// app-layer types that may not exist yet).
// ---------------------------------------------------------------------

import { PhoneService, type CountryCode } from "@/server/services/phone-service";

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

/**
 * Listing-view projection of a Post: every field a shop-window / my-posts /
 * moderation-queue row needs, with the encrypted contact info stripped.
 *
 * Why this exists: previously every list query loaded the full `PostRecord`
 * including the encrypted `contact_value`, which the repository decrypted
 * on every row (§7.4) — meaning the home page decrypted every active post's
 * contact phone/email into server memory even though the UI never renders
 * it. Returning `PostSummary` from list methods makes that path
 * structurally impossible.
 */
export type PostSummary = Omit<PostRecord, "contactMethod" | "contactValue">;

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
  /**
   * Cursor-based pagination: id of the last post on the previous page.
   * Combined with `limit`, the listing returns rows older than this
   * cursor (createdAt-desc order). Undefined on the first page.
   */
  after?: string;
  limit?: number;
}

export const DEFAULT_LISTING_PAGE_SIZE = 24;

export interface PaginatedPosts {
  items: PostSummary[];
  /**
   * Cursor for the next page, or `null` if the requested page was the
   * last one. The repository signals "more rows exist" by fetching
   * `limit + 1` rows and exposing the (limit+1)th row's id here.
   */
  nextCursor: string | null;
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
   * posts. Returns `PostSummary` (no contact info) — listings never render
   * contact details, and stripping them here makes it impossible for the
   * repository to silently decrypt rows it doesn't need to. Cursor-
   * paginated: fetch `limit + 1` rows and expose the trailing row's id as
   * `nextCursor` (null when the page was the last one).
   */
  listActive(filter: ListActivePostsFilter): Promise<PaginatedPosts>;
  /**
   * "My posts" query (author dashboard) — returns every post belonging to
   * `authorId` regardless of status (pending/active/closed/rejected), newest
   * first. Unlike `listActive`, this is intentionally not filtered by
   * status: the whole point of the my-posts view is to let an author see
   * posts still awaiting moderation or rejected.
   */
  listByAuthor(authorId: string): Promise<PostSummary[]>;
  /**
   * Moderation queue (FR15) — every post currently awaiting a moderation
   * decision, oldest first (so moderators clear the longest-waiting posts
   * first). Must only ever return `pending` posts.
   */
  listPending(): Promise<PostSummary[]>;
  /**
   * All users who previously expressed interest in this post (FR11 —
   * used by `closePost` to queue "post_closed" notifications for each).
   * Returns distinct user ids so a single user with multiple interests
   * gets one notification, not N.
   */
  listInterestedUserIds(postId: string): Promise<string[]>;
  addModerationAction(action: ModerationActionRecord): Promise<void>;
  addNotification(notification: NotificationRecord): Promise<void>;
  addAuditLog(log: AuditLogRecord): Promise<void>;
  /**
   * Runs `fn` against a repository view scoped to a single database
   * transaction (C6). Every read/write inside `fn` commits atomically;
   * if `fn` throws, the whole sequence rolls back so a crash mid-way can
   * never leave a half-applied state transition (post updated but audit
   * log missing, etc.). The Prisma-backed implementation wraps this in
   * `prisma.$transaction`; the in-memory test fake just invokes `fn`
   * directly (synchronous, no real atomicity needed).
   */
  withTransaction<T>(fn: (txRepo: PostRepository) => Promise<T>): Promise<T>;
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
  /**
   * `contactMethod`/`contactValue` are included here (beyond the original
   * title/description/categoryId/type surface) because a post can be
   * rejected specifically for bad contact info (§7.2) — without this, an
   * author would be stuck unable to fix the one thing moderation flagged.
   * Mirrors `EditActivePostInput.updates` and the same BR04 enforcement
   * below.
   */
  updates: Partial<
    Pick<
      PostRecord,
      "title" | "description" | "categoryId" | "type" | "contactMethod" | "contactValue" | "extraAttributes"
    >
  >;
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

/**
 * Module-level equivalent of the previous `requirePost` instance method,
 * callable inside a `withTransaction` block against the tx-scoped repo
 * (passed as `repo`). Throws `PostNotFoundError` if the post is absent.
 */
async function requirePostOn(repo: PostRepository, postId: string): Promise<PostRecord> {
  const post = await repo.findById(postId);
  if (!post) {
    throw new PostNotFoundError(postId);
  }
  return post;
}

function buildPostAuditEntry(args: {
  actorId: string;
  action: string;
  postId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): AuditLogRecord {
  return {
    actorId: args.actorId,
    action: args.action,
    targetType: "Post",
    targetId: args.postId,
    ...(args.before !== undefined ? { before: args.before } : {}),
    ...(args.after !== undefined ? { after: args.after } : {}),
  };
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

  /**
   * Public state-transition methods (below) wrap their full read+write
   * sequence in `repo.withTransaction` (C6) so the post update, audit
   * log, notifications, and moderation action commit atomically — a
   * crash mid-sequence can no longer leave a half-applied transition.
   *
   * The pattern: each public method is a thin `withTransaction` shell
   * that delegates to a `*Tx` private method taking the tx-scoped repo.
   * Guards (RBAC, status, BR04) live in the `*Tx` body and throw before
   * any write, so a failed guard rolls back the (empty) transaction
   * cheaply.
   */

  /** pending -> active (FR15). Only a moderator/admin may approve. */
  async approvePost(input: ApprovePostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.approvePostTx(tx, input));
  }

  private async approvePostTx(
    repo: PostRepository,
    { postId, moderator }: ApprovePostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

    if (!isModerator(moderator)) {
      throw new UnauthorizedPostActionError(
        "Only a moderator or admin can approve a post.",
      );
    }

    if (post.status !== "pending") {
      throw new InvalidPostTransitionError(post.status, "active");
    }

    const publishedAt = new Date();
    const updated = await repo.update(postId, {
      status: "active",
      publishedAt,
    });

    await repo.addModerationAction({
      postId,
      moderatorId: moderator.id,
      action: "approve",
    });

    await repo.addNotification({
      recipientId: post.authorId,
      postId,
      type: "post_approved",
      channel: "email",
      payload: { postId, title: post.title },
    });

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: moderator.id,
        action: "post.approve",
        postId,
        before: { status: post.status },
        after: { status: updated.status },
      }),
    );

    return updated;
  }

  /** pending -> rejected (FR15). Only a moderator/admin may reject; a reason is required. */
  async rejectPost(input: RejectPostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.rejectPostTx(tx, input));
  }

  private async rejectPostTx(
    repo: PostRepository,
    { postId, moderator, reason }: RejectPostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

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

    const updated = await repo.update(postId, {
      status: "rejected",
      rejectedReason: reason,
    });

    await repo.addModerationAction({
      postId,
      moderatorId: moderator.id,
      action: "reject",
      reason,
    });

    await repo.addNotification({
      recipientId: post.authorId,
      postId,
      type: "post_rejected",
      channel: "email",
      payload: { postId, title: post.title, reason },
    });

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: moderator.id,
        action: "post.reject",
        postId,
        before: { status: post.status },
        after: { status: updated.status, rejectedReason: reason },
      }),
    );

    return updated;
  }

  /**
   * active -> closed (FR04, BR03). Only the post's author or a
   * moderator/admin may close it.
   */
  async closePost(input: ClosePostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.closePostTx(tx, input));
  }

  private async closePostTx(
    repo: PostRepository,
    { postId, actor }: ClosePostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

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
    const updated = await repo.update(postId, {
      status: "closed",
      closedAt,
    });

    // FR11 — queue "post_closed" notifications for every user who
    // previously expressed interest. Distinct user ids, so a single user
    // with multiple interests gets one notification, not N. The
    // notification worker dispatches them via the existing email-template
    // path (email-templates.ts:134).
    const interestedUserIds = await repo.listInterestedUserIds(postId);
    await Promise.all(
      interestedUserIds.map((userId) =>
        repo.addNotification({
          recipientId: userId,
          postId,
          type: "post_closed",
          channel: "email",
          payload: { postId, title: post.title },
        }),
      ),
    );

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: actor.id,
        action: "post.close",
        postId,
        before: { status: post.status },
        after: { status: updated.status },
      }),
    );

    return updated;
  }

  /** closed -> active (FR05). Only the post's author may reopen it. */
  async reopenPost(input: ReopenPostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.reopenPostTx(tx, input));
  }

  private async reopenPostTx(
    repo: PostRepository,
    { postId, actor }: ReopenPostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

    if (actor.id !== post.authorId) {
      throw new UnauthorizedPostActionError(
        "Only the post's author can reopen it.",
      );
    }

    if (post.status !== "closed") {
      throw new InvalidPostTransitionError(post.status, "active");
    }

    const updated = await repo.update(postId, {
      status: "active",
      closedAt: null,
    });

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: actor.id,
        action: "post.reopen",
        postId,
        before: { status: post.status },
        after: { status: updated.status },
      }),
    );

    return updated;
  }

  /**
   * rejected -> pending (FR03). Only the post's author may edit and
   * resubmit; re-approval is required (safer than auto-re-publishing).
   */
  async resubmitPost(input: ResubmitPostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.resubmitPostTx(tx, input));
  }

  private async resubmitPostTx(
    repo: PostRepository,
    { postId, actor, updates }: ResubmitPostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

    if (actor.id !== post.authorId) {
      throw new UnauthorizedPostActionError(
        "Only the post's author can edit and resubmit it.",
      );
    }

    if (post.status !== "rejected") {
      throw new InvalidPostTransitionError(post.status, "pending");
    }

    if (updates.contactMethod !== undefined || updates.contactValue !== undefined) {
      this.requireContactInfo(
        updates.contactMethod ?? post.contactMethod,
        updates.contactValue ?? post.contactValue,
      );
    }

    const updated = await repo.update(postId, {
      ...updates,
      status: "pending",
      rejectedReason: null,
    });

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: actor.id,
        action: "post.resubmit",
        postId,
        before: { status: post.status, rejectedReason: post.rejectedReason },
        after: { status: updated.status },
      }),
    );

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

    return this.repo.withTransaction((tx) => this.createPostTx(tx, input));
  }

  private async createPostTx(
    repo: PostRepository,
    input: CreatePostInput,
  ): Promise<PostRecord> {
    const created = await repo.create(input);

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: input.authorId,
        action: "post.create",
        postId: created.id,
        after: { status: created.status },
      }),
    );

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
  async editActivePost(input: EditActivePostInput): Promise<PostRecord> {
    return this.repo.withTransaction((tx) => this.editActivePostTx(tx, input));
  }

  private async editActivePostTx(
    repo: PostRepository,
    { postId, actor, updates }: EditActivePostInput,
  ): Promise<PostRecord> {
    const post = await requirePostOn(repo, postId);

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

    const updated = await repo.update(postId, updates);

    await repo.addAuditLog(
      buildPostAuditEntry({
        actorId: actor.id,
        action: "post.edit",
        postId,
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
      }),
    );

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
  async listActivePosts(filter: ListActivePostsFilter = {}): Promise<PaginatedPosts> {
    return this.repo.listActive(filter);
  }

  /**
   * "My posts" view — thin delegation to the repository, same pattern as
   * `listActivePosts`, but returns posts of any status belonging to
   * `authorId` (an author needs to see pending/rejected posts too, not just
   * active ones).
   */
  async listMyPosts(authorId: string): Promise<PostSummary[]> {
    return this.repo.listByAuthor(authorId);
  }

  /**
   * Moderation queue (FR15) — thin delegation to the repository, same
   * pattern as `listActivePosts`/`listMyPosts`. Only pending posts are ever
   * returned (enforced by the port contract on `listPending`).
   */
  async listPendingPosts(): Promise<PostSummary[]> {
    return this.repo.listPending();
  }

  private requireContactInfo(contactMethod: string, contactValue: string): void {
    if (!contactMethod || !contactValue || contactValue.trim().length === 0) {
      throw new ContactInfoRequiredError();
    }
  }
}

/**
 * Thrown when a phone-format contact value cannot be parsed against the
 * caller's country hint. The `code` is the discriminated `PhoneValidationError.code`
 * (EMPTY / NOT_A_NUMBER / INVALID_FOR_COUNTRY / TOO_SHORT / TOO_LONG) so
 * callers can map it to a localized message without parsing error strings.
 *
 * Distinct from `ContactInfoRequiredError`, which only fires on an empty
 * value — that one means "you didn't fill the field"; this one means
 * "you filled it with something the phone parser can't make sense of".
 */
export class InvalidPhoneError extends Error {
  constructor(public readonly code: string) {
    super(`Invalid phone number: ${code}`);
    this.name = "InvalidPhoneError";
  }
}

/**
 * Validates and normalizes a post's contact value against the chosen
 * method and a phone-country hint. Returns E.164 for `phone`/`whatsapp`
 * (the canonical form stored at the service boundary per §7.4) or the
 * trimmed raw value for `email` (no normalization). Throws
 * `ContactInfoRequiredError` if the value is empty after trimming, or
 * `InvalidPhoneError` if `PhoneService.parse` rejects the input for
 * phone/whatsapp. The country hint is required for phone/whatsapp —
 * callers typically derive it from `User.country` with
 * `PHONE_COUNTRY_DEFAULT` as the final fallback.
 */
export function normalizeContactValue(
  method: ContactMethodValue,
  rawValue: string,
  country: CountryCode,
): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new ContactInfoRequiredError();
  }
  if (method === "phone" || method === "whatsapp") {
    const result = PhoneService.parse(trimmed, country);
    if (!result.ok) {
      throw new InvalidPhoneError(result.code);
    }
    return result.e164;
  }
  return trimmed;
}
