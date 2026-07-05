import { getTranslations } from "next-intl/server";

import { BFL_RETENTION_SOURCE } from "../../../../lib/legal-sources";
import { ScreenHeader } from "../../../../components/ui/screen-header";
import { SectionLabel } from "../../../../components/ui/section-label";

/**
 * Honest retention policy (Phase 6 Task 6.2). Retention here is architecture,
 * not configuration: the append-only ledger and immutable evidence blobs ARE
 * the policy, so this page states the statutory duty (Bokföringslagen
 * 7 kap. 2 §), where records live per runtime mode, and — honestly — that
 * legal-hold controls do not exist yet. No fake toggles.
 */
export default async function RetentionSettingsPage() {
  const t = await getTranslations("settings.retention");
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="space-y-6" data-testid="retention-policy">
        <div className="grid gap-6 md:grid-cols-2">
          <section className="glass-panel rounded-xl p-5">
            <SectionLabel>{t("ledgerTitle")}</SectionLabel>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("ledgerBody")}</p>
          </section>

          <section className="glass-panel rounded-xl p-5">
            <SectionLabel>{t("evidenceTitle")}</SectionLabel>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("evidenceBody")}</p>
          </section>
        </div>

        <section className="glass-panel rounded-xl p-5" data-testid="retention-statute">
          <SectionLabel>{t("statuteTitle")}</SectionLabel>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("statuteBody")}</p>
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-eyebrow">{t("sourceLabel")}</p>
            <p className="mt-2 text-caption leading-5 text-muted-foreground">{BFL_RETENTION_SOURCE}</p>
          </div>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="retention-storage">
          <SectionLabel>{t("storageTitle")}</SectionLabel>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="glass-panel-inset rounded-lg p-4">
              <h3 className="text-sm font-semibold text-foreground">{t("storageDemoTitle")}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>{t("storageDemo1")}</li>
                <li>{t("storageDemo2")}</li>
                <li>{t("storageDemo3")}</li>
              </ul>
            </div>
            <div className="glass-panel-inset rounded-lg p-4">
              <h3 className="text-sm font-semibold text-foreground">{t("storageNormalTitle")}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>{t("storageNormal1")}</li>
                <li>{t("storageNormal2")}</li>
                <li>{t("storageNormal3")}</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="retention-roadmap">
          <SectionLabel>{t("roadmapTitle")}</SectionLabel>
          <p className="mt-3 rounded-lg bg-warning-soft px-4 py-3 text-sm leading-6 text-warning">{t("roadmapBody")}</p>
        </section>
      </div>
    </div>
  );
}
