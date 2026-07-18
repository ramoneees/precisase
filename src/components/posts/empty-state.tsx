"use client";

import { useTranslations } from "next-intl";

/** Shown in the listing grid when a search/filter combination matches nothing. */
export function EmptyState() {
  const t = useTranslations("listing.empty");

  return (
    <div className="col-span-full flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E3DED2] bg-white px-6 py-16 text-center">
      <p className="font-heading text-lg font-extrabold text-[#232922]">
        {t("title")}
      </p>
      <p className="text-sm text-[#6B7268]">{t("description")}</p>
    </div>
  );
}
