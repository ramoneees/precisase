import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAuthContext } from "@/server/auth/auth-context";
import { Link } from "@/i18n/navigation";
import { postService } from "@/server/service-instances";
import { PostNotFoundError } from "@/server/services/post-service";
import { findCategoryById } from "@/server/categories";
import { prisma } from "@/server/repositories/prisma-client";
import { getPostPhotos } from "@/lib/post-photos";
import { resolvePhotoUrl } from "@/lib/resolve-photo-url";
import { placeholderPhoto } from "@/lib/placeholder-photo";
import { colors } from "@/lib/design-tokens";
import { formatDateTime } from "@/lib/format";
import { defaultTimeZoneForUiLocale } from "@/lib/region-defaults";
import { TypeBadge, CategoryBadge, StatusBadge } from "@/components/posts/badges";
import { PhotoGallery } from "@/components/posts/photo-gallery";
import { ContactPanel } from "./contact-panel";
import { ExpressInterestButton } from "./express-interest-button";

interface PageParams {
  locale: string;
  id: string;
}

async function loadPostUncached(params: PageParams) {
  const { locale, id } = params;
  const authContext = await getAuthContext();
  const viewer =
    authContext.kind === "user" ? { id: authContext.user.id, role: authContext.user.role } : null;

  let post;
  try {
    post = await postService.getPost({ postId: id, viewer });
  } catch (error) {
    if (error instanceof PostNotFoundError) {
      notFound();
    }
    throw error;
  }

  const [author, category, existingInterest] = await Promise.all([
    prisma.user.findUnique({ where: { id: post.authorId }, select: { displayName: true } }),
    findCategoryById(post.categoryId),
    viewer && viewer.id !== post.authorId
      ? prisma.interest.findUnique({
          where: { postId_userId: { postId: post.id, userId: viewer.id } },
        })
      : Promise.resolve(null),
  ]);

  const isAuthor = viewer?.id === post.authorId;

  return { post, author, category, viewer, isAuthor, existingInterest, locale };
}

/**
 * Request-scoped de-duplication: both `generateMetadata` and the page body
 * call this with the same `params`, and Next.js does NOT dedupe Prisma
 * queries the way it dedupes `fetch()`. Without `cache()`, the detail page
 * was issuing 6–8 redundant DB queries + 2 unnecessary contact-value
 * decrypts per view. `cache()` returns the same Promise for the same
 * arguments within a single request.
 */
const loadPost = cache(loadPostUncached);

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const resolved = await params;
  try {
    const { post } = await loadPost(resolved);
    return { title: post.title };
  } catch {
    return {};
  }
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const resolved = await params;
  const { locale } = resolved;
  setRequestLocale(locale);

  const { post, author, category, viewer, isAuthor, existingInterest } =
    await loadPost(resolved);

  const t = await getTranslations({ locale, namespace: "post.detail" });
  const tCategory = await getTranslations({ locale, namespace: "category" });
  const tAnon = await getTranslations({ locale, namespace: "post.anon" });
  const tJobFields = await getTranslations({ locale, namespace: "post.createForm" });

  const uploadedPhotos = getPostPhotos(post.extraAttributes).map(resolvePhotoUrl);
  const authorName = author?.displayName ?? "";
  const categoryKey = category?.key ?? "category.volunteering";
  const categoryTint = category?.slug === "donation" ? colors.accent : colors.primary;
  const galleryPhotos =
    uploadedPhotos.length > 0
      ? uploadedPhotos
      : [placeholderPhoto(category ? tCategory(category.slug) : "", categoryTint)];

  const formattedDate = formatDateTime(post.createdAt, {
    locale,
    timeZone: defaultTimeZoneForUiLocale(locale),
  });

  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-6 py-10">
      <Link href="/" className="w-fit text-sm font-medium text-[#6B7268] hover:text-[#2F6B4F]">
        {t("backLink")}
      </Link>

      {post.status === "closed" ? (
        <div className="rounded-2xl bg-[#ECEAE4] px-4 py-3 text-sm font-medium text-[#6B7268]">
          {t("closedBanner")}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={post.type} />
          <CategoryBadge categoryKey={categoryKey} />
          {post.status !== "active" ? <StatusBadge status={post.status} /> : null}
        </div>
        <h1 className="font-heading text-[28px] leading-tight font-extrabold text-[#232922]">
          {post.title}
        </h1>
        <p className="text-sm text-[#9AA098]">
          {t("publishedBy", { author: authorName, date: formattedDate })}
        </p>
      </div>

      <PhotoGallery photos={galleryPhotos} />

      <div className="rounded-2xl border border-[#E3DED2] bg-white p-5">
        <p className="text-sm whitespace-pre-line text-[#232922]">{post.description}</p>
      </div>

      {category?.slug === "jobs" ? (() => {
        const attrs = post.extraAttributes as Record<string, unknown>;
        const jobItems: { label: string; value: string }[] = [];

        const typeKeyMap: Record<string, string> = {
          full_time: "employmentTypeFullTime",
          part_time: "employmentTypePartTime",
          contract: "employmentTypeContract",
          internship: "employmentTypeInternship",
        };

        if (typeof attrs.employmentType === "string" && attrs.employmentType) {
          const key = typeKeyMap[attrs.employmentType];
          jobItems.push({
            label: tJobFields("employmentType"),
            value: key ? tJobFields(key) : attrs.employmentType,
          });
        }
        if (typeof attrs.salaryRange === "string" && attrs.salaryRange) {
          jobItems.push({ label: tJobFields("salaryRange"), value: attrs.salaryRange });
        }
        if (typeof attrs.location === "string" && attrs.location) {
          jobItems.push({ label: tJobFields("jobLocation"), value: attrs.location });
        }

        if (jobItems.length === 0) return null;

        return (
          <div className="rounded-2xl border border-[#E3DED2] bg-white p-5">
            <dl className="flex flex-col gap-3">
              {jobItems.map((item) => (
                <div key={item.label} className="flex items-baseline gap-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-[#6B7268]">
                    {item.label}
                  </dt>
                  <dd className="text-sm text-[#232922]">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })() : null}

      {isAuthor ? null : existingInterest ? (
        <ContactPanel
          locale={locale}
          contactMethod={post.contactMethod}
          contactValue={post.contactValue}
        />
      ) : post.status === "active" && viewer ? (
        <ExpressInterestButton postId={post.id} locale={locale} />
      ) : post.status === "active" && !viewer ? (
        <Link
          href={`/signin?callbackUrl=${encodeURIComponent(`/posts/${post.id}`)}`}
          className="w-fit rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          {tAnon("signInToExpressInterest")}
        </Link>
      ) : null}
    </main>
  );
}
