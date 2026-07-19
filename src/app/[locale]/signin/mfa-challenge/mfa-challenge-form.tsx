"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { signin } from "../actions";

type ChallengeErrorCode = "invalidCredentials" | "generic";

/**
 * MFA challenge form. Copy comes entirely from the `auth.mfa.challenge`
 * namespace — no hardcoded user-facing strings (docs/ARCHITECTURE.md
 * §4.6/§10 hard rule).
 *
 * Stateless second call (T16): the password is NOT carried over from step 1
 * (there's no server-side pending session), so the user re-enters it here
 * alongside the TOTP code. On success the `signin` action itself calls
 * `redirect()`, so there's nothing to do client-side beyond awaiting it.
 */
export function MfaChallengeForm({
  email,
  callbackUrl,
}: {
  email: string;
  callbackUrl: string;
}) {
  const t = useTranslations("auth.mfa.challenge");

  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<ChallengeErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signin({
        email,
        password,
        mfaToken: code,
        callbackUrl,
      });
      if (result.ok) {
        return;
      }
      // `mfaRequired` shouldn't happen on the second call (a token is always
      // sent), but if it does, stay here and surface a generic error rather
      // than bouncing into a redirect loop.
      if ("mfaRequired" in result) {
        setError("generic");
        return;
      }
      setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mfa-email" className="text-sm font-medium text-[#232922]">
          {t("emailLabel")}
        </label>
        <input
          id="mfa-email"
          type="email"
          value={email}
          readOnly
          className="rounded-xl border border-[#E3DED2] bg-[#F5F2EA] px-3.5 py-2.5 text-sm text-[#6B7268]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mfa-password" className="text-sm font-medium text-[#232922]">
          {t("passwordLabel")}
        </label>
        <input
          id="mfa-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mfa-code" className="text-sm font-medium text-[#232922]">
          {t("codeLabel")}
        </label>
        <input
          id="mfa-code"
          name="mfaToken"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm tracking-[0.3em] text-[#232922] focus:border-[#2F6B4F] focus:outline-none"
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
