/* globals describe it before after beforeEach */

/**
 * Pull tests
 *
 * Tests the SP-to-SP piece pull functionality
 */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { PullError } from '../src/errors/pull.ts'
import * as Mocks from '../src/mocks/index.ts'
import { type PullResponse, type PullStatus, pullPieces, waitForPullStatus } from '../src/sp/sp.ts'

// Mock server for testing
const server = setup()

describe('Pull', () => {
  const TEST_ENDPOINT = 'http://pdp.local'
  const TEST_RECORD_KEEPER = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f' as const
  const TEST_EXTRA_DATA = '0x1234567890abcdef' as const
  const TEST_PIECE_CID = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const TEST_SOURCE_URL = `https://other-sp.example.com/piece/${TEST_PIECE_CID}`

  const baseOptions = (): pullPieces.OptionsType => ({
    serviceURL: TEST_ENDPOINT,
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
  })

  describe('pullPieces', () => {
    it('should handle successful pull request', async () => {
      const mockResponse = Mocks.pdp.createPullResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.pdp.pullPiecesHandler(mockResponse))

      const result = await pullPieces(baseOptions())

      assert.strictEqual(result.status, 'pending')
      assert.strictEqual(result.pieces.length, 1)
      assert.strictEqual(result.pieces[0].pieceCid, TEST_PIECE_CID)
      assert.strictEqual(result.pieces[0].status, 'pending')
    })

    it('should send correct request body', async () => {
      let capturedRequest: Mocks.pdp.PullRequestCapture | undefined
      const mockResponse = Mocks.pdp.createPullResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.pdp.pullPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await pullPieces(baseOptions())

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.recordKeeper, TEST_RECORD_KEEPER)
      assert.strictEqual(capturedRequest.extraData, TEST_EXTRA_DATA)
      assert.strictEqual(capturedRequest.pieces.length, 1)
      assert.strictEqual(capturedRequest.pieces[0].pieceCid, TEST_PIECE_CID)
      assert.strictEqual(capturedRequest.pieces[0].sourceUrl, TEST_SOURCE_URL)
    })

    it('should include dataSetId when provided', async () => {
      let capturedRequest: Mocks.pdp.PullRequestCapture | undefined
      const mockResponse = Mocks.pdp.createPullResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.pdp.pullPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await pullPieces({ ...baseOptions(), dataSetId: 123n })

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.dataSetId, 123)
    })

    it('should not include dataSetId when zero', async () => {
      let capturedRequest: Mocks.pdp.PullRequestCapture | undefined
      const mockResponse = Mocks.pdp.createPullResponse('pending', [{ pieceCid: TEST_PIECE_CID }])

      server.use(
        Mocks.pdp.pullPiecesWithCaptureHandler(mockResponse, (req) => {
          capturedRequest = req
        })
      )

      await pullPieces({ ...baseOptions(), dataSetId: 0n })

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.dataSetId, undefined)
    })

    it('should handle server errors', async () => {
      server.use(Mocks.pdp.pullPiecesErrorHandler('extraData validation failed: invalid signature', 400))

      try {
        await pullPieces(baseOptions())
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error instanceof PullError, 'Error should be PullError')
        assert.ok(
          (error as PullError).message.includes('Failed to pull pieces'),
          'Error message should mention pull failure'
        )
      }
    })

    it('should handle network errors', async () => {
      server.use(
        http.post('http://pdp.local/pdp/piece/pull', () => {
          return HttpResponse.error()
        })
      )

      try {
        await pullPieces(baseOptions())
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok((error as Error).message.includes('Failed to fetch'), 'Error message should mention fetch failure')
      }
    })

    it('should handle mixed piece statuses', async () => {
      const pieceCid2 = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const mockResponse: PullResponse = {
        status: 'inProgress',
        pieces: [
          { pieceCid: TEST_PIECE_CID, status: 'complete' },
          { pieceCid: pieceCid2, status: 'inProgress' },
        ],
      }

      server.use(Mocks.pdp.pullPiecesHandler(mockResponse))

      const result = await pullPieces({
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

  describe('waitForPullStatus', () => {
    it('should poll until complete', async () => {
      const mockResponse = Mocks.pdp.createPullResponse('complete', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.pdp.pullPiecesPollingHandler(2, mockResponse))

      const statusUpdates: PullStatus[] = []
      const result = await waitForPullStatus({
        ...baseOptions(),
        pollInterval: 10,
        onStatus: (response) => statusUpdates.push(response.status),
      })

      assert.strictEqual(result.status, 'complete')
      assert.ok(statusUpdates.length >= 2, 'Should have at least 2 status updates (pending + complete)')
    })

    it('should stop polling on failed status', async () => {
      const mockResponse = Mocks.pdp.createPullResponse('failed', [{ pieceCid: TEST_PIECE_CID }])

      server.use(Mocks.pdp.pullPiecesPollingHandler(1, mockResponse))

      const result = await waitForPullStatus({ ...baseOptions(), pollInterval: 10 })

      assert.strictEqual(result.status, 'failed')
    })

    it('should call onStatus callback for each poll', async () => {
      server.use(
        Mocks.pdp.pullPiecesProgressionHandler(['pending', 'inProgress', 'complete'], [{ pieceCid: TEST_PIECE_CID }])
      )

      const statusUpdates: PullStatus[] = []
      await waitForPullStatus({
        ...baseOptions(),
        pollInterval: 10,
        onStatus: (response) => statusUpdates.push(response.status),
      })

      assert.ok(statusUpdates.includes('pending'), 'Should include pending status')
      assert.ok(statusUpdates.includes('inProgress'), 'Should include inProgress status')
      assert.ok(statusUpdates.includes('complete'), 'Should include complete status')
    })

    it('should handle server errors during polling', async () => {
      server.use(Mocks.pdp.pullPiecesErrorHandler('Internal server error', 500))

      try {
        await waitForPullStatus({ ...baseOptions(), pollInterval: 10 })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error instanceof PullError, 'Error should be PullError')
      }
    })
  })

  describe('PullError', () => {
    it('should have correct error name', () => {
      const error = new PullError('test error')
      assert.strictEqual(error.name, 'PullError')
    })

    it('should have static is() type guard', () => {
      const error = new PullError('test error')
      assert.strictEqual(PullError.is(error), true)
      assert.strictEqual(PullError.is(new Error('not pull error')), false)
    })
  })
})
