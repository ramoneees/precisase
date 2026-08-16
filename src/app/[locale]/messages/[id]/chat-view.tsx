"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  fetchMessagesAction,
  markAsReadAction,
  sendMessageAction,
  type ChatErrorCode,
} from "./actions";
import type { MessageItem } from "./view";

const POLL_INTERVAL_MS = 5_000;

async function markRead(conversationId: string) {
  await markAsReadAction(conversationId);
}

/**
 * Chat view (D3 — 5s polling, no SSE/websocket). The server stays the
 * single source of truth: sending, polling, and history-loading all go
 * through Server Actions that re-check participant access; this
 * component only mirrors what they return.
 */
export function ChatView({
  conversationId,
  locale,
  currentUserId,
  otherParticipantName,
  postTitle,
  initialMessages,
  initialArchived,
}: {
  conversationId: string;
  locale: string;
  currentUserId: string;
  otherParticipantName: string;
  postTitle: string;
  initialMessages: MessageItem[];
  initialArchived: boolean;
}) {
  const t = useTranslations("chat.conversation");
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [archived, setArchived] = useState(initialArchived);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorCode, setErrorCode] = useState<ChatErrorCode | null>(null);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 50);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    void markRead(conversationId);
    const interval = setInterval(async () => {
      const result = await fetchMessagesAction(conversationId, locale);
      if (!result.ok) {
        return;
      }
      setMessages((previous) => {
        const incoming = result.messages.filter((m) => !seenIdsRef.current.has(m.id));
        if (incoming.length > 0) {
          void markRead(conversationId);
        }
        return incoming.length > 0 ? [...previous, ...incoming] : previous;
      });
      setArchived(result.archived);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [conversationId, locale]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) {
      return;
    }

    setSending(true);
    setErrorCode(null);
    const result = await sendMessageAction(conversationId, content, locale);
    if (!result.ok) {
      setErrorCode(result.error);
      setSending(false);
      return;
    }

    setInput("");
    const refreshed = await fetchMessagesAction(conversationId, locale);
    if (refreshed.ok) {
      setMessages(refreshed.messages);
      seenIdsRef.current = new Set(refreshed.messages.map((m) => m.id));
    }
    setSending(false);
  }

  async function loadEarlier() {
    const oldest = messages[0]?.createdAt;
    if (!oldest) {
      return;
    }
    const result = await fetchMessagesAction(conversationId, locale, oldest);
    if (result.ok) {
      setMessages((previous) => [...result.messages, ...previous]);
      setHasMore(result.messages.length >= 50);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[#6B7268]">
          {postTitle}
        </span>
        <span className="text-sm font-semibold text-[#232922]">{otherParticipantName}</span>
      </div>

      {archived ? (
        <div className="rounded-2xl bg-[#ECEAE4] px-4 py-3 text-sm font-medium text-[#6B7268]">
          {t("archivedBanner")}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-2xl border border-[#E3DED2] bg-white p-5">
        {hasMore ? (
          <button
            type="button"
            onClick={loadEarlier}
            className="mx-auto text-xs font-medium text-[#2F6B4F] underline"
          >
            {t("loadMore")}
          </button>
        ) : null}

        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#6B7268]">{t("empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => {
              const isOwn = message.senderId === currentUserId;
              return (
                <li
                  key={message.id}
                  className={`flex max-w-[80%] flex-col gap-0.5 rounded-2xl px-4 py-2 text-sm ${
                    isOwn
                      ? "self-end bg-[#2F6B4F] text-white"
                      : "self-start bg-[#F5F2EA] text-[#232922]"
                  }`}
                >
                  <span className="whitespace-pre-line break-words">{message.content}</span>
                  <span
                    className={`text-[10px] ${isOwn ? "text-white/70" : "text-[#9AA098]"}`}
                  >
                    {message.createdAtFormatted}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("inputPlaceholder")}
          disabled={archived || sending}
          rows={2}
          maxLength={4000}
          className="flex-1 resize-none rounded-2xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:outline-none focus:ring-2 focus:ring-[#2F6B4F] disabled:bg-[#ECEAE4]"
        />
        <button
          type="submit"
          disabled={archived || sending || input.trim().length === 0}
          className="shrink-0 rounded-full bg-[#2F6B4F] px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {sending ? t("sending") : t("send")}
        </button>
      </form>

      {errorCode ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${errorCode === "generic" || errorCode === "notFound" || errorCode === "unauthenticated" ? "generic" : errorCode}`)}
        </p>
      ) : null}
    </div>
  );
}
