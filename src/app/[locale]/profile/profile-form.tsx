"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast-provider";
import { updateProfileAction, type UpdateProfileErrorCode } from "./actions";
import {
  PROFILE_COUNTRY_OPTIONS,
  defaultTimeZoneFor,
  timeZoneOptionsForCountry,
} from "@/lib/region-defaults";

export interface ProfileFormData {
  email: string;
  displayName: string;
  phoneE164: string | null;
  /** ISO 3166-1 alpha-2 — used as the parsing hint for `phoneE164`. */
  phoneCountry: string | null;
  churchAffiliation: string | null;
  /** ISO 3166-1 alpha-2 — drives the time-zone option list. */
  country: string | null;
  /** IANA zone — must be valid for the chosen country. */
  timeZone: string | null;
  role: "user" | "moderator" | "admin";
  uiLocale: string;
}

/**
 * Profile form (FR13). Copy comes entirely from the `profile` namespace —
 * no hardcoded user-facing strings (docs/ARCHITECTURE.md §4.6/§10 hard
 * rule). Editable: displayName, phoneE164, churchAffiliation, country,
 * timeZone. Read-only: email (login identifier — see actions.ts doc
 * comment for why it isn't editable here), role, locale.
 */
export function ProfileForm({
  profile,
  locale,
}: {
  profile: ProfileFormData;
  locale: string;
}) {
  const t = useTranslations("profile");
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [displayName, setDisplayName] = useState(profile.displayName);
  const [phoneCountry, setPhoneCountry] = useState(profile.phoneCountry ?? "PT");
  const [phoneE164, setPhoneE164] = useState(profile.phoneE164 ?? "");
  const [churchAffiliation, setChurchAffiliation] = useState(
    profile.churchAffiliation ?? "",
  );
  const [country, setCountry] = useState(profile.country ?? "PT");
  const [timeZone, setTimeZone] = useState(
    profile.timeZone ?? defaultTimeZoneFor(profile.country) ?? "Europe/Lisbon",
  );
  const [error, setError] = useState<UpdateProfileErrorCode | null>(null);

  function handleCountryChange(nextCountry: string) {
    setCountry(nextCountry);
    // Reset the time zone to the new country's default so the two fields
    // never disagree (validated server-side in updateProfileAction).
    const nextDefault = defaultTimeZoneFor(nextCountry);
    if (nextDefault) {
      setTimeZone(nextDefault);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError("invalidInput");
      return;
    }

    startTransition(async () => {
      const result = await updateProfileAction({
        displayName,
        phoneCountry,
        phoneE164,
        churchAffiliation,
        country,
        timeZone,
        locale,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      showToast(t("toastSaved"));
    });
  }

  const PHONE_COUNTRIES: Array<{ code: string; label: string }> = [
  { code: "PT", label: "Portugal (+351)" },
  { code: "BR", label: "Brasil (+55)" },
  { code: "US", label: "United States (+1)" },
  { code: "GB", label: "United Kingdom (+44)" },
  { code: "ES", label: "España (+34)" },
];

  const timeZoneOptions = timeZoneOptionsForCountry(country);

return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-[#E3DED2] bg-white p-6"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#232922]">{t("emailLabel")}</span>
          <p className="rounded-xl border border-[#E3DED2] bg-[#F7F4EE] px-3.5 py-2.5 text-sm text-[#6B7268]">
            {profile.email}
          </p>
          <p className="text-xs text-[#9AA098]">{t("emailImmutableHint")}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#232922]">{t("roleLabel")}</span>
          <p className="rounded-xl border border-[#E3DED2] bg-[#F7F4EE] px-3.5 py-2.5 text-sm text-[#6B7268]">
            {t(`roleValues.${profile.role}`)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[#232922]">{t("localeLabel")}</span>
        <p className="rounded-xl border border-[#E3DED2] bg-[#F7F4EE] px-3.5 py-2.5 text-sm text-[#6B7268]">
          {profile.uiLocale}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-display-name" className="text-sm font-medium text-[#232922]">
          {t("displayNameLabel")}
        </label>
        <input
          id="profile-display-name"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-phone" className="text-sm font-medium text-[#232922]">
          {t("phoneLabel")}
        </label>
        <div className="flex gap-2">
          <select
            id="profile-phone-country"
            name="phoneCountry"
            value={phoneCountry}
            onChange={(event) => setPhoneCountry(event.target.value)}
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
            id="profile-phone"
            name="phoneE164"
            type="tel"
            autoComplete="tel"
            value={phoneE164}
            onChange={(event) => setPhoneE164(event.target.value)}
            placeholder={t("phonePlaceholder")}
            className="flex-1 rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="profile-church-affiliation"
          className="text-sm font-medium text-[#232922]"
        >
          {t("churchAffiliationLabel")}
        </label>
        <input
          id="profile-church-affiliation"
          name="churchAffiliation"
          type="text"
          value={churchAffiliation}
          onChange={(event) => setChurchAffiliation(event.target.value)}
          placeholder={t("churchAffiliationPlaceholder")}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] placeholder:text-[#9AA098] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-country" className="text-sm font-medium text-[#232922]">
            {t("countryLabel")}
          </label>
          <select
            id="profile-country"
            name="country"
            value={country}
            onChange={(event) => handleCountryChange(event.target.value)}
            className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
          >
            {PROFILE_COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-time-zone" className="text-sm font-medium text-[#232922]">
            {t("timeZoneLabel")}
          </label>
          <select
            id="profile-time-zone"
            name="timeZone"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
          >
            {timeZoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 w-fit rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
