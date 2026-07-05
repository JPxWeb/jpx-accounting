import { HTTPException } from "hono/http-exception";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  tool,
  validateUIMessages,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { z } from "zod";

import {
  DEFAULT_AI_POSTURE,
  DEFAULT_WORKSPACE_PROFILE,
  reviewDecisionEditSchema,
  type ApiValidationIssue,
  type KnowledgePassage,
  type RuntimeMode,
} from "@jpx-accounting/contracts";
import {
  buildAdvisorGrounding,
  buildDemoAdvisorTurn,
  retrieveKnowledge,
  type DemoTurnPart,
  type PendingReviewLike,
  type ReviewActionProposal,
} from "@jpx-accounting/advisor";
import { buildTaxTimeline, currentMonthToken, today, type LedgerStore } from "@jpx-accounting/domain";
import { buildObservations } from "@jpx-accounting/reporting";

/**
 * POST /api/advisor/chat (Task 5.7): AI SDK 7 UI-message SSE for the advisor.
 *
 * Demo mode synthesizes the stream from `buildDemoAdvisorTurn` (deterministic,
 * no LLM); normal mode streams Azure OpenAI via `streamText`. Both modes share
 * one invariant: the `proposeReviewAction` tool NEVER executes until an
 * explicit human approval response arrives, and execution is always the
 * existing `applyReviewDecision(reviewId, "approve", ...)` — the review gate
 * stays the only path to a posted voucher.
 */

/** Bounded body (finding: advisor requests carry full UI history): ≤ 40 messages. */
export const MAX_ADVISOR_MESSAGES = 40;
/** Per-message serialized ceiling: 8 KiB. */
export const MAX_ADVISOR_MESSAGE_BYTES = 8 * 1024;

const PROPOSE_REVIEW_ACTION_TOOL = "proposeReviewAction";
const PROPOSE_REVIEW_ACTION_PART_TYPE = `tool-${PROPOSE_REVIEW_ACTION_TOOL}` as const;

/** Deferred-auth identity, matching the rest of the demo pipeline (see /api/imports/sie). */
const ADVISOR_ACTOR_ID = "user_founder";
const ADVISOR_APPROVAL_NOTES = "Approved via advisor";

/**
 * Wire twin of the advisor package's `ReviewActionProposal` TS type — the
 * AI SDK tool `inputSchema`. Kept API-side on purpose: packages/advisor stays
 * zod-free/pure, the API owns wire validation.
 */
export const reviewActionProposalSchema = z.object({
  reviewId: z.string().min(1),
  voucherId: z.string().min(1),
  reviewTitle: z.string(),
  action: z.literal("approve"),
  edited: reviewDecisionEditSchema,
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
  grossAmount: z.number().nullable(),
});

// Compile-time sync check with the advisor package's declared wire twin.
type _ProposalContract = ReviewActionProposal extends z.infer<typeof reviewActionProposalSchema> ? true : never;
const _proposalContract: _ProposalContract = true;
void _proposalContract;

/** Semantically unprocessable advisor request → HTTP 422 with the validation_error body shape (Rule 16). */
export class AdvisorValidationError extends Error {
  readonly code = "validation_error" as const;

  constructor(
    message: string,
    readonly issues: ApiValidationIssue[],
  ) {
    super(message);
    this.name = "AdvisorValidationError";
  }
}

/** `aiPosture.advisorEnabled === false` → HTTP 403 with code `advisor_disabled`. */
export class AdvisorDisabledError extends Error {
  readonly code = "advisor_disabled" as const;

  constructor() {
    super("The AI advisor is disabled for this workspace. Enable it under Settings → AI posture.");
    this.name = "AdvisorDisabledError";
  }
}

const chatBodySchema = z.looseObject({
  messages: z
    .array(z.unknown())
    .min(1, "At least one message is required.")
    .max(MAX_ADVISOR_MESSAGES, `At most ${MAX_ADVISOR_MESSAGES} messages are accepted.`),
});

export type AdvisorChatHandlerOptions = {
  /** Late-bound store accessor: /api/testing/reset swaps the demo store instance. */
  getStore: () => LedgerStore;
  runtimeMode: RuntimeMode;
  /** Azure model for normal mode — undefined means unconfigured → 503. */
  model: LanguageModel | undefined;
  /** HMAC secret for AI SDK tool-approval signing (`experimental_toolApprovalSecret`). */
  toolApprovalSecret: string;
};

/** The tool output shape both modes stream, so the client renders one confirmation row. */
type ReviewActionOutcome = { approved: boolean; resultText: string };

