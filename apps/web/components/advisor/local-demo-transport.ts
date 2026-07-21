import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import {
  buildAdvisorGrounding,
  buildDemoAdvisorTurn,
  retrieveKnowledge,
  type DemoTurnPart,
  type KnowledgePassage,
  type PendingReviewLike,
  type ReviewActionProposal,
} from "@jpx-accounting/advisor";
import { DEFAULT_AI_POSTURE, DEFAULT_WORKSPACE_PROFILE } from "@jpx-accounting/contracts";
import { buildTaxTimeline, currentMonthToken, today } from "@jpx-accounting/domain";
import { buildObservations } from "@jpx-accounting/reporting";

import { apiClient } from "../../lib/client";

/**
 * Offline-demo advisor transport (Task 5.9, plan finding 10): when the
 * api-client's in-memory fallback store is active (demo mode without an API
 * base URL) `useChat` cannot POST anywhere, so this `ChatTransport` replays
 * `buildDemoAdvisorTurn` parts client-side as UI-message chunks.
 *
 * `services/api/src/advisor/chat.ts` is the REFERENCE implementation — the
 * grounding assembly, part naming (`data-provenance`, `tool-proposeReviewAction`),
 * approval-id shape (`${toolCallId}-approval`), tool output
 * (`{ approved, resultText }`), and denial mapping (`tool-output-denied`)
 * mirror it 1:1 so the demo transport and the server stream are
 * indistinguishable to the UI.
 *
 * Invariant (append-only + review gate): the streamed proposal executes
 * NOTHING. Only an explicit human approval response — `addToolApprovalResponse`
 * flipping the tool part to `approval-responded`, and `sendAutomaticallyWhen`
 * re-sending the history — reaches `apiClient.approveReview(...)`, which is the
 * fallback store's ordinary `applyReviewDecision(reviewId, "approve", ...)`.
 */

/** Tool + part names — MUST match services/api/src/advisor/chat.ts. */
export const PROPOSE_REVIEW_ACTION_TOOL = "proposeReviewAction";
export const PROPOSE_REVIEW_ACTION_PART_TYPE = `tool-${PROPOSE_REVIEW_ACTION_TOOL}` as const;

const ADVISOR_APPROVAL_NOTES = "Approved via advisor";

/** The tool output shape both modes stream, so the client renders one confirmation row. */
export type ReviewActionOutcome = { approved: boolean; resultText: string };

/** Custom data parts the advisor streams (`data-provenance`). */
export type AdvisorDataParts = {
  provenance: { passages: KnowledgePassage[] };
};

/** Typed tool set for `tool-proposeReviewAction` parts. */
export type AdvisorTools = {
  proposeReviewAction: {
    input: ReviewActionProposal;
    output: ReviewActionOutcome;
  };
};

/** The advisor chat's UI message type — shared by transport, chat, and storage. */
export type AdvisorUIMessage = UIMessage<unknown, AdvisorDataParts, AdvisorTools>;

/** The `tool-proposeReviewAction` part union member (all invocation states). */
export type AdvisorToolPart = Extract<
  AdvisorUIMessage["parts"][number],
  { type: typeof PROPOSE_REVIEW_ACTION_PART_TYPE }
>;

type ApprovalResponse = {
  toolCallId: string;
  approved: boolean;
  proposal: ReviewActionProposal;
};

/** Latest non-empty user question, newest first — mirrors the server route. */
function latestUserQuestion(messages: AdvisorUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * The human's answer to a previously streamed proposal: `addToolApprovalResponse`
 * flips the tool part on the LAST assistant message to `approval-responded`,
 * and `sendAutomaticallyWhen` re-sends the history through this transport.
 */
function findApprovalResponse(messages: AdvisorUIMessage[]): ApprovalResponse | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;

  for (const part of last.parts) {
    if (part.type !== PROPOSE_REVIEW_ACTION_PART_TYPE) continue;
    if (part.state !== "approval-responded" || typeof part.approval?.approved !== "boolean") continue;
    return { toolCallId: part.toolCallId, approved: part.approval.approved, proposal: part.input };
  }
  return undefined;
}

/**
 * Map deterministic demo-turn parts onto the AI SDK UI-message chunk protocol —
 * the exact sequence `demoTurnResponse` writes server-side. `turnKey` keeps
 * text-part ids unique across turns (message count grows monotonically).
 */
