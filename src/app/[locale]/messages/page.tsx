import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { conversationService } from "@/server/service-instances";
import { ConversationList } from "./conversation-list";
import { toListItem } from "./view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "chat.inbox" });
  return { title: t("title") };
}

export default async function MessagesPage({
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

  const summaries = await conversationService.listForUser(userId);
  const items = summaries.map((s) => toListItem(s, locale));

  const t = await getTranslations({ locale, namespace: "chat.inbox" });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("title")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>
      <ConversationList initialItems={items} locale={locale} />
    </main>
  );
}
