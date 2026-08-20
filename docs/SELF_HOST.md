# Self-hosting jpx-accounting in normal mode, locally

This is the D1 runbook: running `ACCOUNTING_RUNTIME_MODE=normal` entirely on a local machine —
durable Postgres, evidence blobs on local disk instead of Azure Storage, real Supabase Auth — so the
FY1 migration and ongoing bookkeeping have somewhere durable to land before any Azure decision is
revisited. See
[`docs/superpowers/specs/2026-08-20-kapitas-full-replacement-design.md`](superpowers/specs/2026-08-20-kapitas-full-replacement-design.md)
(D1) for the design rationale.

What stays local: the ledger (Postgres in Docker) and evidence bytes (a directory you own and back
up). What is still a hosted dependency: Supabase Auth (JWKS verification only — not its Postgres),
Azure OpenAI (advisor + embeddings), and Azure Document Intelligence (OCR — see the known
limitation below).

## Env matrix

| Var                                                                                    | Where it comes from                                                                       | Notes                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCOUNTING_RUNTIME_MODE=normal`                                                       | you set it                                                                                | Demo mode ignores everything below. An unrecognized value throws at boot rather than silently demoting to demo.                                                                                                                                         |
| `NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE=normal`                                           | you set it                                                                                | Must match the API's mode. Web **build-time** for client bundles; the api-proxy reads it per request.                                                                                                                                                   |
| `DATABASE_URL`                                                                         | `pnpm db:up` then `pnpm db:url`                                                           | Local Compose Postgres 17 + pgvector on a dynamic port. `pnpm db:url` prints the URL and nothing else, so it is safe to capture in a script. Run `pnpm db:migrate` before first boot. See [`scripts/integration-db.md`](../scripts/integration-db.md).  |
| `SUPABASE_JWKS_URL`                                                                    | a free Supabase project's Settings → API → Project URL, as `${SUPABASE_URL}/auth/v1/keys` | **Required in normal mode — the API refuses to boot without it (fail closed).** This Supabase project supplies Auth/JWKS only; Postgres stays local (`DATABASE_URL` above), not Supabase's hosted database.                                             |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`                            | same Supabase project, Settings → API                                                     | Web **build-time** pair — both must be set before `pnpm build` / `pnpm dev:web` to enable the `/login` UI and bearer threading. Without them the browser has no way to obtain the JWT the API now demands.                                              |
| `ADVISOR_TOOL_APPROVAL_SECRET`                                                         | generate your own                                                                         | Any high-entropy string; normal mode refuses to boot if it is missing **or** equal to the baked-in demo default. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.                                   |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_MODEL`                  | reuse from the existing hosted deployment's secrets                                       | Powers advisor chat + embeddings locally too — no separate Azure OpenAI resource needed. Endpoint + key are what matter: without both, normal mode wires `UnavailableAiRuntime` and `/ready` reports `ai:false`.                                        |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`          | reuse from the existing hosted deployment's secrets                                       | Without both, normal mode wires the fail-closed client and `/ready` drops to `ready:false`. Live OCR still cannot read local-disk blobs — see the known limitation below.                                                                               |
| `ACCOUNTING_BLOB_DIR`                                                                  | a local directory, e.g. `C:\jpx-blobs`                                                    | Enables `LocalDiskBlobUploader`. Created at boot if missing; boot fails fast if it is not writable. Back it up — see below. Leave `AZURE_STORAGE_ACCOUNT`/`AZURE_STORAGE_CONTAINER` unset so it takes effect (Azure wins whenever both are configured). |
| `NEXT_PUBLIC_AZURE_STORAGE_ORIGIN`                                                     | leave unset                                                                               | Only needed for direct-to-Azure SAS traffic. Local-disk previews are same-origin and already allowed by the strict CSP (`img-src 'self'`, and `frame-src` falling back to `default-src 'self'` for PDF iframes).                                        |
| `ACCOUNTING_CORS_ORIGINS`                                                              | usually unnecessary                                                                       | Normal mode uses an allowlist (empty by default). Only needed if something calls the API directly from a browser, bypassing the web app's `/api-proxy`. The local-disk blob read/write flow is same-origin through the proxy.                           |
| `ACCOUNTING_API_BASE_URL=http://localhost:3001`, `NEXT_PUBLIC_API_BASE_URL=/api-proxy` | same as demo mode                                                                         | Unchanged from the default dev setup. `ACCOUNTING_API_BASE_URL` must be an absolute `http(s)` URL — it is read server-side per request, so it can change without a web rebuild.                                                                         |

