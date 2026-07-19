import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { jwk } from "hono/jwk";
import { secureHeaders } from "hono/secure-headers";
import { rateLimiter } from "hono-rate-limiter";

import {
  companySettingsSchema,
  evidenceComposeInputSchema,
  evidenceCreateInputSchema,
  knowledgeQuerySchema,
  reviewDecisionInputSchema,
  type ReviewDecisionInput,
  simulationRequestSchema,
  suggestionRequestSchema,
  type ApiJsonErrorBody,
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
  DEMO_ACTOR_ID,
  encodePc8,
  InvalidPeriodTokenError,
  InvalidReviewEditError,
  MemoryLedgerStore,
  nowIso,
  parseSie,
  ReviewNotFoundError,
  SieImportError,
  summarizeEventIntegrity,
  today,
} from "@jpx-accounting/domain";

import { AdvisorDisabledError, AdvisorValidationError, createAdvisorChatHandler } from "./advisor/chat";
import { createAdvisorModel, type AdvisorModelConfig } from "./advisor/model";
import type { BlobUploader } from "./blob";
import { MAX_UPLOAD_BYTES, UploadValidationError } from "./blob";
import { DEFAULT_SUPABASE_JWT_ALGS, type CorsRuntimePolicy, type SupabaseJwtAlgorithm } from "./config";
import { queryKnowledge } from "./knowledge";
import type { AiRuntimeMetadata } from "./runtime";
import { LedgerStoreUnavailableError, pingLedgerStore } from "./runtime";
import { ApiValidationError, jsonValidated } from "./validation";

type CreateAppOptions = {
  store: LedgerStore;
  aiRuntime: AiRuntime;
  runtimeMode: RuntimeMode;
  corsPolicy: CorsRuntimePolicy;
  blobUploader: BlobUploader;
  documentIntelligence: DocumentIntelligenceClient;
  /** Transparency metadata for `GET /api/runtime-info` (provider/model/host — never secrets). */
  aiMetadata: AiRuntimeMetadata;
  /**
   * Advisor chat wiring (Task 5.7): HMAC secret for AI SDK tool-approval
   * signing + the Azure OpenAI slice for the normal-mode model. Demo mode
   * never touches the model; unconfigured normal mode answers 503.
   */
  advisor: {
    toolApprovalSecret: string;
    azureOpenAi: AdvisorModelConfig;
  };
  /**
   * JWKS endpoint (typically `${SUPABASE_URL}/auth/v1/keys`). When provided, mutating routes
   * require a valid JWT. When absent, mutations stay open — current demo + pilot behavior.
   */
  jwksUrl?: string | undefined;
  /** Asymmetric algorithms the JWKS verifier accepts — see SUPABASE_JWT_ALGS in config.ts. Defaults to RS256 + ES256. */
  jwtAlgs?: SupabaseJwtAlgorithm[] | undefined;
  allowTestReset?: boolean;
};

/** `jwtPayload` is set by `hono/jwk` after successful verification (WS-C R5 consumes it). */
type AppVariables = { requestId: string; jwtPayload?: Record<string, unknown> | undefined };
type AppEnv = { Variables: AppVariables };

const DEFAULT_JSON_BODY_BYTES = 512 * 1024;
const SIE_IMPORT_BODY_BYTES = 32 * 1024 * 1024;

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

type CachedJwk = JsonWebKey & { kid?: string };

const JWKS_CACHE_TTL_MS = 10 * 60_000;

/**
 * Auth-infrastructure failures must surface as 503, not 401/500 (§A R7). The error
 * intentionally stays a plain `Error` tagged by name: `hono/jwk` rethrows a keys-callback
 * error only when `constructor === Error` — a subclass would be swallowed into its
 * generic 401 and misreport an outage as a bad token.
 */
const JWKS_FETCH_ERROR_NAME = "JwksFetchError";

function jwksFetchError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = JWKS_FETCH_ERROR_NAME;
  return error;
}

// Deliberately NOT a type predicate: `error is Error` would narrow onError's
// already-`Error`-typed parameter to `never` on the false branch.
function isJwksFetchError(error: unknown): boolean {
  return error instanceof Error && error.name === JWKS_FETCH_ERROR_NAME;
}

