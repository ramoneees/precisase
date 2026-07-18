-- Manual follow-up migration (prisma/schema.prisma comments on Post.search_vector
-- and the `@@index` note under model Post): Prisma's declarative schema cannot
-- express a Postgres GENERATED ALWAYS AS column or a pg_trgm operator class
-- index, so both are added here by hand, per docs/ARCHITECTURE.md §5.1
-- ("Indexes: (status, category_id, type) for the shop-window listing; GIN on
-- search_vector and on a pg_trgm index over (title, description) for keyword
-- search") and FR07 (keyword search).
--
-- `to_tsvector` requires a Postgres text-search configuration name
-- (`regconfig`), not an arbitrary locale string like "pt-PT" — so this maps
-- Post.locale to the closest built-in configuration via a small IMMUTABLE
-- helper function (required for use inside a generated column expression).

-- CreateFunction
CREATE OR REPLACE FUNCTION posts_search_config(locale text)
RETURNS regconfig
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN locale ILIKE 'pt%' THEN 'portuguese'::regconfig
    WHEN locale ILIKE 'en%' THEN 'english'::regconfig
    ELSE 'simple'::regconfig
  END;
$$;

-- Replace the plain nullable tsvector column (created by the initial
-- migration to satisfy Prisma's `Unsupported("tsvector")` mapping) with a
-- generated, always-in-sync column.
ALTER TABLE "posts" DROP COLUMN "search_vector";

ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(posts_search_config(locale), coalesce(title, '') || ' ' || coalesce(description, ''))
  ) STORED;

-- CreateIndex — full-text search over search_vector (FR07).
CREATE INDEX "posts_search_vector_idx" ON "posts" USING GIN ("search_vector");

-- CreateIndex — pg_trgm trigram indexes over (title, description) for
-- fuzzy/substring keyword search (FR07), complementing the tsvector index.
CREATE INDEX "posts_title_trgm_idx" ON "posts" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "posts_description_trgm_idx" ON "posts" USING GIN ("description" gin_trgm_ops);
