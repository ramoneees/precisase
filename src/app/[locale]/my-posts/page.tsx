import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { postService } from "@/server/service-instances";
import { listCategories } from "@/server/categories";
import { prisma } from "@/server/repositories/prisma-client";
import { colors } from "@/lib/design-tokens";
import { placeholderPhoto } from "@/lib/placeholder-photo";
import { resolvePhotoUrl } from "@/lib/resolve-photo-url";
import { getPostPhotos } from "@/lib/post-photos";
import { MyPostRow, type MyPostRowData } from "./my-post-row";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "myPosts" });
  return { title: t("heading") };
}

export default async function MyPostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect({ href: "/signin", locale: locale as AppLocale });
    return null;
  }

  const [posts, categories] = await Promise.all([
    postService.listMyPosts(userId),
    listCategories(),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const tCategory = await getTranslations({ locale, namespace: "category" });
  const t = await getTranslations({ locale, namespace: "myPosts" });

  // A single groupBy query for every one of this author's posts' interest
  // counts, rather than N per-row queries — a read-only display concern,
  // so it doesn't need to go through the strict PostRepository port used
  // for business logic (see post-service.ts).
  const postIds = posts.map((post) => post.id);
  const interestCounts = postIds.length
    ? await prisma.interest.groupBy({
        by: ["postId"],
        where: { postId: { in: postIds } },
        _count: { _all: true },
      })
    : [];
  const interestCountByPostId = new Map(
    interestCounts.map((row) => [row.postId, row._count._all]),
  );

  const rows: MyPostRowData[] = posts.map((post) => {
    const category = categoryById.get(post.categoryId);
    const photos = getPostPhotos(post.extraAttributes);
    const tint = category?.slug === "donation" ? colors.accent : colors.primary;
    const photoUrl =
      photos.length > 0
        ? resolvePhotoUrl(photos[0]!)
        : placeholderPhoto(category ? tCategory(category.slug) : "", tint);

    return {
      id: post.id,
      type: post.type,
      status: post.status,
      title: post.title,
      photoUrl,
      interestCount: interestCountByPostId.get(post.id) ?? 0,
      rejectedReason: post.rejectedReason,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
        {t("heading")}
      </h1>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E3DED2] bg-white px-6 py-16 text-center">
          <p className="text-sm text-[#6B7268]">{t("empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <MyPostRow key={row.id} post={row} locale={locale} />
          ))}
        </ul>
      )}
    </main>
  );
}
