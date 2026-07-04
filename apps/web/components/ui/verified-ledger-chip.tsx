"use client";

import type { IntegritySummary } from "@jpx-accounting/contracts";
import { useTranslations } from "next-intl";

/**
 * The one way to render the ledger's hash-chain verdict (Task 5.8; reused by
 * the report print header in Task 5.10). Linkage verification only — the chip
 * mirrors `IntegritySummary.chainLinked` and never claims more than the check
 * proves. Text + color, never color alone.
 */
export function VerifiedLedgerChip({ integrity }: { integrity: IntegritySummary }) {
  const t = useTranslations("common.integrityChip");
  const template = formatBasTemplate(integrity.bas.template);

  return (
    <span
      data-testid="integrity-chip"
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-caption font-semibold ${
        integrity.chainLinked ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
      }`}
    >
      {integrity.chainLinked
        ? t("intact", { template, count: integrity.eventCount })
        : t("broken", { template, count: integrity.eventCount })}
    </span>
  );
}

/** `bas-2026` → `BAS 2026`; unknown template ids pass through verbatim. */
function formatBasTemplate(template: string): string {
  const match = /^bas-(\d{4})$/.exec(template);
  return match ? `BAS ${match[1]}` : template;
}
