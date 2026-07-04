import assert from "node:assert/strict";
import { test } from "node:test";

import type { DemoTurnPart, KnowledgePassage } from "@jpx-accounting/advisor";
import {
  FALLBACK_PROMPT_KEYS,
  buildAdvisorGrounding,
  buildDemoAdvisorTurn,
  suggestedPromptKeys,
} from "@jpx-accounting/advisor";
import type { ReportPack, ReviewTask } from "@jpx-accounting/contracts";

const pack: ReportPack = {
  period: { token: "2026-06", kind: "month", from: "2026-06-01", to: "2026-06-30" },
  profitLoss: {
    period: { from: "2026-06-01", to: "2026-06-30" },
    groups: [
      { key: "revenue", lines: [{ accountNumber: "3001", accountName: "Försäljning", amount: 42000 }], total: 42000 },
      {
        key: "externalCost",
        lines: [{ accountNumber: "6540", accountName: "IT-tjänster", amount: -12000 }],
        total: -12000,
      },
    ],
    operatingResult: 30000,
    financialNet: 0,
    periodResult: 30000,
  },
  balanceSheet: {
    asOf: "2026-06-30",
    assets: { key: "assets", lines: [], total: 55000 },
    equityAndLiabilities: { key: "equityAndLiabilities", lines: [], total: 25000 },
    computedResult: 30000,
    balanced: true,
  },
  vatReturn: [{ box: "49", label: "Moms att betala eller få tillbaka", amount: 8250 }],
  cashBridge: { opening: 20000, drivers: [], other: { amount: 35000, accountNumbers: [] }, closing: 55000 },
  monthly: [],
  generatedAt: "2026-07-04T00:00:00.000Z",
};

const pendingReview: ReviewTask = {
  id: "rev_1",
  voucherId: "v_1001",
  title: "Review V-1001",
  status: "needs-review",
  suggestedAction: "Approve the proposed posting.",
  suggestion: {
    id: "sug_1",
    voucherId: "v_1001",
    accountNumber: "6540",
    accountName: "IT-tjänster",
    vatCode: "SE25",
    confidence: 0.86,
    reasoning: "Subscription supplier matched the IT services rule.",
    kind: "recommendation",
    citations: [],
    ruleHits: [],
  },
  provenanceTimeline: [],
};

const passages: KnowledgePassage[] = [
  {
    id: "representation#1",
    docId: "representation",
    title: "Representation — avdrag och moms",
    excerpt: "Momsavdrag medges på ett underlag om högst 300 kronor exklusive moms per person och tillfälle.",
    source: "Skatteverket — Representation; inkomstskattelagen 16 kap. 2 §",
    url: "https://www.skatteverket.se/foretag/skatterochavdrag/avdragforforetag/representation",
    score: 5.1,
  },
];

const grounding = buildAdvisorGrounding({
  pack,
  observations: [
    {
      detector: "expense-anomaly",
      severity: "warning",
      titleKey: "observations.expenseAnomaly.title",
      params: { account: "6540", amount: 12000 },
    },
  ],
  deadlines: [{ kind: "vat-return", dueDate: "2026-08-17", periodLabel: "Q2 2026" }],
  pendingReviews: [pendingReview],
});

const isProposal = (part: DemoTurnPart): part is Extract<DemoTurnPart, { type: "propose-review-action" }> =>
  part.type === "propose-review-action";
const isToolResult = (part: DemoTurnPart): part is Extract<DemoTurnPart, { type: "tool-result" }> =>
  part.type === "tool-result";

test("grounding copies pack numbers, deadlines, observations, and the review queue", () => {
  assert.ok(grounding.includes("Period: 2026-06"));
  assert.ok(grounding.includes("Periodens resultat: 30000"));
  assert.ok(grounding.includes("Kassa (19xx) vid periodens slut: 55000 (ingående 20000)"));
  assert.ok(grounding.includes("Intäkter i perioden: 42000"));
  assert.ok(grounding.includes("Moms ruta 49: 8250"));
  assert.ok(grounding.includes("vat-return: 2026-08-17 (Q2 2026)"));
  assert.ok(
    grounding.includes("expense-anomaly (warning): observations.expenseAnomaly.title [account=6540, amount=12000]"),
  );
  assert.ok(grounding.includes("Granskningskö: 1 väntar på mänskligt beslut"));
  assert.ok(grounding.includes("Review V-1001 (rev_1) — förslag 6540 IT-tjänster, momskod SE25"));
});

test("plain question yields a deterministic text + provenance turn embedding the grounding", () => {
  const input = { question: "Hur ser kassan ut just nu?", grounding, passages };
  const turn = buildDemoAdvisorTurn(input);
  assert.deepEqual(turn, buildDemoAdvisorTurn(input), "same input must yield identical parts");

  assert.equal(turn.length, 2);
  const [text, provenance] = turn;
  assert.ok(text && text.type === "text");
  assert.ok(text.text.includes(grounding), "answer must embed the factual grounding block");
  assert.ok(text.text.includes(passages[0]!.source), "answer must cite the top passage source");
  assert.ok(provenance && provenance.type === "provenance");
  assert.deepEqual(provenance.passages, passages);
});

