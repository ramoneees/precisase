"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { resetPasswordAction, type ResetPasswordErrorCode } from "./actions";

type FormErrorCode = ResetPasswordErrorCode | "passwordMismatch";

/**
 * Reset-password form. Copy comes entirely from the `auth.resetPassword`
 * namespace — no hardcoded user-facing strings (docs/ARCHITECTURE.md
 * §4.6/§10 hard rule).
 *
 * The password-match check runs client-side before the server action is
 * even called (same short-circuit pattern signup-form.tsx uses) — the
 * server action re-validates password strength independently, but "do the
 * two fields match" is a pure client-side UX check with no server-side
 * equivalent (the server never sees a confirmation field).
 */
export function ResetPasswordForm({ token }: { token?: string }) {
  const t = useTranslations("auth.resetPassword");
  const router = useRouter();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<FormErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!newPassword || newPassword !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }

    startTransition(async () => {
      const result = await resetPasswordAction({ token: token ?? "", newPassword });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/signin?reset=success");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password-new" className="text-sm font-medium text-[#232922]">
          {t("newPasswordLabel")}
        </label>
        <input
          id="reset-password-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password-confirm" className="text-sm font-medium text-[#232922]">
          {t("confirmPasswordLabel")}
        </label>
        <input
          id="reset-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
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
    </form>
  );
}
