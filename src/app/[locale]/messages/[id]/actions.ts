"use server";

/**
 * Chat-view Server Actions (D3 — polling). `sendMessageAction` both
 * validates access (participant check via ConversationService) and maps
 * MessageService's typed errors onto i18n-able codes;
 * `fetchMessagesAction` powers the 5s poll; `markAsReadAction` clears
 * the unread badge for this conversation.
 */

import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/server/auth/auth-context";
import { conversationService, messageService } from "@/server/service-instances";
import {
  ConversationArchivedError,
  ConversationNotFoundError,
} from "@/server/services/conversation-service";
import {
  EmptyMessageError,
  MessageTooLongError,
} from "@/server/services/message-service";
import { routing } from "@/i18n/routing";
import { prisma } from "@/server/repositories/prisma-client";
import { toMessageItem, type MessageItem } from "./view";

export type ChatErrorCode =
  | "unauthenticated"
  | "notFound"
  | "empty"
  | "tooLong"
  | "archived"
  | "generic";

export async function sendMessageAction(
  conversationId: string,
  content: string,
  locale: string,
): Promise<{ ok: true } | { ok: false; error: ChatErrorCode }> {
  const authContext = await getAuthContext();
  if (authContext.kind === "anon") {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    const conversation = await conversationService.getByIdForUser(
      conversationId,
      authContext.user.id,
    );
    const recipientId =
      conversation.participantAId === authContext.user.id
        ? conversation.participantBId
        : conversation.participantAId;

    const post = await prisma.post.findUnique({
      where: { id: conversation.postId },
      select: { title: true },
    });

    await messageService.sendMessage({
      conversationId,
      senderId: authContext.user.id,
      content,
      senderName: authContext.user.displayName,
      recipientId,
      postTitle: post?.title ?? "",
    });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    if (error instanceof ConversationArchivedError) {
      return { ok: false, error: "archived" };
    }
    if (error instanceof EmptyMessageError) {
      return { ok: false, error: "empty" };
    }
    if (error instanceof MessageTooLongError) {
      return { ok: false, error: "tooLong" };
    }
    return { ok: false, error: "generic" };
  }

  const resolvedLocale = (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/messages`);

  return { ok: true };
}

export async function fetchMessagesAction(
  conversationId: string,
  locale: string,
  before?: string,
): Promise<
  { ok: true; messages: MessageItem[]; archived: boolean } | { ok: false; error: ChatErrorCode }
> {
  const authContext = await getAuthContext();
  if (authContext.kind === "anon") {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    const conversation = await conversationService.getByIdForUser(
      conversationId,
      authContext.user.id,
    );
    const messages = await messageService.listMessages(
      conversationId,
      50,
      before ? new Date(before) : undefined,
    );
    return {
      ok: true,
      messages: messages.map((m) => toMessageItem(m, locale)),
      archived: conversation.archived,
    };
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    return { ok: false, error: "generic" };
  }
}

export async function markAsReadAction(
  conversationId: string,
): Promise<{ ok: true } | { ok: false; error: ChatErrorCode }> {
  const authContext = await getAuthContext();
  if (authContext.kind === "anon") {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    await conversationService.getByIdForUser(conversationId, authContext.user.id);
    await messageService.markAsRead(conversationId, authContext.user.id);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return { ok: false, error: "notFound" };
    }
    return { ok: false, error: "generic" };
  }

  return { ok: true };
}
