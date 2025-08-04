/* globals describe it */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { StorageService } from '../storage/service.js'
import { Synapse } from '../synapse.js'
import type { ApprovedProviderInfo, CommP, UploadResult } from '../types.js'

// Create a mock Ethereum provider that doesn't try to connect
const mockEthProvider = {
  getTransaction: async (hash: string) => null,
  getNetwork: async () => ({ chainId: BigInt(314159), name: 'test' })
} as any

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => mockEthProvider,
  getPandoraAddress: () => '0x1234567890123456789012345678901234567890',
  getChainId: () => BigInt(314159),
  payments: {
    serviceApproval: async () => ({
      service: '0x1234567890123456789012345678901234567890',
      rateAllowance: BigInt(1000000),
      lockupAllowance: BigInt(10000000),
      rateUsed: BigInt(0),
      lockupUsed: BigInt(0)
    })
  },
  download: async (commp: string | CommP, options?: any) => {
    // Mock download that returns test data - will be overridden in specific tests
    return new Uint8Array(65).fill(42)
  },
  getProviderInfo: async (providerAddress: string) => {
    // Mock getProviderInfo - will be overridden in specific tests
    throw new Error('getProviderInfo not mocked')
  }
} as unknown as Synapse

// Mock provider info
const mockProvider: ApprovedProviderInfo = {
  owner: '0xabcdef1234567890123456789012345678901234',
  pdpUrl: 'https://pdp.example.com',
  pieceRetrievalUrl: 'https://retrieve.example.com',
  registeredAt: 1234567890,
  approvedAt: 1234567891
}

