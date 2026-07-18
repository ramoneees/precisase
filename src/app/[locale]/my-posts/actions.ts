"use server";

/**
 * "My posts" row actions (close/reopen). Kept in a dedicated file (not
 * inlined in `page.tsx`), same pattern as `posts/[id]/actions.ts` — the
 * author-only close/reopen state transitions already live in `PostService`
 * (§5.3); this just wires them to a session-aware Server Action and
 * revalidates the my-posts list afterwards.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { postService } from "@/server/service-instances";
import {
  InvalidPostTransitionError,
  PostNotFoundError,
  UnauthorizedPostActionError,
} from "@/server/services/post-service";
import { routing, type AppLocale } from "@/i18n/routing";

export type MyPostActionErrorCode = "unauthenticated" | "unauthorized" | "invalidTransition" | "generic";

export type MyPostActionResult = { ok: true } | { ok: false; error: MyPostActionErrorCode };

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

function mapError(error: unknown): MyPostActionErrorCode {
  if (error instanceof UnauthorizedPostActionError) return "unauthorized";
  if (error instanceof InvalidPostTransitionError) return "invalidTransition";
  if (error instanceof PostNotFoundError) return "invalidTransition";
  return "generic";
}

export async function closeMyPostAction(
  postId: string,
  locale: string,
): Promise<MyPostActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    await postService.closePost({
      postId,
      actor: { id: session.user.id, role: session.user.role },
    });
  } catch (error) {
    return { ok: false, error: mapError(error) };
  }

  const resolvedLocale = isSupportedLocale(locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/my-posts`);
  revalidatePath("/", "page");

  return { ok: true };
}

export async function reopenMyPostAction(
  postId: string,
  locale: string,
): Promise<MyPostActionResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    await postService.reopenPost({
      postId,
      actor: { id: session.user.id, role: session.user.role },
    });
  } catch (error) {
    return { ok: false, error: mapError(error) };
  }

  const resolvedLocale = isSupportedLocale(locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/my-posts`);
  revalidatePath("/", "page");

  return { ok: true };
}
