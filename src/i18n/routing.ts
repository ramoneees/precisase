import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // All locales supported by the platform. `pt-PT` is the default per
  // docs/ARCHITECTURE.md §10 (Casa da Cidade's primary community language).
  locales: ["pt-PT", "pt-BR", "en"],
  defaultLocale: "pt-PT",
  // The locale is stored in the `NEXT_LOCALE` cookie (set by the
  // middleware on first visit, then by `LanguageSwitcher` on user choice)
  // and never appears in the URL. URLs are locale-agnostic (`/posts/123`
  // everywhere); the `<LanguageSwitcher>` in the header is the only way
  // to change it. Deep links still work — next-intl's middleware falls
  // back to Accept-Language when no cookie is set.
  localePrefix: "never",
});

export type AppLocale = (typeof routing.locales)[number];
