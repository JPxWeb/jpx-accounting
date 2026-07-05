# DEPLOY_UNBLOCK — getting the CD pipeline green again

**Status:** the `Deploy` workflow (`.github/workflows/deploy.yml`) has been red since
2026-05-07. This document is the runbook for unblocking it. It requires an action
only the subscription owner (Johan) can perform — the repo cannot fix this by itself.

## The root cause, precisely

The deploy job logs in with the service principal stored in the `AZURE_CREDENTIALS`
GitHub secret (step `Azure Login`, `azure/login@v2`) and then runs
`azure/arm-deploy@v2` against resource group **`jpx-main-rg`** with
`infra/azure/main.bicep`.

That Bicep template contains two `Microsoft.Authorization/roleAssignments@2022-04-01`
resources (`apiBlobDelegatorAssignment` and `apiBlobDataContributorAssignment`,
lines ~162–182). They grant the API App Service's system-assigned managed identity:

| Role                          | Built-in role definition GUID          | Scope                                |
| ----------------------------- | -------------------------------------- | ------------------------------------ |
| Storage Blob Delegator        | `db58b8e5-c6ad-4a2a-8342-4190687cbf4a` | storage account `jpxacctdevsa`       |
| Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` | container `evidence` in that account |

Creating a role assignment requires the **deploying** principal to hold
`Microsoft.Authorization/roleAssignments/write` at the target scope. The deploy
service principal only has resource-level rights (enough for App Services, Storage,
etc.), so the ARM deployment fails with an `AuthorizationFailed` error naming
`Microsoft.Authorization/roleAssignments/write`, and the whole deploy job aborts at
the `Deploy Bicep infrastructure` step — before the API zip-deploy and the web
container configuration ever run.

Names the template computes (with the default `environmentName=dev`,
`namePrefix=jpxacct`):

- API App Service: `jpxacct-dev-api` (this is the identity being granted the roles)
- Web App Service: `jpxacct-dev-web`
- Storage account: `jpxacctdevsa` (container `evidence`)

The deploy principal's identifiers live only in GitHub secrets
(`AZURE_CREDENTIALS` is the azure/login JSON, which contains `clientId`;
`AZURE_SUBSCRIPTION_ID` is the subscription). Where a command below needs them,
placeholders are used — see "Finding the identifiers" at the end.

## Option 1 — grant the deploy principal constrained role-assignment rights (recommended)

Keep the Bicep exactly as it is (role assignments stay declarative and idempotent —
`guid(...)`-named, so re-deploys are no-ops) and give the deploy service principal
permission to write **only these two roles, only in this resource group**.

Azure's built-in **Role Based Access Control Administrator** role
(GUID `f58310d9-a9f6-439a-9e8d-f62e7b41a168`) exists precisely for this: it can
create/delete role assignments and supports **conditions** that pin _which_ roles it
may assign. (`User Access Administrator`, GUID `18d7d88d-d35e-4fb5-a5c3-7773c20a72d9`,
also works but is broader — prefer the RBAC Administrator role.)

One-time, as a subscription Owner / User Access Administrator:

```bash
# The two role-definition GUIDs the condition allows: Storage Blob Delegator +
# Storage Blob Data Contributor — nothing else, and only inside jpx-main-rg.
az role assignment create \
  --assignee "<DEPLOY_SP_CLIENT_ID>" \
  --role "Role Based Access Control Administrator" \
  --scope "/subscriptions/<AZURE_SUBSCRIPTION_ID>/resourceGroups/jpx-main-rg" \
  --description "CD pipeline may grant only the two storage roles Bicep declares" \
  --condition-version "2.0" \
  --condition "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {db58b8e5-c6ad-4a2a-8342-4190687cbf4a, ba92f5b4-2d11-453d-a403-e96b0029c9fe})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {db58b8e5-c6ad-4a2a-8342-4190687cbf4a, ba92f5b4-2d11-453d-a403-e96b0029c9fe}))"
