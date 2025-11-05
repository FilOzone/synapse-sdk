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
import { sanitizeUrlForSpan } from '../telemetry/utils.ts'
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

  describe('URL Sanitization for Span Names', () => {
    it('should sanitize URLs with all variable types (CID, UUID, txHash, IDs, query params)', () => {
      // Complex URL with all patterns from real telemetry data
      const url =
        'https://pdp.com/data-sets/123/upload/550e8400-e29b-41d4-a716-446655440000/piece/bafkzcibf7pcoyaytnzidovxkgg52nnfnslxzqedexajl5odypwrahyrnotkpsqukbqiq/tx/0x05a69d69ae89432d38f7faeaf44f19b0ff2fdb2b9d2b6d9e039a379a7a734f8b?status=active&page=1'
      const sanitized = sanitizeUrlForSpan(url)
      assert.equal(sanitized, 'https://pdp.com/data-sets/<ID>/upload/<UUID>/piece/<CID>/tx/<txHash>')
    })

    it('should handle real PDP API patterns from sample data', () => {
      // GET with CID from actual telemetry
      assert.equal(
        sanitizeUrlForSpan(
          'GET https://calib2.ezpdpz.net/pdp/piece/bafkzcibf7pcoyaytnzidovxkgg52nnfnslxzqedexajl5odypwrahyrnotkpsqukbqiq/status'
        ),
        'GET https://calib2.ezpdpz.net/pdp/piece/<CID>/status'
      )

      // POST with dataset ID
      assert.equal(
        sanitizeUrlForSpan('POST https://calib2.ezpdpz.net/pdp/data-sets/27/pieces'),
        'POST https://calib2.ezpdpz.net/pdp/data-sets/<ID>/pieces'
      )

      // PUT with UUID
      assert.equal(
        sanitizeUrlForSpan('PUT https://pdp.com/pdp/piece/uploads/550e8400-e29b-41d4-a716-446655440000'),
        'PUT https://pdp.com/pdp/piece/uploads/<UUID>'
      )

      // GET with transaction hash
      assert.equal(
        sanitizeUrlForSpan(
          'GET https://pdp.com/pdp/data-sets/created/0x05a69d69ae89432d38f7faeaf44f19b0ff2fdb2b9d2b6d9e039a379a7a734f8b'
        ),
        'GET https://pdp.com/pdp/data-sets/created/<txHash>'
      )
    })

    it('should only replace transaction hashes with 16+ hex chars', () => {
      // Should replace long hash
      assert.equal(sanitizeUrlForSpan('https://pdp.com/tx/0x1234567890abcdef1234'), 'https://pdp.com/tx/<txHash>')

      // Should NOT replace short hash
      assert.equal(sanitizeUrlForSpan('https://pdp.com/version/0x1/api'), 'https://pdp.com/version/0x1/api')
    })

    it('should preserve URLs without variable parts', () => {
      assert.equal(
        sanitizeUrlForSpan('GET https://pdp-test.thcloud.dev/pdp/ping'),
        'GET https://pdp-test.thcloud.dev/pdp/ping'
      )
    })
  })
})
