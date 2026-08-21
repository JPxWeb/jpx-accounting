// Browser/RN-friendly client against the Accounting API HTTP surface. Responses are validated with Zod schemas from `@jpx-accounting/contracts`
// when `baseUrl` is set — the demo in-memory fallback returns the same domain shapes directly (still contract-aligned).

import type { ZodType } from "zod";
import { z } from "zod";

import type {
  AccountBalanceProjection,
  CompanySettings,
  ComplianceAlert,
  EvidenceComposeInput,
  EvidenceComposeResult,
  EvidenceContext,
  EvidenceCreateInput,
  IntegritySummary,
  JournalEntryProjection,
  ManualVoucherInput,
  ManualVoucherResult,
  ReportPack,
  ReviewDecisionInput,
  ReviewTask,
  RuntimeInfo,
  RuntimeMode,
  SieImportResult,
  SimulationRequest,
  SimulationRun,
  UploadInit,
  UploadInitResult,
} from "@jpx-accounting/contracts";
import {
  accountBalanceProjectionSchema,
  complianceAlertSchema,
  evidenceContextSchema,
  evidenceComposeResultSchema,
  evidenceCreateResultSchema,
  integritySummarySchema,
  journalEntryProjectionSchema,
  manualVoucherResultSchema,
  reportPackSchema,
  reviewTaskSchema,
  runtimeInfoSchema,
  sieImportResultSchema,
  simulationRunSchema,
  uploadInitResultSchema,
  workspaceSnapshotSchema,
} from "@jpx-accounting/contracts";
import {
  buildSieExport,
  computeSieBalances,
  decodeSieBuffer,
  deriveDeterministicExtraction,
  encodePc8,
  nowIso,
  parseSie,
  resolvePeriodToken,
  sieDecodeWarnings,
  summarizeEventIntegrity,
  today,
} from "@jpx-accounting/domain";
// Demo fallback still statically constructs MemoryLedgerStore — keep off
// `server-only` on domain/store until this path is dynamic-imported (P1).
import { MemoryLedgerStore, type ReportRange } from "@jpx-accounting/domain/store";

type RequestOptions = RequestInit & { json?: unknown };

/**
 * Narrow fetch seam used internally so authorized and plain requests share one
 * shape (all call sites pass string URLs — never Request objects).
 */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type AccountingApiClientOptions = {
  baseUrl?: string | undefined;
  runtimeMode: RuntimeMode;
  /**
   * Auth-token provider seam (WS-C R12): resolves the CURRENT session's access
   * token per request — never cache the token at construction time, sessions
   * refresh underneath the client. When it yields a token, API requests carry
   * `Authorization: Bearer <token>`; when absent/undefined the request goes out
   * unauthenticated (demo mode and signed-out browsing keep working, and an
   * auth-required API answers 401 honestly). Azure SAS uploads never get the
   * header — the SAS URL is its own credential and the token must not leak to
   * the storage host.
   */
  getAuthToken?: (() => Promise<string | undefined> | string | undefined) | undefined;
};

export class AccountingApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "AccountingApiError";
  }
}

async function parseJsonBody<T>(response: Response, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AccountingApiError(response.status, "Accounting API returned invalid JSON.");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AccountingApiError(502, "Accounting API response did not match the shared contract.");
  }

  return parsed.data;
}

const journalProjectionListSchema = z.array(journalEntryProjectionSchema);
const accountBalanceListSchema = z.array(accountBalanceProjectionSchema);
const complianceAlertListSchema = z.array(complianceAlertSchema);

