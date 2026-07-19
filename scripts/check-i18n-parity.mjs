#!/usr/bin/env node
// Checks that messages/pt-PT.json (canonical), messages/en.json, and
// messages/pt-BR.json all expose the exact same set of dot-notation
// translation keys. Values may differ (that's the point of translation) —
// only key *paths* must match across all three catalogs.
//
// Usage: node scripts/check-i18n-parity.mjs
// Exit 0: no drift. Exit 1: drift found (every diagnostic line is printed
// before exiting, not just the first).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.join(__dirname, "..", "messages");
const CANONICAL_LOCALE = "pt-PT";
const TARGET_LOCALES = ["en", "pt-BR"];

/**
 * Recursively collects dot-notation key paths from a nested object.
 * @param {Record<string, unknown>} obj
 * @param {string} prefix
 * @returns {Set<string>}
 */
function collectKeyPaths(obj, prefix = "") {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of collectKeyPaths(value, fullPath)) {
        keys.add(nested);
      }
    } else {
      keys.add(fullPath);
    }
  }
  return keys;
}

/**
 * Diffs a target catalog's key set against the canonical key set.
 * @param {Record<string, unknown>} canonical
 * @param {Record<string, unknown>} target
 * @returns {{ missing: string[], extra: string[] }}
 */
export function diffKeys(canonical, target) {
  const canonicalKeys = collectKeyPaths(canonical);
  const targetKeys = collectKeyPaths(target);

  const missing = [...canonicalKeys]
    .filter((key) => !targetKeys.has(key))
    .sort();
  const extra = [...targetKeys]
    .filter((key) => !canonicalKeys.has(key))
    .sort();

  return { missing, extra };
}

function loadCatalog(locale) {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function main() {
  const canonical = loadCatalog(CANONICAL_LOCALE);

  let hasDrift = false;

  for (const locale of TARGET_LOCALES) {
    const target = loadCatalog(locale);
    const { missing, extra } = diffKeys(canonical, target);

    for (const key of missing) {
      hasDrift = true;
      console.log(`+++ missing in ${locale}: ${key}`);
    }
    for (const key of extra) {
      hasDrift = true;
      console.log(`--- extra in ${locale}: ${key}`);
    }
  }

  process.exit(hasDrift ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
