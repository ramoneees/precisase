import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/server/auth/auth-context";
import { postService } from "@/server/service-instances";
import { listCategories, findCategoryBySlug } from "@/server/categories";
import { prisma } from "@/server/repositories/prisma-client";
import { colors } from "@/lib/design-tokens";
import { placeholderPhoto } from "@/lib/placeholder-photo";
import { resolvePhotoUrl } from "@/lib/resolve-photo-url";
import { getPostPhotos } from "@/lib/post-photos";
import { PostCard, type PostCardData } from "@/components/posts/post-card";
import { EmptyState } from "@/components/posts/empty-state";
import type { PostTypeValue } from "@/server/services/post-service";

const TYPE_VALUES: PostTypeValue[] = ["request", "offer"];

interface ListingSearchParams {
  category?: string;
  type?: string;
  q?: string;
  after?: string;
}

function buildQuery(
  current: ListingSearchParams,
  overrides: ListingSearchParams,
): { pathname: "/"; query: Record<string, string> } {
  const merged = { ...current, ...overrides };
  const query: Record<string, string> = {};
  if (merged.category) query.category = merged.category;
  if (merged.type) query.type = merged.type;
  if (merged.q) query.q = merged.q;
  return { pathname: "/", query };
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<ListingSearchParams>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "listing" });
  const tCategory = await getTranslations({ locale, namespace: "category" });
  const tAnon = await getTranslations({ locale, namespace: "auth.anon" });
  const authContext = await getAuthContext();

  const categories = await listCategories();

  const selectedCategorySlug =
    sp.category && categories.some((c) => c.slug === sp.category) ? sp.category : undefined;
  const selectedType: PostTypeValue | undefined = TYPE_VALUES.includes(
    sp.type as PostTypeValue,
  )
    ? (sp.type as PostTypeValue)
    : undefined;
  const search = sp.q?.trim() || undefined;

  const selectedCategory = selectedCategorySlug
    ? await findCategoryBySlug(selectedCategorySlug)
    : null;

  const posts = await postService.listActivePosts({
    categoryId: selectedCategory?.id,
    type: selectedType,
    search,
    after: sp.after,
  });
  const { nextCursor } = posts;

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const authorIds = [...new Set(posts.items.map((post) => post.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const authorNameById = new Map(authors.map((author) => [author.id, author.displayName]));

  const cards: PostCardData[] = posts.items.map((post) => {
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

  const currentParams: ListingSearchParams = {
    category: selectedCategorySlug,
    type: selectedType,
    q: search,
  };

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-extrabold text-[#232922]">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-[#6B7268]">{t("subtitle")}</p>
      </div>

      <form
        action="/"
        method="get"
        role="search"
        className="flex items-center gap-2"
      >
        {selectedCategorySlug ? (
          <input type="hidden" name="category" value={selectedCategorySlug} />
        ) : null}
        {selectedType ? <input type="hidden" name="type" value={selectedType} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
        <button
          type="submit"
          aria-label={t("search")}
          className="shrink-0 rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm font-medium text-[#232922] hover:bg-[#F7F4EE]"
        >
          {t("search")}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            href={buildQuery(currentParams, { category: undefined })}
            active={!selectedCategorySlug}
            label={t("filters.allCategories")}
          />
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              href={buildQuery(currentParams, { category: category.slug })}
              active={selectedCategorySlug === category.slug}
              label={tCategory(category.slug)}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            href={buildQuery(currentParams, { type: undefined })}
            active={!selectedType}
            label={t("filters.allTypes")}
          />
          <FilterChip
            href={buildQuery(currentParams, { type: "request" })}
            active={selectedType === "request"}
            label={t("filters.requests")}
          />
          <FilterChip
            href={buildQuery(currentParams, { type: "offer" })}
            active={selectedType === "offer"}
            label={t("filters.offers")}
          />
        </div>
      </div>

      {authContext.kind === "anon" && (
        <Link
          href="/signin"
          className="w-fit rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          {tAnon("signInToBrowse")}
        </Link>
      )}

      <p className="text-sm text-[#6B7268]">
        {t("resultsCount", { count: cards.length })}
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          cards.map((card) => <PostCard key={card.id} post={card} />)
        )}
      </div>

      {nextCursor ? (
        <Link
          href={buildQuery(currentParams, { after: nextCursor })}
          className="mx-auto rounded-full border border-[#E3DED2] bg-white px-6 py-2.5 text-sm font-medium text-[#2F6B4F] hover:border-[#2F6B4F]"
        >
          {t("loadMore")}
        </Link>
      ) : null}
    </main>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: { pathname: "/"; query: Record<string, string> };
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-[#2F6B4F] px-4 py-1.5 text-sm font-medium text-white"
          : "rounded-full border border-[#E3DED2] bg-white px-4 py-1.5 text-sm font-medium text-[#6B7268] hover:border-[#2F6B4F] hover:text-[#2F6B4F]"
      }
    >
      {label}
    </Link>
  );
}
