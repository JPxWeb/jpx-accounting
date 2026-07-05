"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";

import { apiClient } from "../../lib/client";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";

/**
 * Real integration posture (Phase 6 Task 6.2): only signals the running
 * system actually reports. SIE 4 import/export exists today (Capture /
 * Reports); the AI card reads `GET /api/runtime-info` (provider/model/host —
 * never secrets); blob storage and Document Intelligence are described by
 * runtime mode because the current API surface exposes no per-service probe —
 * the cards say so instead of pretending. Peppol and email intake are honest
 * roadmap cards, not fake connection toggles.
 */
export function IntegrationsPosture() {
  const t = useTranslations("settings.integrations");
  // Reuses the ai-posture About-this-AI provider labels — one vocabulary.
  const tProviders = useTranslations("settings.aiPosture.about.providers");

  // Same query key as the About-this-AI panel — one cache entry.
  const runtimeQuery = useQuery({
    queryKey: ["runtime-info"],
    queryFn: () => apiClient.getRuntimeInfo(),
  });
  const runtimeInfo = runtimeQuery.data;

  const webMode = webRuntimeConfig.runtimeMode;
  const effectiveMode = runtimeInfo?.runtimeMode ?? webMode;
  const demo = effectiveMode === "demo";

  const webModeLabel = t(`modes.${webMode}`);
  const modeLine = runtimeInfo
    ? t("modeLine", { web: webModeLabel, api: t(`modes.${runtimeInfo.runtimeMode}`) })
    : runtimeQuery.isError
      ? t("modeUnavailable", { web: webModeLabel })
      : t("modeLoading", { web: webModeLabel });

  return (
    <div className="space-y-6" data-testid="integrations-posture">
      <p className="text-sm text-muted-foreground" data-testid="integrations-mode-line">
        {modeLine}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <IntegrationCard
          testId="integration-sie"
          title={t("sie.title")}
          badge={t("status.available")}
          badgeVariant="success"
        >
          <p>{t("sie.body")}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/capture" className="font-semibold text-foreground underline">
              {t("sie.importCta")}
            </Link>
            <Link href="/reports" className="font-semibold text-foreground underline">
              {t("sie.exportCta")}
            </Link>
          </p>
        </IntegrationCard>

        <IntegrationCard
          testId="integration-ai"
          title={t("ai.title")}
          badge={
            runtimeInfo
              ? runtimeInfo.ai.operational
                ? t("status.operational")
                : t("status.notOperational")
              : t("status.notReported")
          }
          badgeVariant={runtimeInfo ? (runtimeInfo.ai.operational ? "success" : "warning") : "warning"}
        >
          {runtimeInfo ? (
            <>
              <p>{tProviders(runtimeInfo.ai.provider)}</p>
              <p>{demo ? t("ai.bodyDemo") : t("ai.bodyNormal")}</p>
              {runtimeInfo.ai.model ? (
                <p className="font-mono text-caption">
                  {t("ai.model")}: {runtimeInfo.ai.model}
                </p>
              ) : null}
              {runtimeInfo.ai.endpointHost ? (
                <p className="font-mono text-caption">
                  {t("ai.host")}: {runtimeInfo.ai.endpointHost}
                </p>
              ) : null}
            </>
          ) : (
            <p>{runtimeQuery.isError ? t("ai.unavailable") : t("ai.loading")}</p>
          )}
        </IntegrationCard>

        <IntegrationCard
          testId="integration-blob"
          title={t("blob.title")}
          badge={demo ? t("status.demoStub") : t(`modes.${effectiveMode}`)}
          badgeVariant={demo ? "info" : "accent"}
        >
          <p>{demo ? t("blob.bodyDemo") : t("blob.bodyNormal")}</p>
          <p className="text-caption">{t("blob.note")}</p>
        </IntegrationCard>

        <IntegrationCard
          testId="integration-ocr"
          title={t("ocr.title")}
          badge={demo ? t("status.demoStub") : t(`modes.${effectiveMode}`)}
          badgeVariant={demo ? "info" : "accent"}
        >
          <p>{demo ? t("ocr.bodyDemo") : t("ocr.bodyNormal")}</p>
          <p className="text-caption">{t("ocr.note")}</p>
        </IntegrationCard>

        <IntegrationCard
          testId="peppol-readiness"
          title={t("peppol.title")}
          badge={t("status.notBuilt")}
          badgeVariant="warning"
          className="md:col-span-2"
        >
          <p>{t("peppol.what")}</p>
          <p>{t("peppol.ready")}</p>
          <p className="rounded-lg bg-warning-soft px-4 py-3 text-warning">{t("peppol.honest")}</p>
        </IntegrationCard>

        <IntegrationCard
          testId="integration-email-intake"
          title={t("email.title")}
          badge={t("status.planned")}
          badgeVariant="info"
        >
          <p>{t("email.body")}</p>
        </IntegrationCard>
      </div>
    </div>
  );
}

function IntegrationCard({
  testId,
  title,
  badge,
  badgeVariant,
  className,
  children,
}: {
  testId: string;
  title: string;
  badge: string;
  badgeVariant: "accent" | "success" | "warning" | "danger" | "info";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`glass-panel rounded-xl p-5 ${className ?? ""}`} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <SectionLabel as="span">{title}</SectionLabel>
        <StatusBadge status={badge} variant={badgeVariant} />
      </div>
      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">{children}</div>
    </section>
  );
}
