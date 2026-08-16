import { formatDateTime } from "@/lib/format";
import { defaultTimeZoneForUiLocale } from "@/lib/region-defaults";
import type { MessageSummary } from "@/server/services/message-service";

/**
 * Display-ready chat message. `createdAtFormatted` is resolved
 * server-side (locale + timezone), so the client renders plain strings.
 */
export interface MessageItem {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  createdAtFormatted: string;
}

export function toMessageItem(message: MessageSummary, locale: string): MessageItem {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    createdAtFormatted: formatDateTime(message.createdAt, {
      locale,
      timeZone: defaultTimeZoneForUiLocale(locale),
      showTime: true,
    }),
  };
}
