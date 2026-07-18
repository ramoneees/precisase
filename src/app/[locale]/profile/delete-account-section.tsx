"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/toast-provider";
import { deleteAccountAction, type DeleteAccountErrorCode } from "./actions";

/**
 * "Danger zone" — self-service GDPR/LGPD account deletion (NFR08). Password
 * re-entry is the confirmation step (see account-deletion-service.ts's
 * module doc comment for the deviation from ARCHITECTURE.md §6.4's
 * email-token flow) — the confirm button stays disabled until the password
 * field has content, so deletion can never be a single accidental click.
 */
export function DeleteAccountSection() {
  const t = useTranslations("profile.dangerZone");
  const { showToast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<DeleteAccountErrorCode | null>(null);

  const canConfirm = password.trim().length > 0 && !isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!canConfirm) {
      return;
    }

    startTransition(async () => {
      const result = await deleteAccountAction(password);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      showToast(t("toastDeleted"));
      router.push("/");
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#F7E4DE] bg-[#FBEBE0]/40 p-6">
      <h2 className="font-heading text-lg font-extrabold text-[#B23B23]">{t("heading")}</h2>
      <p className="text-sm text-[#232922]">{t("explanation")}</p>
      <p className="text-sm">
        <Link href="/privacy" target="_blank" className="font-medium text-[#2F6B4F] underline">
          {t("privacyLinkLabel")}
        </Link>
      </p>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="delete-account-password" className="text-sm font-medium text-[#232922]">
            {t("passwordLabel")}
          </label>
          <input
            id="delete-account-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("passwordPlaceholder")}
            className="rounded-xl border border-[#E3DED2] bg-white px-3.5 py-2.5 text-sm text-[#232922] focus:border-[#B23B23] focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={!canConfirm}
          className="shrink-0 rounded-full bg-[#B23B23] px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? t("confirming") : t("confirm")}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-[#B23B23]">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </section>
  );
}
