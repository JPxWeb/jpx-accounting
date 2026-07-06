"use client";

import type { ComplianceAlert, ReviewTask, WorkspaceSnapshot } from "@jpx-accounting/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo, useState } from "react";

import { apiClient } from "../../lib/client";
import { formatShortDate } from "../../lib/presentation";
import { buildVoucherLookup, VoucherLink } from "../reports/voucher-link";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { SectionLabel } from "../ui/section-label";
import { StatusBadge } from "../ui/status-badge";
import { Button } from "../ui/button";

const AUTO_DETECTED_KINDS = new Set(["stale-blocked", "missing-supplier-vat"]);

function severityVariant(severity: ComplianceAlert["severity"]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "warning") return "warning" as const;
  return "info" as const;
}

function buildReviewByVoucherId(reviews: ReviewTask[]) {
  const map = new Map<string, string>();
  for (const review of reviews) map.set(review.voucherId, review.id);
  return map;
}

function AlertTargetLink({
  alert,
  lookup,
  reviewByVoucherId,
}: {
  alert: ComplianceAlert;
  lookup: ReturnType<typeof buildVoucherLookup>;
  reviewByVoucherId: Map<string, string>;
}) {
  const t = useTranslations("settings.compliance.alerts");

  if (!alert.targetId) return null;

  if (alert.kind === "stale-blocked") {
    const reviewId = reviewByVoucherId.get(alert.targetId);
    if (reviewId) {
      return (
        <Link
          href={`/today?review=${reviewId}`}
          data-testid="compliance-alert-target-link"
          className="text-sm font-semibold text-primary underline underline-offset-2"
        >
          {t("openReview")}
        </Link>
      );
    }
  }

  return (
    <span data-testid="compliance-alert-target-link">
      <VoucherLink voucherId={alert.targetId} lookup={lookup} />
    </span>
  );
}

function alertStatusLabel(alert: ComplianceAlert, t: ReturnType<typeof useTranslations<"settings.compliance.alerts">>) {
  if (alert.status === "resolved" && AUTO_DETECTED_KINDS.has(alert.kind)) {
    return t("statusAutoResolved");
  }
  return t(`status.${alert.status}`);
}

export function ComplianceAlertsPanel() {
  const t = useTranslations("settings.compliance.alerts");
  const { locale } = useWorkspaceProfile();
  const queryClient = useQueryClient();
  const [includeResolved, setIncludeResolved] = useState(false);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

  const alertsQuery = useQuery({
    queryKey: ["compliance-alerts", includeResolved],
    queryFn: () => apiClient.refreshComplianceAlerts({ includeResolved }),
  });

  const lookup = useMemo(() => buildVoucherLookup(workspaceQuery.data), [workspaceQuery.data]);
  const reviewByVoucherId = useMemo(
    () => buildReviewByVoucherId(workspaceQuery.data?.reviews ?? []),
    [workspaceQuery.data?.reviews],
  );

  const alerts = alertsQuery.data ?? workspaceQuery.data?.alerts ?? [];
  const loading = alertsQuery.isLoading || (!alertsQuery.data && workspaceQuery.isLoading);

  function handleRefresh() {
    void alertsQuery.refetch().then((result) => {
      if (result.data) {
        queryClient.setQueryData<WorkspaceSnapshot>(["workspace"], (current) =>
          current ? { ...current, alerts: result.data } : current,
        );
      }
    });
  }

  return (
    <section className="glass-panel rounded-xl p-5" data-testid="compliance-alerts-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <SectionLabel>{t("label")}</SectionLabel>
          <h2 className="mt-2 text-lg font-semibold">{t("title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              data-testid="compliance-alerts-include-resolved"
              checked={includeResolved}
              onChange={(event) => setIncludeResolved(event.target.checked)}
              className="size-4 rounded border-border"
            />
            {t("includeResolved")}
          </label>
          <Button
            type="button"
            variant="secondary"
            data-testid="compliance-alerts-refresh"
            disabled={alertsQuery.isFetching}
            onClick={handleRefresh}
          >
            {alertsQuery.isFetching ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>

      {alertsQuery.isError ? (
        <p className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{t("refreshError")}</p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("loading")}</p>
      ) : alerts.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              data-testid="compliance-alert-row"
              data-severity={alert.severity}
              data-status={alert.status}
              className="glass-panel-soft rounded-xl px-4 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 text-sm font-semibold text-foreground">{alert.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    testId="compliance-alert-severity"
                    status={t(`severity.${alert.severity}`)}
                    variant={severityVariant(alert.severity)}
                  />
                  <StatusBadge
                    testId="compliance-alert-status"
                    status={alertStatusLabel(alert, t)}
                    variant={alert.status === "open" ? "accent" : "info"}
                  />
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{alert.impactSummary}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-muted-foreground">
                <span data-visual-mask>{formatShortDate(alert.detectedAt, locale)}</span>
                <span>{alert.source}</span>
                <AlertTargetLink alert={alert} lookup={lookup} reviewByVoucherId={reviewByVoucherId} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
