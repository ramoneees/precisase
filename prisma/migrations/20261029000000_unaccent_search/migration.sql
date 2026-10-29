-- Manual follow-up migration (QA gap G-N): accent-insensitive post search.
--
-- The `search_vector` generated column (from 20260718181500_post_search_indexes)
-- tokenized the raw, accented haystack via `to_tsvector`, so a query like
-- "acao" never matched content "Ação". Wrapping the concatenated text in the
-- `posts_unaccent` wrapper (built on the `unaccent` extension) strips diacritics
-- before tokenizing; the query side is normalized in
-- `searchActivePostsViaFtsIndex` via `normalizeSearchText`.
--
-- `to_tsvector` requires a Postgres text-search configuration name
-- (`regconfig`), not an arbitrary locale string like "pt-PT" — so this reuses
-- the existing `posts_search_config(locale)` helper from the prior migration.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS unaccent;

-- CreateFunction — unaccent wrapper (IMMUTABLE/PARALLEL SAFE, required for
-- use inside a GENERATED ALWAYS AS column expression).
CREATE OR REPLACE FUNCTION posts_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT unaccent($1)
$fn$;

-- Replace the generated `search_vector` column with an unaccented one.
ALTER TABLE "posts" DROP COLUMN "search_vector";

ALTER TABLE "posts" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(posts_search_config(locale), posts_unaccent(coalesce(title, '') || ' ' || coalesce(description, '')))
  ) STORED;

-- CreateIndex — full-text search over the unaccented search_vector (FR07, G-N).
CREATE INDEX "posts_search_vector_idx" ON "posts" USING GIN ("search_vector");
