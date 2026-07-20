/**
 * InterestService — implements "express interest" (FR09) and the resulting
 * author-notification flow from docs/ARCHITECTURE.md §6.2:
 *
 *   Interested user -> expressInterest(postId, message)
 *     -> INSERT Interest (unique post_id + user_id)
 *     -> INSERT Notification(interest_received -> author)
 *
 * Like PostService, this module depends on a narrow `InterestRepository`
 * port rather than the full Prisma client, so the unique-constraint and
 * notification behavior can be unit-tested with an in-memory fake (see
 * interest-service.test.ts).
 *
 * Idempotency (C7): `expressInterest` is idempotent for a given
 * (postId, userId) pair. The repository's `createInterest` returns
 * `{ record, created }` — on the unique-constraint hit (concurrent or
 * sequential duplicate), it surfaces the existing row with
 * `created: false` instead of throwing, and the service skips the
 * author notification in that case. This eliminates the TOCTOU race the
 * earlier find-then-create sequence had under concurrent duplicate
 * clicks.
 */

// ---------------------------------------------------------------------
// Local domain types (kept local per project convention).
// ---------------------------------------------------------------------

export type InterestPostStatus = "pending" | "active" | "closed" | "rejected";

/** The subset of Post fields InterestService needs to validate a request. */
export interface InterestPostSummary {
  id: string;
  authorId: string;
  status: InterestPostStatus;
  title: string;
}

export interface InterestRecord {
  id: string;
  postId: string;
  userId: string;
  message: string | null;
  createdAt: Date;
}

export interface NotificationRecord {
  recipientId: string;
  postId?: string | null;
  type: "interest_received" | "post_approved" | "post_rejected" | "post_closed";
  channel: "email" | "in_app";
  status: "queued" | "sent" | "failed";
  payload: Record<string, unknown>;
}

/**
 * Data-access port consumed by `InterestService`.
 */
export interface InterestRepository {
  findPostById(postId: string): Promise<InterestPostSummary | null>;
  findInterest(postId: string, userId: string): Promise<InterestRecord | null>;
  /**
   * Inserts an interest row, enforcing the `(post_id, user_id)` unique
   * constraint (§5.1) as the single line of defense against duplicates.
   *
   * Idempotent contract (C7): returns `{ record, created }`. The Prisma
   * implementation catches the `P2002` unique-violation and re-fetches
   * the existing row, returning it with `created: false`. The service
   * uses the `created` flag to decide whether to notify the author, so
   * duplicate requests never produce a second notification.
   */
  createInterest(data: {
    postId: string;
    userId: string;
    message: string | null;
  }): Promise<{ record: InterestRecord; created: boolean }>;
  addNotification(notification: NotificationRecord): Promise<void>;
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

export class PostNotAvailableError extends Error {
  constructor(postId: string, status: InterestPostStatus) {
    super(`Post ${postId} is "${status}" and is not accepting new interest.`);
    this.name = "PostNotAvailableError";
  }
}

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export interface ExpressInterestInput {
  postId: string;
  userId: string;
  message?: string | null;
}

export const MAX_INTEREST_MESSAGE_LENGTH = 1000;

export class InterestMessageTooLongError extends Error {
  constructor(maxLength: number) {
    super(`Interest message must be at most ${maxLength} characters.`);
    this.name = "InterestMessageTooLongError";
  }
}

export class InterestService {
  constructor(private readonly repo: InterestRepository) {}

  /**
   * FR09 — register interest in a post and queue the "someone is
   * interested" notification for its author (§6.2). Only active posts can
   * receive interest: the shop window only ever surfaces `active` posts,
   * so pending/closed/rejected posts cannot legitimately receive one.
   *
   * Idempotent (C7): if an interest row already exists for this
   * (postId, userId) pair — whether from a concurrent click or a
   * sequential re-submit — the existing record is returned and no
   * duplicate notification is queued. The (post_id, user_id) unique
   * constraint is the single line of defense; the repo signals "already
   * exists" via `created: false`.
   */
  async expressInterest({
    postId,
    userId,
    message = null,
  }: ExpressInterestInput): Promise<InterestRecord> {
    const trimmedMessage = message !== null ? message.trim() : null;
    if (trimmedMessage !== null && trimmedMessage.length > MAX_INTEREST_MESSAGE_LENGTH) {
      throw new InterestMessageTooLongError(MAX_INTEREST_MESSAGE_LENGTH);
    }

    const post = await this.repo.findPostById(postId);
    if (!post) {
      throw new PostNotFoundError(postId);
    }

    if (post.status !== "active") {
      throw new PostNotAvailableError(postId, post.status);
    }

    const { record, created } = await this.repo.createInterest({
      postId,
      userId,
      message: trimmedMessage,
    });

    if (created) {
      await this.repo.addNotification({
        recipientId: post.authorId,
        postId,
        type: "interest_received",
        channel: "email",
        status: "queued",
        payload: { postId, title: post.title, interestedUserId: userId, message: trimmedMessage },
      });
    }

    return record;
  }
}
