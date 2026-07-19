"use client";

import { useState, useTransition, type FormEvent } from "react";
import QRCode from "qrcode";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  disableAction,
  enableAction,
  enrollAction,
  type DisableResult,
  type EnableResult,
} from "./actions";

/**
 * MFA setup form (T17). Copy comes entirely from the `auth.mfa.setup`
 * namespace — no hardcoded user-facing strings (docs/ARCHITECTURE.md
 * §4.6/§10 hard rule).
 *
 * The QR code is rendered entirely client-side via the `qrcode` package
 * (`QRCode.toDataURL`), so the otpauth URL — which embeds the plaintext TOTP
 * secret — is NEVER sent to a third-party image API.
 */
export function MfaSetupForm({ isEnabled }: { isEnabled: boolean }) {
  const t = useTranslations("auth.mfa.setup");
  const router = useRouter();

  return isEnabled ? (
    <DisableSection t={t} router={router} />
  ) : (
    <EnrollSection t={t} router={router} />
  );
}

type Translate = ReturnType<typeof useTranslations>;
type Router = ReturnType<typeof useRouter>;

type EnrollError = Extract<EnableResult, { ok: false }>["error"] | "generic";

function EnrollSection({ t, router }: { t: Translate; router: Router }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<EnrollError | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEnroll() {
    setError(null);
    startTransition(async () => {
      const result = await enrollAction();
      if (!result.ok) {
        setError("generic");
        return;
      }
      setSecret(result.secret);
      const dataUrl = await QRCode.toDataURL(result.otpauthUrl);
      setQrDataUrl(dataUrl);
    });
  }

  function handleEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await enableAction({ token });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Refresh so the page re-renders in the "enabled" state. The JWT claim
      // stays stale until re-sign-in (see actions.ts note).
      router.refresh();
    });
  }

  if (!secret) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-[#E3DED2] bg-white p-6 shadow-sm">
        <button
          type="button"
          onClick={handleEnroll}
          disabled={isPending}
          className="w-full rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {t("enrollButton")}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-[#B23B23]">
            {t(`errors.${error}`)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#E3DED2] bg-white p-6 shadow-sm">
      <p className="text-sm text-[#232922]">{t("scanQrInstructions")}</p>

      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={t("scanQrInstructions")}
          width={200}
          height={200}
          className="mx-auto rounded-xl border border-[#E3DED2]"
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[#232922]">
          {t("secretFallbackLabel")}
        </span>
        <code className="block break-all rounded-xl bg-[#F5F2EA] px-3.5 py-2.5 text-sm tracking-wider text-[#232922]">
          {secret}
        </code>
      </div>

      <form onSubmit={handleEnable} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mfa-enable-code" className="text-sm font-medium text-[#232922]">
            {t("codeLabel")}
          </label>
          <input
            id="mfa-enable-code"
            name="token"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
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
          className="w-full rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {isPending ? t("verifying") : t("verifyButton")}
        </button>
      </form>
    </div>
  );
}

function DisableSection({ t, router }: { t: Translate; router: Router }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<Extract<DisableResult, { ok: false }>["error"] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await disableAction({ password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#E3DED2] bg-white p-6 shadow-sm">
      <p className="text-sm text-[#2F6B4F]">{t("enabledConfirmation")}</p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="w-full rounded-full border border-[#B23B23] px-6 py-3 text-sm font-semibold text-[#B23B23] transition hover:bg-[#FBEDE9]"
        >
          {t("disableButton")}
        </button>
      ) : (
        <form onSubmit={handleDisable} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-[#232922]">{t("disableConfirmPrompt")}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mfa-disable-password" className="text-sm font-medium text-[#232922]">
              {t("passwordLabel")}
            </label>
            <input
              id="mfa-disable-password"
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

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword("");
                setError(null);
              }}
              className="flex-1 rounded-full border border-[#E3DED2] px-6 py-3 text-sm font-semibold text-[#232922] transition hover:bg-[#F5F2EA]"
            >
              {t("disableConfirmCancel")}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-full bg-[#B23B23] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {t("disableConfirmYes")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
