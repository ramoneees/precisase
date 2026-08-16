"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { fetchInboxAction } from "./actions";
import type { ConversationListItem } from "./view";

const POLL_INTERVAL_MS = 5_000;

/**
 * Inbox list with 5s polling (D3). Receives the server-rendered rows as
 * the initial state so the first paint is static HTML, then keeps the
 * list fresh via fetchInboxAction — same interval the chat view uses.
 */
export function ConversationList({
  initialItems,
  locale,
}: {
  initialItems: ConversationListItem[];
  locale: string;
}) {
  const t = useTranslations("chat.inbox");
  const [items, setItems] = useState(initialItems);

  useEffect(() => {
    const interval = setInterval(async () => {
      const result = await fetchInboxAction(locale);
      if (result.ok) {
        setItems(result.items);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [locale]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E3DED2] bg-white px-6 py-16 text-center">
        <p className="text-sm text-[#6B7268]">{t("empty")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/messages/${item.id}`}
            className="flex flex-col gap-2 rounded-2xl border border-[#E3DED2] bg-white p-5 transition-colors hover:border-[#2F6B4F]"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={`text-sm ${
                  item.unreadCount > 0
                    ? "font-bold text-[#232922]"
                    : "font-semibold text-[#232922]"
                }`}
              >
                {item.otherParticipantName}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {item.archived ? (
                  <span className="rounded-full bg-[#ECEAE4] px-2 py-0.5 text-xs font-medium text-[#6B7268]">
                    {t("archived")}
                  </span>
                ) : null}
                {item.unreadCount > 0 ? (
                  <span className="rounded-full bg-[#2F6B4F] px-2 py-0.5 text-xs font-semibold text-white">
                    {t("unread", { count: item.unreadCount })}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="text-xs font-medium uppercase tracking-wide text-[#6B7268]">
              {item.postTitle}
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-[#6B7268]">
                {item.lastMessageContent ?? ""}
              </span>
              {item.lastMessageAtFormatted ? (
                <span className="shrink-0 text-xs text-[#9AA098]">
                  {item.lastMessageAtFormatted}
                </span>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
