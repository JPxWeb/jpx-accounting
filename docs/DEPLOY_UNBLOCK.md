# DEPLOY_UNBLOCK — storage RBAC for the CD pipeline

**Status (2026-07-05):** the `Deploy` workflow used to abort at `Deploy Bicep
infrastructure` because the template unconditionally created two storage role
assignments the CD service principal isn't allowed to write. That is now **gated
behind the `assignStorageRoles` Bicep parameter, default `false`**, so the deploy
completes and ships web + API with the principal's existing rights. What remains is a
one-time action only the subscription owner (Johan) can perform: get those two roles
onto the API's managed identity so User-Delegation SAS minting works in `normal` mode.
Until then the app deploys fine but blob upload/preview surfaces 403 (see the bottom
section). Pick **Option 1** (declarative, recommended) or **Option 2** (manual, once).

## The root cause, precisely

The deploy job logs in with the service principal stored in the `AZURE_CREDENTIALS`
GitHub secret (step `Azure Login`, `azure/login@v2`) and then runs
`azure/arm-deploy@v2` against resource group **`jpx-main-rg`** with
`infra/azure/main.bicep`.

That Bicep template contains two `Microsoft.Authorization/roleAssignments@2022-04-01`
resources (`apiBlobDelegatorAssignment` and `apiBlobDataContributorAssignment`), now
each guarded by `= if (assignStorageRoles)`. They grant the API App Service's
system-assigned managed identity:

| Role                          | Built-in role definition GUID          | Scope                                |
| ----------------------------- | -------------------------------------- | ------------------------------------ |
| Storage Blob Delegator        | `db58b8e5-c6ad-4a2a-8342-4190687cbf4a` | storage account `jpxacctdevsa`       |
| Storage Blob Data Contributor | `ba92f5b4-2d11-453d-a403-e96b0029c9fe` | container `evidence` in that account |

Creating a role assignment requires the **deploying** principal to hold
`Microsoft.Authorization/roleAssignments/write` at the target scope. The deploy
service principal only has resource-level rights (enough for App Services, Storage,
etc.). While the two assignments were unconditional, the ARM deployment failed with an
`AuthorizationFailed` error naming `Microsoft.Authorization/roleAssignments/write`, and
the whole deploy job aborted at the `Deploy Bicep infrastructure` step — before the API
zip-deploy and the web container configuration ever ran.

**The gate that unblocked CD:** `main.bicep` now declares
`param assignStorageRoles bool = false` and both role-assignment resources are
`= if (assignStorageRoles) { … }`. `deploy.yml` passes `assignStorageRoles=false` on
every push to `main` (and exposes it as a `workflow_dispatch` choice input), so the
template validates and deploys with the principal's existing rights. The two options
below are how you get the roles actually in place; the names/scopes are `guid()`-stable,
so nothing about idempotency changed.

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

Keep the role assignments declarative and give the deploy service principal permission
to write **only these two roles, only in this resource group** — then re-run the deploy
with the gate flipped on (`assignStorageRoles=true`) so Bicep creates them idempotently.

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
- Afterwards, re-run the workflow **with the gate on**: GitHub → Actions → Deploy →
  _Run workflow_ → environment `dev`, runtimeMode `normal`, **assignStorageRoles `true`**.
  Bicep then creates the two assignments declaratively. (Leaving it `false` — e.g. a
  plain push to `main` — keeps deploying fine; it just won't (re)assert the roles.) If
  you want every push to assert them once the grant is in place, change the
  `assignStorageRoles` default to `true` in `main.bicep` and `deploy.yml`.

## Option 2 — leave the gate off, assign the two roles once by hand

If granting the CD principal any role-assignment rights is unacceptable, leave
`assignStorageRoles=false` (the default — no repo change needed) and assign the two
grants manually. The managed identity's object id is stable for the life of the App
Service, so this is genuinely one-time (until the App Service is deleted/recreated,
which resets `principalId` — then repeat step 3).

**1. Nothing to edit** — with `assignStorageRoles=false`, the two role-assignment
resources are already skipped by the `if (...)` guard, so the Bicep step succeeds with
the SP's existing rights. (Historically this option meant deleting the RBAC block; the
gate makes that unnecessary.)

**2. Run the deploy once** (push to `main` or `workflow_dispatch`) so the API App
Service and its system-assigned identity exist.

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

## What stays limited until one of these is done — and what already works

**CD itself:** now completes. With `assignStorageRoles=false` the `Deploy Bicep
infrastructure` step validates and applies, then the API zip-deploy, web container
config, and smoke tests run as normal.

**Blob surfaces if the roles are still missing** (deploy done, neither Option 1 nor
Option 2 step 3 performed): User-Delegation SAS minting returns 403 in `normal` mode,
which breaks exactly two API surfaces —

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
