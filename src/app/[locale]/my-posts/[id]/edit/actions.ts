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
  InvalidPostTransitionError,
  PostNotFoundError,
  UnauthorizedPostActionError,
  type ContactMethodValue,
  type PostTypeValue,
} from "@/server/services/post-service";

export type ResubmitPostErrorCode =
  | "unauthenticated"
  | "invalidInput"
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
  const contactValue = input.contactValue?.trim() ?? "";

  if (!title || !description || !input.categoryId || !contactValue) {
    return { ok: false, error: "invalidInput" };
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
        contactValue,
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
