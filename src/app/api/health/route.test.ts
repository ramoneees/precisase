import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `prisma.$queryRaw` is mocked here (no live DB in unit tests, per
 * `src/server/repositories/AGENTS.md`). The route makes two `$queryRaw`
 * calls in sequence: `SELECT 1` (DB check), then
 * `SELECT MAX(updated_at) ...` (worker liveness) — the mock is configured
 * per-test via `mockImplementationOnce` chains to control each call.
 */
vi.mock("@/server/repositories/prisma-client", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/server/repositories/prisma-client";
import { GET } from "./route";

const queryRawMock = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/health", () => {
  const originalSentryDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    queryRawMock.mockReset();
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (originalSentryDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalSentryDsn;
    }
  });

  it("returns 200 healthy when db is ok and worker was recently active", async () => {
    queryRawMock
      .mockResolvedValueOnce([{ "?column?": 1 }]) // SELECT 1
      .mockResolvedValueOnce([{ latest: new Date() }]); // MAX(updated_at)

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      db: "ok",
      worker: "ok",
      sentry: "disabled",
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 200 degraded when worker's last activity is stale", async () => {
    const staleDate = new Date(Date.now() - 60_000); // 60s ago > 30s threshold
    queryRawMock
      .mockResolvedValueOnce([{ "?column?": 1 }])
      .mockResolvedValueOnce([{ latest: staleDate }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "degraded",
      db: "ok",
      worker: "stale",
      workerLastSeen: staleDate.toISOString(),
    });
  });

  it("returns 503 down when the DB check fails", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("connection refused"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "down",
      db: "fail",
      error: "connection refused",
    });
  });

  it("reports sentry as ok when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://example.test/dsn";
    queryRawMock
      .mockResolvedValueOnce([{ "?column?": 1 }])
      .mockResolvedValueOnce([{ latest: new Date() }]);

    const response = await GET();
    const body = await response.json();

    expect(body.sentry).toBe("ok");
  });
});
