/**
 * Health check Route Handler — docs/ops observability (plan
 * `mvp-launch-readiness.md` T3). Public endpoint (must stay reachable
 * before `src/middleware.ts` auth-gating lands — see that plan's C7).
 *
 * Checks:
 * - DB: `SELECT 1` via `prisma.$queryRaw`. Any error => `db: "fail"`, whole
 *   response is `status: "down"`, HTTP 503.
 * - Worker liveness: `SELECT MAX(updated_at) FROM notifications` (raw SQL —
 *   same pattern as `prisma-notification-repository.ts:listQueued`, which
 *   is the only other place in the codebase dropping to `$queryRaw`). No
 *   notification rows ever => worker considered `"ok"` (nothing to be
 *   stale about yet). Most-recent `updated_at` older than 30s (3x the
 *   default 10s `NOTIFICATION_WORKER_POLL_INTERVAL_MS`) => `"stale"`.
 */

import { prisma } from "@/server/repositories/prisma-client";

const WORKER_STALE_THRESHOLD_MS = 30_000;

interface WorkerLivenessRow {
  latest: Date | null;
}

function sentryStatus(): "ok" | "disabled" {
  return process.env.SENTRY_DSN ? "ok" : "disabled";
}

export async function GET(): Promise<Response> {
  const timestamp = new Date().toISOString();
  const sentry = sentryStatus();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return Response.json(
      {
        status: "down",
        db: "fail",
        error: error instanceof Error ? error.message : String(error),
        sentry,
        timestamp,
      },
      { status: 503 },
    );
  }

  const rows = await prisma.$queryRaw<WorkerLivenessRow[]>`
    SELECT MAX(updated_at) as latest FROM notifications
  `;
  const latest = rows[0]?.latest ?? null;

  if (latest === null) {
    return Response.json(
      { status: "ok", db: "ok", worker: "ok", sentry, timestamp },
      { status: 200 },
    );
  }

  const ageMs = Date.now() - new Date(latest).getTime();
  if (ageMs < WORKER_STALE_THRESHOLD_MS) {
    return Response.json(
      { status: "ok", db: "ok", worker: "ok", sentry, timestamp },
      { status: 200 },
    );
  }

  return Response.json(
    {
      status: "degraded",
      db: "ok",
      worker: "stale",
      workerLastSeen: new Date(latest).toISOString(),
      sentry,
      timestamp,
    },
    { status: 200 },
  );
}
