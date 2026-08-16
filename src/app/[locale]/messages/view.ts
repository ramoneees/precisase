import { formatDateTime } from "@/lib/format";
import { defaultTimeZoneForUiLocale } from "@/lib/region-defaults";
import type { ConversationSummary } from "@/server/services/conversation-service";

/**
 * Display-ready inbox row. Dates arrive as ISO strings with a
 * preformatted "last message" time (locale/timezone resolved
 * server-side), so the client list renders without Intl logic.
 */
export interface ConversationListItem {
  id: string;
  postId: string;
  postTitle: string;
  postStatus: string;
  otherParticipantName: string;
  lastMessageContent: string | null;
  lastMessageAt: string | null;
  lastMessageAtFormatted: string | null;
  unreadCount: number;
  archived: boolean;
}

export function toListItem(summary: ConversationSummary, locale: string): ConversationListItem {
  return {
    id: summary.id,
    postId: summary.postId,
    postTitle: summary.postTitle,
    postStatus: summary.postStatus,
    otherParticipantName: summary.otherParticipantName,
    lastMessageContent: summary.lastMessageContent,
    lastMessageAt: summary.lastMessageAt ? summary.lastMessageAt.toISOString() : null,
    lastMessageAtFormatted: summary.lastMessageAt
      ? formatDateTime(summary.lastMessageAt, {
          locale,
          timeZone: defaultTimeZoneForUiLocale(locale),
          showTime: true,
        })
      : null,
    unreadCount: summary.unreadCount,
    archived: summary.archived,
  };
}
