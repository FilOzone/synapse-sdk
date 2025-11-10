/* globals describe it beforeEach afterEach */

/**
 * PDPServer tests
 *
 * Tests the PDPServer class for creating data sets and adding pieces via HTTP API
 */

import {
  AddPiecesError,
  CreateDataSetError,
  DeletePieceError,
  FindPieceError,
  GetDataSetError,
  LocationHeaderError,
  PostPieceError,
} from '@filoz/synapse-core/errors'
import * as SP from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { PDPAuthHelper, PDPServer } from '../pdp/index.ts'
import type { PDPAddPiecesInput } from '../pdp/server.ts'
import { asPieceCID, calculate as calculatePieceCID } from '../piece/index.ts'
import { createAndAddPiecesHandler, findPieceHandler, uploadPieceHandler } from './mocks/pdp/handlers.ts'

// mock server for testing
const server = setup([])

describe('PDPServer', () => {
  let pdpServer: PDPServer
  let signer: ethers.Wallet
  let authHelper: PDPAuthHelper
  let serverUrl: string

  const TEST_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234'
  const TEST_CONTRACT_ADDRESS = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f'
  const TEST_CHAIN_ID = 31337

  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()

    // Create test signer and auth helper
    signer = new ethers.Wallet(TEST_PRIVATE_KEY)
    authHelper = new PDPAuthHelper(TEST_CONTRACT_ADDRESS, signer, BigInt(TEST_CHAIN_ID))

    // Start mock server
    serverUrl = 'http://pdp.local'

    // Create PDPServer instance
    pdpServer = new PDPServer(authHelper, serverUrl)
  })

  describe('constructor', () => {
    it('should create PDPServer with valid service URL', () => {
      const tool = new PDPServer(authHelper, 'https://example.com/pdp')
      assert.strictEqual(tool.getServiceURL(), 'https://example.com/pdp')
    })

    it('should remove trailing slash from service URL', () => {
      const tool = new PDPServer(authHelper, 'https://example.com/pdp/')
      assert.strictEqual(tool.getServiceURL(), 'https://example.com/pdp')
    })

    it('should throw error for empty service URL', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new PDPServer(authHelper, '')
      }, 'PDP service URL is required')
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
        await signer.getAddress(), // payer
        [], // metadata (empty for no CDN)
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
          await signer.getAddress(), // payer
          [], // metadata (empty for no CDN)
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
          await signer.getAddress(), // payer
          [], // metadata (empty for no CDN)
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
          await signer.getAddress(), // payer
          [], // metadata (empty for no CDN)
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
          await signer.getAddress(), // payer
          [], // metadata (empty for no CDN)
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
          await signer.getAddress(), // payer
          [], // metadata (empty for no CDN)
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

      server.use(createAndAddPiecesHandler(mockTxHash))

      const result = await pdpServer.createAndAddPieces(
        0n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        await signer.getAddress(),
        TEST_CONTRACT_ADDRESS,
        validPieceCid,
        {}
      )

      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl, mockTxHash)
    })
  })

  describe('getPieceAdditionStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse = {
        txHash: mockTxHash,
        txStatus: 'confirmed',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: true,
        confirmedPieceIds: [101, 102],
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', ({ params }) => {
          assert.strictEqual(params.id, '1')
          assert.strictEqual(params.txHash, mockTxHash)

          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getPieceAdditionStatus(1, mockTxHash)
      assert.deepStrictEqual(result, mockResponse)
    })

    it('should handle pending status', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse = {
        txHash: mockTxHash,
        txStatus: 'pending',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: null,
        confirmedPieceIds: undefined,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', ({ params }) => {
          assert.strictEqual(params.id, '1')
          assert.strictEqual(params.txHash, mockTxHash)

          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getPieceAdditionStatus(1, mockTxHash)
      assert.strictEqual(result.txStatus, 'pending')
      assert.isNull(result.addMessageOk)
      assert.isUndefined(result.confirmedPieceIds)
    })

    it('should handle not found status', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', () => {
          return new HttpResponse(null, {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Piece addition not found for transaction: ${mockTxHash}`)
      }
    })

    it('should handle server errors', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      server.use(
        http.get('http://pdp.local/pdp/data-sets/:id/pieces/added/:txHash', () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to get piece addition status')
        assert.include((error as Error).message, '500')
        assert.include((error as Error).message, 'Database error')
      }
    })
  })

  describe('addPieces', () => {
    it('should validate input parameters', async () => {
      // Test empty piece entries
      try {
        await pdpServer.addPieces(1, 0n, [])
        assert.fail('Should have thrown error for empty piece entries')
      } catch (error) {
        assert.include((error as Error).message, 'At least one piece must be provided')
      }

      // Test invalid PieceCID
      const invalidPieceCid = 'invalid-piece-link-string'

      try {
        await pdpServer.addPieces(1, 0n, [invalidPieceCid])
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid PieceCID')
      }
    })

    it('should handle successful piece addition', async () => {
      const validPieceCid = ['bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy']

      server.use(
        http.post<{ id: string }, PDPAddPiecesInput>(
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
      const result = await pdpServer.addPieces(1, 0n, validPieceCid)
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
        await pdpServer.addPieces(1, 0n, validPieceCid)
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
        http.post<{ id: string }, PDPAddPiecesInput>(
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
      const result = await pdpServer.addPieces(1, 0n, multiplePieceCid)
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

      const result = await pdpServer.addPieces(1, 0n, validPieceCid)
      assert.isDefined(result)
      assert.isDefined(result.message)
      assert.strictEqual(result.txHash, mockTxHash)
      assert.include(result.statusUrl ?? '', mockTxHash)
      assert.include(result.statusUrl ?? '', '/pdp/data-sets/1/pieces/added/')
    })
  })

  describe('deletePiece', () => {
    it('should handle successful delete', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse = {
        txHash: mockTxHash,
      }
      server.use(
        // check that extraData is included
        http.delete('http://pdp.local/pdp/data-sets/1/pieces/2', async ({ request }) => {
          const body = await request.json()
          assert.hasAllKeys(body, ['extraData'])
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )
      const result = await pdpServer.deletePiece(1, 0n, 2)
      assert.strictEqual(result, mockTxHash)
    })

    it('should handle server errors', async () => {
      server.use(
        http.delete('http://pdp.local/pdp/data-sets/1/pieces/2', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )
      try {
        await pdpServer.deletePiece(1, 0n, 2)
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.instanceOf(error, DeletePieceError)
        assert.equal(error.shortMessage, 'Failed to delete piece.')
        assert.equal(
          error.message,
          `Failed to delete piece.

Details: Service Provider PDP
Database error`
        )
      }
    })
  })

  describe('getDataSetCreationStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse = {
        createMessageHash: mockTxHash,
        dataSetCreated: true,
        service: 'test-service',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123,
      }

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', async () => {
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getDataSetCreationStatus(mockTxHash)
      assert.deepStrictEqual(result, mockResponse)
    })

    it('should handle not found status', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      server.use(
        http.get('http://pdp.local/pdp/data-sets/created/:tx', async () => {
          return HttpResponse.text(undefined, {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.getDataSetCreationStatus(mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Data set creation not found for transaction hash: ${mockTxHash}`)
      }
    })
  })

  describe('findPiece', () => {
    it('should find a piece successfully', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      server.use(findPieceHandler(mockPieceCid, true))

      const result = await pdpServer.findPiece(mockPieceCid)
      assert.strictEqual(result.pieceCid.toString(), mockPieceCid)
    })

    it('should handle piece not found', async () => {
      SP.setTimeout(100)
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      server.use(findPieceHandler(mockPieceCid, false))

      try {
        await pdpServer.findPiece(mockPieceCid)
        assert.fail('Should have thrown error for not found')
      } catch (error: any) {
        assert.instanceOf(error, FindPieceError)
        assert.equal(error.shortMessage, 'Failed to find piece.')
        assert.equal(
          error.message,
          `Failed to find piece.

Details: Service Provider PDP
Timeout waiting for piece to be found`
        )
      }
    })

    it('should validate PieceCID input', async () => {
      const invalidPieceCid = 'invalid-piece-cid-string'

      try {
        await pdpServer.findPiece(invalidPieceCid)
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
      }
    })

    it('should handle server errors', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      server.use(
        http.get('http://pdp.local/pdp/piece', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.findPiece(mockPieceCid)
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.instanceOf(error, FindPieceError)
        assert.equal(error.shortMessage, 'Failed to find piece.')
        assert.equal(
          error.message,
          `Failed to find piece.

Details: Service Provider PDP
Database error`
        )
      }
    })
  })

  describe('getPieceStatus', () => {
    it('should successfully get piece status', async () => {
      const mockPieceCid = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const mockResponse = {
        pieceCid: mockPieceCid,
        status: 'retrieved',
        indexed: true,
        advertised: true,
        retrieved: true,
        retrievedAt: '2025-10-11T13:35:26.541494+02:00',
      }

      server.use(
        http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getPieceStatus(mockPieceCid)
      assert.deepStrictEqual(result, mockResponse)
    })

    it('should handle pending status', async () => {
      const mockPieceCid = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const mockResponse = {
        pieceCid: mockPieceCid,
        status: 'pending',
        indexed: false,
        advertised: false,
        retrieved: false,
      }

      server.use(
        http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
          return HttpResponse.json(mockResponse, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.getPieceStatus(mockPieceCid)
      assert.strictEqual(result.status, 'pending')
      assert.strictEqual(result.indexed, false)
      assert.strictEqual(result.advertised, false)
      assert.strictEqual(result.retrieved, false)
      assert.isUndefined(result.retrievedAt)
    })

    it('should handle piece not found (404)', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      server.use(
        http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
          return HttpResponse.text('Piece not found or does not belong to service', {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.getPieceStatus(mockPieceCid)
        assert.fail('Should have thrown error for not found')
      } catch (error: any) {
        assert.include(error.message, 'Piece not found or does not belong to service')
      }
    })

    it('should validate PieceCID input', async () => {
      const invalidPieceCid = 'invalid-piece-cid-string'

      try {
        await pdpServer.getPieceStatus(invalidPieceCid)
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
      }
    })

    it('should handle server errors', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      server.use(
        http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.getPieceStatus(mockPieceCid)
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get piece status')
        assert.include(error.message, '500')
        assert.include(error.message, 'Database error')
      }
    })

    it('should validate response structure', async () => {
      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(mockPieceCid)
      const invalidResponse = {
        pieceCid: mockPieceCid.toString(),
        status: 'retrieved',
        // Missing required fields
      }

      server.use(
        http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
          return HttpResponse.json(invalidResponse, {
            status: 200,
          })
        })
      )

      try {
        await pdpServer.getPieceStatus(mockPieceCid)
        assert.fail('Should have thrown error for invalid response format')
      } catch (error: any) {
        assert.include(error.message, 'Invalid piece status response format')
      }
    })

    it('should handle different status values', async () => {
      const mockPieceCid = 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk'
      const statuses = ['pending', 'indexing', 'creating_ad', 'announced', 'retrieved']

      for (const status of statuses) {
        const mockResponse = {
          pieceCid: mockPieceCid,
          status,
          indexed: status === 'creating_ad' || status === 'announced' || status === 'retrieved',
          advertised: status === 'announced' || status === 'retrieved',
          retrieved: status === 'retrieved',
        }

        server.use(
          http.get('http://pdp.local/pdp/piece/:pieceCid/status', async () => {
            return HttpResponse.json(mockResponse, {
              status: 200,
            })
          })
        )

        const result = await pdpServer.getPieceStatus(mockPieceCid)
        assert.strictEqual(result.status, status)
        assert.strictEqual(result.indexed, mockResponse.indexed)
        assert.strictEqual(result.advertised, mockResponse.advertised)
        assert.strictEqual(result.retrieved, mockResponse.retrieved)
      }
    })
  })

  describe('getters', () => {
    it('should return service URL', () => {
      assert.strictEqual(pdpServer.getServiceURL(), serverUrl)
    })

    it('should return PDPAuthHelper instance', () => {
      assert.strictEqual(pdpServer.getAuthHelper(), authHelper)
    })
  })

  describe('uploadPiece', () => {
    it('should successfully upload data', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'

      server.use(
        http.post<Record<string, never>, { pieceCid: string }>('http://pdp.local/pdp/piece', async ({ request }) => {
          try {
            const body = await request.json()
            assert.exists(body.pieceCid)
            return HttpResponse.text('Created', {
              status: 201,
              headers: {
                Location: `/pdp/piece/upload/${mockUuid}`,
              },
            })
          } catch (error) {
            return HttpResponse.text((error as Error).message, {
              status: 400,
            })
          }
        }),
        uploadPieceHandler(mockUuid)
      )

      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(mockPieceCid)
      await pdpServer.uploadPiece(testData, mockPieceCid)
    })

    it('should handle existing piece (200 response)', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

      server.use(
        http.post<Record<string, never>, { pieceCid: string }>('http://pdp.local/pdp/piece', async () => {
          return HttpResponse.json(
            { pieceCid: mockPieceCid },
            {
              status: 200,
            }
          )
        })
      )

      // Should not throw - existing piece is OK
      assert.isNotNull(mockPieceCid)
      await pdpServer.uploadPiece(testData, mockPieceCid)
    })

    it('should throw on create upload session error', async () => {
      const testData = new Uint8Array(127).fill(1)
      const mockPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
      assert.isNotNull(mockPieceCid)

      server.use(
        http.post<Record<string, never>, { pieceCid: string }>('http://pdp.local/pdp/piece', async () => {
          return HttpResponse.text('Database error', {
            status: 500,
          })
        })
      )

      try {
        await pdpServer.uploadPiece(testData, mockPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.instanceOf(error, PostPieceError)
        assert.equal(error.shortMessage, 'Failed to create upload session.')
        assert.equal(
          error.message,
          `Failed to create upload session.

Details: Service Provider PDP
Database error`
        )
      }
    })
  })

  describe('downloadPiece', () => {
    it('should successfully download and verify piece', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testPieceCid = calculatePieceCID(testData).toString()

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const result = await pdpServer.downloadPiece(testPieceCid)
      assert.deepEqual(result, testData)
    })

    it('should throw on download failure', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', async () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.downloadPiece(mockPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Download failed')
        assert.include(error.message, '404')
      }
    })

    it('should reject invalid PieceCID', async () => {
      try {
        await pdpServer.downloadPiece('invalid-piece-link-string')
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
      }
    })

    it('should throw on PieceCID verification failure', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testPieceCid = calculatePieceCID(testData).toString()
      const wrongData = new Uint8Array([9, 9, 9, 9]) // Different data

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(wrongData.buffer)
        })
      )

      try {
        await pdpServer.downloadPiece(testPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'PieceCID verification failed')
      }
    })

    it('should handle null response body', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', async () => {
          return new HttpResponse()
        })
      )

      try {
        await pdpServer.downloadPiece(mockPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Response body is null')
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testPieceCid = calculatePieceCID(testData).toString()

      server.use(
        http.get('http://pdp.local/piece/:pieceCid', async () => {
          // Split test data into chunks
          const chunk1 = testData.slice(0, 4)
          const chunk2 = testData.slice(4)

          // Create readable stream that emits chunks
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(chunk1)
              // Small delay to simulate network
              await new Promise((resolve) => setTimeout(resolve, 10))
              controller.enqueue(chunk2)
              controller.close()
            },
          })
          return new HttpResponse(stream, {
            status: 200,
          })
        })
      )

      const result = await pdpServer.downloadPiece(testPieceCid)
      // Verify we got all the data correctly reassembled
      assert.deepEqual(result, testData)
    })
  })

  describe('ping', () => {
    it('should successfully ping a healthy provider', async () => {
      server.use(
        http.get('http://pdp.local/pdp/ping', async () => {
          return new HttpResponse(null, {
            status: 200,
          })
        })
      )
      await pdpServer.ping()
    })

    it('should throw error when provider returns non-200 status', async () => {
      server.use(
        http.get('http://pdp.local/pdp/ping', async () => {
          return HttpResponse.text('Server is down', {
            status: 500,
          })
        })
      )
      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '500')
        assert.include(error.message, 'Internal Server Error')
        assert.include(error.message, 'Server is down')
      }
    })

    it('should throw error when provider returns 404', async () => {
      server.use(
        http.get('http://pdp.local/pdp/ping', async () => {
          return HttpResponse.text('Ping endpoint not found', {
            status: 404,
          })
        })
      )

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '404')
        assert.include(error.message, 'Not Found')
      }
    })

    it('should handle fetch failure', async () => {
      server.use(
        http.get('http://pdp.local/pdp/ping', async () => {
          return HttpResponse.error()
        })
      )

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to fetch')
      }
    })

    it('should handle error when response.text() fails', async () => {
      server.use(
        http.get('http://pdp.local/pdp/ping', async () => {
          return new HttpResponse(2, {
            status: 503,
            statusText: 'Service Unavailable',
            headers: {
              'Content-Encoding': 'gzip',
            },
          })
        })
      )

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '503')
        assert.include(error.message, 'Service Unavailable')
      }
    })

    it('should use correct URL endpoint', async () => {
      let capturedUrl: string = ''

      server.use(
        http.get('http://pdp.local/pdp/ping', async ({ request }) => {
          capturedUrl = request.url
          return new HttpResponse(null, {
            status: 200,
          })
        })
      )

      await pdpServer.ping()
      assert.strictEqual(capturedUrl, `${serverUrl}/pdp/ping`)
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

      const result = await pdpServer.getDataSet(292)
      assert.equal(result.id, mockDataSetData.id)
      assert.equal(result.nextChallengeEpoch, mockDataSetData.nextChallengeEpoch)
      assert.equal(result.pieces.length, mockDataSetData.pieces.length)
      assert.equal(result.pieces[0].pieceId, mockDataSetData.pieces[0].pieceId)
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
        await pdpServer.getDataSet(999)
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
        await pdpServer.getDataSet(292)
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

      const result = await pdpServer.getDataSet(292)
      assert.deepStrictEqual(result, emptyDataSetData)
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
        await pdpServer.getDataSet(292)
        assert.fail('Should have thrown error for invalid CID in response')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid CID string: invalid-cid-format')
      }
    })
  })
})