## Boot order

1. `pnpm db:up` — starts (or reuses) this clone's isolated Postgres container.
2. `pnpm db:url` — copy the printed URL into `DATABASE_URL`.
3. `pnpm db:migrate` — applies `infra/supabase/migrations/*` and prints its capability assertions.
4. `pnpm db:seed` — optional demo dataset (org `org_jpx` / workspace `workspace_main`). Nothing
   requires it: organization and workspace are plain columns, not foreign keys, so an unseeded
   database accepts real writes. Skip it for the real FY1 migration and import the existing ledger
   through `POST /api/imports/sie` instead.
5. Create the Supabase Auth project (one-time) and fill in `SUPABASE_JWKS_URL` /
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Generate `ADVISOR_TOOL_APPROVAL_SECRET`; copy `AZURE_OPENAI_*` / `AZURE_DOCUMENT_INTELLIGENCE_*`
   from the existing deployment.
7. Set `ACCOUNTING_BLOB_DIR`. Creating the directory yourself is optional (the API creates it at
   boot) but is worth doing before the first `pnpm db:backup` — the mirror step skips a directory
   that does not exist yet.
8. `pnpm dev:api`, and confirm:

   ```bash
   curl http://localhost:3001/health
   # {"ok":true,"runtimeMode":"normal"}

   curl http://localhost:3001/ready
   # {"ready":true,"runtimeMode":"normal","checks":{"ledger":true,"ai":true,"blob":true,"docintel":true}}
   ```

   The boot line printed just above the listen message is the resolved posture — confirm it says
   `"ledgerStore":"postgres"` and `"authEnabled":true`.

9. `pnpm dev:web` — confirm `/login` renders and the app is reachable at `http://localhost:3002`.

### Reading `/ready`

`ready` is `ledger && ai && (blob and docintel both non-fail-closed)`. All four sub-checks matter in
normal mode:

| Check      | `true` when                                                                | If `false`                                                                              |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `ledger`   | `SELECT 1` against `DATABASE_URL` succeeds                                 | `DATABASE_URL` missing or the container is down — every ledger route fails closed.      |
| `ai`       | `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` are set                   | Advisor and embeddings are unavailable; `ready:false`.                                  |
| `blob`     | Azure Storage **or** `ACCOUNTING_BLOB_DIR` is wired (real, non-discarding) | Uploads fail closed; `ready:false`.                                                     |
| `docintel` | `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` + `..._API_KEY` are set             | `ready:false`, but capture still works: extraction fails soft to the stored extraction. |

A local instance with `ACCOUNTING_BLOB_DIR` set but no Azure credentials answers
`{"ready":false,...,"checks":{"ledger":true,"ai":false,"blob":true,"docintel":false}}` — the ledger
and blob halves of the self-host story are complete, the two hosted AI dependencies are simply not
configured.

## How local-disk blob storage behaves

- **Same path convention as Azure** — `evidence-uploads/{uploadId}/{sanitizedFilename}` under
  `ACCOUNTING_BLOB_DIR`, so the stored `blobPath` on every evidence record already matches an Azure
  container layout.
- **The URL is the credential.** `POST /api/uploads/init` returns an API-relative
  `/api/blobs/local/<token>` upload URL; `GET /api/evidence/:id/file-url` returns the same shape for
  reads. The token is an HMAC-signed, method-bound (`PUT` vs `GET`), 10-minute payload — the same
  short-lived, self-contained credential model as an Azure SAS query string. Those two
  method/path combinations are the only exemptions from the JWKS gate besides
  `GET /api/runtime-info`; every other method on that path still requires a JWT.
- **Tokens do not survive an API restart.** The signing secret is random per process boot and never
  persisted. A capture that was mid-flight across a restart must be retried from the beginning.
