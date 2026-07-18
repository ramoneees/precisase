/**
 * Category seed — docs/MVP.md §2 ("MVP scope: Volunteering + Donations")
 * and ARCHITECTURE.md §5.1 (`Category` is a lookup table, not an enum, so
 * future phases add `jobs` without a migration of every Post).
 *
 * Idempotent: upserts by `slug` so `prisma db seed` is safe to re-run
 * against an already-seeded database (e.g. in CI or on redeploy).
 *
 * Run via `prisma db seed` (wired in prisma.config.ts `migrations.seed`).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const CATEGORIES = [
  { slug: "volunteering", key: "category.volunteering" },
  { slug: "donation", key: "category.donation" },
] as const;

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? "",
  });
  const prisma = new PrismaClient({ adapter });

  try {
    for (const category of CATEGORIES) {
      const result = await prisma.category.upsert({
        where: { slug: category.slug },
        update: { key: category.key },
        create: { slug: category.slug, key: category.key },
      });
      console.log(`[seed] category "${result.slug}" (${result.id}) ready`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exitCode = 1;
});
