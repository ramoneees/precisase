-- Fix-forward migration.
--
-- `prisma migrate dev` cannot see the real definition of `posts.search_vector`
-- (a hand-written `GENERATED ALWAYS AS (...) STORED` column — see
-- prisma/migrations/20260718181500_post_search_indexes/migration.sql; the
-- Prisma schema only models it as `Unsupported("tsvector")`), so its
-- auto-generated diff for this migration proposed an invalid
-- `ALTER TABLE "posts" ALTER COLUMN "search_vector" DROP DEFAULT` (Postgres
-- rejects `DROP DEFAULT` on a generated column, error 42601) preceded by
-- `DROP INDEX` statements for the three indexes built on/around that column.
-- Postgres executed those `DROP INDEX` statements before erroring on the
-- invalid `ALTER COLUMN`, so this fix-forward migration recreates them
-- (identical definitions to the original migration) and then makes the one
-- actual intended change.

-- CreateIndex — full-text search over search_vector (FR07), recreated
-- exactly as originally defined.
CREATE INDEX "posts_search_vector_idx" ON "posts" USING GIN ("search_vector");

-- CreateIndex — pg_trgm trigram indexes over (title, description) (FR07),
-- recreated exactly as originally defined.
CREATE INDEX "posts_title_trgm_idx" ON "posts" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "posts_description_trgm_idx" ON "posts" USING GIN ("description" gin_trgm_ops);

-- AlterTable — FR13 ("Name, contact info, optional community/church
-- affiliation"): add the optional church-affiliation field to User.
ALTER TABLE "users" ADD COLUMN "church_affiliation" TEXT;
