"use server";

/**
 * "Edit and resubmit" Server Action (FR03, rejected -> pending), wiring
 * `postService.resubmitPost` (post-service.ts) to the UI. Re-validates
 * required fields server-side (defense in depth, §7.2), same pattern as
 * `posts/new/actions.ts`'s `createPostAction`.
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { postService } from "@/server/service-instances";
import {
  ContactInfoRequiredError,
  InvalidPhoneError,
  InvalidPostTransitionError,
  PostNotFoundError,
  UnauthorizedPostActionError,
  normalizeContactValue,
  type ContactMethodValue,
  type PostTypeValue,
} from "@/server/services/post-service";
import { PHONE_COUNTRY_DEFAULT, type CountryCode } from "@/server/services/phone-service";
import { defaultPhoneCountryFor } from "@/lib/region-defaults";

export type ResubmitPostErrorCode =
  | "unauthenticated"
  | "invalidInput"
  | "invalidPhone"
  | "unauthorized"
  | "invalidTransition"
  | "generic";

export type ResubmitPostResult = { ok: true } | { ok: false; error: ResubmitPostErrorCode };

export interface ResubmitPostInput {
  postId: string;
  type: PostTypeValue;
  categoryId: string;
  title: string;
  description: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
  phoneCountry?: string;
  extraAttributes?: Record<string, unknown>;
}

export async function resubmitPostAction(
  input: ResubmitPostInput,
): Promise<ResubmitPostResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  if (!title || !description || !input.categoryId) {
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

  try {
    await postService.resubmitPost({
      postId: input.postId,
      actor: { id: session.user.id, role: session.user.role },
      updates: {
        type: input.type,
        categoryId: input.categoryId,
        title,
        description,
        contactMethod: input.contactMethod,
        contactValue: normalizedContact,
        extraAttributes: input.extraAttributes,
      },
    });
  } catch (error) {
    if (error instanceof ContactInfoRequiredError) {
      return { ok: false, error: "invalidInput" };
    }
    if (error instanceof UnauthorizedPostActionError) {
      return { ok: false, error: "unauthorized" };
    }
    if (error instanceof InvalidPostTransitionError || error instanceof PostNotFoundError) {
      return { ok: false, error: "invalidTransition" };
    }
    return { ok: false, error: "generic" };
  }

  revalidatePath(`/my-posts`);

  return { ok: true };
}
