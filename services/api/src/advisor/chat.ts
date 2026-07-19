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
  type KnowledgeQueryResult,
  type RuntimeMode,
} from "@jpx-accounting/contracts";
import {
  UNTRUSTED_DATA_PROMPT_CLAUSE,
  buildAdvisorGrounding,
  buildDemoAdvisorTurn,
  delimitUntrustedText,
  hasRetrievableContent,
  retrieveKnowledge,
  sanitizeUntrustedText,
  type DemoTurnPart,
  type PendingReviewLike,
  type ReviewActionProposal,
} from "@jpx-accounting/advisor";
import {
  buildTaxTimeline,
  currentMonthToken,
  defaultCoaTemplate,
  DEMO_ACTOR_ID,
  findCoaAccount,
  getVatRegime,
  today,
  validEditVatCodes,
  type LedgerStore,
} from "@jpx-accounting/domain";
import { buildObservations } from "@jpx-accounting/reporting";

import { queryKnowledge } from "../knowledge";

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

/** Cost envelope (WS-D): default output-token cap per normal-mode turn. */
export const DEFAULT_ADVISOR_MAX_OUTPUT_TOKENS = 2048;
/** Cost envelope (WS-D): default wall-clock ceiling for one normal-mode stream. */
export const DEFAULT_ADVISOR_STREAM_TIMEOUT_MS = 90_000;
/** History truncation: at most this many non-system messages reach the model. */
export const MAX_MODEL_HISTORY_MESSAGES = 20;
/** History truncation: serialized non-system history is capped at 96 KiB. */
export const MAX_MODEL_HISTORY_BYTES = 96 * 1024;
/**
 * Vector passages below this cosine similarity are dropped from advisor
 * grounding — pgvector always returns nearest neighbours, even for smalltalk,
 * so a floor keeps content-free queries from dressing up in sources (the
 * keyword path gets the same property from its stopword gate).
 */
export const ADVISOR_VECTOR_MIN_SIMILARITY = 0.25;
/** Grounding passages per turn — matches services/api/src/knowledge.ts. */
const RETRIEVAL_TOP_K = 4;

export type AdvisorStreamLimits = { maxOutputTokens: number; streamTimeoutMs: number };

/**
 * Resolve the cost-envelope knobs from env (ADVISOR_MAX_OUTPUT_TOKENS,
 * ADVISOR_STREAM_TIMEOUT_MS). Called once at handler creation; malformed
 * values throw at boot instead of silently running uncapped (§A N5 fail
 * closed — a typo must not disable the cost envelope).
 */
