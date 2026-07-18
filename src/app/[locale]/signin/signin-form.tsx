"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { signin, type SigninErrorCode } from "./actions";

/**
 * Sign-in form. Copy comes entirely from the `auth.signIn` namespace — no
 * hardcoded user-facing strings (docs/ARCHITECTURE.md §4.6/§10 hard rule).
 */
export function SigninForm({ locale }: { locale: string }) {
  const t = useTranslations("auth.signIn");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<SigninErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signin({ email, password, locale });
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex w-full flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signin-email" className="text-sm font-medium text-[#232922]">
          {t("emailLabel")}
        </label>
        <input
          id="signin-email"
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
        <label htmlFor="signin-password" className="text-sm font-medium text-[#232922]">
          {t("passwordLabel")}
        </label>
        <input
          id="signin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
        {t("noAccount")}{" "}
        <Link href="/signup" className="font-medium text-[#2F6B4F] underline">
          {t("signUpLink")}
        </Link>
      </p>
    </form>
  );
}