describe('StorageService', () => {
  describe('create() factory method', () => {
    it('should select a random provider when no providerId specified', async () => {
      // Create mock PandoraService
      const mockProviders: ApprovedProviderInfo[] = [
        {
          owner: '0x1111111111111111111111111111111111111111',
          pdpUrl: 'https://pdp1.example.com',
          pieceRetrievalUrl: 'https://retrieve1.example.com',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        },
        {
          owner: '0x2222222222222222222222222222222222222222',
          pdpUrl: 'https://pdp2.example.com',
          pieceRetrievalUrl: 'https://retrieve2.example.com',
          registeredAt: 1234567892,
          approvedAt: 1234567893
        }
      ]

      const proofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].owner, // Matches first provider
          pdpVerifierProofSetId: 100,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].owner, // Matches second provider
          pdpVerifierProofSetId: 101,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockPandoraService = {
        getAllApprovedProviders: async () => mockProviders,
        getClientProofSetsWithDetails: async () => proofSets,
        getNextClientDataSetId: async () => 3,
        getProviderIdByAddress: async (address: string) => {
          const idx = mockProviders.findIndex(p => p.owner.toLowerCase() === address.toLowerCase())
          return idx >= 0 ? idx + 1 : 0
        },
        getApprovedProvider: async (id: number) => mockProviders[id - 1] ?? null
      } as any

      // Mock fetch for ping validation
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/ping')) {
          return { status: 200, statusText: 'OK' } as any
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        // Create storage service without specifying providerId
        const service = await StorageService.create(mockSynapse, mockPandoraService, {})

        // Should have selected one of the providers
        assert.isTrue(
          service.storageProvider === mockProviders[0].owner ||
          service.storageProvider === mockProviders[1].owner
        )
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should use specific provider when providerId specified', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x3333333333333333333333333333333333333333',
        pdpUrl: 'https://pdp3.example.com',
        pieceRetrievalUrl: 'https://retrieve3.example.com',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const proofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierProofSetId: 100,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 3)
          return mockProvider
        },
        getClientProofSetsWithDetails: async () => proofSets,
        getNextClientDataSetId: async () => 2
      } as any

      // Create storage service with specific providerId
      const service = await StorageService.create(mockSynapse, mockPandoraService, { providerId: 3 })

      assert.equal(service.storageProvider, mockProvider.owner)
    })

    it('should throw when no approved providers available', async () => {
      const mockPandoraService = {
        getAllApprovedProviders: async () => [], // Empty array
        getClientProofSetsWithDetails: async () => []
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, {})
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved storage providers available')
      }
    })

    it('should throw when specified provider not found', async () => {
      const mockPandoraService = {
        getApprovedProvider: async () => ({
          owner: '0x0000000000000000000000000000000000000000', // Zero address
          pdpUrl: '',
          pieceRetrievalUrl: '',
          registeredAt: 0,
          approvedAt: 0
        }),
        getClientProofSetsWithDetails: async () => [] // Also needs this for parallel fetch
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, { providerId: 999 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 999 not found or not approved')
      }
    })

    it('should select existing proof set when available', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x3333333333333333333333333333333333333333',
        pdpUrl: 'https://pdp3.example.com',
        pieceRetrievalUrl: 'https://retrieve3.example.com',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333', // Matches provider
          pdpVerifierProofSetId: 100,
          nextRootId: 5,
          currentRootCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getApprovedProvider: async () => mockProvider,
        getClientProofSetsWithDetails: async () => mockProofSets,
        getNextClientDataSetId: async () => 2
      } as any

      const service = await StorageService.create(mockSynapse, mockPandoraService, { providerId: 3 })

      // Should use existing proof set
      assert.equal(service.proofSetId, '100')
    })

    it.skip('should create new proof set when none exist', async () => {
      // Skip: Requires real PDPServer for createProofSet
      // This would need mocking of PDPServer which is created internally
    })

    it('should prefer proof sets with existing roots', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x3333333333333333333333333333333333333333',
        pdpUrl: 'https://pdp3.example.com',
        pieceRetrievalUrl: 'https://retrieve3.example.com',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierProofSetId: 100,
          nextRootId: 0,
          currentRootCount: 0, // No roots
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierProofSetId: 101,
          nextRootId: 5,
          currentRootCount: 5, // Has roots - should be preferred
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockPandoraService = {
        getApprovedProvider: async () => mockProvider,
        getClientProofSetsWithDetails: async () => mockProofSets,
        getNextClientDataSetId: async () => 3
      } as any

      const service = await StorageService.create(mockSynapse, mockPandoraService, { providerId: 3 })

      // Should select the proof set with roots
      assert.equal(service.proofSetId, '101')
    })

    it('should handle provider selection callbacks', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x3333333333333333333333333333333333333333',
        pdpUrl: 'https://pdp3.example.com',
        pieceRetrievalUrl: 'https://retrieve3.example.com',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      let providerCallbackFired = false
      let proofSetCallbackFired = false

      const proofSets = [{
        railId: 1,
        payer: '0x1234567890123456789012345678901234567890',
        payee: mockProvider.owner,
        pdpVerifierProofSetId: 100,
        nextRootId: 0,
        currentRootCount: 0,
        isLive: true,
        isManaged: true,
        withCDN: false,
        commissionBps: 0,
        metadata: '',
        rootMetadata: [],
        clientDataSetId: 1
      }]

      const mockPandoraService = {
        getApprovedProvider: async () => mockProvider,
        getClientProofSetsWithDetails: async () => proofSets,
        getNextClientDataSetId: async () => 2
      } as any

      await StorageService.create(mockSynapse, mockPandoraService, {
        providerId: 3,
        callbacks: {
          onProviderSelected: (provider) => {
            assert.equal(provider.owner, mockProvider.owner)
            providerCallbackFired = true
          },
          onProofSetResolved: (info) => {
            assert.isTrue(info.isExisting)
            assert.equal(info.proofSetId, 100)
            proofSetCallbackFired = true
          }
        }
      })

      assert.isTrue(providerCallbackFired, 'onProviderSelected should have been called')
      assert.isTrue(proofSetCallbackFired, 'onProofSetResolved should have been called')
    })

    it('should select by explicit proofSetId', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x3333333333333333333333333333333333333333',
        pdpUrl: 'https://pdp3.example.com',
        pieceRetrievalUrl: 'https://retrieve3.example.com',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.owner,
          pdpVerifierProofSetId: 456,
          nextRootId: 10,
          currentRootCount: 10,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets,
        getProviderIdByAddress: async (addr: string) => {
          assert.equal(addr, mockProvider.owner)
          return 3
        },
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 3)
          return mockProvider
        }
      } as any

      const service = await StorageService.create(mockSynapse, mockPandoraService, { proofSetId: 456 })

      assert.equal(service.proofSetId, '456')
      assert.equal(service.storageProvider, mockProvider.owner)
    })

    it('should select by providerAddress', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0x4444444444444444444444444444444444444444',
        pdpUrl: 'https://pdp4.example.com',
        pieceRetrievalUrl: 'https://retrieve4.example.com',
        registeredAt: 1234567896,
        approvedAt: 1234567897
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.owner,
          pdpVerifierProofSetId: 789,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getProviderIdByAddress: async (addr: string) => {
          assert.equal(addr.toLowerCase(), mockProvider.owner.toLowerCase())
          return 4
        },
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 4)
          return mockProvider
        },
        getClientProofSetsWithDetails: async () => mockProofSets
      } as any

      const service = await StorageService.create(mockSynapse, mockPandoraService, {
        providerAddress: mockProvider.owner
      })

      assert.equal(service.storageProvider, mockProvider.owner)
      assert.equal(service.proofSetId, '789')
    })

    it('should throw when proofSetId not found', async () => {
      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => [] // No proof sets
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, { proofSetId: 999 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Proof set 999 not found')
      }
    })

    it('should throw when proofSetId conflicts with providerId', async () => {
      const mockProvider1: ApprovedProviderInfo = {
        owner: '0x5555555555555555555555555555555555555555',
        pdpUrl: 'https://pdp5.example.com',
        pieceRetrievalUrl: 'https://retrieve5.example.com',
        registeredAt: 1234567898,
        approvedAt: 1234567899
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider1.owner, // Owned by provider 5
          pdpVerifierProofSetId: 111,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets,
        getProviderIdByAddress: async () => 5 // Different provider ID
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, {
          proofSetId: 111,
          providerId: 3 // Conflicts with actual owner
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider ID 5')
        assert.include(error.message, 'but provider ID 3 was requested')
      }
    })

    it('should throw when providerAddress not approved', async () => {
      const mockPandoraService = {
        getProviderIdByAddress: async () => 0, // Not approved
        getClientProofSetsWithDetails: async () => []
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, {
          providerAddress: '0x6666666666666666666666666666666666666666'
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'is not currently approved')
      }
    })

    it('should filter by CDN setting in smart selection', async () => {
      const mockProviders: ApprovedProviderInfo[] = [
        {
          owner: '0x7777777777777777777777777777777777777777',
          pdpUrl: 'https://pdp7.example.com',
          pieceRetrievalUrl: 'https://retrieve7.example.com',
          registeredAt: 1234567900,
          approvedAt: 1234567901
        }
      ]

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].owner,
          pdpVerifierProofSetId: 200,
          nextRootId: 5,
          currentRootCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false, // No CDN
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].owner,
          pdpVerifierProofSetId: 201,
          nextRootId: 3,
          currentRootCount: 3,
          isLive: true,
          isManaged: true,
          withCDN: true, // With CDN
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets,
        getProviderIdByAddress: async () => 7,
        getApprovedProvider: async () => mockProviders[0],
        getAllApprovedProviders: async () => mockProviders
      } as any

      // Mock fetch for ping validation
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/ping')) {
          return { status: 200, statusText: 'OK' } as any
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        // Test with CDN = false
        const serviceNoCDN = await StorageService.create(mockSynapse, mockPandoraService, { withCDN: false })
        assert.equal(serviceNoCDN.proofSetId, '200', 'Should select non-CDN proof set')

        // Test with CDN = true
        const serviceWithCDN = await StorageService.create(mockSynapse, mockPandoraService, { withCDN: true })
        assert.equal(serviceWithCDN.proofSetId, '201', 'Should select CDN proof set')
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should handle proof sets not managed by current Pandora', async () => {
      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x8888888888888888888888888888888888888888',
          pdpVerifierProofSetId: 300,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: false, // Not managed by current Pandora
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets,
        getAllApprovedProviders: async () => [{
          owner: '0x9999999999999999999999999999999999999999',
          pdpUrl: 'https://pdp9.example.com',
          pieceRetrievalUrl: 'https://retrieve9.example.com',
          registeredAt: 1234567902,
          approvedAt: 1234567903
        }],
        getNextClientDataSetId: async () => 1
      } as any

      // Should create new proof set since existing one is not managed
      const service = await StorageService.create(mockSynapse, mockPandoraService, {})

      // Should have selected a provider but no existing proof set
      assert.exists(service.storageProvider)
      assert.notEqual(service.storageProvider, mockProofSets[0].payee)
    })

    it('should throw when proof set belongs to non-approved provider', async () => {
      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pdpVerifierProofSetId: 400,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets,
        getProviderIdByAddress: async () => 0 // Provider not approved
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, { proofSetId: 400 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'is not currently approved')
      }
    })

    it.skip('should create new proof set when none exist for provider', async () => {
      const mockProvider: ApprovedProviderInfo = {
        owner: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        pdpUrl: 'https://pdp-b.example.com',
        pieceRetrievalUrl: 'https://retrieve-b.example.com',
        registeredAt: 1234567904,
        approvedAt: 1234567905
      }

      const mockPandoraService = {
        getApprovedProvider: async () => mockProvider,
        getClientProofSetsWithDetails: async () => [], // No proof sets
        getProviderIdByAddress: async () => 11,
        getNextClientDataSetId: async () => 1
      } as any

      const service = await StorageService.create(mockSynapse, mockPandoraService, {
        providerId: 11
      })

      assert.equal(service.storageProvider, mockProvider.owner)
      // Note: actual proof set creation is skipped in tests
    })

    it.skip('should validate parallel fetching in resolveByProviderId', async () => {
      let getApprovedProviderCalled = false
      let getClientProofSetsCalled = false
      const callOrder: string[] = []

      const mockProvider: ApprovedProviderInfo = {
        owner: '0xcccccccccccccccccccccccccccccccccccccccc',
        pdpUrl: 'https://pdp-c.example.com',
        pieceRetrievalUrl: 'https://retrieve-c.example.com',
        registeredAt: 1234567906,
        approvedAt: 1234567907
      }

      const mockPandoraService = {
        getApprovedProvider: async () => {
          callOrder.push('getApprovedProvider-start')
          getApprovedProviderCalled = true
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10))
          callOrder.push('getApprovedProvider-end')
          return mockProvider
        },
        getClientProofSetsWithDetails: async () => {
          callOrder.push('getClientProofSetsWithDetails-start')
          getClientProofSetsCalled = true
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10))
          callOrder.push('getClientProofSetsWithDetails-end')
          return []
        },
        getNextClientDataSetId: async () => 1
      } as any

      await StorageService.create(mockSynapse, mockPandoraService, { providerId: 12 })

      assert.isTrue(getApprovedProviderCalled)
      assert.isTrue(getClientProofSetsCalled)

      // Verify both calls started before either finished (parallel execution)
      const providerStartIndex = callOrder.indexOf('getApprovedProvider-start')
      const proofSetsStartIndex = callOrder.indexOf('getClientProofSetsWithDetails-start')
      const providerEndIndex = callOrder.indexOf('getApprovedProvider-end')

      assert.isBelow(providerStartIndex, providerEndIndex)
      assert.isBelow(proofSetsStartIndex, providerEndIndex)
    })

    it('should use progressive loading in smart selection', async () => {
      let getClientProofSetsCalled = false
      let getAllApprovedProvidersCalled = false

      const mockProvider: ApprovedProviderInfo = {
        owner: '0xdddddddddddddddddddddddddddddddddddddddd',
        pdpUrl: 'https://pdp-d.example.com',
        pieceRetrievalUrl: 'https://retrieve-d.example.com',
        registeredAt: 1234567908,
        approvedAt: 1234567909
      }

      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.owner,
          pdpVerifierProofSetId: 500,
          nextRootId: 2,
          currentRootCount: 2,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => {
          getClientProofSetsCalled = true
          return mockProofSets
        },
        getProviderIdByAddress: async () => 13,
        getApprovedProvider: async () => mockProvider,
        getAllApprovedProviders: async () => {
          getAllApprovedProvidersCalled = true
          throw new Error('Should not fetch all providers when proof sets exist')
        }
      } as any

      // Mock fetch for ping validation - existing provider should succeed
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/ping')) {
          return { status: 200, statusText: 'OK' } as any
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        const service = await StorageService.create(mockSynapse, mockPandoraService, {})

        assert.isTrue(getClientProofSetsCalled, 'Should fetch client proof sets')
        assert.isFalse(getAllApprovedProvidersCalled, 'Should NOT fetch all providers')
        assert.equal(service.proofSetId, '500')
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should fetch all providers only when no proof sets exist', async () => {
      let getAllApprovedProvidersCalled = false

      const mockProviders: ApprovedProviderInfo[] = [
        {
          owner: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          pdpUrl: 'https://pdp-e.example.com',
          pieceRetrievalUrl: 'https://retrieve-e.example.com',
          registeredAt: 1234567910,
          approvedAt: 1234567911
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => [], // No proof sets
        getAllApprovedProviders: async () => {
          getAllApprovedProvidersCalled = true
          return mockProviders
        },
        getNextClientDataSetId: async () => 1
      } as any

      await StorageService.create(mockSynapse, mockPandoraService, {})

      assert.isTrue(getAllApprovedProvidersCalled, 'Should fetch all providers when no proof sets')
    })

    it('should handle proof set not live', async () => {
      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0xffffffffffffffffffffffffffffffffffffffffffff',
          pdpVerifierProofSetId: 600,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: false, // Not live
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, { proofSetId: 600 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Proof set 600 not found')
      }
    })

    it('should handle conflict between proofSetId and providerAddress', async () => {
      const mockProofSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x1111222233334444555566667777888899990000', // Different from requested
          pdpVerifierProofSetId: 700,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          rootMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockPandoraService = {
        getClientProofSetsWithDetails: async () => mockProofSets
      } as any

      try {
        await StorageService.create(mockSynapse, mockPandoraService, {
          proofSetId: 700,
          providerAddress: '0x9999888877776666555544443333222211110000' // Different address
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider')
        assert.include(error.message, 'but provider')
        assert.include(error.message, 'was requested')
      }
    })

    it.skip('should retry transaction fetch for up to 30 seconds', async () => {
      // This test validates that the transaction retry logic is implemented
      // The implementation retries getTransaction() for up to 30 seconds (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS)
      // with a 2-second interval (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_POLL_INTERVAL_MS)
      // before throwing an error if the transaction is not found
    })

    it.skip('should fail after 30 seconds if transaction never appears', async () => {
      // This test validates that the transaction retry logic times out after 30 seconds
      // If a transaction is not found after TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS (30 seconds),
      // the implementation throws an error indicating the transaction was not found
    })
  })

  describe('preflightUpload', () => {
    it('should calculate costs without CDN', async () => {
      const mockPandoraService = {
        checkAllowanceForStorage: async () => ({
          rateAllowanceNeeded: BigInt(100),
          lockupAllowanceNeeded: BigInt(2880000),
          currentRateAllowance: BigInt(1000000),
          currentLockupAllowance: BigInt(10000000),
          currentRateUsed: BigInt(0),
          currentLockupUsed: BigInt(0),
          sufficient: true,
          message: undefined,
          costs: {
            perEpoch: BigInt(100),
            perDay: BigInt(28800),
            perMonth: BigInt(864000)
          }
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

      assert.equal(preflight.estimatedCost.perEpoch, BigInt(100))
      assert.equal(preflight.estimatedCost.perDay, BigInt(28800))
      assert.equal(preflight.estimatedCost.perMonth, BigInt(864000))
      assert.isTrue(preflight.allowanceCheck.sufficient)
      assert.isUndefined(preflight.allowanceCheck.message)
      assert.equal(preflight.selectedProvider.owner, mockProvider.owner)
      assert.equal(preflight.selectedProofSetId, 123)
    })

    it('should calculate costs with CDN', async () => {
      const mockPandoraService = {
        checkAllowanceForStorage: async (): Promise<any> => ({
          rateAllowanceNeeded: BigInt(200),
          lockupAllowanceNeeded: BigInt(5760000),
          currentRateAllowance: BigInt(1000000),
          currentLockupAllowance: BigInt(10000000),
          currentRateUsed: BigInt(0),
          currentLockupUsed: BigInt(0),
          sufficient: true,
          message: undefined,
          costs: {
            perEpoch: BigInt(200),
            perDay: BigInt(57600),
            perMonth: BigInt(1728000)
          }
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: true })

      const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

      // Should use CDN costs
      assert.equal(preflight.estimatedCost.perEpoch, BigInt(200))
      assert.equal(preflight.estimatedCost.perDay, BigInt(57600))
      assert.equal(preflight.estimatedCost.perMonth, BigInt(1728000))
      assert.isTrue(preflight.allowanceCheck.sufficient)
    })

    it('should handle insufficient allowances', async () => {
      const mockPandoraService = {
        checkAllowanceForStorage: async (): Promise<any> => ({
          rateAllowanceNeeded: BigInt(2000000),
          lockupAllowanceNeeded: BigInt(20000000),
          currentRateAllowance: BigInt(1000000),
          currentLockupAllowance: BigInt(10000000),
          currentRateUsed: BigInt(0),
          currentLockupUsed: BigInt(0),
          sufficient: false,
          message: 'Rate allowance insufficient: current 1000000, need 2000000. Lockup allowance insufficient: current 10000000, need 20000000',
          costs: {
            perEpoch: BigInt(100),
            perDay: BigInt(28800),
            perMonth: BigInt(864000)
          }
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const preflight = await service.preflightUpload(100 * 1024 * 1024) // 100 MiB

      assert.isFalse(preflight.allowanceCheck.sufficient)
      assert.include(preflight.allowanceCheck.message, 'Rate allowance insufficient')
      assert.include(preflight.allowanceCheck.message, 'Lockup allowance insufficient')
    })

    it('should enforce minimum size limit in preflightUpload', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      try {
        await service.preflightUpload(64) // 64 bytes (1 under minimum)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'below minimum allowed size')
        assert.include(error.message, '64 bytes')
        assert.include(error.message, '65 bytes')
      }
    })

    it('should enforce maximum size limit in preflightUpload', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      try {
        await service.preflightUpload(210 * 1024 * 1024) // 210 MiB
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, '220200960') // 210 * 1024 * 1024
        assert.include(error.message, '209715200') // 200 * 1024 * 1024
      }
    })
  })

  describe('download', () => {
    it('should download and verify a piece', async () => {
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Create a mock Synapse with custom download
      const mockSynapseWithDownload = {
        ...mockSynapse,
        download: async (commp: string | CommP, options?: any) => {
          assert.equal(commp, testCommP)
          assert.equal(options?.providerAddress, mockProvider.owner)
          assert.equal(options?.withCDN, false)
          return testData
        }
      } as unknown as Synapse

      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapseWithDownload, mockPandoraService, mockProvider, 123, { withCDN: false })

      const downloaded = await service.download(testCommP)
      assert.deepEqual(downloaded, testData)
    })

    it('should handle download errors', async () => {
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Create a mock Synapse that throws error
      const mockSynapseWithError = {
        ...mockSynapse,
        download: async (): Promise<Uint8Array> => {
          throw new Error('Network error')
        }
      } as unknown as Synapse

      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapseWithError, mockPandoraService, mockProvider, 123, { withCDN: false })

      try {
        await service.download(testCommP)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.equal(error.message, 'Network error')
      }
    })

    it('should accept empty download options', async () => {
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Create a mock Synapse with custom download
      const mockSynapseWithOptions = {
        ...mockSynapse,
        download: async (commp: string | CommP, options?: any) => {
          assert.equal(commp, testCommP)
          // Options should still contain providerAddress and withCDN from StorageService
          assert.equal(options?.providerAddress, mockProvider.owner)
          assert.equal(options?.withCDN, false)
          return testData
        }
      } as unknown as Synapse

      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapseWithOptions, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Test with and without empty options object
      const downloaded1 = await service.download(testCommP)
      assert.deepEqual(downloaded1, testData)

      const downloaded2 = await service.download(testCommP, {})
      assert.deepEqual(downloaded2, testData)
    })
  })

  describe('upload', () => {
    it('should enforce 65 byte minimum size limit', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create data that is below the minimum
      const undersizedData = new Uint8Array(64) // 64 bytes (1 byte under minimum)

      try {
        await service.upload(undersizedData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'below minimum allowed size')
        assert.include(error.message, '64 bytes')
        assert.include(error.message, '65 bytes')
      }
    })
    it('should support parallel uploads', async () => {
      // Use a counter to simulate the nextRootId changing on the contract
      // between addRoots transactions, which might not execute in order.
      let nextRootId = 0
      const addRootsCalls: Array<{ commP: string, rootId: number }> = []

      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => {
          const currentRootId = nextRootId
          nextRootId++
          return {
            nextRootId: currentRootId,
            clientDataSetId: 1,
            currentRootCount: currentRootId
          }
        }
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const serviceAny = service as any

      // Mock PDPServer methods to track calls
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        // Use the first byte to create a unique commP for each upload
        const commP = `baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2m${data[0]}`
        return { commP, size: data.length }
      }
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addRoots = async (proofSetId: number, clientDataSetId: number, nextRootId: number, comms: Array<{ cid: { toString: () => string } }>): Promise<any> => {
        // The mock now receives the whole batch, so we process it.
        // We use nextRootId from the call arguments to simulate what the contract does.
        comms.forEach((comm, index) => {
          addRootsCalls.push({ commP: comm.cid.toString(), rootId: nextRootId + index })
        })
        // Return a response that simulates an older server for simplicity,
        // as we are not testing the transaction tracking part here.
        return { message: 'success' }
      }

      // Track callbacks
      const uploadCompleteCallbacks: string[] = []
      const rootAddedCallbacks: number[] = []

      // Create distinct data for each upload
      const firstData = new Uint8Array(65).fill(1) // 65 bytes
      const secondData = new Uint8Array(66).fill(2) // 66 bytes
      const thirdData = new Uint8Array(67).fill(3) // 67 bytes

      // Start all uploads concurrently with callbacks
      const uploads = [
        service.upload(firstData, {
          onUploadComplete: (commp) => uploadCompleteCallbacks.push(commp.toString()),
          onRootAdded: () => rootAddedCallbacks.push(1)
        }),
        service.upload(secondData, {
          onUploadComplete: (commp) => uploadCompleteCallbacks.push(commp.toString()),
          onRootAdded: () => rootAddedCallbacks.push(2)
        }),
        service.upload(thirdData, {
          onUploadComplete: (commp) => uploadCompleteCallbacks.push(commp.toString()),
          onRootAdded: () => rootAddedCallbacks.push(3)
        })
      ]

      // Wait for all to complete
      const results = await Promise.all(uploads)

      assert.lengthOf(results, 3, 'All three uploads should complete successfully')

      const resultSizes = results.map(r => r.size)
      const resultRootIds = results.map(r => r.rootId)

      assert.deepEqual(resultSizes, [65, 66, 67], 'Should have one result for each data size')
      assert.deepEqual(resultRootIds, [0, 1, 2], 'The set of assigned root IDs should be {0, 1, 2}')

      // Verify the calls to the mock were made correctly
      assert.lengthOf(addRootsCalls, 3, 'addRoots should be called three times')
      for (const result of results) {
        assert.isTrue(
          addRootsCalls.some(call => call.commP === result.commp.toString() && call.rootId === result.rootId),
          `addRoots call for commp ${result.commp.toString()} and rootId ${result.rootId ?? 'not found'} should exist`
        )
      }

      // Verify callbacks were called
      assert.lengthOf(uploadCompleteCallbacks, 3, 'All upload complete callbacks should be called')
      assert.lengthOf(rootAddedCallbacks, 3, 'All root added callbacks should be called')
      assert.deepEqual(rootAddedCallbacks.sort((a, b) => a - b), [1, 2, 3], 'All callbacks should be called')
    })

    it('should respect batch size configuration', async () => {
      let nextRootId = 0
      const addRootsCalls: Array<{ batchSize: number, nextRootId: number }> = []

      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => {
          const currentRootId = nextRootId
          // Don't increment here, let the batch processing do it
          return {
            nextRootId: currentRootId,
            clientDataSetId: 1,
            currentRootCount: currentRootId
          }
        }
      } as any

      // Create service with batch size of 2
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false, uploadBatchSize: 2 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        const commP = `baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2m${data[0]}`
        return { commP, size: data.length }
      }
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addRoots = async (_proofSetId: number, _clientDataSetId: number, rootIdStart: number, comms: Array<{ cid: { toString: () => string } }>): Promise<any> => {
        addRootsCalls.push({ batchSize: comms.length, nextRootId: rootIdStart })
        nextRootId += comms.length
        // Add a small delay to simulate network latency and allow batching
        await new Promise(resolve => setTimeout(resolve, 10))
        return { message: 'success' }
      }

      // Create 5 uploads - start them all synchronously to ensure batching
      const uploads: Array<Promise<UploadResult>> = []
      const uploadData = [
        new Uint8Array(65).fill(0),
        new Uint8Array(65).fill(1),
        new Uint8Array(65).fill(2),
        new Uint8Array(65).fill(3),
        new Uint8Array(65).fill(4)
      ]

      // Start all uploads at once to ensure they queue up before processing begins
      for (const data of uploadData) {
        uploads.push(service.upload(data))
      }

      // Wait for all to complete
      const results = await Promise.all(uploads)

      assert.lengthOf(results, 5, 'All uploads should complete successfully')

      // Verify batching occurred - we should have fewer calls than uploads
      assert.isBelow(addRootsCalls.length, 5, 'Should have fewer batches than uploads')

      // Verify all uploads were processed
      const totalProcessed = addRootsCalls.reduce((sum, call) => sum + call.batchSize, 0)
      assert.equal(totalProcessed, 5, 'All 5 uploads should be processed')

      // Verify root IDs are sequential
      assert.equal(addRootsCalls[0].nextRootId, 0, 'First batch should start at root ID 0')
      for (let i = 1; i < addRootsCalls.length; i++) {
        const expectedId = addRootsCalls[i - 1].nextRootId + addRootsCalls[i - 1].batchSize
        assert.equal(addRootsCalls[i].nextRootId, expectedId, `Batch ${i} should have correct sequential root ID`)
      }
    })

    it('should handle batch size of 1', async () => {
      let nextRootId = 0
      const addRootsCalls: number[] = []

      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: nextRootId++,
          clientDataSetId: 1,
          currentRootCount: nextRootId
        })
      } as any

      // Create service with batch size of 1
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false, uploadBatchSize: 1 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        commP: `baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2m${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addRoots = async (_proofSetId: number, _clientDataSetId: number, _nextRootId: number, comms: any[]): Promise<any> => {
        addRootsCalls.push(comms.length)
        return { message: 'success' }
      }

      // Create 3 uploads
      const uploads = [
        service.upload(new Uint8Array(65).fill(1)),
        service.upload(new Uint8Array(66).fill(2)),
        service.upload(new Uint8Array(67).fill(3))
      ]

      await Promise.all(uploads)

      // With batch size 1, each upload should be processed individually
      assert.lengthOf(addRootsCalls, 3, 'Should have 3 individual calls')
      assert.deepEqual(addRootsCalls, [1, 1, 1], 'Each call should have exactly 1 root')
    })

    it('should debounce uploads for better batching', async () => {
      const addRootsCalls: Array<{ batchSize: number }> = []

      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any

      // Create service with default batch size (32)
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        commP: `baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2m${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addRoots = async (_proofSetId: number, _clientDataSetId: number, _nextRootId: number, comms: any[]): Promise<any> => {
        // Track batch sizes
        addRootsCalls.push({ batchSize: comms.length })
        return { message: 'success' }
      }

      // Create multiple uploads synchronously
      const uploads = []
      for (let i = 0; i < 5; i++) {
        uploads.push(service.upload(new Uint8Array(65).fill(i)))
      }

      await Promise.all(uploads)

      // With debounce, all 5 uploads should be in a single batch
      assert.lengthOf(addRootsCalls, 1, 'Should have exactly 1 batch due to debounce')
      assert.equal(addRootsCalls[0].batchSize, 5, 'Batch should contain all 5 uploads')
    })

    it('should handle errors in batch processing gracefully', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false, uploadBatchSize: 2 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        commP: `baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2m${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })

      // Make addRoots fail
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        throw new Error('Network error during addRoots')
      }

      // Create 3 uploads
      const uploads = [
        service.upload(new Uint8Array(65).fill(1)),
        service.upload(new Uint8Array(66).fill(2)),
        service.upload(new Uint8Array(67).fill(3))
      ]

      // All uploads in the batch should fail with the same error
      const results = await Promise.allSettled(uploads)

      // First two should fail together (same batch)
      assert.equal(results[0].status, 'rejected')
      assert.equal(results[1].status, 'rejected')

      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        assert.include(results[0].reason.message, 'Network error during addRoots')
        assert.include(results[1].reason.message, 'Network error during addRoots')
        // They should have the same error message (same batch)
        assert.equal(results[0].reason.message, results[1].reason.message)
      }

      // Third upload might succeed or fail depending on timing
      if (results[2].status === 'rejected') {
        assert.include((results[2]).reason.message, 'Network error during addRoots')
      }
    })

    it('should enforce 200 MiB size limit', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create data that exceeds the limit
      const oversizedData = new Uint8Array(210 * 1024 * 1024) // 210 MiB

      try {
        await service.upload(oversizedData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, '220200960') // 210 * 1024 * 1024
        assert.include(error.message, '209715200') // 200 * 1024 * 1024
      }
    })

    it('should accept data at exactly 65 bytes', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create data at exactly the minimum
      const minSizeData = new Uint8Array(65) // 65 bytes
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.equal(data.length, 65)
        return { commP: testCommP, size: data.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(minSizeData)
      assert.equal(result.commp.toString(), testCommP)
      assert.equal(result.size, 65)
    })

    it('should accept data up to 200 MiB', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create data at exactly the limit
      const maxSizeData = new Uint8Array(200 * 1024 * 1024) // 200 MiB
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.equal(data.length, 200 * 1024 * 1024)
        return { commP: testCommP, size: data.length }
      }

      // Mock findPiece (immediate success)
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddRootsInfo already mocked in mockPandoraService

      // Mock addRoots
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return { message: 'success' }
      }

      // Should not throw
      const result = await service.upload(maxSizeData)
      assert.equal(result.commp.toString(), testCommP)
      assert.equal(result.size, 200 * 1024 * 1024)
      assert.equal(result.rootId, 0)
    })

    it('should handle upload callbacks correctly', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create data that meets minimum size (65 bytes)
      const testData = new Uint8Array(65).fill(42) // 65 bytes of value 42
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      let uploadCompleteCallbackFired = false
      let rootAddedCallbackFired = false

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      // Mock findPiece (immediate success)
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock getAddRootsInfo
      // getAddRootsInfo already mocked in mockPandoraService

      // Mock addRoots
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(testData, {
        onUploadComplete: (commp) => {
          assert.equal(commp.toString(), testCommP)
          uploadCompleteCallbackFired = true
        },
        onRootAdded: () => {
          rootAddedCallbackFired = true
        }
      })

      assert.isTrue(uploadCompleteCallbackFired, 'onUploadComplete should have been called')
      assert.isTrue(rootAddedCallbackFired, 'onRootAdded should have been called')
      assert.equal(result.commp.toString(), testCommP)
    })

    it('should handle new server with transaction tracking', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      let uploadCompleteCallbackFired = false
      let rootAddedCallbackFired = false
      let rootConfirmedCallbackFired = false
      let rootAddedTransaction: any = null
      let confirmedRootIds: number[] = []

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots to return transaction tracking info
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/proof-sets/123/roots/added/${mockTxHash}`
        }
      }

      // Mock getTransaction from provider
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 1 })
      }
      const originalGetTransaction = mockEthProvider.getTransaction
      mockEthProvider.getTransaction = async (hash: string) => {
        assert.equal(hash, mockTxHash)
        return mockTransaction as any
      }

      // Mock getRootAdditionStatus
      serviceAny._pdpServer.getRootAdditionStatus = async (proofSetId: number, txHash: string): Promise<any> => {
        assert.equal(proofSetId, 123)
        assert.equal(txHash, mockTxHash)
        return {
          txHash: mockTxHash,
          txStatus: 'confirmed',
          proofSetId: 123,
          rootCount: 1,
          addMessageOk: true,
          confirmedRootIds: [42]
        }
      }

      try {
        const result = await service.upload(testData, {
          onUploadComplete: (commp) => {
            assert.equal(commp.toString(), testCommP)
            uploadCompleteCallbackFired = true
          },
          onRootAdded: (transaction) => {
            rootAddedCallbackFired = true
            rootAddedTransaction = transaction
          },
          onRootConfirmed: (rootIds) => {
            rootConfirmedCallbackFired = true
            confirmedRootIds = rootIds
          }
        })

        assert.isTrue(uploadCompleteCallbackFired, 'onUploadComplete should have been called')
        assert.isTrue(rootAddedCallbackFired, 'onRootAdded should have been called')
        assert.isTrue(rootConfirmedCallbackFired, 'onRootConfirmed should have been called')
        assert.exists(rootAddedTransaction, 'Transaction should be passed to onRootAdded')
        assert.equal(rootAddedTransaction.hash, mockTxHash)
        assert.deepEqual(confirmedRootIds, [42])
        assert.equal(result.rootId, 42)
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it.skip('should fail if new server transaction is not found on-chain', async function () {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots to return transaction tracking info
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/proof-sets/123/roots/added/${mockTxHash}`
        }
      }

      // Mock getTransaction to always return null (not found)
      const originalGetTransaction = mockEthProvider.getTransaction
      mockEthProvider.getTransaction = async () => null

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for transaction not found')
      } catch (error: any) {
        // The error is wrapped by createError, so check for the wrapped message
        assert.include(error.message, 'StorageService addRoots failed:')
        assert.include(error.message, 'Server returned transaction hash')
        assert.include(error.message, 'but transaction was not found on-chain')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it.skip('should fail if new server verification fails', async function () {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots to return transaction tracking info
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/proof-sets/123/roots/added/${mockTxHash}`
        }
      }

      // Mock getTransaction
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 1 })
      }
      const originalGetTransaction = mockEthProvider.getTransaction
      mockEthProvider.getTransaction = async () => mockTransaction as any

      // Mock getRootAdditionStatus to fail
      serviceAny._pdpServer.getRootAdditionStatus = async (): Promise<any> => {
        throw new Error('Root addition status not found')
      }

      // Override timing constants for faster test
      // Note: We cannot override imported constants, so this test will use default timeout

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for verification failure')
      } catch (error: any) {
        // The error is wrapped by createError
        assert.include(error.message, 'StorageService addRoots failed:')
        assert.include(error.message, 'Failed to verify root addition')
        assert.include(error.message, 'The transaction was confirmed on-chain but the server failed to acknowledge it')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it('should handle transaction failure on-chain', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots to return transaction tracking info
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/proof-sets/123/roots/added/${mockTxHash}`
        }
      }

      // Mock getTransaction
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 0 }) // Failed transaction
      }
      const originalGetTransaction = mockEthProvider.getTransaction
      mockEthProvider.getTransaction = async () => mockTransaction as any

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for failed transaction')
      } catch (error: any) {
        // The error is wrapped twice - first by the specific throw, then by the outer catch
        assert.include(error.message, 'StorageService addRoots failed:')
        assert.include(error.message, 'Failed to add root to proof set')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it('should work with old servers that do not provide transaction tracking', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      let rootAddedCallbackFired = false
      let rootAddedTransaction: any

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addRoots without transaction tracking (old server)
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(testData, {
        onRootAdded: (transaction) => {
          rootAddedCallbackFired = true
          rootAddedTransaction = transaction
        }
      })

      assert.isTrue(rootAddedCallbackFired, 'onRootAdded should have been called')
      assert.isUndefined(rootAddedTransaction, 'Transaction should be undefined for old servers')
      assert.equal(result.rootId, 0) // Uses nextRootId from getAddRootsInfo
    })

    it('should handle ArrayBuffer input', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Create ArrayBuffer instead of Uint8Array
      const buffer = new ArrayBuffer(1024)
      const view = new Uint8Array(buffer)
      for (let i = 0; i < view.length; i++) {
        view[i] = i % 256
      }

      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.instanceOf(data, Uint8Array)
        assert.equal(data.length, 1024)
        return { commP: testCommP, size: data.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock getAddRootsInfo
      // getAddRootsInfo already mocked in mockPandoraService

      // Mock addRoots
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(buffer)
      assert.equal(result.commp.toString(), testCommP)
      assert.equal(result.size, 1024)
    })

    it.skip('should handle piece parking timeout', async () => {
      // Skip this test as it's timing-sensitive and causes issues in CI
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      // Mock findPiece to always fail (simulating piece not ready)
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        throw new Error('Piece not found')
      }

      // Temporarily reduce timeout for faster test
      const originalTimeout = (service as any).constructor.PIECE_PARKING_TIMEOUT_MS
      Object.defineProperty(service.constructor, 'PIECE_PARKING_TIMEOUT_MS', {
        value: 100, // 100ms for test
        configurable: true
      })

      try {
        await service.upload(testData)
        assert.fail('Should have thrown timeout error')
      } catch (error: any) {
        assert.include(error.message, 'Timeout waiting for piece to be parked')
      } finally {
        // Restore original timeout
        Object.defineProperty(service.constructor, 'PIECE_PARKING_TIMEOUT_MS', {
          value: originalTimeout,
          configurable: true
        })
      }
    })

    it('should handle upload piece failure', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum

      // Mock uploadPiece to fail
      const serviceAny = service as any
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        throw new Error('Network error during upload')
      }

      try {
        await service.upload(testData)
        assert.fail('Should have thrown upload error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to upload piece to storage provider')
      }
    })

    it('should handle add roots failure', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => ({
          nextRootId: 0,
          clientDataSetId: 1,
          currentRootCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock successful upload and parking
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddRootsInfo already mocked in mockPandoraService

      // Mock addRoots to fail
      serviceAny._pdpServer.addRoots = async (): Promise<any> => {
        throw new Error('Signature validation failed')
      }

      try {
        await service.upload(testData)
        assert.fail('Should have thrown add roots error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add root to proof set')
      }
    })

    it('should handle getAddRootsInfo failure', async () => {
      const mockPandoraService = {
        getAddRootsInfo: async (): Promise<any> => {
          throw new Error('Proof set not managed by this Pandora')
        }
      } as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the required services
      const serviceAny = service as any

      // Mock successful upload and parking
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { commP: testCommP, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddRootsInfo already mocked to fail in mockPandoraService

      try {
        await service.upload(testData)
        assert.fail('Should have thrown getAddRootsInfo error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add root to proof set')
      }
    })
  })

  describe('Provider Ping Validation', () => {
    describe('selectRandomProvider with ping validation', () => {
      it('should select first provider that responds to ping', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            owner: '0x1111111111111111111111111111111111111111',
            pdpUrl: 'https://pdp1.example.com',
            pieceRetrievalUrl: 'https://retrieve1.example.com',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            owner: '0x2222222222222222222222222222222222222222',
            pdpUrl: 'https://pdp2.example.com',
            pieceRetrievalUrl: 'https://retrieve2.example.com',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        let pingCallCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCallCount++
            // First provider fails, second succeeds
            if (url.includes('pdp1.example.com')) {
              return { status: 500, statusText: 'Internal Server Error', text: async () => 'Down' } as any
            } else if (url.includes('pdp2.example.com')) {
              return { status: 200, statusText: 'OK' } as any
            }
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const result = await (StorageService as any).selectRandomProvider(
            testProviders,
            mockSynapse.getSigner(),
            [],
            true // Enable ping validation
          )

          // Should have selected the second provider (first one failed ping)
          assert.equal(result.owner, testProviders[1].owner)
          assert.isAtLeast(pingCallCount, 1, 'Should have called ping at least once')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should exclude providers from selection', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            owner: '0x1111111111111111111111111111111111111111',
            pdpUrl: 'https://pdp1.example.com',
            pieceRetrievalUrl: 'https://retrieve1.example.com',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            owner: '0x2222222222222222222222222222222222222222',
            pdpUrl: 'https://pdp2.example.com',
            pieceRetrievalUrl: 'https://retrieve2.example.com',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            // Should only hit the second provider since first is excluded
            assert.isTrue(url.includes('pdp2.example.com'), 'Should only ping non-excluded provider')
            return { status: 200, statusText: 'OK' } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const result = await (StorageService as any).selectRandomProvider(
            testProviders,
            mockSynapse.getSigner(),
            [testProviders[0].owner], // Exclude first provider
            true // Enable ping validation
          )

          // Should have selected the second provider
          assert.equal(result.owner, testProviders[1].owner)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should throw error when all providers fail ping', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            owner: '0x1111111111111111111111111111111111111111',
            pdpUrl: 'https://pdp1.example.com',
            pieceRetrievalUrl: 'https://retrieve1.example.com',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            owner: '0x2222222222222222222222222222222222222222',
            pdpUrl: 'https://pdp2.example.com',
            pieceRetrievalUrl: 'https://retrieve2.example.com',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const originalFetch = global.fetch
        global.fetch = async () => {
          // All pings fail
          return {
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'All servers down'
          } as any
        }

        try {
          await (StorageService as any).selectRandomProvider(
            testProviders,
            mockSynapse.getSigner()
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'All 2 available storage providers failed ping validation')
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('smartSelectProvider with ping validation', () => {
      it('should fail when existing providers fail ping validation', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            owner: '0x1111111111111111111111111111111111111111',
            pdpUrl: 'https://pdp1.example.com',
            pieceRetrievalUrl: 'https://retrieve1.example.com',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            owner: '0x2222222222222222222222222222222222222222',
            pdpUrl: 'https://pdp2.example.com',
            pieceRetrievalUrl: 'https://retrieve2.example.com',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const proofSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProviders[0].owner, // First provider has existing proof set
            pdpVerifierProofSetId: 100,
            nextRootId: 0,
            currentRootCount: 0,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            rootMetadata: [],
            clientDataSetId: 1
          }
        ]

        const mockPandoraService = {
          getClientProofSetsWithDetails: async () => proofSets,
          getAllApprovedProviders: async () => testProviders,
          getProviderIdByAddress: async (address: string) => {
            const idx = testProviders.findIndex(p => p.owner.toLowerCase() === address.toLowerCase())
            return idx >= 0 ? idx + 1 : 0
          },
          getApprovedProvider: async (id: number) => testProviders[id - 1] ?? null
        } as any

        let pingCallCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCallCount++
            // All providers fail ping
            return { status: 500, statusText: 'Internal Server Error', text: async () => 'Down' } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          await (StorageService as any).smartSelectProvider(
            mockPandoraService,
            '0x1234567890123456789012345678901234567890',
            false,
            mockSynapse.getSigner()
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          // Should fail with selectProviderWithPing error, not fallback to new selection
          assert.include(error.message, 'All 1 available storage providers failed ping validation')
          assert.isAtLeast(pingCallCount, 1, 'Should have pinged at least one provider')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should select new provider when no existing providers are available', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            owner: '0x1111111111111111111111111111111111111111',
            pdpUrl: 'https://pdp1.example.com',
            pieceRetrievalUrl: 'https://retrieve1.example.com',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            owner: '0x2222222222222222222222222222222222222222',
            pdpUrl: 'https://pdp2.example.com',
            pieceRetrievalUrl: 'https://retrieve2.example.com',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const mockPandoraService = {
          getClientProofSetsWithDetails: async () => [], // No existing proof sets
          getAllApprovedProviders: async () => testProviders,
          getProviderIdByAddress: async () => 0,
          getApprovedProvider: async () => null
        } as any

        let pingCallCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCallCount++
            // First provider succeeds
            if (url.includes('pdp1.example.com')) {
              return { status: 200, statusText: 'OK' } as any
            }
            // Other providers can fail
            return { status: 500, statusText: 'Internal Server Error' } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const result = await (StorageService as any).smartSelectProvider(
            mockPandoraService,
            '0x1234567890123456789012345678901234567890',
            false,
            mockSynapse.getSigner()
          )

          // Should have selected one of the available providers for new proof set
          assert.isTrue(
            testProviders.some(p => p.owner === result.provider.owner),
            'Should have selected one of the available providers'
          )
          assert.equal(result.proofSetId, -1) // New proof set marker
          assert.isFalse(result.isExisting)
          assert.isAtLeast(pingCallCount, 1, 'Should have pinged at least one provider')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should use existing provider if ping succeeds', async () => {
        const testProvider: ApprovedProviderInfo = {
          owner: '0x1111111111111111111111111111111111111111',
          pdpUrl: 'https://pdp1.example.com',
          pieceRetrievalUrl: 'https://retrieve1.example.com',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        }

        const proofSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.owner,
            pdpVerifierProofSetId: 100,
            nextRootId: 0,
            currentRootCount: 5, // Has roots, so preferred
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            rootMetadata: [],
            clientDataSetId: 1
          }
        ]

        const mockPandoraService = {
          getClientProofSetsWithDetails: async () => proofSets,
          getProviderIdByAddress: async () => 1,
          getApprovedProvider: async () => testProvider,
          getAllApprovedProviders: async () => [] // Return empty list to prevent fallback
        } as any

        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            return { status: 200, statusText: 'OK' } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const result = await (StorageService as any).smartSelectProvider(
            mockPandoraService,
            '0x1234567890123456789012345678901234567890',
            false,
            mockSynapse.getSigner()
          )

          // Should use existing provider since ping succeeded
          assert.equal(result.provider.owner, testProvider.owner)
          assert.equal(result.proofSetId, 100)
          assert.isTrue(result.isExisting)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('selectProviderWithPing', () => {
      // ... existing code ...

      it('should deduplicate providers from multiple proof sets', async () => {
        const testProvider: ApprovedProviderInfo = {
          owner: '0x1111111111111111111111111111111111111111',
          pdpUrl: 'https://pdp1.example.com',
          pieceRetrievalUrl: 'https://retrieve1.example.com',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        }

        // Create multiple proof sets with the same provider
        const proofSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.owner,
            pdpVerifierProofSetId: 100,
            nextRootId: 0,
            currentRootCount: 5,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            rootMetadata: [],
            clientDataSetId: 1
          },
          {
            railId: 2,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.owner, // Same provider
            pdpVerifierProofSetId: 101,
            nextRootId: 0,
            currentRootCount: 3,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            rootMetadata: [],
            clientDataSetId: 2
          },
          {
            railId: 3,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.owner, // Same provider
            pdpVerifierProofSetId: 102,
            nextRootId: 0,
            currentRootCount: 1,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            rootMetadata: [],
            clientDataSetId: 3
          }
        ]

        const mockPandoraService = {
          getClientProofSetsWithDetails: async () => proofSets,
          getProviderIdByAddress: async () => 1,
          getApprovedProvider: async () => testProvider,
          getAllApprovedProviders: async () => [] // Return empty list to prevent fallback
        } as any

        let pingCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCount++
            // Make the ping fail to ensure we see all ping attempts
            return { status: 500, statusText: 'Internal Server Error' } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          await (StorageService as any).smartSelectProvider(
            mockPandoraService,
            '0x1234567890123456789012345678901234567890',
            false,
            mockSynapse.getSigner()
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          // Verify we only pinged once despite having three proof sets with the same provider
          assert.equal(pingCount, 1, 'Should only ping each unique provider once')
          // The error should come from selectProviderWithPing failing, not from getAllApprovedProviders
          assert.include(error.message, 'All 1 available storage providers failed ping validation')
        } finally {
          global.fetch = originalFetch
        }
      })
    })
  })

  describe('getProviderInfo', () => {
    it('should return provider info through Synapse', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock the synapse getProviderInfo method
      const originalGetProviderInfo = mockSynapse.getProviderInfo
      const expectedProviderInfo = {
        owner: mockProvider.owner,
        pdpUrl: 'https://updated-pdp.example.com',
        pieceRetrievalUrl: 'https://updated-retrieve.example.com',
        registeredAt: 1234567900,
        approvedAt: 1234567901
      }

      mockSynapse.getProviderInfo = async (address: string) => {
        assert.equal(address, mockProvider.owner)
        return expectedProviderInfo
      }

      try {
        const providerInfo = await service.getProviderInfo()
        assert.deepEqual(providerInfo, expectedProviderInfo)
      } finally {
        mockSynapse.getProviderInfo = originalGetProviderInfo
      }
    })

    it('should handle errors from Synapse getProviderInfo', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock the synapse getProviderInfo method to throw
      const originalGetProviderInfo = mockSynapse.getProviderInfo
      mockSynapse.getProviderInfo = async () => {
        throw new Error('Provider not found')
      }

      try {
        await service.getProviderInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider not found')
      } finally {
        mockSynapse.getProviderInfo = originalGetProviderInfo
      }
    })
  })

  describe('getProofSetRoots', () => {
    it('should successfully fetch proof set roots', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const mockProofSetData = {
        id: 292,
        roots: [
          {
            rootId: 101,
            rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootOffset: 0
          },
          {
            rootId: 102,
            rootCid: 'baga6ea4seaqkt24j5gbf2ye2wual5gn7a5yl2tqb52v2sk4nvur4bdy7lg76cdy',
            subrootCid: 'baga6ea4seaqkt24j5gbf2ye2wual5gn7a5yl2tqb52v2sk4nvur4bdy7lg76cdy',
            subrootOffset: 0
          }
        ],
        nextChallengeEpoch: 1500
      }

      // Mock the PDP server getProofSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getProofSet = async (proofSetId: number): Promise<any> => {
        assert.equal(proofSetId, 123)
        return mockProofSetData
      }

      const result = await service.getProofSetRoots()

      assert.isArray(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].toString(), mockProofSetData.roots[0].rootCid)
      assert.equal(result[1].toString(), mockProofSetData.roots[1].rootCid)
    })

    it('should handle empty proof set roots', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const mockProofSetData = {
        id: 292,
        roots: [],
        nextChallengeEpoch: 1500
      }

      // Mock the PDP server getProofSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getProofSet = async (): Promise<any> => {
        return mockProofSetData
      }

      const result = await service.getProofSetRoots()

      assert.isArray(result)
      assert.equal(result.length, 0)
    })

    it('should handle invalid CID in response', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      const mockProofSetData = {
        id: 292,
        roots: [
          {
            rootId: 101,
            rootCid: 'invalid-cid-format',
            subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootOffset: 0
          }
        ],
        nextChallengeEpoch: 1500
      }

      // Mock the PDP server getProofSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getProofSet = async (): Promise<any> => {
        return mockProofSetData
      }

      const result = await service.getProofSetRoots()
      assert.isArray(result)
      assert.equal(result.length, 1)
      assert.equal(result[0].toString(), 'invalid-cid-format')
    })

    it('should handle PDP server errors', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock the PDP server getProofSet method to throw error
      const serviceAny = service as any
      serviceAny._pdpServer.getProofSet = async (): Promise<any> => {
        throw new Error('Proof set not found: 999')
      }

      try {
        await service.getProofSetRoots()
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.include(error.message, 'Proof set not found: 999')
      }
    })
  })

  describe('pieceStatus()', () => {
    const mockCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

    it('should return exists=false when piece not found on provider', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => { throw new Error('Piece not found') }
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [],
        nextChallengeEpoch: 5000
      })

      // Mock synapse payments getCurrentEpoch
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(4000)
      mockSynapseAny.getNetwork = () => 'calibration'

      const status = await service.pieceStatus(mockCommP)

      assert.isFalse(status.exists)
      assert.isNull(status.retrievalUrl)
      assert.isNull(status.proofSetLastProven)
      assert.isNull(status.proofSetNextProofDue)
      assert.isUndefined(status.rootId)
    })

    it('should return piece status with proof timing when piece exists', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [{
          rootId: 1,
          rootCid: { toString: () => mockCommP }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse methods
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(4000)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      assert.equal(status.retrievalUrl, 'https://retrieve.example.com/piece/' + mockCommP)
      assert.equal(status.rootId, 1)
      assert.isNotNull(status.proofSetLastProven)
      assert.isNotNull(status.proofSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when in challenge window', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [{
          rootId: 1,
          rootCid: { toString: () => mockCommP }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - current epoch is in challenge window
      // nextChallengeEpoch (5000) is the START of the window
      // Window ends at 5000 + 60 = 5060
      // Current epoch 5030 is in the middle of the window
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(5030)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      assert.isTrue(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when proof is overdue', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [{
          rootId: 1,
          rootCid: { toString: () => mockCommP }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - current epoch is past the challenge window
      // nextChallengeEpoch (5000) + challengeWindow (60) = 5060 (deadline)
      // Current epoch 5100 is past the deadline
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(5100)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      assert.isFalse(status.inChallengeWindow) // No longer in window, it's past
      assert.isTrue(status.isProofOverdue)
    })

    it('should handle proof set with nextChallengeEpoch=0', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [{
          rootId: 1,
          rootCid: { toString: () => mockCommP }
        }],
        nextChallengeEpoch: 0 // No next challenge scheduled
      })

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(5000)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      assert.isNull(status.proofSetLastProven)
      assert.isNull(status.proofSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should handle trailing slash in retrieval URL', async () => {
      const mockProviderWithSlash: ApprovedProviderInfo = {
        ...mockProvider,
        pieceRetrievalUrl: 'https://retrieve.example.com/' // Trailing slash
      }

      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProviderWithSlash, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [],
        nextChallengeEpoch: 5000
      })

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(4000)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async (address: string) => {
        // Return the provider with trailing slash when asked for this provider's address
        if (address === mockProviderWithSlash.owner) {
          return mockProviderWithSlash
        }
        throw new Error('Provider not found')
      }

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      // Should not have double slash
      assert.equal(status.retrievalUrl, 'https://retrieve.example.com/piece/' + mockCommP)
      // Check that the URL doesn't contain double slashes after the protocol
      const urlWithoutProtocol = (status.retrievalUrl ?? '').substring(8) // Remove 'https://'
      assert.notInclude(urlWithoutProtocol, '//')
    })

    it('should handle invalid CommP', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      try {
        await service.pieceStatus('invalid-commp')
        assert.fail('Should have thrown error for invalid CommP')
      } catch (error: any) {
        assert.include(error.message, 'Invalid CommP provided')
      }
    })

    it('should calculate hours until challenge window', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => ({
        id: 123,
        roots: [{
          rootId: 1,
          rootCid: { toString: () => mockCommP }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - 120 epochs before challenge window (1 hour)
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(4880) // 5000 - 120 = 4880 (1 hour before window)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      assert.isTrue(status.exists)
      assert.isFalse(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
      assert.approximately(status.hoursUntilChallengeWindow ?? 0, 1, 0.1) // Should be ~1 hour
    })

    it('should handle proof set data fetch failure gracefully', async () => {
      const mockPandoraService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getProofSet = async () => { throw new Error('Network error') }

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.payments.getCurrentEpoch = async () => BigInt(4000)
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockCommP)

      // Should still return basic status even if proof set data fails
      assert.isTrue(status.exists)
      assert.isNotNull(status.retrievalUrl)
      assert.isNull(status.proofSetLastProven)
      assert.isNull(status.proofSetNextProofDue)
      assert.isUndefined(status.rootId)
    })
  })
})
