/* globals describe it beforeEach afterEach */

/**
 * Tests for PDPUploadService
 */

import { assert } from 'chai'
import { PDPUploadService } from '../pdp/index.js'
import { calculate } from '../commp/index.js'

describe('PDPUploadService', () => {
  let originalFetch: typeof global.fetch
  let fetchMock: typeof global.fetch

  beforeEach(() => {
    // Save original fetch
    originalFetch = global.fetch
    // Create mock
    fetchMock = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method ?? 'GET'

      // Mock POST /pdp/piece endpoint
      if (method === 'POST' && url.endsWith('/pdp/piece')) {
        const body = JSON.parse(init?.body as string)

        // Validate request structure
        assert.exists(body.check)
        assert.exists(body.check.name)
        assert.exists(body.check.hash)
        assert.exists(body.check.size)

        // Return 201 with Location header
        return new Response(null, {
          status: 201,
          headers: {
            Location: '/pdp/piece/upload/12345678-1234-1234-1234-123456789012'
          }
        })
      }

      // Mock PUT /pdp/piece/upload/{uuid} endpoint
      if (method === 'PUT' && url.includes('/pdp/piece/upload/')) {
        // Verify content type
        assert.strictEqual((init?.headers as any)?.['Content-Type'], 'application/octet-stream')

        // Return 204 No Content
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected fetch call: ${method} ${url}`)
    }

    // Replace global fetch
    global.fetch = fetchMock
  })

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch
  })

  describe('constructor', () => {
    it('should create instance with valid endpoint', () => {
      const service = new PDPUploadService('https://pdp.example.com')
      assert.instanceOf(service, PDPUploadService)
    })

    it('should normalize endpoint by removing trailing slash', () => {
      const service = new PDPUploadService('https://pdp.example.com/')
      assert.strictEqual(service.getApiEndpoint(), 'https://pdp.example.com')
    })

    it('should throw on empty endpoint', () => {
      assert.throws(() => new PDPUploadService(''), 'PDP API endpoint is required')
    })
  })

  describe('upload', () => {
    it('should successfully upload data', async () => {
      const service = new PDPUploadService('https://pdp.example.com')
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const commp = calculate(data)

      // Should not throw
      await service.upload(data, commp)
    })

    it('should handle ArrayBuffer input', async () => {
      const service = new PDPUploadService('https://pdp.example.com')
      const data = new ArrayBuffer(5)
      new Uint8Array(data).set([1, 2, 3, 4, 5])
      const commp = calculate(new Uint8Array(data))

      // Should not throw
      await service.upload(data, commp)
    })

    it('should handle existing piece (200 response)', async () => {
      // Override mock for this test
      global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = init?.method ?? 'GET'

        if (method === 'POST' && url.endsWith('/pdp/piece')) {
          // Return 200 indicating piece already exists
          return new Response(JSON.stringify({ pieceCID: 'baga...' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        throw new Error(`Unexpected fetch call: ${method} ${url}`)
      }

      const service = new PDPUploadService('https://pdp.example.com')
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const commp = calculate(data)

      // Should not throw
      await service.upload(data, commp)
    })

    it('should throw on create upload error', async () => {
      // Override mock for this test
      global.fetch = async (): Promise<Response> => {
        return new Response('Server error', { status: 500 })
      }

      const service = new PDPUploadService('https://pdp.example.com')
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const commp = calculate(data)

      try {
        await service.upload(data, commp)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.match((error as Error).message, /Failed to create upload: 500/)
      }
    })
  })

  describe('getters', () => {
    it('should return service name', () => {
      const service = new PDPUploadService('https://pdp.example.com', 'custom')
      assert.strictEqual(service.getServiceName(), 'custom')
    })

    it('should use default service name', () => {
      const service = new PDPUploadService('https://pdp.example.com')
      assert.strictEqual(service.getServiceName(), 'public')
    })
  })
})
