"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { signup, type SignupErrorCode } from "./actions";

/**
 * Sign-up form (docs/ARCHITECTURE.md §7.5, BR06 — docs/MVP.md). Copy comes
 * entirely from the `auth.signUp` namespace — no hardcoded user-facing
 * strings (§4.6/§10 hard rule).
 *
 * Client-side checks (password match, consent checkbox) short-circuit
 * before calling the `signup` Server Action, for a snappier UX — but the
 * action re-validates everything server-side (see actions.ts), so this is
 * a convenience layer, not the source of truth.
 */
export function SignupForm({ locale }: { locale: string }) {
  const t = useTranslations("auth.signUp");
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<SignupErrorCode | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (!password || password !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }

    if (!consent) {
      setError("consentRequired");
      return;
    }

    startTransition(async () => {
      const result = await signup({
        displayName,
        email,
        password,
        confirmPassword,
        consent,
        locale,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess(true);
      router.push("/signin");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-display-name" className="text-sm font-medium text-[#232922]">
          {t("displayNameLabel")}
        </label>
        <input
          id="signup-display-name"
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
        <label htmlFor="signup-email" className="text-sm font-medium text-[#232922]">
          {t("emailLabel")}
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-password" className="text-sm font-medium text-[#232922]">
          {t("passwordLabel")}
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-confirm-password" className="text-sm font-medium text-[#232922]">
          {t("confirmPasswordLabel")}
        </label>
        <input
          id="signup-confirm-password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <label htmlFor="signup-consent" className="flex items-start gap-2 text-sm text-[#232922]">
        <input
          id="signup-consent"
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 accent-[#2F6B4F]"
        />
        <span>{t("consentLabel")}</span>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${error}`)}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="text-sm text-[#2F6B4F]">
          {t("success")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 w-full rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {isPending ? t("submitting") : t("submit")}
      </button>

      <p className="text-center text-sm text-[#6B7268]">
        {t("haveAccount")}{" "}
        <Link href="/signin" className="font-medium text-[#2F6B4F] underline">
          {t("signInLink")}
        </Link>
      </p>
    </form>
  );
}
