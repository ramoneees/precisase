/**
 * Prisma-backed `EmailSuppressionChecker` — the production implementation
 * of the port declared in
 * `src/server/services/notification-dispatch-service.ts`.
 *
 * Lives here (in `src/server/repositories/`) and not in
 * `src/server/notifications/mailer.ts` because per
 * `src/server/repositories/AGENTS.md`, this directory is the only place
 * in `src/server/` (other than `src/server/auth/`) allowed to import
 * from `@/generated/prisma/client`. Keeping the import here preserves
 * the layering invariant that lets `mailer.ts` and the dispatch service
 * be unit-tested without Prisma in the dependency graph.
 *
 * What it does: reads the two nullable timestamp columns set by the
 * Resend webhook (`src/app/api/webhooks/resend/route.ts`). Returns the
 * reason matching the column that's set; if both are set (a user
 * bounced once and later filed a complaint), `bounced` wins because
 * that's the more actionable signal for an operator reviewing the
 * suppression list.
 */
import { prisma } from "./prisma-client";
import type { EmailSuppressionChecker } from "@/server/services/notification-dispatch-service";

export class PrismaEmailSuppressionChecker implements EmailSuppressionChecker {
  constructor(private readonly client: typeof prisma = prisma) {}

  async checkStatus(email: string): Promise<"bounced" | "complained" | null> {
    const row = await this.client.user.findUnique({
      where: { email },
      select: { emailBouncedAt: true, emailComplainedAt: true },
    });
    if (!row) return null;
    if (row.emailBouncedAt !== null) return "bounced";
    if (row.emailComplainedAt !== null) return "complained";
    return null;
  }
}
