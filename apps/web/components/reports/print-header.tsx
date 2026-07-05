"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { usePeriodScope } from "../../hooks/use-period-scope";
import { apiClient } from "../../lib/client";
import { useWorkspaceProfile } from "../providers/workspace-profile-provider";
import { VerifiedLedgerChip } from "../ui/verified-ledger-chip";

/**
 * Print-only report header (advisory-pivot Phase 4, Task 4.9): a printed
 * report pack must say WHOSE numbers these are, for WHICH window, generated
 * WHEN. Company name comes from the shared `company-settings` query (same key
 * as the settings form and the profile provider — one cache entry), the
 * period label from the unified period scope, the timestamp from the pack.
 * Task 5.10 adds the verified-ledger chip (shared `["integrity"]` query) so
 * the printed pack states the hash-chain verdict it was generated under.
 */
export function PrintHeader({ generatedAt }: { generatedAt: string }) {
  const t = useTranslations("reports.print");
  const { label } = usePeriodScope();
  const { locale } = useWorkspaceProfile();
  const { data: settings } = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });
  const { data: integrity } = useQuery({
    queryKey: ["integrity"],
    queryFn: () => apiClient.getIntegritySummary(),
  });

  const timestamp = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(generatedAt),
  );

  return (
    <header data-testid="report-print-header" className="hidden border-b border-border pb-4 print:block">
      {settings?.organizationName ? <p className="text-xl font-semibold">{settings.organizationName}</p> : null}
      <p className="mt-1 text-sm">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("generatedAt", { timestamp })}</p>
      {integrity ? (
        <p className="mt-2">
          <VerifiedLedgerChip integrity={integrity} />
        </p>
      ) : null}
    </header>
  );
}
