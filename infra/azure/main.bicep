// ---------------------------------------------------------------------------
// JPX Accounting – Azure Infrastructure
// Deploys onto the existing jpx-app-plan App Service plan in jpx-main-rg.
// Resources: 2 App Services (web + api), 1 Storage Account (evidence blobs).
// ---------------------------------------------------------------------------

@description('Deployment environment name')
param environmentName string = 'dev'

@description('App Service region – must match the App Service plan region')
param location string = 'westeurope'

@description('Storage account region (may differ from App Service region)')
param storageLocation string = 'swedencentral'

@description('Base name prefix for resources')
param namePrefix string = 'jpxacct'

@description('Name of the existing App Service plan to reuse')
param appServicePlanName string = 'jpx-app-plan'

@description('Resource group that contains the existing App Service plan')
param appServicePlanResourceGroup string = 'jpx-main-rg'

@description('Runtime mode (demo | normal)')
@allowed(['demo', 'normal'])
param runtimeMode string = 'demo'

@description('''Create the two storage role assignments for the API managed identity.
Defaults to false so CD stays green with a deploy principal that lacks
Microsoft.Authorization/roleAssignments/write. Set true only once that principal has been
granted constrained RBAC-Administrator rights (see docs/DEPLOY_UNBLOCK.md, Option 1);
otherwise assign the two roles out-of-band (Option 2).''')
param assignStorageRoles bool = false

// Azure OpenAI / Foundry (wire later)
@description('Azure OpenAI endpoint')
@secure()
param azureOpenaiEndpoint string = ''

@description('Azure OpenAI API key')
@secure()
param azureOpenaiApiKey string = ''

@description('Azure OpenAI model deployment name')
param azureOpenaiModel string = ''

// Azure Document Intelligence (OCR for receipts/invoices)
@description('Azure Document Intelligence endpoint')
@secure()
param azureDocumentIntelligenceEndpoint string = ''

@description('Azure Document Intelligence API key')
@secure()
param azureDocumentIntelligenceApiKey string = ''

// ---------------------------------------------------------------------------
// Existing resources
// ---------------------------------------------------------------------------

resource existingPlan 'Microsoft.Web/serverfarms@2023-12-01' existing = {
  name: appServicePlanName
  scope: resourceGroup(appServicePlanResourceGroup)
}

// ---------------------------------------------------------------------------
// Storage Account – evidence / receipt uploads
// ---------------------------------------------------------------------------

var storageName = toLower(replace('${namePrefix}${environmentName}sa', '-', ''))

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: storageLocation
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

@description('Comma-separated browser origins permitted to PUT to blob storage during evidence upload.')
param storageCorsAllowedOrigins string = 'http://localhost:3002,http://localhost:3200'

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          // PUT for the SAS upload itself; OPTIONS for the preflight; GET so the browser can verify
          // status if the client opts to. Headers cover Content-Type + Azure block-blob metadata.
          allowedOrigins: split(storageCorsAllowedOrigins, ',')
          allowedMethods: ['PUT', 'OPTIONS', 'GET']
          allowedHeaders: ['Content-Type', 'x-ms-blob-type', 'x-ms-version', 'x-ms-date']
          exposedHeaders: ['x-ms-request-id', 'x-ms-version', 'ETag']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'evidence'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// App Service – API (Hono, bundled with esbuild)
// ---------------------------------------------------------------------------

@description('Direct Postgres connection string for the API (Supabase / pgvector). Optional — leave blank to keep normal mode fail-closed.')
@secure()
param supabaseDbUrl string = ''

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-${environmentName}-api'
  location: location
  kind: 'app,linux'
  // System-assigned managed identity is required by the User-Delegation SAS flow:
  // the API calls getUserDelegationKey() against Storage with this identity (no account keys).
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: existingPlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node server.mjs'
      alwaysOn: false
      httpLoggingEnabled: true
      appSettings: [
        { name: 'PORT', value: '8080' }
        { name: 'ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'ALLOW_TEST_RESET', value: 'false' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
        { name: 'AZURE_STORAGE_CONTAINER', value: 'evidence' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'SUPABASE_DB_URL', value: supabaseDbUrl }
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenaiEndpoint }
        { name: 'AZURE_OPENAI_API_KEY', value: azureOpenaiApiKey }
        { name: 'AZURE_OPENAI_MODEL', value: azureOpenaiModel }
        { name: 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', value: azureDocumentIntelligenceEndpoint }
        { name: 'AZURE_DOCUMENT_INTELLIGENCE_API_KEY', value: azureDocumentIntelligenceApiKey }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// RBAC — Managed identity must hold both roles or User-Delegation SAS minting returns 403.
// Storage Blob Delegator is what authorizes getUserDelegationKey(); Storage Blob Data Contributor
// scopes the actual blob writes to the evidence container.
//
// Gated behind `assignStorageRoles` (default false): creating a role assignment needs the
// DEPLOYING principal to hold Microsoft.Authorization/roleAssignments/write, which the CD service
// principal does not have — leaving these unconditional aborted the whole deploy at template
// validation. With the flag off, the app deploys and the two roles are applied out-of-band; see
// docs/DEPLOY_UNBLOCK.md. Names/scopes are guid()-stable, so flipping the flag on later (once the
// principal is granted the constrained RBAC-Administrator role) is an idempotent no-op re-assign.
// ---------------------------------------------------------------------------

var storageBlobDelegatorRoleId = 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource apiBlobDelegatorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignStorageRoles) {
  // Scope must be the storage account so the identity can call getUserDelegationKey on it.
  scope: storage
  name: guid(storage.id, apiApp.id, storageBlobDelegatorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDelegatorRoleId)
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiBlobDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (assignStorageRoles) {
  // Container-scoped so the identity can only write to evidence/, not other containers.
  scope: evidenceContainer
  name: guid(evidenceContainer.id, apiApp.id, storageBlobDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// App Service – Web (Next.js standalone, deployed as Docker container)
// ---------------------------------------------------------------------------

@description('Docker image tag for the web app')
param webDockerImage string = 'ghcr.io/jpxweb/jpx-accounting-web:latest'

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-${environmentName}-web'
  location: location
  kind: 'app,linux,container'
  properties: {
    serverFarmId: existingPlan.id
    siteConfig: {
      linuxFxVersion: 'DOCKER|${webDockerImage}'
      alwaysOn: false
      httpLoggingEnabled: true
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'HOSTNAME', value: '0.0.0.0' }
        { name: 'ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'ACCOUNTING_API_BASE_URL', value: 'https://${apiApp.properties.defaultHostName}' }
        { name: 'NEXT_PUBLIC_API_BASE_URL', value: '/api-proxy' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://ghcr.io' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output storageAccountName string = storage.name
output apiAppName string = apiApp.name
output apiAppUrl string = 'https://${apiApp.properties.defaultHostName}'
output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
