/**
 * Category lookup — `Category` is a tiny (2-row for the MVP: volunteering,
 * donation) lookup table (docs/ARCHITECTURE.md §5.1), so a dedicated
 * service/repository is overkill. `React.cache` gives request-level
 * de-duplication (multiple Server Components on the same page can call this
 * without issuing duplicate queries) without the staleness risk of a
 * module-level cache surviving across requests/instances.
 */

import { cache } from "react";
import { prisma } from "@/server/repositories/prisma-client";

export interface CategoryLite {
  id: string;
  slug: string;
  key: string;
  isActive: boolean;
}

export const listCategories = cache(async (): Promise<CategoryLite[]> => {
  return prisma.category.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, key: true, isActive: true },
    orderBy: { slug: "asc" },
  });
});

export const listAllCategories = cache(async (): Promise<CategoryLite[]> => {
  return prisma.category.findMany({
    select: { id: true, slug: true, key: true, isActive: true },
    orderBy: { slug: "asc" },
  });
});

export async function findCategoryBySlug(slug: string): Promise<CategoryLite | null> {
  const categories = await listAllCategories();
  return categories.find((category) => category.slug === slug) ?? null;
}

export async function findCategoryById(id: string): Promise<CategoryLite | null> {
  const categories = await listAllCategories();
  return categories.find((category) => category.id === id) ?? null;
}
