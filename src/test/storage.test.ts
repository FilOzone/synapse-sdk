/* globals describe it */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { StorageService } from '../storage/service.js'
import { Synapse } from '../synapse.js'
import type { ApprovedProviderInfo } from '../types.js'

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => new ethers.JsonRpcProvider(),
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

      // Create storage service without specifying providerId
      const service = await StorageService.create(mockSynapse, mockPandoraService, {})

      // Should have selected one of the providers
      assert.isTrue(
        service.storageProvider === mockProviders[0].owner ||
        service.storageProvider === mockProviders[1].owner
      )
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

      // Test with CDN = false
      const serviceNoCDN = await StorageService.create(mockSynapse, mockPandoraService, { withCDN: false })
      assert.equal(serviceNoCDN.proofSetId, '200', 'Should select non-CDN proof set')

      // Test with CDN = true
      const serviceWithCDN = await StorageService.create(mockSynapse, mockPandoraService, { withCDN: true })
      assert.equal(serviceWithCDN.proofSetId, '201', 'Should select CDN proof set')
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

      const service = await StorageService.create(mockSynapse, mockPandoraService, {})

      assert.isTrue(getClientProofSetsCalled, 'Should fetch client proof sets')
      assert.isFalse(getAllApprovedProvidersCalled, 'Should NOT fetch all providers')
      assert.equal(service.proofSetId, '500')
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
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the PDPServer downloadPiece method
      const serviceAny = service as any
      const originalDownload = serviceAny._pdpServer.downloadPiece
      serviceAny._pdpServer.downloadPiece = async (commp: string): Promise<Uint8Array> => {
        assert.equal(commp, testCommP)
        return testData
      }

      try {
        const downloaded = await service.download(testCommP)
        assert.deepEqual(downloaded, testData)
      } finally {
        // Restore original method
        serviceAny._pdpServer.downloadPiece = originalDownload
      }
    })

    it('should handle download errors', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the PDPServer downloadPiece method to throw error
      const serviceAny = service as any
      const originalDownload = serviceAny._pdpServer.downloadPiece
      serviceAny._pdpServer.downloadPiece = async (): Promise<Uint8Array> => {
        throw new Error('Network error')
      }

      try {
        await service.download(testCommP)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Failed to download piece from storage provider')
      } finally {
        // Restore original method
        serviceAny._pdpServer.downloadPiece = originalDownload
      }
    })

    it('should accept empty download options', async () => {
      const mockPandoraService = {} as any
      const service = new StorageService(mockSynapse, mockPandoraService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testCommP = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'

      // Mock the PDPServer downloadPiece method
      const serviceAny = service as any
      const originalDownload = serviceAny._pdpServer.downloadPiece
      serviceAny._pdpServer.downloadPiece = async (): Promise<Uint8Array> => {
        return testData
      }

      try {
        // Test with and without empty options object
        const downloaded1 = await service.download(testCommP)
        assert.deepEqual(downloaded1, testData)

        const downloaded2 = await service.download(testCommP, {})
        assert.deepEqual(downloaded2, testData)
      } finally {
        // Restore original method
        serviceAny._pdpServer.downloadPiece = originalDownload
      }
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
      assert.equal(result.commp, testCommP)
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
      assert.equal(result.commp, testCommP)
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
          assert.equal(commp, testCommP)
          uploadCompleteCallbackFired = true
        },
        onRootAdded: () => {
          rootAddedCallbackFired = true
        }
      })

      assert.isTrue(uploadCompleteCallbackFired, 'onUploadComplete should have been called')
      assert.isTrue(rootAddedCallbackFired, 'onRootAdded should have been called')
      assert.equal(result.commp, testCommP)
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
      assert.equal(result.commp, testCommP)
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
})
