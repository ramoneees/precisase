import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { prisma } from "@/server/repositories/prisma-client";
import { ProfileForm } from "./profile-form";
import { DeleteAccountSection } from "./delete-account-section";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "profile" });
  return { title: t("heading") };
}

/**
 * Account settings page (FR13 — profile; NFR08 — self-service GDPR/LGPD
 * deletion). Requires a session, same redirect-to-signin pattern as
 * `my-posts/page.tsx`. Reads the full `User` row directly via the shared
 * `prisma` client (src/server/repositories/prisma-client.ts) — a read-only
 * display concern, same convention as `my-posts/page.tsx`'s interest-count
 * query, so it doesn't need to go through a strict repository port.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  const t = await getTranslations({ locale, namespace: "profile" });

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("heading")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>

      <ProfileForm
        locale={locale}
profile={{
          email: user.email,
          displayName: user.displayName,
          phoneE164: user.phoneE164,
          phoneCountry: user.country,
          churchAffiliation: user.churchAffiliation,
          role: user.role,
          uiLocale: user.uiLocale,
        }}
      />

      <DeleteAccountSection />
    </main>
  );
}
