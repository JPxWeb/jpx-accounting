// Browser/RN-friendly client against the Accounting API HTTP surface. Responses are validated with Zod schemas from `@jpx-accounting/contracts`
// when `baseUrl` is set — the demo in-memory fallback returns the same domain shapes directly (still contract-aligned).

import type { ZodType } from "zod";
import { z } from "zod";

import type {
  AccountBalanceProjection,
  CompanySettings,
  EvidenceContext,
  EvidenceCreateInput,
  IntegritySummary,
  JournalEntryProjection,
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
  evidenceContextSchema,
  evidenceCreateResultSchema,
  integritySummarySchema,
  journalEntryProjectionSchema,
  reportPackSchema,
  reviewTaskSchema,
  runtimeInfoSchema,
  sieImportResultSchema,
  simulationRunSchema,
  uploadInitResultSchema,
  workspaceSnapshotSchema,
} from "@jpx-accounting/contracts";
import type { ReportRange } from "@jpx-accounting/domain";
import {
  buildSieExport,
  decodeSieBuffer,
  deriveDeterministicExtraction,
  encodePc8,
  MemoryLedgerStore,
  nowIso,
  parseSie,
  summarizeEventIntegrity,
  today,
} from "@jpx-accounting/domain";

type RequestOptions = RequestInit & { json?: unknown };
type AccountingApiClientOptions = {
  baseUrl?: string | undefined;
  runtimeMode: RuntimeMode;
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

/** Serialize an optional report window into `?from=&to=` (empty when unscoped). */
function reportRangeQuery(range?: ReportRange): string {
  const params = new URLSearchParams();
  if (range?.from !== undefined) params.set("from", range.from);
  if (range?.to !== undefined) params.set("to", range.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function requestJson<T>(baseUrl: string, path: string, schema: ZodType<T>, options?: RequestOptions): Promise<T> {
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

  const response = await fetch(`${baseUrl}${path}`, init);

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

  async getSnapshot() {
    if (this.fallbackStore) return this.fallbackStore.getSnapshot();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/workspace", workspaceSnapshotSchema);
  }

  /**
   * Journal entries, optionally scoped server-side to an inclusive
   * `YYYY-MM-DD` day window. No range → the full unfiltered journal.
   */
  async getJournal(range?: ReportRange): Promise<JournalEntryProjection[]> {
    if (this.fallbackStore) return (await this.fallbackStore.getReports(range)).journal;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reports/journal${reportRangeQuery(range)}`, journalProjectionListSchema);
  }

  /**
   * Account balances, optionally scoped to a day window. With a range the
   * result is the PERIOD MOVEMENT (only lines booked inside the window) —
   * deliberate for the Books trial-balance view.
   */
  async getTrialBalance(range?: ReportRange): Promise<AccountBalanceProjection[]> {
    if (this.fallbackStore) return (await this.fallbackStore.getReports(range)).balances;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reports/trial-balance${reportRangeQuery(range)}`, accountBalanceListSchema);
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
    return requestJson(this.baseUrl, `/api/reports/pack?${params.toString()}`, reportPackSchema);
  }

  async createEvidence(input: EvidenceCreateInput) {
    if (this.fallbackStore) return this.fallbackStore.createEvidence(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/evidence", evidenceCreateResultSchema, { method: "POST", json: input });
  }

  async approveReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "approve", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reviews/${reviewId}/approve`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  async rejectReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "reject", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reviews/${reviewId}/reject`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  async bookWithoutVatReview(reviewId: string, input: ReviewDecisionInput): Promise<ReviewTask | undefined> {
    if (this.fallbackStore) return this.fallbackStore.applyReviewDecision(reviewId, "book-without-vat", input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, `/api/reviews/${reviewId}/book-without-vat`, reviewTaskSchema, {
      method: "POST",
      json: input,
    });
  }

  // `askAssistant` (POST /api/assistant/sessions) was retired in Phase 6 —
  // the assistant screen streams through `/api/advisor/chat` instead.

  async runSimulation(input: SimulationRequest): Promise<SimulationRun> {
    if (this.fallbackStore) return this.fallbackStore.runSimulation(input);
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    return requestJson(this.baseUrl, "/api/simulations/run", simulationRunSchema, { method: "POST", json: input });
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
    return requestJson(this.baseUrl, "/api/uploads/init", uploadInitResultSchema, { method: "POST", json: input });
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
    const target =
      uploadResult.uploadUrl.startsWith("/") && this.baseUrl
        ? `${this.baseUrl}${uploadResult.uploadUrl}`
        : uploadResult.uploadUrl;
    const response = await fetch(target, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": uploadResult.requiredBlobType,
        "content-type": uploadResult.requiredContentType,
      },
      body: body as BodyInit,
    });
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
    const response = await fetch(`${this.baseUrl}/api/evidence/${evidenceId}`, {
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
    const response = await fetch(`${this.baseUrl}/api/evidence/${evidenceId}/extract`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new AccountingApiError(response.status, `extractEvidence failed: ${response.status}`);
    }
    // The extract response is a superset ({extracted, ...context, liveExtraction?}) — the schema
    // strips the extras down to the shared EvidenceContext shape.
    return parseJsonBody(response, evidenceContextSchema);
  }

  /**
   * Short-lived read URL for the evidence file (Azure User-Delegation SAS).
   * Returns `null` when no preview is available: stub storage, legacy synthetic
   * blob paths, or the offline demo fallback.
   */
  async getEvidenceFileUrl(evidenceId: string): Promise<{ url: string } | null> {
    if (this.fallbackStore) return null;
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await fetch(`${this.baseUrl}/api/evidence/${evidenceId}/file-url`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AccountingApiError(response.status, `getEvidenceFileUrl failed: ${response.status}`);
    }
    const payload = (await response.json().catch(() => undefined)) as { url?: unknown } | undefined;
    if (!payload || typeof payload.url !== "string") return null;
    return { url: payload.url };
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
    return requestJson(this.baseUrl, "/api/integrity", integritySummarySchema);
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
    return requestJson(this.baseUrl, "/api/runtime-info", runtimeInfoSchema);
  }

  async getCompanySettings(): Promise<CompanySettings | null> {
    if (this.fallbackStore) return this.fallbackStore.getCompanySettings();
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await fetch(`${this.baseUrl}/api/settings/company`, {
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
    const response = await fetch(`${this.baseUrl}/api/settings/company`, {
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
   */
  async fetchSieExport(): Promise<Uint8Array<ArrayBuffer>> {
    if (this.fallbackStore) {
      const [reports, settings] = await Promise.all([
        this.fallbackStore.getReports(),
        this.fallbackStore.getCompanySettings(),
      ]);
      return encodePc8(buildSieExport({ journal: reports.journal, settings, generatedAt: nowIso() }));
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await fetch(`${this.baseUrl}/api/exports/sie`, {
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
      return this.fallbackStore.importSie({ actorId: "user_founder", file: parseSie(decodeSieBuffer(asBytes)) });
    }
    if (!this.baseUrl) throw new AccountingApiError(503, "Accounting API base URL is not configured.");
    const response = await fetch(`${this.baseUrl}/api/imports/sie`, {
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
