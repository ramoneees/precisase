import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SigninForm } from "./signin-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signIn" });
  return { title: t("title") };
}

export default async function SigninPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { reset } = await searchParams;

  const t = await getTranslations({ locale, namespace: "auth.signIn" });

  return (
    <main className="mx-auto flex w-full flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-2xl border border-[#E3DED2] bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-center text-2xl font-extrabold text-[#232922]">
            {t("heading")}
          </h1>
          <p className="text-center text-sm text-[#6B7268]">{t("subtitle")}</p>
        </div>
        {reset === "success" ? (
          <p role="status" className="text-center text-sm text-[#2F6B4F]">
            {t("resetSuccess")}
          </p>
        ) : null}
        <SigninForm />
      </div>
    </main>
  );
}
