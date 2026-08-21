# KFR Phase A — Local Ops

> Part of [2026-08-20-kfr-master.md](2026-08-20-kfr-master.md) — read its Global Constraints and Interface Contract first.

**Goal:** JPx Advisory AB can run `ACCOUNTING_RUNTIME_MODE=normal` entirely on a local machine — durable Postgres (`pnpm db:up`), evidence blobs on local disk instead of Azure Storage, and a one-command backup — so the FY1 migration (Phases B–F) has somewhere durable to land before any Azure decision is revisited.

**Architecture (design D1):** a third `BlobUploader` implementation, `LocalDiskBlobUploader`, alongside the existing `AzureBlobUploader`/`StubBlobUploader`/`UnavailableBlobUploader` in `services/api/src/blob.ts`. It stores bytes under `ACCOUNTING_BLOB_DIR` using the **identical `evidence-uploads/{uploadId}/{sanitizedFilename}` blobPath convention** Azure already uses (so a later bulk upload to Azure Blob needs no event-history rewrite — same paths, different backend). Upload/read access goes through same-origin API routes (`PUT`/`GET /api/blobs/local/:token`) guarded by short-lived HMAC-signed tokens minted per-boot — this mirrors the SAS shape (opaque, time-boxed, single-purpose credential in the URL itself) without needing Azure. `createBlobUploader`'s precedence becomes Azure env → `ACCOUNTING_BLOB_DIR` → Unavailable (normal mode) / Stub (demo mode). `pnpm db:backup` wraps `pg_dump --format=custom` plus a blob-dir mirror. `docs/SELF_HOST.md` is the runbook tying env vars, boot order, and backup/restore together.

## Task list

1. `LocalDiskBlobUploader` core: HMAC token mint/verify, write-once, read, path-traversal defense, `createBlobUploader` precedence (`services/api/src/blob.ts`).
2. Config plumbing: `ACCOUNTING_BLOB_DIR` → `ApiRuntimeConfig.localBlobDir` → `createApiRuntimeDependencies` wiring → `.env.example`.
3. API routes `PUT`/`GET /api/blobs/local/:token` in `services/api/src/app.ts`: body-limit gating, JWKS-auth exemption, error-to-status mapping.
4. `GET /api/evidence/:id/file-url` + `GET /ready` recognize the local uploader as a real (non-stub) backend.
5. `packages/api-client` `getEvidenceFileUrl` resolves an API-relative local blob URL the same way `uploadBlob` already does (**deviation from the master contract** — see note at the end of this file).
6. `pnpm db:backup` script (`scripts/db-backup.mts`): `pg_dump --format=custom` + blob-dir mirror.
7. `docs/SELF_HOST.md` runbook: env matrix, boot order, backup/restore, later-Azure-migration note.

---

## Task 1 — `LocalDiskBlobUploader` core + `createBlobUploader` precedence

**Files:**

- Modify: `services/api/src/blob.ts` (add imports; add `"local"` to `BlobUploaderKind`; add 3 error classes; add `inferLocalBlobContentType`; add `LocalDiskBlobUploader`; update `BlobUploaderConfig` + `createBlobUploader`)
- Test: `tests/unit/blob-uploader.test.ts` (extend existing file)

**Interfaces:**

- Consumes: nothing new (module-local `sanitizeFilename`, `validateInput`, `ALLOWED_CONTENT_TYPES`, `DEFAULT_SAS_EXPIRY_SECONDS`, `MAX_UPLOAD_BYTES` — all already in this file).
- Produces:
  - `export type BlobUploaderKind = "stub" | "azure" | "local" | "unavailable";`
  - `export class LocalBlobTokenError extends Error { readonly code = "local_blob_token_invalid" }`
  - `export class LocalBlobConflictError extends Error { readonly code = "local_blob_conflict" }`
  - `export class LocalBlobNotFoundError extends Error { readonly code = "local_blob_not_found" }`
  - `export function inferLocalBlobContentType(blobPath: string): string`
  - `export type LocalDiskBlobUploaderConfig = { rootDir: string; tokenExpirySeconds?: number }`
  - `export class LocalDiskBlobUploader implements BlobUploader` with `kind = "local"`, `initUpload`, `mintReadSas`, plus non-interface members `verifyToken(token, method): string`, `writeOnce(blobPath, bytes): Promise<void>`, `readBlob(blobPath): Promise<Uint8Array>`.
  - `createBlobUploader(config: BlobUploaderConfig)` — `config` gains `blobDir?: string`; precedence becomes Azure → `blobDir` (LocalDisk) → (`failClosed` ? Unavailable : Stub).

### Steps

- [ ] Write the failing tests — append to `tests/unit/blob-uploader.test.ts`:

  ```ts
  import { mkdtempSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import path from "node:path";

  import {
    LocalBlobConflictError,
    LocalBlobNotFoundError,
    LocalBlobTokenError,
    LocalDiskBlobUploader,
  } from "../../services/api/src/blob";

  function tempBlobRoot(t: test.TestContext): string {
    const rootDir = mkdtempSync(path.join(tmpdir(), "jpx-blob-test-"));
    t.after(() => rmSync(rootDir, { recursive: true, force: true }));
    return rootDir;
  }

  test("createBlobUploader returns local kind when ACCOUNTING_BLOB_DIR is set and Azure env is absent", (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = createBlobUploader({ blobDir: rootDir });
    assert.equal(uploader.kind, "local");
    assert.ok(uploader instanceof LocalDiskBlobUploader);
  });

  test("createBlobUploader returns local kind even with failClosed (normal mode) when ACCOUNTING_BLOB_DIR is set", (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = createBlobUploader({ blobDir: rootDir, failClosed: true });
    assert.equal(uploader.kind, "local");
  });

  test("createBlobUploader prefers Azure over ACCOUNTING_BLOB_DIR when both are configured", () => {
    const uploader = createBlobUploader({
      accountName: "jpxstorage",
      containerName: "evidence",
      blobDir: "/some/local/dir",
    });
    assert.equal(uploader.kind, "azure");
  });

  test("LocalDiskBlobUploader.initUpload mints a PUT token whose blobPath matches the Azure/stub convention", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });

    const result = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
    assert.match(result.blobPath, /^evidence-uploads\/[^/]+\/kvitto\.jpg$/);
    assert.match(result.uploadUrl, /^\/api\/blobs\/local\/[^.]+\.[^.]+$/);
    assert.equal(result.requiredBlobType, "BlockBlob");
    assert.equal(result.expiresInSeconds, 600);

    const token = result.uploadUrl.slice("/api/blobs/local/".length);
    assert.equal(uploader.verifyToken(token, "PUT"), result.blobPath);
  });

  test("LocalDiskBlobUploader writeOnce -> readBlob round trip; a second write to the same path conflicts", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });
    const blobPath = "evidence-uploads/u1/kvitto.jpg";
    const bytes = new TextEncoder().encode("fake-jpeg-bytes");

    await uploader.writeOnce(blobPath, bytes);
    assert.deepEqual(new Uint8Array(await uploader.readBlob(blobPath)), bytes);

    await assert.rejects(() => uploader.writeOnce(blobPath, bytes), LocalBlobConflictError);
  });

  test("LocalDiskBlobUploader.readBlob rejects with LocalBlobNotFoundError when nothing was written", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });
    await assert.rejects(() => uploader.readBlob("evidence-uploads/u1/missing.jpg"), LocalBlobNotFoundError);
  });

  test("LocalDiskBlobUploader.verifyToken rejects a token minted for the other HTTP method", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });
    const init = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
    const token = init.uploadUrl.slice("/api/blobs/local/".length);
    assert.throws(() => uploader.verifyToken(token, "GET"), LocalBlobTokenError);
  });

  test("LocalDiskBlobUploader.verifyToken rejects an expired token", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir, tokenExpirySeconds: -1 });
    const { url } = await uploader.mintReadSas("evidence-uploads/u1/kvitto.jpg");
    const token = url.slice("/api/blobs/local/".length);
    assert.throws(() => uploader.verifyToken(token, "GET"), /expired/i);
  });

  test("LocalDiskBlobUploader.verifyToken rejects a tampered signature", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });
    const { url } = await uploader.mintReadSas("evidence-uploads/u1/kvitto.jpg");
    const token = url.slice("/api/blobs/local/".length);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    assert.throws(() => uploader.verifyToken(tampered, "GET"), LocalBlobTokenError);
  });

  test("LocalDiskBlobUploader rejects a blobPath resolving outside the configured root (defense in depth)", async (t) => {
    const rootDir = tempBlobRoot(t);
    const uploader = new LocalDiskBlobUploader({ rootDir });
    const { url } = await uploader.mintReadSas("../outside.txt");
    const token = url.slice("/api/blobs/local/".length);
    assert.throws(() => uploader.verifyToken(token, "GET"), /escapes/i);
  });

  test("inferLocalBlobContentType maps known extensions and falls back to octet-stream", () => {
    assert.equal(inferLocalBlobContentType("evidence-uploads/u1/kvitto.jpg"), "image/jpeg");
    assert.equal(inferLocalBlobContentType("evidence-uploads/u1/kvitto.JPEG"), "image/jpeg");
    assert.equal(inferLocalBlobContentType("evidence-uploads/u1/faktura.pdf"), "application/pdf");
    assert.equal(inferLocalBlobContentType("evidence-uploads/u1/data.bin"), "application/octet-stream");
  });
  ```

  Also update the file's existing import line to pull in `inferLocalBlobContentType` alongside the current names:

  ```ts
  import {
    BlobUploaderUnavailableError,
    createBlobUploader,
    inferLocalBlobContentType,
    StubBlobUploader,
    UnavailableBlobUploader,
  } from "../../services/api/src/blob";
  ```

