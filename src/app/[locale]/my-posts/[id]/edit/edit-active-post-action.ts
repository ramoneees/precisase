"use server";

/**
 * "Edit an active post" Server Action (FR03, `PostService.editActivePost`
 * in post-service.ts). Sibling of `resubmitPostAction` — different
 * state transition (active → active, no moderation step) and different
 * error codes. Re-validates required fields server-side (defense in
 * depth, §7.2), same pattern as `resubmitPostAction` and
 * `createPostAction`.
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
} from "@/server/services/post-service";
import { PHONE_COUNTRY_DEFAULT, type CountryCode } from "@/server/services/phone-service";
import { defaultPhoneCountryFor } from "@/lib/region-defaults";

export type EditActivePostErrorCode =
  | "unauthenticated"
  | "invalidInput"
  | "invalidPhone"
  | "unauthorized"
  | "activeInvalidTransition"
  | "generic";

export type EditActivePostResult = {
  ok: true;
} | { ok: false; error: EditActivePostErrorCode };

export interface EditActivePostInput {
  postId: string;
  title: string;
  description: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
  /**
   * ISO 3166-1 alpha-2 hint for `phone`/`whatsapp` parsing. Falls back to
   * the viewer's country on the server when omitted (e.g. the active-edit
   * form supplies this from its country dropdown).
   */
  phoneCountry?: string;
}

export async function editActivePostAction(
  input: EditActivePostInput,
): Promise<EditActivePostResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  if (!title || !description) {
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
    await postService.editActivePost({
      postId: input.postId,
      actor: { id: session.user.id, role: session.user.role },
      updates: {
        title,
        description,
        contactMethod: input.contactMethod,
        contactValue: normalizedContact,
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
      return { ok: false, error: "activeInvalidTransition" };
    }
    return { ok: false, error: "generic" };
  }

  revalidatePath(`/my-posts`);
  revalidatePath(`/posts/${input.postId}`);

  return { ok: true };
}
