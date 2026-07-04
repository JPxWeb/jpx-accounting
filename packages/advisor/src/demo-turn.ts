import type { ReviewDecisionEdit } from "@jpx-accounting/contracts";

import type { KnowledgePassage } from "./retrieval";

/**
 * The ONE deterministic demo advisor brain (Phase 5 finding 10). Two thin
 * adapters replay these parts: the API route maps them onto a UI-message SSE
 * stream (demo mode), and the web's local demo transport replays them
 * client-side when the fallback store is active. No LLM, no clock, no
 * randomness — the same input always yields the same parts.
 *
 * Invariant (append-only + review gate): the propose-review-action part is a
 * PROPOSAL only. Executing it — `applyReviewDecision(reviewId, "approve",
 * { actorId, notes, edited })` — happens in the adapter, and only after an
 * explicit human approval response. This module never mutates anything.
 */

/**
 * Tool-call payload proposing an action on an EXISTING review-queue item.
 * Wire-shape twin of the advisor chat route's `reviewActionProposalSchema`
 * (the AI SDK tool inputSchema in Task 5.7): the review gate stays the only
 * path to a posted voucher.
 */
export interface ReviewActionProposal {
  /** The review-queue item the action targets — the advisor never posts directly. */
  reviewId: string;
  voucherId: string;
  reviewTitle: string;
  /** Only approvals are proposable today; rejections stay a human-initiated queue action. */
  action: "approve";
  /** Drafted decision-time correction, shaped like `reviewDecisionEditSchema` (account/VAT for the approval card). */
  edited: ReviewDecisionEdit;
  /** Reasoning copied verbatim from the stored suggestion — provenance, not generation. */
  reasoning: string;
  /** Suggestion confidence copied verbatim (0–1). */
  confidence: number;
  /** Gross amount for the approval card's Money rendering, when the caller knows it. */
  grossAmount: number | null;
}

export type DemoTurnPart =
  | { type: "text"; text: string }
  | { type: "provenance"; passages: KnowledgePassage[] }
  | { type: "propose-review-action"; toolCallId: string; proposal: ReviewActionProposal }
  | { type: "tool-result"; toolCallId: string; approved: boolean; resultText: string };

/**
 * Structural view of a pending review (contracts' `ReviewTask` is assignable).
 * `grossAmount` is an optional enrichment the API adapter can add from the
 * voucher it already holds.
 */
export interface PendingReviewLike {
  id: string;
  voucherId: string;
  title: string;
  // `| undefined` keeps zod-inferred optionals (`T | undefined`) assignable under exactOptionalPropertyTypes.
  suggestion?:
    | {
        accountNumber: string;
        accountName: string;
        vatCode: string;
        reasoning: string;
        confidence: number;
      }
    | undefined;
  grossAmount?: number | undefined;
}

/** The human's answer to a previously streamed proposal, echoed back by the adapter. */
export interface DemoApprovalInput {
  toolCallId: string;
  approved: boolean;
  proposal: ReviewActionProposal;
}

export interface DemoAdvisorTurnInput {
  question: string;
  /** Factual block from `buildAdvisorGrounding` — embedded verbatim so answers only contain copied numbers. */
  grounding: string;
  passages: readonly KnowledgePassage[];
  pendingReview?: PendingReviewLike;
  approval?: DemoApprovalInput;
}

/** Questions matching this with a pending review present yield a propose-review-action part. */
export const REVIEW_ACTION_PATTERN = /godkänn|bokför|review|approve/i;

const TOPIC_TEMPLATES: readonly { pattern: RegExp; intro: string }[] = [
  {
    pattern: /representation/i,
    intro: "Så här ser reglerna för representation ut, tillsammans med läget i din bokföring.",
  },
  { pattern: /moms|vat/i, intro: "Här är momsläget enligt ditt senaste rapportpaket, med reglerna som styr det." },
  { pattern: /kassa|likvid|cash|runway/i, intro: "Så här ser kassaläget ut enligt rapportpaketet." },
  { pattern: /deadline|datum|frist|när/i, intro: "Här är de datum som gäller närmast, med källorna som styr dem." },
];

