import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { postService } from "@/server/service-instances";
import { listCategories } from "@/server/categories";
import { prisma } from "@/server/repositories/prisma-client";
import { getPostPhotos } from "@/lib/post-photos";
import { resolvePhotoUrl } from "@/lib/resolve-photo-url";
import { placeholderPhoto } from "@/lib/placeholder-photo";
import { colors } from "@/lib/design-tokens";
import { ModerationCard, type ModerationQueueItem } from "./moderation-card";

/**
 * Moderation queue (FR15, docs/ARCHITECTURE.md §4.4, §7.2: RBAC).
 * Restricted to `moderator`/`admin` roles.
 *
 * This is a **server-side** RBAC check (re-run on every request, since this
 * route is dynamic due to reading the session cookie) — defense in depth
 * per §7.2: "UI hides forbidden actions AND every Route Handler re-checks
 * RBAC." Anyone without the required role is redirected to the locale
 * home, never shown the queue even briefly. The `approvePostAction`/
 * `rejectPostAction` Server Actions independently re-check the role too
 * (see actions.ts), so this guard is one layer among several, not the only
 * one.
 */
export default async function ModerationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const role = session?.user?.role;

  if (role !== "moderator" && role !== "admin") {
    redirect({ href: "/", locale: locale as AppLocale });
  }

  const t = await getTranslations({ locale, namespace: "moderation" });
  const tCategory = await getTranslations({ locale, namespace: "category" });

  const [pendingPosts, categories] = await Promise.all([
    postService.listPendingPosts(),
    listCategories(),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const authorIds = [...new Set(pendingPosts.map((post) => post.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const authorNameById = new Map(authors.map((author) => [author.id, author.displayName]));

  const items: ModerationQueueItem[] = pendingPosts.map((post) => {
    const category = categoryById.get(post.categoryId);
    const categoryKey = category?.key ?? "category.volunteering";
    const photos = getPostPhotos(post.extraAttributes);
    const tint = category?.slug === "donation" ? colors.accent : colors.primary;
    const photoUrl =
      photos.length > 0
        ? resolvePhotoUrl(photos[0]!)
        : placeholderPhoto(category ? tCategory(category.slug) : "", tint);

    return {
      id: post.id,
      type: post.type,
      categoryKey,
      title: post.title,
      description: post.description,
      authorName: authorNameById.get(post.authorId) ?? "",
      createdAt: post.createdAt,
      photoUrl,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-extrabold text-[#232922]">{t("title")}</h1>
        <p className="text-sm text-[#6B7268]">{t("countSubtitle", { count: items.length })}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#E3DED2] bg-white px-6 py-16 text-center">
          <p className="font-heading text-lg font-extrabold text-[#232922]">{t("empty")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => (
            <ModerationCard key={item.id} post={item} locale={locale} />
          ))}
        </div>
      )}
    </main>
  );
}
