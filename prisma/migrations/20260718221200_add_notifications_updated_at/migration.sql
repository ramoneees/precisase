-- Per-row retry backoff for the notification worker (code review H2).
--
-- The worker's `listQueued` filters on `updated_at < now() - backoff(...)`
-- to avoid re-picking the same failing row every poll. Without this
-- column the only signal available was `created_at`, which never updates
-- and so cannot express "this row last failed N seconds ago".

ALTER TABLE "notifications" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows: their "last update" is effectively now(), so
-- the worker treats them as freshly-queued on the next poll.
UPDATE "notifications" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
