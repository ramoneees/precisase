/**
 * Prisma-backed implementation of the `PostRepository` port
 * (src/server/services/post-service.ts). This is the only place that
 * touches `Post.contact_value` ciphertext (§7.4) — it encrypts on write and
 * decrypts on read via `src/server/crypto/contact-encryption.ts` so
 * `PostRecord.contactValue` is always plaintext at the service/domain
 * boundary.
 */

import { Prisma, type Post as PrismaPost } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/server/crypto/contact-encryption";
import type {
  AuditLogRecord,
  CreatePostData,
  ListActivePostsFilter,
  ModerationActionRecord,
  NotificationRecord,
  PostRecord,
  PostRepository,
} from "@/server/services/post-service";
import { prisma } from "./prisma-client";

/**
 * Maps a Prisma `Post` row to the plaintext `PostRecord` domain type —
 * decrypting `contactValue` is the one thing this function does that a
 * generic "select all columns" mapper wouldn't.
 */
async function toPostRecord(post: PrismaPost): Promise<PostRecord> {
  const contactValue = await decrypt(Buffer.from(post.contactValue));

  return {
    id: post.id,
    authorId: post.authorId,
    categoryId: post.categoryId,
    type: post.type,
    status: post.status,
    title: post.title,
    description: post.description,
    contactMethod: post.contactMethod,
    contactValue,
    locale: post.locale,
    extraAttributes: (post.extraAttributes as Record<string, unknown> | null) ?? {},
    publishedAt: post.publishedAt,
    closedAt: post.closedAt,
    rejectedReason: post.rejectedReason,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export class PrismaPostRepository implements PostRepository {
  async findById(id: string): Promise<PostRecord | null> {
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      return null;
    }
    return toPostRecord(post);
  }

  async update(id: string, data: Partial<PostRecord>): Promise<PostRecord> {
    // Built explicitly (not spread) — `Partial<PostRecord>` includes fields
    // like `id`/`authorId`/`createdAt` that aren't valid Prisma update
    // scalars, and an untyped spread collides with Prisma's discriminated
    // `PostUpdateInput | PostUncheckedUpdateInput` union.
    const {
      status,
      title,
      description,
      categoryId,
      type,
      contactMethod,
      contactValue,
      locale,
      extraAttributes,
      publishedAt,
      closedAt,
      rejectedReason,
    } = data;

    // Declared with an explicit type (rather than an inferred object
    // literal) so TypeScript resolves Prisma's
    // `PostUpdateInput | PostUncheckedUpdateInput` discriminated union to
    // the "unchecked" (scalar FK) branch up front, instead of trying to
    // structurally match a partially-optional literal against both.
    const updateData: Prisma.PostUncheckedUpdateInput = {
      ...(status !== undefined ? { status } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(contactMethod !== undefined ? { contactMethod } : {}),
      ...(contactValue !== undefined
        ? {
            // Buffer's `ArrayBufferLike` backing (which admits
            // SharedArrayBuffer) doesn't structurally satisfy Prisma's
            // `Uint8Array<ArrayBuffer>` field type under strict TS — the
            // bytes are identical, this is a type-only mismatch.
            contactValue: new Uint8Array(await encrypt(contactValue)),
          }
        : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...(extraAttributes !== undefined
        ? { extraAttributes: extraAttributes as Prisma.InputJsonValue }
        : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
      ...(closedAt !== undefined ? { closedAt } : {}),
      ...(rejectedReason !== undefined ? { rejectedReason } : {}),
    };

    const updated = await prisma.post.update({
      where: { id },
      data: updateData,
    });

    return toPostRecord(updated);
  }

  async create(data: CreatePostData): Promise<PostRecord> {
    const created = await prisma.post.create({
      data: {
        authorId: data.authorId,
        categoryId: data.categoryId,
        type: data.type,
        title: data.title,
        description: data.description,
        contactMethod: data.contactMethod,
        contactValue: new Uint8Array(await encrypt(data.contactValue)),
        locale: data.locale,
        extraAttributes: (data.extraAttributes ?? {}) as Prisma.InputJsonValue,
        // `status` is intentionally omitted — the schema default
        // (`pending`) applies, per BR01 / FR01: every new post starts
        // pending regardless of what a caller supplies.
      },
    });

    return toPostRecord(created);
  }

  async listActive(filter: ListActivePostsFilter): Promise<PostRecord[]> {
    const search = filter.search?.trim();

    const posts = await prisma.post.findMany({
      where: {
        status: "active",
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        // Simple ILIKE fallback for keyword search (FR07). A GIN index on
        // the generated `search_vector` column and a pg_trgm trigram index
        // over (title, description) are created via raw SQL in the
        // migration (see prisma/migrations/*_search_indexes/migration.sql)
        // for production-grade full-text/fuzzy search; this ILIKE filter
        // keeps the repository usable without depending on Prisma support
        // for `Unsupported("tsvector")` filtering, which does not exist.
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(posts.map(toPostRecord));
  }

  async listByAuthor(authorId: string): Promise<PostRecord[]> {
    const posts = await prisma.post.findMany({
      where: { authorId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(posts.map(toPostRecord));
  }

  async listPending(): Promise<PostRecord[]> {
    const posts = await prisma.post.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(posts.map(toPostRecord));
  }

  async addModerationAction(action: ModerationActionRecord): Promise<void> {
    await prisma.moderationAction.create({
      data: {
        postId: action.postId,
        moderatorId: action.moderatorId,
        action: action.action,
        reason: action.reason ?? null,
      },
    });
  }

  async addNotification(notification: NotificationRecord): Promise<void> {
    await prisma.notification.create({
      data: {
        recipientId: notification.recipientId,
        postId: notification.postId ?? null,
        type: notification.type,
        channel: notification.channel,
        payload: notification.payload as Prisma.InputJsonValue,
      },
    });
  }

  async addAuditLog(log: AuditLogRecord): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actorId: log.actorId ?? null,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId ?? null,
        before: log.before === undefined ? undefined : (log.before ?? undefined),
        after: log.after === undefined ? undefined : (log.after ?? undefined),
      },
    });
  }
}
