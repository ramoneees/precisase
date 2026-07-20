/**
 * Prisma-backed implementation of the `InterestRepository` port
 * (src/server/services/interest-service.ts). Enforces the `(post_id,
 * user_id)` unique constraint (§5.1) as the single line of defense against
 * duplicate interest: on a `P2002` violation it re-fetches and returns the
 * existing row with `created: false` (C7 idempotency contract).
 */

import { Prisma } from "@/generated/prisma/client";
import {
  type InterestPostSummary,
  type InterestRecord,
  type InterestRepository,
  type NotificationRecord,
} from "@/server/services/interest-service";
import { prisma } from "./prisma-client";

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export class PrismaInterestRepository implements InterestRepository {
  async findPostById(postId: string): Promise<InterestPostSummary | null> {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, status: true, title: true },
    });
    if (!post) {
      return null;
    }

    return {
      id: post.id,
      authorId: post.authorId,
      status: post.status,
      title: post.title,
    };
  }

  async findInterest(postId: string, userId: string): Promise<InterestRecord | null> {
    const interest = await prisma.interest.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!interest) {
      return null;
    }

    return {
      id: interest.id,
      postId: interest.postId,
      userId: interest.userId,
      message: interest.message,
      createdAt: interest.createdAt,
    };
  }

  async createInterest(data: {
    postId: string;
    userId: string;
    message: string | null;
  }): Promise<{ record: InterestRecord; created: boolean }> {
    try {
      const created = await prisma.interest.create({
        data: {
          postId: data.postId,
          userId: data.userId,
          message: data.message,
        },
      });

      return {
        record: {
          id: created.id,
          postId: created.postId,
          userId: created.userId,
          message: created.message,
          createdAt: created.createdAt,
        },
        created: true,
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const existing = await this.findInterest(data.postId, data.userId);
        if (existing) {
          return { record: existing, created: false };
        }
        // Constraint fired but the row is gone — extremely unlikely (concurrent
        // delete). Re-throw so the caller surfaces a generic error rather than
        // masking an inconsistent state.
        throw error;
      }
      throw error;
    }
  }

  async addNotification(notification: NotificationRecord): Promise<void> {
    await prisma.notification.create({
      data: {
        recipientId: notification.recipientId,
        postId: notification.postId ?? null,
        type: notification.type,
        channel: notification.channel,
        status: notification.status,
        payload: notification.payload as Prisma.InputJsonValue,
      },
    });
  }
}
