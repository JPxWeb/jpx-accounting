"use client";

import { useTranslations } from "next-intl";

import { Kbd } from "@/components/ui/kbd";

const KEYS = [
  { key: "Y", labelKey: "accept" },
  { key: "E", labelKey: "edit" },
  { key: "B", labelKey: "bookWithoutVat" },
  { key: "N", labelKey: "reject" },
] as const;

export function HotkeyStrip() {
  const t = useTranslations("onboarding.hotkeys");

  return (
    <div className="glass-panel-inset rounded-lg px-3 py-2" data-tour="review-hotkeys-strip">
      <p className="text-eyebrow mb-2 text-muted-foreground">{t("title")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {KEYS.map(({ key, labelKey }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Kbd>{key}</Kbd>
            {t(`keys.${labelKey}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
