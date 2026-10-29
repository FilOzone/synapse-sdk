/* globals describe it before after beforeEach */

/**
 * Pull tests
 *
 * Tests the SP-to-SP piece pull functionality
 */

import assert from 'assert'
import { AbortError } from 'iso-web/http'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, type Hex, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { calibration } from '../src/chains.ts'
import { PullError } from '../src/errors/pull.ts'
import * as Mocks from '../src/mocks/index.ts'
import * as Piece from '../src/piece/index.ts'
import {
  type PullPieceInput,
  pullPieces,
  pullPiecesApiRequest,
  waitForPullPieces,
  waitForPullPiecesApiRequest,
} from '../src/sp/pull-pieces.ts'
import { signAddPiecesAbiParameters } from '../src/typed-data/sign-add-pieces.ts'

// Mock server for testing
const server = setup()

describe('Pull', () => {
  const TEST_ENDPOINT = 'http://pdp.local'
  const TEST_RECORD_KEEPER = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f' as const
  const TEST_EXTRA_DATA = '0x1234567890abcdef' as const
  const TEST_PIECE_CID = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const TEST_SOURCE_URL = `https://other-sp.example.com/piece/${TEST_PIECE_CID}`

  const baseOptions = (): pullPiecesApiRequest.OptionsType => ({
    serviceURL: TEST_ENDPOINT,
    recordKeeper: TEST_RECORD_KEEPER,
    extraData: TEST_EXTRA_DATA,
    pieces: [{ pieceCid: TEST_PIECE_CID, sourceUrl: TEST_SOURCE_URL }],
    retryDelay: 10,
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

      const result = await pullPiecesApiRequest(baseOptions())

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

      await pullPiecesApiRequest(baseOptions())

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

      await pullPiecesApiRequest({ ...baseOptions(), dataSetId: 123n })

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

      await pullPiecesApiRequest({ ...baseOptions(), dataSetId: 0n })

      assert.ok(capturedRequest, 'Request should have been captured')
      assert.strictEqual(capturedRequest.dataSetId, undefined)
    })

    it('should handle server errors', async () => {
      server.use(Mocks.pdp.pullPiecesErrorHandler('extraData validation failed: invalid signature', 400))

      try {
        await pullPiecesApiRequest(baseOptions())
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
        await pullPiecesApiRequest(baseOptions())
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(
          (error as Error).message.includes('Network request failed'),
          'Error message should mention fetch failure'
        )
      }
    })

    it('should handle mixed piece statuses', async () => {
      const pieceCid2 = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const mockResponse: pullPiecesApiRequest.ReturnType = {
        status: 'inProgress',
        pieces: [
          { pieceCid: TEST_PIECE_CID, status: 'complete' },
          { pieceCid: pieceCid2, status: 'inProgress' },
        ],
      }

      server.use(Mocks.pdp.pullPiecesHandler(mockResponse))

      const result = await pullPiecesApiRequest({
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

      const statusUpdates: pullPiecesApiRequest.PullStatus[] = []
      const result = await waitForPullPiecesApiRequest({
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

      const result = await waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10 })

      assert.strictEqual(result.status, 'failed')
    })

    it('should keep polling after a failed piece until every piece settles when waitForAll is set', async () => {
      const OTHER_PIECE_CID = 'bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy'
      let calls = 0
      server.use(
        http.post(`${TEST_ENDPOINT}/pdp/piece/pull`, () => {
          calls++
          return HttpResponse.json(
            Mocks.pdp.createPullResponse('failed', [
              { pieceCid: TEST_PIECE_CID, status: 'failed' },
              { pieceCid: OTHER_PIECE_CID, status: calls < 2 ? 'inProgress' : 'complete' },
            ])
          )
        })
      )
      const options = {
        ...baseOptions(),
        pieces: [
          { pieceCid: TEST_PIECE_CID, sourceUrl: TEST_SOURCE_URL },
          { pieceCid: OTHER_PIECE_CID, sourceUrl: `https://other-sp.example.com/piece/${OTHER_PIECE_CID}` },
        ],
        pollInterval: 10,
      }

      const first = await waitForPullPiecesApiRequest(options)
      assert.strictEqual(calls, 1, 'Should stop at the first failure by default')
      assert.strictEqual(first.pieces[1]?.status, 'inProgress')

      calls = 0
      const result = await waitForPullPiecesApiRequest({ ...options, waitForAll: true })
      assert.strictEqual(calls, 2)
      assert.deepStrictEqual(
        result.pieces.map((piece) => piece.status),
        ['failed', 'complete']
      )
    })

    it('should call onStatus callback for each poll', async () => {
      server.use(
        Mocks.pdp.pullPiecesProgressionHandler(['pending', 'inProgress', 'complete'], [{ pieceCid: TEST_PIECE_CID }])
      )

      const statusUpdates: pullPiecesApiRequest.PullStatus[] = []
      await waitForPullPiecesApiRequest({
        ...baseOptions(),
        pollInterval: 10,
        onStatus: (response) => statusUpdates.push(response.status),
      })

      assert.ok(statusUpdates.includes('pending'), 'Should include pending status')
      assert.ok(statusUpdates.includes('inProgress'), 'Should include inProgress status')
      assert.ok(statusUpdates.includes('complete'), 'Should include complete status')
    })

    it('should time out when the pull does not finish within timeout', async () => {
      server.use(
        Mocks.pdp.pullPiecesHandler(Mocks.pdp.createPullResponse('inProgress', [{ pieceCid: TEST_PIECE_CID }]))
      )

      await assert.rejects(
        waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10, timeout: 100 }),
        (error: Error) => error.name === 'TimeoutError'
      )
    })

    it('should keep retrying 429 past retryCount until the pull is admitted', async () => {
      let calls = 0
      server.use(
        http.post(`${TEST_ENDPOINT}/pdp/piece/pull`, () => {
          calls++
          if (calls <= 4) {
            return new HttpResponse('pull queue backpressure', { status: 429, headers: { 'Retry-After': '0' } })
          }
          return HttpResponse.json(Mocks.pdp.createPullResponse('complete', [{ pieceCid: TEST_PIECE_CID }]))
        })
      )

      const result = await waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10, retryCount: 1 })

      assert.strictEqual(result.status, 'complete')
      assert.strictEqual(calls, 5)
    })

    it('should time out while the SP keeps answering 429', async () => {
      server.use(
        http.post(
          `${TEST_ENDPOINT}/pdp/piece/pull`,
          () => new HttpResponse('pull queue backpressure', { status: 429, headers: { 'Retry-After': '0' } })
        )
      )

      await assert.rejects(
        waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10, timeout: 200 }),
        (error: Error) => error.name === 'TimeoutError'
      )
    })

    it('should still cap other retryable errors at retryCount', async () => {
      let calls = 0
      server.use(
        http.post(`${TEST_ENDPOINT}/pdp/piece/pull`, () => {
          calls++
          return new HttpResponse('unavailable', { status: 503 })
        })
      )

      await assert.rejects(
        waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10, retryCount: 1 }),
        (error: unknown) => error instanceof PullError
      )
      assert.strictEqual(calls, 2)
    })

    it('should handle server errors during polling', async () => {
      server.use(Mocks.pdp.pullPiecesErrorHandler('Internal server error', 500))

      try {
        await waitForPullPiecesApiRequest({ ...baseOptions(), pollInterval: 10 })
        assert.fail('Should have thrown error')
      } catch (error) {
        assert.ok(error instanceof PullError, 'Error should be PullError')
      }
    })
  })

  describe('input index and dedupe', () => {
    const PIECE_CID_2 = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
    const sourceUrl = (pieceCid: string, host = 'other-sp.example.com') => `https://${host}/piece/${pieceCid}`
    const client = createWalletClient({
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
      chain: calibration,
      transport: viemHttp(),
    })
    // Input 2 repeats input 0's PieceCID with a different source URL and metadata.
    const duplicateInputs = (): PullPieceInput[] => [
      { pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: sourceUrl(TEST_PIECE_CID), metadata: { first: 'a' } },
      { pieceCid: Piece.from(PIECE_CID_2), sourceUrl: sourceUrl(PIECE_CID_2) },
      {
        pieceCid: Piece.from(TEST_PIECE_CID),
        sourceUrl: sourceUrl(TEST_PIECE_CID, 'third-sp.example.com'),
        metadata: { second: 'b' },
      },
    ]
    const existing = { serviceURL: TEST_ENDPOINT, dataSetId: 1n, clientDataSetId: 1n }

    it('matches results to input indices when the SP returns pieces out of order', async () => {
      server.use(
        Mocks.pdp.pullPiecesHandler({
          status: 'inProgress',
          pieces: [
            { pieceCid: PIECE_CID_2, status: 'inProgress' },
            { pieceCid: TEST_PIECE_CID, status: 'complete' },
          ],
        })
      )

      const result = await pullPieces(client, {
        ...existing,
        extraData: TEST_EXTRA_DATA,
        pieces: [
          { pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: sourceUrl(TEST_PIECE_CID) },
          { pieceCid: Piece.from(PIECE_CID_2), sourceUrl: sourceUrl(PIECE_CID_2) },
        ],
      })

      assert.strictEqual(result.status, 'inProgress')
      assert.deepStrictEqual(result.pieces, [
        { pieceCid: TEST_PIECE_CID, status: 'complete', index: 0 },
        { pieceCid: PIECE_CID_2, status: 'inProgress', index: 1 },
      ])
      assert.strictEqual('dropped' in result, false)
    })

    it('passes indexed results to onStatus and returns them from waitForPullPieces', async () => {
      server.use(
        Mocks.pdp.pullPiecesPollingHandler(1, {
          status: 'complete',
          pieces: [
            { pieceCid: PIECE_CID_2, status: 'complete' },
            { pieceCid: TEST_PIECE_CID, status: 'complete' },
          ],
        })
      )

      const updates: waitForPullPieces.ReturnType[] = []
      const result = await waitForPullPieces(client, {
        ...existing,
        extraData: TEST_EXTRA_DATA,
        pieces: [
          { pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: sourceUrl(TEST_PIECE_CID) },
          { pieceCid: Piece.from(PIECE_CID_2), sourceUrl: sourceUrl(PIECE_CID_2) },
        ],
        pollInterval: 10,
        onStatus: (response) => updates.push(response),
      })

      assert.ok(updates.length >= 2)
      for (const update of updates) {
        assert.deepStrictEqual(
          update.pieces.map((piece) => [piece.pieceCid, piece.index]),
          [
            [TEST_PIECE_CID, 0],
            [PIECE_CID_2, 1],
          ]
        )
      }
      assert.deepStrictEqual(result.pieces, [
        { pieceCid: TEST_PIECE_CID, status: 'complete', index: 0 },
        { pieceCid: PIECE_CID_2, status: 'complete', index: 1 },
      ])
    })

    it('sends duplicates unchanged when dedupe is off', async () => {
      let captured: Mocks.pdp.PullRequestCapture | undefined
      server.use(
        Mocks.pdp.pullPiecesWithCaptureHandler(
          Mocks.pdp.createPullResponse('complete', [{ pieceCid: TEST_PIECE_CID }, { pieceCid: PIECE_CID_2 }]),
          (req) => {
            captured = req
          }
        )
      )

      const inputs = duplicateInputs()
      const result = await pullPieces(client, { ...existing, extraData: TEST_EXTRA_DATA, pieces: inputs })

      assert.deepStrictEqual(
        captured?.pieces,
        inputs.map((piece) => ({ pieceCid: piece.pieceCid.toString(), sourceUrl: piece.sourceUrl }))
      )
      assert.deepStrictEqual(
        result.pieces.map((piece) => [piece.pieceCid, piece.index]),
        [
          [TEST_PIECE_CID, 0],
          [PIECE_CID_2, 1],
          [TEST_PIECE_CID, 2],
        ]
      )
      assert.strictEqual('dropped' in result, false)
    })

    it('sends each PieceCID once with dedupe on, signs the deduped pieces and returns a result per input', async () => {
      let captured: Mocks.pdp.PullRequestCapture | undefined
      server.use(
        Mocks.pdp.pullPiecesWithCaptureHandler(
          {
            status: 'failed',
            pieces: [
              { pieceCid: PIECE_CID_2, status: 'complete' },
              { pieceCid: TEST_PIECE_CID, status: 'failed' },
            ],
          },
          (req) => {
            captured = req
          }
        )
      )

      const inputs = duplicateInputs()
      const result = await pullPieces(client, { ...existing, pieces: inputs, dedupe: true })

      // First input wins: its source URL is sent and its metadata is signed.
      assert.deepStrictEqual(captured?.pieces, [
        { pieceCid: TEST_PIECE_CID, sourceUrl: sourceUrl(TEST_PIECE_CID) },
        { pieceCid: PIECE_CID_2, sourceUrl: sourceUrl(PIECE_CID_2) },
      ])
      const extraData = captured?.extraData as Hex | undefined
      assert.ok(extraData)
      const [, keys, values] = decodeAbiParameters(signAddPiecesAbiParameters, extraData)
      assert.deepStrictEqual(keys, [['first'], []])
      assert.deepStrictEqual(values, [['a'], []])

      assert.strictEqual(result.status, 'failed')
      assert.deepStrictEqual(result.pieces, [
        { pieceCid: TEST_PIECE_CID, status: 'failed', index: 0 },
        { pieceCid: PIECE_CID_2, status: 'complete', index: 1 },
        { pieceCid: TEST_PIECE_CID, status: 'failed', index: 2 },
      ])
      assert.deepStrictEqual(
        result.dropped?.map((piece) => ({ ...piece, pieceCid: piece.pieceCid.toString() })),
        [{ index: 2, duplicateOf: 0, pieceCid: TEST_PIECE_CID }]
      )
    })

    it('reports a piece missing from the response as pending, then failed once the SP finishes', async () => {
      const pieces = [
        { pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: sourceUrl(TEST_PIECE_CID) },
        { pieceCid: Piece.from(PIECE_CID_2), sourceUrl: sourceUrl(PIECE_CID_2) },
      ]

      server.use(Mocks.pdp.pullPiecesProgressionHandler(['inProgress', 'complete'], [{ pieceCid: TEST_PIECE_CID }]))
      const working = await pullPieces(client, { ...existing, extraData: TEST_EXTRA_DATA, pieces })
      assert.deepStrictEqual(working.pieces[1], { pieceCid: PIECE_CID_2, status: 'pending', index: 1 })

      const finished = await pullPieces(client, { ...existing, extraData: TEST_EXTRA_DATA, pieces })
      assert.deepStrictEqual(finished.pieces, [
        { pieceCid: TEST_PIECE_CID, status: 'complete', index: 0 },
        { pieceCid: PIECE_CID_2, status: 'failed', index: 1 },
      ])
    })

    it('keeps a missing piece pending while other pieces are still pulling after a failure', async () => {
      const PIECE_CID_3 = 'bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy'
      server.use(
        Mocks.pdp.pullPiecesHandler({
          status: 'failed',
          pieces: [
            { pieceCid: TEST_PIECE_CID, status: 'failed' },
            { pieceCid: PIECE_CID_2, status: 'inProgress' },
          ],
        })
      )

      const result = await pullPieces(client, {
        ...existing,
        extraData: TEST_EXTRA_DATA,
        pieces: [TEST_PIECE_CID, PIECE_CID_2, PIECE_CID_3].map((pieceCid) => ({
          pieceCid: Piece.from(pieceCid),
          sourceUrl: sourceUrl(pieceCid),
        })),
      })

      assert.deepStrictEqual(result.pieces, [
        { pieceCid: TEST_PIECE_CID, status: 'failed', index: 0 },
        { pieceCid: PIECE_CID_2, status: 'inProgress', index: 1 },
        { pieceCid: PIECE_CID_3, status: 'pending', index: 2 },
      ])
    })

    it('reports an empty dropped list with dedupe on and no duplicates', async () => {
      server.use(Mocks.pdp.pullPiecesHandler(Mocks.pdp.createPullResponse('complete', [{ pieceCid: TEST_PIECE_CID }])))

      const result = await waitForPullPieces(client, {
        ...existing,
        extraData: TEST_EXTRA_DATA,
        pieces: [{ pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: TEST_SOURCE_URL }],
        dedupe: true,
        pollInterval: 10,
      })

      assert.deepStrictEqual(result.pieces, [{ pieceCid: TEST_PIECE_CID, status: 'complete', index: 0 }])
      assert.deepStrictEqual(result.dropped, [])
    })
  })

  describe('abort', () => {
    it('does not sign or send a request when the signal is already aborted', async () => {
      const account = privateKeyToAccount(Mocks.PRIVATE_KEYS.key1)
      let signatures = 0
      let requests = 0
      const client = createWalletClient({
        account: {
          ...account,
          signTypedData: (parameters) => {
            signatures++
            return account.signTypedData(parameters)
          },
        },
        chain: calibration,
        transport: viemHttp(),
      })
      server.use(
        http.post(`${TEST_ENDPOINT}/pdp/piece/pull`, () => {
          requests++
          return HttpResponse.json(Mocks.pdp.createPullResponse('complete', [{ pieceCid: TEST_PIECE_CID }]))
        })
      )
      const signal = AbortSignal.abort()
      const pieces = [{ pieceCid: Piece.from(TEST_PIECE_CID), sourceUrl: TEST_SOURCE_URL }]
      const existing = { serviceURL: TEST_ENDPOINT, pieces, dataSetId: 1n, clientDataSetId: 1n, signal }
      const created = { serviceURL: TEST_ENDPOINT, pieces, payee: Mocks.ADDRESSES.client1, signal }
      const calls = [
        () => pullPieces(client, existing),
        () => pullPieces(client, created),
        () => waitForPullPieces(client, existing),
        () => waitForPullPieces(client, created),
        // Pre-built extraData skips signing; iso-web also refuses to send on an aborted signal.
        () => pullPieces(client, { ...existing, extraData: '0x' }),
        () => waitForPullPieces(client, { ...existing, extraData: '0x' }),
      ]

      for (const call of calls) {
        await assert.rejects(call(), AbortError)
      }
      assert.strictEqual(signatures, 0)
      assert.strictEqual(requests, 0)
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
