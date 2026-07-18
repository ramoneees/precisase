import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return { title: t("title") };
}

const SECTION_KEYS = [
  "whatWeCollect",
  "why",
  "protection",
  "sharing",
  "retention",
  "deletion",
  "contact",
] as const;

/**
 * Privacy policy — static content page (NFR08, docs/ARCHITECTURE.md §7.5).
 * Linked from the signup consent checkbox and from the account-deletion
 * "danger zone" (src/app/[locale]/profile/delete-account-section.tsx).
 *
 * Content note: `privacy.legalNotice` (rendered below) flags this text as a
 * first draft pending real legal review — see the account-settings build
 * report for the full caveat.
 */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "privacy" });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("heading")}
        </h1>
        <p className="text-xs text-[#9AA098]">{t("updatedAt")}</p>
      </div>

      <p
        role="note"
        className="rounded-xl border border-[#E3DED2] bg-[#FBF0DD] px-4 py-3 text-sm text-[#8A6D23]"
      >
        {t("legalNotice")}
      </p>

      <p className="text-sm leading-relaxed text-[#232922]">{t("intro")}</p>

      <div className="flex flex-col gap-6 rounded-2xl border border-[#E3DED2] bg-white p-6">
        {SECTION_KEYS.map((key) => (
          <section key={key} className="flex flex-col gap-1.5">
            <h2 className="font-heading text-base font-extrabold text-[#232922]">
              {t(`sections.${key}.heading`)}
            </h2>
            <p className="text-sm leading-relaxed text-[#6B7268]">
              {t(`sections.${key}.body`)}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
