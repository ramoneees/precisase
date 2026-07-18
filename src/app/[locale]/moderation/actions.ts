"use server";

/**
 * Moderation Server Actions (FR15, docs/ARCHITECTURE.md §5.3/§7.2). Kept in
 * a dedicated file (not inlined in `page.tsx`/`moderation-card.tsx`), same
 * convention as `posts/[id]/actions.ts`. Defense-in-depth per §7.2: even
 * though `moderation/page.tsx` already redirects non-moderators away
 * server-side, these actions independently re-check
 * `session.user.role` — and `PostService.approvePost`/`rejectPost`
 * themselves enforce the same rule a third time — so a forged direct call
 * to either action can never bypass RBAC.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { postService } from "@/server/service-instances";
import {
  InvalidPostTransitionError,
  ModerationReasonRequiredError,
  UnauthorizedPostActionError,
} from "@/server/services/post-service";
import { routing, type AppLocale } from "@/i18n/routing";

export type ModerationActionErrorCode =
  | "unauthorized"
  | "invalidTransition"
  | "reasonRequired"
  | "generic";

export type ModerationActionResult =
  | { ok: true }
  | { ok: false; error: ModerationActionErrorCode };

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

async function requireModerator() {
  const session = await auth();
  const user = session?.user;
  if (!user || (user.role !== "moderator" && user.role !== "admin")) {
    return null;
  }
  return { id: user.id, role: user.role };
}

export async function approvePostAction(
  postId: string,
  locale: string,
): Promise<ModerationActionResult> {
  const moderator = await requireModerator();
  if (!moderator) {
    return { ok: false, error: "unauthorized" };
  }

  try {
    await postService.approvePost({ postId, moderator });
  } catch (error) {
    if (error instanceof UnauthorizedPostActionError) {
      return { ok: false, error: "unauthorized" };
    }
    if (error instanceof InvalidPostTransitionError) {
      return { ok: false, error: "invalidTransition" };
    }
    return { ok: false, error: "generic" };
  }

  const resolvedLocale = isSupportedLocale(locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/moderation`);
  revalidatePath("/", "page");
  revalidatePath(`/${resolvedLocale}/my-posts`);

  return { ok: true };
}

export async function rejectPostAction(
  postId: string,
  reason: string,
  locale: string,
): Promise<ModerationActionResult> {
  const moderator = await requireModerator();
  if (!moderator) {
    return { ok: false, error: "unauthorized" };
  }

  try {
    await postService.rejectPost({ postId, moderator, reason });
  } catch (error) {
    if (error instanceof ModerationReasonRequiredError) {
      return { ok: false, error: "reasonRequired" };
    }
    if (error instanceof UnauthorizedPostActionError) {
      return { ok: false, error: "unauthorized" };
    }
    if (error instanceof InvalidPostTransitionError) {
      return { ok: false, error: "invalidTransition" };
    }
    return { ok: false, error: "generic" };
  }

  const resolvedLocale = isSupportedLocale(locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/moderation`);
  revalidatePath(`/${resolvedLocale}/my-posts`);

  return { ok: true };
}
