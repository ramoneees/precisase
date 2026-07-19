/**
 * Prisma-backed implementation of the `MfaRepository` port
 * (src/server/services/mfa-service.ts).
 */

import type { Prisma } from "@/generated/prisma/client";
import type { AuditLogRecord, MfaRepository, MfaState } from "@/server/services/mfa-service";
import { prisma } from "./prisma-client";

export class PrismaMfaRepository implements MfaRepository {
  async getMfaState(userId: string): Promise<MfaState | null> {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
  }

  async savePendingSecret(userId: string, encryptedSecretBase64: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptedSecretBase64, mfaEnabledAt: null },
    });
  }

  async enableMfa(userId: string, enabledAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabledAt: enabledAt },
    });
  }

  async disableMfa(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    return user?.passwordHash ?? null;
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
}
