import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

/**
 * next-intl "without i18n routing" setup: one locale per workspace, driven by
 * the NEXT_LOCALE cookie (written when the company form saves a profile).
 * No URL prefixes, no middleware. `en` is the source catalog and the default,
 * so a fresh browser context renders exactly today's English copy.
 */
export default getRequestConfig(async () => {
  const locale = (await cookies()).get("NEXT_LOCALE")?.value === "sv" ? "sv" : "en";

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
