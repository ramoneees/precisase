"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { colors } from "@/lib/design-tokens";
import type { CategoryLite } from "@/server/categories";
import type { ContactMethodValue, PostTypeValue } from "@/server/services/post-service";
import { editActivePostAction, type EditActivePostErrorCode } from "./edit-active-post-action";
import { resubmitPostAction, type ResubmitPostErrorCode } from "./actions";

const TYPE_VALUES: PostTypeValue[] = ["request", "offer"];
const CONTACT_METHOD_VALUES: ContactMethodValue[] = ["whatsapp", "phone", "email"];

export type EditPostFormMode = "active" | "rejected";

export type EditPostErrorCode = ResubmitPostErrorCode | EditActivePostErrorCode;

export interface EditPostFormInitial {
  type: PostTypeValue;
  categoryId: string;
  title: string;
  description: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
  extraAttributes?: Record<string, unknown>;
}

const PHONE_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "PT", label: "Portugal (+351)" },
  { code: "BR", label: "Brasil (+55)" },
  { code: "US", label: "United States (+1)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "ES", label: "España (+34)" },
];

/**
 * Edit-post form (FR03) — covers both the "edit an active post" and the
 * "edit a rejected post and resubmit it for moderation" flows. The same
 * fields are edited either way; the `mode` prop decides which Server
 * Action the submit handler calls and which catalog strings the form
 * renders (heading, button label, success toast).
 */
export function EditPostForm({
  categories,
  postId,
  mode,
  rejectedReason,
  initial,
  phoneCountry,
}: {
  categories: CategoryLite[];
  postId: string;
  mode: EditPostFormMode;
  rejectedReason: string | null;
  initial: EditPostFormInitial;
  phoneCountry: string;
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
  const [country, setCountry] = useState(phoneCountry);
  const [error, setError] = useState<EditPostErrorCode | null>(null);

  // Job-specific fields
  const [employmentType, setEmploymentType] = useState<string>(
    (initial.extraAttributes?.employmentType as string) || ""
  );
  const [salaryRange, setSalaryRange] = useState<string>(
    (initial.extraAttributes?.salaryRange as string) || ""
  );
  const [jobLocation, setJobLocation] = useState<string>(
    (initial.extraAttributes?.location as string) || ""
  );

  const isPhoneLike =
    contactMethod === "phone" || contactMethod === "whatsapp";

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
      // Build extraAttributes for job-specific fields
      const extraAttributes: Record<string, unknown> = {};
      if (categoryId === "jobs") {
        if (employmentType) extraAttributes.employmentType = employmentType;
        if (salaryRange.trim()) extraAttributes.salaryRange = salaryRange.trim();
        if (jobLocation.trim()) extraAttributes.location = jobLocation.trim();
      }

      const payload = {
        postId,
        type,
        categoryId,
        title,
        description,
        contactMethod,
        contactValue,
        phoneCountry: country,
        extraAttributes,
      };
      const activePayload = {
        postId,
        title,
        description,
        contactMethod,
        contactValue,
        phoneCountry: country,
      };

      const result =
        mode === "active"
          ? await editActivePostAction(activePayload)
          : await resubmitPostAction(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      showToast(t(mode === "active" ? "activeToastSuccess" : "toastSuccess"));
      router.push("/my-posts");
    });
  }

  const submitLabel = t(mode === "active" ? "activeSubmit" : "submit");
  const submittingLabel = t(
    mode === "active" ? "activeSubmitting" : "submitting",
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {mode === "rejected" && rejectedReason ? (
        <div className="rounded-2xl bg-[#F7E4DE] px-4 py-3 text-sm text-[#B23B23]">
          <p className="font-semibold">{t("rejectedReasonLabel")}</p>
          <p>{rejectedReason}</p>
        </div>
      ) : null}

      {mode === "rejected" ? (
        <>
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
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${mode}-title`} className="text-sm font-medium text-[#232922]">
          {t("titleLabel")}
        </label>
        <input
          id={`${mode}-title`}
          name="title"
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${mode}-description`} className="text-sm font-medium text-[#232922]">
          {t("descriptionLabel")}
        </label>
        <textarea
          id={`${mode}-description`}
          name="description"
          rows={5}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      {categoryId === "jobs" && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${mode}-employment-type`} className="text-sm font-medium text-[#232922]">
              {t("employmentType")}
            </label>
            <select
              id={`${mode}-employment-type`}
              name="employmentType"
              value={employmentType}
              onChange={(event) => setEmploymentType(event.target.value)}
              className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
            >
              <option value="">{t("employmentTypeSelect")}</option>
              <option value="full-time">{t("employmentTypeFullTime")}</option>
              <option value="part-time">{t("employmentTypePartTime")}</option>
              <option value="contract">{t("employmentTypeContract")}</option>
              <option value="internship">{t("employmentTypeInternship")}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${mode}-salary-range`} className="text-sm font-medium text-[#232922]">
              {t("salaryRange")}
            </label>
            <input
              id={`${mode}-salary-range`}
              name="salaryRange"
              type="text"
              value={salaryRange}
              onChange={(event) => setSalaryRange(event.target.value)}
              placeholder={t("salaryRangePlaceholder")}
              className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${mode}-job-location`} className="text-sm font-medium text-[#232922]">
              {t("jobLocation")}
            </label>
            <input
              id={`${mode}-job-location`}
              name="jobLocation"
              type="text"
              value={jobLocation}
              onChange={(event) => setJobLocation(event.target.value)}
              placeholder={t("jobLocationPlaceholder")}
              className="rounded-xl border border-[#E3DED2] bg-white px-4 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        <label
          htmlFor={`${mode}-contact-method`}
          className="text-sm font-medium text-[#232922]"
        >
          {t("contactMethodLabel")}
        </label>
        <select
          id={`${mode}-contact-method`}
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

      {isPhoneLike ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${mode}-phone-country`} className="text-sm font-medium text-[#232922]">
            {t("phoneCountryLabel")}
          </label>
          <div className="flex gap-2">
            <select
              id={`${mode}-phone-country`}
              name="phoneCountry"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              aria-label={t("phoneCountryLabel")}
              className="rounded-xl border border-[#E3DED2] bg-white px-3 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
            >
              {PHONE_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              id={`${mode}-contact-value`}
              name="contactValue"
              type="tel"
              required
              value={contactValue}
              onChange={(event) => setContactValue(event.target.value)}
              placeholder="912 345 678"
              className="flex-1 rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`${mode}-contact-value`}
            className="text-sm font-medium text-[#232922]"
          >
            {t("contactValueLabel")}
          </label>
          <input
            id={`${mode}-contact-value`}
            name="contactValue"
            type={contactMethod === "email" ? "email" : "tel"}
            required
            value={contactValue}
            onChange={(event) => setContactValue(event.target.value)}
            className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
          />
        </div>
      )}

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
        {isPending ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
