/* globals describe it beforeEach afterEach */

/**
 * PDPServer tests
 *
 * Tests the PDPServer class for creating proof sets and adding roots via HTTP API
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPServer, PDPAuthHelper } from '../pdp/index.js'
import type { RootData } from '../types.js'
import { asCommP, calculate as calculateCommP } from '../commp/index.js'

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
    pdpServer = new PDPServer(authHelper, serverUrl + '/pdp', serverUrl)
  })

  afterEach(async () => {
    await mockServer.stop()
  })

  describe('constructor', () => {
    it('should create PDPServer with valid API endpoint', () => {
      const tool = new PDPServer(authHelper, 'https://example.com/pdp', 'https://example.com')
      assert.strictEqual(tool.getApiEndpoint(), 'https://example.com/pdp')
    })

    it('should remove trailing slash from API endpoint', () => {
      const tool = new PDPServer(authHelper, 'https://example.com/pdp/', 'https://example.com/')
      assert.strictEqual(tool.getApiEndpoint(), 'https://example.com/pdp')
    })

    it('should throw error for empty API endpoint', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new PDPServer(authHelper, '', 'https://example.com')
      }, 'PDP API endpoint is required')
    })

    it('should throw error for empty retrieval endpoint', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new PDPServer(authHelper, 'https://example.com/pdp', '')
      }, 'PDP retrieval endpoint is required')
    })
  })

  describe('createProofSet', () => {
    it('should handle successful proof set creation', async () => {
      // Mock the createProofSet endpoint
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/proof-sets')
        assert.strictEqual(init?.method, 'POST')

        const body = JSON.parse(init?.body as string)
        assert.isDefined(body.recordKeeper)
        assert.isDefined(body.extraData)

        return {
          status: 201,
          headers: {
            get: (header: string) => {
              if (header === 'Location') {
                return `/pdp/proof-sets/created/${mockTxHash}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.createProofSet(
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

  describe('getRootAdditionStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
      const mockResponse = {
        txHash: mockTxHash,
        txStatus: 'confirmed',
        proofSetId: 1,
        rootCount: 2,
        addMessageOk: true,
        confirmedRootIds: [101, 102]
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, `/pdp/proof-sets/1/roots/added/${mockTxHash}`)
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.getRootAdditionStatus(1, mockTxHash)
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
        proofSetId: 1,
        rootCount: 2,
        addMessageOk: null,
        confirmedRootIds: undefined
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
        const result = await pdpServer.getRootAdditionStatus(1, mockTxHash)
        assert.strictEqual(result.txStatus, 'pending')
        assert.isNull(result.addMessageOk)
        assert.isUndefined(result.confirmedRootIds)
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
        await pdpServer.getRootAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Root addition not found for transaction: ${mockTxHash}`)
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
        await pdpServer.getRootAdditionStatus(1, mockTxHash)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to get root addition status')
        assert.include((error as Error).message, '500')
        assert.include((error as Error).message, 'Database error')
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('addRoots', () => {
    it('should validate input parameters', async () => {
      // Test empty root entries
      try {
        await pdpServer.addRoots(1, 0, 0, [])
        assert.fail('Should have thrown error for empty root entries')
      } catch (error) {
        assert.include((error as Error).message, 'At least one root must be provided')
      }

      // Test with invalid raw size - mock server rejection
      const invalidRawSize: RootData = {
        cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
        rawSize: -1
      }

      // Mock fetch to return error for negative size
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid raw size'
        } as any
      }

      try {
        await pdpServer.addRoots(1, 0, 0, [invalidRawSize])
        assert.fail('Should have thrown error for invalid raw size')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to add roots to proof set')
      } finally {
        global.fetch = originalFetch
      }

      // Test invalid CommP
      const invalidCommP: RootData = {
        cid: 'invalid-commp-string',
        rawSize: 1024
      }

      try {
        await pdpServer.addRoots(1, 0, 0, [invalidCommP])
        assert.fail('Should have thrown error for invalid CommP')
      } catch (error) {
        assert.include((error as Error).message, 'Invalid CommP')
      }
    })

    it('should handle successful root addition', async () => {
      const validRootData: RootData[] = [
        {
          cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/proof-sets/1/roots')
        assert.strictEqual(init?.method, 'POST')

        const body = JSON.parse(init?.body as string)
        assert.isDefined(body.roots)
        assert.isDefined(body.extraData)
        assert.strictEqual(body.roots.length, 1)
        assert.strictEqual(body.roots[0].rootCid, validRootData[0].cid)
        assert.strictEqual(body.roots[0].subroots.length, 1)
        assert.strictEqual(body.roots[0].subroots[0].subrootCid, validRootData[0].cid) // Root is its own subroot

        return {
          status: 201,
          text: async () => 'Roots added successfully',
          headers: {
            get: (name: string) => null // No Location header for backward compatibility test
          }
        } as any
      }

      try {
        // Should not throw
        const result = await pdpServer.addRoots(1, 0, 0, validRootData)
        assert.isDefined(result)
        assert.isDefined(result.message)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle server errors appropriately', async () => {
      const validRootData: RootData[] = [
        {
          cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
          rawSize: 1024 * 1024
        }
      ]

      // Mock fetch to return error
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 400,
          statusText: 'Bad Request',
          text: async () => 'Invalid root CID'
        } as any
      }

      try {
        await pdpServer.addRoots(1, 0, 0, validRootData)
        assert.fail('Should have thrown error for server error')
      } catch (error) {
        assert.include((error as Error).message, 'Failed to add roots to proof set: 400 Bad Request - Invalid root CID')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle multiple roots', async () => {
      // Mix of string and CommP object inputs
      const commP1 = asCommP('baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy')
      const commP2 = asCommP('baga6ea4seaqkt24j5gbf2ye2wual5gn7a5yl2tqb52v2sk4nvur4bdy7lg76cdy')
      assert.isNotNull(commP1)
      assert.isNotNull(commP2)

      if (commP1 == null || commP2 == null) {
        throw new Error('Failed to parse test CommPs')
      }

      const multipleRootData: RootData[] = [
        {
          cid: commP1, // Use CommP object
          rawSize: 1024 * 1024
        },
        {
          cid: 'baga6ea4seaqkt24j5gbf2ye2wual5gn7a5yl2tqb52v2sk4nvur4bdy7lg76cdy', // String
          rawSize: 2048 * 1024
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string)

        assert.strictEqual(body.roots.length, 2)
        assert.strictEqual(body.roots[0].subroots.length, 1) // Each root has itself as its only subroot
        assert.strictEqual(body.roots[1].subroots.length, 1)
        assert.strictEqual(body.roots[0].rootCid, body.roots[0].subroots[0].subrootCid)
        assert.strictEqual(body.roots[1].rootCid, body.roots[1].subroots[0].subrootCid)

        return {
          status: 201,
          text: async () => 'Multiple roots added successfully',
          headers: {
            get: (name: string) => null // No Location header for backward compatibility test
          }
        } as any
      }

      try {
        const result = await pdpServer.addRoots(1, 0, 0, multipleRootData)
        assert.isDefined(result)
        assert.isDefined(result.message)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle addRoots response with Location header', async () => {
      const validRootData: RootData[] = [
        {
          cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/proof-sets/1/roots')
        assert.strictEqual(init?.method, 'POST')

        return {
          status: 201,
          text: async () => 'Roots added successfully',
          headers: {
            get: (name: string) => {
              if (name === 'Location') {
                return `/pdp/proof-sets/1/roots/added/${mockTxHash}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.addRoots(1, 0, 0, validRootData)
        assert.isDefined(result)
        assert.isDefined(result.message)
        assert.strictEqual(result.txHash, mockTxHash)
        assert.include(result.statusUrl ?? '', mockTxHash)
        assert.include(result.statusUrl ?? '', '/pdp/proof-sets/1/roots/added/')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle addRoots response with Location header missing 0x prefix', async () => {
      const validRootData: RootData[] = [
        {
          cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
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
          text: async () => 'Roots added successfully',
          headers: {
            get: (name: string) => {
              if (name === 'Location') {
                return `/pdp/proof-sets/1/roots/added/${mockTxHashWithout0x}`
              }
              return null
            }
          }
        } as any
      }

      try {
        const result = await pdpServer.addRoots(1, 0, 0, validRootData)
        assert.isDefined(result)
        assert.strictEqual(result.txHash, mockTxHashWith0x) // Should have 0x prefix added
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle malformed Location header gracefully', async () => {
      const validRootData: RootData[] = [
        {
          cid: 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy',
          rawSize: 1024 * 1024 // 1 MiB
        }
      ]

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async () => {
        return {
          status: 201,
          text: async () => 'Roots added successfully',
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
        const result = await pdpServer.addRoots(1, 0, 0, validRootData)
        assert.isDefined(result)
        assert.isDefined(result.message)
        assert.isUndefined(result.txHash) // No txHash for malformed Location
        assert.isUndefined(result.statusUrl)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('getProofSetCreationStatus', () => {
    it('should handle successful status check', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockResponse = {
        createMessageHash: mockTxHash,
        proofsetCreated: true,
        service: 'test-service',
        txStatus: 'confirmed',
        ok: true,
        proofSetId: 123
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, `/pdp/proof-sets/created/${mockTxHash}`)
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.getProofSetCreationStatus(mockTxHash)
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
        await pdpServer.getProofSetCreationStatus(mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Proof set creation not found for transaction hash: ${mockTxHash}`)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('findPiece', () => {
    it('should find a piece successfully', async () => {
      const mockCommP = 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy'
      const mockSize = 1048576 // 1 MiB
      const mockResponse = {
        piece_cid: mockCommP
      }

      // Mock fetch for this test
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        assert.include(url, '/pdp/piece?')
        assert.include(url, 'name=sha2-256-trunc254-padded')
        assert.include(url, 'size=1048576')
        assert.strictEqual(init?.method, 'GET')

        return {
          status: 200,
          ok: true,
          json: async () => mockResponse
        } as any
      }

      try {
        const result = await pdpServer.findPiece(mockCommP, mockSize)
        assert.strictEqual(result.piece_cid, mockCommP)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle piece not found', async () => {
      const mockCommP = 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy'
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
        await pdpServer.findPiece(mockCommP, mockSize)
        assert.fail('Should have thrown error for not found')
      } catch (error: any) {
        assert.include(error.message, 'Piece not found')
        assert.include(error.message, mockCommP)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should validate CommP input', async () => {
      const invalidCommP = 'invalid-commp-string'
      const mockSize = 1048576

      try {
        await pdpServer.findPiece(invalidCommP, mockSize)
        assert.fail('Should have thrown error for invalid CommP')
      } catch (error: any) {
        assert.include(error.message, 'Invalid CommP')
      }
    })

    it('should handle server errors', async () => {
      const mockCommP = 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy'
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
        await pdpServer.findPiece(mockCommP, mockSize)
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
    it('should return API endpoint', () => {
      assert.strictEqual(pdpServer.getApiEndpoint(), serverUrl + '/pdp')
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
          assert.equal(body.check.name, 'sha2-256-trunc254-padded')
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
        assert.exists(result.commP)
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
          assert.equal(body.check.name, 'sha2-256-trunc254-padded')
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
        assert.exists(result.commP)
        assert.equal(result.size, 5)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle existing piece (200 response)', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5])
      const mockPieceCid = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock fetch to return 200 instead of 201 for create
      const originalFetch = global.fetch
      global.fetch = async (url: any, options: any) => {
        const urlStr = url.toString()

        if (urlStr.includes('/pdp/piece') === true && options?.method === 'POST') {
          // Verify request body has check object
          const body = JSON.parse(options.body)
          assert.exists(body.check)
          assert.equal(body.check.name, 'sha2-256-trunc254-padded')
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
        assert.exists(result.commP)
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
      const testCommP = calculateCommP(testData).toString()

      // Mock fetch
      const originalFetch = global.fetch
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

      try {
        const result = await pdpServer.downloadPiece(testCommP)
        assert.deepEqual(result, testData)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw on download failure', async () => {
      const mockCommP = 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy'

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
        await pdpServer.downloadPiece(mockCommP)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Download failed')
        assert.include(error.message, '404')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should reject invalid CommP', async () => {
      try {
        await pdpServer.downloadPiece('invalid-commp-string')
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Invalid CommP')
      }
    })

    it('should throw on CommP verification failure', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testCommP = calculateCommP(testData).toString()
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
        await pdpServer.downloadPiece(testCommP)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'CommP verification failed')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle null response body', async () => {
      const mockCommP = 'baga6ea4seaqpy7usqklokfx2vxuynmupslkeutzexe2uqurdg5vhtebhxqmpqmy'

      // Mock fetch to return response with null body
      const originalFetch = global.fetch
      global.fetch = async (): Promise<Response> => {
        const response = new Response(null, { status: 200 })
        Object.defineProperty(response, 'body', { value: null })
        return response
      }

      try {
        await pdpServer.downloadPiece(mockCommP)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Response body is null')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should correctly stream and verify chunked data', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const testCommP = calculateCommP(testData).toString()

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
        const result = await pdpServer.downloadPiece(testCommP)
        // Verify we got all the data correctly reassembled
        assert.deepEqual(result, testData)
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
