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
  PaginatedPosts,
  PostRecord,
  PostRepository,
  PostSummary,
} from "@/server/services/post-service";
import { DEFAULT_LISTING_PAGE_SIZE } from "@/server/services/post-service";
import { prisma } from "./prisma-client";

/**
 * Columns the listing queries (`listActive`/`listByAuthor`/`listPending`)
 * actually read. Critically **omits `contact_value`** so the listing path
 * never has the encrypted bytes in memory and therefore can never decrypt
 * them — closing the PII-over-exposure path flagged in code review C1.
 */
const POST_SUMMARY_SELECT = {
  id: true,
  authorId: true,
  categoryId: true,
  type: true,
  status: true,
  title: true,
  description: true,
  locale: true,
  extraAttributes: true,
  publishedAt: true,
  closedAt: true,
  rejectedReason: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.PostSelect;

type PrismaPostSummary = Prisma.PostGetPayload<{ select: typeof POST_SUMMARY_SELECT }>;

function toPostSummary(post: PrismaPostSummary): PostSummary {
  return {
    id: post.id,
    authorId: post.authorId,
    categoryId: post.categoryId,
    type: post.type,
    status: post.status,
    title: post.title,
    description: post.description,
    locale: post.locale,
    extraAttributes: (post.extraAttributes as Record<string, unknown> | null) ?? {},
    publishedAt: post.publishedAt,
    closedAt: post.closedAt,
    rejectedReason: post.rejectedReason,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

interface RawPostSummaryRow {
  id: string;
  authorId: string;
  categoryId: string;
  type: PostSummary["type"];
  status: PostSummary["status"];
  title: string;
  description: string;
  locale: string;
  extraAttributes: Record<string, unknown> | null;
  publishedAt: Date | null;
  closedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPostSummaryFromRaw(row: RawPostSummaryRow): PostSummary {
  return {
    id: row.id,
    authorId: row.authorId,
    categoryId: row.categoryId,
    type: row.type,
    status: row.status,
    title: row.title,
    description: row.description,
    locale: row.locale,
    extraAttributes: row.extraAttributes ?? {},
    publishedAt: row.publishedAt,
    closedAt: row.closedAt,
    rejectedReason: row.rejectedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Splits a fetched-`limit+1` row list into the page (`items`) plus a
 * `nextCursor` pointing at the next page's start (the (limit+1)th row's
 * id). Returns `nextCursor: null` when fewer than `limit+1` rows were
 * returned, signaling end-of-list to the caller.
 */
function paginate(rows: PostSummary[], limit: number): PaginatedPosts {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }
  const page = rows.slice(0, limit);
  return { items: page, nextCursor: page[page.length - 1]!.id };
}

/**
 * Resolves a cursor post id to its `createdAt` so the next page can be
 * fetched with `WHERE createdAt < cursorCreatedAt` + a tie-breaker on id.
 * Returns null if the cursor post has been deleted between page fetches,
 * which makes the next-page query return the first page (safe degradation
 * — the user just sees page 1 again).
 */
async function cursorCreatedAt(postId: string): Promise<Date | null> {
  const row = await prisma.post.findUnique({
    where: { id: postId },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/**
 * Shop-window keyword search via the `search_vector` GIN index (created
 * by `20260718181500_post_search_indexes`). Raw SQL because Prisma's
 * `where` API cannot express `tsvector @@ plainto_tsquery` over an
 * `Unsupported("tsvector")` column — replacing this with `ILIKE` would
 * silently regress to a seq scan.
 */
async function searchActivePostsViaFtsIndex(
  filter: ListActivePostsFilter,
  search: string,
  limit: number,
  cursorDate: Date | null,
): Promise<PostSummary[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`status = 'active'::post_status`,
    Prisma.sql`search_vector @@ plainto_tsquery(posts_search_config(locale), ${search})`,
  ];
  if (filter.categoryId) {
    conditions.push(Prisma.sql`category_id = ${filter.categoryId}::uuid`);
  }
  if (filter.type) {
    conditions.push(Prisma.sql`type = ${filter.type}::post_type`);
  }
  if (cursorDate) {
    conditions.push(Prisma.sql`created_at < ${cursorDate}`);
  }

  const rows = await prisma.$queryRaw<RawPostSummaryRow[]>`
    SELECT
      id,
      author_id   AS "authorId",
      category_id AS "categoryId",
      type,
      status,
      title,
      description,
      locale,
      extra_attributes AS "extraAttributes",
      published_at  AS "publishedAt",
      closed_at     AS "closedAt",
      rejected_reason AS "rejectedReason",
      created_at    AS "createdAt",
      updated_at    AS "updatedAt"
    FROM posts
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `;

  return rows.map(toPostSummaryFromRaw);
}

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

  async listActive(filter: ListActivePostsFilter): Promise<PaginatedPosts> {
    const search = filter.search?.trim();
    const limit = Math.max(1, Math.min(filter.limit ?? DEFAULT_LISTING_PAGE_SIZE, 100));
    const cursorDate = filter.after ? await cursorCreatedAt(filter.after) : null;

    if (!search) {
      const rows = await prisma.post.findMany({
        where: {
          status: "active",
          ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
          ...(filter.type ? { type: filter.type } : {}),
          ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: POST_SUMMARY_SELECT,
      });

      return paginate(rows.map(toPostSummary), limit);
    }

    const searchRows = await searchActivePostsViaFtsIndex(filter, search, limit, cursorDate);
    return paginate(searchRows, limit);
  }

  async listByAuthor(authorId: string): Promise<PostSummary[]> {
    const posts = await prisma.post.findMany({
      where: { authorId },
      orderBy: { createdAt: "desc" },
      select: POST_SUMMARY_SELECT,
    });

    return posts.map(toPostSummary);
  }

  async listPending(): Promise<PostSummary[]> {
    const posts = await prisma.post.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      select: POST_SUMMARY_SELECT,
    });

    return posts.map(toPostSummary);
  }

  async listInterestedUserIds(postId: string): Promise<string[]> {
    const rows = await prisma.interest.findMany({
      where: { postId },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.map((row) => row.userId);
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