- [ ] Run it and confirm it fails on missing exports:
      `corepack pnpm exec tsx --test tests/unit/blob-uploader.test.ts`
      Expected failure: a module-resolution/type error — `LocalDiskBlobUploader`, `LocalBlobConflictError`, `LocalBlobNotFoundError`, `LocalBlobTokenError`, `inferLocalBlobContentType` don't exist yet in `services/api/src/blob.ts`.

- [ ] Minimal implementation — in `services/api/src/blob.ts`:

  Add imports (top of file, after the existing `@azure/storage-blob` import block):

  ```ts
  import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
  import { mkdirSync, promises as fsPromises } from "node:fs";
  import path from "node:path";
  ```

  Change the kind union:

  ```ts
  export type BlobUploaderKind = "stub" | "azure" | "local" | "unavailable";
  ```

  Insert after `UploadValidationError` (right before `function sanitizeFilename`):

  ```ts
  export class LocalBlobTokenError extends Error {
    readonly code = "local_blob_token_invalid" as const;
    constructor(message: string) {
      super(message);
      this.name = "LocalBlobTokenError";
    }
  }

  export class LocalBlobConflictError extends Error {
    readonly code = "local_blob_conflict" as const;
    constructor(message: string) {
      super(message);
      this.name = "LocalBlobConflictError";
    }
  }

  export class LocalBlobNotFoundError extends Error {
    readonly code = "local_blob_not_found" as const;
    constructor(message: string) {
      super(message);
      this.name = "LocalBlobNotFoundError";
    }
  }
  ```

  Insert after the `StubBlobUploader` class (right before `export type AzureBlobUploaderConfig`):

  ```ts
  const LOCAL_BLOB_EXTENSION_CONTENT_TYPES: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
  };

  /**
   * The local disk store has no blob-level content-type metadata the way Azure Blob does (a real
   * blob remembers what it was uploaded as); the GET route infers it from the filename extension
   * instead. Unrecognized extensions fall back to a generic binary type rather than guessing wrong.
   */
  export function inferLocalBlobContentType(blobPath: string): string {
    return LOCAL_BLOB_EXTENSION_CONTENT_TYPES[path.extname(blobPath).toLowerCase()] ?? "application/octet-stream";
  }

  type LocalBlobTokenMethod = "PUT" | "GET";
  type LocalBlobTokenPayload = { blobPath: string; exp: number; method: LocalBlobTokenMethod };

  export type LocalDiskBlobUploaderConfig = {
    rootDir: string;
    /** Override the HMAC token lifetime (seconds). Defaults to 600 (10 min), matching Azure's SAS default. */
    tokenExpirySeconds?: number;
  };

  /**
   * D1 — local self-host ops: a third BlobUploader backend, used when ACCOUNTING_BLOB_DIR is set
   * and Azure Storage env is absent. Stores bytes under `rootDir` using the SAME
   * `evidence-uploads/{uploadId}/{sanitizedFilename}` blobPath convention Azure uses (see
   * sanitizeFilename above) so a later bulk upload to Azure Blob needs no event-history rewrite.
   *
   * Upload/read URLs are same-origin API routes (`/api/blobs/local/:token`) guarded by a
   * short-lived HMAC-signed token embedded in the URL — the token itself IS the credential,
   * mirroring how an Azure SAS query string is its own credential. The signing secret is random
   * per process boot (never persisted, never read from env): tokens do not survive a restart,
   * same short-lived-credential spirit as a 10-minute SAS without needing a stored key.
   */
  export class LocalDiskBlobUploader implements BlobUploader {
    readonly kind = "local" as const;

    private readonly rootDir: string;
    private readonly tokenExpirySeconds: number;
    private readonly hmacSecret: Buffer;

    constructor(config: LocalDiskBlobUploaderConfig) {
      this.rootDir = path.resolve(config.rootDir);
      // Fail fast at boot if the configured root is not writable, rather than at first upload.
      mkdirSync(this.rootDir, { recursive: true });
      this.tokenExpirySeconds = config.tokenExpirySeconds ?? DEFAULT_SAS_EXPIRY_SECONDS;
      this.hmacSecret = randomBytes(32);
    }

    private signToken(payload: LocalBlobTokenPayload): string {
      const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const signature = createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
      return `${payloadB64}.${signature}`;
    }

    /**
     * Verifies signature, method binding, and expiry; returns the embedded (already
     * root-checked) blobPath. Throws LocalBlobTokenError on any failure — deliberately generic
     * ("invalid blob token") rather than naming which check failed, so a probing client learns
     * nothing about why a guess was rejected.
     */
    verifyToken(token: string, expectedMethod: LocalBlobTokenMethod): string {
      const separatorIndex = token.lastIndexOf(".");
      if (separatorIndex <= 0) {
        throw new LocalBlobTokenError("Invalid blob token.");
      }
      const payloadB64 = token.slice(0, separatorIndex);
      const signature = token.slice(separatorIndex + 1);
      const expectedSignature = createHmac("sha256", this.hmacSecret).update(payloadB64).digest("base64url");
      const signatureBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);
      if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
        throw new LocalBlobTokenError("Invalid blob token.");
      }
      let payload: LocalBlobTokenPayload;
      try {
        payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as LocalBlobTokenPayload;
      } catch {
        throw new LocalBlobTokenError("Invalid blob token.");
      }
      if (
        typeof payload.blobPath !== "string" ||
        typeof payload.exp !== "number" ||
        (payload.method !== "PUT" && payload.method !== "GET")
      ) {
        throw new LocalBlobTokenError("Invalid blob token.");
      }
      if (payload.method !== expectedMethod) {
        throw new LocalBlobTokenError(`Blob token is not valid for ${expectedMethod}.`);
      }
      if (Date.now() > payload.exp) {
        throw new LocalBlobTokenError("Blob token has expired.");
      }
      return this.assertPathWithinRoot(payload.blobPath);
    }

    private assertPathWithinRoot(blobPath: string): string {
      const resolved = path.resolve(this.rootDir, blobPath);
      const rootPrefix = this.rootDir.endsWith(path.sep) ? this.rootDir : `${this.rootDir}${path.sep}`;
      if (resolved !== this.rootDir && !resolved.startsWith(rootPrefix)) {
        // blobPath is always server-generated (never client input) — this check is defense in
        // depth only, exercised via a deliberately adversarial blobPath in tests.
        throw new LocalBlobTokenError(`Resolved blob path escapes the configured storage root: ${blobPath}`);
      }
      return resolved;
    }

    async initUpload(input: UploadInit): Promise<UploadInitResult> {
      validateInput(input);
      const uploadId = crypto.randomUUID();
      const blobPath = `evidence-uploads/${uploadId}/${sanitizeFilename(input.filename)}`;
      const exp = Date.now() + this.tokenExpirySeconds * 1000;
      const token = this.signToken({ blobPath, exp, method: "PUT" });
      return {
        uploadId,
        filename: input.filename,
        blobPath,
        uploadUrl: `/api/blobs/local/${token}`,
        requiredContentType: input.mimeType,
        requiredBlobType: "BlockBlob",
        expiresInSeconds: this.tokenExpirySeconds,
      };
    }

    async mintReadSas(blobPath: string): Promise<{ url: string; expiresInSeconds: number }> {
      const exp = Date.now() + this.tokenExpirySeconds * 1000;
      const token = this.signToken({ blobPath, exp, method: "GET" });
      return { url: `/api/blobs/local/${token}`, expiresInSeconds: this.tokenExpirySeconds };
    }

    /** Write-once: rejects with LocalBlobConflictError if a blob already exists at this path. */
    async writeOnce(blobPath: string, bytes: Uint8Array): Promise<void> {
      const filePath = this.assertPathWithinRoot(blobPath);
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      try {
        // "wx" = write, fail if the path already exists — the write-once guarantee.
        await fsPromises.writeFile(filePath, bytes, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new LocalBlobConflictError(`A blob already exists at "${blobPath}".`);
        }
        throw error;
      }
    }

    async readBlob(blobPath: string): Promise<Uint8Array> {
      const filePath = this.assertPathWithinRoot(blobPath);
      try {
        return await fsPromises.readFile(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new LocalBlobNotFoundError(`No blob found at "${blobPath}".`);
        }
        throw error;
      }
    }
  }
  ```

  Update `BlobUploaderConfig` and `createBlobUploader`:

  ```ts
  export type BlobUploaderConfig = {
    accountName?: string | undefined;
    containerName?: string | undefined;
    /**
     * ACCOUNTING_BLOB_DIR (D1): filesystem root for LocalDiskBlobUploader, used when Azure
     * Storage env is absent. Takes precedence over the failClosed/stub fallback below.
     */
    blobDir?: string | undefined;
    /**
     * When true and neither Azure nor blobDir is configured, return `UnavailableBlobUploader`
     * instead of the demo stub. Neutral flag — callers (services/api) map
     * `runtimeMode === "normal"`; this module stays free of runtimeMode concepts.
     */
    failClosed?: boolean | undefined;
  };

  export function createBlobUploader(config: BlobUploaderConfig): BlobUploader {
    if (config.accountName && config.containerName) {
      return new AzureBlobUploader({
        accountName: config.accountName,
        containerName: config.containerName,
      });
    }
    if (config.blobDir) {
      return new LocalDiskBlobUploader({ rootDir: config.blobDir });
    }
    if (config.failClosed) {
      return new UnavailableBlobUploader(
        "Uploads are unavailable in normal mode until AZURE_STORAGE_ACCOUNT/AZURE_STORAGE_CONTAINER " +
          "or ACCOUNTING_BLOB_DIR are configured.",
      );
    }
    return new StubBlobUploader();
  }
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/blob-uploader.test.ts`

