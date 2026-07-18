"use client";

import { useTranslations } from "next-intl";
import { colors } from "@/lib/design-tokens";
import type { PostStatusValue, PostTypeValue } from "@/server/services/post-service";

/**
 * Small presentational badges shared by the listing card, the detail page,
 * and (per the shared-layout brief) reusable by the moderation queue built
 * on top of this. Colors come from `src/lib/design-tokens.ts` (the design
 * spec's fixed status/type palette) rather than Tailwind's default palette.
 */

export function TypeBadge({ type }: { type: PostTypeValue }) {
  const t = useTranslations("post");
  const { fg, bg } = colors.type[type];
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: fg, backgroundColor: bg }}
    >
      {t(`type.${type}`)}
    </span>
  );
}

export function StatusBadge({ status }: { status: PostStatusValue }) {
  const t = useTranslations("post");
  const { fg, bg } = colors.status[status];
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ color: fg, backgroundColor: bg }}
    >
      {t(`status.${status}`)}
    </span>
  );
}

/**
 * `categoryKey` is `Category.key` as stored in the DB, e.g.
 * `"category.volunteering"` — resolved through the root translator via
 * next-intl's dot-path key lookup (matches `messages/{locale}.json`'s
 * `category.*` namespace).
 */
export function CategoryBadge({ categoryKey }: { categoryKey: string }) {
  const t = useTranslations();
  return (
    <span className="rounded-full border border-[#E3DED2] px-3 py-1 text-xs font-medium whitespace-nowrap text-[#6B7268]">
      {t(categoryKey)}
    </span>
  );
}
