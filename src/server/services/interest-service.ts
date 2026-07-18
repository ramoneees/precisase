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
 * interest-service.test.ts). A Prisma-backed implementation of
 * `InterestRepository` maps `DuplicateInterestError` onto the database's
 * `(post_id, user_id)` unique constraint (§5.1) as a second line of
 * defense.
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
  createInterest(data: {
    postId: string;
    userId: string;
    message: string | null;
  }): Promise<InterestRecord>;
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

/** Maps onto the `(post_id, user_id)` unique constraint from §5.1. */
export class DuplicateInterestError extends Error {
  constructor(postId: string, userId: string) {
    super(`User ${userId} has already expressed interest in post ${postId}.`);
    this.name = "DuplicateInterestError";
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

    const existing = await this.repo.findInterest(postId, userId);
    if (existing) {
      throw new DuplicateInterestError(postId, userId);
    }

    const interest = await this.repo.createInterest({ postId, userId, message: trimmedMessage });

    await this.repo.addNotification({
      recipientId: post.authorId,
      postId,
      type: "interest_received",
      channel: "email",
      status: "queued",
      payload: { postId, title: post.title, interestedUserId: userId, message: trimmedMessage },
    });

    return interest;
  }
}
