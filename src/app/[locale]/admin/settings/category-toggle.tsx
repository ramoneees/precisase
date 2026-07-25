"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { toggleCategoryAction } from "./actions";

interface CategoryToggleProps {
  slug: string;
  label: string;
  isActive: boolean;
}

export function CategoryToggle({ slug, label, isActive }: CategoryToggleProps) {
  const t = useTranslations("admin.settings");
  const [state, formAction, isPending] = useActionState(
    async () => toggleCategoryAction(slug, !isActive),
    null,
  );

  return (
    <form action={formAction}>
      <div className="flex items-center justify-between rounded-xl border border-[#E3DED2] bg-white px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[#232922]">{label}</span>
          <span className="text-xs text-[#6B7268]">
            {isActive ? t("categoryEnabled") : t("categoryDisabled")}
          </span>
        </div>
        <button
          type="submit"
          disabled={isPending}
          role="switch"
          aria-checked={isActive}
          aria-label={`Toggle ${label}`}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#2F6B4F] focus:ring-offset-2 disabled:opacity-50 ${
            isActive ? "bg-[#2F6B4F]" : "bg-[#D1D5DB]"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${
              isActive ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {state && !state.ok && (
        <p className="mt-1 text-xs text-red-600">
          {t(`error${state.error.charAt(0).toUpperCase() + state.error.slice(1)}`)}
        </p>
      )}
    </form>
  );
}