export function resolveAdvisorStreamLimits(env: NodeJS.ProcessEnv = process.env): AdvisorStreamLimits {
  const parsePositiveInt = (name: string, raw: string | undefined, fallback: number): number => {
    const trimmed = raw?.trim();
    if (!trimmed) return fallback;
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${name} ${JSON.stringify(raw)} — expected a positive integer.`);
    }
    return value;
  };
  return {
    maxOutputTokens: parsePositiveInt(
      "ADVISOR_MAX_OUTPUT_TOKENS",
      env.ADVISOR_MAX_OUTPUT_TOKENS,
      DEFAULT_ADVISOR_MAX_OUTPUT_TOKENS,
    ),
    streamTimeoutMs: parsePositiveInt(
      "ADVISOR_STREAM_TIMEOUT_MS",
      env.ADVISOR_STREAM_TIMEOUT_MS,
      DEFAULT_ADVISOR_STREAM_TIMEOUT_MS,
    ),
  };
}

/**
 * Truncate chat history for the model call: drop the OLDEST non-system
 * messages first until both the message-count and byte bounds hold. System
 * messages are always kept (the advisor's own system prompt travels separately
 * via `streamText({ system })`, but a client-supplied system message must not
 * silently vanish mid-conversation), and the newest message is kept
 * unconditionally so a single oversized turn still reaches the model — the
 * per-message 8 KiB bound in `parseAdvisorBody` keeps that safe.
 */
export function truncateAdvisorHistory(
  messages: UIMessage[],
  bounds: { maxMessages?: number; maxTotalBytes?: number } = {},
): UIMessage[] {
  const { maxMessages = MAX_MODEL_HISTORY_MESSAGES, maxTotalBytes = MAX_MODEL_HISTORY_BYTES } = bounds;
  const encoder = new TextEncoder();
  const kept = new Set<UIMessage>();
  let count = 0;
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "system") {
      kept.add(message);
      continue;
    }
    const size = encoder.encode(JSON.stringify(message)).byteLength;
    if (count > 0 && (count >= maxMessages || bytes + size > maxTotalBytes)) continue;
    kept.add(message);
    count += 1;
    bytes += size;
  }
  return messages.filter((message) => kept.has(message));
}

/** One structured advisor log line (mirrors api.knowledge's JSON-line style). */
function logAdvisor(level: "info" | "warn", message: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, component: "api.advisor", message, ...fields });
  if (level === "warn") console.warn(line);
  else console.log(line);
}

const PROPOSE_REVIEW_ACTION_TOOL = "proposeReviewAction";
const PROPOSE_REVIEW_ACTION_PART_TYPE = `tool-${PROPOSE_REVIEW_ACTION_TOOL}` as const;

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
  /**
   * Normal-mode passage retrieval seam (tests/DI). Default: pgvector cosine
   * search via `queryKnowledge` (ai-core `embed()` + keyword fallback — never
   * throws through to the route). Demo mode always uses the bundled keyword
   * corpus and ignores this.
   */
  retrievePassages?: ((question: string) => Promise<KnowledgePassage[]>) | undefined;
  /** Cost-envelope overrides (tests). Default: `resolveAdvisorStreamLimits(process.env)`. */
  maxOutputTokens?: number | undefined;
  streamTimeoutMs?: number | undefined;
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
 * Server-side re-validation of a MODEL-AUTHORED proposal at execute time (WS-D
 * R21). The HMAC approval only proves a human clicked "approve" on what was
 * streamed — it does not prove the streamed args match store truth. Re-load
 * the review + voucher from the store and check, against the SAME registries
 * the review-edit path uses (`findCoaAccount` on the CoA template,
 * `validEditVatCodes` on the VAT regime — see `resolveReviewDecisionEdit`),
 * that the target still exists, is still undecided, and carries valid
 * account/VAT values. Returns a human-readable rejection reason, or
 * `undefined` when the proposal is valid.
 */
export async function validateProposalAgainstStore(
  store: LedgerStore,
  proposal: ReviewActionProposal,
): Promise<string | undefined> {
  const snapshot = await store.getSnapshot();

  const review = snapshot.reviews.find((item) => item.id === proposal.reviewId);
  if (!review) {
    return `Granskningen "${proposal.reviewTitle}" (${proposal.reviewId}) finns inte i arbetsytan — ingenting bokfördes.`;
  }
  if (review.voucherId !== proposal.voucherId) {
    return `Förslaget pekar på fel verifikat (${proposal.voucherId}, granskningen gäller ${review.voucherId}) — ingenting bokfördes.`;
  }
  if (review.status !== "needs-review") {
    return `Granskningen "${proposal.reviewTitle}" är redan avgjord (${review.status}) — ingenting bokfördes.`;
  }
  const voucher = snapshot.vouchers.find((item) => item.id === review.voucherId);
  if (!voucher) {
    return `Verifikatet (${review.voucherId}) för granskningen finns inte — ingenting bokfördes.`;
  }
  // Belt and braces: the zod inputSchema already pins the literal.
  if (proposal.action !== "approve") {
    return `Åtgärden "${String(proposal.action)}" stöds inte — ingenting bokfördes.`;
  }
  if (!findCoaAccount(defaultCoaTemplate, proposal.edited.accountNumber)) {
    return `Konto ${proposal.edited.accountNumber} finns inte i kontoplanen (${defaultCoaTemplate.id}) — ingenting bokfördes.`;
  }
  const vatVocabulary = validEditVatCodes(getVatRegime(defaultCoaTemplate.country));
  if (!vatVocabulary.has(proposal.edited.vatCode)) {
    return `Momskoden ${proposal.edited.vatCode} är inte giltig (tillåtna: ${[...vatVocabulary].join(", ")}) — ingenting bokfördes.`;
  }
  return undefined;
}

/**
 * The ONE mutation the advisor can trigger — the existing review decision,
 * and only ever after an explicit human approval (append-only + review gate).
 * Model-authored args are re-validated against store truth first (R21); an
 * invalid or stale proposal yields a clear tool-result error instead of a
 * mutation. `actorId` is the SERVER-derived identity threaded from the route
 * (WS-C R5 — same derivation as a direct review decision: verified `user:<sub>`
 * with auth on, the demo sentinel otherwise); it defaults to the sentinel for
 * demo/offline callers. Exported for regression tests — this is exactly the
 * function the normal-mode tool `execute` runs after HMAC approval.
 */
export async function executeReviewApproval(
  store: LedgerStore,
  proposal: ReviewActionProposal,
  actorId: string = DEMO_ACTOR_ID,
): Promise<ReviewActionOutcome> {
  const rejection = await validateProposalAgainstStore(store, proposal);
  if (rejection) {
    return { approved: false, resultText: rejection };
  }

  const review = await store.applyReviewDecision(proposal.reviewId, "approve", {
    actorId,
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

/** Length caps for passage fields in the prompt (excerpts are ≤ ~320 chars by construction). */
const PASSAGE_EXCERPT_PROMPT_CAP = 400;
const PASSAGE_LABEL_PROMPT_CAP = 200;

/**
 * Article 50-honest system prompt: the advisor is a labeled AI, grounded in
 * copied numbers, and can only PROPOSE review actions that a human approves.
 *
 * Injection posture (WS-D R22): `grounding` must be built with
 * `formatUntrusted: delimitUntrustedText` so evidence-derived strings arrive
 * sanitized and wrapped in `«»`; the prompt carries the clause declaring that
 * delimited content is DATA. Passage fields are corpus-sourced (checked-in
 * docs or the ingested copy of them) but are still stripped of control/format
 * characters and length-capped — cheap insurance for future non-repo corpora.
 * Exported for regression tests.
 */
export function buildSystemPrompt(grounding: string, passages: readonly KnowledgePassage[]): string {
  const passageBlock =
    passages.length === 0
      ? "KUNSKAPSUTDRAG: inga träffar för frågan."
      : [
          "KUNSKAPSUTDRAG (citera källan ordagrant när du använder ett utdrag):",
          ...passages.map((passage) => {
            const title = sanitizeUntrustedText(passage.title, PASSAGE_LABEL_PROMPT_CAP);
            const source = sanitizeUntrustedText(passage.source, PASSAGE_LABEL_PROMPT_CAP);
            const excerpt = sanitizeUntrustedText(passage.excerpt, PASSAGE_EXCERPT_PROMPT_CAP);
            return `- [${passage.id}] ${title} — ${source}: "${excerpt}"`;
          }),
        ].join("\n");

  return [
    [
      "Du är JPX Accountings AI-rådgivare för svensk bokföring (BAS-kontoplan, Bokföringslagen, Skatteverkets regler).",
      "Var öppen med att du är en AI (EU AI Act artikel 50) och presentera aldrig AI-utdata som mänskliga beslut.",
      "Du föreslår — du bokför aldrig. Den enda vägen till en bokförd verifikation är granskningskön:",
      `verktyget ${PROPOSE_REVIEW_ACTION_TOOL} skapar ett förslag som kräver användarens uttryckliga godkännande innan något utförs.`,
      "Använd ENDAST siffror ur FAKTAUNDERLAG nedan — beräkna aldrig egna belopp och gissa aldrig.",
      "Citera källorna (Skatteverket, Bokföringslagen, BAS) när du stödjer dig på kunskapsutdragen.",
      UNTRUSTED_DATA_PROMPT_CLAUSE,
      "Svara på svenska, kort och konkret.",
    ].join(" "),
    grounding,
    passageBlock,
  ].join("\n\n");
}

/**
 * Post-filter one `queryKnowledge` result for chat grounding: vector passages
 * below the cosine-similarity floor are dropped (pgvector always returns
 * nearest neighbours, relevant or not); keyword passages pass through — the
 * BM25 stopword gate already applied. Pure; exported for regression tests.
 */
export function selectChatPassages(result: KnowledgeQueryResult): KnowledgePassage[] {
  if (result.mode === "vector") {
    return result.passages.filter((passage) => passage.score >= ADVISOR_VECTOR_MIN_SIMILARITY);
  }
  return result.passages;
}

/**
 * Default normal-mode retrieval: the same pgvector-with-keyword-fallback
 * pattern as `POST /api/knowledge/query` (embed via ai-core `embed()`, cosine
 * search, keyword corpus on ANY failure — retrieval must never 500 the
 * advisor). Content-free queries (smalltalk) skip the embedding call entirely
 * and weak vector neighbours are dropped by the similarity floor.
 */
async function queryKnowledgePassagesForChat(question: string): Promise<KnowledgePassage[]> {
  if (!hasRetrievableContent(question)) return [];
  return selectChatPassages(await queryKnowledge(question));
}

/**
 * Retrieve grounding passages for one advisor turn. Demo mode stays on the
 * deterministic bundled corpus; normal mode goes through the vector path (or
 * an injected retriever) and falls back to the keyword corpus on ANY failure.
 */
async function retrieveChatPassages(question: string, options: AdvisorChatHandlerOptions): Promise<KnowledgePassage[]> {
  if (options.runtimeMode === "demo") {
    return retrieveKnowledge(question, { topK: RETRIEVAL_TOP_K });
  }
  try {
    const retrieve = options.retrievePassages ?? queryKnowledgePassagesForChat;
    return await retrieve(question);
  } catch (error) {
    logAdvisor("warn", "Passage retrieval failed — falling back to keyword passages", {
      error: error instanceof Error ? error.message : String(error),
    });
    return retrieveKnowledge(question, { topK: RETRIEVAL_TOP_K });
  }
}

/**
 * Per-request context threaded by the route (WS-C R5): the server-derived
 * actor for any approved proposeReviewAction execution. Optional so
 * demo/offline callers (and tests) fall back to the demo sentinel — the API
 * route always passes its `deriveActorId(...)` result.
 */
export type AdvisorRequestContext = { actorId?: string | undefined };

/**
 * Create the advisor chat request handler. Gate order: body bounds (400/422) →
 * aiPosture (403) → normal-mode configuration (503) → grounding → stream.
 */
export function createAdvisorChatHandler(
  options: AdvisorChatHandlerOptions,
): (request: Request, requestContext?: AdvisorRequestContext) => Promise<Response> {
  // Cost envelope resolved once at boot: malformed env throws here, not per request.
  const envLimits = resolveAdvisorStreamLimits();
  const maxOutputTokens = options.maxOutputTokens ?? envLimits.maxOutputTokens;
  const streamTimeoutMs = options.streamTimeoutMs ?? envLimits.streamTimeoutMs;

  return async (request, requestContext) => {
    const actorId = requestContext?.actorId ?? DEMO_ACTOR_ID;
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
    const passages = await retrieveChatPassages(question, options);
    const groundingInput = { pack, observations, deadlines, pendingReviews };

    if (options.runtimeMode === "demo") {
      // Demo grounding is DISPLAY text (no LLM) — untrusted values stay verbatim.
      const grounding = buildAdvisorGrounding(groundingInput);
      const approvalResponse = findApprovalResponse(messages);

      if (approvalResponse) {
        // Demo replay intentionally skips HMAC: MemoryLedgerStore exposes the
        // same applyReviewDecision path the review-queue button already uses,
        // so forging an approval here grants no privilege an anonymous demo
        // user lacks (§A C8). Normal mode MUST use streamText +
        // experimental_toolApprovalSecret below instead.
        //
        // Human answered the proposal: execute through the review gate on
        // approval, or skip entirely on denial. Executed BEFORE streaming so
        // store errors surface as proper HTTP errors, not mid-stream noise.
        const outcome = approvalResponse.approved
          ? await executeReviewApproval(store, approvalResponse.proposal, actorId)
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
    // review-gate path as demo mode — after execute-time re-validation (R21).
    const model = options.model!;
    // LLM-bound grounding: untrusted evidence-derived strings are sanitized
    // and wrapped in the «» DATA delimiters (WS-D R22).
    const promptGrounding = buildAdvisorGrounding({ ...groundingInput, formatUntrusted: delimitUntrustedText });
    // Best-effort request correlation: app.ts mints its own requestId when the
    // client sent none; the raw header is all this handler can see.
    const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
    const tools = {
      [PROPOSE_REVIEW_ACTION_TOOL]: tool({
        description:
          "Föreslå att en post i granskningskön godkänns. Förslaget kräver användarens uttryckliga godkännande; " +
          "vid godkännande bokförs posten via den vanliga granskningsgrinden (applyReviewDecision). " +
          "Kopiera kontering, moms och resonemang ordagrant från det lagrade förslaget — hitta aldrig på värden.",
        inputSchema: reviewActionProposalSchema,
        execute: async (proposal): Promise<ReviewActionOutcome> => executeReviewApproval(store, proposal, actorId),
      }),
    };

    // Cost/abort envelope (WS-D): the client disconnecting aborts the model
    // call immediately, and a wall-clock timeout bounds the whole stream.
    const abortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(streamTimeoutMs)]);

    // experimental_toolApprovalSecret is the sole normal-mode forgery guard (§A N7).
    // It is an unstable `experimental_` AI SDK 7 API — pin upgrades, monitor
    // release notes, and restore an equivalent server-side HMAC check if the flag
    // is renamed or removed.
    const result = streamText({
      model,
      system: buildSystemPrompt(promptGrounding, passages),
      // Oldest-first truncation; the system prompt above always travels whole.
      messages: await convertToModelMessages(truncateAdvisorHistory(messages), {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
      tools,
      toolApproval: { [PROPOSE_REVIEW_ACTION_TOOL]: "user-approval" },
      experimental_toolApprovalSecret: options.toolApprovalSecret,
      abortSignal,
      maxOutputTokens,
      onAbort: () => {
        logAdvisor("warn", "Advisor stream aborted (client disconnect or timeout)", { requestId, streamTimeoutMs });
      },
      onFinish: ({ totalUsage, finishReason }) => {
        logAdvisor("info", "Advisor turn finished", {
          requestId,
          finishReason,
          usage: {
            inputTokens: totalUsage.inputTokens ?? null,
            outputTokens: totalUsage.outputTokens ?? null,
            totalTokens: totalUsage.totalTokens ?? null,
          },
        });
      },
    });

    // R23: stream the SAME provenance part shape the demo emits
    // (`data-provenance` with `{ passages }` — see demoTurnResponse above and
    // apps/web/components/advisor/local-demo-transport.ts). Grounding sources
    // are known before the model streams, so the part is written up front.
    // Approval-response replays continue the previous assistant message
    // (originalMessages persistence mode) which already carries its provenance
    // part — re-emitting would duplicate the chips.
    const isContinuationTurn = messages.at(-1)?.role === "assistant";
    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        if (!isContinuationTurn && passages.length > 0) {
          writer.write({ type: "data-provenance", data: { passages: [...passages] } });
        }
        writer.merge(result.toUIMessageStream({ sendStart: false }));
      },
    });
    return createUIMessageStreamResponse({ stream });
  };
}
