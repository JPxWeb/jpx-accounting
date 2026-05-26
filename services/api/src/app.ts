import { type AiRuntime, AiRuntimeUnavailableError } from "@jpx-accounting/ai-core";
import {
  assistantRequestSchema,
  companySettingsSchema,
  evidenceComposeInputSchema,
  evidenceCreateInputSchema,
  knowledgeQuerySchema,
  type RuntimeMode,
  reviewDecisionInputSchema,
  simulationRequestSchema,
  suggestionRequestSchema,
  uploadInitSchema,
} from "@jpx-accounting/contracts";
import type { LedgerStore } from "@jpx-accounting/domain";
import { MemoryLedgerStore, NotImplementedInSupabaseStore } from "@jpx-accounting/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { ZodType } from "zod";
import { createBlobUploadInit } from "./blob-upload";
import type { ApiRuntimeConfig } from "./config";
import { authMiddleware } from "./middleware/auth";
import { LedgerStoreUnavailableError } from "./runtime";
import type { LedgerStoreScope } from "./store-factory";

type CreateAppOptions = {
  runtimeMode: RuntimeMode;
  aiRuntime: AiRuntime;
  createLedgerStore: (scope: LedgerStoreScope) => LedgerStore;
  demoStoreRef: { current: MemoryLedgerStore };
  apiConfig: ApiRuntimeConfig;
  allowTestReset?: boolean | undefined;
  supabaseUrl?: string | undefined;
  supabaseSecretKey?: string | undefined;
  skipAuthVerification?: boolean | undefined;
};

async function parseBody<T>(request: Request, schema: ZodType<T>) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HTTPException(400, { message: "Request body must be valid JSON." });
  }
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.flatten().formErrors.join(", ") || "Invalid request body" });
  }

  return parsed.data;
}

async function buildSIEExport(store: LedgerStore) {
  const reports = await store.getReports();
  const lines = ["#FLAGGA 0", '#PROGRAM "JPX Accounting" "0.1.0"', "#FORMAT PC8"];

  for (const entry of reports.journal) {
    lines.push(`#VER A "${entry.voucherId}" "${entry.bookedAt.slice(0, 10)}" "${entry.description}"`);
    lines.push(`#TRANS ${entry.accountNumber} {} ${entry.debit - entry.credit}`);
  }

  return lines.join("\n");
}

function createErrorResponse(message: string, runtimeMode: RuntimeMode, status: number) {
  return Response.json(
    {
      error: message,
      runtimeMode,
    },
    { status },
  );
}

