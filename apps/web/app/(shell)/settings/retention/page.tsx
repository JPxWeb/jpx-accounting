import { getTranslations } from "next-intl/server";

import { BFL_RETENTION_SOURCE } from "../../../../lib/legal-sources";
import { LOCAL_DATA_REGISTRY } from "../../../../lib/local-data";
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

        {/* WS-C R12: THE local-data disclosure — rendered straight from
            LOCAL_DATA_REGISTRY (lib/local-data.ts), the same list sign-out's
            clearAllLocalData() clears, so UI and behavior cannot drift. */}
        <section className="glass-panel rounded-xl p-5" data-testid="retention-local-data">
          <SectionLabel>{t("localData.title")}</SectionLabel>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("localData.description")}</p>
          {/* tabIndex + region: an overflow container that actually scrolls
              must be keyboard-reachable (axe scrollable-region-focusable —
              it scrolls on linux font metrics even when it fits on win32). */}
          <div
            className="mt-4 overflow-x-auto focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            tabIndex={0}
            role="region"
            aria-label={t("localData.title")}
          >
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-caption text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t("localData.columns.store")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t("localData.columns.key")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t("localData.columns.purpose")}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t("localData.columns.signOut")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {LOCAL_DATA_REGISTRY.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                      {t(`localData.storage.${entry.storage}`)}
                    </td>
                    <td className="py-2 pr-4">
                      <code className="font-mono text-xs text-foreground">
                        {entry.match === "prefix" ? `${entry.key}*` : entry.key}
                      </code>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{t(`localData.entries.${entry.id}`)}</td>
                    <td className="py-2 whitespace-nowrap text-muted-foreground">
                      {entry.clearedOnSignOut ? t("localData.clearedYes") : t("localData.clearedNo")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-caption leading-5 text-muted-foreground">{t("localData.signOutNote")}</p>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="retention-roadmap">
          <SectionLabel>{t("roadmapTitle")}</SectionLabel>
          <p className="mt-3 rounded-lg bg-warning-soft px-4 py-3 text-sm leading-6 text-warning">{t("roadmapBody")}</p>
        </section>
      </div>
    </div>
  );
}