/** Serialize an optional report window into `?from=&to=` (empty when unscoped). */
function reportRangeQuery(range?: ReportRange): string {
  const params = new URLSearchParams();
  if (range?.from !== undefined) params.set("from", range.from);
  if (range?.to !== undefined) params.set("to", range.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Bounded retry knobs for transient 429s (readiness G9 — bulk capture backlog).
 * The API's mutation limiter is a 60 s fixed window, so a server-advertised wait
 * tops out just under a minute: the delay cap sits just past that window so a
 * legitimate `Retry-After` / `reset=` is honored IN FULL (waiting out the window
 * is the whole point — a shorter cap would burn all three retries inside the
 * same exhausted window and hard-fail a bulk drop), while a bogus or hostile
 * header (`Retry-After: 3600`) still can't park the client for an hour.
 */
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_FALLBACK_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 65_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `reset=<seconds>` out of hono-rate-limiter's draft-7 combined `RateLimit` header. */
function parseRateLimitResetSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const match = /reset=(\d+)/.exec(header);
  return match ? Number(match[1]) : undefined;
}

/** Delay before the next attempt: `Retry-After` (seconds) → `RateLimit: reset=` → exponential fallback. */
function rateLimitDelayMs(response: Response, attempt: number): number {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader !== null) {
    // Only the delta-seconds form is understood; an HTTP-date parses to NaN and falls through.
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RATE_LIMIT_MAX_DELAY_MS);
  }
  const resetSeconds = parseRateLimitResetSeconds(response.headers.get("ratelimit"));
  if (resetSeconds !== undefined) return Math.min(resetSeconds * 1000, RATE_LIMIT_MAX_DELAY_MS);
  return Math.min(RATE_LIMIT_FALLBACK_DELAY_MS * 2 ** attempt, RATE_LIMIT_MAX_DELAY_MS);
}

/**
 * Wrap a fetch call with bounded 429 retry-with-backoff (readiness G9). Retrying
 * is safe for EVERY route, mutations included: hono-rate-limiter's middleware
 * answers 429 from its own handler BEFORE `next()` reaches the route, so a 429
 * proves no server-side work happened and the retry is a first execution, not a
 * second one (no double approval, no duplicate ledger event). Scoped strictly to
 * 429 for exactly that reason — a 5xx may well have executed, so it is surfaced
 * unretried. Bodies passed through here are re-sendable (string / Blob /
 * TypedArray), never one-shot streams.
 */
async function fetchWithRateLimitRetry(fetchImpl: FetchLike, input: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const response = await fetchImpl(input, init);
    if (response.status !== 429 || attempt >= RATE_LIMIT_MAX_RETRIES) return response;
    const wait = rateLimitDelayMs(response, attempt);
    // Release the discarded 429 body so a bulk drop's retries don't pile up unread streams.
    void response.body?.cancel().catch(() => undefined);
    await delay(wait);
    attempt += 1;
  }
}