/**
 * TTL-cached, single-flight JWKS fetcher (§A R7). `hono/jwk`'s own `jwks_uri` option
 * refetches the endpoint on every request; this fetches once, serves the cached keys for
 * ~10 minutes, and collapses concurrent refreshes into one in-flight request. Failures
 * are never cached — the next request retries.
 */
export function createCachedJwksFetcher(jwksUri: string, ttlMs = JWKS_CACHE_TTL_MS): () => Promise<CachedJwk[]> {
  let cache: { keys: CachedJwk[]; expiresAt: number } | undefined;
  let inflight: Promise<CachedJwk[]> | undefined;

  return async () => {
    if (cache && Date.now() < cache.expiresAt) {
      return cache.keys;
    }
    inflight ??= (async () => {
      try {
        let response: Response;
        try {
          response = await fetch(jwksUri);
        } catch (cause) {
          throw jwksFetchError(`Failed to fetch JWKS from ${jwksUri}.`, cause);
        }
        if (!response.ok) {
          throw jwksFetchError(`JWKS endpoint ${jwksUri} answered ${response.status}.`);
        }
        let body: { keys?: unknown };
        try {
          body = (await response.json()) as { keys?: unknown };
        } catch (cause) {
          throw jwksFetchError(`JWKS endpoint ${jwksUri} returned invalid JSON.`, cause);
        }
        if (!Array.isArray(body.keys)) {
          throw jwksFetchError(`JWKS endpoint ${jwksUri} response is missing a "keys" array.`);
        }
        const keys = body.keys as CachedJwk[];
        cache = { keys, expiresAt: Date.now() + ttlMs };
        return keys;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  };
}

/**
 * postgres-js server errors carry a SQLSTATE `code` and `name: "PostgresError"` —
 * detected structurally so services/api never imports the postgres driver (WS-A5).
 */
function getPostgresErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== "PostgresError") return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The VERIFIED token subject, or undefined when no verified payload exists on
 * this request (auth disabled, or the route is JWT-exempt). Only ever reads
 * the `jwtPayload` context var that `hono/jwk` sets after verification —
 * never a client-supplied header or body field (WS-C R5).
 */
function jwtSubject(c: Context<AppEnv>): string | undefined {
  const payload = c.var.jwtPayload;
  if (!payload || typeof payload !== "object") return undefined;
  const sub = (payload as { sub?: unknown }).sub;
  if (typeof sub !== "string") return undefined;
  const trimmed = sub.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Client-address bucket for rate limiting when no authenticated subject is
 * available (WS-C item 3). Uses the RIGHTMOST X-Forwarded-For hop: on Azure
 * App Service (the deploy target) the platform front-end APPENDS the
 * immediate peer's address to whatever XFF the client sent, so the rightmost
 * entry is the only hop a spoofer cannot choose — taking the leftmost lets an
 * attacker mint a fresh bucket per request with a random header. Azure also
 * formats the appended hop as `ip:port` (port varies per connection), so the
 * port is stripped to keep one bucket per address. Falls back to `x-real-ip`,
 * then a shared "unknown" bucket. Exported for regression tests.
 */
export function clientIpKey(xff: string | undefined, realIp: string | undefined): string {
  const hops = (xff ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  const candidate = hops.at(-1) ?? realIp?.trim();
  if (!candidate) return "unknown";
  return stripIpPort(candidate);
}

/** `1.2.3.4:5678` → `1.2.3.4`; `[2001:db8::1]:443` → `2001:db8::1`; bare v4/v6 pass through. */
function stripIpPort(address: string): string {
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(address);
  const bracketedIp = bracketed?.[1];
  if (bracketedIp !== undefined) return bracketedIp;
  const parts = address.split(":");
  if (parts.length === 2 && /^\d+$/.test(parts[1] ?? "")) return parts[0] ?? address;
  return address;
}

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
  aiMetadata,
  advisor,
  jwksUrl,
  jwtAlgs = DEFAULT_SUPABASE_JWT_ALGS,
  allowTestReset,
}: CreateAppOptions) {
  const app = new Hono<AppEnv>();
  let currentStore = store;

  // Late-bound store accessor keeps the advisor honest across /api/testing/reset swaps.
  const advisorChat = createAdvisorChatHandler({
    getStore: () => currentStore,
    runtimeMode,
    model: runtimeMode === "demo" ? undefined : createAdvisorModel(advisor.azureOpenAi),
    toolApprovalSecret: advisor.toolApprovalSecret,
  });

  /**
   * Server-derived actor for audit attribution (WS-C R5): with auth configured
   * the actor is the VERIFIED token subject as `user:<sub>`; with auth off it
   * is the repo's demo sentinel (CONVENTIONS Rule 20 adjacency). Client
   * payloads no longer carry an actorId — the request schemas dropped the
   * field, and an extra key is stripped by validation before it gets here. A
   * verified token without a usable `sub` cannot be attributed → fail closed.
   */
  function deriveActorId(c: Context<AppEnv>): string {
    if (!jwksUrl) return DEMO_ACTOR_ID;
    const sub = jwtSubject(c);
    if (!sub) {
      throw new HTTPException(401, { message: "Authenticated token is missing a usable subject (sub) claim." });
    }
    return `user:${sub}`;
  }

  async function postReviewDecision(
    input: ReviewDecisionInput & { actorId: string },
    reviewId: string,
    outcome: ReviewAction,
  ) {
    const review = await currentStore.applyReviewDecision(reviewId, outcome, input);
    if (!review) throw new HTTPException(404, { message: "Review not found" });
    return review;
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

  // JWKS-backed JWT auth on ALL /api/* routes when configured (§A N7 — reads included: workspace
  // snapshots, reports, and evidence are as sensitive as the mutations that produced them). The
  // middleware ships with Hono (`hono/jwk`); against Supabase the JWKS URL is
  // `${SUPABASE_URL}/auth/v1/keys`. Keys go through the TTL-cached single-flight fetcher (§A R7)
  // instead of `jwks_uri`, which refetches the endpoint per request. Accepted algorithms default
  // to RS256 + ES256 (SUPABASE_JWT_ALGS overrides) since Supabase's newer asymmetric signing keys
  // default to ES256 — a hardcoded RS256-only allowlist would 401 every legitimate user on such a
  // project. Skipped when unset so demo / unauthenticated pilots keep working — production sets
  // the env. /health + /ready live outside /api and stay public liveness/readiness probes.
  // Registered BEFORE the rate limiters (WS-C 3) so their key generators can read the verified
  // `jwtPayload` subject.
  if (jwksUrl) {
    const fetchJwksKeys = createCachedJwksFetcher(jwksUrl);
    const verifyJwt = jwk({ keys: fetchJwksKeys, alg: jwtAlgs });
    app.use("/api/*", async (c, next) => {
      // GET /api/runtime-info stays public: the About-this-AI transparency panel (EU AI Act
      // Art. 50) must render before login. CORS preflights never reach here — the cors
      // middleware above short-circuits OPTIONS.
      if (c.req.method === "GET" && c.req.path === "/api/runtime-info") {
        return next();
      }
      // /api/testing/reset is route-gated on allowTestReset already, but layering JWT defense in
      // depth costs nothing and matches the plan's hardening intent.
      return verifyJwt(c, next);
    });
  }

  // Rate-limit keying (WS-C 3): one bucket per VERIFIED subject when auth is on — behind the web
  // app's server-side proxy every browser shares the proxy's outbound address, so per-IP keying
  // would give all users one shared bucket (and per-subject keying survives address churn). With
  // auth off, fall back to the client address derived by `clientIpKey` (rightmost XFF hop — see
  // its Azure App Service reasoning), then x-real-ip, then one shared "unknown" bucket.
  const rateLimitKey = (c: Context<AppEnv>): string => {
    const sub = jwtSubject(c);
    if (sub) return `sub:${sub}`;
    return `ip:${clientIpKey(c.req.header("x-forwarded-for"), c.req.header("x-real-ip"))}`;
  };
  // Test instances (ALLOW_TEST_RESET) are exempt: the sequential E2E suite legitimately exceeds
  // the per-key budgets from one IP and started flaking with 429s once the capture pipeline
  // became real. Demo mode only (WS-A5c): a stray ALLOW_TEST_RESET on a normal-mode deploy must
  // not silently disable the production rate limiters.
  const rateLimiterBypassed = allowTestReset && runtimeMode === "demo";

  // Mutating surface: 60/min per key fits an interactive single-user pilot — bump when scale-out
  // lands and switch to a Redis-backed store (e.g. @hono-rate-limiter/redis against Azure Cache).
  const apiMutationLimiter = rateLimiter<AppEnv>({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    keyGenerator: rateLimitKey,
    handler: (c) => jsonError(c, "Too many requests.", runtimeMode, 429),
  });
  app.use("/api/*", async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      return next();
    }
    if (rateLimiterBypassed) {
      return next();
    }
    return apiMutationLimiter(c, next);
  });

  // Modest READ limiter on the derivation-heavy GET surface (WS-C 3): report routes re-derive
  // projections per request and the SIE export serializes the full ledger — an anonymous scraper
  // hammering them is cheap DoS. 120/min per key stays far above the dashboard's parallel report
  // queries; health/ready and the remaining GETs are unaffected.
  const apiReadLimiter = rateLimiter<AppEnv>({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    keyGenerator: rateLimitKey,
    handler: (c) => jsonError(c, "Too many requests.", runtimeMode, 429),
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET") {
      return next();
    }
    if (!c.req.path.startsWith("/api/reports/") && !c.req.path.startsWith("/api/exports/")) {
      return next();
    }
    if (rateLimiterBypassed) {
      return next();
    }
    return apiReadLimiter(c, next);
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

    if (error instanceof AdvisorValidationError) {
      // Well-formed JSON but out-of-bounds/invalid advisor messages → 422 (Rule 16).
      return jsonError(c, error.message, runtimeMode, 422, { code: error.code, issues: error.issues });
    }

    if (error instanceof AdvisorDisabledError) {
      return jsonError(c, error.message, runtimeMode, 403, { code: error.code });
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

    if (isJwksFetchError(error)) {
      // Auth infrastructure down ≠ bad token (§A R7): JWKS fetch failures are a service
      // outage (503), while missing/invalid tokens keep answering 401 via HTTPException.
      console.error(
        JSON.stringify({
          level: "error",
          component: "api.auth",
          requestId: c.var.requestId,
          message: error.message,
        }),
      );
      return jsonError(c, "Authentication is temporarily unavailable.", runtimeMode, 503);
    }

    const pgCode = getPostgresErrorCode(error);
    if (pgCode !== undefined) {
      // WS-A5: the SQLSTATE + driver message stay in the log line only — the response body
      // never carries Postgres detail beyond the mapped code.
      console.error(
        JSON.stringify({
          level: "error",
          component: "api",
          requestId: c.var.requestId,
          message: error instanceof Error ? error.message : String(error),
          pgCode,
        }),
      );
      if (pgCode === "23505") {
        return jsonError(c, "A conflicting record already exists.", runtimeMode, 409, { code: "conflict" });
      }
      // Class 08 (connection exceptions) + class 57 (operator intervention, e.g. shutdown,
      // statement timeout via cancel) are infrastructure availability, not caller mistakes.
      if (pgCode.startsWith("08") || pgCode.startsWith("57")) {
        return jsonError(c, "The database is temporarily unavailable.", runtimeMode, 503);
      }
      return jsonError(c, "Unexpected server error.", runtimeMode, 500);
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

  app.get("/ready", async (context) => {
    // Real ledger probe (WS-A5): SELECT 1 against Postgres, no-op for the memory
    // store, rejection for the fail-closed unavailable store — instead of the old
    // instanceof check that reported a dead connection pool as ready.
    let ledgerOk = true;
    try {
      await pingLedgerStore(currentStore);
    } catch {
      ledgerOk = false;
    }
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

  // Hash-chain integrity summary (Phase 5): linkage verification over the
  // store's event log — no LedgerStore interface change (plan finding 6).
  // R14: payload recomputation is on by default — SHA-256 events are re-hashed
  // from their stored payloads (legacy djb2 links stay linkage-only).
  app.get("/api/integrity", async (context) =>
    context.json(
      summarizeEventIntegrity(await currentStore.getEvents(), {
        verifiedAt: nowIso(),
        verifyPayloads: true,
      }),
    ),
  );

  // Runtime AI transparency for the About-this-AI panel (EU AI Act Art. 50).
  // Provider/model/endpoint host only — never keys.
  app.get("/api/runtime-info", (context) =>
    context.json({
      runtimeMode,
      ai: {
        operational: isAiRuntimeOperational(aiRuntime),
        provider: aiMetadata.provider,
        ...(aiMetadata.model !== undefined ? { model: aiMetadata.model } : {}),
        ...(aiMetadata.endpointHost !== undefined ? { endpointHost: aiMetadata.endpointHost } : {}),
      },
    }),
  );

  app.post("/api/evidence", jsonValidated(evidenceCreateInputSchema), async (context) => {
    const input = context.req.valid("json");
    // Attribution comes from the server-side derivation, never the payload (R5).
    return context.json(await currentStore.createEvidence({ ...input, actorId: deriveActorId(context) }), 201);
  });

  app.post("/api/evidence/compose", jsonValidated(evidenceComposeInputSchema), async (context) => {
    const input = context.req.valid("json");
    return context.json(await currentStore.composeEvidence({ ...input, actorId: deriveActorId(context) }), 201);
  });

  app.post("/api/uploads/init", jsonValidated(uploadInitSchema), async (context) => {
    const input = context.req.valid("json");
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

  app.post("/api/vouchers/:id/suggest", jsonValidated(suggestionRequestSchema), async (context) => {
    context.req.valid("json");
    const suggestion = await currentStore.suggestVoucher(context.req.param("id"));
    if (!suggestion) throw new HTTPException(404, { message: "Voucher not found" });
    return context.json(suggestion);
  });

  app.post("/api/reviews/:id/approve", jsonValidated(reviewDecisionInputSchema), async (c) =>
    c.json(
      await postReviewDecision({ ...c.req.valid("json"), actorId: deriveActorId(c) }, c.req.param("id"), "approve"),
    ),
  );

  app.post("/api/reviews/:id/reject", jsonValidated(reviewDecisionInputSchema), async (c) =>
    c.json(
      await postReviewDecision({ ...c.req.valid("json"), actorId: deriveActorId(c) }, c.req.param("id"), "reject"),
    ),
  );

  app.post("/api/reviews/:id/book-without-vat", jsonValidated(reviewDecisionInputSchema), async (c) =>
    c.json(
      await postReviewDecision(
        { ...c.req.valid("json"), actorId: deriveActorId(c) },
        c.req.param("id"),
        "book-without-vat",
      ),
    ),
  );

  app.post("/api/imports/sie", async (context) => {
    // Raw file bytes, not JSON: decode (strict UTF-8 → CP437 fallback), parse
    // the SIE 4 subset, and let the store append VoucherImported events.
    // Attribution is server-derived (R5) — the old `?actorId=` override let any
    // caller stamp arbitrary identities into the 7-year audit trail.
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const parsed = parseSie(decodeSieBuffer(bytes));
    const result = await currentStore.importSie({ actorId: deriveActorId(context), file: parsed });
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

  // `POST /api/assistant/sessions` (one-shot Q&A) was retired in Phase 6 —
  // superseded by the streaming `/api/advisor/chat` below.

  // Advisor chat (Task 5.7): AI SDK 7 UI-message SSE. Deterministic demo
  // stream or Azure streamText — both route tool approvals through the
  // existing review decision. Inherits the full mutation middleware stack
  // (body limit, rate limiter, JWT when configured) like every /api/* POST.
  // The server-derived actor rides along so approved proposeReviewAction
  // executions attribute to the SAME identity as a direct review decision (R5).
  app.post("/api/advisor/chat", (context) => advisorChat(context.req.raw, { actorId: deriveActorId(context) }));

  app.post("/api/knowledge/query", jsonValidated(knowledgeQuerySchema), async (context) => {
    const input = context.req.valid("json");
    // Real sourced retrieval (Task 5.7): BM25-lite over the bundled corpus —
    // passages carry verbatim source provenance (Rule 10). Vector mode lands
    // with the pgvector ingestion loop in Task 5.11.
    return context.json(await queryKnowledge(input.query));
  });

  app.post("/api/simulations/run", jsonValidated(simulationRequestSchema), async (context) => {
    const input = context.req.valid("json");
    return context.json(await currentStore.runSimulation({ ...input, actorId: deriveActorId(context) }), 201);
  });

  app.post("/api/close-runs", async (context) => context.json(await currentStore.getCloseRun(), 201));

  // Only the store's current close-run id is valid — arbitrary ids 404 instead
  // of echoing synthetic checklist data (Phase 3.5 / §A N14).
  app.get("/api/close-runs/:id", async (context) => {
    const closeRun = await currentStore.getCloseRun();
    const id = context.req.param("id");
    if (closeRun.id !== id) {
      throw new HTTPException(404, { message: "Close run not found" });
    }
    return context.json(closeRun);
  });

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

  app.put("/api/settings/company", jsonValidated(companySettingsSchema), async (context) => {
    const input = context.req.valid("json");
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
