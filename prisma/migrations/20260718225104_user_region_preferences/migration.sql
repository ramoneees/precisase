-- Phase F (i18n-beyond-language plan, .omo/plans/2026-07-18-i18n-beyond-language.md).
--
-- Decomposes the single `User.locale` field into four orthogonal
-- preferences:
--   ui_locale         text  — UI translation catalog (was `locale`)
--   country           char(2) — ISO 3166-1 alpha-2 (PT, BR, US, …)
--   time_zone         text  — IANA zone (Europe/Lisbon, …)
--   currency          char(3) — ISO 4217 alpha-3 (EUR, BRL, USD, …)
--   measurement_system text — 'metric' | 'us'
--
-- The `locale → region` defaults mirror what ICU/JDK use when no region
-- subtag is present: pt-PT → PT/Europe/Lisbon/EUR; pt-BR →
-- BR/America/Sao_Paulo/BRL; en (no region) → null/null/null/null, since
-- "en" doesn't carry region information and best-effort guessing
-- (e.g. assuming US) would mislabel UK/India/Australia users.

-- Rename column (Prisma maps `uiLocale` field ↔ `ui_locale` column).
ALTER TABLE "users" RENAME COLUMN "locale" TO "ui_locale";

-- Add new nullable columns.
ALTER TABLE "users" ADD COLUMN "country" CHAR(2);
ALTER TABLE "users" ADD COLUMN "time_zone" TEXT;
ALTER TABLE "users" ADD COLUMN "currency" CHAR(3);
ALTER TABLE "users" ADD COLUMN "measurement_system" TEXT;

-- Backfill defaults from the existing ui_locale region subtag.
UPDATE users SET
  country = 'PT',
  time_zone = 'Europe/Lisbon',
  currency = 'EUR',
  measurement_system = 'metric'
WHERE ui_locale = 'pt-PT'
  AND country IS NULL;

UPDATE users SET
  country = 'BR',
  time_zone = 'America/Sao_Paulo',
  currency = 'BRL',
  measurement_system = 'metric'
WHERE ui_locale = 'pt-BR'
  AND country IS NULL;

-- `en` (no region subtag) intentionally NOT backfilled — region is unknown.
-- New signups will derive country/timeZone/currency from the browser.
