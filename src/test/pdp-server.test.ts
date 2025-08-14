/* globals describe it beforeEach afterEach */

/**
 * PDPServer tests
 *
 * Tests the PDPServer class for creating data sets and adding pieces via HTTP API
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPServer, PDPAuthHelper } from '../pdp/index.js'
import type { PieceData } from '../types.js'
import { asPieceCID, calculate as calculatePieceCID } from '../piece/index.js'

// Mock server for testing
class MockPDPServer {
  private readonly server: any = null
  private readonly handlers: Map<string, (req: any, res: any) => void> = new Map()

  addHandler (method: string, path: string, handler: (req: any, res: any) => void): void {
    this.handlers.set(`${method}:${path}`, handler)
  }

  async start (port: number): Promise<string> {
    return await new Promise((resolve) => {
      // Mock implementation - in real tests this would be a proper HTTP server
      const baseUrl = `http://localhost:${port}`
      resolve(baseUrl)
    })
  }

  async stop (): Promise<void> {
    return await Promise.resolve()
  }
}

describe('PDPServer', () => {
  let pdpServer: PDPServer
  let authHelper: PDPAuthHelper
  let mockServer: MockPDPServer
  let serverUrl: string

  const TEST_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234'
  const TEST_CONTRACT_ADDRESS = '0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f'
  const TEST_CHAIN_ID = 31337

  beforeEach(async () => {
    // Create test signer and auth helper
    const signer = new ethers.Wallet(TEST_PRIVATE_KEY)
    authHelper = new PDPAuthHelper(TEST_CONTRACT_ADDRESS, signer, BigInt(TEST_CHAIN_ID))

    // Start mock server
    mockServer = new MockPDPServer()
    serverUrl = await mockServer.start(0) // Use random port

    // Create PDPServer instance
    pdpServer = new PDPServer(authHelper, serverUrl)
  })

  afterEach(async () => {
    await mockServer.stop()
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

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/data-sets')
        assert.strictEqual(init?.method, 'POST')

        const body = JSON.parse(init?.body as string)
        assert.isDefined(body.recordKeeper)
        assert.isDefined(body.extraData)

        return {
          status: 201,
          headers: {
            get: (header: string) => {
              if (header === 'Location') {
                return `/pdp/data-sets/created/${mockTxHash}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.createDataSet(
          0, // clientDataSetId
          '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
          false, // withCDN
          TEST_CONTRACT_ADDRESS // recordKeeper
        )

        assert.strictEqual(result.txHash, mockTxHash)
        assert.include(result.statusUrl, mockTxHash)
      } finally {
        global.fetch = originalFetch
      }
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
        confirmedPieceIds: [101, 102]
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, `/pdp/data-sets/1/pieces/added/${mockTxHash}`)
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.deepStrictEqual(result, mockResponse)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle pending status', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse = {
        txHash: mockTxHash,
        txStatus: 'pending',
        dataSetId: 1,
        pieceCount: 2,
        addMessageOk: null,
        confirmedPieceIds: undefined
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 200,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.strictEqual(result.txStatus, 'pending')
        assert.isNull(result.addMessageOk)
        assert.isUndefined(result.confirmedPieceIds)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle not found status', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 404
        } as any
      }

      try {
        await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Piece addition not found for transaction: ${mockTxHash}`)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle server errors', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Database error'
        } as any
      }

      try {
        await pdpServer.getPieceAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to get piece addition status')
        assert.include((error as Error).message, '500')
        assert.include((error as Error).message, 'Database error')
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('addPieces', () => {
    it('should validate input parameters', async () => {
      // Test empty piece entries
      try {
        await pdpServer.addPieces(1, 0, 0, [])
        assert.fail('Should have thrown error for empty piece entries')
      } catch (error) {
        assert.include((error as Error).message, 'At least one piece must be provided')
      }

      // Test with invalid raw size - should fail during signature generation
      const invalidRawSize: PieceData = {
        cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
        rawSize: -1
      }

      try {
        await pdpServer.addPieces(1, 0, 0, [invalidRawSize])
        assert.fail('Should have thrown error for invalid raw size')
      } catch (error) {
        // Negative raw size is invalid
        assert.include((error as Error).message, 'Invalid piece size: -1')
        assert.include((error as Error).message, 'Size must be a positive number')
      }

      // Test invalid PieceCID
      const invalidPieceCid: PieceData = {
        cid: 'invalid-piece-link-string',
        rawSize: 1024
      }

      try {
        await pdpServer.addPieces(1, 0, 0, [invalidPieceCid])
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid PieceCID')
      }
    })

    it('should handle successful piece addition', async () => {
      const validPieceData: PieceData[] = [
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/data-sets/1/pieces')
        assert.strictEqual(init?.method, 'POST')

        const body = JSON.parse(init?.body as string)
        assert.isDefined(body.pieces)
        assert.isDefined(body.extraData)
        assert.strictEqual(body.pieces.length, 1)
        assert.strictEqual(body.pieces[0].pieceCid, validPieceData[0].cid)
        assert.strictEqual(body.pieces[0].subPieces.length, 1)
        assert.strictEqual(body.pieces[0].subPieces[0].subPieceCid, validPieceData[0].cid) // Piece is its own subPiece

        return {
          status: 201,
          text: async () => 'Pieces added successfully',
          headers: {
            get: (name: string) => null // No Location header for backward compatibility test
          }
        } as any
      }

      try {
        // Should not throw
        const result = await pdpServer.addPieces(1, 0, 0, validPieceData)
        assert.isDefined(result)
        assert.isDefined(result.message)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle server errors appropriately', async () => {
      const validPieceData: PieceData[] = [
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
          rawSize: 1024 * 1024
        }
      ]

      // Mock fetch to return error
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid piece CID'
        } as any
      }

      try {
        await pdpServer.addPieces(1, 0, 0, validPieceData)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to add pieces to data set: 400 Bad Request - Invalid piece CID')
      } finally {
        global.fetch = originalFetch
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

      const multiplePieceData: PieceData[] = [
        {
          cid: pieceCid1, // Use PieceCID object
          rawSize: 1024 * 1024
        },
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy', // String
          rawSize: 2048 * 1024
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string)

        assert.strictEqual(body.pieces.length, 2)
        assert.strictEqual(body.pieces[0].subPieces.length, 1) // Each piece has itself as its only subPiece
        assert.strictEqual(body.pieces[1].subPieces.length, 1)
        assert.strictEqual(body.pieces[0].pieceCid, body.pieces[0].subPieces[0].subPieceCid)
        assert.strictEqual(body.pieces[1].pieceCid, body.pieces[1].subPieces[0].subPieceCid)

        return {
          status: 201,
          text: async () => 'Multiple pieces added successfully',
          headers: {
            get: (name: string) => null // No Location header for backward compatibility test
          }
        } as any
      }

      try {
        const result = await pdpServer.addPieces(1, 0, 0, multiplePieceData)
        assert.isDefined(result)
        assert.isDefined(result.message)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle addPieces response with Location header', async () => {
      const validPieceData: PieceData[] = [
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/data-sets/1/pieces')
        assert.strictEqual(init?.method, 'POST')

        return {
          status: 201,
          text: async () => 'Pieces added successfully',
          headers: {
            get: (name: string) => {
              if (name === 'Location') {
                return `/pdp/data-sets/1/pieces/added/${mockTxHash}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.addPieces(1, 0, 0, validPieceData)
        assert.isDefined(result)
        assert.isDefined(result.message)
        assert.strictEqual(result.txHash, mockTxHash)
        assert.include(result.statusUrl ?? '', mockTxHash)
        assert.include(result.statusUrl ?? '', '/pdp/data-sets/1/pieces/added/')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle addPieces response with Location header missing 0x prefix', async () => {
      const validPieceData: PieceData[] = [
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]
      const mockTxHashWithout0x = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
      const mockTxHashWith0x = '0x' + mockTxHashWithout0x

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        return {
          status: 201,
          text: async () => 'Pieces added successfully',
          headers: {
            get: (name: string) => {
              if (name === 'Location') {
                return `/pdp/data-sets/1/pieces/added/${mockTxHashWithout0x}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.addPieces(1, 0, 0, validPieceData)
        assert.isDefined(result)
        assert.strictEqual(result.txHash, mockTxHashWith0x) // Should have 0x prefix added
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle malformed Location header gracefully', async () => {
      const validPieceData: PieceData[] = [
        {
          cid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 201,
          text: async () => 'Pieces added successfully',
          headers: {
            get: (name: string) => {
              if (name === 'Location') {
                return '/some/unexpected/path'
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.addPieces(1, 0, 0, validPieceData)
        assert.isDefined(result)
        assert.isDefined(result.message)
        assert.isUndefined(result.txHash) // No txHash for malformed Location
        assert.isUndefined(result.statusUrl)
      } finally {
        global.fetch = originalFetch
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
        dataSetId: 123
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, `/pdp/data-sets/created/${mockTxHash}`)
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.getDataSetCreationStatus(mockTxHash)
        assert.deepStrictEqual(result, mockResponse)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle not found status', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 404
        } as any
      }

      try {
        await pdpServer.getDataSetCreationStatus(mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Data set creation not found for transaction hash: ${mockTxHash}`)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('findPiece', () => {
    it('should find a piece successfully', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      const mockSize = 1048576 // 1 MiB
      const mockResponse = {
        pieceCid: mockPieceCid
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/piece?')
        assert.include(url, 'name=fr32-sha256-trunc254-padbintree')
        assert.include(url, 'size=1048576')
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          ok: true,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.findPiece(mockPieceCid, mockSize)
        assert.strictEqual(result.pieceCid.toString(), mockPieceCid)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle piece not found', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      const mockSize = 1048576

      // Mock fetch to return 404
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 404,
          ok: false,
          text: async () => 'Requested resource not found'
        } as any
      }

      try {
        await pdpServer.findPiece(mockPieceCid, mockSize)
        assert.fail('Should have thrown error for not found')
      } catch (error: any) {
        assert.include(error.message, 'Piece not found')
        assert.include(error.message, mockPieceCid)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should validate PieceCID input', async () => {
      const invalidPieceCid = 'invalid-piece-cid-string'
      const mockSize = 1048576

      try {
        await pdpServer.findPiece(invalidPieceCid, mockSize)
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
      }
    })

    it('should handle server errors', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
      const mockSize = 1048576

      // Mock fetch to return server error
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 500,
          ok: false,
          statusText: 'Internal Server Error',
          text: async () => 'Database error'
        } as any
      }

      try {
        await pdpServer.findPiece(mockPieceCid, mockSize)
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to find piece')
        assert.include(error.message, '500')
        assert.include(error.message, 'Database error')
      } finally {
        global.fetch = originalFetch
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
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'

      // Mock fetch
      const originalFetch = global.fetch
      global.fetch = async (url: any, options: any) => {
        const urlStr = url.toString()

        if (urlStr.includes('/pdp/piece') === true && options?.method === 'POST') {
          // Verify request body has check object
          const body = JSON.parse(options.body)
          assert.exists(body.check)
          assert.equal(body.check.name, 'fr32-sha256-trunc254-padbintree')
          assert.exists(body.check.hash)
          assert.equal(body.check.size, 5)

          // Create upload session - return 201 with Location header
          return {
            ok: false,
            status: 201,
            headers: {
              get: (name: string) => {
                if (name === 'Location') {
                  return `/pdp/piece/upload/${mockUuid}`
                }
                return null
              }
            },
            text: async () => 'Created'
          } as any
        } else if (urlStr.includes(`/pdp/piece/upload/${String(mockUuid)}`) === true) {
          // Upload data - return 204 No Content
          return {
            ok: true,
            status: 204
          } as any
        }

        throw new Error(`Unexpected request: ${String(urlStr)}`)
      }

      try {
        const result = await pdpServer.uploadPiece(testData)
        assert.exists(result.pieceCid)
        assert.equal(result.size, 5)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle ArrayBuffer input', async () => {
      const buffer = new ArrayBuffer(5)
      const view = new Uint8Array(buffer)
      view.set([1, 2, 3, 4, 5])
      const mockUuid = 'fedcba09-8765-4321-fedc-ba0987654321'

      // Mock fetch
      const originalFetch = global.fetch
      global.fetch = async (url: any, options: any) => {
        const urlStr = url.toString()

        if (urlStr.includes('/pdp/piece') === true && options?.method === 'POST') {
          // Verify request body has check object
          const body = JSON.parse(options.body)
          assert.exists(body.check)
          assert.equal(body.check.name, 'fr32-sha256-trunc254-padbintree')
          assert.exists(body.check.hash)
          assert.equal(body.check.size, 5)

          // Create upload session - return 201 with Location header
          return {
            ok: false,
            status: 201,
            headers: {
              get: (name: string) => {
                if (name === 'Location') {
                  return `/pdp/piece/upload/${mockUuid}`
                }
                return null
              }
            },
            text: async () => 'Created'
          } as any
        } else if (urlStr.includes(`/pdp/piece/upload/${String(mockUuid)}`) === true) {
          // Upload data - return 204 No Content
          return {
            ok: true,
            status: 204
          } as any
        }

        throw new Error(`Unexpected request: ${String(urlStr)}`)
      }

      try {
        const result = await pdpServer.uploadPiece(buffer)
        assert.exists(result.pieceCid)
        assert.equal(result.size, 5)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle existing piece (200 response)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      // Mock fetch to return 200 instead of 201 for create
      const originalFetch = global.fetch
      global.fetch = async (url: any, options: any) => {
        const urlStr = url.toString()

        if (urlStr.includes('/pdp/piece') === true && options?.method === 'POST') {
          // Verify request body has check object
          const body = JSON.parse(options.body)
          assert.exists(body.check)
          assert.equal(body.check.name, 'fr32-sha256-trunc254-padbintree')
          assert.exists(body.check.hash)
          assert.equal(body.check.size, 5)

          // Return 200 OK (piece already exists)
          return {
            ok: true,
            status: 200,
            json: async () => ({ pieceCID: mockPieceCid })
          } as any
        }

        throw new Error(`Unexpected request: ${String(urlStr)}`)
      }

      try {
        // Should not throw - existing piece is OK
        const result = await pdpServer.uploadPiece(testData)
        assert.exists(result.pieceCid)
        assert.equal(result.size, 5)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw on create upload session error', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5])

      // Mock fetch to return error on create
      const originalFetch = global.fetch
      global.fetch = async (url: any, options: any) => {
        const urlStr = url.toString()

        if (urlStr.includes('/pdp/piece') === true && options?.method === 'POST') {
          // Verify request body has check object even for error case
          const body = JSON.parse(options.body)
          assert.exists(body.check)

          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'Database error'
          } as any
        }

        throw new Error(`Unexpected request: ${String(urlStr)}`)
      }

      try {
        await pdpServer.uploadPiece(testData)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to create upload session')
        assert.include(error.message, '500')
        assert.include(error.message, 'Database error')
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('downloadPiece', () => {
    it('should successfully download and verify piece', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testPieceCid = calculatePieceCID(testData).toString()

      // Mock fetch
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        // Verify correct URL format
        assert.isTrue(url.endsWith(`/piece/${testPieceCid}`))

        // Return test data as response
        return new Response(testData, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      }

      try {
        const result = await pdpServer.downloadPiece(testPieceCid)
        assert.deepEqual(result, testData)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw on download failure', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      // Mock fetch
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found'
        } as any
      }

      try {
        await pdpServer.downloadPiece(mockPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Download failed')
        assert.include(error.message, '404')
      } finally {
        global.fetch = originalFetch
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

      // Mock fetch to return wrong data
      const originalFetch = global.fetch
      global.fetch = async (): Promise<Response> => {
        return new Response(wrongData, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      }

      try {
        await pdpServer.downloadPiece(testPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'PieceCID verification failed')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle null response body', async () => {
      const mockPieceCid = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'

      // Mock fetch to return response with null body
      const originalFetch = global.fetch
      global.fetch = async (): Promise<Response> => {
        const response = new Response(null, { status: 200 })
        Object.defineProperty(response, 'body', { value: null })
        return response
      }

      try {
        await pdpServer.downloadPiece(mockPieceCid)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Response body is null')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testPieceCid = calculatePieceCID(testData).toString()

      // Mock fetch that returns data in chunks
      const originalFetch = global.fetch
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

      try {
        const result = await pdpServer.downloadPiece(testPieceCid)
        // Verify we got all the data correctly reassembled
        assert.deepEqual(result, testData)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('ping', () => {
    it('should successfully ping a healthy provider', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/ping')
        assert.strictEqual(init?.method, 'GET')
        assert.deepEqual(init?.headers, {})

        return {
          status: 200,
          statusText: 'OK'
        } as any
      }

      try {
        await pdpServer.ping()
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw error when provider returns non-200 status', async () => {
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server is down'
        } as any
      }

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '500')
        assert.include(error.message, 'Internal Server Error')
        assert.include(error.message, 'Server is down')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw error when provider returns 404', async () => {
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Ping endpoint not found'
        } as any
      }

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '404')
        assert.include(error.message, 'Not Found')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle fetch failure', async () => {
      const originalFetch = global.fetch
      global.fetch = async () => {
        throw new Error('Network connection failed')
      }

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Network connection failed')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle error when response.text() fails', async () => {
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 503,
          statusText: 'Service Unavailable',
          text: async () => {
            throw new Error('Failed to read response body')
          }
        } as any
      }

      try {
        await pdpServer.ping()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ping failed')
        assert.include(error.message, '503')
        assert.include(error.message, 'Service Unavailable')
        assert.include(error.message, 'Unknown error')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should use correct URL endpoint', async () => {
      let capturedUrl: string = ''
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return {
          status: 200,
          statusText: 'OK'
        } as any
      }

      try {
        await pdpServer.ping()
        assert.strictEqual(capturedUrl, `${serverUrl}/pdp/ping`)
      } finally {
        global.fetch = originalFetch
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
            subPieceOffset: 0
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0
          }
        ],
        nextChallengeEpoch: 1500
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/data-sets/292')
        assert.strictEqual(init?.method, 'GET')
        assert.strictEqual((init?.headers as any)?.Accept, 'application/json')

        return {
          status: 200,
          ok: true,
          json: async () => mockDataSetData
        } as any
      }

      try {
        const result = await pdpServer.getDataSet(292)
        assert.equal(result.id, mockDataSetData.id)
        assert.equal(result.nextChallengeEpoch, mockDataSetData.nextChallengeEpoch)
        assert.equal(result.pieces.length, mockDataSetData.pieces.length)
        assert.equal(result.pieces[0].pieceId, mockDataSetData.pieces[0].pieceId)
        assert.equal(result.pieces[0].pieceCid.toString(), mockDataSetData.pieces[0].pieceCid)
        assert.equal(result.pieces[0].subPieceCid.toString(), mockDataSetData.pieces[0].subPieceCid)
        assert.equal(result.pieces[0].subPieceOffset, mockDataSetData.pieces[0].subPieceOffset)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle data set not found', async () => {
      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 404,
          ok: false
        } as any
      }

      try {
        await pdpServer.getDataSet(999)
        assert.fail('Should have thrown error for not found data set')
      } catch (error) {
        assert.include((error as Error).message, 'Data set not found: 999')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle server errors', async () => {
      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 500,
          ok: false,
          statusText: 'Internal Server Error',
          text: async () => 'Database error'
        } as any
      }

      try {
        await pdpServer.getDataSet(292)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to fetch data set')
        assert.include((error as Error).message, '500')
        assert.include((error as Error).message, 'Database error')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should validate response data', async () => {
      const invalidDataSetData = {
        id: '292', // Should be number
        pieces: 'not-array', // Should be array
        nextChallengeEpoch: 'soon' // Should be number
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 200,
          ok: true,
          json: async () => invalidDataSetData
        } as any
      }

      try {
        await pdpServer.getDataSet(292)
        assert.fail('Should have thrown error for invalid response data')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid data set data response format')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle data set with no pieces', async () => {
      const emptyDataSetData = {
        id: 292,
        pieces: [],
        nextChallengeEpoch: 1500
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 200,
          ok: true,
          json: async () => emptyDataSetData
        } as any
      }

      try {
        const result = await pdpServer.getDataSet(292)
        assert.deepStrictEqual(result, emptyDataSetData)
        assert.isArray(result.pieces)
        assert.equal(result.pieces.length, 0)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should reject response with invalid CIDs', async () => {
      const invalidCidDataSetData = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'invalid-cid-format',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0
          }
        ],
        nextChallengeEpoch: 1500
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 200,
          ok: true,
          json: async () => invalidCidDataSetData
        } as any
      }

      try {
        await pdpServer.getDataSet(292)
        assert.fail('Should have thrown error for invalid CID in response')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid data set data response format')
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
