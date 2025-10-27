/* globals describe it before after */
/**
 * Tests for telemetry functionality
 *
 * These tests verify that telemetry is properly disabled during testing
 * and that the telemetry system works correctly when enabled.
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { Synapse } from '../synapse.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'
import { http, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type JsonBodyType, type PathParams } from 'msw'

// Mock server for testing
const server = setup([])

describe('Telemetry', () => {
  let provider: ethers.Provider
  let synapse: Synapse
  let signer: ethers.Signer
  let sentryRequests: { request: Request, bodyObject: Record<string, any> }[] = []

  before(async () => {
    await server.start({ quiet: true })
    server.use(JSONRPC(presets.basic))
    server.use(http.all('https://o4510235322023936.ingest.us.sentry.io/api/4510235328184320/envelope/*', async ({ request }) => {
      const body = await request.text()
      let i = 0
      // map body ndjson to object:
      const bodyObject = body.split('\n').reduce((acc, line) => {
        const obj = JSON.parse(line)
        acc[i++] = obj
        return acc
      }, {} as Record<string, any>)
      sentryRequests.push({ request, bodyObject })
      return HttpResponse.json({}, { status: 200 })
    }))
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
    synapse = await Synapse.create({ signer })
  })

  after(async () => {
    server.stop()
    await synapse.telemetry?.sentry?.close()
    await synapse.getProvider().destroy()
    sentryRequests = []
    server.resetHandlers()
  })

  describe('Test Environment Detection', () => {
    it('should disable telemetry in test environment', () => {
      // Verify that global telemetry instance is null when not initialized
      assert.isNull(synapse.telemetry)
    })
  })

  describe('Happy Path', () => {
    it('should enable telemetry with explicit enabled=true', async () => {
      synapse = await Synapse.create({ signer, telemetry: { sentryInitOptions: { enabled: true } } })

      // wait for sentry to initialize
      await new Promise((resolve) => {setTimeout(resolve, 2000)})
      assert.isNotNull(synapse.telemetry?.sentry)
      assert.isTrue(synapse.telemetry?.sentry?.isInitialized())
      assert.isTrue(sentryRequests.length > 0)

      // first request is the type=session event
      assert.strictEqual(sentryRequests[0].bodyObject[1].type, 'session')
      assert.include(sentryRequests[0].bodyObject[2].attrs.release, '@filoz/synapse-sdk@v')

      // second request is a type=transaction event
      assert.strictEqual(sentryRequests[1].bodyObject[1].type, 'transaction')
      assert.include(sentryRequests[1].bodyObject[0].trace.release, '@filoz/synapse-sdk@v')
      assert.strictEqual(sentryRequests[1].bodyObject[2].tags.appName, 'synapse-sdk')
      assert.strictEqual(sentryRequests[1].bodyObject[2].tags.filecoinNetwork, 'calibration')
      assert.strictEqual(sentryRequests[0].bodyObject[2].attrs.release, sentryRequests[1].bodyObject[2].tags.synapseSdkVersion)
    })

    it('should allow overriding appName via sentrySetTags', async () => {
      synapse = await Synapse.create({ signer, telemetry: { sentryInitOptions: { enabled: true }, sentrySetTags: { appName: 'test-app' } } })

      await new Promise((resolve) => {setTimeout(resolve, 2000)})
      assert.isNotNull(synapse.telemetry?.sentry)
      assert.isTrue(synapse.telemetry?.sentry?.isInitialized())
      assert.isTrue(sentryRequests.length >= 2)

      assert.strictEqual(sentryRequests[1].bodyObject[2].tags.appName, 'test-app')
    })
  })
})
