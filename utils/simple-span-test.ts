#!/usr/bin/env node

import { Synapse, RPC_URLS } from '@filoz/synapse-sdk'

const startTime = Date.now()
const log = (msg: string): void => {
  const elapsed = Date.now() - startTime
  console.log(`[${elapsed}ms] ${msg}`)
}

let synapse: Synapse | null = null

async function testSpanTest(RPC_URL: string): Promise<void> {
  log('Starting telemetry exit test')


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
      },
    }
  })
  if (!synapse) {
    throw new Error('Synapse instance not created')
  }

  synapse.telemetry?.sentry?.startSpan({ name: 'Test actions in span', op: 'Test span' }, async () => {
    if (!synapse) {
      throw new Error('Synapse instance not created')
    }
    const response = await fetch('https://pdp-test.thcloud.dev/pdp/data-sets/779')
    console.log('inside span', await response.json())
  })

  const response = await fetch('https://pdp-test.thcloud.dev/pdp/data-sets/778')
  console.log('outside span', await response.json())
}

// Run the test
testSpanTest(process.env.RPC_URL || RPC_URLS.calibration.websocket).then(() => {
  throw new Error('test error')
}).finally(() => {
  synapse?.getProvider().destroy()
  synapse?.telemetry?.sentry?.close()
  synapse = null
})
