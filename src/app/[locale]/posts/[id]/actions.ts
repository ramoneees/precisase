"use server";

/**
 * "Express interest" Server Action (FR09, §6.2). Kept in this dedicated
 * file (not inlined in `page.tsx`) so it's easy to find/reuse — e.g. the
 * "my posts" view may want to link back here, and this file intentionally
 * doesn't import anything from sibling view files to avoid collisions with
 * other agents' work on this route tree.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { interestService } from "@/server/service-instances";
import {
  DuplicateInterestError,
  PostNotAvailableError,
  PostNotFoundError,
} from "@/server/services/interest-service";
import { routing, type AppLocale } from "@/i18n/routing";

export type ExpressInterestErrorCode =
  | "unauthenticated"
  | "unavailable"
  | "duplicate"
  | "generic";

export type ExpressInterestResult =
  | { ok: true }
  | { ok: false; error: ExpressInterestErrorCode };

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

export async function expressInterestAction(
  postId: string,
  locale: string,
): Promise<ExpressInterestResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    await interestService.expressInterest({ postId, userId: session.user.id });
  } catch (error) {
    if (error instanceof DuplicateInterestError) {
      return { ok: false, error: "duplicate" };
    }
    if (error instanceof PostNotAvailableError || error instanceof PostNotFoundError) {
      return { ok: false, error: "unavailable" };
    }
    return { ok: false, error: "generic" };
  }

  const resolvedLocale = isSupportedLocale(locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${resolvedLocale}/posts/${postId}`);

  return { ok: true };
}
