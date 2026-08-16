-- AlterTable
-- New notification type for internal chat (D2): queued for the recipient on
-- the first unread message only. Note: ADD VALUE cannot run inside a
-- transaction block, so this migration must be applied without a wrapping
-- transaction (the prisma db execute workaround for the shadow-DB replay bug
-- documented in the root AGENTS.md does exactly that).
ALTER TYPE "notification_type" ADD VALUE 'chat_message_received';
