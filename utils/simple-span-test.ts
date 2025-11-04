#!/usr/bin/env node

import { PDPServer, RPC_URLS, Synapse, WarmStorageService } from '@filoz/synapse-sdk'
import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'

const startTime = Date.now()
const log = (msg: string): void => {
  const elapsed = Date.now() - startTime
  console.log(`[${elapsed}ms] ${msg}`)
}

let synapse: Synapse | null = null

async function makeRequest(dataSetId: number): Promise<any> {
  if (!synapse) {
    throw new Error('Synapse instance not initialized')
  }

  // Step 1: Get contract info (includes providerId)
  const warmStorageService = await WarmStorageService.create(synapse.getProvider(), synapse.getWarmStorageAddress())
  const contractInfo = await warmStorageService.getDataSet(dataSetId)
  log(`Got contract info for dataset ${dataSetId}, provider ID: ${contractInfo.providerId}`)

  // Step 2: Get provider info (includes PDP service URL)
  const spRegistryAddress = warmStorageService.getServiceProviderRegistryAddress()
  const spRegistry = new SPRegistryService(synapse.getProvider(), spRegistryAddress)
  const providerInfo = await spRegistry.getProvider(contractInfo.providerId)

  if (!providerInfo?.products.PDP?.data.serviceURL) {
    throw new Error(`Provider ${contractInfo.providerId} does not have a PDP service URL`)
  }

  // Step 3: Get piece data from PDP server
  const pdpServer = new PDPServer(null, providerInfo.products.PDP.data.serviceURL)
  const pieceData = await pdpServer.getDataSet(dataSetId)

  return {
    dataSetId,
    contractInfo,
    providerInfo,
    pieceData,
  }
}

async function testSpanTest(RPC_URL: string): Promise<void> {
  log('Starting telemetry test')

  // Create Synapse instance with telemetry enabled
  synapse = await Synapse.create({
    rpcURL: RPC_URL,
    privateKey: process.env.PRIVATE_KEY,
    telemetry: {
      sentryInitOptions: {
        enabled: true,
      },
      sentrySetTags: {
        appName: 'simple-span-test',
        rpcURL: RPC_URL,
      },
    },
  })
  if (!synapse) {
    throw new Error('Synapse instance not created')
  }

  await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for sentry to initialize

  await synapse.telemetry?.sentry?.startSpan({ name: 'Test actions in span', op: 'Test span' }, async () => {
    if (!synapse) {
      throw new Error('Synapse instance not created')
    }
    const response = await makeRequest(779)
    console.log('inside span', response)
  })

  const response = await makeRequest(1)
  console.log('outside span', response)
}

// Run the test
testSpanTest(process.env.RPC_URL || RPC_URLS.calibration.websocket)
  .then(() => {
    throw new Error('test error')
  })
  .finally(() => {
    synapse?.getProvider().destroy()
    synapse?.telemetry?.sentry?.close(5000)
    synapse = null
  })