test("without passages the turn is text-only", () => {
  const turn = buildDemoAdvisorTurn({ question: "Vad hände i juni?", grounding, passages: [] });
  assert.equal(turn.length, 1);
  assert.equal(turn[0]!.type, "text");
});

test("approval-shaped question with a pending review proposes a review action, copied from the suggestion", () => {
  const turn = buildDemoAdvisorTurn({
    question: "Kan du godkänna granskningen?",
    grounding,
    passages: [],
    pendingReview,
  });
  assert.equal(turn.length, 2);
  assert.equal(turn[0]!.type, "text");
  const proposalPart = turn.find(isProposal);
  assert.ok(proposalPart, "expected a propose-review-action part");
  assert.equal(proposalPart.toolCallId, "demo-tool-rev_1");
  assert.deepEqual(proposalPart.proposal, {
    reviewId: "rev_1",
    voucherId: "v_1001",
    reviewTitle: "Review V-1001",
    action: "approve",
    edited: { accountNumber: "6540", accountName: "IT-tjänster", vatCode: "SE25" },
    reasoning: "Subscription supplier matched the IT services rule.",
    confidence: 0.86,
    grossAmount: null,
  });
  assert.ok(!turn.some(isToolResult), "nothing may execute before the human approves");
});

test("gross-amount enrichment flows into the proposal; 'bokför' also triggers", () => {
  const turn = buildDemoAdvisorTurn({
    question: "bokför den senaste fakturan",
    grounding,
    passages: [],
    pendingReview: { ...pendingReview, grossAmount: 1249 },
  });
  const proposalPart = turn.find(isProposal);
  assert.ok(proposalPart);
  assert.equal(proposalPart.proposal.grossAmount, 1249);
});

test("approval-shaped question without a pending review stays a plain grounded answer", () => {
  const turn = buildDemoAdvisorTurn({ question: "Kan du godkänna något?", grounding, passages: [] });
  assert.ok(!turn.some(isProposal));
  assert.equal(turn[0]!.type, "text");
});

test("pending review without a suggestion falls back to an honest manual-handling answer", () => {
  const { suggestion: _omitted, ...bare } = pendingReview;
  const turn = buildDemoAdvisorTurn({ question: "godkänn granskningen", grounding, passages: [], pendingReview: bare });
  assert.equal(turn.length, 1);
  assert.ok(turn[0]!.type === "text" && turn[0]!.text.includes("manuellt"));
  assert.ok(!turn.some(isProposal));
});

test("two-turn approval flow: proposal, then approved tool-result + closing text", () => {
  const first = buildDemoAdvisorTurn({ question: "godkänn granskningen", grounding, passages: [], pendingReview });
  const proposalPart = first.find(isProposal);
  assert.ok(proposalPart);

  const second = buildDemoAdvisorTurn({
    question: "",
    grounding,
    passages: [],
    approval: { toolCallId: proposalPart.toolCallId, approved: true, proposal: proposalPart.proposal },
  });
  assert.equal(second.length, 2);
  const result = second.find(isToolResult);
  assert.ok(result);
  assert.equal(result.toolCallId, proposalPart.toolCallId);
  assert.equal(result.approved, true);
  assert.ok(result.resultText.includes("Review V-1001"));
  assert.ok(result.resultText.includes("6540"));
  const closing = second.find((part) => part.type === "text");
  assert.ok(closing && closing.type === "text" && closing.text.includes("granskningsgrinden"));
});

test("rejected approval yields a no-action tool-result and leaves the queue item alone", () => {
  const first = buildDemoAdvisorTurn({ question: "approve the review", grounding, passages: [], pendingReview });
  const proposalPart = first.find(isProposal);
  assert.ok(proposalPart);

  const second = buildDemoAdvisorTurn({
    question: "",
    grounding,
    passages: [],
    approval: { toolCallId: proposalPart.toolCallId, approved: false, proposal: proposalPart.proposal },
  });
  const result = second.find(isToolResult);
  assert.ok(result);
  assert.equal(result.approved, false);
  assert.ok(result.resultText.includes("avvisades"));
  const closing = second.find((part) => part.type === "text");
  assert.ok(closing && closing.type === "text" && closing.text.includes("manuella"));
});

test("suggestedPromptKeys maps ranked observations, dedupes, and tops up from the fallback trio", () => {
  assert.deepEqual(suggestedPromptKeys([]), [...FALLBACK_PROMPT_KEYS]);

  assert.deepEqual(
    suggestedPromptKeys([{ detector: "cash-runway" }, { detector: "cash-runway" }, { detector: "vat-set-aside" }]),
    ["advisor.prompts.cashRunway", "advisor.prompts.vatSetAside", "advisor.prompts.cashPosition"],
  );

  assert.deepEqual(
    suggestedPromptKeys([
      { detector: "deadline-proximity" },
      { detector: "missing-evidence" },
      { detector: "supplier-spike" },
      { detector: "expense-anomaly" },
    ]),
    ["advisor.prompts.deadlineProximity", "advisor.prompts.missingEvidence", "advisor.prompts.supplierSpike"],
  );

  // Unknown detectors are skipped, not emitted as broken keys.
  assert.deepEqual(suggestedPromptKeys([{ detector: "not-a-detector" }]), [...FALLBACK_PROMPT_KEYS]);
});