- [ ] Commit:

  ```
  git add services/api/src/blob.ts tests/unit/blob-uploader.test.ts
  git commit -m "$(cat <<'EOF'
  feat(blob): add LocalDiskBlobUploader for self-hosted evidence storage (D1)

  Adds a third BlobUploader backend guarded by short-lived HMAC tokens instead
  of Azure SAS, using the identical evidence-uploads/ blobPath convention so a
  later Azure migration needs no event-history rewrite.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — Config plumbing: `ACCOUNTING_BLOB_DIR`

**Files:**

- Modify: `services/api/src/config.ts` (`ApiRuntimeConfig` type; `readApiRuntimeConfig`)
- Modify: `services/api/src/runtime.ts` (`createBlobUploader` call site, ~line 167-171)
- Modify: `.env.example` (new entry)
- Test: `tests/unit/api-config.test.ts` (extend), `tests/unit/api-runtime.test.ts` (extend)

**Interfaces:**

- Consumes: `LocalDiskBlobUploader`/`createBlobUploader` from Task 1.
- Produces: `ApiRuntimeConfig.localBlobDir?: string | undefined`; `createApiRuntimeDependencies` passes it through as `createBlobUploader({..., blobDir: config.localBlobDir})`.

### Steps

- [ ] Write the failing tests.

  Append to `tests/unit/api-config.test.ts`:

  ```ts
  // ---------------------------------------------------------------------------
  // D1: ACCOUNTING_BLOB_DIR resolves to localBlobDir
  // ---------------------------------------------------------------------------

  test("readApiRuntimeConfig resolves ACCOUNTING_BLOB_DIR to localBlobDir", () => {
    const config = readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo", ACCOUNTING_BLOB_DIR: "/data/jpx-blobs" });
    assert.equal(config.localBlobDir, "/data/jpx-blobs");
  });

  test("readApiRuntimeConfig leaves localBlobDir undefined when ACCOUNTING_BLOB_DIR is unset or blank", () => {
    assert.equal(readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo" }).localBlobDir, undefined);
    assert.equal(
      readApiRuntimeConfig({ ACCOUNTING_RUNTIME_MODE: "demo", ACCOUNTING_BLOB_DIR: "   " }).localBlobDir,
      undefined,
    );
  });
  ```

  Add these imports to the top of `tests/unit/api-runtime.test.ts` (alongside the existing `node:crypto` import):

  ```ts
  import { mkdtempSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import path from "node:path";
  ```

  Append to `tests/unit/api-runtime.test.ts` (near the existing `"createApiRuntimeDependencies exposes closeDatabase in both modes"` test):

  ```ts
  test("createApiRuntimeDependencies wires a LocalDiskBlobUploader when localBlobDir is set and Azure Storage env is absent", (t) => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "jpx-blob-runtime-test-"));
    t.after(() => rmSync(rootDir, { recursive: true, force: true }));
    const corsPolicy = { kind: "wildcard" } as const;
    const baseConfig = {
      port: 0,
      allowTestReset: false,
      corsPolicy,
      azureOpenAi: {},
      database: { poolMode: "direct" as const, poolMax: 10 },
      azureStorage: {},
      azureDocumentIntelligence: {},
      auth: { jwksUrl: undefined },
      advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
      localBlobDir: rootDir,
    };

    const demo = createApiRuntimeDependencies({ ...baseConfig, runtimeMode: "demo" });
    assert.equal(demo.blobUploader.kind, "local");

    const normal = createApiRuntimeDependencies({ ...baseConfig, runtimeMode: "normal" });
    assert.equal(normal.blobUploader.kind, "local");
  });
  ```

- [ ] Run it and confirm it fails:
      `corepack pnpm exec tsx --test tests/unit/api-config.test.ts tests/unit/api-runtime.test.ts`
      Expected failure: `config.localBlobDir` is `undefined` where `"/data/jpx-blobs"` was expected (property doesn't exist on the returned config yet); `blobUploader.kind` is `"stub"`/`"unavailable"` instead of `"local"`.

- [ ] Minimal implementation.

  In `services/api/src/config.ts`, add to the `ApiRuntimeConfig` type (insert right after the `azureStorage: {...}` block, before `azureDocumentIntelligence`):

  ```ts
    /**
     * ACCOUNTING_BLOB_DIR (D1 — local self-host ops): filesystem root for `LocalDiskBlobUploader`,
     * consumed by `createBlobUploader`'s precedence (Azure → LocalDisk → Unavailable/Stub) when
     * Azure Storage env is absent. Optional and orthogonal to runtimeMode: leaving it unset
     * preserves today's precedence exactly (Azure → stub in demo, Azure → Unavailable in normal).
     */
    localBlobDir?: string | undefined;
  ```

  In `readApiRuntimeConfig`'s returned object, add (right after the `azureStorage: {...}` block):

  ```ts
      localBlobDir: normalizeOptionalValue(env.ACCOUNTING_BLOB_DIR),
  ```

  In `services/api/src/runtime.ts`, update the `createBlobUploader` call (~line 167):

  ```ts
  const blobUploader = createBlobUploader({
    accountName: config.azureStorage.accountName,
    containerName: config.azureStorage.containerName,
    blobDir: config.localBlobDir,
    failClosed,
  });
  ```

  In `.env.example`, insert a new entry right after the `AZURE_STORAGE_CONTAINER=evidence` line (inside the `--- Azure Storage (evidence blobs) ---` section):

  ```
  # Local self-host fallback (D1): when set, ACCOUNTING_BLOB_DIR takes precedence over an
  # unconfigured Azure Storage (but Azure, when both are set, always wins). Evidence bytes are
  # stored under this directory using the SAME evidence-uploads/{id}/{filename} path convention as
  # Azure, so a later bulk upload to Azure Blob needs no event-history rewrite. See docs/SELF_HOST.md.
  ACCOUNTING_BLOB_DIR=
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/api-config.test.ts tests/unit/api-runtime.test.ts`

- [ ] Commit:

  ```
  git add services/api/src/config.ts services/api/src/runtime.ts .env.example tests/unit/api-config.test.ts tests/unit/api-runtime.test.ts
  git commit -m "$(cat <<'EOF'
  feat(config): wire ACCOUNTING_BLOB_DIR into createBlobUploader precedence

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — API routes `PUT`/`GET /api/blobs/local/:token`

