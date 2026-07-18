/**
 * Prisma client singleton scoped to authentication (NextAuth credentials
 * provider + signup). Kept separate from any Prisma wiring the Post/
 * Interest/Category repositories use (src/server/repositories/) to avoid
 * touching code owned by that parallel workstream — this file only ever
 * queries the `User` and `ConsentRecord` models.
 *
 * Uses the driver-adapter setup required by the `prisma-client` generator
 * (prisma/schema.prisma `generator client` block): `PrismaPg` from
 * `@prisma/adapter-pg`, wrapping a `pg.Pool` built from `DATABASE_URL`.
 *
 * Cached on `globalThis` in development to avoid exhausting Postgres
 * connections across Next.js Fast Refresh module reloads.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __authPrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({
    connectionString: connectionString ?? "",
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalThis.__authPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__authPrismaClient = prisma;
}
