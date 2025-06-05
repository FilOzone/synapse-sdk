/* globals describe it beforeEach afterEach */

/**
 * PDPTool tests
 *
 * Tests the PDPTool class for creating proof sets and adding roots via HTTP API
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPTool, PDPAuthHelper } from '../pdp/index.js'
import type { RootData } from '../types.js'
import { asCommP } from '../commp/index.js'

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

describe('PDPTool', () => {
  let pdpTool: PDPTool
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

    // Create PDPTool instance
    pdpTool = new PDPTool(serverUrl, authHelper)
  })

  afterEach(async () => {
    await mockServer.stop()
  })

  describe('constructor', () => {
    it('should create PDPTool with valid API endpoint', () => {
      const tool = new PDPTool('https://example.com', authHelper)
      assert.strictEqual(tool.getApiEndpoint(), 'https://example.com')
    })

    it('should remove trailing slash from API endpoint', () => {
      const tool = new PDPTool('https://example.com/', authHelper)
      assert.strictEqual(tool.getApiEndpoint(), 'https://example.com')
    })

    it('should throw error for empty API endpoint', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new PDPTool('', authHelper)
      }, 'PDP API endpoint is required')
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
        const result = await pdpTool.createProofSet(
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

  describe('addRoots', () => {
    it('should validate input parameters', async () => {
      // Test empty root entries
      try {
        await pdpTool.addRoots(1, 0, 0, [])
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
        await pdpTool.addRoots(1, 0, 0, [invalidRawSize])
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
        await pdpTool.addRoots(1, 0, 0, [invalidCommP])
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
          text: async () => 'Roots added successfully'
        } as any
      }

      try {
        // Should not throw
        const result = await pdpTool.addRoots(1, 0, 0, validRootData)
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
        await pdpTool.addRoots(1, 0, 0, validRootData)
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
          text: async () => 'Multiple roots added successfully'
        } as any
      }

      try {
        const result = await pdpTool.addRoots(1, 0, 0, multipleRootData)
        assert.isDefined(result)
        assert.isDefined(result.message)
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
        const result = await pdpTool.getProofSetCreationStatus(mockTxHash)
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
        await pdpTool.getProofSetCreationStatus(mockTxHash)
        assert.fail('Should have thrown error for not found status')
      } catch (error) {
        assert.include((error as Error).message, `Proof set creation not found for transaction hash: ${mockTxHash}`)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('getters', () => {
    it('should return API endpoint', () => {
      assert.strictEqual(pdpTool.getApiEndpoint(), serverUrl)
    })

    it('should return PDPAuthHelper instance', () => {
      assert.strictEqual(pdpTool.getPDPAuthHelper(), authHelper)
    })
  })
})