- **Writes are write-once.** Replaying an upload URL answers `409 local_blob_conflict`; evidence
  bytes are never silently overwritten.
- **Same-origin end to end.** The browser reaches these URLs through the web app's `/api-proxy`, so
  no CORS entry and no CSP storage-origin allowance are needed.
- Uploads are capped at 16 MiB, the same ceiling the Azure path enforces. On read, the content type
  is inferred from the filename extension (the filesystem has no blob metadata); unknown extensions
  fall back to `application/octet-stream`.

## Backup / restore

Run `pnpm db:backup` regularly (cron / Task Scheduler, or by hand before risky operations). It
writes, under the gitignored `backups/` directory:

- `backups/<timestamp>.dump` — a `pg_dump --format=custom` snapshot of `DATABASE_URL`.
- `backups/blobs/<timestamp>/` — a mirror of `ACCOUNTING_BLOB_DIR` (robocopy on Windows, `cp -R`
  elsewhere).

Both artifacts share one timestamp so a run's two halves stay identifiable as a pair. Flags:
`--database-url`, `--blob-dir`, `--out-dir` each override the corresponding env var. Every run is a
full copy — nothing is deduplicated or pruned — so budget disk and delete old sets yourself.

Not covered by either artifact: browser-local state (dashboard layout, assistant thread history,
onboarding progress). That lives in each browser's localStorage — see
[`apps/web/lib/local-data.ts`](../apps/web/lib/local-data.ts) — and is deliberately disposable.

### Prerequisite: PostgreSQL client tools

`pg_dump` and `pg_restore` are **native PostgreSQL client binaries**. They are not bundled with
Node, with this repo, or with the Docker Compose setup — `pnpm db:up` gives you a _server_ in a
container, not client tools on your PATH. Without them `pnpm db:backup` fails loudly (exit 1) with:

```
Could not launch pg_dump (spawn pg_dump ENOENT). Install PostgreSQL client tools matching your
server's major version (15-17) and ensure pg_dump is on PATH — ...
```

