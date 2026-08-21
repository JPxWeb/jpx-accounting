"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";

import { buildVoucherLookup, resolveVoucherLinkDisplay, type VoucherLookup } from "../../lib/voucher-link-display";
import { StatusBadge } from "../ui/status-badge";

/**
 * The honest voucher chip (advisory-pivot Phase 4, Task 4.8 — plan finding 4;
 * extended KFR Phase D / Task 5 for materialized SIE-import voucher rows).
 *
 * All decision logic lives in `lib/voucher-link-display.ts` — framework-free
 * and unit-tested (`tests/unit/voucher-link-display.test.ts`); this component
 * is just the renderer for the `VoucherLinkDisplay` union. See that module's
 * doc comment for the resolution order. NEVER a dead link.
 */

export { buildVoucherLookup, type VoucherLookup };

export function VoucherLink({ voucherId, lookup }: { voucherId: string; lookup: VoucherLookup }) {
  const t = useTranslations("reports.drill");
  const tCommon = useTranslations("common");
  const display = resolveVoucherLinkDisplay(voucherId, lookup);

  if (display.kind === "link") {
    const link = (
      <Link
        data-testid="drill-voucher-link"
        href={display.href}
        className="text-mono text-sm text-primary underline underline-offset-2"
      >
        {display.label}
      </Link>
    );
    // A native voucher renders the bare link exactly as it did pre-Task-5; only
    // an imported one gains the badge (and the row wrapper it needs).
    if (!display.imported) {
      return link;
    }
    return (
      <span className="inline-flex items-center gap-2">
        {link}
        <StatusBadge testId="drill-imported-badge" status={t("importedBadge")} variant="info" />
      </span>
    );
  }

  // KFR E.1: an unposted voucher has no number yet. Its own visually distinct
  // chip (warning, not info) — the badge text and variant are hardcoded per
  // kind, so a shared branch could not have carried it.
  if (display.kind === "draft") {
    const badge = <StatusBadge testId="drill-draft-badge" status={tCommon("draftVoucher")} variant="warning" />;
    if (!display.href) return badge;
    return (
      <Link data-testid="drill-voucher-link" href={display.href} className="inline-flex items-center">
        {badge}
      </Link>
    );
  }

  if (display.kind === "imported-badge") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-mono text-sm">{display.label}</span>
        <StatusBadge testId="drill-imported-badge" status={t("importedBadge")} variant="info" />
      </span>
    );
  }

  return <span className="text-mono text-sm text-muted-foreground">{display.label}</span>;
}