export function createApp({
  runtimeMode,
  aiRuntime,
  createLedgerStore,
  demoStoreRef,
  apiConfig,
  allowTestReset,
  supabaseUrl,
  supabaseSecretKey,
  skipAuthVerification,
}: CreateAppOptions) {
  const app = new Hono();
  app.use("/api/*", cors());
  app.use(
    "/api/*",
    authMiddleware({
      runtimeMode,
      supabaseUrl,
      supabaseSecretKey,
      skipVerification: skipAuthVerification,
    }),
  );
  app.use("/api/*", async (context, next) => {
    const store = createLedgerStore({
      organizationId: context.get("organizationId"),
      workspaceId: context.get("workspaceId"),
      userId: context.get("userId"),
    });
    context.set("store", store);
    await next();
  });

  app.onError((error) => {
    if (error instanceof HTTPException) {
      return createErrorResponse(error.message, runtimeMode, error.status);
    }

    if (error instanceof LedgerStoreUnavailableError || error instanceof AiRuntimeUnavailableError) {
      return createErrorResponse(error.message, runtimeMode, 503);
    }

    if (error instanceof NotImplementedInSupabaseStore) {
      return createErrorResponse(error.message, runtimeMode, 501);
    }

    console.error(error);
    return createErrorResponse("Unexpected server error.", runtimeMode, 500);
  });

  app.get("/health", (context) => context.json({ ok: true, runtimeMode }));

  app.get("/api/workspace", async (context) => context.json(await context.get("store").getSnapshot()));
  app.get("/api/reviews/feed", async (context) => context.json(await context.get("store").getReviewFeed()));
  app.get("/api/reports/journal", async (context) => context.json((await context.get("store").getReports()).journal));
  app.get("/api/reports/general-ledger", async (context) => context.json(await context.get("store").getBalances()));
  app.get("/api/reports/trial-balance", async (context) => context.json(await context.get("store").getBalances()));
  app.get("/api/reports/vat-prep", async (context) => context.json(await context.get("store").getVat()));

  app.post("/api/evidence", async (context) => {
    const input = await parseBody(context.req.raw, evidenceCreateInputSchema);
    return context.json(await context.get("store").createEvidence(input), 201);
  });

  app.post("/api/evidence/compose", async (context) => {
    const input = await parseBody(context.req.raw, evidenceComposeInputSchema);
    return context.json(await context.get("store").composeEvidence(input), 201);
  });

  app.post("/api/uploads/init", async (context) => {
    const input = await parseBody(context.req.raw, uploadInitSchema);
    const evidenceId = crypto.randomUUID();
    const init = await createBlobUploadInit(apiConfig, input, {
      organizationId: context.get("organizationId"),
      evidenceId,
    });
    return context.json(init);
  });

  app.post("/api/evidence/:id/extract", async (context) => {
    const extraction = await context.get("store").getEvidenceContext(context.req.param("id"));
    if (!extraction) throw new HTTPException(404, { message: "Evidence not found" });

    return context.json({
      extracted: Boolean(extraction.voucher),
      ...extraction,
    });
  });

  app.post("/api/vouchers/:id/suggest", async (context) => {
    await parseBody(context.req.raw, suggestionRequestSchema);
    const suggestion = await context.get("store").suggestVoucher(context.req.param("id"));
    if (!suggestion) throw new HTTPException(404, { message: "Voucher not found" });
    return context.json(suggestion);
  });

  app.post("/api/reviews/:id/approve", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = await context.get("store").applyReviewDecision(context.req.param("id"), "approve", input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return context.json(review);
  });

  app.post("/api/reviews/:id/reject", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = await context.get("store").applyReviewDecision(context.req.param("id"), "reject", input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return context.json(review);
  });

  app.post("/api/reviews/:id/book-without-vat", async (context) => {
    const input = await parseBody(context.req.raw, reviewDecisionInputSchema);
    const review = await context.get("store").applyReviewDecision(context.req.param("id"), "book-without-vat", input);
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

  app.get("/api/exports/sie", async (context) => {
    context.header("content-type", "text/plain; charset=utf-8");
    return context.body(await buildSIEExport(context.get("store")));
  });

  app.post("/api/assistant/sessions", async (context) => {
    const input = await parseBody(context.req.raw, assistantRequestSchema);
    const snapshot = await context.get("store").getSnapshot();
    const citations = snapshot.reviews[0]?.suggestion?.citations ?? [
      {
        id: "internal_arch",
        title: "Internal architecture policy",
        sourceType: "internal",
        excerpt: "AI suggestions require human review before posting.",
      },
    ];
    const answer = await aiRuntime.answerQuestion(input.question, citations);
    return context.json(answer, 201);
  });

  app.post("/api/knowledge/query", async (context) => {
    const input = await parseBody(context.req.raw, knowledgeQuerySchema);
    const snapshot = await context.get("store").getSnapshot();
    return context.json({
      query: input.query,
      citations: snapshot.assistantExamples[0]?.citations ?? [],
      answer:
        "Knowledge queries are routed through the same grounded advisory stack; next step is indexing effective-dated internal and official documents into Azure AI Search.",
    });
  });

  app.post("/api/simulations/run", async (context) => {
    const input = await parseBody(context.req.raw, simulationRequestSchema);
    return context.json(await context.get("store").runSimulation(input), 201);
  });

  app.post("/api/close-runs", async (context) => context.json(await context.get("store").getCloseRun(), 201));
  app.get("/api/close-runs/:id", async (context) =>
    context.json({
      ...(await context.get("store").getCloseRun()),
      id: context.req.param("id"),
    }),
  );

  app.get("/api/settings/company", async (context) => context.json(await context.get("store").getCompanySettings()));

  app.put("/api/settings/company", async (context) => {
    const input = await parseBody(context.req.raw, companySettingsSchema);
    return context.json(await context.get("store").saveCompanySettings(input));
  });

  app.post("/api/compliance-watch/refresh", async (context) =>
    context.json(await context.get("store").refreshComplianceAlerts()),
  );

  app.post("/api/testing/reset", (context) => {
    if (!allowTestReset || runtimeMode !== "demo") {
      throw new HTTPException(404, { message: "Not found" });
    }

    demoStoreRef.current = new MemoryLedgerStore();
    return context.json({ ok: true });
  });

  app.post("/mcp", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    return context.json({
      server: "jpx-accounting",
      tools: ["lookup_policy", "lookup_vat_rule", "lookup_supplier_history", "query_reports", "run_simulation"],
      request: body,
    });
  });

  return app;
}
