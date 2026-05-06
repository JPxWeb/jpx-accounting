import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { ZodType } from "zod";

import {
  assistantRequestSchema,
  evidenceComposeInputSchema,
  evidenceCreateInputSchema,
  knowledgeQuerySchema,
  reviewDecisionInputSchema,
  simulationRequestSchema,
  suggestionRequestSchema,
  type ApiJsonErrorBody,
  type ApiValidationIssue,
  type RuntimeMode,
  uploadInitSchema,
} from "@jpx-accounting/contracts";
import { AiRuntimeUnavailableError, type AiRuntime, isAiRuntimeOperational } from "@jpx-accounting/ai-core";
import type { LedgerStore, ReviewAction } from "@jpx-accounting/domain";
import { MemoryLedgerStore } from "@jpx-accounting/domain";

import type { CorsRuntimePolicy } from "./config";
import { isLedgerStoreOperational, LedgerStoreUnavailableError } from "./runtime";

type CreateAppOptions = {
  store: LedgerStore;
  aiRuntime: AiRuntime;
  runtimeMode: RuntimeMode;
  corsPolicy: CorsRuntimePolicy;
  allowTestReset?: boolean;
};

type AppVariables = { requestId: string };
type AppEnv = { Variables: AppVariables };

const DEFAULT_JSON_BODY_BYTES = 512 * 1024;
const SIE_IMPORT_BODY_BYTES = 32 * 1024 * 1024;

class ApiValidationError extends Error {
  readonly code = "validation_error" as const;

  constructor(
    message: string,
    readonly issues: ApiValidationIssue[],
  ) {
    super(message);
    this.name = "ApiValidationError";
  }
}

async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HTTPException(400, { message: "Request body must be valid JSON." });
  }
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    const issues: ApiValidationIssue[] = parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)),
      message: issue.message,
    }));
    const summary =
      issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") ||
      "Invalid request body";

    throw new ApiValidationError(summary, issues);
  }

  return parsed.data;
}

function buildSIEExport(store: LedgerStore) {
  const reports = store.getReports();
  const lines = ["#FLAGGA 0", '#PROGRAM "JPX Accounting" "0.1.0"', "#FORMAT PC8"];

  for (const entry of reports.journal) {
    lines.push(`#VER A "${entry.voucherId}" "${entry.bookedAt.slice(0, 10)}" "${entry.description}"`);
    lines.push(`#TRANS ${entry.accountNumber} {} ${entry.debit - entry.credit}`);
  }

  return lines.join("\n");
}

type JsonErrorExtras = Partial<Pick<ApiJsonErrorBody, "code" | "issues">>;

function jsonError(
  c: Context<AppEnv>,
  message: string,
  runtimeMode: RuntimeMode,
  status: number,
  extras?: JsonErrorExtras,
) {
  const requestId = c.var.requestId;
  const headers = new Headers();
  headers.set("x-request-id", requestId);
  return Response.json(
    {
      error: message,
      runtimeMode,
      requestId,
      ...extras,
    },
    { status, headers },
  );
}

