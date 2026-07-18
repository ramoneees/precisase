import { getTranslations } from "next-intl/server";
import { PhoneService } from "@/server/services/phone-service";
import { formatPhoneForDisplay } from "@/server/services/phone-service";
import type { ContactMethodValue } from "@/server/services/post-service";

/** True iff the contact value is a phone (phone or whatsapp method, OR the
 * E.164-formatted value itself). With the post-create flow now normalizing
 * phone numbers via libphonenumber-js, `contactValue` for `phone`/
 * `whatsapp` methods is always canonical E.164 — the regex fallback exists
 * only for legacy posts written before normalization. */
function isPhoneLike(value: string, method: ContactMethodValue): boolean {
  if (method === "phone" || method === "whatsapp") return true;
  return PhoneService.isE164(value);
}

/**
 * wa.me takes the international number with the leading `+` stripped —
 * `+351912345678` → `351912345678`. The previous implementation
 * stripped all non-digits, which silently produced wrong-country links
 * for domestic-format inputs (e.g. `912 345 678` → `wa.me/912345678` →
 * WhatsApp interpreted as +234 Nigeria).
 */
function waMeHref(e164: string): string {
  return `https://wa.me/${e164.replace(/^\+/, "")}`;
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
  const showWhatsAppLink = isPhoneLike(contactValue, contactMethod);

  const displayValue =
    contactMethod === "phone" || contactMethod === "whatsapp" || PhoneService.isE164(contactValue)
      ? formatPhoneForDisplay(contactValue, { international: false })
      : contactValue;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#E3DED2] bg-white p-5">
      <p className="text-sm font-semibold text-[#2F6B4F]">{t("contactRevealed")}</p>
      <p className="text-sm text-[#232922]">
        {t(`contactMethodLabel.${contactMethod}`)}: <strong>{displayValue}</strong>
      </p>
      {showWhatsAppLink ? (
        <a
          href={waMeHref(contactValue)}
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