const DEFAULT_INTRO = "Här är en faktabaserad sammanställning ur din bokföring.";

function buildProposal(pendingReview: PendingReviewLike): ReviewActionProposal | undefined {
  const suggestion = pendingReview.suggestion;
  if (!suggestion) return undefined;
  return {
    reviewId: pendingReview.id,
    voucherId: pendingReview.voucherId,
    reviewTitle: pendingReview.title,
    action: "approve",
    edited: {
      accountNumber: suggestion.accountNumber,
      accountName: suggestion.accountName,
      vatCode: suggestion.vatCode,
    },
    reasoning: suggestion.reasoning,
    confidence: suggestion.confidence,
    grossAmount: pendingReview.grossAmount ?? null,
  };
}

function buildApprovalParts(approval: DemoApprovalInput): DemoTurnPart[] {
  const { proposal } = approval;
  if (approval.approved) {
    return [
      {
        type: "tool-result",
        toolCallId: approval.toolCallId,
        approved: true,
        resultText: `Granskningen "${proposal.reviewTitle}" godkändes via granskningskön (konto ${proposal.edited.accountNumber} ${proposal.edited.accountName}, momskod ${proposal.edited.vatCode}).`,
      },
      {
        type: "text",
        text: "Klart. Beslutet gick genom den vanliga granskningsgrinden, så verifikationen och händelsekedjan uppdaterades append-only. Säg till om du vill ta nästa post i kön.",
      },
    ];
  }
  return [
    {
      type: "tool-result",
      toolCallId: approval.toolCallId,
      approved: false,
      resultText: `Förslaget för "${proposal.reviewTitle}" avvisades — ingenting bokfördes.`,
    },
    {
      type: "text",
      text: "Ingen åtgärd utfördes. Posten ligger kvar i granskningskön för ditt manuella beslut.",
    },
  ];
}

/**
 * Build one deterministic demo advisor turn.
 *
 * - `approval` present → tool-result + closing text (the two-turn approval flow's second turn).
 * - Question matches `REVIEW_ACTION_PATTERN` and a pending review with a
 *   suggestion exists → short text + propose-review-action (approval-requested).
 * - Otherwise → templated answer embedding the grounding block, the top
 *   passage citation, and a provenance part when passages exist.
 */
export function buildDemoAdvisorTurn(input: DemoAdvisorTurnInput): DemoTurnPart[] {
  if (input.approval) {
    return buildApprovalParts(input.approval);
  }

  if (REVIEW_ACTION_PATTERN.test(input.question) && input.pendingReview) {
    const proposal = buildProposal(input.pendingReview);
    if (proposal) {
      return [
        {
          type: "text",
          text: `Jag har förberett ett godkännande av "${proposal.reviewTitle}". Kontrollera kontering och moms nedan — ingenting bokförs förrän du uttryckligen godkänner.`,
        },
        { type: "propose-review-action", toolCallId: `demo-tool-${proposal.reviewId}`, proposal },
      ];
    }
    return [
      {
        type: "text",
        text: `"${input.pendingReview.title}" saknar ett färdigt konteringsförslag, så den behöver hanteras manuellt i granskningskön.\n\n${input.grounding}`,
      },
    ];
  }

  const template = TOPIC_TEMPLATES.find((entry) => entry.pattern.test(input.question));
  const intro = template?.intro ?? DEFAULT_INTRO;
  const topPassage = input.passages[0];
  const citation = topPassage ? `\n\nUr ${topPassage.source}: "${topPassage.excerpt}"` : "";

  const parts: DemoTurnPart[] = [{ type: "text", text: `${intro}\n\n${input.grounding}${citation}` }];
  if (input.passages.length > 0) {
    parts.push({ type: "provenance", passages: [...input.passages] });
  }
  return parts;
}
