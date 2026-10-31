-- FR16 soft delete (D12): a moderator's removal sets posts.deleted_at; the
-- post becomes invisible to the public but stays visible to its author
-- (my-posts view). New notification type queued for the author with the
-- removal reason.
--
-- Note: ALTER TYPE ... ADD VALUE runs inside the migration transaction —
-- valid on PostgreSQL 12+ (target is PG 16) as long as the new value is
-- not used in the same transaction. Precedent:
-- 20260816000002_add_chat_notification_type (AGENTS.md NOTES covers the
-- separate shadow-DB replay bug, which affects `migrate dev` only).

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'post_removed';

-- AlterTable
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE;
