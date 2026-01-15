/* globals describe it beforeEach afterEach */

/**
 * PDPServer tests
 *
 * Tests the PDPServer class for creating data sets and adding pieces via HTTP API
 */

import { calibration } from '@filoz/synapse-core/chains'
import {
  AddPiecesError,
  CreateDataSetError,
  GetDataSetError,
  LocationHeaderError,
  PostPieceError,
} from '@filoz/synapse-core/errors'
import * as Mocks from '@filoz/synapse-core/mocks'
import * as Piece from '@filoz/synapse-core/piece'
import { asPieceCID, calculate as calculatePieceCID } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { type Chain, type Client, createWalletClient, type Transport, http as viemHttp } from 'viem'
import { type Account, privateKeyToAccount } from 'viem/accounts'
import { PDPServer } from '../pdp/index.ts'

// mock server for testing
const server = setup()

describe('PDPServer', () => {
  let pdpServer: PDPServer
  let serverUrl: string
  let walletClient: Client<Transport, Chain, Account>
  const TEST_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234'
  const TEST_CONTRACT_ADDRESS = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f'

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    server.use(Mocks.JSONRPC(Mocks.presets.basic))

    // Start mock server
    serverUrl = 'http://pdp.local'

    walletClient = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(TEST_PRIVATE_KEY),
    })

    // Create PDPServer instance
    pdpServer = new PDPServer({
      client: walletClient,
      endpoint: serverUrl,
    })
  })

  describe('createDataSet', () => {
    it('should handle successful data set creation', async () => {
      // Mock the createDataSet endpoint
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/${mockTxHash}` },
          })
        })
      )

      const result = await pdpServer.createDataSet(
        0n, // clientDataSetId
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
        walletClient.account.address, // payer
        {}, // metadata (empty for no CDN)
        TEST_CONTRACT_ADDRESS // recordKeeper
      )

      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })

    it('should fail for unexpected location header', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/created/invalid-hash` },
          })
        })
      )
      try {
        await pdpServer.createDataSet(
          0n, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          walletClient.account.address, // payer
          {}, // metadata (empty for no CDN)
          TEST_CONTRACT_ADDRESS // recordKeeper
        )
        assert.fail('Should have thrown error for unexpected location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.equal(error.message, 'Location header format is invalid: /pdp/data-sets/created/invalid-hash')
      }
    })
    it('should fail with no Location header', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return new HttpResponse(null, {
            status: 201,
            headers: {},
          })
        })
      )
      try {
        await pdpServer.createDataSet(
          0n, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          walletClient.account.address, // payer
          {}, // metadata (empty for no CDN)
          TEST_CONTRACT_ADDRESS // recordKeeper
        )
        assert.fail('Should have thrown error for no Location header')
      } catch (error) {
        assert.instanceOf(error, LocationHeaderError)
        assert.equal(error.message, 'Location header format is invalid: <none>')
      }
    })

    it('should fail with CreateDataSetError string error', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], revert reason=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 10988 (33)
