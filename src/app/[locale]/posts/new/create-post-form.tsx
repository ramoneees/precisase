"use client";

import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { colors } from "@/lib/design-tokens";
import type { CategoryLite } from "@/server/categories";
import type {
  ContactMethodValue,
  PostTypeValue,
} from "@/server/services/post-service";
import { createPostAction, type CreatePostErrorCode } from "./actions";

/** Design spec cap: "support up to ~4 photos" — see route.tsx doc comment. */
const MAX_PHOTOS = 4;

const TYPE_VALUES: PostTypeValue[] = ["request", "offer"];
const CONTACT_METHOD_VALUES: ContactMethodValue[] = ["whatsapp", "phone", "email"];

type UploadErrorCode = "uploadInvalidType" | "uploadTooLarge" | "uploadGeneric";

interface UploadErrorBody {
  error?: string;
}

function mapUploadError(body: UploadErrorBody): UploadErrorCode {
  if (body.error === "invalid_file_type") return "uploadInvalidType";
  if (body.error === "file_too_large") return "uploadTooLarge";
  return "uploadGeneric";
}

/**
 * Create-post form (design spec: type/category segmented toggles, photo
 * dropzone, title/description, contact method+value, custom consent
 * checkbox, submit disabled until required fields are filled). Client-side
 * checks short-circuit before calling the `createPostAction` Server Action
 * for a snappier UX — the action re-validates everything server-side (see
 * actions.ts), so this is a convenience layer, not the source of truth.
 */
export function CreatePostForm({
  categories,
}: {
  categories: CategoryLite[];
}) {
  const t = useTranslations("post.createForm");
  const tCategory = useTranslations("category");
  const tContactMethod = useTranslations("post.detail.contactMethodLabel");
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [type, setType] = useState<PostTypeValue>("request");
  const [categorySlug, setCategorySlug] = useState<string>(
    categories[0]?.slug ?? "volunteering",
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadErrorCode | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethodValue>("whatsapp");
  const [contactValue, setContactValue] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<CreatePostErrorCode | null>(null);

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    contactValue.trim().length > 0 &&
    consent &&
    !isPending &&
    !isUploading;

  async function handleFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) {
      return;
    }

    const room = MAX_PHOTOS - photos.length;
    const toUpload = selected.slice(0, room);
    if (toUpload.length === 0) {
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      toUpload.forEach((file) => formData.append("file", file));

      const response = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as UploadErrorBody;
        setUploadError(mapUploadError(body));
        return;
      }

      const body = (await response.json()) as { urls: string[] };
      setPhotos((prev) => [...prev, ...body.urls].slice(0, MAX_PHOTOS));
    } catch {
      setUploadError("uploadGeneric");
    } finally {
      setIsUploading(false);
    }
  }

  function removePhoto(url: string) {
    setPhotos((prev) => prev.filter((photo) => photo !== url));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!canSubmit) {
      return;
    }

    startTransition(async () => {
      const result = await createPostAction({
        type,
        categorySlug,
        title,
        description,
        contactMethod,
        contactValue,
        consent,
        photos,
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
        <div
          className="grid grid-cols-2 gap-2"
          role="group"
          aria-label={t("categoryLabel")}
        >
          {categories.map((category) => {
            const selected = categorySlug === category.slug;
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategorySlug(category.slug)}
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

      <div className="flex flex-col gap-2">
        <label htmlFor="post-photos" className="text-sm font-medium text-[#232922]">
          {t("photoLabel")}
        </label>
        <p className="text-xs text-[#9AA098]">{t("photoHint", { max: MAX_PHOTOS })}</p>

        <div className="flex flex-wrap gap-3">
          {photos.map((url) => (
            <div
              key={url}
              className="relative h-[80px] w-[80px] shrink-0 overflow-hidden rounded-xl border border-[#E3DED2]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- freshly-uploaded local file, not a static Next.js asset */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                aria-label={t("photoRemove")}
                className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-[#232922]"
              >
                ×
              </button>
            </div>
          ))}

          {photos.length < MAX_PHOTOS ? (
            <label
              htmlFor="post-photos"
              className="flex h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[#E3DED2] bg-white text-center text-sm text-[#9AA098] hover:border-[#2F6B4F]"
            >
              <span>{isUploading ? t("photoUploading") : t("photoLabel")}</span>
              <input
                id="post-photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={isUploading}
                onChange={handleFilesSelected}
                className="sr-only"
              />
            </label>
          ) : null}
        </div>

        {uploadError ? (
          <p role="alert" className="text-sm text-[#B23B23]">
            {t(`errors.${uploadError}`)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="post-title" className="text-sm font-medium text-[#232922]">
          {t("titleLabel")}
        </label>
        <input
          id="post-title"
          name="title"
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("titlePlaceholder")}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="post-description" className="text-sm font-medium text-[#232922]">
          {t("descriptionLabel")}
        </label>
        <textarea
          id="post-description"
          name="description"
          rows={5}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="post-contact-method"
            className="text-sm font-medium text-[#232922]"
          >
            {t("contactMethodLabel")}
          </label>
          <select
            id="post-contact-method"
            name="contactMethod"
            value={contactMethod}
            onChange={(event) =>
              setContactMethod(event.target.value as ContactMethodValue)
            }
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
          <label
            htmlFor="post-contact-value"
            className="text-sm font-medium text-[#232922]"
          >
            {t("contactValueLabel")}
          </label>
          <input
            id="post-contact-value"
            name="contactValue"
            type="text"
            required
            value={contactValue}
            onChange={(event) => setContactValue(event.target.value)}
            placeholder={t("contactValuePlaceholder")}
            className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
          />
        </div>
      </div>

      <label htmlFor="post-consent" className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          id="post-consent"
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition"
          style={{
            backgroundColor: consent ? colors.primary : "#FFFFFF",
            borderColor: consent ? colors.primary : colors.border,
          }}
        >
          {consent ? (
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 8.5 6.5 12 13 4" />
            </svg>
          ) : null}
        </span>
        <span className="text-[#232922]">{t("consentLabel")}</span>
      </label>

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