**Files:**

- Modify: `services/api/src/app.ts` (imports; body-limit gating ~line 368-396; JWKS-auth exemption ~line 409-422; route handlers near the stub upload PUT route ~line 698-707; `onError` branches ~line 545-547)
- Test: `tests/unit/local-blob-routes.test.ts` (new file)

**Interfaces:**

- Consumes: `LocalDiskBlobUploader`, `LocalBlobTokenError`, `LocalBlobConflictError`, `LocalBlobNotFoundError`, `inferLocalBlobContentType`, `MAX_UPLOAD_BYTES` from `./blob`.
- Produces: `PUT /api/blobs/local/:token` → 201 `{ok:true}` | 401 (bad/expired/wrong-method token) | 409 (write-once conflict) | 413 (>16 MiB). `GET /api/blobs/local/:token` → 200 raw bytes with an inferred `content-type` | 401 | 404 (never written).

### Steps

- [ ] Write the failing tests — new file `tests/unit/local-blob-routes.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import { mkdtempSync, rmSync } from "node:fs";
  import { tmpdir } from "node:os";
  import path from "node:path";
  import test from "node:test";

  import { MAX_UPLOAD_BYTES } from "../../services/api/src/blob";
  import { createApp } from "../../services/api/src/app";
  import { createApiRuntimeDependencies } from "../../services/api/src/runtime";

  function withTempBlobDir(t: test.TestContext): string {
    const rootDir = mkdtempSync(path.join(tmpdir(), "jpx-local-blob-routes-"));
    t.after(() => rmSync(rootDir, { recursive: true, force: true }));
    return rootDir;
  }

  function createLocalBlobTestApp(rootDir: string) {
    const dependencies = createApiRuntimeDependencies({
      port: 0,
      runtimeMode: "demo",
      allowTestReset: false,
      corsPolicy: { kind: "wildcard" },
      azureOpenAi: {},
      database: { poolMode: "direct", poolMax: 10 },
      azureStorage: {},
      azureDocumentIntelligence: {},
      auth: { jwksUrl: undefined },
      advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
      localBlobDir: rootDir,
    });
    return createApp({ ...dependencies, allowTestReset: false });
  }

  async function initLocalUpload(app: ReturnType<typeof createApp>, filename: string, mimeType: string) {
    const response = await app.request("http://localhost/api/uploads/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename, mimeType, size: 1024 }),
    });
    assert.equal(response.status, 200);
    return (await response.json()) as { blobPath: string; uploadUrl: string };
  }

  test("PUT then GET round trip: bytes persist to disk and are served back with an inferred content-type", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");
    assert.match(init.uploadUrl, /^\/api\/blobs\/local\//);

    const bytes = new TextEncoder().encode("fake-jpeg-bytes");
    const put = await app.request(`http://localhost${init.uploadUrl}`, { method: "PUT", body: bytes });
    assert.equal(put.status, 201);

    const get = await app.request(`http://localhost${init.uploadUrl}`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(new Uint8Array(await get.arrayBuffer()), bytes);
  });

  test("PUT is write-once: a second PUT to the same upload URL answers 409", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

    const first = await app.request(`http://localhost${init.uploadUrl}`, {
      method: "PUT",
      body: new TextEncoder().encode("first"),
    });
    assert.equal(first.status, 201);

    const second = await app.request(`http://localhost${init.uploadUrl}`, {
      method: "PUT",
      body: new TextEncoder().encode("second"),
    });
    assert.equal(second.status, 409);
    const body = (await second.json()) as { code?: string };
    assert.equal(body.code, "local_blob_conflict");
  });

  test("GET for a blob that was never written answers 404", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

    const get = await app.request(`http://localhost${init.uploadUrl}`);
    assert.equal(get.status, 404);
    const body = (await get.json()) as { code?: string };
    assert.equal(body.code, "local_blob_not_found");
  });

  test("a PUT-scoped token is rejected when used for GET (method binding)", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

    const get = await app.request(`http://localhost${init.uploadUrl}`);
    assert.equal(get.status, 401);
    const body = (await get.json()) as { code?: string };
    assert.equal(body.code, "local_blob_token_invalid");
  });

  test("PUT rejects a body over the 16 MiB cap with 413", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const init = await initLocalUpload(app, "kvitto.jpg", "image/jpeg");

    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const put = await app.request(`http://localhost${init.uploadUrl}`, { method: "PUT", body: oversized });
    assert.equal(put.status, 413);
  });

  test("local blob byte-transfer routes bypass the JWKS auth gate while other /api/* routes still require it", async (t) => {
    const rootDir = withTempBlobDir(t);
    const dependencies = createApiRuntimeDependencies({
      port: 0,
      runtimeMode: "normal",
      allowTestReset: false,
      corsPolicy: { kind: "allowlist", origins: ["http://localhost:3002"] },
      azureOpenAi: {},
      database: { poolMode: "direct", poolMax: 10 },
      azureStorage: {},
      azureDocumentIntelligence: {},
      // Never actually fetched: the exemption must short-circuit BEFORE hono/jwk calls out to it.
      auth: { jwksUrl: "https://jwks.invalid.test/keys" },
      advisor: { toolApprovalSecret: "test-advisor-approval-secret", maxOutputTokens: 2048, streamTimeoutMs: 90_000 },
      localBlobDir: rootDir,
    });
    const app = createApp({ ...dependencies, allowTestReset: false });
    if (dependencies.blobUploader.kind !== "local") throw new Error("expected the local uploader for this test");
    const uploader = dependencies.blobUploader;

    const unauthenticatedWorkspace = await app.request("http://localhost/api/workspace");
    assert.equal(unauthenticatedWorkspace.status, 401);

    // Minted directly from the wired uploader — /api/uploads/init itself stays authenticated in
    // normal mode (matching Azure SAS minting); only the byte-transfer routes below are exempt,
    // mirroring how a real Azure SAS PUT never touches this app at all.
    const init = await uploader.initUpload({ filename: "kvitto.jpg", mimeType: "image/jpeg", size: 1024 });
    const put = await app.request(`http://localhost${init.uploadUrl}`, {
      method: "PUT",
      body: new TextEncoder().encode("bytes"),
    });
    assert.equal(put.status, 201);

    const sas = await uploader.mintReadSas(init.blobPath);
    const get = await app.request(`http://localhost${sas.url}`);
    assert.equal(get.status, 200);
  });
  ```

- [ ] Run it and confirm it fails:
      `corepack pnpm exec tsx --test tests/unit/local-blob-routes.test.ts`
      Expected failure: every request 404s — no `/api/blobs/local/:token` route exists yet.

- [ ] Minimal implementation — in `services/api/src/app.ts`:

  Update the import from `./blob` (~line 52):

  ```ts
  import {
    BlobUploaderUnavailableError,
    inferLocalBlobContentType,
    LocalBlobConflictError,
    LocalBlobNotFoundError,
    LocalBlobTokenError,
    LocalDiskBlobUploader,
    MAX_UPLOAD_BYTES,
    UploadValidationError,
  } from "./blob";
  ```

  Add a route-pattern helper next to `isStubUploadPut` (~line 370):

  ```ts
  // Local-disk blob byte-transfer routes (D1): path pattern shared by the body-limit gate below
  // and the JWKS-auth exemption further down — both must agree on exactly which requests these are.
  const LOCAL_BLOB_ROUTE_PATTERN = /^\/api\/blobs\/local\/[^/]+$/;
  const isLocalBlobPut = (c: Context<AppEnv>) => c.req.method === "PUT" && LOCAL_BLOB_ROUTE_PATTERN.test(c.req.path);
  ```

  Extend the default-body-limit gate (~line 372-383) to also skip local blob PUTs:

  ```ts
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
    if (isLocalBlobPut(c)) {
      return next();
    }
    return defaultJsonBodyLimit(c, next);
  });
  ```

  Add the local blob PUT's own 16 MiB cap right after the existing stub-upload body-limit block (~line 396, still before the JWKS auth block):

  ```ts
  if (blobUploader instanceof LocalDiskBlobUploader) {
    const localBlobPutBodyLimit = bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (inner) => jsonError(inner, "Request body too large.", runtimeMode, 413),
    });
    app.use("/api/blobs/local/:token", async (c, next) => {
      if (!isLocalBlobPut(c)) return next();
      return localBlobPutBodyLimit(c, next);
    });
  }
  ```

  Extend the JWKS-auth exemption (~line 412-421) to also skip these routes — a browser `<img>`/fetch reading a preview cannot attach an Authorization header, and the HMAC token in the URL is the credential, exactly like an Azure SAS URL never goes through this app's auth gate either:

  ```ts
  app.use("/api/*", async (c, next) => {
    // GET /api/runtime-info stays public: the About-this-AI transparency panel (EU AI Act
    // Art. 50) must render before login. CORS preflights never reach here — the cors
    // middleware above short-circuits OPTIONS.
    if (c.req.method === "GET" && c.req.path === "/api/runtime-info") {
      return next();
    }
    // Local-disk blob byte-transfer routes (D1) are guarded by their own short-lived HMAC
    // token embedded in the URL, mirroring how an Azure SAS URL carries its own credential and
    // never reaches this app's JWT gate either (it's not even routed through this app).
    if (LOCAL_BLOB_ROUTE_PATTERN.test(c.req.path)) {
      return next();
    }
    // /api/testing/reset is route-gated on allowTestReset already, but layering JWT defense in
    // depth costs nothing and matches the plan's hardening intent.
    return verifyJwt(c, next);
  });
  ```

  Add the route handlers right after the existing stub upload PUT block (~line 707, before `app.post("/api/evidence/:id/extract", ...)`):

  ```ts
  if (blobUploader instanceof LocalDiskBlobUploader) {
    app.put("/api/blobs/local/:token", async (context) => {
      const blobPath = blobUploader.verifyToken(context.req.param("token"), "PUT");
      const bytes = new Uint8Array(await context.req.arrayBuffer());
      await blobUploader.writeOnce(blobPath, bytes);
      return context.json({ ok: true }, 201);
    });

    app.get("/api/blobs/local/:token", async (context) => {
      const blobPath = blobUploader.verifyToken(context.req.param("token"), "GET");
      const bytes = await blobUploader.readBlob(blobPath);
      context.header("content-type", inferLocalBlobContentType(blobPath));
      return context.body(bytes);
    });
  }
  ```

  Add error-to-status mapping in `app.onError` (~line 547, right after the `BlobUploaderUnavailableError` branch):

  ```ts
  if (error instanceof LocalBlobTokenError) {
    return jsonError(c, error.message, runtimeMode, 401, { code: error.code });
  }

  if (error instanceof LocalBlobConflictError) {
    return jsonError(c, error.message, runtimeMode, 409, { code: error.code });
  }

  if (error instanceof LocalBlobNotFoundError) {
    return jsonError(c, error.message, runtimeMode, 404, { code: error.code });
  }
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/local-blob-routes.test.ts`

- [ ] Commit:

  ```
  git add services/api/src/app.ts tests/unit/local-blob-routes.test.ts
  git commit -m "$(cat <<'EOF'
  feat(api): add PUT/GET /api/blobs/local/:token routes for LocalDiskBlobUploader

  HMAC-token-guarded, write-once byte transfer for self-hosted evidence
  storage; exempt from the JWKS auth gate like an Azure SAS URL would be,
  since the token in the URL is itself the credential.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — `GET /api/evidence/:id/file-url` + `GET /ready` recognize the local uploader

