import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { postService } from "@/server/service-instances";
import { PostNotFoundError } from "@/server/services/post-service";
import { listCategories } from "@/server/categories";
import { ResubmitPostForm } from "./resubmit-post-form";

interface PageParams {
  locale: string;
  id: string;
}

/**
 * "Edit and resubmit" a rejected post (FR03,
 * `PostService.resubmitPost` in post-service.ts). A dedicated route
 * (mirroring `posts/new` and `posts/[id]`) rather than an inline-expand in
 * `MyPostRow`, so the row component stays a thin presentational list item
 * and this page owns loading the full post + category options needed to
 * pre-fill the form.
 */
export default async function EditRejectedPostPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect({ href: "/signin", locale: locale as AppLocale });
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

  // Defense in depth (§7.2): `getPost` also lets a moderator/admin view a
  // non-active post, but only the post's own author may resubmit it — a
  // moderator hitting this URL directly should be bounced back, not shown
  // an edit form for someone else's post.
  if (post.authorId !== session.user.id) {
    redirect({ href: "/my-posts", locale: locale as AppLocale });
    return null;
  }

  // Nothing to resubmit unless the post is actually rejected — a stale
  // link/back-navigation after a successful resubmit would otherwise land
  // here on a now-`pending` post.
  if (post.status !== "rejected") {
    redirect({ href: "/my-posts", locale: locale as AppLocale });
    return null;
  }

  const categories = await listCategories();
  const t = await getTranslations({ locale, namespace: "myPosts.edit" });

  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {t("heading")}
        </h1>
        <p className="text-sm text-[#6B7268]">{t("subtitle")}</p>
      </div>

      <ResubmitPostForm
        categories={categories}
        postId={post.id}
        rejectedReason={post.rejectedReason}
        initial={{
          type: post.type,
          categoryId: post.categoryId,
          title: post.title,
          description: post.description,
          contactMethod: post.contactMethod,
          contactValue: post.contactValue,
        }}
      />
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "myPosts.edit" });
  return { title: t("heading") };
}
