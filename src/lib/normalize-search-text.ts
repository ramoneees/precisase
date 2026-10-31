/**
 * Normalizes user search text for accent-insensitive matching (QA gap G-N).
 *
 * Strips diacritics via NFD decomposition + combining-mark removal, then
 * lowercases — so "Ação" and "acao" both normalize to "acao" before the query
 * reaches the Postgres `unaccent` full-text index.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