04: f0169792 (method 3844450837) -- contract reverted at 1775 (33)
 (RetCode=33)], vm error=[Error(invariant failure: insufficient funds to cover lockup after function execution)])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await pdpServer.createDataSet(
          0n, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          walletClient.account.address, // payer
          {}, // metadata (empty for no CDN)
          TEST_CONTRACT_ADDRESS // recordKeeper
        )
        assert.fail('Should have thrown error for no Location header')
      } catch (error) {
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: 
invariant failure: insufficient funds to cover lockup after function execution`
        )
      }
    })

    it('should fail with CreateDataSetError typed error', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], revert reason=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 18957 (33)
 (RetCode=33)], vm error=[0x42d750dc0000000000000000000000007e4abd63a7c8314cc28d388303472353d884f292000000000000000000000000b0ff6622d99a325151642386f65ab33a08c30213])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await pdpServer.createDataSet(
          0n, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          walletClient.account.address, // payer
          {}, // metadata (empty for no CDN)
          TEST_CONTRACT_ADDRESS // recordKeeper
        )
        assert.fail('Should have thrown error for no Location header')
      } catch (error) {
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: Warm Storage
InvalidSignature(address expected, address actual)
                (0x7e4ABd63A7C8314Cc28D388303472353D884f292, 0xb0fF6622D99A325151642386F65AB33a08c30213)`
        )
      }
    })

    it('should fail with CreateDataSetError typed error - reversed', async () => {
      server.use(
        http.post('http://pdp.local/pdp/data-sets', () => {
          return HttpResponse.text(
            `Failed to send transaction: failed to estimate gas: message execution failed (exit=[33], vm error=[message failed with backtrace:
00: f0169791 (method 3844450837) -- contract reverted at 75 (33)
01: f0169791 (method 6) -- contract reverted at 4535 (33)
02: f0169800 (method 3844450837) -- contract reverted at 75 (33)
03: f0169800 (method 6) -- contract reverted at 18957 (33)
(RetCode=33)], revert reason=[0x42d750dc0000000000000000000000007e4abd63a7c8314cc28d388303472353d884f292000000000000000000000000b0ff6622d99a325151642386f65ab33a08c30213])
`,
            {
              status: 500,
            }
          )
        })
      )
      try {
        await pdpServer.createDataSet(
          0n, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          walletClient.account.address, // payer
          {}, // metadata (empty for no CDN)
          TEST_CONTRACT_ADDRESS // recordKeeper
        )
        assert.fail('Should have thrown error for no Location header')
      } catch (error) {
        assert.instanceOf(error, CreateDataSetError)
        assert.equal(error.shortMessage, 'Failed to create data set.')
        assert.equal(
          error.message,
          `Failed to create data set.

Details: Warm Storage
InvalidSignature(address expected, address actual)
                (0x7e4ABd63A7C8314Cc28D388303472353D884f292, 0xb0fF6622D99A325151642386F65AB33a08c30213)`
        )
      }
    })
  })

  describe('createAndAddPieces', () => {
    it('should handle successful data set creation', async () => {
      // Mock the createDataSet endpoint
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const validPieceCid = ['bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy']

      server.use(Mocks.pdp.createAndAddPiecesHandler(mockTxHash))

      const result = await pdpServer.createAndAddPieces(
        0n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        walletClient.account.address,
        TEST_CONTRACT_ADDRESS,
        [{ pieceCid: Piece.parse(validPieceCid[0]) }],
        {}
      )

      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })
  })

  describe('addPieces', () => {
    it('should validate input parameters', async () => {
      // Test empty piece entries
      try {
        await pdpServer.addPieces(1n, 0n, [])
        assert.fail('Should have thrown error for empty piece entries')
      } catch (error) {
        assert.include((error as Error).message, 'At least one piece must be provided')
      }
    })

    it('should handle successful piece addition', async () => {
      const validPieceCid = ['bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy']

      server.use(
        http.post<{ id: string }, addPieces.RequestBody>(
          'http://pdp.local/pdp/data-sets/:id/pieces',
          async ({ request, params }) => {
            try {
              const body = await request.json()
              assert.isDefined(body.pieces)
              assert.isDefined(body.extraData)
              assert.strictEqual(body.pieces.length, 1)
              assert.strictEqual(body.pieces[0].pieceCid, validPieceCid[0])
              assert.strictEqual(body.pieces[0].subPieces.length, 1)
              assert.strictEqual(body.pieces[0].subPieces[0].subPieceCid, validPieceCid[0]) // Piece is its own subPiece
              return HttpResponse.text('Pieces added successfully', {
                status: 201,
                headers: {
                  Location: `/pdp/data-sets/${params.id}/pieces/added/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456`,
                },
              })
            } catch (error) {
              return HttpResponse.text((error as Error).message, {
                status: 400,
              })
            }
          }
        )
      )

      // Should not throw
      const result = await pdpServer.addPieces(1n, 0n, [{ pieceCid: Piece.parse(validPieceCid[0]) }])
      assert.isDefined(result)
      assert.isDefined(result.message)
    })

    it('should handle server errors appropriately', async () => {
      const validPieceCid = ['bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy']

      server.use(
        http.post('http://pdp.local/pdp/data-sets/:id/pieces', () => {
          return HttpResponse.text('Invalid piece CID', {
            status: 400,
            statusText: 'Bad Request',
          })
        })
      )

      try {
        await pdpServer.addPieces(1n, 0n, [{ pieceCid: Piece.parse(validPieceCid[0]) }])
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, AddPiecesError)
        assert.equal(error.shortMessage, 'Failed to add pieces.')
        assert.equal(
          error.message,
          `Failed to add pieces.

Details: Service Provider PDP
Invalid piece CID`
        )
      }
    })

    it('should handle multiple pieces', async () => {
      // Mix of string and PieceCID object inputs
      const pieceCid1 = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      const pieceCid2 = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(pieceCid1)
      assert.isNotNull(pieceCid2)

      if (pieceCid1 == null || pieceCid2 == null) {
        throw new Error('Failed to parse test PieceCIDs')
      }

      const multiplePieceCid = [pieceCid1, pieceCid2]

      server.use(
        http.post<{ id: string }, addPieces.RequestBody>(
          'http://pdp.local/pdp/data-sets/:id/pieces',
          async ({ request, params }) => {
            try {
              const body = await request.json()
              assert.strictEqual(body.pieces.length, 2)
              assert.strictEqual(body.pieces[0].subPieces.length, 1) // Each piece has itself as its only subPiece
              assert.strictEqual(body.pieces[1].subPieces.length, 1)
              assert.strictEqual(body.pieces[0].pieceCid, body.pieces[0].subPieces[0].subPieceCid)
              assert.strictEqual(body.pieces[1].pieceCid, body.pieces[1].subPieces[0].subPieceCid)

              return HttpResponse.text('Multiple pieces added successfully', {
                status: 201,
                headers: {
                  Location: `/pdp/data-sets/${params.id}/pieces/added/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456`,
                },
              })
            } catch (error) {
              return HttpResponse.text((error as Error).message, {
                status: 400,
              })
            }
          }
        )
      )
      const result = await pdpServer.addPieces(
        1n,
        0n,
        multiplePieceCid.map((pieceCid) => ({ pieceCid }))
      )
      assert.isDefined(result)
      assert.isDefined(result.message)
    })

    it('should handle addPieces response with Location header', async () => {
      const validPieceCid = ['bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy']
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

      server.use(
        http.post('http://pdp.local/pdp/data-sets/:id/pieces', async () => {
          return HttpResponse.text('Pieces added successfully', {
            status: 201,
            headers: {
              Location: `/pdp/data-sets/1/pieces/added/${mockTxHash}`,
            },
          })
        })
      )

      const result = await pdpServer.addPieces(1n, 0n, [{ pieceCid: Piece.parse(validPieceCid[0]) }])
      assert.isDefined(result)
      assert.isDefined(result.message)
      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl ?? '', mockTxHash)
      assert.include(result.statusUrl ?? '', '/pdp/data-sets/1/pieces/added/')
    })
  })

  describe('uploadPiece', () => {
    it('should successfully upload data', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(mockPieceCid)

      server.use(
        Mocks.pdp.postPieceUploadsHandler(mockUuid),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid)
      )

      await pdpServer.uploadPiece(testData)
    })

    it('should accept BYO PieceCID and skip CommP calculation', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const providedPieceCid = calculatePieceCID(testData)

      // Create a handler that verifies the provided PieceCID is used
      let finalizedWithPieceCid: string | null = null

      server.use(
        Mocks.pdp.postPieceUploadsHandler(mockUuid),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid),
        http.post<{ uuid: string }, { pieceCid: string }>(
          'http://pdp.local/pdp/piece/uploads/:uuid',
          async ({ request }) => {
            const body = await request.json()
            finalizedWithPieceCid = body.pieceCid
            return HttpResponse.json({ pieceCid: body.pieceCid }, { status: 200 })
          }
        )
      )

      await pdpServer.uploadPiece(testData, { pieceCid: providedPieceCid })

      // Verify the provided PieceCID was used
      assert.equal(finalizedWithPieceCid, providedPieceCid.toString())
    })

    it('should throw on create upload session error', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(mockPieceCid)

      server.use(
        http.post('http://pdp.local/pdp/piece/uploads', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.uploadPiece(testData)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.instanceOf(error, PostPieceError)
        assert.equal(error.shortMessage, 'Failed to create upload session.')
        assert.equal(
          error.message,
          `Failed to create upload session.

Details: Service Provider PDP
Failed to create upload session: Database error`
        )
      }
    })
  })

  describe('getDataSet', () => {
    it('should successfully fetch data set data', async () => {
      const mockDataSetData = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 1500,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', async () => {
          return HttpResponse.json(mockDataSetData, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getDataSet(292n)
      assert.equal(result.id, BigInt(mockDataSetData.id))
      assert.equal(result.nextChallengeEpoch, mockDataSetData.nextChallengeEpoch)
      assert.equal(result.pieces.length, mockDataSetData.pieces.length)
      assert.equal(result.pieces[0].pieceId, BigInt(mockDataSetData.pieces[0].pieceId))
      assert.equal(result.pieces[0].pieceCid.toString(), mockDataSetData.pieces[0].pieceCid)
    })

    it('should handle data set not found', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/999', async () => {
          return new HttpResponse(null, {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.getDataSet(999n)
        assert.fail('Should have thrown error for not found data set')
      } catch (error) {
        assert.instanceOf(error, GetDataSetError)
        assert.equal(error.shortMessage, 'Data set not found.')
      }
    })

    it('should handle server errors', async () => {
      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.getDataSet(292n)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.instanceOf(error, GetDataSetError)
        assert.equal(error.shortMessage, 'Failed to get data set.')
        assert.equal(error.details, 'Service Provider PDP\nDatabase error')
      }
    })

    it('should handle data set with no pieces', async () => {
      const emptyDataSetData = {
        id: 292,
        pieces: [],
        nextChallengeEpoch: 1500,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', async () => {
          return HttpResponse.json(emptyDataSetData, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getDataSet(292n)
      assert.deepStrictEqual(result, {
        id: BigInt(292),
        pieces: [],
        nextChallengeEpoch: 1500,
      })
      assert.isArray(result.pieces)
      assert.equal(result.pieces.length, 0)
    })

    it('should reject response with invalid CIDs', async () => {
      const invalidCidDataSetData = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'invalid-cid-format',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 1500,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/292', async () => {
          return HttpResponse.json(invalidCidDataSetData, {
            status: 200,
          })
        })
      )

      try {
        await pdpServer.getDataSet(292n)
        assert.fail('Should have thrown error for invalid CID in response')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid CID string: invalid-cid-format')
      }
    })
  })
})
