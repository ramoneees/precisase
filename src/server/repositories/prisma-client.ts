/**
 * Prisma client singleton shared by every server-side consumer: the
 * Post/Interest/Notification/AccountDeletion repositories, the auth
 * repository (`src/server/auth/user-repository.ts`), and the App Router
 * pages that read directly off the Prisma client (home / my-posts /
 * moderation / post detail).
 *
 * Uses the driver-adapter setup required by the `prisma-client` generator
 * (prisma/schema.prisma `generator client` block): `PrismaPg` from
 * `@prisma/adapter-pg`, wrapping a `pg.Pool` built from `DATABASE_URL`.
 *
 * Cached on `globalThis` in development to avoid exhausting Postgres
 * connections across Next.js Fast Refresh module reloads.
 *
 * Historical note: this file used to have a sibling at
 * `src/server/auth/prisma-client.ts` (a byte-identical duplicate cached
 * under a different `globalThis` key, justified by a "parallel
 * workstream" comment that no longer applied after merge). Both pools
 * were independent — i.e. N replicas × 2 pools × M connections each,
 * which silently multiplied Postgres `max_connections` usage. All
 * consumers now import from here.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __precisasePrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({
    connectionString: connectionString ?? "",
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient =
  globalThis.__precisasePrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__precisasePrismaClient = prisma;
}
