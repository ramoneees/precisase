"use client";

import { useFormatter } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TypeBadge, CategoryBadge } from "./badges";
import type { PostTypeValue } from "@/server/services/post-service";

const DESCRIPTION_TRUNCATE_LENGTH = 110;

export interface PostCardData {
  id: string;
  type: PostTypeValue;
  categoryKey: string;
  title: string;
  description: string;
  authorName: string;
  createdAt: Date;
  /** Real photo URL or a `placeholderPhoto(...)` data URI — always set. */
  photoUrl: string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * Shop-window listing card (design spec: 140px photo area, type + category
 * badge row, Nunito 800 title, truncated ~110-char description, author +
 * date footer). Client Component so it can use `useTranslations`/`Link`
 * exactly like the rest of this codebase's tested components (see
 * `signup-form.tsx` / `signup-form.test.tsx`), which keeps it independently
 * unit-testable without a live Next.js server context.
 */
export function PostCard({ post }: { post: PostCardData }) {
  const format = useFormatter();

  return (
    <Link
      href={`/posts/${post.id}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-[#E3DED2] bg-white transition hover:shadow-md"
    >
      <div className="h-[140px] w-full overflow-hidden bg-[#F7F4EE]">
        {/* eslint-disable-next-line @next/next/no-img-element -- external/placeholder photo URLs, not a static Next.js asset */}
        <img
          src={post.photoUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap gap-2">
          <TypeBadge type={post.type} />
          <CategoryBadge categoryKey={post.categoryKey} />
        </div>
        <h3 className="font-heading text-lg font-extrabold text-[#232922]">
          {post.title}
        </h3>
        <p className="flex-1 text-sm text-[#6B7268]">
          {truncate(post.description, DESCRIPTION_TRUNCATE_LENGTH)}
        </p>
        <div className="flex items-center justify-between gap-2 pt-2 text-xs text-[#9AA098]">
          <span className="truncate">{post.authorName}</span>
          <span className="shrink-0">
            {format.dateTime(post.createdAt, {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
    </Link>
  );
}
