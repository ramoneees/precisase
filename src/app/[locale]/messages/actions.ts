"use server";

/**
 * Inbox polling action (D3 — 5s polling, no SSE/websocket). Returns the
 * signed-in user's conversation summaries as a display-ready view model
 * (ISO dates + preformatted last-message time), so the client component
 * can setState directly without locale/timezone logic of its own.
 */

import { getAuthContext } from "@/server/auth/auth-context";
import { conversationService } from "@/server/service-instances";
import { toListItem, type ConversationListItem } from "./view";

export async function fetchInboxAction(
  locale: string,
): Promise<{ ok: true; items: ConversationListItem[] } | { ok: false; error: "unauthenticated" }> {
  const authContext = await getAuthContext();
  if (authContext.kind === "anon") {
    return { ok: false, error: "unauthenticated" };
  }

  const summaries = await conversationService.listForUser(authContext.user.id);
  return { ok: true, items: summaries.map((s) => toListItem(s, locale)) };
}
