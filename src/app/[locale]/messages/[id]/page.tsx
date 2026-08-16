import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect, Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { conversationService, messageService } from "@/server/service-instances";
import { ConversationNotFoundError } from "@/server/services/conversation-service";
import { prisma } from "@/server/repositories/prisma-client";
import { ChatView } from "./chat-view";
import { toMessageItem } from "./view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "chat.inbox" });
  return { title: t("title") };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  let conversation;
  try {
    conversation = await conversationService.getByIdForUser(id, userId);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      notFound();
    }
    throw error;
  }

  const otherParticipantId =
    conversation.participantAId === userId
      ? conversation.participantBId
      : conversation.participantAId;

  // Read-only display projections (author/post lookups are the sanctioned
  // exception to the service layer — see AGENTS.md anti-patterns).
  const [otherParticipant, post, messages] = await Promise.all([
    prisma.user.findUnique({
      where: { id: otherParticipantId },
      select: { displayName: true },
    }),
    prisma.post.findUnique({
      where: { id: conversation.postId },
      select: { title: true },
    }),
    messageService.listMessages(id, 50),
  ]);

  const t = await getTranslations({ locale, namespace: "chat.conversation" });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <Link href="/messages" className="w-fit text-sm font-medium text-[#6B7268] hover:text-[#2F6B4F]">
        {t("backLink")}
      </Link>
      <ChatView
        conversationId={id}
        locale={locale}
        currentUserId={userId}
        otherParticipantName={otherParticipant?.displayName ?? ""}
        postTitle={post?.title ?? ""}
        initialMessages={messages.map((m) => toMessageItem(m, locale))}
        initialArchived={conversation.archived}
      />
    </main>
  );
}
