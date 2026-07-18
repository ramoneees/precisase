"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { TypeBadge, CategoryBadge } from "@/components/posts/badges";
import { colors } from "@/lib/design-tokens";
import { formatDateTime } from "@/lib/format";
import { defaultTimeZoneForUiLocale } from "@/lib/region-defaults";
import { approvePostAction, rejectPostAction } from "./actions";
import type { PostTypeValue } from "@/server/services/post-service";

export interface ModerationQueueItem {
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

/**
 * A single pending-post row in the moderation queue (FR15). "Rejeitar"
 * doesn't fire immediately — it reveals an inline reason textarea (the
 * business rule in `PostService.rejectPost` requires a non-empty reason),
 * with its own "Confirmar rejeição"/"Cancelar" pair, rather than a native
 * `prompt()` dialog.
 */
export function ModerationCard({
  post,
  locale,
}: {
  post: ModerationQueueItem;
  locale: string;
}) {
  const t = useTranslations("moderation");
  const { showToast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [reason, setReason] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const formattedDate = formatDateTime(post.createdAt, {
    locale,
    timeZone: defaultTimeZoneForUiLocale(locale),
  });

  const canConfirmReject = reason.trim().length > 0;

  function handleApprove() {
    setErrorCode(null);
    startTransition(async () => {
      const result = await approvePostAction(post.id, locale);
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      showToast(t("toastApproved"));
      router.refresh();
    });
  }

  function handleConfirmReject() {
    if (!canConfirmReject) {
      return;
    }
    setErrorCode(null);
    startTransition(async () => {
      const result = await rejectPostAction(post.id, reason, locale);
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      showToast(t("toastRejected"));
      router.refresh();
    });
  }

  function handleCancelReject() {
    setShowReasonInput(false);
    setReason("");
    setErrorCode(null);
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#E3DED2] bg-white p-5 sm:flex-row">
      <div className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl bg-[#F7F4EE]">
        {/* eslint-disable-next-line @next/next/no-img-element -- external/uploaded/placeholder photo URL, not a static Next.js asset */}
        <img src={post.photoUrl} alt="" className="h-full w-full object-cover" />
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <TypeBadge type={post.type} />
          <CategoryBadge categoryKey={post.categoryKey} />
        </div>
        <h3 className="font-heading text-lg font-extrabold text-[#232922]">{post.title}</h3>
        <p className="text-sm whitespace-pre-line text-[#232922]">{post.description}</p>
        <p className="text-xs text-[#9AA098]">
          {t("byline", { author: post.authorName, date: formattedDate })}
        </p>

        {errorCode ? (
          <p role="alert" className="text-sm text-[#B23B23]">
            {t(`errors.${errorCode}`)}
          </p>
        ) : null}

        {showReasonInput ? (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E3DED2] bg-[#F7F4EE] p-3">
            <label
              htmlFor={`reject-reason-${post.id}`}
              className="text-sm font-medium text-[#232922]"
            >
              {t("reasonLabel")}
            </label>
            <textarea
              id={`reject-reason-${post.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder={t("reasonPlaceholder")}
              className="rounded-md border border-[#E3DED2] bg-white px-3 py-2 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isPending || !canConfirmReject}
                className="rounded-full px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: colors.status.rejected.fg }}
              >
                {isPending ? t("rejecting") : t("confirmReject")}
              </button>
              <button
                type="button"
                onClick={handleCancelReject}
                disabled={isPending}
                className="rounded-full border border-[#E3DED2] bg-white px-4 py-2 text-sm font-medium text-[#6B7268] hover:bg-[#F7F4EE] disabled:opacity-50"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleApprove}
              disabled={isPending}
              className="rounded-full bg-[#2F6B4F] px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {t("approve")}
            </button>
            <button
              type="button"
              onClick={() => setShowReasonInput(true)}
              disabled={isPending}
              className="rounded-full border bg-white px-5 py-2 text-sm font-medium disabled:opacity-60"
              style={{
                borderColor: colors.status.rejected.fg,
                color: colors.status.rejected.fg,
              }}
            >
              {t("reject")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
