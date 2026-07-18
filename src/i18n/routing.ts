import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // All locales supported by the platform. `pt-PT` is the default per
  // docs/ARCHITECTURE.md §10 (Casa da Cidade's primary community language).
  locales: ["pt-PT", "en", "pt-BR"],
  defaultLocale: "pt-PT",
});

export type AppLocale = (typeof routing.locales)[number];
