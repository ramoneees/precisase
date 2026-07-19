import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { MfaSetupForm } from "./mfa-setup-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.mfa.setup" });
  return { title: t("title") };
}

/**
 * MFA enrollment / disable page (T17). Auth-required — `proxy.ts` already
 * gates `/account/*`, but we re-check the session here (defense in depth)
 * to derive `mfaEnabledAt` for the initial render.
 *
 * `?force=1` (set by the moderator/admin RBAC gate in T18 during the
 * enforcement window) shows an explanatory banner.
 */
export default async function MfaSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ force?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { force } = await searchParams;

  const session = await auth();
  if (!session?.user?.id) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  const isEnabled = Boolean(session.user.mfaEnabledAt);
  const t = await getTranslations({ locale, namespace: "auth.mfa.setup" });

  return (
    <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("heading")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>

      {force === "1" ? (
        <p
          role="status"
          className="rounded-xl border border-[#E3C77A] bg-[#FBF3D9] px-4 py-3 text-sm text-[#7A5C10]"
        >
          {t("forcedBanner")}
        </p>
      ) : null}

      <MfaSetupForm isEnabled={isEnabled} />
    </main>
  );
}
