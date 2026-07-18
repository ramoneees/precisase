import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import { defaultTimeZoneForUiLocale } from "@/lib/region-defaults";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    timeZone: defaultTimeZoneForUiLocale(locale),
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
