import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Nunito, Inter } from "next/font/google";
import { routing, type AppLocale } from "@/i18n/routing";
import { AppHeader } from "@/components/layout/app-header";
import { ToastProvider } from "@/components/ui/toast-provider";
import "../globals.css";

// Design spec: headings in Nunito 800, body in Inter 400/500/600/700
// (docs/ARCHITECTURE.md-adjacent UI build — see the shared AppHeader/toast
// components this layout wires up for every locale route).
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["800"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "listing" });

  return {
    title: t("title"),
    description: t("subtitle"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enables static rendering for this locale (next-intl RSC pattern).
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${nunito.variable} ${inter.variable} h-full antialiased`}
      // Some browser extensions (e.g. "One Sec") inject attributes onto
      // <html> before React hydrates, which otherwise trips a hydration
      // mismatch warning that has nothing to do with app code — see
      // https://react.dev/link/hydration-mismatch. Scoped to this one
      // element so real mismatches elsewhere in the tree still surface.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[#F7F4EE] text-[#232922]">
        <NextIntlClientProvider>
          <ToastProvider>
            <AppHeader locale={locale as AppLocale} />
            {children}
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
