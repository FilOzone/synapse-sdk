/* globals describe it before after beforeEach */

/**
 * SP Fetch tests
 *
 * Tests the SP-to-SP piece fetch functionality
 */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { SPFetchError } from '../src/errors/sp-fetch.ts'
import * as Mocks from '../src/mocks/index.ts'
import * as spFetch from '../src/sp-fetch.ts'

// Mock server for testing
const server = setup()

describe('spFetch', () => {
  const TEST_ENDPOINT = 'http://pdp.local'
  const TEST_RECORD_KEEPER = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f' as const
  const TEST_EXTRA_DATA = '0x1234567890abcdef' as const
  const TEST_PIECE_CID = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const TEST_SOURCE_URL = `https://other-sp.example.com/piece/${TEST_PIECE_CID}`

  const baseOptions = (): spFetch.SPFetchPiecesOptions => ({
    endpoint: TEST_ENDPOINT,
    recordKeeper: TEST_RECORD_KEEPER,
    extraData: TEST_EXTRA_DATA,
    pieces: [{ pieceCid: TEST_PIECE_CID, sourceUrl: TEST_SOURCE_URL }],
  })

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    spFetch.setTimeout(1000) // Short timeout for tests
  })

  describe('fetchPieces', () => {
    it('should handle successful fetch request', async () => {
      const mockResponse = Mocks.spFetch.createFetchResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.spFetch.fetchPiecesHandler(mockResponse))

      const result = await spFetch.fetchPieces(baseOptions())

      assert.strictEqual(result.status, 'pending')
      assert.strictEqual(result.pieces.length, 1)
      assert.strictEqual(result.pieces[0].pieceCid, TEST_PIECE_CID)
      assert.strictEqual(result.pieces[0].status, 'pending')
    })

    it('should send correct request body', async () => {
      let capturedRequest: Mocks.spFetch.SPFetchRequestCapture | undefined
      const mockResponse = Mocks.spFetch.createFetchResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.spFetch.fetchPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await spFetch.fetchPieces(baseOptions())

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.recordKeeper, TEST_RECORD_KEEPER)
      assert.strictEqual(capturedRequest.extraData, TEST_EXTRA_DATA)
      assert.strictEqual(capturedRequest.pieces.length, 1)
      assert.strictEqual(capturedRequest.pieces[0].pieceCid, TEST_PIECE_CID)
      assert.strictEqual(capturedRequest.pieces[0].sourceUrl, TEST_SOURCE_URL)
    })

    it('should include dataSetId when provided', async () => {
      let capturedRequest: Mocks.spFetch.SPFetchRequestCapture | undefined
      const mockResponse = Mocks.spFetch.createFetchResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.spFetch.fetchPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await spFetch.fetchPieces({ ...baseOptions(), dataSetId: 123n })

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.dataSetId, 123)
    })

    it('should not include dataSetId when zero', async () => {
      let capturedRequest: Mocks.spFetch.SPFetchRequestCapture | undefined
      const mockResponse = Mocks.spFetch.createFetchResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.spFetch.fetchPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await spFetch.fetchPieces({ ...baseOptions(), dataSetId: 0n })

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.dataSetId, undefined)
    })

    it('should handle server errors', async () => {
      server.use(Mocks.spFetch.fetchPiecesErrorHandler('extraData validation failed: invalid signature', 400))

      try {
        await spFetch.fetchPieces(baseOptions())
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error instanceof SPFetchError, 'Error should be SPFetchError')
        assert.ok(
          (error as SPFetchError).message.includes('Failed to fetch pieces'),
          'Error message should mention fetch failure'
        )
      }
    })

    it('should handle network errors', async () => {
      server.use(
        http.post('http://pdp.local/pdp/piece/fetch', () => {
          return HttpResponse.error()
        })
      )

      try {
        await spFetch.fetchPieces(baseOptions())
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok((error as Error).message.includes('Failed to fetch'), 'Error message should mention fetch failure')
      }
    })

    it('should handle mixed piece statuses', async () => {
      const pieceCid2 = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const mockResponse: spFetch.SPFetchResponse = {
        status: 'inProgress',
        pieces: [
          { pieceCid: TEST_PIECE_CID, status: 'complete' },
          { pieceCid: pieceCid2, status: 'inProgress' },
        ],
      }

      server.use(Mocks.spFetch.fetchPiecesHandler(mockResponse))

      const result = await spFetch.fetchPieces({
        ...baseOptions(),
        pieces: [
          { pieceCid: TEST_PIECE_CID, sourceUrl: TEST_SOURCE_URL },
          { pieceCid: pieceCid2, sourceUrl: `https://other-sp.example.com/piece/${pieceCid2}` },
        ],
      })

      assert.strictEqual(result.status, 'inProgress')
      assert.strictEqual(result.pieces[0].status, 'complete')
      assert.strictEqual(result.pieces[1].status, 'inProgress')
    })
  })

  describe('pollStatus', () => {
    it('should poll until complete', async () => {
      const mockResponse = Mocks.spFetch.createFetchResponse('complete', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.spFetch.fetchPiecesPollingHandler(2, mockResponse))

      const statusUpdates: spFetch.SPFetchStatus[] = []
      const result = await spFetch.pollStatus({
        ...baseOptions(),
        minTimeout: 10,
        onStatus: (response) => statusUpdates.push(response.status),
      })

      assert.strictEqual(result.status, 'complete')
      assert.ok(statusUpdates.length >= 2, 'Should have at least 2 status updates (pending + complete)')
    })

    it('should stop polling on failed status', async () => {
      const mockResponse = Mocks.spFetch.createFetchResponse('failed', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.spFetch.fetchPiecesPollingHandler(1, mockResponse))

      const result = await spFetch.pollStatus({ ...baseOptions(), minTimeout: 10 })

      assert.strictEqual(result.status, 'failed')
    })

    it('should call onStatus callback for each poll', async () => {
      server.use(
        Mocks.spFetch.fetchPiecesProgressionHandler(
          ['pending', 'inProgress', 'complete'],
          [{ pieceCid: TEST_PIECE_CID }]
        )
      )

      const statusUpdates: spFetch.SPFetchStatus[] = []
      await spFetch.pollStatus({
        ...baseOptions(),
        minTimeout: 10,
        onStatus: (response) => statusUpdates.push(response.status),
      })

      // Check that all expected statuses were received
      assert.ok(statusUpdates.includes('pending'), 'Should include pending status')
      assert.ok(statusUpdates.includes('inProgress'), 'Should include inProgress status')
      assert.ok(statusUpdates.includes('complete'), 'Should include complete status')
    })

    it('should handle server errors during polling', async () => {
      server.use(Mocks.spFetch.fetchPiecesErrorHandler('Internal server error', 500))

      try {
        await spFetch.pollStatus({ ...baseOptions(), minTimeout: 10 })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error instanceof SPFetchError, 'Error should be SPFetchError')
      }
    })
  })

  describe('SPFetchError', () => {
    it('should have correct error name', () => {
      const error = new SPFetchError('test error')
      assert.strictEqual(error.name, 'SPFetchError')
    })

    it('should have static is() type guard', () => {
      const error = new SPFetchError('test error')
      assert.strictEqual(SPFetchError.is(error), true)
      assert.strictEqual(SPFetchError.is(new Error('not sp fetch error')), false)
    })
  })
})
