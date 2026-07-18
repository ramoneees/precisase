/**
 * Prisma-backed implementation of the `AccountDeletionRepository` port
 * (src/server/services/account-deletion-service.ts) — NFR08 self-service
 * GDPR/LGPD deletion, docs/ARCHITECTURE.md §6.4/§7.5, Q8/Q9.
 *
 * `redactAndDeleteAccount` wraps every write in a single `prisma.$transaction`
 * so a partial failure (e.g. the process crashing mid-way) can never leave an
 * account half-redacted — the account is either fully anonymized or the
 * whole operation rolls back and the caller can retry.
 */

import type {
  AccountDeletionRepository,
  AccountDeletionUserRecord,
  AccountRedaction,
} from "@/server/services/account-deletion-service";
import { prisma } from "./prisma-client";

export class PrismaAccountDeletionRepository implements AccountDeletionRepository {
  async findUserById(userId: string): Promise<AccountDeletionUserRecord | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        deletedAt: true,
      },
    });
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      deletedAt: user.deletedAt,
    };
  }

  async redactAndDeleteAccount(userId: string, redaction: AccountRedaction): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // User PII redaction (§6.4: "Anonymize User PII (email, phone, name
      // -> redacted)"). `phoneE164` and `churchAffiliation` (FR13) are
      // cleared; `role`/`locale`/timestamps are left untouched — they carry
      // no PII and clearing them would only complicate audit review.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: redaction.email,
          displayName: redaction.displayName,
          phoneE164: null,
          churchAffiliation: null,
          passwordHash: redaction.passwordHash,
          deletedAt: redaction.deletedAt,
        },
      });

      // Withdraw consent (§6.4: "UPDATE ConsentRecord withdrawn_at=now()").
      await tx.consentRecord.updateMany({
        where: { userId, withdrawnAt: null },
        data: { withdrawnAt: redaction.deletedAt },
      });

      // Delete the user's own Interest rows (§6.4: "DELETE Interest rows
      // for user"). Posts are intentionally left untouched — see the
      // AccountDeletionService module doc comment for the reasoning
      // (Q9: anonymize-in-place; the PII risk on Post was already limited
      // to the encrypted contact_value and the now-anonymized author FK).
      await tx.interest.deleteMany({ where: { userId } });

      // Accountability audit trail (§6.4, §7.6, Q8 — retention suggested
      // at 12 months pending legal guidance).
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "user.gdpr_delete",
          targetType: "User",
          targetId: userId,
        },
      });
    });
  }
}