On Windows, install the "Command Line Tools" component from the
[PostgreSQL Windows installer](https://www.postgresql.org/download/windows/) (EDB) — you can
deselect the server itself — and add `C:\Program Files\PostgreSQL\<version>\bin` to PATH. Match your
server's major version (the Compose database is PG 17; `pnpm db:doctor` prints the exact version).

**Alternative without a local install:** run `pg_dump` inside the pgvector container, which already
ships the matching client tools, and copy the dump out. `pnpm db:doctor` prints the Compose project
name; the container is `<project>-db-1`:

```bash
docker exec <project>-db-1 pg_dump --format=custom --file=/tmp/jpx.dump \
  "postgres://postgres:postgres@127.0.0.1:5432/jpx_dev"
docker cp <project>-db-1:/tmp/jpx.dump ./backups/manual-<timestamp>.dump
```

Inside the container, `127.0.0.1:5432` is the database itself; use
`host.docker.internal` instead when the Postgres you want to dump runs on the host outside Docker.
(In Git Bash on Windows, prefix both commands with `MSYS_NO_PATHCONV=1` or the `/tmp/...` paths get
rewritten into Windows paths.) Note this is a manual workaround: `pnpm db:backup` itself always
shells out to `pg_dump` on PATH and has no container mode.

### Callout: a missing blob directory is a silent skip

`pnpm db:backup` treats the two halves asymmetrically. A failing dump aborts the run with exit 1. A
missing blob directory does **not**: if `ACCOUNTING_BLOB_DIR` is unset, typo'd, or points at a
directory that does not exist, the script prints a warning, skips the mirror, and **exits 0** —

```
ACCOUNTING_BLOB_DIR "C:\jpx-blobss" does not exist yet — skipping blob mirror.
```

(an entirely unset value prints `ACCOUNTING_BLOB_DIR not set — skipping blob mirror (Postgres-only backup).` instead, also exit 0)

That is deliberate (a Postgres-only backup is still useful when evidence lives in Azure), but under
cron / Task Scheduler, where nobody reads stdout, it means evidence can quietly stop being backed up
while the job keeps reporting success. **Verify that each backup set actually contains a
`backups/blobs/<timestamp>/` subfolder**, and prefer scheduling a wrapper that fails when it is
absent, or pass `--blob-dir` explicitly so the value is visible in the scheduled command itself.

### Restore

```bash
# Postgres — into an empty database (create it first if needed):
pg_restore --clean --if-exists --no-owner --dbname="<DATABASE_URL>" backups/<timestamp>.dump

# Blobs — copy the mirrored directory back over ACCOUNTING_BLOB_DIR:
# Windows:
robocopy backups\blobs\<timestamp> "%ACCOUNTING_BLOB_DIR%" /E
# macOS/Linux:
cp -R backups/blobs/<timestamp>/. "$ACCOUNTING_BLOB_DIR"
```

`pg_restore` is the same native client tool as `pg_dump` — the install note above applies, and the
containerized alternative works the same way (`docker cp` the dump in, then `docker exec` the
restore).

Then re-run `pnpm db:migrate` (idempotent) before booting the API, in case the restored dump
predates a migration that has since landed on `main`.

## Known limitation: live OCR against local-disk blobs

`GET /api/evidence/:id/file-url` returns a same-origin `/api/blobs/local/<token>` URL when
`LocalDiskBlobUploader` is active. Browser previews work fine — they resolve through the web app's
`/api-proxy`. Azure Document Intelligence does not: `POST /api/evidence/:id/extract` hands the OCR
service the same minted URL, and for the local backend that URL is **API-relative by construction**
(`/api/blobs/local/<token>`), with no host for a remote service to resolve.

The route fails soft — it catches the error, logs a structured warning
(`component: "api.extract"`), and keeps returning the extraction the ledger already holds — so the
reviewer is never blocked, they just never see a live-OCR refresh on receipts captured while running
locally. Unlike the browser-reachability story, a public tunnel alone does not fix this: minting an
absolute URL from a configured public base is a code change, not a configuration one. Live OCR
therefore remains an Azure-Storage-mode feature, and one more reason the Azure move stays on the
roadmap.

## Later Azure migration

Because `LocalDiskBlobUploader` uses the **identical** `evidence-uploads/{uploadId}/{filename}`
blobPath convention as `AzureBlobUploader`, moving evidence to Azure Blob later is a pure bulk copy —
no event-history rewrite, since every `EvidenceObject.blobPath` already matches the target layout. A
one-time `azcopy sync <ACCOUNTING_BLOB_DIR> https://<account>.blob.core.windows.net/<container>` (or
equivalent) followed by setting `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_CONTAINER` (which take
precedence over `ACCOUNTING_BLOB_DIR` automatically) completes the cutover. Set
`NEXT_PUBLIC_AZURE_STORAGE_ORIGIN` at web build time at the same point, so the CSP admits the
direct-to-Azure PUTs and read-SAS previews.

For the ledger itself: re-point `DATABASE_URL` at the hosted Postgres and replay `pnpm db:migrate`
there, or use `pg_restore` with the latest `pnpm db:backup` dump. `GET /api/exports/sie` already
serializes the ledger as SIE; Phase D of the KFR master plan makes that export period-scoped
(`?period=fy-2025`, with `#IB`/`#UB`/`#RES` blocks), at which point a per-fiscal-year SIE export
becomes an additional portable handoff path for a revisor's tooling, independent of the
Postgres-level migration above.

## Running it as a service

`pnpm dev:api` / `pnpm dev:web` are hot-reload dev servers. For a longer-lived local install:

- API: `corepack pnpm bundle:api` produces `api-deploy/server.cjs` (a single esbuild CJS bundle);
  run it with `node api-deploy/server.cjs` and the same env. Note `pnpm build` does **not** produce
  it — the API's `build` script is typecheck-only.
- Web: `corepack pnpm build` with the `NEXT_PUBLIC_*` values already set, then run Next's standalone
  output at `apps/web/.next/standalone/apps/web/server.js` (copy `apps/web/.next/static` and
  `apps/web/public` alongside it, as Next's standalone mode requires). It honours `PORT` and
  `HOSTNAME`, and reads `ACCOUNTING_API_BASE_URL` at request time.
