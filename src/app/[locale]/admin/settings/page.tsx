import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { setRequestLocale } from "next-intl/server";
import { featureFlagService, brandingService } from "@/server/service-instances";
import { CategoryToggle } from "./category-toggle";
import { BrandingForm } from "./branding-form";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  return { title: t("title") };
}

export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const tCategory = await getTranslations({ locale, namespace: "category" });
  const categories = await featureFlagService.listCategories();
  const branding = await brandingService.getConfig();

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("title")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-[#232922]">{t("categories")}</h2>
        {categories.map((category) => (
          <CategoryToggle
            key={category.slug}
            slug={category.slug}
            label={tCategory(category.slug)}
            isActive={category.isActive}
          />
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-4">{t("branding")}</h2>
        <BrandingForm initial={branding} />
      </section>
    </main>
  );
}