export function createApp({ store, aiRuntime, runtimeMode, corsPolicy, allowTestReset }: CreateAppOptions) {
  const app = new Hono<AppEnv>();
  let currentStore = store;

  async function postReviewDecision(c: Context<AppEnv>, reviewId: string, outcome: ReviewAction) {
    const input = await parseBody(c.req.raw, reviewDecisionInputSchema);
    const review = currentStore.applyReviewDecision(reviewId, outcome, input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return c.json(review);
  }

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.header("x-request-id", requestId);
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (corsPolicy.kind === "wildcard") {
          return "*";
        }
        if (!origin) {
          return "";
        }
        return corsPolicy.origins.includes(origin) ? origin : "";
      },
    }),
  );

  app.use("/api/imports/sie", async (c, next) => {
    if (!["POST", "PUT", "PATCH"].includes(c.req.method)) {
      return next();
    }
    return bodyLimit({
      maxSize: SIE_IMPORT_BODY_BYTES,
      onError: (inner) => jsonError(inner, "Request body too large.", runtimeMode, 413),
    })(c, next);
  });

  const defaultJsonBodyLimit = bodyLimit({
    maxSize: DEFAULT_JSON_BODY_BYTES,
    onError: (c) => jsonError(c, "Request body too large.", runtimeMode, 413),
  });

  app.use("/api/*", async (c, next) => {
    if (!["POST", "PUT", "PATCH"].includes(c.req.method)) {
      return next();
    }
    if (c.req.path === "/api/imports/sie") {
      return next();
    }
    return defaultJsonBodyLimit(c, next);
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    }),
  );

  app.onError((error, c) => {
    if (error instanceof ApiValidationError) {
      return jsonError(c, error.message, runtimeMode, 400, { code: error.code, issues: error.issues });
    }

    if (error instanceof HTTPException) {
      return jsonError(c, error.message, runtimeMode, error.status);
    }

    if (error instanceof LedgerStoreUnavailableError || error instanceof AiRuntimeUnavailableError) {
      return jsonError(c, error.message, runtimeMode, 503);
    }

    const requestId = c.var.requestId;
    console.error(
      JSON.stringify({
        level: "error",
        component: "api",
        requestId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );

    return jsonError(c, "Unexpected server error.", runtimeMode, 500);
  });

  app.get("/health", (context) => context.json({ ok: true, runtimeMode }));

  app.get("/ready", (context) => {
    const ledgerOk = isLedgerStoreOperational(currentStore);
    const aiOk = isAiRuntimeOperational(aiRuntime);
    const ready = ledgerOk && aiOk;
    return context.json({
      ready,
      runtimeMode,
      checks: { ledger: ledgerOk, ai: aiOk },
    });
  });

  app.get("/api/workspace", (context) => context.json(currentStore.getSnapshot()));
  app.get("/api/reviews/feed", (context) => context.json(currentStore.getReviewFeed()));
  app.get("/api/reports/journal", (context) => context.json(currentStore.getReports().journal));
  const reportBalances = (context: Context<AppEnv>) => context.json(currentStore.getReports().balances);
  app.get("/api/reports/general-ledger", reportBalances);
  app.get("/api/reports/trial-balance", reportBalances);
  app.get("/api/reports/vat-prep", (context) => context.json(currentStore.getReports().vat));

  app.post("/api/evidence", async (context) => {
    const input = await parseBody(context.req.raw, evidenceCreateInputSchema);
    return context.json(currentStore.createEvidence(input), 201);
  });

  app.post("/api/evidence/compose", async (context) => {
    const input = await parseBody(context.req.raw, evidenceComposeInputSchema);
    return context.json(currentStore.composeEvidence(input), 201);
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
    const extraction = currentStore.getEvidenceContext(context.req.param("id"));
    if (!extraction) throw new HTTPException(404, { message: "Evidence not found" });

    return context.json({
      extracted: Boolean(extraction.voucher),
      ...extraction,
    });
  });

  app.post("/api/vouchers/:id/suggest", async (context) => {
    await parseBody(context.req.raw, suggestionRequestSchema);
    const suggestion = currentStore.suggestVoucher(context.req.param("id"));
    if (!suggestion) throw new HTTPException(404, { message: "Voucher not found" });
    return context.json(suggestion);
  });

  app.post("/api/reviews/:id/approve", (c) => postReviewDecision(c, c.req.param("id"), "approve"));

  app.post("/api/reviews/:id/reject", (c) => postReviewDecision(c, c.req.param("id"), "reject"));

  app.post("/api/reviews/:id/book-without-vat", (c) => postReviewDecision(c, c.req.param("id"), "book-without-vat"));

  app.post("/api/imports/sie", async (context) => {
    const body = await context.req.text();
    return context.json({
      accepted: true,
      importedTransactions: body.split("\n").filter((line) => line.startsWith("#TRANS")).length,
    });
  });

  app.get("/api/exports/sie", (context) => {
    context.header("content-type", "text/plain; charset=utf-8");
    return context.body(buildSIEExport(currentStore));
  });

  app.post("/api/assistant/sessions", async (context) => {
    const input = await parseBody(context.req.raw, assistantRequestSchema);
    const snapshot = currentStore.getSnapshot();
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
    return context.json({
      query: input.query,
      citations: currentStore.getSnapshot().assistantExamples[0]?.citations ?? [],
      answer:
        "Knowledge queries are routed through the same grounded advisory stack; next step is indexing effective-dated internal and official documents into Azure AI Search.",
    });
  });

  app.post("/api/simulations/run", async (context) => {
    const input = await parseBody(context.req.raw, simulationRequestSchema);
    return context.json(currentStore.runSimulation(input), 201);
  });

  app.post("/api/close-runs", (context) => context.json(currentStore.getCloseRun(), 201));
  app.get("/api/close-runs/:id", (context) =>
    context.json({
      ...currentStore.getCloseRun(),
      id: context.req.param("id"),
    }),
  );

  app.post("/api/compliance-watch/refresh", (context) => context.json(currentStore.getSnapshot().alerts));

  app.post("/api/testing/reset", (context) => {
    if (!allowTestReset || runtimeMode !== "demo" || !(currentStore instanceof MemoryLedgerStore)) {
      throw new HTTPException(404, { message: "Not found" });
    }

    currentStore = new MemoryLedgerStore();
    return context.json({ ok: true });
  });

  if (runtimeMode === "demo") {
    app.use("/mcp", async (c, next) => {
      if (c.req.method !== "POST") {
        return next();
      }
      return defaultJsonBodyLimit(c, next);
    });

    app.post("/mcp", async (context) => {
      const body = await context.req.json().catch(() => ({}));
      return context.json({
        server: "jpx-accounting",
        tools: ["lookup_policy", "lookup_vat_rule", "lookup_supplier_history", "query_reports", "run_simulation"],
        request: body,
      });
    });
  }

  return app;
}
