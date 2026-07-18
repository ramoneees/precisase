"use client";

import { useRouter, usePathname } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { routing, type AppLocale } from "@/i18n/routing";
import { useTranslations } from "next-intl";

/**
 * Language picker in the header — the *only* way the UI locale changes
 * (URL doesn't carry it; see `src/i18n/routing.ts` `localePrefix: 'never'`).
 *
 * On change, calls `router.replace(pathname, { locale })` which sets the
 * `NEXT_LOCALE` cookie via next-intl's middleware and refreshes the
 * current page in the new language. The URL itself does NOT change (the
 * middleware would have stripped any prefix anyway).
 */

export function LanguageSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("nav");

  return (
    <label className={`flex items-center gap-1.5 text-sm text-[#232922] ${className ?? ""}`}>
      <span className="sr-only">{t("languageLabel")}</span>
      <select
        aria-label={t("languageLabel")}
        value={locale}
        onChange={(event) => {
          const nextLocale = event.target.value as AppLocale;
          router.replace(pathname, { locale: nextLocale });
        }}
        className="rounded-md border border-[#E3DED2] bg-white px-2 py-1 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {t(`languageOptions.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}