**Files:**

- Modify: `services/api/src/app.ts` (`/api/evidence/:id/file-url` route ~line 793-804; `/ready` route ~line 621)
- Test: `tests/unit/local-blob-routes.test.ts` (extend, from Task 3)

**Interfaces:**

- Produces: `GET /api/evidence/:id/file-url` returns `{url, expiresInSeconds}` (200) whenever `blobUploader.kind` is `"azure"` OR `"local"` and the evidence's `blobPath` starts with `evidence-uploads/` (previously Azure-only). `GET /ready`'s `checks.blob` reports `true` for `"local"` too (previously Azure-only) — it never gated the overall `ready` boolean, so this is purely informational.

### Steps

- [ ] Write the failing tests — append to `tests/unit/local-blob-routes.test.ts`:

  ```ts
  test("GET /api/evidence/:id/file-url returns a local read URL when the local disk uploader is active", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));

    const created = await app.request("http://localhost/api/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Kvitto",
        originalFilename: "kvitto.jpg",
        mimeType: "image/jpeg",
        modalities: ["upload"],
        blobPath: "evidence-uploads/upload_1/kvitto.jpg",
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { evidence: { id: string } };

    const fileUrl = await app.request(`http://localhost/api/evidence/${createdBody.evidence.id}/file-url`);
    assert.equal(fileUrl.status, 200);
    const body = (await fileUrl.json()) as { url: string; expiresInSeconds: number };
    assert.match(body.url, /^\/api\/blobs\/local\//);
    assert.equal(body.expiresInSeconds, 600);
  });

  test("GET /ready reports checks.blob = true when the local disk uploader is active", async (t) => {
    const app = createLocalBlobTestApp(withTempBlobDir(t));
    const ready = await app.request("http://localhost/ready");
    assert.equal(ready.status, 200);
    const body = (await ready.json()) as { checks: { blob: boolean } };
    assert.equal(body.checks.blob, true);
  });
  ```

- [ ] Run it and confirm it fails:
      `corepack pnpm exec tsx --test tests/unit/local-blob-routes.test.ts`
      Expected failure: `file-url` answers 404 `preview_unavailable` instead of 200; `checks.blob` is `false`.

- [ ] Minimal implementation — in `services/api/src/app.ts`:

  Update the `/ready` route (~line 621):

  ```ts
  // Wave G′ / P1-4 + D1: peripherals report live Azure OR the local-disk self-host backend —
  // both are real (non-discarding) storage. Demo stubs keep overall ready true (labeled
  // intentional backends); unavailable fail-closed peripherals take the process out of ready.
  const blobOk = blobUploader.kind === "azure" || blobUploader.kind === "local";
  ```

  Update the file-url route (~line 793-804):

  ```ts
  // Short-lived read URL for previews. Azure and the local-disk self-host backend both qualify:
  // the stub uploader discards bytes (previews come from the client-side blob cache) and
  // legacy/seed evidence has a synthetic blobPath, so both answer 404 preview_unavailable.
  app.get("/api/evidence/:id/file-url", async (context) => {
    const evidenceContext = await currentStore.getEvidenceContext(context.req.param("id"));
    if (!evidenceContext) throw new HTTPException(404, { message: "Evidence not found" });
    const { blobPath } = evidenceContext.evidence;
    const uploaderSupportsPreview = blobUploader.kind === "azure" || blobUploader.kind === "local";
    if (!uploaderSupportsPreview || !blobPath.startsWith("evidence-uploads/")) {
      return jsonError(context, "No file preview is available for this evidence.", runtimeMode, 404, {
        code: "preview_unavailable",
      });
    }
    const sas = await blobUploader.mintReadSas(blobPath);
    return context.json({ url: sas.url, expiresInSeconds: sas.expiresInSeconds });
  });
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/local-blob-routes.test.ts`

- [ ] Commit:

  ```
  git add services/api/src/app.ts tests/unit/local-blob-routes.test.ts
  git commit -m "$(cat <<'EOF'
  fix(api): evidence file-url and /ready recognize the local disk blob backend

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — `packages/api-client` `getEvidenceFileUrl` API-relative resolution (deviation)

