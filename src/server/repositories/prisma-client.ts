/**
 * Prisma client singleton scoped to the Post/Interest/Category repositories
 * (this directory). Kept separate from `src/server/auth/prisma-client.ts`
 * (owned by the parallel Auth.js workstream) so the two workstreams never
 * touch each other's files — both simply instantiate their own client
 * against the same underlying Postgres database.
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
  var __postsPrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({
    connectionString: connectionString ?? "",
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalThis.__postsPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__postsPrismaClient = prisma;
}
