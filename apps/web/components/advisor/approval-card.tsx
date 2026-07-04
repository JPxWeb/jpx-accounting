"use client";

import { useTranslations } from "next-intl";

import { Money } from "../ui/money";
import type { AdvisorToolPart } from "./local-demo-transport";

type ApprovalToolPart = Extract<AdvisorToolPart, { state: "approval-requested" | "approval-responded" }>;

/**
 * The advisor's drafted review approval (EU AI Act Article 50-honest: labeled
 * as an AI draft, awaiting an explicit human decision). Approving calls
 * `addToolApprovalResponse(approved: true)` which re-sends the turn — the
 * server (or demo transport) then executes the ordinary review-gate
 * `applyReviewDecision`. Rejecting responds `approved: false` and nothing is
 * ever posted. The card itself mutates nothing.
 */
export function ApprovalCard({
  part,
  onRespond,
  busy,
}: {
  part: ApprovalToolPart;
  onRespond: (approvalId: string, approved: boolean) => void;
  busy: boolean;
}) {
  const t = useTranslations("advisor.approval");
  const proposal = part.input;
  const awaiting = part.state === "approval-requested";

  return (
    <div data-testid="advisor-approval-card" className="glass-panel-soft rounded-xl p-4">
      <p className="text-eyebrow">{t("awaiting")}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{proposal.reviewTitle}</p>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex items-baseline justify-between gap-3 sm:justify-start">
          <dt className="text-muted-foreground">{t("account")}</dt>
          <dd className="font-medium text-foreground">
            {proposal.edited.accountNumber} {proposal.edited.accountName}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:justify-start">
          <dt className="text-muted-foreground">{t("vat")}</dt>
          <dd className="font-medium text-foreground">{proposal.edited.vatCode}</dd>
        </div>
        {proposal.grossAmount !== null ? (
          <div className="flex items-baseline justify-between gap-3 sm:justify-start">
            <dt className="text-muted-foreground">{t("amount")}</dt>
            <dd className="font-medium text-foreground">
              <Money value={proposal.grossAmount} />
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 sm:justify-start">
          <dt className="text-muted-foreground">{t("confidence")}</dt>
          <dd className="font-medium tabular-nums text-foreground">{Math.round(proposal.confidence * 100)} %</dd>
        </div>
      </dl>

      {proposal.reasoning ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{proposal.reasoning}</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">{t("gateNote")}</p>

      {awaiting ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="advisor-approve-tool"
            disabled={busy}
            onClick={() => onRespond(part.approval.id, true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {t("approve")}
          </button>
          <button
            type="button"
            data-testid="advisor-reject-tool"
            disabled={busy}
            onClick={() => onRespond(part.approval.id, false)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-60"
          >
            {t("reject")}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
          {part.approval.approved ? t("respondedApproved") : t("respondedRejected")}
        </p>
      )}
    </div>
  );
}
