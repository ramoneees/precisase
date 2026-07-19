/**
 * Notification worker entrypoint — docs/ARCHITECTURE.md §3.1: "a separate
 * worker process handles asynchronous notifications... runs the SAME
 * Docker image, just a different entrypoint command." This is that
 * entrypoint. `docker-compose.yml`'s `worker` service (and `pnpm worker`
 * locally) run this file.
 *
 * Responsibilities:
 *   - Wire `NotificationDispatchService` to the Prisma-backed repository
 *     and a `Mailer` (Resend if `RESEND_API_KEY` is set, else a
 *     dev-friendly console/file mailer — see src/server/notifications/mailer.ts).
 *   - Poll for queued notifications every `POLL_INTERVAL_MS` (10s by
 *     default — frequent enough that a user isn't left wondering for
 *     minutes whether their post was approved, infrequent enough not to
 *     hammer Postgres with an empty-queue `SELECT` every second).
 *   - Handle SIGTERM/SIGINT for a clean shutdown: finish the in-flight
 *     batch, then exit, instead of being killed mid-batch by Docker.
 *
 * Run locally with `pnpm worker` (uses the same `DATABASE_URL`/.env.local
 * setup as `pnpm dev`). In Docker, this runs via `tsx` — see the Dockerfile
 * comment block for why the runtime image includes `tsx` + source instead
 * of the slim Next.js standalone output used by the `web` service.
 */

import { NotificationDispatchService } from "@/server/services/notification-dispatch-service";
import { TemplateEmailBuilder } from "@/server/notifications/email-templates";
import { createMailer } from "@/server/notifications/mailer";
import { PrismaNotificationRepository } from "@/server/repositories/prisma-notification-repository";
import { prisma } from "@/server/repositories/prisma-client";
import { logger } from "@/server/logger";

const POLL_INTERVAL_MS = Number(process.env.NOTIFICATION_WORKER_POLL_INTERVAL_MS) || 10_000;
const BATCH_SIZE = Number(process.env.NOTIFICATION_WORKER_BATCH_SIZE) || 20;

function log(message: string): void {
  console.log(`[notification-worker] ${message}`);
}

function jitteredDelay(baseMs: number): number {
  const quarter = baseMs * 0.25;
  return Math.max(1, baseMs + (Math.random() * 2 - 1) * quarter);
}

async function runOnce(service: NotificationDispatchService): Promise<void> {
  const startedAt = Date.now();
  const results = await service.dispatchQueued(BATCH_SIZE);
  const durationMs = Date.now() - startedAt;
  if (results.length === 0) {
    return;
  }

  const sent = results.filter((r) => r.outcome === "sent").length;
  const retrying = results.filter((r) => r.outcome === "retrying").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  logger.info({
    module: "notification-worker",
    event: "poll_complete",
    sent,
    retrying,
    failed,
    durationMs,
  });
}

async function main(): Promise<void> {
  log(
    `starting (poll interval: ${POLL_INTERVAL_MS}ms, batch size: ${BATCH_SIZE}, mailer: ${
      process.env.RESEND_API_KEY ? "Resend" : "Console (dev)"
    })`,
  );

  const service = new NotificationDispatchService(
    new PrismaNotificationRepository(),
    createMailer(),
    new TemplateEmailBuilder(),
  );

  let shuttingDown = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  function scheduleNextPoll(): void {
    if (shuttingDown) return;
    timer = setTimeout(() => {
      if (inFlight) {
        scheduleNextPoll();
        return;
      }
      inFlight = runOnce(service)
        .catch((error) => {
          log(`poll failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        })
        .finally(() => {
          inFlight = null;
        })
        .then(scheduleNextPoll);
    }, jitteredDelay(POLL_INTERVAL_MS));
  }

  scheduleNextPoll();

  inFlight = runOnce(service)
    .catch((error) => {
      log(`initial poll failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    })
    .finally(() => {
      inFlight = null;
    });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`received ${signal}, finishing in-flight batch and shutting down…`);
    if (timer) clearTimeout(timer);
    if (inFlight) {
      await inFlight;
    }
    await prisma.$disconnect();
    log("shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error) => {
  log(`fatal error during startup: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