> **Deviation from the master interface contract:** the master plan's API section only names `services/api/src/app.ts` changes for Phase A. Investigation while integrating Task 4 found that `getEvidenceFileUrl` in `packages/api-client/src/index.ts` returns the API's raw `payload.url` string unresolved. `uploadBlob` in the same file already has to solve this exact problem for stub uploads (comment: _"Stub uploadUrls are API-relative (`/api/uploads/{id}`); resolve them against the API base so the PUT reaches the API (possibly via the web api-proxy) instead of 404ing on the web origin"_) — but `getEvidenceFileUrl` never got the same fix, because until now every non-demo `file-url` response was an absolute Azure SAS URL. Without this fix, `/api/blobs/local/:token` read URLs would 404 the moment a browser tries to load them (they'd resolve against the **web app's** origin, which has no such route, instead of the API's). This is a one-line, low-risk fix using the exact pattern already proven for uploads.

**Files:**

- Modify: `packages/api-client/src/index.ts` (`getEvidenceFileUrl`, ~line 449-462)
- Test: `tests/unit/api-client-auth.test.ts` (extend)

**Interfaces:**

- Consumes: nothing new.
- Produces: `getEvidenceFileUrl(evidenceId)` return value unchanged in shape (`{url: string} | null`); behavior changes so an API-relative `url` (starts with `/`) is resolved against `this.baseUrl` before being returned, matching `uploadBlob`'s `isApiRelative` handling. Absolute URLs (Azure SAS) pass through untouched.

### Steps

- [ ] Write the failing tests — append to `tests/unit/api-client-auth.test.ts`:

  ```ts
  test("getEvidenceFileUrl resolves an API-relative local blob URL against the API base", async (t) => {
    const captured = mockFetch(t, () => jsonResponse({ url: "/api/blobs/local/abc123.def456", expiresInSeconds: 600 }));
    const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

    const result = await client.getEvidenceFileUrl("evidence_1");

    assert.deepEqual(result, { url: `${BASE_URL}/api/blobs/local/abc123.def456` });
    assert.equal(captured[0]?.url, `${BASE_URL}/api/evidence/evidence_1/file-url`);
  });

  test("getEvidenceFileUrl passes an absolute Azure SAS URL through untouched", async (t) => {
    const azureUrl = "https://account.blob.core.windows.net/evidence/receipt.jpg?sig=abc";
    mockFetch(t, () => jsonResponse({ url: azureUrl, expiresInSeconds: 600 }));
    const client = createAccountingApiClient({ baseUrl: BASE_URL, runtimeMode: "normal" });

    const result = await client.getEvidenceFileUrl("evidence_1");

    assert.deepEqual(result, { url: azureUrl });
  });
  ```

- [ ] Run it and confirm it fails:
      `corepack pnpm exec tsx --test tests/unit/api-client-auth.test.ts`
      Expected failure: the first test's `result.url` is `/api/blobs/local/abc123.def456` (unresolved) instead of `${BASE_URL}/api/blobs/local/abc123.def456`.

- [ ] Minimal implementation — in `packages/api-client/src/index.ts`, replace `getEvidenceFileUrl` (~line 449-462):

  ```ts
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
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/api-client-auth.test.ts`

- [ ] Commit:

  ```
  git add packages/api-client/src/index.ts tests/unit/api-client-auth.test.ts
  git commit -m "$(cat <<'EOF'
  fix(api-client): resolve API-relative getEvidenceFileUrl URLs against the API base

  Mirrors uploadBlob's existing isApiRelative handling — needed so the
  LocalDiskBlobUploader's /api/blobs/local/:token read URLs actually load in
  the browser instead of 404ing on the web origin.

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — `pnpm db:backup` script

**Files:**

- Create: `scripts/db-backup.mts`
- Modify: `package.json` (new `db:backup` script entry, after `db:down`)
- Test: `tests/unit/db-backup-config.test.ts` (new file — pure helpers only; the `pg_dump`/`robocopy`/`cp` orchestration itself needs Docker/Postgres/OS tooling and is not unit-testable, matching how `scripts/db.mts`'s own Docker-dependent commands — `cmdUp`, `cmdDown`, `cmdTest` — have no `tests/unit` coverage either; it is exercised manually in Task 7's verification step and in the day-to-day `pnpm db:backup` workflow described in `docs/SELF_HOST.md`)

**Interfaces:**

- Produces:
  - `export class BackupConfigError extends Error {}`
  - `export function resolveBackupDatabaseUrl(cliUrl: string | undefined, env: NodeJS.ProcessEnv): string` — `--database-url` wins, then `DATABASE_URL`, then legacy `SUPABASE_DB_URL`; throws `BackupConfigError` if none configured.
  - `export function resolveBackupBlobDir(cliBlobDir: string | undefined, env: NodeJS.ProcessEnv): string | undefined` — `--blob-dir` wins, then `ACCOUNTING_BLOB_DIR`; `undefined` means "skip the blob mirror step".
  - `export function formatBackupTimestamp(now: Date): string` — e.g. `"2026-08-20T153045Z"`.
  - `export function buildDumpFilename(now: Date): string` — e.g. `"2026-08-20T153045Z.dump"`.
  - CLI: `tsx scripts/db-backup.mts [--database-url <url>] [--blob-dir <path>] [--out-dir <dir>]`.

### Steps

- [ ] Write the failing tests — new file `tests/unit/db-backup-config.test.ts`:

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";

  import {
    BackupConfigError,
    buildDumpFilename,
    formatBackupTimestamp,
    resolveBackupBlobDir,
    resolveBackupDatabaseUrl,
  } from "../../scripts/db-backup.mts";

  test("resolveBackupDatabaseUrl prefers --database-url over env", () => {
    assert.equal(
      resolveBackupDatabaseUrl("postgres://cli/db", { DATABASE_URL: "postgres://env/db" }),
      "postgres://cli/db",
    );
  });

  test("resolveBackupDatabaseUrl falls back to DATABASE_URL, then legacy SUPABASE_DB_URL", () => {
    assert.equal(resolveBackupDatabaseUrl(undefined, { DATABASE_URL: "postgres://env/db" }), "postgres://env/db");
    assert.equal(
      resolveBackupDatabaseUrl(undefined, { SUPABASE_DB_URL: "postgres://legacy/db" }),
      "postgres://legacy/db",
    );
  });

  test("resolveBackupDatabaseUrl throws BackupConfigError when nothing is configured", () => {
    assert.throws(() => resolveBackupDatabaseUrl(undefined, {}), BackupConfigError);
  });

  test("resolveBackupBlobDir prefers --blob-dir, then ACCOUNTING_BLOB_DIR, else undefined", () => {
    assert.equal(resolveBackupBlobDir("/cli/blobs", { ACCOUNTING_BLOB_DIR: "/env/blobs" }), "/cli/blobs");
    assert.equal(resolveBackupBlobDir(undefined, { ACCOUNTING_BLOB_DIR: "/env/blobs" }), "/env/blobs");
    assert.equal(resolveBackupBlobDir(undefined, {}), undefined);
  });

  test("formatBackupTimestamp produces a sortable, filesystem-safe UTC string", () => {
    const fixed = new Date("2026-08-20T15:30:45.123Z");
    assert.equal(formatBackupTimestamp(fixed), "2026-08-20T153045Z");
  });

  test("buildDumpFilename appends .dump to the formatted timestamp", () => {
    const fixed = new Date("2026-08-20T15:30:45.123Z");
    assert.equal(buildDumpFilename(fixed), "2026-08-20T153045Z.dump");
  });
  ```

- [ ] Run it and confirm it fails:
      `corepack pnpm exec tsx --test tests/unit/db-backup-config.test.ts`
      Expected failure: module `../../scripts/db-backup.mts` does not exist.

- [ ] Minimal implementation — create `scripts/db-backup.mts`:

  ```ts
  /**
   * `pnpm db:backup` — pg_dump (custom format) of DATABASE_URL/--database-url into
   * ./backups/<timestamp>.dump, plus a best-effort mirror of ACCOUNTING_BLOB_DIR into
   * ./backups/blobs/<timestamp>/ (the LocalDiskBlobUploader's evidence root — see D1 in
   * docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md).
   *
   * Runs identically on Windows/Linux/macOS via node:child_process only (no bash/PowerShell-only
   * syntax) — same portability goal as scripts/db.mts and scripts/db-migrations.mts.
   *
   *   tsx scripts/db-backup.mts [--database-url <url>] [--blob-dir <path>] [--out-dir <dir>]
   *
   * Connection resolution: --database-url wins, then DATABASE_URL, then legacy SUPABASE_DB_URL.
   * Unlike the migration runner this never touches DATABASE_MIGRATION_URL — a dump only needs
   * read access, so the ordinary runtime credential is fine.
   *
   * Blob resolution: --blob-dir wins, then ACCOUNTING_BLOB_DIR; if neither is set, the blob-mirror
   * step is skipped (a Postgres-only backup is still useful — e.g. Azure-backed evidence storage
   * has its own retention story, see docs/SELF_HOST.md).
   *
   * Requires `pg_dump` on PATH, matching your server's major version (15-17) — see
   * https://www.postgresql.org/download/ and docs/SELF_HOST.md for the Windows install note.
   * The blob mirror uses `robocopy` on Windows (bundled with the OS) and `cp -R` elsewhere.
   */
  import { existsSync, mkdirSync } from "node:fs";
  import path from "node:path";
  import { fileURLToPath, pathToFileURL } from "node:url";
  import { spawn } from "node:child_process";

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const DEFAULT_OUT_DIR = path.join(repoRoot, "backups");

  export class BackupConfigError extends Error {}

  function normalize(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  /** --database-url wins, then DATABASE_URL, then legacy SUPABASE_DB_URL. */
  export function resolveBackupDatabaseUrl(cliUrl: string | undefined, env: NodeJS.ProcessEnv): string {
    const explicit = normalize(cliUrl);
    if (explicit) return explicit;
    const fromEnv = normalize(env.DATABASE_URL) ?? normalize(env.SUPABASE_DB_URL);
    if (fromEnv) return fromEnv;
    throw new BackupConfigError(
      "No database URL configured. Pass --database-url <url> or set DATABASE_URL (see .env.example).",
    );
  }

  /** --blob-dir wins, then ACCOUNTING_BLOB_DIR; undefined means "skip the blob mirror step". */
  export function resolveBackupBlobDir(cliBlobDir: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
    return normalize(cliBlobDir) ?? normalize(env.ACCOUNTING_BLOB_DIR);
  }

  /**
   * Sortable, filesystem-safe UTC timestamp (no colons — illegal in Windows filenames): e.g.
   * "2026-08-20T153045Z". Shared by the dump filename and the blob-mirror subdirectory so one
   * backup run's two artifacts carry one identifier.
   */
  export function formatBackupTimestamp(now: Date): string {
    return now
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/:/g, "");
  }

  export function buildDumpFilename(now: Date): string {
    return `${formatBackupTimestamp(now)}.dump`;
  }

  type SpawnResult = { code: number };

  function runInherit(command: string, args: string[]): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1 }));
    });
  }

  async function dumpDatabase(databaseUrl: string, outFile: string): Promise<void> {
    console.log(`Running pg_dump --format=custom into ${path.relative(repoRoot, outFile)}...`);
    let result: SpawnResult;
    try {
      result = await runInherit("pg_dump", ["--format=custom", `--file=${outFile}`, databaseUrl]);
    } catch (error) {
      throw new Error(
        `Could not launch pg_dump (${error instanceof Error ? error.message : String(error)}). Install ` +
          "PostgreSQL client tools matching your server's major version (15-17) and ensure pg_dump is on " +
          "PATH — see https://www.postgresql.org/download/ and docs/SELF_HOST.md.",
      );
    }
    if (result.code !== 0) {
      throw new Error(`pg_dump exited with code ${result.code}.`);
    }
  }

  /**
   * Windows: robocopy (bundled with the OS) — exit codes 0-7 are success (bitmask of "some files
   * copied"/"extra files present"/etc.), 8+ is failure. Everything else: cp -R. Both mirror the
   * SOURCE tree's contents into an already-created DEST directory.
   */
  async function mirrorBlobDir(blobDir: string, destDir: string): Promise<void> {
    mkdirSync(destDir, { recursive: true });
    if (process.platform === "win32") {
      console.log(`Mirroring ${blobDir} -> ${destDir} via robocopy...`);
      const result = await runInherit("robocopy", [blobDir, destDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS"]);
      if (result.code >= 8) {
        throw new Error(`robocopy exited with code ${result.code} (>=8 indicates failure) mirroring ${blobDir}.`);
      }
      return;
    }
    console.log(`Mirroring ${blobDir} -> ${destDir} via cp -R...`);
    const result = await runInherit("cp", ["-R", `${blobDir}/.`, destDir]);
    if (result.code !== 0) {
      throw new Error(`cp -R exited with code ${result.code} mirroring ${blobDir}.`);
    }
  }

  function parseArgs(argv: string[]): { databaseUrl?: string; blobDir?: string; outDir?: string } {
    const args = argv.slice(2);
    const parsed: { databaseUrl?: string; blobDir?: string; outDir?: string } = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--database-url") parsed.databaseUrl = args[++i];
      else if (arg === "--blob-dir") parsed.blobDir = args[++i];
      else if (arg === "--out-dir") parsed.outDir = args[++i];
    }
    return parsed;
  }

  async function main(): Promise<void> {
    const { databaseUrl: cliUrl, blobDir: cliBlobDir, outDir: cliOutDir } = parseArgs(process.argv);
    const databaseUrl = resolveBackupDatabaseUrl(cliUrl, process.env);
    const blobDir = resolveBackupBlobDir(cliBlobDir, process.env);
    const outDir = cliOutDir ? path.resolve(cliOutDir) : DEFAULT_OUT_DIR;

    mkdirSync(outDir, { recursive: true });
    const now = new Date();
    const timestamp = formatBackupTimestamp(now);
    const dumpFile = path.join(outDir, buildDumpFilename(now));

    await dumpDatabase(databaseUrl, dumpFile);
    console.log(`Postgres backup complete: ${path.relative(repoRoot, dumpFile)}`);

    if (!blobDir) {
      console.log("ACCOUNTING_BLOB_DIR not set — skipping blob mirror (Postgres-only backup).");
      return;
    }
    if (!existsSync(blobDir)) {
      console.warn(`ACCOUNTING_BLOB_DIR "${blobDir}" does not exist yet — skipping blob mirror.`);
      return;
    }
    const blobDestDir = path.join(outDir, "blobs", timestamp);
    await mirrorBlobDir(blobDir, blobDestDir);
    console.log(`Blob directory backup complete: ${path.relative(repoRoot, blobDestDir)}`);
  }

  const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  if (isMain) {
    main().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
  ```

  In `package.json`, add a `db:backup` entry right after `"db:down": "tsx scripts/db.mts down",`:

  ```json
      "db:backup": "tsx scripts/db-backup.mts",
  ```

- [ ] Run it again and confirm it passes:
      `corepack pnpm exec tsx --test tests/unit/db-backup-config.test.ts`

- [ ] Manually verify the CLI orchestration end to end (Docker required — this is the part `node:test` cannot cover, same as `scripts/db.mts`'s own Docker-backed commands):

  ```
  pnpm db:up
  pnpm db:migrate
  set ACCOUNTING_BLOB_DIR=C:\jpx-blobs   (or export on posix)
  echo test > "%ACCOUNTING_BLOB_DIR%\probe.txt"
  set DATABASE_URL=<paste the URL printed by `pnpm db:url`>
  pnpm db:backup
  ```

  Expect: `backups/<timestamp>.dump` exists and is non-empty; `backups/blobs/<timestamp>/probe.txt` exists with the same content.

- [ ] Commit:

  ```
  git add scripts/db-backup.mts package.json tests/unit/db-backup-config.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ops): add pnpm db:backup (pg_dump custom format + blob dir mirror)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — `docs/SELF_HOST.md` runbook

**Files:**

- Create: `docs/SELF_HOST.md`

**Interfaces:** none (documentation only).

### Steps

- [ ] Write `docs/SELF_HOST.md`:

  ````markdown
  # Self-hosting jpx-accounting in normal mode, locally

  This is the D1 runbook: running `ACCOUNTING_RUNTIME_MODE=normal` entirely on a local machine —
  durable Postgres, evidence blobs on local disk instead of Azure Storage, real Supabase Auth — so
  the FY1 migration and ongoing bookkeeping have somewhere durable to land before any Azure
  decision is revisited. See
  [`docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md`](superpowers/specs/2026-08-20-kapitas-full-replacement-design.md)
  (D1) for the design rationale.

  ## Env matrix

  | Var                                                                                    | Where it comes from                                                                       | Notes                                                                                                                                                                                                       |
  | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ACCOUNTING_RUNTIME_MODE=normal`                                                       | you set it                                                                                | Demo mode ignores everything below.                                                                                                                                                                         |
  | `DATABASE_URL`                                                                         | `pnpm db:up` then `pnpm db:url`                                                           | Local Compose Postgres 17 + pgvector, dynamic port. Run `pnpm db:migrate` (and optionally `pnpm db:seed`) before first boot. See [`scripts/integration-db.md`](../scripts/integration-db.md).               |
  | `SUPABASE_JWKS_URL`                                                                    | a free Supabase project's Settings → API → Project URL, as `${SUPABASE_URL}/auth/v1/keys` | **Required in normal mode — the API refuses to boot without it (fail closed).** This Supabase project supplies Auth/JWKS only; Postgres stays local (`DATABASE_URL` above), not Supabase's hosted database. |
  | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`                            | same Supabase project, Settings → API                                                     | Web **build-time** pair — both must be set before `pnpm build`/`pnpm dev:web` to enable the `/login` UI and bearer threading.                                                                               |
  | `ADVISOR_TOOL_APPROVAL_SECRET`                                                         | generate your own                                                                         | Any high-entropy string; must NOT be the baked-in demo default. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.                                        |
  | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`                  | reuse from the existing hosted deployment's secrets                                       | Powers the advisor chat + embeddings locally too — no separate Azure OpenAI resource needed for local ops.                                                                                                  |
  | `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`          | reuse from the existing hosted deployment's secrets                                       | See the OCR limitation note below — live OCR against local-disk blobs only works if the API is reachable from the public internet.                                                                          |
  | `ACCOUNTING_BLOB_DIR`                                                                  | a local directory you create, e.g. `C:\jpx-blobs`                                         | Enables `LocalDiskBlobUploader`. Back this up — see below. Leave `AZURE_STORAGE_ACCOUNT`/`AZURE_STORAGE_CONTAINER` unset so this takes effect (Azure always wins if both are configured).                   |
  | `ACCOUNTING_CORS_ORIGINS`                                                              | usually unnecessary                                                                       | Only needed if something calls the API directly from a browser, bypassing the web app's `/api-proxy`. The local-disk blob read/write flow is same-origin through the proxy and needs no CORS entry.         |
  | `ACCOUNTING_API_BASE_URL=http://localhost:3001`, `NEXT_PUBLIC_API_BASE_URL=/api-proxy` | same as demo mode                                                                         | Unchanged from the default dev setup.                                                                                                                                                                       |

  ## Boot order

  1. `pnpm db:up` — starts (or reuses) this clone's isolated Postgres container.
  2. `pnpm db:url` — copy the printed URL into `DATABASE_URL`.
  3. `pnpm db:migrate` — applies `infra/supabase/migrations/*`.
  4. `pnpm db:seed` — optional, only for a throwaway dev dataset; skip it for the real FY1 migration (Phase D lands the SIE import path for that).
  5. Create the Supabase Auth project (one-time) and fill in `SUPABASE_JWKS_URL` / `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  6. Generate `ADVISOR_TOOL_APPROVAL_SECRET`; copy `AZURE_OPENAI_*` / `AZURE_DOCUMENT_INTELLIGENCE_*` from the existing deployment.
  7. Create the `ACCOUNTING_BLOB_DIR` directory; set the env var.
  8. `pnpm dev:api` (or the production `pnpm build && node api-deploy/server.cjs` path) — confirm `curl http://localhost:3001/health` answers `{"ok":true,"runtimeMode":"normal"}` and `curl http://localhost:3001/ready` reports `ready:true` with `checks.ledger:true`, `checks.blob:true`.
  9. `pnpm dev:web` — confirm `/login` renders and the app is reachable at `http://localhost:3002`.

  ## Backup / restore

  Run `pnpm db:backup` regularly (cron/Task Scheduler, or by hand before risky operations). It writes:

  - `backups/<timestamp>.dump` — a `pg_dump --format=custom` snapshot of `DATABASE_URL`.
  - `backups/blobs/<timestamp>/` — a mirror of `ACCOUNTING_BLOB_DIR` (robocopy on Windows, `cp -R` elsewhere).

  Prerequisite: `pg_dump` on PATH, matching your Postgres server's major version (15-17). On
  Windows, install the "command line tools" from the [PostgreSQL Windows installer](https://www.postgresql.org/download/windows/)
  (EDB's installer) and add `C:\Program Files\PostgreSQL\<version>\bin` to PATH — it ships
  `pg_dump.exe`/`pg_restore.exe` without requiring a local server install.

  Restore:

  ```bash
  # Postgres — into an empty database (create it first if needed):
  pg_restore --clean --if-exists --no-owner --dbname="<DATABASE_URL>" backups/<timestamp>.dump

  # Blobs — copy the mirrored directory back over ACCOUNTING_BLOB_DIR:
  # Windows:
  robocopy backups\blobs\<timestamp> "%ACCOUNTING_BLOB_DIR%" /E
  # macOS/Linux:
  cp -R backups/blobs/<timestamp>/. "$ACCOUNTING_BLOB_DIR"
  ```
  ````

  Then re-run `pnpm db:migrate` (idempotent) before booting the API, in case the restored dump
  predates a migration that has since landed on `main`.

  ## Known limitation: live OCR against local-disk blobs

  `GET /api/evidence/:id/file-url` returns a same-origin `/api/blobs/local/:token` URL when
  `LocalDiskBlobUploader` is active. Browser previews work fine (same-origin through the web app's
  `/api-proxy`). Azure Document Intelligence, however, is a remote cloud service — it cannot reach
  a `localhost`-only URL to perform live OCR extraction. `POST /api/evidence/:id/extract` already
  fails soft in this situation (catches the fetch error, logs a warning, and keeps returning the
  previously stored/demo extraction) — you will not see a live-OCR result on receipts uploaded
  while running purely locally without a public tunnel. This is unchanged from how stub-mode
  uploads already behave; it's a real gap for local-only self-hosting, not a bug. Exposing the API
  through a tunnel (e.g. a reverse proxy with a public hostname) removes the limitation, at which
  point normal HTTPS/CSP considerations apply.

  ## Later Azure migration

  Because `LocalDiskBlobUploader` uses the **identical** `evidence-uploads/{uploadId}/{filename}`
  blobPath convention as `AzureBlobUploader`, moving evidence to Azure Blob later is a pure bulk
  copy — no event history rewrite, since every `EvidenceObject.blobPath` already matches the target
  layout. A one-time `azcopy sync ACCOUNTING_BLOB_DIR https://<account>.blob.core.windows.net/<container>`
  (or equivalent) followed by setting `AZURE_STORAGE_ACCOUNT`/`AZURE_STORAGE_CONTAINER` (which take
  precedence over `ACCOUNTING_BLOB_DIR` automatically) completes the cutover.

  For the ledger itself: re-point `DATABASE_URL` at the hosted Postgres and replay
  `pnpm db:migrate` there, or use `pg_restore` with the latest `pnpm db:backup` dump. Phase D of
  the KFR master plan additionally lands a period-scoped SIE export (`#IB`/`#UB`/`#RES` blocks) —
  once that ships, a full-history or per-FY SIE export is an additional portable path for handing
  a finished fiscal year to a revisor's tooling, independent of the Postgres-level migration above.

  ```

  ```

- [ ] Verify by actually booting: start `pnpm db:up && pnpm db:migrate`, set the env vars per the
      matrix above (a scratch Supabase project is fine for this verification), run `pnpm dev:api`, and
      confirm:

  ```
  curl http://localhost:3001/health
  curl http://localhost:3001/ready
  ```

  both answer as documented (`ready:true`, `checks.blob:true`) before committing.

- [ ] Commit:

  ```
  git add docs/SELF_HOST.md
  git commit -m "$(cat <<'EOF'
  docs: add self-host runbook for local normal-mode ops (D1)

  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Phase verification

1. `corepack pnpm check` — lint, format, typecheck ×2, unit tests, build — must stay green after every task.
2. `corepack pnpm exec tsx --test tests/unit/blob-uploader.test.ts tests/unit/api-config.test.ts tests/unit/api-runtime.test.ts tests/unit/local-blob-routes.test.ts tests/unit/api-client-auth.test.ts tests/unit/db-backup-config.test.ts` — the full set of tests this phase adds/extends.
3. The Task 6 and Task 7 manual-verification steps (Docker + a real Supabase project) are the parts CI cannot exercise — do not claim Phase A done without having actually run them once.
4. Confirm `createBlobUploader`'s precedence end to end: with only `ACCOUNTING_BLOB_DIR` set, `/ready` reports `checks.blob:true`; with both Azure and `ACCOUNTING_BLOB_DIR` set, Azure wins (`AzureBlobUploader`, unchanged behavior).
