"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { colors } from "@/lib/design-tokens";
import type { CategoryLite } from "@/server/categories";
import type { ContactMethodValue, PostTypeValue } from "@/server/services/post-service";
import { resubmitPostAction, type ResubmitPostErrorCode } from "./actions";

const TYPE_VALUES: PostTypeValue[] = ["request", "offer"];
const CONTACT_METHOD_VALUES: ContactMethodValue[] = ["whatsapp", "phone", "email"];

export interface ResubmitPostFormInitial {
  type: PostTypeValue;
  categoryId: string;
  title: string;
  description: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
}

/**
 * Rejected-post "edit and resubmit" form (FR03). A purpose-built, smaller
 * sibling of `posts/new/create-post-form.tsx` — resubmission only needs
 * type/category/title/description/contact (no photo dropzone, no consent
 * checkbox, since those were already captured at creation) — reusing that
 * component directly would drag in unrelated fields and its own upload
 * state, so a dedicated component is cleaner here. Same styling
 * conventions (`colors` tokens, the segmented-toggle pattern) for visual
 * consistency.
 */
export function ResubmitPostForm({
  categories,
  postId,
  rejectedReason,
  initial,
}: {
  categories: CategoryLite[];
  postId: string;
  rejectedReason: string | null;
  initial: ResubmitPostFormInitial;
}) {
  const t = useTranslations("myPosts.edit");
  const tCategory = useTranslations("category");
  const tContactMethod = useTranslations("post.detail.contactMethodLabel");
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<PostTypeValue>(initial.type);
  const [categoryId, setCategoryId] = useState<string>(initial.categoryId);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [contactMethod, setContactMethod] = useState<ContactMethodValue>(
    initial.contactMethod,
  );
  const [contactValue, setContactValue] = useState(initial.contactValue);
  const [error, setError] = useState<ResubmitPostErrorCode | null>(null);

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    contactValue.trim().length > 0 &&
    !isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      const result = await resubmitPostAction({
        postId,
        type,
        categoryId,
        title,
        description,
        contactMethod,
        contactValue,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      showToast(t("toastSuccess"));
      router.push("/my-posts");
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {rejectedReason ? (
        <div className="rounded-2xl bg-[#F7E4DE] px-4 py-3 text-sm text-[#B23B23]">
          <p className="font-semibold">{t("rejectedReasonLabel")}</p>
          <p>{rejectedReason}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[#232922]">{t("typeLabel")}</span>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("typeLabel")}>
          {TYPE_VALUES.map((value) => {
            const selected = type === value;
            const { fg, bg } = colors.type[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => setType(value)}
                className="rounded-xl border px-4 py-3 text-sm font-medium transition"
                style={
                  selected
                    ? { backgroundColor: bg, borderColor: fg, color: fg }
                    : {
                        backgroundColor: "#FFFFFF",
                        borderColor: colors.border,
                        color: colors.mutedText,
                      }
                }
              >
                {t(`typeOptions.${value}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[#232922]">{t("categoryLabel")}</span>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("categoryLabel")}>
          {categories.map((category) => {
            const selected = categoryId === category.id;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategoryId(category.id)}
                className="rounded-xl border px-4 py-3 text-sm font-medium transition"
                style={
                  selected
                    ? {
                        backgroundColor: colors.primaryTint,
                        borderColor: colors.primary,
                        color: colors.primary,
                      }
                    : {
                        backgroundColor: "#FFFFFF",
                        borderColor: colors.border,
                        color: colors.mutedText,
                      }
                }
              >
                {tCategory(category.slug)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="resubmit-title" className="text-sm font-medium text-[#232922]">
          {t("titleLabel")}
        </label>
        <input
          id="resubmit-title"
          name="title"
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="resubmit-description" className="text-sm font-medium text-[#232922]">
          {t("descriptionLabel")}
        </label>
        <textarea
          id="resubmit-description"
          name="description"
          rows={5}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="resubmit-contact-method" className="text-sm font-medium text-[#232922]">
            {t("contactMethodLabel")}
          </label>
          <select
            id="resubmit-contact-method"
            name="contactMethod"
            value={contactMethod}
            onChange={(event) => setContactMethod(event.target.value as ContactMethodValue)}
            className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
          >
            {CONTACT_METHOD_VALUES.map((value) => (
              <option key={value} value={value}>
                {tContactMethod(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="resubmit-contact-value" className="text-sm font-medium text-[#232922]">
            {t("contactValueLabel")}
          </label>
          <input
            id="resubmit-contact-value"
            name="contactValue"
            type="text"
            required
            value={contactValue}
            onChange={(event) => setContactValue(event.target.value)}
            className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-fit rounded-full px-6 py-3 text-sm font-medium text-white transition disabled:cursor-not-allowed"
        style={{
          backgroundColor: canSubmit ? colors.primary : colors.mutedTextLight,
        }}
      >
        {isPending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
