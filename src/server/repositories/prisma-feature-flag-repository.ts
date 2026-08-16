import type { Prisma } from "@/generated/prisma/client";
import type { FeatureFlagRepository, CategoryFlag } from "../services/feature-flag-service";
import { prisma } from "./prisma-client";

export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  async listAll(): Promise<CategoryFlag[]> {
    return prisma.category.findMany({
      select: { slug: true, key: true, isActive: true },
      orderBy: { slug: "asc" },
    });
  }

  async setActive(slug: string, isActive: boolean): Promise<void> {
    await prisma.category.update({
      where: { slug },
      data: { isActive },
    });
  }

  async withTransaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // Create a transactional repository that uses the transaction client
      const txRepo = new TransactionalFeatureFlagRepository(tx);
      return fn(txRepo as unknown as this);
    });
  }
}

// Internal transactional repository that uses the transaction client
class TransactionalFeatureFlagRepository {
  constructor(private tx: Prisma.TransactionClient) {}

  async listAll(): Promise<CategoryFlag[]> {
    return this.tx.category.findMany({
      select: { slug: true, key: true, isActive: true },
      orderBy: { slug: "asc" },
    });
  }

  async setActive(slug: string, isActive: boolean): Promise<void> {
    await this.tx.category.update({
      where: { slug },
      data: { isActive },
    });
  }

  async withTransaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
