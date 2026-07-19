import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { postService } from "@/server/service-instances";
import { PostNotFoundError } from "@/server/services/post-service";
import { PHONE_COUNTRY_DEFAULT } from "@/server/services/phone-service";
import { defaultPhoneCountryFor } from "@/lib/region-defaults";
import { listCategories } from "@/server/categories";
import { EditPostForm, type EditPostFormMode } from "./edit-post-form";

interface PageParams {
  id: string;
}

/**
 * Edit-post page (FR03) — handles two flows from the same URL:
 *
 *   - `rejected` post  → resubmit flow (full form: type/category/title/description/contact).
 *   - `active` post    → edit-active flow (title/description/contact only — `PostService.editActivePost`
 *                       does not allow changing type/category while a post is live).
 *
 * Only the post's author can use either flow (defense in depth, §7.2).
 */
export default async function EditPostPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { id } = await params;
  const locale = await getLocale();

  const session = await auth();
  if (!session?.user) {
    redirect({ href: "/signin", locale });
    return null;
  }

  const viewer = { id: session.user.id, role: session.user.role };

  let post;
  try {
    post = await postService.getPost({ postId: id, viewer });
  } catch (error) {
    if (error instanceof PostNotFoundError) {
      notFound();
    }
    throw error;
  }

  if (post.authorId !== session.user.id) {
    redirect({ href: "/my-posts", locale });
    return null;
  }

  const mode: EditPostFormMode | null =
    post.status === "rejected"
      ? "rejected"
      : post.status === "active"
        ? "active"
        : null;

  if (mode === null) {
    redirect({ href: "/my-posts", locale });
    return null;
  }

  const categories = await listCategories();
  const t = await getTranslations({ locale, namespace: "myPosts.edit" });

  // Initial phone-country hint for the contact dropdown. The server action
  // re-parses the value with whatever country the user picks in the form
  // (defense in depth, §7.2) — this prop only seeds the dropdown's state.
  const phoneCountry =
    defaultPhoneCountryFor(session.user.country) ?? PHONE_COUNTRY_DEFAULT;

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t(mode === "active" ? "activeHeading" : "heading")}
        </h1>
        <p className="text-sm text-[#6B7268]">
          {t(mode === "active" ? "activeSubtitle" : "subtitle")}
        </p>
      </div>

      <EditPostForm
        categories={categories}
        postId={post.id}
        mode={mode}
        rejectedReason={post.rejectedReason}
        initial={{
          type: post.type,
          categoryId: post.categoryId,
          title: post.title,
          description: post.description,
          contactMethod: post.contactMethod,
          contactValue: post.contactValue,
        }}
        phoneCountry={phoneCountry}
      />
    </main>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "myPosts.edit" });
  return { title: t("heading") };
}
