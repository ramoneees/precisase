"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { TypeBadge, StatusBadge } from "@/components/posts/badges";
import type { PostStatusValue, PostTypeValue } from "@/server/services/post-service";
import { closeMyPostAction, reopenMyPostAction } from "./actions";

export interface MyPostRowData {
  id: string;
  type: PostTypeValue;
  status: PostStatusValue;
  title: string;
  photoUrl: string;
  interestCount: number;
  /** Only meaningful when `status === "rejected"` (FR03) — shown to the author so they know what to fix. */
  rejectedReason: string | null;
}

/**
 * A single row in the "my posts" list — thumbnail, badges, title, interest
 * count, and status-dependent action buttons (design spec). Client
 * Component so the close/reopen buttons can call their Server Actions via
 * `useTransition` and surface a toast, the same pattern as
 * `ExpressInterestButton` (posts/[id]/express-interest-button.tsx).
 */
export function MyPostRow({ post, locale }: { post: MyPostRowData; locale: string }) {
  const t = useTranslations("myPosts");
  const { showToast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setError(null);
    startTransition(async () => {
      const result = await closeMyPostAction(post.id, locale);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as "errors.generic"));
        return;
      }
      showToast(t("toastClosed"));
      router.refresh();
    });
  }

  function handleReopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenMyPostAction(post.id, locale);
      if (!result.ok) {
        setError(t(`errors.${result.error}` as "errors.generic"));
        return;
      }
      showToast(t("toastReopened"));
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-[#E3DED2] bg-white p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[#F7F4EE]">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded/placeholder photo URL, not a static Next.js asset */}
        <img src={post.photoUrl} alt="" className="h-full w-full object-cover" />
      </div>

      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={post.type} />
          <StatusBadge status={post.status} />
        </div>
        <p className="font-heading text-base font-extrabold text-[#232922]">{post.title}</p>
        <p className="text-xs text-[#9AA098]">{t("interestCount", { count: post.interestCount })}</p>
        {post.status === "rejected" && post.rejectedReason ? (
          <p className="rounded-lg bg-[#F7E4DE] px-3 py-2 text-xs text-[#B23B23]">
            <span className="font-semibold">{t("rejectedReasonLabel")}</span> {post.rejectedReason}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-[#B23B23]">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {post.status === "active" ? (
          <button
            type="button"
            onClick={handleClose}
            disabled={isPending}
            className="rounded-full bg-[#2F6B4F] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {t("actions.markResolved")}
          </button>
        ) : null}
        {post.status === "closed" ? (
          <button
            type="button"
            onClick={handleReopen}
            disabled={isPending}
            className="rounded-full border border-[#E3DED2] bg-white px-4 py-2 text-sm font-medium text-[#232922] disabled:opacity-60"
          >
            {t("actions.reopen")}
          </button>
        ) : null}
        {post.status === "rejected" ? (
          <Link
            href={`/my-posts/${post.id}/edit`}
            className="rounded-full bg-[#2F6B4F] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t("actions.editAndResubmit")}
          </Link>
        ) : null}
        {post.status === "active" ? (
          <Link
            href={`/my-posts/${post.id}/edit`}
            className="rounded-full border border-[#2F6B4F] px-4 py-2 text-sm font-medium text-[#2F6B4F] hover:bg-[#2F6B4F] hover:text-white"
          >
            {t("actions.edit")}
          </Link>
        ) : null}
        <Link
          href={`/posts/${post.id}`}
          className="rounded-full border border-[#E3DED2] bg-white px-4 py-2 text-sm font-medium text-[#232922] hover:border-[#2F6B4F] hover:text-[#2F6B4F]"
        >
          {t("actions.view")}
        </Link>
      </div>
    </li>
  );
}
