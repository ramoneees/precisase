/**
 * Prisma-backed implementation of the `InterestRepository` port
 * (src/server/services/interest-service.ts). Maps the `(post_id, user_id)`
 * unique constraint (§5.1) onto `DuplicateInterestError` as a second line
 * of defense behind `InterestService`'s own existence check.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  DuplicateInterestError,
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
  }): Promise<InterestRecord> {
    try {
      const created = await prisma.interest.create({
        data: {
          postId: data.postId,
          userId: data.userId,
          message: data.message,
        },
      });

      return {
        id: created.id,
        postId: created.postId,
        userId: created.userId,
        message: created.message,
        createdAt: created.createdAt,
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new DuplicateInterestError(data.postId, data.userId);
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
