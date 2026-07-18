import { getTranslations } from "next-intl/server";
import type { ContactMethodValue } from "@/server/services/post-service";

/**
 * Design decision (not fully specified in the brief): a `wa.me` deep link
 * is offered whenever the contact value itself looks phone-shaped —
 * `contactMethod === "phone"` posts commonly hold a WhatsApp-reachable
 * number too — rather than strictly gating it on `contactMethod ===
 * "whatsapp"`. `email` values never match the phone-shaped check, so this
 * never fires for email contacts.
 */
function looksLikePhoneNumber(value: string): boolean {
  return /^\+?[0-9()\-\s]{6,}$/.test(value.trim());
}

export async function ContactPanel({
  locale,
  contactMethod,
  contactValue,
}: {
  locale: string;
  contactMethod: ContactMethodValue;
  contactValue: string;
}) {
  const t = await getTranslations({ locale, namespace: "post.detail" });
  const digitsOnly = contactValue.replace(/[^0-9]/g, "");
  const showWhatsAppLink = looksLikePhoneNumber(contactValue) && digitsOnly.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#E3DED2] bg-white p-5">
      <p className="text-sm font-semibold text-[#2F6B4F]">{t("contactRevealed")}</p>
      <p className="text-sm text-[#232922]">
        {t(`contactMethodLabel.${contactMethod}`)}: <strong>{contactValue}</strong>
      </p>
      {showWhatsAppLink ? (
        <a
          href={`https://wa.me/${digitsOnly}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit rounded-full bg-[#2F6B4F] px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          {t("continueOnWhatsApp")}
        </a>
      ) : null}
    </div>
  );
}
