// ---------------------------------------------------------------------------
// JPX Accounting – Azure Infrastructure
// Deploys onto the existing jpx-app-plan App Service plan in jpx-main-rg.
// Resources: 2 App Services (web + api), 1 Storage Account (evidence blobs).
// ---------------------------------------------------------------------------

@description('Deployment environment name')
param environmentName string = 'dev'

@description('Primary Azure region')
param location string = 'swedencentral'

@description('Base name prefix for resources')
param namePrefix string = 'jpxacct'

@description('Name of the existing App Service plan to reuse')
param appServicePlanName string = 'jpx-app-plan'

@description('Resource group that contains the existing App Service plan')
param appServicePlanResourceGroup string = 'jpx-main-rg'

@description('Runtime mode (demo | normal)')
@allowed(['demo', 'normal'])
param runtimeMode string = 'demo'

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
  location: location
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

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource evidenceContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: 'evidence'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// App Service – API (Hono / Node.js via tsx)
// ---------------------------------------------------------------------------

resource apiApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-${environmentName}-api'
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: existingPlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npx tsx services/api/src/index.ts'
      alwaysOn: false
      httpLoggingEnabled: true
      appSettings: [
        { name: 'PORT', value: '8080' }
        { name: 'ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'ALLOW_TEST_RESET', value: 'false' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
        { name: 'AZURE_STORAGE_CONTAINER', value: 'evidence' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        // Secrets – set manually or via Key Vault references:
        // AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_MODEL
        // SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// App Service – Web (Next.js standalone)
// ---------------------------------------------------------------------------

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-${environmentName}-web'
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: existingPlan.id
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'node apps/web/server.js'
      alwaysOn: false
      httpLoggingEnabled: true
      appSettings: [
        { name: 'PORT', value: '8080' }
        { name: 'HOSTNAME', value: '0.0.0.0' }
        { name: 'ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'NEXT_PUBLIC_ACCOUNTING_RUNTIME_MODE', value: runtimeMode }
        { name: 'ACCOUNTING_API_BASE_URL', value: 'https://${apiApp.properties.defaultHostName}' }
        { name: 'NEXT_PUBLIC_API_BASE_URL', value: '/api-proxy' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
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