```

Notes:

- The condition covers both `write` (needed by the deploy) and `delete` (so a future
  `az deployment group create --mode Complete` or manual cleanup can also remove
  them) — both clauses limited to the same two GUIDs.
- Portal alternative: _jpx-main-rg → Access control (IAM) → Add role assignment →
  Role Based Access Control Administrator → select the deploy SP → Conditions →
  "Allow user to only assign selected roles" → pick Storage Blob Delegator +
  Storage Blob Data Contributor._
- Afterwards, re-run the workflow: GitHub → Actions → Deploy → _Run workflow_
  (`workflow_dispatch`, environment `dev`, runtimeMode `normal`), or push to `main`.
  No repo changes needed.

## Option 2 — take the role assignments out of Bicep, assign them once by hand

If granting the CD principal any role-assignment rights is unacceptable, move the
two grants out of the pipeline entirely. The managed identity's object id is stable
for the life of the App Service, so this is genuinely one-time (until the App
Service is deleted/recreated, which resets `principalId` — then repeat step 3).

**1. Delete from `infra/azure/main.bicep`:** the whole RBAC section — the comment
block starting `// RBAC — Managed identity must hold both roles…`, the two `var`
lines (`storageBlobDelegatorRoleId`, `storageBlobDataContributorRoleId`) and both
resources `apiBlobDelegatorAssignment` and `apiBlobDataContributorAssignment`
(currently lines ~153–182). Nothing else references them; no outputs change.

**2. Run the deploy once** (push to `main` or `workflow_dispatch`) so the API App
Service and its system-assigned identity exist. With the role assignments removed,
the Bicep step now succeeds with the SP's existing rights.

**3. Assign the two roles manually, once,** as Owner / User Access Administrator:

```bash
SUB="<AZURE_SUBSCRIPTION_ID>"
RG="jpx-main-rg"

# Object id of the API app's system-assigned managed identity
API_PRINCIPAL_ID=$(az webapp identity show \
  --name jpxacct-dev-api --resource-group "$RG" --query principalId -o tsv)

STORAGE_ID=$(az storage account show \
  --name jpxacctdevsa --resource-group "$RG" --query id -o tsv)

# 1) Storage Blob Delegator — authorizes getUserDelegationKey(); must be scoped
#    to the storage account (matches the old Bicep scope).
az role assignment create \
  --assignee-object-id "$API_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Delegator" \
  --scope "$STORAGE_ID"

# 2) Storage Blob Data Contributor — scoped to the evidence container only
#    (matches the old Bicep scope: writes can't touch other containers).
az role assignment create \
  --assignee-object-id "$API_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID/blobServices/default/containers/evidence"
```

**4. Verify:**

```bash
az role assignment list --assignee "$API_PRINCIPAL_ID" --all -o table
```

Expect exactly the two rows above. RBAC propagation can take a few minutes;
`/api/uploads/init` 403s during that window are transient.

Trade-off vs Option 1: infra is no longer fully declarative — a fresh environment
(new `environmentName`, disaster recovery, or App Service recreation) silently ships
without the grants until someone re-runs step 3. If you pick this option, keep this
file as the canonical reminder.

## What stays broken until one of these is done — and what already works

**Broken (CD):** every run of `deploy.yml` fails at `Deploy Bicep infrastructure`.
Because the API zip-deploy, web container config, and smoke tests are later steps of
the same job, **no code has deployed via CD since 2026-05-07** — web and API in
Azure are stale, not merely degraded.

**Broken after deploy if the roles are missing** (e.g. Option 2 step 1–2 done but
step 3 skipped): User-Delegation SAS minting returns 403 in `normal` mode, which
breaks exactly two API surfaces —

- `POST /api/uploads/init` (write SAS for evidence upload; capture uploads fail),
- `GET /api/evidence/:id/file-url` + the extraction read-SAS path in
  `POST /api/evidence/:id/extract` (read SAS for previews/OCR input).

**Already works, unaffected:**

- The **build job**: web Docker image builds and pushes to GHCR
  (`ghcr.io/jpxweb/jpx-accounting-web`), API bundles with esbuild — CI artifacts are
  healthy; this is purely a deploy-permission problem.
- **Demo mode** everywhere (local dev, E2E): `StubBlobUploader` never touches Azure,
  so capture/preview flows work without any RBAC.
- All non-blob API surfaces in `normal` mode once deployed: Postgres ledger writes,
  reports, advisor chat, Document Intelligence extraction (key-based, not
  identity-based), `/health`, `/ready` (readiness checks `ledger` + `ai`, not blob).

## Finding the identifiers

- `<AZURE_SUBSCRIPTION_ID>`: GitHub repo → Settings → Secrets and variables →
  Actions → `AZURE_SUBSCRIPTION_ID` (or `az account show --query id -o tsv`).
- `<DEPLOY_SP_CLIENT_ID>`: the `clientId` field inside the `AZURE_CREDENTIALS`
  secret JSON. If the secret can't be read back, find the SP by listing who holds
  Contributor on the resource group:
  `az role assignment list --resource-group jpx-main-rg -o table`
  and look for the service principal used by CI.
