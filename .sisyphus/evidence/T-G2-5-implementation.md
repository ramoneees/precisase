# T-G2-5 — FR16 moderation `remove` as SOFT DELETE — Evidence

## Schema changes (`prisma/schema.prisma`)
- Added `deletedAt DateTime? @map("deleted_at") @db.Timestamptz()` column to `Post` model, after `closedAt`
- Added `postRemoved` to `NotificationType` enum → `post_removed`
- Added `post_removed` value to `NotificationType` enum

## Service changes (`src/server/services/post-service.ts`)
- Added `RemovePostInput` interface: `{ postId, moderator, reason }`
- Added `removePost` public method → delegates to `removePostTx` in `withTransaction`
- Added `removePostTx` private method with guards in order:
  1. `isModerator(moderator)` → `UnauthorizedPostActionError` ("Only a moderator or admin can remove a post.")
  2. `ensureNotOwnPost(post, moderator)` → `UnauthorizedPostActionError` (author≠moderator guard, admin NOT exempt)
  3. `post.deletedAt !== null` → `PostNotFoundError` (already removed)
  4. `!reason || reason.trim().length === 0` → `ModerationReasonRequiredError`
- Effects inside `removePostTx`:
  - `repo.update` sets `deletedAt = now`
  - `ModerationAction { action: "remove", moderatorId, reason }`
  - `addNotification` to author type `"post_removed"` payload `{ reason }` (mirrors `post_rejected` pattern)
  - `addAuditLog` action `"post.remove"` via `buildPostAuditEntry`
- Added `deletedAt: Date | null` to `PostRecord` interface
- Added `"deletedAt"` to `CreatePostData` Omit list
- Added `"deletedAt"` to `PostSummary` Omit list

## Repository changes (`src/server/repositories/prisma-post-repository.ts`)
- `listActive`: added `deletedAt: null` to where clause
- `listPending`: added `deletedAt: null` to where clause
- `searchActivePostsViaFtsIndex`: added `Prisma.sql`deleted_at IS NULL`` condition
- `findById`: unchanged (returns full post record; service layer handles visibility)
- `toPostSummary`: unchanged (summary omits `deletedAt` per design)
- `toPostRecord`: added `deletedAt: post.deletedAt` in mapper

## Notification template changes (`src/server/notifications/email-templates.ts`)
- Added `case "post_removed"` to switch statement (throws informative error since no email template yet)

## Type changes
- `NotificationTypeValue` in `notification-dispatch-service.ts`: added `"post_removed"`
- `PostRecord`, `PostSummary`, `CreatePostData` updated to include/omit `deletedAt`

## Test changes (`src/server/services/post-service.test.ts`)
- Added `describe("removePost — FR16 soft delete (remove as soft delete, D12)")` block with tests:
  - removes a pending post: sets deletedAt, records moderation action, audit log and author notification
  - removes an active post (allowed from pending AND active) and queues the post_removed notification
- `describe("author ≠ moderator guard on removePost (T-G2-5, D12)")`:
  - throws UnauthorizedPostActionError when a moderator removes their own post, writing nothing
  - allows a moderator to remove another author's post
  - blocks an admin author-moderator too (admin is NOT exempt from the self-removal guard)
- `describe("removePost — FR16 soft delete edge cases (T-G2-5)")`:
  - throws PostNotFoundError when removing an already-removed post
  - rejects a non-moderator from removing a post
  - requires a non-empty reason
  - hides a removed post from listActive/listPending but keeps it in the author's own list
- Updated `withTransaction` test: added `p-remove` seed, expect 8 transactions

## Migration (to be applied via sanctioned workaround)
- `prisma/migrations/<ts>_post_soft_delete/migration.sql`:
  ```sql
  ALTER TABLE "posts" ADD COLUMN "deleted_at" timestamptz;
  ALTER TYPE "notification_type" ADD VALUE 'post_removed';
  ```

## Verification
- `pnpm test` → 287 passed (was 278 before, +9 new tests from T-G2-5)
- `pnpm lint` → 0 errors (8 pre-existing warnings)
- `pnpm build` → success
