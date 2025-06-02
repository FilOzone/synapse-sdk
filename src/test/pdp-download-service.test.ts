/* globals describe it beforeEach afterEach */

/**
 * Tests for PDPDownloadService
 */

import { assert } from 'chai'
import { PDPDownloadService } from '../pdp/index.js'
import { calculate } from '../commp/index.js'

describe('PDPDownloadService', () => {
  let originalFetch: typeof global.fetch
  let testData: Uint8Array
  let testCommP: string

  beforeEach(() => {
    // Save original fetch and console.log
    originalFetch = global.fetch

    // Create test data and calculate its CommP
    testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    testCommP = calculate(testData).toString()
  })

  afterEach(() => {
    // Restore original fetch
    global.fetch = originalFetch
  })

  describe('constructor', () => {
    it('should create instance with valid retrieval URL', () => {
      const service = new PDPDownloadService('https://sp.example.com/retrieve')
      assert.instanceOf(service, PDPDownloadService)
    })

    it('should normalize URL by removing trailing slash', () => {
      const service = new PDPDownloadService('https://sp.example.com/retrieve/')
      assert.strictEqual(service.getRetrievalUrl(), 'https://sp.example.com/retrieve')
    })

    it('should throw on empty URL', () => {
      assert.throws(() => new PDPDownloadService(''), 'Retrieval URL is required')
    })
  })

  describe('downloadPiece', () => {
    it('should successfully download and verify piece', async () => {
      // Mock successful download
      global.fetch = async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        // Verify correct URL format
        assert.isTrue(url.endsWith(`/piece/${testCommP}`))

        // Return test data as response
        return new Response(testData, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      }

      const service = new PDPDownloadService('https://sp.example.com/retrieve')
      const result = await service.downloadPiece(testCommP)

      // Verify we got the correct data back
      assert.deepEqual(result, testData)
    })

    it('should reject invalid CommP', async () => {
      const service = new PDPDownloadService('https://sp.example.com/retrieve')

      try {
        await service.downloadPiece('invalid-commp')
        assert.fail('Should have thrown')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid CommP provided')
      }
    })

    it('should throw on download failure', async () => {
      global.fetch = async (): Promise<Response> => {
        return new Response('Not found', { status: 404, statusText: 'Not Found' })
      }

      const service = new PDPDownloadService('https://sp.example.com/retrieve')

      try {
        await service.downloadPiece(testCommP)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.match((error as Error).message, /Failed to download piece: 404 Not Found/)
      }
    })

    it('should throw on CommP verification failure', async () => {
      // Mock download that returns wrong data
      global.fetch = async (): Promise<Response> => {
        const wrongData = new Uint8Array([9, 9, 9, 9]) // Different data
        return new Response(wrongData, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      }

      const service = new PDPDownloadService('https://sp.example.com/retrieve')

      try {
        await service.downloadPiece(testCommP)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.match((error as Error).message, /CommP verification failed/)
      }
    })

    it('should handle null response body', async () => {
      global.fetch = async (): Promise<Response> => {
        // Create a response with null body
        const response = new Response(null, { status: 200 })
        Object.defineProperty(response, 'body', { value: null })
        return response
      }

      const service = new PDPDownloadService('https://sp.example.com/retrieve')

      try {
        await service.downloadPiece(testCommP)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.include((error as Error).message, 'Response body is null')
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      // Mock fetch that returns data in chunks
      global.fetch = async (): Promise<Response> => {
        // Split test data into chunks
        const chunk1 = testData.slice(0, 4)
        const chunk2 = testData.slice(4)

        // Create readable stream that emits chunks
        const stream = new ReadableStream({
          async start (controller) {
            controller.enqueue(chunk1)
            // Small delay to simulate network
            await new Promise(resolve => setTimeout(resolve, 10))
            controller.enqueue(chunk2)
            controller.close()
          }
        })

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      }

      const service = new PDPDownloadService('https://sp.example.com/retrieve')
      const result = await service.downloadPiece(testCommP)

      // Verify we got all the data correctly reassembled
      assert.deepEqual(result, testData)
    })
  })
})
