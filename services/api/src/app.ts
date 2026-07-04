import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { jwk } from "hono/jwk";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";
import type { ZodType } from "zod";

import {
  assistantRequestSchema,
  companySettingsSchema,
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
import type { DocumentIntelligenceClient } from "@jpx-accounting/document-intelligence";
import { pickModelForDocument } from "@jpx-accounting/document-intelligence";
import type { LedgerStore, ReportRange, ReviewAction } from "@jpx-accounting/domain";
import {
  buildSieExport,
  currentMonthToken,
  decodeSieBuffer,
  encodePc8,
  InvalidPeriodTokenError,
  InvalidReviewEditError,
  MemoryLedgerStore,
  nowIso,
  parseSie,
  ReviewNotFoundError,
  SieImportError,
  today,
} from "@jpx-accounting/domain";

import type { BlobUploader } from "./blob";
import { MAX_UPLOAD_BYTES, UploadValidationError } from "./blob";
import type { CorsRuntimePolicy } from "./config";
import { isLedgerStoreOperational, LedgerStoreUnavailableError } from "./runtime";

type CreateAppOptions = {
  store: LedgerStore;
  aiRuntime: AiRuntime;
  runtimeMode: RuntimeMode;
  corsPolicy: CorsRuntimePolicy;
  blobUploader: BlobUploader;
  documentIntelligence: DocumentIntelligenceClient;
  /**
   * JWKS endpoint (typically `${SUPABASE_URL}/auth/v1/keys`). When provided, mutating routes
   * require a valid JWT. When absent, mutations stay open — current demo + pilot behavior.
   */
  jwksUrl?: string | undefined;
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

const REPORT_DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the optional `from`/`to` report-window query params (inclusive
 * `YYYY-MM-DD` day strings). Absent params keep the historical unfiltered
 * behavior; malformed days or an inverted window are well-formed requests
 * that are semantically unprocessable → 422 (CONVENTIONS Rule 16).
 */
function parseReportRange(c: Context<AppEnv>): ReportRange | undefined {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from === undefined && to === undefined) return undefined;
  for (const [name, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (value !== undefined && !REPORT_DAY_PARAM.test(value)) {
      throw new HTTPException(422, { message: `Invalid "${name}" query parameter: expected YYYY-MM-DD.` });
    }
  }
  if (from !== undefined && to !== undefined && from > to) {
    throw new HTTPException(422, {
      message: `Invalid report range: "from" (${from}) must not be after "to" (${to}).`,
    });
  }
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
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

export function createApp({
  store,
  aiRuntime,
  runtimeMode,
  corsPolicy,
  blobUploader,
  documentIntelligence,
  jwksUrl,
  allowTestReset,
}: CreateAppOptions) {
  const app = new Hono<AppEnv>();
  let currentStore = store;

  async function postReviewDecision(c: Context<AppEnv>, reviewId: string, outcome: ReviewAction) {
    const input = await parseBody(c.req.raw, reviewDecisionInputSchema);
    const review = await currentStore.applyReviewDecision(reviewId, outcome, input);
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

  // Stub blob uploads (PUT /api/uploads/:uploadId) carry file bytes, not JSON — they get their own
  // limit below, matching MAX_UPLOAD_BYTES, instead of the 512 KiB JSON ceiling.
  const isStubUploadPut = (c: Context<AppEnv>) => c.req.method === "PUT" && /^\/api\/uploads\/[^/]+$/.test(c.req.path);

  app.use("/api/*", async (c, next) => {
    if (!["POST", "PUT", "PATCH"].includes(c.req.method)) {
      return next();
    }
    if (c.req.path === "/api/imports/sie") {
      return next();
    }
    if (isStubUploadPut(c)) {
      return next();
    }
    return defaultJsonBodyLimit(c, next);
  });

  if (blobUploader.kind === "stub") {
    const uploadBodyLimit = bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (inner) => jsonError(inner, "Request body too large.", runtimeMode, 413),
    });
    app.use("/api/uploads/:uploadId", async (c, next) => {
      if (!isStubUploadPut(c)) {
        return next();
      }
      return uploadBodyLimit(c, next);
    });
  }

  // Rate-limit only the mutating surface so health/ready probes and read-only GETs are unaffected.
  // 60 mutations per minute per IP fits an interactive single-user pilot — bump when scale-out lands
  // and switch to a Redis-backed store (e.g. @hono-rate-limiter/redis against Azure Cache).
  const apiMutationLimiter = rateLimiter<AppEnv>({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    keyGenerator: (c) => {
      const xff = c.req.header("x-forwarded-for");
      if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
      return c.req.header("x-real-ip") ?? "unknown";
    },
    handler: (c) => jsonError(c, "Too many requests.", runtimeMode, 429),
  });
  app.use("/api/*", async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      return next();
    }
    // Test instances (ALLOW_TEST_RESET) are exempt: the sequential E2E suite
    // legitimately exceeds 60 mutations/min from one IP and started flaking
    // with 429s on /api/testing/reset once the capture pipeline became real.
    if (allowTestReset) {
      return next();
    }
    return apiMutationLimiter(c, next);
  });

  // JWKS-backed JWT auth on mutating routes when configured. The middleware ships with Hono
  // (`hono/jwk`); against Supabase the JWKS URL is `${SUPABASE_URL}/auth/v1/keys`. Default alg is
  // RS256 — the most common asymmetric setting; ES256 projects can fork via env if needed.
  // Skipped when unset so demo / unauthenticated pilots keep working — production sets the env.
  if (jwksUrl) {
    const verifyJwt = jwk({ jwks_uri: jwksUrl, alg: ["RS256"] });
    app.use("/api/*", async (c, next) => {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
        return next();
      }
      // /api/testing/reset is route-gated on allowTestReset already, but layering JWT defense in
      // depth costs nothing and matches the plan's hardening intent.
      return verifyJwt(c, next);
    });
  }

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

    if (error instanceof UploadValidationError) {
      return jsonError(c, error.message, runtimeMode, 400, { code: error.code });
    }

    if (error instanceof HTTPException) {
      return jsonError(c, error.message, runtimeMode, error.status);
    }

    if (error instanceof ReviewNotFoundError) {
      return jsonError(c, error.message, runtimeMode, 404, { code: "review_not_found" });
    }

    if (error instanceof InvalidReviewEditError) {
      // Well-formed JSON but semantically unprocessable amounts → 422 (Rule 16).
      return jsonError(c, error.message, runtimeMode, 422, {
        code: "invalid_review_edit",
        issues: error.issues.map((message) => ({ path: ["edited"], message })),
      });
    }

    if (error instanceof SieImportError) {
      // Whole-file bound violations → 422; per-voucher problems never throw
      // (they land in the result's `skipped` list instead — Rule 21).
      return jsonError(c, error.message, runtimeMode, 422, { code: "sie_import_error" });
    }

    if (error instanceof InvalidPeriodTokenError) {
      // Unknown/malformed ?period= token → 422 (Rule 16).
      return jsonError(c, error.message, runtimeMode, 422, { code: "invalid_period_token" });
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

  app.get("/api/workspace", async (context) => context.json(await currentStore.getSnapshot()));
  app.get("/api/reviews/feed", async (context) => context.json(await currentStore.getReviewFeed()));
  // Report routes accept an optional inclusive ?from=&to= day window (no
  // params → unfiltered, the historical shape the api.spec pins rely on).
  app.get("/api/reports/journal", async (context) =>
    context.json((await currentStore.getReports(parseReportRange(context))).journal),
  );
  const reportBalances = async (context: Context<AppEnv>) =>
    context.json((await currentStore.getReports(parseReportRange(context))).balances);
  app.get("/api/reports/general-ledger", reportBalances);
  app.get("/api/reports/trial-balance", reportBalances);
  app.get("/api/reports/vat-prep", async (context) =>
    context.json((await currentStore.getReports(parseReportRange(context))).vat),
  );
  // ONE ReportPack per period is the reports screen's single source object.
  // ?period= takes the unified token grammar; default = the current calendar
  // month. Unknown tokens surface as 422 via InvalidPeriodTokenError.
  app.get("/api/reports/pack", async (context) => {
    const period = context.req.query("period") ?? currentMonthToken();
    return context.json(await currentStore.getReportPack({ period }));
  });

  app.post("/api/evidence", async (context) => {
    const input = await parseBody(context.req.raw, evidenceCreateInputSchema);
    return context.json(await currentStore.createEvidence(input), 201);
  });

  app.post("/api/evidence/compose", async (context) => {
    const input = await parseBody(context.req.raw, evidenceComposeInputSchema);
    return context.json(await currentStore.composeEvidence(input), 201);
  });

  app.post("/api/uploads/init", async (context) => {
    const input = await parseBody(context.req.raw, uploadInitSchema);
    const result = await blobUploader.initUpload(input);
    return context.json(result);
  });

  if (blobUploader.kind === "stub") {
    // Accept-and-discard PUT target for stub uploadUrls. The bytes genuinely travel over the wire
    // (so the client pipeline is exercised end-to-end) but storage is out of scope for stub mode —
    // previews come from the client-side evidence blob cache instead. `x-ms-blob-type` is NOT
    // required here: the web api-proxy strips it, and Azure PUTs go direct to the SAS URL anyway.
    app.put("/api/uploads/:uploadId", async (context) => {
      await context.req.arrayBuffer();
      return context.json({ ok: true, uploadId: context.req.param("uploadId") }, 201);
    });
  }

  app.post("/api/evidence/:id/extract", async (context) => {
    const evidenceId = context.req.param("id");
    const extraction = await currentStore.getEvidenceContext(evidenceId);
    if (!extraction) throw new HTTPException(404, { message: "Evidence not found" });

    // Only run Document Intelligence on uploads that actually live in blob storage. Demo/seed
    // evidence uses a synthetic blobPath that DocIntel cannot reach, so we keep returning the
    // canned extraction the LedgerStore already holds.
    const isRealBlob = extraction.evidence.blobPath.startsWith("evidence-uploads/");
    let liveExtraction: Awaited<ReturnType<typeof documentIntelligence.extract>> | undefined;
    if (isRealBlob) {
      try {
        const modelId = pickModelForDocument({
          filename: extraction.evidence.originalFilename,
          mimeType: extraction.evidence.mimeType,
        });
        // Mint a short-lived read SAS so Document Intelligence can fetch the blob without
        // storage account keys. StubBlobUploader returns a placeholder URL DocIntel cannot
        // fetch — that's intentional and harmless because the demo DocumentIntelligenceClient
        // also returns a stub (seeded from the hints below). Real OCR requires
        // AzureBlobUploader + the live DocIntel client.
        const sas = await blobUploader.mintReadSas(extraction.evidence.blobPath);
        liveExtraction = await documentIntelligence.extract({
          modelId,
          urlSource: sas.url,
          hints: {
            filename: extraction.evidence.originalFilename,
            sizeBytes: extraction.evidence.sizeBytes,
          },
        });
      } catch (error) {
        // Fail-soft: surface the error in logs but keep returning the stored extraction so the
        // reviewer is never blocked by a transient OCR outage.
        console.warn(
          JSON.stringify({
            level: "warn",
            component: "api.extract",
            message: "Document Intelligence extraction failed",
            evidenceId: extraction.evidence.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    // Persist the refreshed extraction instead of discarding it (Phase 3). The response stays a
    // superset of the pre-persistence shape ({extracted, evidence, packet?, voucher?, liveExtraction?})
    // and now also carries the regenerated `review`.
    if (liveExtraction && liveExtraction.fields.length > 0) {
      const updated = await currentStore.updateEvidenceExtraction(evidenceId, {
        modelId: liveExtraction.modelId,
        fields: liveExtraction.fields,
        extractedAt: nowIso(),
      });
      return context.json({
        extracted: Boolean((updated ?? extraction).voucher),
        ...(updated ?? extraction),
        liveExtraction,
      });
    }

    return context.json({
      extracted: Boolean(extraction.voucher),
      ...extraction,
      ...(liveExtraction ? { liveExtraction } : {}),
    });
  });

  // Read-only evidence context (no extraction side-effect): evidence joined to packet/voucher/review.
  app.get("/api/evidence/:id", async (context) => {
    const evidenceContext = await currentStore.getEvidenceContext(context.req.param("id"));
    if (!evidenceContext) throw new HTTPException(404, { message: "Evidence not found" });
    const review = evidenceContext.voucher
      ? await currentStore.findReviewByVoucher(evidenceContext.voucher.id)
      : undefined;
    return context.json({
      ...evidenceContext,
      ...(review ? { review } : {}),
    });
  });

  // Short-lived read SAS for previews. Only real Azure blobs qualify: the stub uploader discards
  // bytes (previews come from the client-side blob cache) and legacy/seed evidence has a synthetic
  // blobPath, so both answer 404 preview_unavailable.
  app.get("/api/evidence/:id/file-url", async (context) => {
    const evidenceContext = await currentStore.getEvidenceContext(context.req.param("id"));
    if (!evidenceContext) throw new HTTPException(404, { message: "Evidence not found" });
    const { blobPath } = evidenceContext.evidence;
    if (blobUploader.kind !== "azure" || !blobPath.startsWith("evidence-uploads/")) {
      return jsonError(context, "No file preview is available for this evidence.", runtimeMode, 404, {
        code: "preview_unavailable",
      });
    }
    const sas = await blobUploader.mintReadSas(blobPath);
    return context.json({ url: sas.url, expiresInSeconds: sas.expiresInSeconds });
  });

  app.post("/api/vouchers/:id/suggest", async (context) => {
    await parseBody(context.req.raw, suggestionRequestSchema);
    const suggestion = await currentStore.suggestVoucher(context.req.param("id"));
    if (!suggestion) throw new HTTPException(404, { message: "Voucher not found" });
    return context.json(suggestion);
  });

  app.post("/api/reviews/:id/approve", (c) => postReviewDecision(c, c.req.param("id"), "approve"));

  app.post("/api/reviews/:id/reject", (c) => postReviewDecision(c, c.req.param("id"), "reject"));

  app.post("/api/reviews/:id/book-without-vat", (c) => postReviewDecision(c, c.req.param("id"), "book-without-vat"));

  app.post("/api/imports/sie", async (context) => {
    // Raw file bytes, not JSON: decode (strict UTF-8 → CP437 fallback), parse
    // the SIE 4 subset, and let the store append VoucherImported events.
    // Deferred-auth identity matches the rest of the demo pipeline; override
    // via ?actorId= until real auth attribution lands.
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const parsed = parseSie(decodeSieBuffer(bytes));
    const actorId = context.req.query("actorId") ?? "user_founder";
    const result = await currentStore.importSie({ actorId, file: parsed });
    return context.json(result);
  });

  app.get("/api/exports/sie", async (context) => {
    const [reports, settings] = await Promise.all([currentStore.getReports(), currentStore.getCompanySettings()]);
    const text = buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso() });
    // Spec-valid PC8 (CP437) bytes — NOT UTF-8. `charset=ibm437` is the IANA
    // name browsers/tools recognize for CP437.
    context.header("content-type", "text/plain; charset=ibm437");
    context.header("content-disposition", `attachment; filename="jpx-export-${today()}.se"`);
    return context.body(encodePc8(text));
  });

  app.post("/api/assistant/sessions", async (context) => {
    const input = await parseBody(context.req.raw, assistantRequestSchema);
    const snapshot = await currentStore.getSnapshot();
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
    // Knowledge query is a placeholder until the Azure AI Search index ships
    // (foundation in migration 0003 + knowledge.documents table). Returning
    // citations from any other flow's data is wrong provenance in an audit
    // context (CONVENTIONS Rule 10). Return [] until real retrieval lands.
    return context.json({
      query: input.query,
      citations: [],
      answer:
        "Knowledge queries are routed through the same grounded advisory stack; next step is wiring the knowledge.documents table (0003 migration) to Azure AI Search.",
    });
  });

  app.post("/api/simulations/run", async (context) => {
    const input = await parseBody(context.req.raw, simulationRequestSchema);
    return context.json(await currentStore.runSimulation(input), 201);
  });

  app.post("/api/close-runs", async (context) => context.json(await currentStore.getCloseRun(), 201));
  app.get("/api/close-runs/:id", async (context) =>
    context.json({
      ...(await currentStore.getCloseRun()),
      id: context.req.param("id"),
    }),
  );

  app.post("/api/compliance-watch/refresh", async (context) => {
    // Default-exclude resolved/dismissed (CONVENTIONS Rule 26); ?includeResolved=true for all.
    const includeResolved = context.req.query("includeResolved") === "true";
    const all = await currentStore.refreshComplianceAlerts();
    const visible = includeResolved ? all : all.filter((a) => a.status === "open" || a.status === "acknowledged");
    return context.json(visible);
  });

  app.get("/api/settings/company", async (context) => {
    const settings = await currentStore.getCompanySettings();
    if (!settings) return context.json(null);
    return context.json(settings);
  });

  app.put("/api/settings/company", async (context) => {
    const input = await parseBody(context.req.raw, companySettingsSchema);
    const saved = await currentStore.putCompanySettings(input);
    return context.json(saved);
  });

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
