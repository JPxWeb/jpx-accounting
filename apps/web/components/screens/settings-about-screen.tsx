"use client";

import { localTodayIso } from "@jpx-accounting/domain";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { webRuntimeConfig } from "../../lib/runtime-config";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { ThemeToggle } from "../theme-toggle";
import { ScreenHeader } from "../ui/screen-header";

function ComingSoon({ title, body, testId }: { title: string; body: string; testId?: string }) {
  const t = useTranslations("settings.about.configuration");

  return (
    <section className="glass-panel rounded-xl p-5" data-testid={testId}>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      <p className="text-eyebrow mt-4">{t("comingSoon")}</p>
    </section>
  );
}

function ConfigLinkCard({
  title,
  body,
  links,
  testId,
}: {
  title: string;
  body: string;
  links: readonly { href: string; label: string }[];
  testId?: string;
}) {
  return (
    <section className="glass-panel rounded-xl p-5" data-testid={testId}>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm font-semibold text-foreground underline">
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function SettingsAboutScreen() {
  const t = useTranslations("settings.about");
  const { locale } = useWorkspaceProfile();
  const today = new Date();
  const todayIso = localTodayIso();
  const runtimeMode = webRuntimeConfig.runtimeMode;

  return (
    <div className="space-y-8">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} testId="settings-hero" />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{t("status.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("status.description")}</p>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass-panel rounded-xl p-5" data-testid="runtime-posture">
            <h3 className="text-lg font-semibold">{t("runtimePosture.title")}</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
              <li>
                {t("runtimePosture.modeActive", {
                  mode: t(`runtimePosture.modes.${runtimeMode}`),
                })}
              </li>
              <li>{runtimeMode === "demo" ? t("runtimePosture.demoBody") : t("runtimePosture.normalBody")}</li>
              <li>
                {webRuntimeConfig.disableServiceWorker
                  ? t("runtimePosture.serviceWorkerDisabled")
                  : t("runtimePosture.serviceWorkerEnabled")}
              </li>
            </ul>
          </section>

          <section className="glass-panel rounded-xl p-5" data-testid="deployment-posture">
            <h3 className="text-lg font-semibold">{t("deploymentPosture.title")}</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
              <li>{t("deploymentPosture.line1")}</li>
              <li>{t("deploymentPosture.line2")}</li>
              <li>{t("deploymentPosture.line3")}</li>
            </ul>
          </section>

          <section data-testid="workspace-info" className="glass-panel rounded-xl p-5">
            <p className="text-eyebrow">{t("workspaceInfo.eyebrow")}</p>
            <h3 className="mt-2 text-lg font-semibold">{t("workspaceInfo.title")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.rich("workspaceInfo.today", {
                date: () => (
                  <time dateTime={todayIso} suppressHydrationWarning>
                    {new Intl.DateTimeFormat(locale).format(today)}
                  </time>
                ),
              })}
            </p>
          </section>

          <section className="glass-panel rounded-xl p-5" data-testid="audit-spine">
            <h3 className="text-lg font-semibold">{t("auditSpine.title")}</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
              <li>{t("auditSpine.line1")}</li>
              <li>{t("auditSpine.line2")}</li>
              <li>{t("auditSpine.line3")}</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{t("appearance.title")}</h2>
        <section className="glass-panel rounded-xl p-5" data-testid="appearance-settings">
          <h3 className="text-lg font-semibold">{t("appearance.themeTitle")}</h3>
          <p className="mt-3 text-sm text-muted-foreground">{t("appearance.themeBody")}</p>
          <div className="mt-4">
            <ThemeToggle />
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">{t("configuration.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("configuration.description")}</p>
        <div className="grid gap-6 md:grid-cols-2">
          <ComingSoon title={t("configuration.profile.title")} body={t("configuration.profile.body")} />
          <ConfigLinkCard
            title={t("configuration.workspace.title")}
            body={t("configuration.workspace.body")}
            testId="workspace-config-card"
            links={[
              { href: "/settings/company", label: t("configuration.workspace.companyLink") },
              { href: "/settings/fiscal-year", label: t("configuration.workspace.fiscalYearLink") },
            ]}
          />
          <ConfigLinkCard
            title={t("configuration.integrations.title")}
            body={t("configuration.integrations.body")}
            testId="integrations-config-card"
            links={[{ href: "/settings/integrations", label: t("configuration.integrations.link") }]}
          />
          <ConfigLinkCard
            title={t("configuration.team.title")}
            body={t("configuration.team.body")}
            testId="team-config-card"
            links={[{ href: "/settings/team", label: t("configuration.team.link") }]}
          />
          <ComingSoon
            title={t("configuration.billing.title")}
            body={t("configuration.billing.body")}
            testId="billing-card"
          />
        </div>
      </div>
    </div>
  );
}
