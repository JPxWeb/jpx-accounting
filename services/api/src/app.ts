import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";

import {
  assistantRequestSchema,
  evidenceComposeInputSchema,
  evidenceCreateInputSchema,
  knowledgeQuerySchema,
  reviewDecisionInputSchema,
  simulationRequestSchema,
  suggestionRequestSchema,
  uploadInitSchema,
} from "@jpx-accounting/contracts";
import { createAiRuntime } from "@jpx-accounting/ai-core";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

let store = new MemoryLedgerStore();
const ai = createAiRuntime();

async function parseBody<T>(request: Request, schema: ZodType<T>) {
  const payload = await request.json();
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.flatten().formErrors.join(", ") || "Invalid request body" });
  }

  return parsed.data;
}

function buildSIEExport() {
  // Keep the scaffold export intentionally small but structurally valid so downstream accountant tooling can be exercised early.
  const reports = store.getReports();
  const lines = ["#FLAGGA 0", "#PROGRAM \"JPX Accounting\" \"0.1.0\"", "#FORMAT PC8"];

  for (const entry of reports.journal) {
    lines.push(`#VER A "${entry.voucherId}" "${entry.bookedAt.slice(0, 10)}" "${entry.description}"`);
    lines.push(`#TRANS ${entry.accountNumber} {} ${entry.debit - entry.credit}`);
  }

  return lines.join("\n");
}

function resetStore() {
  store = new MemoryLedgerStore();
}

export function createApp() {
  const app = new Hono();

  app.use("/api/*", cors());

  app.get("/health", (context) => context.json({ ok: true }));

  app.get("/api/workspace", (context) => context.json(store.getSnapshot()));
  app.get("/api/reviews/feed", (context) => context.json(store.getReviewFeed()));
  app.get("/api/reports/journal", (context) => context.json(store.getReports().journal));
  app.get("/api/reports/general-ledger", (context) => context.json(store.getReports().balances));
  app.get("/api/reports/trial-balance", (context) => context.json(store.getReports().balances));
  app.get("/api/reports/vat-prep", (context) => context.json(store.getReports().vat));

  app.post("/api/evidence", async (context) => {
    const input = await parseBody(context.req.raw, evidenceCreateInputSchema);
    return context.json(store.createEvidence(input), 201);
  });

  app.post("/api/evidence/compose", async (context) => {
    const input = await parseBody(context.req.raw, evidenceComposeInputSchema);
    return context.json(store.composeEvidence(input), 201);
  });

  app.post("/api/uploads/init", async (context) => {
    const input = await parseBody(context.req.raw, uploadInitSchema);
    return context.json({
      uploadId: crypto.randomUUID(),
      filename: input.filename,
      uploadUrl: `/api/uploads/${crypto.randomUUID()}`,
      expiresInSeconds: 900,
    });
  });

  app.post("/api/evidence/:id/extract", (context) => {
    const extraction = store.getEvidenceContext(context.req.param("id"));
    if (!extraction) throw new HTTPException(404, { message: "Evidence not found" });

    return context.json({
      extracted: Boolean(extraction.voucher),
      ...extraction,
    });
  });

  app.post("/api/vouchers/:id/suggest", async (context) => {
    await parseBody(context.req.raw, suggestionRequestSchema);
    const suggestion = store.suggestVoucher(context.req.param("id"));
    if (!suggestion) throw new HTTPException(404, { message: "Voucher not found" });
    return context.json(suggestion);
  });

  app.post("/api/reviews/:id/approve", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = store.applyReviewDecision(context.req.param("id"), "approve", input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return context.json(review);
  });

  app.post("/api/reviews/:id/reject", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = store.applyReviewDecision(context.req.param("id"), "reject", input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return context.json(review);
  });

  app.post("/api/reviews/:id/book-without-vat", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = store.applyReviewDecision(context.req.param("id"), "book-without-vat", input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return context.json(review);
  });

  app.post("/api/imports/sie", async (context) => {
    const body = await context.req.text();
    return context.json({
      accepted: true,
      importedTransactions: body.split("\n").filter((line) => line.startsWith("#TRANS")).length,
    });
  });

  app.get("/api/exports/sie", (context) => {
    context.header("content-type", "text/plain; charset=utf-8");
    return context.body(buildSIEExport());
  });

  app.post("/api/assistant/sessions", async (context) => {
    const input = await parseBody(context.req.raw, assistantRequestSchema);
    const snapshot = store.getSnapshot();
    const citations =
      snapshot.reviews[0]?.suggestion?.citations ?? [
        {
          id: "internal_arch",
          title: "Internal architecture policy",
          sourceType: "internal",
          excerpt: "AI suggestions require human review before posting.",
        },
      ];
    const answer = await ai.answerQuestion(input.question, citations);
    return context.json(answer, 201);
  });

  app.post("/api/knowledge/query", async (context) => {
    const input = await parseBody(context.req.raw, knowledgeQuerySchema);
    return context.json({
      query: input.query,
      citations: store.getSnapshot().assistantExamples[0]?.citations ?? [],
      answer:
        "Knowledge queries are routed through the same grounded advisory stack; next step is indexing effective-dated internal and official documents into Azure AI Search.",
    });
  });

  app.post("/api/simulations/run", async (context) => {
    const input = await parseBody(context.req.raw, simulationRequestSchema);
    return context.json(store.runSimulation(input), 201);
  });

  app.post("/api/close-runs", (context) => context.json(store.getCloseRun(), 201));
  app.get("/api/close-runs/:id", (context) =>
    context.json({
      ...store.getCloseRun(),
      id: context.req.param("id"),
    }),
  );

  app.post("/api/compliance-watch/refresh", (context) => context.json(store.getSnapshot().alerts));

  app.post("/api/testing/reset", (context) => {
    // This stays opt-in so local e2e coverage can reset the in-memory scaffold without exposing a production reset hook.
    if (process.env.ALLOW_TEST_RESET !== "true") {
      throw new HTTPException(404, { message: "Not found" });
    }

    resetStore();
    return context.json({ ok: true });
  });

  app.post("/mcp", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    return context.json({
      server: "jpx-accounting",
      tools: [
        "lookup_policy",
        "lookup_vat_rule",
        "lookup_supplier_history",
        "query_reports",
        "run_simulation",
      ],
      request: body,
    });
  });

  return app;
}
