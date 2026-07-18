"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { expressInterestAction, type ExpressInterestErrorCode } from "./actions";

/**
 * Client island for FR09 ("Manifestar interesse"). On success: shows the
 * global toast and refreshes the route so the Server Component re-fetches
 * `getPost`/the interest row and swaps this button out for the contact
 * reveal panel (see `page.tsx`) — no local "reveal" state is kept here on
 * purpose, so the server stays the single source of truth for whether the
 * viewer has already expressed interest.
 */
export function ExpressInterestButton({
  postId,
  locale,
}: {
  postId: string;
  locale: string;
}) {
  const t = useTranslations("post.detail");
  const { showToast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<ExpressInterestErrorCode | null>(null);

  function handleClick() {
    setErrorCode(null);
    startTransition(async () => {
      const result = await expressInterestAction(postId, locale);
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      showToast(t("toastInterestRegistered"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="w-fit rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? t("expressingInterest") : t("expressInterest")}
      </button>
      {errorCode ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${errorCode}`)}
        </p>
      ) : null}
    </div>
  );
}