async function requestJson<T>(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  schema: ZodType<T>,
  options?: RequestOptions,
): Promise<T> {
  const init: RequestInit = {
    headers: {
      "content-type": "application/json",
      ...(options?.headers ?? {}),
    },
  };

  if (options?.method !== undefined) {
    init.method = options.method;
  }

  if (options?.body !== undefined) {
    init.body = options.body;
  } else if (options?.json !== undefined) {
    init.body = JSON.stringify(options.json);
  }

  const response = await fetchWithRateLimitRetry(fetchImpl, `${baseUrl}${path}`, init);

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined as { error?: string; message?: string } | undefined);
    throw new AccountingApiError(
      response.status,
      payload?.error ?? payload?.message ?? `Request failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseJsonBody(response, schema);
}

export class AccountingApiClient {
  private readonly fallbackStore?: MemoryLedgerStore;

  constructor(private readonly options: AccountingApiClientOptions) {
    if (options.runtimeMode === "demo" && !options.baseUrl) {
      // Demo mode keeps the scaffold usable without booting the API so preview flows stay intentional rather than accidental.
      this.fallbackStore = new MemoryLedgerStore();
    }
  }

  private get baseUrl() {
    return this.options.baseUrl;
  }

  /**
   * Resolve the current bearer token from the configured provider. Provider
   * failures degrade to an unauthenticated request (the API then answers 401
   * honestly) instead of turning every call into an opaque client-side throw.
   */
  private async resolveAuthToken(): Promise<string | undefined> {
    const provider = this.options.getAuthToken;
    if (!provider) return undefined;
    try {
      return (await provider()) || undefined;
    } catch (error) {
      console.warn("AccountingApiClient: auth token provider failed; sending request unauthenticated.", error);
      return undefined;
    }
  }

  /**
   * `fetch` with `Authorization: Bearer <token>` attached when a session token
   * resolves. Arrow property so it can be passed as a bound `FetchLike`. An
   * explicit caller-supplied authorization header always wins.
   */
  private readonly authorizedFetch: FetchLike = async (input, init = {}) => {
    const token = await this.resolveAuthToken();
    if (!token) return fetch(input, init);
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };

  async getSnapshot() {
    if (this.fallbackStore) return this.fallbackStore.getSnapshot();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/workspace", workspaceSnapshotSchema);
  }

  /**
   * Journal entries, optionally scoped server-side to an inclusive
   * `YYYY-MM-DD` day window. No range → the full unfiltered journal.
   */
  async getJournal(range?: ReportRange): Promise<JournalEntryProjection[]> {
    if (this.fallbackStore) return (await this.fallbackStore.getReports(range)).journal;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(
      this.authorizedFetch,
      this.baseUrl,
      `/api/reports/journal${reportRangeQuery(range)}`,
      journalProjectionListSchema,
    );
  }

  /**
   * Account balances, optionally scoped to a day window. With a range the
   * result is the PERIOD MOVEMENT (only lines booked inside the window) —
   * deliberate for the Books trial-balance view.
   */
  async getTrialBalance(range?: ReportRange): Promise<AccountBalanceProjection[]> {
    if (this.fallbackStore) return (await this.fallbackStore.getReports(range)).balances;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(
      this.authorizedFetch,
      this.baseUrl,
      `/api/reports/trial-balance${reportRangeQuery(range)}`,
      accountBalanceListSchema,
    );
  }

  /**
   * ONE `ReportPack` per period token — the single source object every number
   * on the reports screen (prose, KPI, chart, table) renders from. Invalid
   * tokens surface as HTTP 422 (`AccountingApiError`); the offline demo
   * throws `InvalidPeriodTokenError` from the domain resolver directly.
   */
  async getReportPack(period: string): Promise<ReportPack> {
    if (this.fallbackStore) return this.fallbackStore.getReportPack({ period });
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const params = new URLSearchParams({ period });
    return requestJson(this.authorizedFetch, this.baseUrl, `/api/reports/pack?${params.toString()}`, reportPackSchema);
  }

  async createEvidence(input: EvidenceCreateInput) {
    if (this.fallbackStore) return this.fallbackStore.createEvidence(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/evidence", evidenceCreateResultSchema, {
      method: "POST",
      json: input,
    });
  }

  /**
   * Compose evidence into a packet, optionally attaching it to a specific
   * voucher (`POST /api/evidence/compose`) — this is what backs the
   * evidence-detail "Koppla till verifikation" picker (KFR Phase E / Task 5).
   * `targetVoucherId` overrides packet-history auto-detection entirely, which
   * is the only way to attach to an imported voucher (those start with
   * `evidencePacketId: null`, so there is no breadcrumb to follow). An id that
   * names no voucher in scope throws `VoucherNotFoundError` offline and an
   * `AccountingApiError` 404 (`voucher_not_found`) over the wire — in both
   * cases before any mutation, so nothing dangles.
   *
   * No actorId (WS-C R5): the API derives attribution from the verified JWT
   * subject and the demo store stamps its own sentinel.
   *
   * Returns `{ packet, discardedReviewIds }` (KFR Phase E / E.5): an explicit
   * attach also rejects, in the same store transaction, the intake drafts it
   * orphaned — the caller reads `discardedReviewIds` to report what happened
   * rather than issuing a second reject call of its own.
   */
  async composeEvidence(input: EvidenceComposeInput): Promise<EvidenceComposeResult> {
    if (this.fallbackStore) return this.fallbackStore.composeEvidence(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/evidence/compose", evidenceComposeResultSchema, {
      method: "POST",
      json: input,
    });
  }

  /**
   * Manual N-line journal entry (`POST /api/vouchers/manual`, KFR Phase E /
   * Task 4): creates a Voucher (`origin: "manual"`) + ReviewTask through the
   * SAME review gate as captured evidence — nothing posts to the ledger until
   * a human approves. Lines that don't balance to the öre are refused before
   * any mutation (`AccountingApiError` 422 `invalid_manual_voucher` over the
   * wire, `InvalidManualVoucherError` from the offline store).
   *
   * No actorId (WS-C R5) — attribution is server-derived.
   */
  async createManualVoucher(input: ManualVoucherInput): Promise<ManualVoucherResult> {
    if (this.fallbackStore) return this.fallbackStore.createManualVoucher(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/vouchers/manual", manualVoucherResultSchema, {
      method: "POST",
      json: input,
    });
  }

  // Review decisions carry no actor (WS-C R5): attribution is derived
  // server-side from the verified JWT subject, or the demo sentinel — both in
  // the API and in the offline fallback store. `input` defaults to `{}` since
  // notes/edited are the only remaining fields and most decisions send neither.
  async approveReview(reviewId: string, input: ReviewDecisionInput = {}): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "approve", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, `/api/reviews/${reviewId}/approve`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  async rejectReview(reviewId: string, input: ReviewDecisionInput = {}): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "reject", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, `/api/reviews/${reviewId}/reject`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  async bookWithoutVatReview(reviewId: string, input: ReviewDecisionInput = {}): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "book-without-vat", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(
      this.authorizedFetch,
      this.baseUrl,
      `/api/reviews/${reviewId}/book-without-vat`,
      reviewTaskSchema,
      {
        method: "POST",
        json: input,
      },
    );
  }

  // `askAssistant` (POST /api/assistant/sessions) was retired in Phase 6 —
  // the assistant screen streams through `/api/advisor/chat` instead.

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    if (this.fallbackStore) return this.fallbackStore.runSimulation(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/simulations/run", simulationRunSchema, {
      method: "POST",
      json: input,
    });
  }

  /**
   * Recompute compliance alerts (`POST /api/compliance-watch/refresh`). By default
   * resolved/dismissed alerts are excluded — pass `{ includeResolved: true }` for
   * the full set (mirrors the API query param, CONVENTIONS Rule 26).
   */
  async refreshComplianceAlerts(options?: { includeResolved?: boolean }): Promise<ComplianceAlert[]> {
    const filterVisible = (alerts: ComplianceAlert[]) =>
      options?.includeResolved ? alerts : alerts.filter((a) => a.status === "open" || a.status === "acknowledged");

    if (this.fallbackStore) {
      return filterVisible(await this.fallbackStore.refreshComplianceAlerts());
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const params = options?.includeResolved ? "?includeResolved=true" : "";
    return requestJson(
      this.authorizedFetch,
      this.baseUrl,
      `/api/compliance-watch/refresh${params}`,
      complianceAlertListSchema,
      {
        method: "POST",
      },
    );
  }

  /**
   * Step 1 of evidence upload: ask the API to mint a short-lived upload URL (Azure User-Delegation
   * SAS in normal+configured mode, stub in demo). Pair with `uploadBlob` to actually transfer bytes.
   */
  async initUpload(input: UploadInit): Promise<UploadInitResult> {
    if (this.fallbackStore) {
      const uploadId = crypto.randomUUID();
      return {
        uploadId,
        filename: input.filename,
        blobPath: `evidence-uploads/${uploadId}/${input.filename}`,
        uploadUrl: `/api/uploads/${uploadId}`,
        requiredContentType: input.mimeType,
        requiredBlobType: "BlockBlob",
        expiresInSeconds: 600,
      };
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/uploads/init", uploadInitResultSchema, {
      method: "POST",
      json: input,
    });
  }

  /**
   * Step 2 of evidence upload: PUT the file bytes to the signed URL minted by `initUpload`.
   * Azure Blob requires `x-ms-blob-type: BlockBlob` and the same Content-Type the SAS was issued for.
   * In demo mode the URL is a same-origin stub; the call is a no-op that resolves to a fake ETag.
   */
  async uploadBlob(uploadResult: UploadInitResult, body: Blob | ArrayBuffer | Uint8Array): Promise<void> {
    if (this.fallbackStore) {
      // No real network in demo — preserve the no-op shape so callers don't branch on runtime mode.
      return;
    }
    // Stub uploadUrls are API-relative (`/api/uploads/{id}`); resolve them against the API base so
    // the PUT reaches the API (possibly via the web api-proxy) instead of 404ing on the web origin.
    // Azure SAS URLs are absolute and pass through untouched.
    const isApiRelative = uploadResult.uploadUrl.startsWith("/") && this.baseUrl !== undefined;
    const target = isApiRelative ? `${this.baseUrl}${uploadResult.uploadUrl}` : uploadResult.uploadUrl;
    const init: RequestInit = {
      method: "PUT",
      headers: {
        "x-ms-blob-type": uploadResult.requiredBlobType,
        "content-type": uploadResult.requiredContentType,
      },
      body: body as BodyInit,
    };
    // Only API-relative stub uploads get the bearer token: the absolute Azure SAS
    // URL is its own credential and the session token must not leak to the storage host.
    const send: FetchLike = isApiRelative ? this.authorizedFetch : (url, requestInit) => fetch(url, requestInit);
    // The PUT is the second of ~4 mutating calls per receipt and, in the local-blob backend, it
    // lands on the API's own rate-limited surface — without the same bounded 429 retry a bulk
    // drop would still strand drafts here (readiness G9). Retrying is safe because a 429 proves
    // NO write was attempted: this API's rate limiter answers before `next()`, so the refused
    // request never reached the uploader. (Not because the write itself is idempotent — the
    // local-disk backend is write-once and answers 409 on a second PUT to the same path.)
    const response = await fetchWithRateLimitRetry(send, target, init);
    if (!response.ok) {
      throw new AccountingApiError(response.status, `Blob upload failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Read-only evidence context: evidence joined to its packet/voucher/review.
   * Returns `undefined` for unknown evidence (HTTP 404 or missing in the
   * offline demo store).
   */
  async getEvidenceContext(evidenceId: string): Promise<EvidenceContext | undefined> {
    if (this.fallbackStore) {
      const context = await this.fallbackStore.getEvidenceContext(evidenceId);
      if (!context) return undefined;
      const review = context.voucher ? await this.fallbackStore.findReviewByVoucher(context.voucher.id) : undefined;
      return { ...context, ...(review ? { review } : {}) };
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await this.authorizedFetch(`${this.baseUrl}/api/evidence/${evidenceId}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new AccountingApiError(response.status, `getEvidenceContext failed: ${response.status}`);
    }
    return parseJsonBody(response, evidenceContextSchema);
  }

  /**
   * Run (or re-run) extraction for an evidence object and persist the result.
   * Offline demo derives the same deterministic fields the API stub would and
   * feeds them through the in-memory store's `updateEvidenceExtraction`.
   */
  async extractEvidence(evidenceId: string): Promise<EvidenceContext | undefined> {
    if (this.fallbackStore) {
      const context = await this.fallbackStore.getEvidenceContext(evidenceId);
      if (!context) return undefined;
      const fields = deriveDeterministicExtraction(
        { filename: context.evidence.originalFilename, sizeBytes: context.evidence.sizeBytes ?? 0 },
        today(),
      );
      return this.fallbackStore.updateEvidenceExtraction(evidenceId, {
        modelId: "prebuilt-invoice",
        fields,
        extractedAt: nowIso(),
      });
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    // Fourth mutating call per receipt, and the one a bulk drop sheds first: the caller fires it
    // best-effort, so an unretried 429 would silently leave a whole import un-extracted. Bounded
    // retry keeps the extraction (readiness G9); after exhaustion the caller's catch still wins.
    const response = await fetchWithRateLimitRetry(
      this.authorizedFetch,
      `${this.baseUrl}/api/evidence/${evidenceId}/extract`,
      {
        method: "POST",
        headers: { accept: "application/json" },
      },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new AccountingApiError(response.status, `extractEvidence failed: ${response.status}`);
    }
    // The extract response is a superset ({extracted, ...context, liveExtraction?}) — the schema
    // strips the extras down to the shared EvidenceContext shape.
    return parseJsonBody(response, evidenceContextSchema);
  }

  /**
   * Short-lived read URL for the evidence file (Azure User-Delegation SAS, or the local-disk
   * self-host backend's own HMAC-token URL). Returns `null` when no preview is available: stub
   * storage, legacy synthetic blob paths, or the offline demo fallback.
   */
  async getEvidenceFileUrl(evidenceId: string): Promise<{ url: string } | null> {
    if (this.fallbackStore) return null;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await this.authorizedFetch(`${this.baseUrl}/api/evidence/${evidenceId}/file-url`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AccountingApiError(response.status, `getEvidenceFileUrl failed: ${response.status}`);
    }
    const payload = (await response.json().catch(() => undefined)) as { url?: unknown } | undefined;
    if (!payload || typeof payload.url !== "string") return null;
    // Azure SAS URLs are absolute and pass through untouched; the local-disk backend's HMAC-token
    // read URL is API-relative (`/api/blobs/local/{token}`) and needs the same resolution
    // uploadBlob already applies to stub uploads, or a browser hitting it directly would 404 on
    // the web origin instead of reaching the API (possibly via the web api-proxy).
    const isApiRelative = payload.url.startsWith("/") && this.baseUrl !== undefined;
    return { url: isApiRelative ? `${this.baseUrl}${payload.url}` : payload.url };
  }

  /**
   * Hash-chain integrity summary (`GET /api/integrity`). The offline demo
   * computes the same summary locally: `getEvents()` + the pure domain
   * `summarizeEventIntegrity` — one verification algorithm, two entry points.
   */
  async getIntegritySummary(): Promise<IntegritySummary> {
    if (this.fallbackStore) {
      return summarizeEventIntegrity(await this.fallbackStore.getEvents(), { verifiedAt: nowIso() });
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/integrity", integritySummarySchema);
  }

  /**
   * Runtime AI transparency (`GET /api/runtime-info`) for the About-this-AI
   * panel. The offline demo is by construction the local deterministic
   * runtime, so the fallback answer is static and honest.
   */
  async getRuntimeInfo(): Promise<RuntimeInfo> {
    if (this.fallbackStore) {
      return { runtimeMode: "demo", ai: { operational: true, provider: "local-demo" } };
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.authorizedFetch, this.baseUrl, "/api/runtime-info", runtimeInfoSchema);
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    if (this.fallbackStore) return this.fallbackStore.getCompanySettings();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await this.authorizedFetch(`${this.baseUrl}/api/settings/company`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new AccountingApiError(response.status, `getCompanySettings failed: ${response.status}`);
    }
    return (await response.json()) as CompanySettings | null;
  }

  async saveCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    if (this.fallbackStore) return this.fallbackStore.putCompanySettings(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await this.authorizedFetch(`${this.baseUrl}/api/settings/company`, {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
      throw new AccountingApiError(
        response.status,
        payload?.message ?? `saveCompanySettings failed: ${response.status}`,
      );
    }
    return (await response.json()) as CompanySettings;
  }

  /**
   * SIE 4 export of the current workspace as PC8/CP437 bytes (matches
   * `GET /api/exports/sie`). Offline demo builds the same bytes locally via
   * the domain serializer instead of failing with a 503.
   *
   * An optional `period` token (Phase D, Task 7) scopes the export to that
   * window and adds the #IB/#UB/#RES blocks; omitting it exports full history.
   */
  async fetchSieExport(period?: string): Promise<Uint8Array<ArrayBuffer>> {
    if (this.fallbackStore) {
      const [reports, settings] = await Promise.all([
        this.fallbackStore.getReports(),
        this.fallbackStore.getCompanySettings(),
      ]);
      if (period !== undefined) {
        // Same resolver the API route uses, so the demo bytes match the wire.
        const resolved = resolvePeriodToken(period, {
          fiscalYearStart: settings?.profile.fiscalYearStart ?? "01-01",
          ...(settings?.profile.firstFiscalYearStart !== undefined
            ? { firstFiscalYearStart: settings.profile.firstFiscalYearStart }
            : {}),
        });
        const range = { from: resolved.from, to: resolved.to };
        const balances = computeSieBalances(reports.journal, range);
        return encodePc8(
          buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso(), range, ...balances }),
        );
      }
      return encodePc8(buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso() }));
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const query = period !== undefined ? `?period=${encodeURIComponent(period)}` : "";
    const response = await this.authorizedFetch(`${this.baseUrl}/api/exports/sie${query}`, {
      headers: { accept: "text/plain,*/*" },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined as { message?: string } | undefined);
      throw new AccountingApiError(
        response.status,
        payload?.message ?? `SIE export failed: ${response.status} ${response.statusText}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Import an SIE 4 file (raw bytes; UTF-8 or PC8/CP437). Matches
   * `POST /api/imports/sie`; the offline demo decodes/parses locally and
   * feeds the in-memory store's `importSie`.
   */
  async importSie(bytes: Uint8Array | ArrayBuffer): Promise<SieImportResult> {
    const asBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this.fallbackStore) {
      // No actorId: the store attributes to the demo sentinel (WS-C R5).
      const text = decodeSieBuffer(asBytes);
      const parsed = parseSie(text);
      // Mirror the API route: decode fallout (e.g. ø/Ø, unmapped in our CP437
      // subset) is surfaced as a warning, never silently mangled (G11).
      parsed.warnings = [...sieDecodeWarnings(text), ...parsed.warnings];
      return this.fallbackStore.importSie({ file: parsed });
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await this.authorizedFetch(`${this.baseUrl}/api/imports/sie`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", accept: "application/json" },
      body: asBytes as unknown as BodyInit,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined as { error?: string; message?: string } | undefined);
      throw new AccountingApiError(
        response.status,
        payload?.error ?? payload?.message ?? `SIE import failed: ${response.status} ${response.statusText}`,
      );
    }
    return parseJsonBody(response, sieImportResultSchema);
  }
}

export function createAccountingApiClient(options: AccountingApiClientOptions) {
  return new AccountingApiClient(options);
}