async function parseAdvisorBody(request: Request): Promise<UIMessage[]> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HTTPException(400, { message: "Request body must be valid JSON." });
  }

  const parsed = chatBodySchema.safeParse(payload);
  if (!parsed.success) {
    throw new AdvisorValidationError(
      "Invalid advisor chat request body.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)),
        message: issue.message,
      })),
    );
  }

  const encoder = new TextEncoder();
  const oversized: ApiValidationIssue[] = [];
  parsed.data.messages.forEach((message, index) => {
    if (encoder.encode(JSON.stringify(message)).byteLength > MAX_ADVISOR_MESSAGE_BYTES) {
      oversized.push({
        path: ["messages", String(index)],
        message: `Message exceeds ${MAX_ADVISOR_MESSAGE_BYTES} bytes.`,
      });
    }
  });
  if (oversized.length > 0) {
    throw new AdvisorValidationError("Advisor chat messages exceed the per-message size bound.", oversized);
  }

  try {
    return await validateUIMessages({ messages: parsed.data.messages });
  } catch (error) {
    throw new AdvisorValidationError("Advisor chat messages are not valid UI messages.", [
      { path: ["messages"], message: error instanceof Error ? error.message : String(error) },
    ]);
  }
}

function latestUserQuestion(messages: UIMessage[]): string {
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

type ApprovalResponse = {
  toolCallId: string;
  approved: boolean;
  proposal: ReviewActionProposal;
};

/**
 * Demo mode reads the human's answer straight off the last assistant message:
 * `addToolApprovalResponse` flips the streamed tool part to
 * `approval-responded`, and `sendAutomaticallyWhen` re-POSTs the history.
 */
function findApprovalResponse(messages: UIMessage[]): ApprovalResponse | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;

  for (const part of last.parts) {
    if (part.type !== PROPOSE_REVIEW_ACTION_PART_TYPE) continue;
    if (part.state !== "approval-responded" || typeof part.approval?.approved !== "boolean") continue;

    const proposal = reviewActionProposalSchema.safeParse(part.input);
    if (!proposal.success) {
      throw new AdvisorValidationError("Tool approval response carries an invalid proposal payload.", [
        { path: ["messages"], message: "proposeReviewAction input does not match the proposal schema." },
      ]);
    }
    return { toolCallId: part.toolCallId, approved: part.approval.approved, proposal: proposal.data };
  }
  return undefined;
}

/**
 * The ONE mutation the advisor can trigger — the existing review decision,
 * and only ever after an explicit human approval (append-only + review gate).
 */
async function executeReviewApproval(store: LedgerStore, proposal: ReviewActionProposal): Promise<ReviewActionOutcome> {
  const review = await store.applyReviewDecision(proposal.reviewId, "approve", {
    actorId: ADVISOR_ACTOR_ID,
    notes: ADVISOR_APPROVAL_NOTES,
    edited: proposal.edited,
  });
  if (!review) {
    return {
      approved: false,
      resultText: `Granskningen "${proposal.reviewTitle}" hittades inte — ingenting bokfördes.`,
    };
  }
  return {
    approved: true,
    resultText: `Granskningen "${proposal.reviewTitle}" godkändes via granskningskön (konto ${proposal.edited.accountNumber} ${proposal.edited.accountName}, momskod ${proposal.edited.vatCode}).`,
  };
}

/**
 * Map deterministic demo-turn parts onto the AI SDK UI-message chunk protocol.
 * `turnKey` keeps text-part ids unique across turns of one conversation
 * (message count grows monotonically) while staying deterministic.
 */
