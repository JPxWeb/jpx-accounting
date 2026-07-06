"use client";

import { useTranslations } from "next-intl";

import type { TourId } from "../../lib/onboarding/tour-ids";
import { useOnboarding } from "./onboarding-context";

type MicroHintLinkProps = {
  tourId: TourId;
  testId: string;
  messageKey: "mobileAdvisor" | "reportsDrill";
};

export function MicroHintLink({ tourId, testId, messageKey }: MicroHintLinkProps) {
  const t = useTranslations("onboarding.microHints");
  const { startTour, isTourCompleted } = useOnboarding();

  if (isTourCompleted(tourId)) {
    return null;
  }

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => startTour(tourId, { force: true })}
      className="text-sm font-medium text-primary hover:underline"
    >
      {t(`${messageKey}.cta`)}
    </button>
  );
}

export function OnboardingReplayPanel() {
  const t = useTranslations("onboarding.replay");
  const { resetAllTours, startTour } = useOnboarding();

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="onboarding-replay">
      <h3 className="text-lg font-semibold text-foreground">{t("title")}</h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("description")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="onboarding-replay-orientation"
          onClick={() => startTour("app-orientation", { force: true })}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          {t("orientation")}
        </button>
        <button
          type="button"
          data-testid="onboarding-replay-reset"
          onClick={() => resetAllTours()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
        >
          {t("reset")}
        </button>
      </div>
    </section>
  );
}
