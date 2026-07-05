"use client";

import { useTranslations } from "next-intl";

import { ApprovalCard } from "./approval-card";
import { PROPOSE_REVIEW_ACTION_PART_TYPE, type AdvisorUIMessage } from "./local-demo-transport";
import { ProvenanceChips } from "./provenance-chips";

/**
 * Renders one advisor UI-message part:
 * - `text` → prose
 * - `data-provenance` → sourced passage chips
 * - `tool-proposeReviewAction` approval states → the human approval card
 * - `tool-proposeReviewAction` outputs → a confirmation row (executed through
 *   the review gate, or denied with nothing posted)
 */
export function MessagePart({
  part,
  onApprovalResponse,
  busy,
}: {
  part: AdvisorUIMessage["parts"][number];
  onApprovalResponse: (approvalId: string, approved: boolean) => void;
  busy: boolean;
}) {
  const t = useTranslations("advisor.tool");

  if (part.type === "text") {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{part.text}</p>;
  }

  if (part.type === "data-provenance") {
    return <ProvenanceChips passages={part.data.passages} />;
  }

  if (part.type === PROPOSE_REVIEW_ACTION_PART_TYPE) {
    switch (part.state) {
      case "approval-requested":
      case "approval-responded":
        return <ApprovalCard part={part} onRespond={onApprovalResponse} busy={busy} />;
      case "output-available":
        return <ToolConfirmationRow approved={part.output.approved} text={part.output.resultText} />;
      case "output-denied":
        return <ToolConfirmationRow approved={false} text={t("deniedRow")} />;
      case "output-error":
        return <ToolConfirmationRow approved={false} text={part.errorText} />;
      default:
        // input-streaming / input-available: the normal-mode model is still
        // drafting the proposal — show an honest in-progress row.
        return <p className="text-sm text-muted-foreground">{t("drafting")}</p>;
    }
  }

  // step-start and other protocol parts carry no user-facing content.
  return null;
}

/** One confirmation row for a finished tool call — same shape for both modes. */
function ToolConfirmationRow({ approved, text }: { approved: boolean; text: string }) {
  const t = useTranslations("advisor.tool");

  return (
    <div
      data-testid="advisor-tool-result"
      data-approved={approved}
      className={`rounded-xl px-4 py-3 text-sm ${approved ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}
    >
      <p className="font-semibold">{approved ? t("approvedRow") : t("deniedTitle")}</p>
      <p className="mt-1 leading-6">{text}</p>
    </div>
  );
}
