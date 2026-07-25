/**
 * Feature Flag Service — manages category activation/deactivation.
 *
 * Categories can be toggled on/off by admins. Inactive categories are hidden
 * from the shop window, post creation form, and filters. The platform requires
 * at least one active category at all times.
 */

export interface FeatureFlagRepository {
  listAll(): Promise<CategoryFlag[]>;
  setActive(slug: string, isActive: boolean): Promise<void>;
  withTransaction<T>(fn: (tx: this) => Promise<T>): Promise<T>;
}

export interface CategoryFlag {
  slug: string;
  key: string;
  isActive: boolean;
}

export class FeatureFlagService {
  constructor(private readonly repo: FeatureFlagRepository) {}

  async listCategories(): Promise<CategoryFlag[]> {
    return this.repo.listAll();
  }

  async toggleCategory(slug: string, isActive: boolean): Promise<ToggleResult> {
    return this.repo.withTransaction(async (tx) => {
      if (!isActive) {
        const all = await tx.listAll();
        const activeCount = all.filter((c) => c.isActive).length;
        if (activeCount <= 1) {
          return { ok: false as const, error: "atLeastOneCategoryMustBeActive" as const };
        }
      }
      await tx.setActive(slug, isActive);
      return { ok: true as const };
    });
  }
}

export type ToggleResult =
  | { ok: true }
  | { ok: false; error: "atLeastOneCategoryMustBeActive" };
