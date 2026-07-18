"use client";

import type { AiPosture, CompanySettings } from "@jpx-accounting/contracts";
import { DEFAULT_AI_POSTURE } from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { invalidateLedgerDerived } from "../../lib/query-invalidation";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";

/**
 * Real AI posture settings (Task 5.10, EU AI Act Article 50 transparency):
 * an About-this-AI panel fed by `GET /api/runtime-info` (provider/model/host
 * — never secrets), the Article 50 statement, and per-surface toggles
 * persisted on `companySettings.aiPosture` via the ordinary settings save
 * path. The toggles only gate AI *surfaces* (advisor chat, suggestion chips);
 * the human review gate stays mandatory regardless.
 */
export function AiPostureForm() {
  const t = useTranslations("settings.aiPosture");
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });
  const runtimeInfoQuery = useQuery({
    queryKey: ["runtime-info"],
    queryFn: () => apiClient.getRuntimeInfo(),
  });

  const mutation = useMutation({
    mutationFn: (input: CompanySettings) => apiClient.saveCompanySettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["company-settings"], saved);
      // Settings saves are ledger-audited writes — keep derived views honest (R18).
      invalidateLedgerDerived(queryClient);
      toast.success(t("saved"));
    },
    onError: () => {
      toast.error(t("saveError"));
    },
  });

  if (settingsQuery.isLoading) return <ScreenSkeleton />;

  const settings = settingsQuery.data ?? null;
  const posture: AiPosture = settings?.aiPosture ?? DEFAULT_AI_POSTURE;
  const runtimeInfo = runtimeInfoQuery.data;

  function saveToggle(patch: Partial<AiPosture>) {
    // AI posture rides on the org company settings (contracts default — no
    // migration); persisting a toggle requires a saved settings record.
    if (!settings) return;
    mutation.mutate({ ...settings, aiPosture: { ...posture, ...patch } });
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-xl p-5" data-testid="about-this-ai">
        <SectionLabel>{t("about.label")}</SectionLabel>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{t("about.title")}</h2>
        {runtimeInfo ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <AboutRow label={t("about.runtimeMode")} value={t(`about.modes.${runtimeInfo.runtimeMode}`)} />
            <AboutRow label={t("about.provider")} value={t(`about.providers.${runtimeInfo.ai.provider}`)} />
            {runtimeInfo.ai.model ? <AboutRow label={t("about.model")} value={runtimeInfo.ai.model} /> : null}
            {runtimeInfo.ai.endpointHost ? (
              <AboutRow label={t("about.host")} value={runtimeInfo.ai.endpointHost} />
            ) : null}
            <AboutRow
              label={t("about.status")}
              value={runtimeInfo.ai.operational ? t("about.operational") : t("about.notOperational")}
            />
          </dl>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {runtimeInfoQuery.isError ? t("about.unavailable") : t("about.loading")}
          </p>
        )}
        <p className="mt-4 rounded-lg bg-primary-soft px-4 py-3 text-sm leading-6 text-primary">
          {t("about.approvalStatement")}
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground" data-testid="ai-article-50">
          {t("article50")}
        </p>
      </section>

      <section className="glass-panel rounded-xl p-5">
        <SectionLabel>{t("toggles.label")}</SectionLabel>
        {!settings ? (
          <p
            className="mt-3 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
            data-testid="ai-posture-needs-company"
          >
            {t("needsCompany")}{" "}
            <Link href="/settings/company" className="font-semibold underline">
              {t("needsCompanyCta")}
            </Link>
          </p>
        ) : null}
        <div className="mt-4 space-y-4">
          <PostureToggle
            testId="ai-toggle-advisor"
            label={t("toggles.advisor.title")}
            description={t("toggles.advisor.description")}
            checked={posture.advisorEnabled}
            disabled={!settings || mutation.isPending}
            onToggle={(next) => saveToggle({ advisorEnabled: next })}
          />
          <PostureToggle
            testId="ai-toggle-suggestions"
            label={t("toggles.suggestions.title")}
            description={t("toggles.suggestions.description")}
            checked={posture.suggestionsEnabled}
            disabled={!settings || mutation.isPending}
            onToggle={(next) => saveToggle({ suggestionsEnabled: next })}
          />
        </div>
      </section>
    </div>
  );
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel-inset rounded-lg px-3 py-3">
      <dt className="text-eyebrow">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function PostureToggle({
  testId,
  label,
  description,
  checked,
  disabled,
  onToggle,
}: {
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const labelId = `${testId}-label`;
  return (
    <div className="glass-panel-soft flex items-start justify-between gap-4 rounded-lg p-4">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-semibold text-foreground">
          {label}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        data-testid={testId}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          checked ? "bg-primary" : "border border-border bg-surface-muted"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
