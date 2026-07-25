"use server";

/**
 * Create-post Server Action (FR01). Re-validates everything server-side
 * (defense in depth, §7.2) even though the client form (create-post-form.tsx)
 * mirrors these checks for a snappier UX — a request that skips the client
 * entirely must still be rejected here.
 */

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { postService } from "@/server/service-instances";
import { findCategoryBySlug } from "@/server/categories";
import {
  ContactInfoRequiredError,
  InvalidPhoneError,
  normalizeContactValue,
  type ContactMethodValue,
  type PostTypeValue,
} from "@/server/services/post-service";
import { PHONE_COUNTRY_DEFAULT, type CountryCode } from "@/server/services/phone-service";
import { defaultPhoneCountryFor } from "@/lib/region-defaults";

export type CreatePostErrorCode =
  | "unauthenticated"
  | "invalidInput"
  | "invalidPhone"
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
  /** Optional extra attributes (e.g. job fields: employmentType, salaryRange, location). */
  extraAttributes?: Record<string, unknown>;
  /** Optional override for `phone`/`whatsapp` parsing (server falls back to viewer country). */
  phoneCountry?: string;
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

  // Content locale for the post (used by FTS — see posts_search_config in
  // prisma/migrations/20260718181500_post_search_indexes/migration.sql).
  // Pulled from the request context (next-intl middleware-resolved locale
  // — cookie > Accept-Language > defaultLocale) rather than from the
  // form input, since the form no longer threads locale through.
  const locale = await getLocale();

  if (!title || !description) {
    return { ok: false, error: "invalidInput" };
  }

  if (!input.consent) {
    return { ok: false, error: "consentRequired" };
  }

  const category = await findCategoryBySlug(input.categorySlug);
  if (!category) {
    return { ok: false, error: "invalidInput" };
  }

  const phoneCountry: CountryCode =
    (typeof input.phoneCountry === "string" && input.phoneCountry.length > 0
      ? (input.phoneCountry as CountryCode)
      : (defaultPhoneCountryFor(session.user.country) as CountryCode | null)) ??
    PHONE_COUNTRY_DEFAULT;

  let normalizedContact: string;
  try {
    normalizedContact = normalizeContactValue(
      input.contactMethod,
      input.contactValue,
      phoneCountry,
    );
  } catch (error) {
    if (error instanceof InvalidPhoneError) {
      return { ok: false, error: "invalidPhone" };
    }
    if (error instanceof ContactInfoRequiredError) {
      return { ok: false, error: "invalidInput" };
    }
    throw error;
  }

  const photos = Array.isArray(input.photos)
    ? input.photos.filter((photo) => typeof photo === "string" && photo.length > 0)
    : [];

  // Merge photos into extraAttributes (form passes job fields + we add photos)
  const extraAttributes: Record<string, unknown> = { ...(input.extraAttributes ?? {}) };
  if (photos.length > 0) extraAttributes.photos = photos;

  try {
    const post = await postService.createPost({
      authorId: session.user.id,
      categoryId: category.id,
      type: input.type,
      title,
      description,
      contactMethod: input.contactMethod,
      contactValue: normalizedContact,
      locale,
      extraAttributes,
    });

    revalidatePath(`/my-posts`);

    return { ok: true, postId: post.id };
  } catch (error) {
    if (error instanceof ContactInfoRequiredError) {
      return { ok: false, error: "invalidInput" };
    }
    throw error;
  }
}
