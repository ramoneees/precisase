/**
 * Notification email templates — turns a queued `Notification` row into a
 * localized subject/body pair, sourced from the `email` namespace in
 * `messages/{pt-PT,en,pt-BR}.json` (never hardcoded copy — same rule the
 * rest of the app follows for user-facing strings).
 *
 * Why this doesn't use `getTranslations` from `next-intl/server`: that
 * function only works inside a React Server Component render (it resolves
 * to a stub that throws `"getTranslations" is not supported in Client
 * Components.` under any other module resolution condition — see
 * next-intl's package.json `exports["./server"]`, which only maps to the
 * real RSC implementation under the `"react-server"` condition that
 * Next.js's bundler sets up internally). The notification worker
 * (src/worker/notification-worker.ts) is a plain Node/tsx process with no
 * Next.js request lifecycle around it, so that condition is never active.
 *
 * Instead, this module reads the same `messages/{locale}.json` files
 * directly (the single source of truth for translated strings) and does
 * simple `{placeholder}` interpolation — the four email templates here
 * don't need ICU plurals/selects, so a tiny local interpolator is enough
 * and keeps the worker fully independent of Next.js/React.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { routing } from "@/i18n/routing";
import type {
  EmailContent,
  NotificationEmailBuilder,
  NotificationRecord,
} from "@/server/services/notification-dispatch-service";

interface EmailMessages {
  postApproved: { subject: string; body: string };
  postRejected: { subject: string; body: string };
  postClosed: { subject: string; body: string };
  interestReceived: { subject: string; body: string; messageLine: string };
}

const messagesCache = new Map<string, Promise<EmailMessages>>();

function resolveLocale(locale: string): string {
  return (routing.locales as readonly string[]).includes(locale)
    ? locale
    : routing.defaultLocale;
}

async function loadEmailMessages(locale: string): Promise<EmailMessages> {
  const resolved = resolveLocale(locale);
  const cached = messagesCache.get(resolved);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const filePath = join(process.cwd(), "messages", `${resolved}.json`);
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { email: EmailMessages };
    return parsed.email;
  })();
  messagesCache.set(resolved, promise);
  return promise;
}

/** Replaces `{key}` tokens with `vars[key]`; leaves unknown tokens untouched. */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

function postLink(_locale: string, postId: string): string {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // URL is locale-agnostic (`/posts/123`); the recipient's NEXT_LOCALE
  // cookie (set by next-intl middleware on first visit) chooses the
  // rendering language.
  return `${appUrl}/posts/${postId}`;
}

function readTitle(payload: Record<string, unknown>): string {
  const title = payload.title;
  return typeof title === "string" && title.length > 0 ? title : "your post";
}

function readPostId(payload: Record<string, unknown>, fallback: string | null): string {
  const postId = payload.postId;
  return typeof postId === "string" && postId.length > 0 ? postId : (fallback ?? "");
}

/**
 * Builds the localized subject/body for a single notification. Payload
 * shapes (confirmed at the `addNotification()` call sites, not guessed):
 *   - post_approved:     { postId, title }                            (post-service.ts `approvePost`)
 *   - post_rejected:      { postId, title, reason }                    (post-service.ts `rejectPost`)
 *   - interest_received:  { postId, title, interestedUserId, message } (interest-service.ts `expressInterest`)
 *   - post_closed:        { postId, title }                            (post-service.ts `closePost`, FR11)
 */
export async function buildNotificationEmail(
  notification: NotificationRecord,
): Promise<EmailContent> {
  const { type, payload, recipientLocale, recipientDisplayName, postId } = notification;
  const messages = await loadEmailMessages(recipientLocale);
  const name = recipientDisplayName || "there";
  const title = readTitle(payload);
  const link = postLink(recipientLocale, readPostId(payload, postId));

  switch (type) {
    case "post_approved": {
      const t = messages.postApproved;
      return {
        subject: interpolate(t.subject, { title }),
        text: interpolate(t.body, { name, title, link }),
      };
    }
    case "post_rejected": {
      const t = messages.postRejected;
      const reason =
        typeof payload.reason === "string" && payload.reason.length > 0
          ? payload.reason
          : "";
      return {
        subject: interpolate(t.subject, { title }),
        text: interpolate(t.body, { name, title, reason, link }),
      };
    }
    case "post_closed": {
      const t = messages.postClosed;
      return {
        subject: interpolate(t.subject, { title }),
        text: interpolate(t.body, { name, title, link }),
      };
    }
    case "interest_received": {
      const t = messages.interestReceived;
      const message =
        typeof payload.message === "string" && payload.message.length > 0
          ? payload.message
          : null;
      const messageLine = message ? interpolate(t.messageLine, { message }) : "";
      return {
        subject: interpolate(t.subject, { title }),
        text: interpolate(t.body, { name, title, link, messageLine }),
      };
    }
    default: {
      // Exhaustiveness guard — if a new NotificationType is ever added to
      // the Prisma schema without a matching template here, fail loudly
      // (and retryably — the dispatch service treats a thrown error the
      // same as a mailer failure) rather than silently sending a blank
      // email.
      const exhaustiveCheck: never = type;
      throw new Error(`No email template for notification type "${String(exhaustiveCheck)}".`);
    }
  }
}

/** `NotificationEmailBuilder` port implementation used by the worker. */
export class TemplateEmailBuilder implements NotificationEmailBuilder {
  async build(notification: NotificationRecord): Promise<EmailContent> {
    return buildNotificationEmail(notification);
  }
}
