/* globals describe it beforeEach afterEach */
/**
 * Tests for telemetry functionality
 *
 * These tests verify that telemetry is properly disabled during testing
 * and that the telemetry system doesn't "crash" Synapse when enabled.
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { Synapse } from '../synapse.ts'
import { removeGlobalTelemetry } from '../telemetry/singleton.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'

// Mock server for testing
const server = setup([])

interface SentryRequest {
  request: Request
  bodyObject: Record<string, any>
}

function mockSentryRequests(): SentryRequest[] {
  const sentryRequests: SentryRequest[] = []
  // prevent API requests to sentry
  server.use(
    http.all('https://o4510235322023936.ingest.us.sentry.io/api/4510235328184320/envelope/*', async ({ request }) => {
      const body = await request.text()
      let i = 0
      // map body ndjson to object:
      const bodyObject = body.split('\n').reduce(
        (acc, line) => {
          const obj = JSON.parse(line)
          acc[i++] = obj
          return acc
        },
        {} as Record<string, any>
      )
      sentryRequests.push({ request, bodyObject })
      return HttpResponse.json({}, { status: 200 })
    })
  )
  return sentryRequests
}

describe('Telemetry', () => {
  let provider: ethers.Provider
  let synapse: Synapse | null = null
  let signer: ethers.Signer

  beforeEach(async () => {
    await server.start({ quiet: true })
    server.use(JSONRPC(presets.basic))
    mockSentryRequests()

    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
  })

  afterEach(async () => {
    try {
      await synapse?.getProvider()?.destroy()
    } catch {
      // ignore destroy errors
    }
    if (synapse?.telemetry?.sentry != null) {
      await synapse.telemetry.sentry.close()
      synapse.telemetry.sentry = null
    }
    removeGlobalTelemetry(false)
    synapse = null
    server.stop()
    server.resetHandlers()
  })

  describe('Test Environment Detection', () => {
    it('should disable telemetry in test environment', async () => {
      synapse = await Synapse.create({ signer })
      // Verify that global telemetry instance is null when not initialized
      assert.isNull(synapse.telemetry)
    })
  })

  describe('Happy Path', () => {
    it('should enable telemetry with explicit enabled=true', async () => {
      synapse = await Synapse.create({ signer, telemetry: { sentryInitOptions: { enabled: true } } })
      // wait for sentry to initialize
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })
      assert.isNotNull(synapse.telemetry?.sentry)
      assert.isTrue(synapse.telemetry?.sentry?.isInitialized())
    })
  })
})
