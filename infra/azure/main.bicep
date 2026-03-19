@description('Deployment environment name')
param environmentName string = 'dev'

@description('Primary Azure region for the accounting platform')
param location string = 'swedencentral'

@description('Base name used for globally unique resources')
param namePrefix string = 'jpxacct'

@description('Container image for the web app')
param webImage string = 'ghcr.io/example/jpx-accounting-web:latest'

@description('Container image for the API')
param apiImage string = 'ghcr.io/example/jpx-accounting-api:latest'

var storageName = toLower('${namePrefix}${environmentName}sa')
var serviceBusName = toLower('${namePrefix}-${environmentName}-sb')
var keyVaultName = toLower('${namePrefix}-${environmentName}-kv')
var appConfigName = toLower('${namePrefix}-${environmentName}-appcs')
var searchName = toLower('${namePrefix}-${environmentName}-srch')
var containerEnvName = '${namePrefix}-${environmentName}-cae'

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
    immutableStorageWithVersioning: {
      enabled: true
    }
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: serviceBusName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource appConfig 'Microsoft.AppConfiguration/configurationStores@2024-05-01' = {
  name: appConfigName
  location: location
  sku: {
    name: 'standard'
  }
}

resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchName
  location: location
  sku: {
    name: 'standard'
  }
  properties: {
    semanticSearch: 'standard'
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
    }
  }
}

resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-${environmentName}-web'
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-${environmentName}-api'
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3001
      }
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 4
      }
    }
  }
}

output storageAccountName string = storage.name
output serviceBusNamespace string = serviceBus.name
output keyVaultUri string = keyVault.properties.vaultUri
output appConfigEndpoint string = appConfig.properties.endpoint
output searchServiceName string = search.name

