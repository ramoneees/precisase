"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { requestResetAction, type RequestResetErrorCode } from "./actions";

/**
 * Forgot-password form. Copy comes entirely from the `auth.forgotPassword`
 * namespace — no hardcoded user-facing strings (docs/ARCHITECTURE.md
 * §4.6/§10 hard rule).
 *
 * On success, swaps the form for an inline confirmation message rather than
 * navigating away — there's nothing to navigate to (the reset link itself
 * arrives by email), and staying on the page keeps the anti-enumeration UI
 * identical regardless of whether the email matched a user.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");

  const [email, setEmail] = useState("");
  const [error, setError] = useState<RequestResetErrorCode | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await requestResetAction({ email });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  }

  if (success) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm text-[#2F6B4F]">
          {t("successMessage")}
        </p>
        <Link
          href="/signin"
          className="text-center text-sm font-medium text-[#2F6B4F] underline"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="forgot-password-email" className="text-sm font-medium text-[#232922]">
          {t("emailLabel")}
        </label>
        <input
          id="forgot-password-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${error}`)}
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
        <Link href="/signin" className="font-medium text-[#2F6B4F] underline">
          {t("backToSignIn")}
        </Link>
      </p>
    </form>
  );
}