export function demoTurnToChunks(parts: DemoTurnPart[], turnKey: string): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [{ type: "start" }];
  let textIndex = 0;
  for (const part of parts) {
    switch (part.type) {
      case "text": {
        const id = `demo-text-${turnKey}-${textIndex}`;
        textIndex += 1;
        chunks.push({ type: "text-start", id }, { type: "text-delta", id, delta: part.text }, { type: "text-end", id });
        break;
      }
      case "provenance": {
        chunks.push({ type: "data-provenance", data: { passages: part.passages } });
        break;
      }
      case "propose-review-action": {
        // Tool part lands in the approval-requested state: input first, then
        // the approval request. Nothing executes until the human answers.
        chunks.push(
          {
            type: "tool-input-available",
            toolCallId: part.toolCallId,
            toolName: PROPOSE_REVIEW_ACTION_TOOL,
            input: part.proposal,
          },
          {
            type: "tool-approval-request",
            approvalId: `${part.toolCallId}-approval`,
            toolCallId: part.toolCallId,
          },
        );
        break;
      }
      case "tool-result": {
        if (part.approved) {
          chunks.push({
            type: "tool-output-available",
            toolCallId: part.toolCallId,
            output: { approved: true, resultText: part.resultText } satisfies ReviewActionOutcome,
          });
        } else {
          chunks.push({ type: "tool-output-denied", toolCallId: part.toolCallId });
        }
        break;
      }
    }
  }
  chunks.push({ type: "finish" });
  return chunks;
}

/**
 * Build one deterministic demo turn from the fallback store's data — the
 * client twin of the server route's demo branch (grounding assembled from the
 * same snapshot + current-month pack + statutory timeline + observations +
 * BM25 passages; numbers are copied, never computed here).
 */
async function buildTurnParts(messages: AdvisorUIMessage[]): Promise<DemoTurnPart[]> {
  const settings = await apiClient.getCompanySettings();
  const aiPosture = settings?.aiPosture ?? DEFAULT_AI_POSTURE;
  if (!aiPosture.advisorEnabled) {
    // The screen hides the chat when the advisor is off; this guard keeps the
    // transport honest if a message slips through anyway (server twin: 403).
    throw new Error("The AI advisor is disabled for this workspace. Enable it under Settings → AI posture.");
  }

  const profile = settings?.profile ?? DEFAULT_WORKSPACE_PROFILE;
  const localToday = today();
  const [snapshot, pack] = await Promise.all([apiClient.getSnapshot(), apiClient.getReportPack(currentMonthToken())]);
  const deadlines = buildTaxTimeline({ profile, today: localToday });
  const observations = buildObservations({ pack, snapshot, deadlines, today: localToday });
  const pendingReviews = snapshot.reviews.filter((review) => review.status === "needs-review");
  const question = latestUserQuestion(messages);
  const passages = retrieveKnowledge(question, { topK: 4 });
  const grounding = buildAdvisorGrounding({ pack, observations, deadlines, pendingReviews });

  const approvalResponse = findApprovalResponse(messages);
  if (approvalResponse) {
    // Human answered the proposal: execute through the review gate on
    // approval (the ordinary applyReviewDecision via the api-client fallback),
    // or skip entirely on denial.
    let approved = false;
    if (approvalResponse.approved) {
      // No actorId (WS-C R5): the fallback store attributes to the demo sentinel.
      const review = await apiClient.approveReview(approvalResponse.proposal.reviewId, {
        notes: ADVISOR_APPROVAL_NOTES,
        edited: approvalResponse.proposal.edited,
      });
      approved = Boolean(review);
    }
    return buildDemoAdvisorTurn({
      question,
      grounding,
      passages,
      approval: { toolCallId: approvalResponse.toolCallId, approved, proposal: approvalResponse.proposal },
    });
  }

  const firstPending = pendingReviews[0];
  const pendingReview: PendingReviewLike | undefined = firstPending
    ? {
        ...firstPending,
        grossAmount: snapshot.vouchers.find((voucher) => voucher.id === firstPending.voucherId)?.voucherFields
          .grossAmount,
      }
    : undefined;

  return buildDemoAdvisorTurn({
    question,
    grounding,
    passages,
    ...(pendingReview ? { pendingReview } : {}),
  });
}

function chunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

/** ChatTransport replaying the deterministic demo advisor entirely client-side. */
export class LocalDemoChatTransport implements ChatTransport<AdvisorUIMessage> {
  async sendMessages(options: { messages: AdvisorUIMessage[] }): Promise<ReadableStream<UIMessageChunk>> {
    const parts = await buildTurnParts(options.messages);
    return chunkStream(demoTurnToChunks(parts, String(options.messages.length)));
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Demo turns are synchronous replays — there is never a stream to resume.
    return Promise.resolve(null);
  }
}
