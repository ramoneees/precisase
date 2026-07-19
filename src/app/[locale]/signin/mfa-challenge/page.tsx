import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { MfaChallengeForm } from "./mfa-challenge-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.mfa.challenge" });
  return { title: t("title") };
}

/**
 * Second step of the two-call MFA sign-in (T16). Reached only after the
 * first `/signin` call succeeded on password but the account has MFA
 * enabled. The flow is deliberately stateless (no signed cookie, no
 * server-side pending session), so this screen re-collects the password
 * alongside the 6-digit TOTP code — `authorize()` re-verifies both.
 *
 * A direct visit without `email` (nobody came through step 1) bounces back
 * to `/signin`.
 */
export default async function MfaChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; callbackUrl?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { email, callbackUrl } = await searchParams;

  if (!email) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  const t = await getTranslations({ locale, namespace: "auth.mfa.challenge" });

  return (
    <main className="mx-auto flex w-full flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-2xl border border-[#E3DED2] bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-center text-2xl font-extrabold text-[#232922]">
            {t("heading")}
          </h1>
          <p className="text-center text-sm text-[#6B7268]">{t("subtitle")}</p>
        </div>
        <MfaChallengeForm email={email} callbackUrl={callbackUrl ?? "/"} />
      </div>
    </main>
  );
}
