"use client";

import { useTranslations } from "next-intl";

type UnavailableStateProps = {
  title: string;
  message: string;
  testId?: string;
};

/**
 * Honest empty/disabled chrome for fail-closed surfaces. The eyebrow is i18n'd
 * here (Wave E-4) so callers never reintroduce an English "Unavailable" literal.
 */
export function UnavailableState({ title, message, testId }: UnavailableStateProps) {
  const t = useTranslations("common.unavailable");

  return (
    <div className="page-shell">
      <section className="glass-panel rounded-xl p-6 sm:p-7" data-testid={testId}>
        <p className="text-eyebrow">{t("eyebrow")}</p>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{message}</p>
      </section>
    </div>
  );
}
