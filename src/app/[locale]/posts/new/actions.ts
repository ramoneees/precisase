"use server";

/**
 * Create-post Server Action (FR01). Re-validates everything server-side
 * (defense in depth, §7.2) even though the client form (create-post-form.tsx)
 * mirrors these checks for a snappier UX — a request that skips the client
 * entirely must still be rejected here.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { postService } from "@/server/service-instances";
import { findCategoryBySlug } from "@/server/categories";
import {
  ContactInfoRequiredError,
  type ContactMethodValue,
  type PostTypeValue,
} from "@/server/services/post-service";
import { routing, type AppLocale } from "@/i18n/routing";

export type CreatePostErrorCode =
  | "unauthenticated"
  | "invalidInput"
  | "consentRequired"
  | "generic";

export type CreatePostResult =
  | { ok: true; postId: string }
  | { ok: false; error: CreatePostErrorCode };

export interface CreatePostInput {
  type: PostTypeValue;
  categorySlug: string;
  title: string;
  description: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
  consent: boolean;
  /** Relative URLs already uploaded via `/api/uploads` (up to 4). */
  photos: string[];
  locale: string;
}

function isSupportedLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

export async function createPostAction(
  input: CreatePostInput,
): Promise<CreatePostResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";
  const contactValue = input.contactValue?.trim() ?? "";
  const locale = isSupportedLocale(input.locale) ? input.locale : routing.defaultLocale;

  if (!title || !description || !contactValue) {
    return { ok: false, error: "invalidInput" };
  }

  if (!input.consent) {
    return { ok: false, error: "consentRequired" };
  }

  const category = await findCategoryBySlug(input.categorySlug);
  if (!category) {
    return { ok: false, error: "invalidInput" };
  }

  const photos = Array.isArray(input.photos)
    ? input.photos.filter((photo) => typeof photo === "string" && photo.length > 0)
    : [];

  try {
    const post = await postService.createPost({
      authorId: session.user.id,
      categoryId: category.id,
      type: input.type,
      title,
      description,
      contactMethod: input.contactMethod,
      contactValue,
      locale,
      extraAttributes: photos.length > 0 ? { photos } : {},
    });

    revalidatePath(`/${locale}/my-posts`);

    return { ok: true, postId: post.id };
  } catch (error) {
    if (error instanceof ContactInfoRequiredError) {
      return { ok: false, error: "invalidInput" };
    }
    throw error;
  }
}
