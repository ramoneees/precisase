-- Query-supporting indexes (code-review C3).
--
-- Each index below closes a specific seq-scan path called out in the
-- review. Names mirror what `prisma migrate diff` would have generated.

-- "My posts" view filters on authorId + orders by createdAt desc.
CREATE INDEX "posts_author_id_created_at_idx" ON "posts"("author_id", "created_at");

-- Account-deletion `deleteMany({ where: { userId } })`. The composite
-- unique constraint `(post_id, user_id)` does NOT cover this lookup.
CREATE INDEX "interests_user_id_idx" ON "interests"("user_id");

-- Account-deletion consent withdrawal `updateMany({ where: { userId, withdrawnAt: null } })`.
CREATE INDEX "consent_records_user_id_withdrawn_at_idx" ON "consent_records"("user_id", "withdrawn_at");

-- Worker poll: `findMany({ where: { status, channel }, orderBy: createdAt asc, take })`
-- runs every POLL_INTERVAL_MS (10s default) — this index turns a seq-scan
-- + sort into an index-only scan.
CREATE INDEX "notifications_status_channel_created_at_idx" ON "notifications"("status", "channel", "created_at");

-- Audit review queries filter by actorId over a 12-month retention window.
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
