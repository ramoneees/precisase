/**
 * Prisma-backed implementation of the `PasswordResetRepository` port
 * (src/server/services/password-reset-service.ts).
 */

import type { Prisma } from "@/generated/prisma/client";
import type {
  AuditLogRecord,
  PasswordResetRepository,
} from "@/server/services/password-reset-service";
import { prisma } from "./prisma-client";

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  async findUserByEmail(
    email: string,
  ): Promise<{ id: string; email: string; displayName: string } | null> {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true },
    });
  }

  async createToken(data: {
    userId: string;
    hashedToken: string;
    expiresAt: Date;
  }): Promise<void> {
    await prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        hashedToken: data.hashedToken,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findTokenByHash(
    hashedToken: string,
  ): Promise<{ id: string; userId: string; expiresAt: Date; usedAt: Date | null } | null> {
    return prisma.passwordResetToken.findUnique({
      where: { hashedToken },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async markTokenUsed(tokenId: string, usedAt: Date): Promise<void> {
    await prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: { usedAt },
    });
  }

  async addAuditLog(log: AuditLogRecord): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: log.actorId ?? null,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId ?? null,
        before: log.before === undefined ? undefined : (log.before as Prisma.InputJsonValue),
        after: log.after === undefined ? undefined : (log.after as Prisma.InputJsonValue),
      },
    });
  }

  async queueEmailNotification(input: {
    recipientId: string;
    type: "password_reset";
    payload: Record<string, unknown>;
  }): Promise<void> {
    await prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        postId: null,
        type: input.type,
        channel: "email",
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}