function demoTurnResponse(parts: DemoTurnPart[], turnKey: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      let textIndex = 0;
      for (const part of parts) {
        switch (part.type) {
          case "text": {
            const id = `demo-text-${turnKey}-${textIndex}`;
            textIndex += 1;
            writer.write({ type: "text-start", id });
            writer.write({ type: "text-delta", id, delta: part.text });
            writer.write({ type: "text-end", id });
            break;
          }
          case "provenance": {
            writer.write({ type: "data-provenance", data: { passages: part.passages } });
            break;
          }
          case "propose-review-action": {
            // Tool part lands in the approval-requested state: input first,
            // then the approval request. Nothing executes until the human answers.
            writer.write({
              type: "tool-input-available",
              toolCallId: part.toolCallId,
              toolName: PROPOSE_REVIEW_ACTION_TOOL,
              input: part.proposal,
            });
            writer.write({
              type: "tool-approval-request",
              approvalId: `${part.toolCallId}-approval`,
              toolCallId: part.toolCallId,
            });
            break;
          }
          case "tool-result": {
            if (part.approved) {
              writer.write({
                type: "tool-output-available",
                toolCallId: part.toolCallId,
                output: { approved: true, resultText: part.resultText } satisfies ReviewActionOutcome,
              });
            } else {
              writer.write({ type: "tool-output-denied", toolCallId: part.toolCallId });
            }
            break;
          }
        }
      }
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * Article 50-honest system prompt: the advisor is a labeled AI, grounded in
 * copied numbers, and can only PROPOSE review actions that a human approves.
 */
function buildSystemPrompt(grounding: string, passages: readonly KnowledgePassage[]): string {
  const passageBlock =
    passages.length === 0
      ? "KUNSKAPSUTDRAG: inga träffar för frågan."
      : [
          "KUNSKAPSUTDRAG (citera källan ordagrant när du använder ett utdrag):",
          ...passages.map((passage) => `- [${passage.id}] ${passage.title} — ${passage.source}: "${passage.excerpt}"`),
        ].join("\n");

  return [
    [
      "Du är JPX Accountings AI-rådgivare för svensk bokföring (BAS-kontoplan, Bokföringslagen, Skatteverkets regler).",
      "Var öppen med att du är en AI (EU AI Act artikel 50) och presentera aldrig AI-utdata som mänskliga beslut.",
      "Du föreslår — du bokför aldrig. Den enda vägen till en bokförd verifikation är granskningskön:",
      `verktyget ${PROPOSE_REVIEW_ACTION_TOOL} skapar ett förslag som kräver användarens uttryckliga godkännande innan något utförs.`,
      "Använd ENDAST siffror ur FAKTAUNDERLAG nedan — beräkna aldrig egna belopp och gissa aldrig.",
      "Citera källorna (Skatteverket, Bokföringslagen, BAS) när du stödjer dig på kunskapsutdragen.",
      "Svara på svenska, kort och konkret.",
    ].join(" "),
    grounding,
    passageBlock,
  ].join("\n\n");
}

/**
 * Create the advisor chat request handler. Gate order: body bounds (400/422) →
 * aiPosture (403) → normal-mode configuration (503) → grounding → stream.
 */
export function createAdvisorChatHandler(options: AdvisorChatHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const messages = await parseAdvisorBody(request);
    const store = options.getStore();

    const settings = await store.getCompanySettings();
    const aiPosture = settings?.aiPosture ?? DEFAULT_AI_POSTURE;
    if (!aiPosture.advisorEnabled) {
      throw new AdvisorDisabledError();
    }

    if (options.runtimeMode !== "demo" && !options.model) {
      throw new HTTPException(503, {
        message: "Advisor chat is unavailable in normal mode until Azure OpenAI is configured.",
      });
    }

    // Per-request grounding: snapshot + current-month pack + statutory
    // timeline + deterministic observations + retrieved passages. Numbers are
    // copied from the pack (buildAdvisorGrounding) — never computed here.
    const profile = settings?.profile ?? DEFAULT_WORKSPACE_PROFILE;
    const localToday = today();
    const [snapshot, pack] = await Promise.all([
      store.getSnapshot(),
      store.getReportPack({ period: currentMonthToken() }),
    ]);
    const deadlines = buildTaxTimeline({ profile, today: localToday });
    const observations = buildObservations({ pack, snapshot, deadlines, today: localToday });
    const pendingReviews = snapshot.reviews.filter((review) => review.status === "needs-review");
    const question = latestUserQuestion(messages);
    const passages = retrieveKnowledge(question, { topK: 4 });
    const grounding = buildAdvisorGrounding({ pack, observations, deadlines, pendingReviews });

    if (options.runtimeMode === "demo") {
      const approvalResponse = findApprovalResponse(messages);

      if (approvalResponse) {
        // Human answered the proposal: execute through the review gate on
        // approval, or skip entirely on denial. Executed BEFORE streaming so
        // store errors surface as proper HTTP errors, not mid-stream noise.
        const outcome = approvalResponse.approved
          ? await executeReviewApproval(store, approvalResponse.proposal)
          : undefined;
        const parts = buildDemoAdvisorTurn({
          question,
          grounding,
          passages,
          approval: {
            toolCallId: approvalResponse.toolCallId,
            approved: outcome?.approved ?? false,
            proposal: approvalResponse.proposal,
          },
        });
        return demoTurnResponse(parts, String(messages.length));
      }

      const firstPending = pendingReviews[0];
      const pendingReview: PendingReviewLike | undefined = firstPending
        ? {
            ...firstPending,
            grossAmount: snapshot.vouchers.find((voucher) => voucher.id === firstPending.voucherId)?.voucherFields
              .grossAmount,
          }
        : undefined;

      const parts = buildDemoAdvisorTurn({
        question,
        grounding,
        passages,
        ...(pendingReview ? { pendingReview } : {}),
      });
      return demoTurnResponse(parts, String(messages.length));
    }

    // Normal mode: Azure OpenAI via AI SDK 7. Tool approval is call-level
    // ("user-approval") and HMAC-signed; approved calls execute the same
    // review-gate path as demo mode.
    const model = options.model!;
    const tools = {
      [PROPOSE_REVIEW_ACTION_TOOL]: tool({
        description:
          "Föreslå att en post i granskningskön godkänns. Förslaget kräver användarens uttryckliga godkännande; " +
          "vid godkännande bokförs posten via den vanliga granskningsgrinden (applyReviewDecision). " +
          "Kopiera kontering, moms och resonemang ordagrant från det lagrade förslaget — hitta aldrig på värden.",
        inputSchema: reviewActionProposalSchema,
        execute: async (proposal): Promise<ReviewActionOutcome> => executeReviewApproval(store, proposal),
      }),
    };

    const result = streamText({
      model,
      system: buildSystemPrompt(grounding, passages),
      messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
      tools,
      toolApproval: { [PROPOSE_REVIEW_ACTION_TOOL]: "user-approval" },
      experimental_toolApprovalSecret: options.toolApprovalSecret,
    });

    return result.toUIMessageStreamResponse({ originalMessages: messages });
  };
}
