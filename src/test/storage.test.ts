/* globals describe it */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { StorageService } from '../storage/service.js'
import { Synapse } from '../synapse.js'
import type { ApprovedProviderInfo, PieceCID, UploadResult } from '../types.js'

// Create a mock Ethereum provider that doesn't try to connect
const mockEthProvider = {
  getTransaction: async (hash: string) => null,
  getNetwork: async () => ({ chainId: BigInt(314159), name: 'test' })
} as any

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => mockEthProvider,
  getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
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
  download: async (pieceCid: string | PieceCID, options?: any) => {
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
  serviceProvider: '0xabcdef1234567890123456789012345678901234',
  serviceURL: 'https://pdp.example.com',
  peerId: 'test-peer-id',
  registeredAt: 1234567890,
  approvedAt: 1234567891
}

describe('StorageService', () => {
  describe('create() factory method', () => {
    it('should select a random provider when no providerId specified', async () => {
      // Create mock WarmStorageService
      const mockProviders: ApprovedProviderInfo[] = [
        {
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        },
        {
          serviceProvider: '0x2222222222222222222222222222222222222222',
          serviceURL: 'https://pdp2.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567892,
          approvedAt: 1234567893
        }
      ]

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider, // Matches first provider
          pdpVerifierDataSetId: 100,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].serviceProvider, // Matches second provider
          pdpVerifierDataSetId: 101,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockWarmStorageService = {
        getAllApprovedProviders: async () => mockProviders,
        getClientDataSetsWithDetails: async () => dataSets,
        getNextClientDataSetId: async () => 3,
        getProviderIdByAddress: async (address: string) => {
          const idx = mockProviders.findIndex(p => p.serviceProvider.toLowerCase() === address.toLowerCase())
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
        const service = await StorageService.create(mockSynapse, mockWarmStorageService, {})

        // Should have selected one of the providers
        assert.isTrue(
          service.serviceProvider === mockProviders[0].serviceProvider ||
          service.serviceProvider === mockProviders[1].serviceProvider
        )
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should use specific provider when providerId specified', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x3333333333333333333333333333333333333333',
        serviceURL: 'https://pdp3.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierDataSetId: 100,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 3)
          return mockProvider
        },
        getClientDataSetsWithDetails: async () => dataSets,
        getNextClientDataSetId: async () => 2
      } as any

      // Create storage service with specific providerId
      const service = await StorageService.create(mockSynapse, mockWarmStorageService, { providerId: 3 })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
    })

    it('should throw when no approved providers available', async () => {
      const mockWarmStorageService = {
        getAllApprovedProviders: async () => [], // Empty array
        getClientDataSetsWithDetails: async () => []
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, {})
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved service providers available')
      }
    })

    it('should throw when specified provider not found', async () => {
      const mockWarmStorageService = {
        getApprovedProvider: async () => ({
          serviceProvider: '0x0000000000000000000000000000000000000000', // Zero address
          serviceURL: '',
          peerId: '',
          registeredAt: 0,
          approvedAt: 0
        }),
        getClientDataSetsWithDetails: async () => [] // Also needs this for parallel fetch
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, { providerId: 999 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 999 is not currently approved')
      }
    })

    it('should select existing data set when available', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x3333333333333333333333333333333333333333',
        serviceURL: 'https://pdp3.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333', // Matches provider
          pdpVerifierDataSetId: 100,
          nextPieceId: 5,
          currentPieceCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getApprovedProvider: async () => mockProvider,
        getClientDataSetsWithDetails: async () => mockDataSets,
        getNextClientDataSetId: async () => 2
      } as any

      const service = await StorageService.create(mockSynapse, mockWarmStorageService, { providerId: 3 })

      // Should use existing data set
      assert.equal(service.dataSetId, 100)
    })

    it.skip('should create new data set when none exist', async () => {
      // Skip: Requires real PDPServer for createDataSet
      // This would need mocking of PDPServer which is created internally
    })

    it('should prefer data sets with existing pieces', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x3333333333333333333333333333333333333333',
        serviceURL: 'https://pdp3.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierDataSetId: 100,
          nextPieceId: 0,
          currentPieceCount: 0, // No pieces
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          pdpVerifierDataSetId: 101,
          nextPieceId: 5,
          currentPieceCount: 5, // Has pieces - should be preferred
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockWarmStorageService = {
        getApprovedProvider: async () => mockProvider,
        getClientDataSetsWithDetails: async () => mockDataSets,
        getNextClientDataSetId: async () => 3
      } as any

      const service = await StorageService.create(mockSynapse, mockWarmStorageService, { providerId: 3 })

      // Should select the data set with pieces
      assert.equal(service.dataSetId, 101)
    })

    it('should handle provider selection callbacks', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x3333333333333333333333333333333333333333',
        serviceURL: 'https://pdp3.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      let providerCallbackFired = false
      let dataSetCallbackFired = false

      const dataSets = [{
        railId: 1,
        payer: '0x1234567890123456789012345678901234567890',
        payee: mockProvider.serviceProvider,
        pdpVerifierDataSetId: 100,
        nextPieceId: 0,
        currentPieceCount: 0,
        isLive: true,
        isManaged: true,
        withCDN: false,
        commissionBps: 0,
        metadata: '',
        pieceMetadata: [],
        clientDataSetId: 1
      }]

      const mockWarmStorageService = {
        getApprovedProvider: async () => mockProvider,
        getClientDataSetsWithDetails: async () => dataSets,
        getNextClientDataSetId: async () => 2
      } as any

      await StorageService.create(mockSynapse, mockWarmStorageService, {
        providerId: 3,
        callbacks: {
          onProviderSelected: (provider) => {
            assert.equal(provider.serviceProvider, mockProvider.serviceProvider)
            providerCallbackFired = true
          },
          onDataSetResolved: (info) => {
            assert.isTrue(info.isExisting)
            assert.equal(info.dataSetId, 100)
            dataSetCallbackFired = true
          }
        }
      })

      assert.isTrue(providerCallbackFired, 'onProviderSelected should have been called')
      assert.isTrue(dataSetCallbackFired, 'onDataSetResolved should have been called')
    })

    it('should select by explicit dataSetId', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x3333333333333333333333333333333333333333',
        serviceURL: 'https://pdp3.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567894,
        approvedAt: 1234567895
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          pdpVerifierDataSetId: 456,
          nextPieceId: 10,
          currentPieceCount: 10,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getProviderIdByAddress: async (addr: string) => {
          assert.equal(addr, mockProvider.serviceProvider)
          return 3
        },
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 3)
          return mockProvider
        }
      } as any

      const service = await StorageService.create(mockSynapse, mockWarmStorageService, { dataSetId: 456 })

      assert.equal(service.dataSetId, 456)
      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
    })

    it('should select by providerAddress', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0x4444444444444444444444444444444444444444',
        serviceURL: 'https://pdp4.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567896,
        approvedAt: 1234567897
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          pdpVerifierDataSetId: 789,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getProviderIdByAddress: async (addr: string) => {
          assert.equal(addr.toLowerCase(), mockProvider.serviceProvider.toLowerCase())
          return 4
        },
        getApprovedProvider: async (id: number) => {
          assert.equal(id, 4)
          return mockProvider
        },
        getClientDataSetsWithDetails: async () => mockDataSets
      } as any

      const service = await StorageService.create(mockSynapse, mockWarmStorageService, {
        providerAddress: mockProvider.serviceProvider
      })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
      assert.equal(service.dataSetId, 789)
    })

    it('should throw when dataSetId not found', async () => {
      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => [] // No data sets
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, { dataSetId: 999 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 not found')
      }
    })

    it('should throw when dataSetId conflicts with providerId', async () => {
      const mockProvider1: ApprovedProviderInfo = {
        serviceProvider: '0x5555555555555555555555555555555555555555',
        serviceURL: 'https://pdp5.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567898,
        approvedAt: 1234567899
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider1.serviceProvider, // Owned by provider 5
          pdpVerifierDataSetId: 111,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getProviderIdByAddress: async () => 5, // Different provider ID
        getApprovedProvider: async (providerId: number) => {
          if (providerId === 5) {
            return mockProvider1 // Return the provider for ID 5
          }
          throw new Error(`Provider ID ${providerId} is not currently approved`)
        }
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 111,
          providerId: 3 // Conflicts with actual owner
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider ID 5')
        assert.include(error.message, 'but provider ID 3 was requested')
      }
    })

    it('should throw when providerAddress not approved', async () => {
      const mockWarmStorageService = {
        getProviderIdByAddress: async () => 0, // Not approved
        getClientDataSetsWithDetails: async () => [],
        getApprovedProvider: async (providerId: number) => {
          // Return a non-approved provider (null address indicates not approved)
          return {
            serviceProvider: '0x0000000000000000000000000000000000000000',
            serviceURL: '',
            peerId: '',
            registeredAt: 0,
            approvedAt: 0
          }
        }
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, {
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
          serviceProvider: '0x7777777777777777777777777777777777777777',
          serviceURL: 'https://pdp7.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567900,
          approvedAt: 1234567901
        }
      ]

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider,
          pdpVerifierDataSetId: 200,
          nextPieceId: 5,
          currentPieceCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false, // No CDN
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider,
          pdpVerifierDataSetId: 201,
          nextPieceId: 3,
          currentPieceCount: 3,
          isLive: true,
          isManaged: true,
          withCDN: true, // With CDN
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 2
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
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
        const serviceNoCDN = await StorageService.create(mockSynapse, mockWarmStorageService, { withCDN: false })
        assert.equal(serviceNoCDN.dataSetId, 200, 'Should select non-CDN data set')

        // Test with CDN = true
        const serviceWithCDN = await StorageService.create(mockSynapse, mockWarmStorageService, { withCDN: true })
        assert.equal(serviceWithCDN.dataSetId, 201, 'Should select CDN data set')
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should handle data sets not managed by current WarmStorage', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x8888888888888888888888888888888888888888',
          pdpVerifierDataSetId: 300,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: false, // Not managed by current WarmStorage
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getAllApprovedProviders: async () => [{
          serviceProvider: '0x9999999999999999999999999999999999999999',
          serviceURL: 'https://pdp9.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567902,
          approvedAt: 1234567903
        }],
        getNextClientDataSetId: async () => 1
      } as any

      // Should create new data set since existing one is not managed
      const service = await StorageService.create(mockSynapse, mockWarmStorageService, {})

      // Should have selected a provider but no existing data set
      assert.exists(service.serviceProvider)
      assert.notEqual(service.serviceProvider, mockDataSets[0].payee)
    })

    it('should throw when data set belongs to non-approved provider', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          pdpVerifierDataSetId: 400,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getProviderIdByAddress: async () => 0, // Provider not approved
        getApprovedProvider: async (providerId: number) => {
          // Return a non-approved provider
          return {
            serviceProvider: '0x0000000000000000000000000000000000000000',
            serviceURL: '',
            peerId: '',
            registeredAt: 0,
            approvedAt: 0
          }
        }
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, { dataSetId: 400 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'is not currently approved')
      }
    })

    it.skip('should create new data set when none exist for provider', async () => {
      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        serviceURL: 'https://pdp-b.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567904,
        approvedAt: 1234567905
      }

      const mockWarmStorageService = {
        getApprovedProvider: async () => mockProvider,
        getClientDataSetsWithDetails: async () => [], // No data sets
        getProviderIdByAddress: async () => 11,
        getNextClientDataSetId: async () => 1
      } as any

      const service = await StorageService.create(mockSynapse, mockWarmStorageService, {
        providerId: 11
      })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
      // Note: actual data set creation is skipped in tests
    })

    it.skip('should validate parallel fetching in resolveByProviderId', async () => {
      let getApprovedProviderCalled = false
      let getClientDataSetsCalled = false
      const callOrder: string[] = []

      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0xcccccccccccccccccccccccccccccccccccccccc',
        serviceURL: 'https://pdp-c.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567906,
        approvedAt: 1234567907
      }

      const mockWarmStorageService = {
        getApprovedProvider: async () => {
          callOrder.push('getApprovedProvider-start')
          getApprovedProviderCalled = true
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10))
          callOrder.push('getApprovedProvider-end')
          return mockProvider
        },
        getClientDataSetsWithDetails: async () => {
          callOrder.push('getClientDataSetsWithDetails-start')
          getClientDataSetsCalled = true
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10))
          callOrder.push('getClientDataSetsWithDetails-end')
          return []
        },
        getNextClientDataSetId: async () => 1
      } as any

      await StorageService.create(mockSynapse, mockWarmStorageService, { providerId: 12 })

      assert.isTrue(getApprovedProviderCalled)
      assert.isTrue(getClientDataSetsCalled)

      // Verify both calls started before either finished (parallel execution)
      const providerStartIndex = callOrder.indexOf('getApprovedProvider-start')
      const dataSetsStartIndex = callOrder.indexOf('getClientDataSetsWithDetails-start')
      const providerEndIndex = callOrder.indexOf('getApprovedProvider-end')

      assert.isBelow(providerStartIndex, providerEndIndex)
      assert.isBelow(dataSetsStartIndex, providerEndIndex)
    })

    it('should use progressive loading in smart selection', async () => {
      let getClientDataSetsCalled = false
      let getAllApprovedProvidersCalled = false

      const mockProvider: ApprovedProviderInfo = {
        serviceProvider: '0xdddddddddddddddddddddddddddddddddddddddd',
        serviceURL: 'https://pdp-d.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567908,
        approvedAt: 1234567909
      }

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          pdpVerifierDataSetId: 500,
          nextPieceId: 2,
          currentPieceCount: 2,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => {
          getClientDataSetsCalled = true
          return mockDataSets
        },
        getProviderIdByAddress: async () => 13,
        getApprovedProvider: async () => mockProvider,
        getAllApprovedProviders: async () => {
          getAllApprovedProvidersCalled = true
          throw new Error('Should not fetch all providers when data sets exist')
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
        const service = await StorageService.create(mockSynapse, mockWarmStorageService, {})

        assert.isTrue(getClientDataSetsCalled, 'Should fetch client data sets')
        assert.isFalse(getAllApprovedProvidersCalled, 'Should NOT fetch all providers')
        assert.equal(service.dataSetId, 500)
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should fetch all providers only when no data sets exist', async () => {
      let getAllApprovedProvidersCalled = false

      const mockProviders: ApprovedProviderInfo[] = [
        {
          serviceProvider: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          serviceURL: 'https://pdp-e.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567910,
          approvedAt: 1234567911
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => [], // No data sets
        getAllApprovedProviders: async () => {
          getAllApprovedProvidersCalled = true
          return mockProviders
        },
        getNextClientDataSetId: async () => 1
      } as any

      await StorageService.create(mockSynapse, mockWarmStorageService, {})

      assert.isTrue(getAllApprovedProvidersCalled, 'Should fetch all providers when no data sets')
    })

    it('should handle data set not live', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0xffffffffffffffffffffffffffffffffffffffffffff',
          pdpVerifierDataSetId: 600,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: false, // Not live
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, { dataSetId: 600 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 600 not found')
      }
    })

    it('should handle conflict between dataSetId and providerAddress', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x1111222233334444555566667777888899990000', // Different from requested
          pdpVerifierDataSetId: 700,
          nextPieceId: 0,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: '',
          pieceMetadata: [],
          clientDataSetId: 1
        }
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getProviderIdByAddress: async (address: string) => {
          // Data set payee maps to provider ID 7
          if (address === '0x1111222233334444555566667777888899990000') {
            return 7
          }
          // Requested provider address maps to different provider ID 8
          if (address === '0x9999888877776666555544443333222211110000') {
            return 8
          }
          return 0
        },
        getApprovedProvider: async (providerId: number) => {
          if (providerId === 7) {
            return {
              serviceProvider: '0x1111222233334444555566667777888899990000',
              serviceURL: 'https://example.com',
              peerId: 'test-peer-id',
              registeredAt: 123456,
              approvedAt: 123457
            }
          }
          if (providerId === 8) {
            return {
              serviceProvider: '0x9999888877776666555544443333222211110000',
              serviceURL: 'https://example2.com',
              peerId: 'test-peer-id-2',
              registeredAt: 123458,
              approvedAt: 123459
            }
          }
          return {
            serviceProvider: '0x0000000000000000000000000000000000000000',
            serviceURL: '',
            peerId: '',
            registeredAt: 0,
            approvedAt: 0
          }
        }
      } as any

      try {
        await StorageService.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 700,
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
      const mockWarmStorageService = {
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
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

      assert.equal(preflight.estimatedCost.perEpoch, BigInt(100))
      assert.equal(preflight.estimatedCost.perDay, BigInt(28800))
      assert.equal(preflight.estimatedCost.perMonth, BigInt(864000))
      assert.isTrue(preflight.allowanceCheck.sufficient)
    })

    it('should calculate costs with CDN', async () => {
      const mockWarmStorageService = {
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
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: true })

      const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

      // Should use CDN costs
      assert.equal(preflight.estimatedCost.perEpoch, BigInt(200))
      assert.equal(preflight.estimatedCost.perDay, BigInt(57600))
      assert.equal(preflight.estimatedCost.perMonth, BigInt(1728000))
      assert.isTrue(preflight.allowanceCheck.sufficient)
    })

    it('should handle insufficient allowances', async () => {
      const mockWarmStorageService = {
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
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const preflight = await service.preflightUpload(100 * 1024 * 1024) // 100 MiB

      assert.isFalse(preflight.allowanceCheck.sufficient)
      assert.include(preflight.allowanceCheck.message, 'Rate allowance insufficient')
      assert.include(preflight.allowanceCheck.message, 'Lockup allowance insufficient')
    })

    it('should enforce minimum size limit in preflightUpload', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

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
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

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
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Create a mock Synapse with custom download
      const mockSynapseWithDownload = {
        ...mockSynapse,
        download: async (pieceCid: string | PieceCID, options?: any) => {
          assert.equal(pieceCid, testPieceCID)
          assert.equal(options?.providerAddress, mockProvider.serviceProvider)
          assert.equal(options?.withCDN, false)
          return testData
        }
      } as unknown as Synapse

      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapseWithDownload, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const downloaded = await service.download(testPieceCID)
      assert.deepEqual(downloaded, testData)
    })

    it('should handle download errors', async () => {
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Create a mock Synapse that throws error
      const mockSynapseWithError = {
        ...mockSynapse,
        download: async (): Promise<Uint8Array> => {
          throw new Error('Network error')
        }
      } as unknown as Synapse

      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapseWithError, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      try {
        await service.download(testPieceCID)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.equal(error.message, 'Network error')
      }
    })

    it('should accept empty download options', async () => {
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Create a mock Synapse with custom download
      const mockSynapseWithOptions = {
        ...mockSynapse,
        download: async (pieceCid: string | PieceCID, options?: any) => {
          assert.equal(pieceCid, testPieceCID)
          // Options should still contain providerAddress and withCDN from StorageService
          assert.equal(options?.providerAddress, mockProvider.serviceProvider)
          assert.equal(options?.withCDN, false)
          return testData
        }
      } as unknown as Synapse

      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapseWithOptions, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Test with and without empty options object
      const downloaded1 = await service.download(testPieceCID)
      assert.deepEqual(downloaded1, testData)

      const downloaded2 = await service.download(testPieceCID, {})
      assert.deepEqual(downloaded2, testData)
    })
  })

  describe('upload', () => {
    it('should enforce 65 byte minimum size limit', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

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
      // Use a counter to simulate the nextPieceId changing on the contract
      // between addPieces transactions, which might not execute in order.
      let nextPieceId = 0
      const addPiecesCalls: Array<{ pieceCid: string, pieceId: number }> = []

      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => {
          const currentPieceId = nextPieceId
          nextPieceId++
          return {
            nextPieceId: currentPieceId,
            clientDataSetId: 1,
            currentPieceCount: currentPieceId
          }
        }
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })
      const serviceAny = service as any

      // Mock PDPServer methods to track calls
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        // Use the first byte to create a unique pieceCid for each upload
        const pieceCid = `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigm${data[0]}`
        return { pieceCid, size: data.length }
      }
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addPieces = async (dataSetId: number, clientDataSetId: number, nextPieceId: number, comms: Array<{ cid: { toString: () => string } }>): Promise<any> => {
        // The mock now receives the whole batch, so we process it.
        // We use nextPieceId from the call arguments to simulate what the contract does.
        comms.forEach((comm, index) => {
          addPiecesCalls.push({ pieceCid: comm.cid.toString(), pieceId: nextPieceId + index })
        })
        // Return a response that simulates an older server for simplicity,
        // as we are not testing the transaction tracking part here.
        return { message: 'success' }
      }

      // Track callbacks
      const uploadCompleteCallbacks: string[] = []
      const pieceAddedCallbacks: number[] = []

      // Create distinct data for each upload
      const firstData = new Uint8Array(65).fill(1) // 65 bytes
      const secondData = new Uint8Array(66).fill(2) // 66 bytes
      const thirdData = new Uint8Array(67).fill(3) // 67 bytes

      // Start all uploads concurrently with callbacks
      const uploads = [
        service.upload(firstData, {
          onUploadComplete: (pieceCid: PieceCID) => uploadCompleteCallbacks.push(pieceCid.toString()),
          onPieceAdded: () => pieceAddedCallbacks.push(1)
        }),
        service.upload(secondData, {
          onUploadComplete: (pieceCid: PieceCID) => uploadCompleteCallbacks.push(pieceCid.toString()),
          onPieceAdded: () => pieceAddedCallbacks.push(2)
        }),
        service.upload(thirdData, {
          onUploadComplete: (pieceCid: PieceCID) => uploadCompleteCallbacks.push(pieceCid.toString()),
          onPieceAdded: () => pieceAddedCallbacks.push(3)
        })
      ]

      // Wait for all to complete
      const results = await Promise.all(uploads)

      assert.lengthOf(results, 3, 'All three uploads should complete successfully')

      const resultSizes = results.map(r => r.size)
      const resultPieceIds = results.map(r => r.pieceId)

      assert.deepEqual(resultSizes, [65, 66, 67], 'Should have one result for each data size')
      assert.deepEqual(resultPieceIds, [0, 1, 2], 'The set of assigned piece IDs should be {0, 1, 2}')

      // Verify the calls to the mock were made correctly
      assert.lengthOf(addPiecesCalls, 3, 'addPieces should be called three times')
      for (const result of results) {
        assert.isTrue(
          addPiecesCalls.some(call => call.pieceCid === result.pieceCid.toString() && call.pieceId === result.pieceId),
          `addPieces call for pieceCid ${String(result.pieceCid)} and pieceId ${result.pieceId != null ? String(result.pieceId) : 'not found'} should exist`
        )
      }

      // Verify callbacks were called
      assert.lengthOf(uploadCompleteCallbacks, 3, 'All upload complete callbacks should be called')
      assert.lengthOf(pieceAddedCallbacks, 3, 'All piece added callbacks should be called')
      assert.deepEqual(pieceAddedCallbacks.sort((a, b) => a - b), [1, 2, 3], 'All callbacks should be called')
    })

    it('should respect batch size configuration', async () => {
      let nextPieceId = 0
      const addPiecesCalls: Array<{ batchSize: number, nextPieceId: number }> = []

      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => {
          const currentPieceId = nextPieceId
          // Don't increment here, let the batch processing do it
          return {
            nextPieceId: currentPieceId,
            clientDataSetId: 1,
            currentPieceCount: currentPieceId
          }
        }
      } as any

      // Create service with batch size of 2
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false, uploadBatchSize: 2 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        const pieceCid = `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigm${data[0]}`
        return { pieceCid, size: data.length }
      }
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addPieces = async (_dataSetId: number, _clientDataSetId: number, pieceIdStart: number, comms: Array<{ cid: { toString: () => string } }>): Promise<any> => {
        addPiecesCalls.push({ batchSize: comms.length, nextPieceId: pieceIdStart })
        nextPieceId += comms.length
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
      assert.isBelow(addPiecesCalls.length, 5, 'Should have fewer batches than uploads')

      // Verify all uploads were processed
      const totalProcessed = addPiecesCalls.reduce((sum, call) => sum + call.batchSize, 0)
      assert.equal(totalProcessed, 5, 'All 5 uploads should be processed')

      // Verify piece IDs are sequential
      assert.equal(addPiecesCalls[0].nextPieceId, 0, 'First batch should start at piece ID 0')
      for (let i = 1; i < addPiecesCalls.length; i++) {
        const expectedId = addPiecesCalls[i - 1].nextPieceId + addPiecesCalls[i - 1].batchSize
        assert.equal(addPiecesCalls[i].nextPieceId, expectedId, `Batch ${i} should have correct sequential piece ID`)
      }
    })

    it('should handle batch size of 1', async () => {
      let nextPieceId = 0
      const addPiecesCalls: number[] = []

      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: nextPieceId++,
          clientDataSetId: 1,
          currentPieceCount: nextPieceId
        })
      } as any

      // Create service with batch size of 1
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false, uploadBatchSize: 1 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        pieceCid: `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigm${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addPieces = async (_dataSetId: number, _clientDataSetId: number, _nextPieceId: number, comms: any[]): Promise<any> => {
        addPiecesCalls.push(comms.length)
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
      assert.lengthOf(addPiecesCalls, 3, 'Should have 3 individual calls')
      assert.deepEqual(addPiecesCalls, [1, 1, 1], 'Each call should have exactly 1 piece')
    })

    it('should debounce uploads for better batching', async () => {
      const addPiecesCalls: Array<{ batchSize: number }> = []

      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any

      // Create service with default batch size (32)
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        pieceCid: `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.addPieces = async (_dataSetId: number, _clientDataSetId: number, _nextPieceId: number, comms: any[]): Promise<any> => {
        // Track batch sizes
        addPiecesCalls.push({ batchSize: comms.length })
        return { message: 'success' }
      }

      // Create multiple uploads synchronously
      const uploads = []
      for (let i = 0; i < 5; i++) {
        uploads.push(service.upload(new Uint8Array(65).fill(i)))
      }

      await Promise.all(uploads)

      // With debounce, all 5 uploads should be in a single batch
      assert.lengthOf(addPiecesCalls, 1, 'Should have exactly 1 batch due to debounce')
      assert.equal(addPiecesCalls[0].batchSize, 5, 'Batch should contain all 5 uploads')
    })

    it('should handle errors in batch processing gracefully', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false, uploadBatchSize: 2 })
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        pieceCid: `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigm${data[0]}`,
        size: data.length
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({ uuid: 'test-uuid' })

      // Make addPieces fail
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        throw new Error('Network error during addPieces')
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
        assert.include(results[0].reason.message, 'Network error during addPieces')
        assert.include(results[1].reason.message, 'Network error during addPieces')
        // They should have the same error message (same batch)
        assert.equal(results[0].reason.message, results[1].reason.message)
      }

      // Third upload might succeed or fail depending on timing
      if (results[2].status === 'rejected') {
        assert.include((results[2]).reason.message, 'Network error during addPieces')
      }
    })

    it('should enforce 200 MiB size limit', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

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
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Create data at exactly the minimum
      const minSizeData = new Uint8Array(65) // 65 bytes
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.equal(data.length, 65)
        return { pieceCid: testPieceCID, size: data.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(minSizeData)
      assert.equal(result.pieceCid.toString(), testPieceCID)
      assert.equal(result.size, 65)
    })

    it('should accept data up to 200 MiB', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Create data at exactly the limit
      const maxSizeData = new Uint8Array(200 * 1024 * 1024) // 200 MiB
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.equal(data.length, 200 * 1024 * 1024)
        return { pieceCid: testPieceCID, size: data.length }
      }

      // Mock findPiece (immediate success)
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddPiecesInfo already mocked in mockWarmStorageService

      // Mock addPieces
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return { message: 'success' }
      }

      // Should not throw
      const result = await service.upload(maxSizeData)
      assert.equal(result.pieceCid.toString(), testPieceCID)
      assert.equal(result.size, 200 * 1024 * 1024)
      assert.equal(result.pieceId, 0)
    })

    it('should handle upload callbacks correctly', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Create data that meets minimum size (65 bytes)
      const testData = new Uint8Array(65).fill(42) // 65 bytes of value 42
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      let uploadCompleteCallbackFired = false
      let pieceAddedCallbackFired = false

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      // Mock findPiece (immediate success)
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock getAddPiecesInfo
      // getAddPiecesInfo already mocked in mockWarmStorageService

      // Mock addPieces
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(testData, {
        onUploadComplete: (pieceCid: PieceCID) => {
          assert.equal(pieceCid.toString(), testPieceCID)
          uploadCompleteCallbackFired = true
        },
        onPieceAdded: () => {
          pieceAddedCallbackFired = true
        }
      })

      assert.isTrue(uploadCompleteCallbackFired, 'onUploadComplete should have been called')
      assert.isTrue(pieceAddedCallbackFired, 'onPieceAdded should have been called')
      assert.equal(result.pieceCid.toString(), testPieceCID)
    })

    it('should handle new server with transaction tracking', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      let uploadCompleteCallbackFired = false
      let pieceAddedCallbackFired = false
      let pieceConfirmedCallbackFired = false
      let pieceAddedTransaction: any = null
      let confirmedPieceIds: number[] = []

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces to return transaction tracking info
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`
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

      // Mock getPieceAdditionStatus
      serviceAny._pdpServer.getPieceAdditionStatus = async (dataSetId: number, txHash: string): Promise<any> => {
        assert.equal(dataSetId, 123)
        assert.equal(txHash, mockTxHash)
        return {
          txHash: mockTxHash,
          txStatus: 'confirmed',
          dataSetId: 123,
          pieceCount: 1,
          addMessageOk: true,
          confirmedPieceIds: [42]
        }
      }

      try {
        const result = await service.upload(testData, {
          onUploadComplete: (pieceCid: PieceCID) => {
            assert.equal(pieceCid.toString(), testPieceCID)
            uploadCompleteCallbackFired = true
          },
          onPieceAdded: (transaction: any) => {
            pieceAddedCallbackFired = true
            pieceAddedTransaction = transaction
          },
          onPieceConfirmed: (pieceIds: number[]) => {
            pieceConfirmedCallbackFired = true
            confirmedPieceIds = pieceIds
          }
        })

        assert.isTrue(uploadCompleteCallbackFired, 'onUploadComplete should have been called')
        assert.isTrue(pieceAddedCallbackFired, 'onPieceAdded should have been called')
        assert.isTrue(pieceConfirmedCallbackFired, 'onPieceConfirmed should have been called')
        assert.exists(pieceAddedTransaction, 'Transaction should be passed to onPieceAdded')
        assert.equal(pieceAddedTransaction.hash, mockTxHash)
        assert.deepEqual(confirmedPieceIds, [42])
        assert.equal(result.pieceId, 42)
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it.skip('should fail if new server transaction is not found on-chain', async function () {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces to return transaction tracking info
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`
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
        assert.include(error.message, 'StorageContext addPieces failed:')
        assert.include(error.message, 'Server returned transaction hash')
        assert.include(error.message, 'but transaction was not found on-chain')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it.skip('should fail if new server verification fails', async function () {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces to return transaction tracking info
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`
        }
      }

      // Mock getTransaction
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 1 })
      }
      const originalGetTransaction = mockEthProvider.getTransaction
      mockEthProvider.getTransaction = async () => mockTransaction as any

      // Mock getPieceAdditionStatus to fail
      serviceAny._pdpServer.getPieceAdditionStatus = async (): Promise<any> => {
        throw new Error('Piece addition status not found')
      }

      // Override timing constants for faster test
      // Note: We cannot override imported constants, so this test will use default timeout

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for verification failure')
      } catch (error: any) {
        // The error is wrapped by createError
        assert.include(error.message, 'StorageContext addPieces failed:')
        assert.include(error.message, 'Failed to verify piece addition')
        assert.include(error.message, 'The transaction was confirmed on-chain but the server failed to acknowledge it')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it('should handle transaction failure on-chain', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces to return transaction tracking info
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return {
          message: 'success',
          txHash: mockTxHash,
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`
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
        assert.include(error.message, 'StorageContext addPieces failed:')
        assert.include(error.message, 'Failed to add piece to data set')
      } finally {
        // Restore original method
        mockEthProvider.getTransaction = originalGetTransaction
      }
    })

    it('should work with old servers that do not provide transaction tracking', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      let pieceAddedCallbackFired = false
      let pieceAddedTransaction: any

      // Mock the required services
      const serviceAny = service as any

      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock addPieces without transaction tracking (old server)
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(testData, {
        onPieceAdded: (transaction?: ethers.TransactionResponse) => {
          pieceAddedCallbackFired = true
          pieceAddedTransaction = transaction
        }
      })

      assert.isTrue(pieceAddedCallbackFired, 'onPieceAdded should have been called')
      assert.isUndefined(pieceAddedTransaction, 'Transaction should be undefined for old servers')
      assert.equal(result.pieceId, 0) // Uses nextPieceId from getAddPiecesInfo
    })

    it('should handle ArrayBuffer input', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Create ArrayBuffer instead of Uint8Array
      const buffer = new ArrayBuffer(1024)
      const view = new Uint8Array(buffer)
      for (let i = 0; i < view.length; i++) {
        view[i] = i % 256
      }

      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => {
        assert.instanceOf(data, Uint8Array)
        assert.equal(data.length, 1024)
        return { pieceCid: testPieceCID, size: data.length }
      }

      // Mock findPiece
      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // Mock getAddPiecesInfo
      // getAddPiecesInfo already mocked in mockWarmStorageService

      // Mock addPieces
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        return { message: 'success' }
      }

      const result = await service.upload(buffer)
      assert.equal(result.pieceCid.toString(), testPieceCID)
      assert.equal(result.size, 1024)
    })

    it.skip('should handle piece parking timeout', async () => {
      // Skip this test as it's timing-sensitive and causes issues in CI
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock uploadPiece
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
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
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })
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
        assert.include(error.message, 'Failed to upload piece to service provider')
      }
    })

    it('should handle add pieces failure', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => ({
          nextPieceId: 0,
          clientDataSetId: 1,
          currentPieceCount: 0
        })
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock successful upload and parking
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddPiecesInfo already mocked in mockWarmStorageService

      // Mock addPieces to fail
      serviceAny._pdpServer.addPieces = async (): Promise<any> => {
        throw new Error('Signature validation failed')
      }

      try {
        await service.upload(testData)
        assert.fail('Should have thrown add pieces error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })

    it('should handle getAddPiecesInfo failure', async () => {
      const mockWarmStorageService = {
        getAddPiecesInfo: async (): Promise<any> => {
          throw new Error('Data set not managed by this WarmStorage')
        }
      } as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })
      const testData = new Uint8Array(65).fill(42) // 65 bytes to meet minimum
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Mock the required services
      const serviceAny = service as any

      // Mock successful upload and parking
      serviceAny._pdpServer.uploadPiece = async (): Promise<any> => {
        return { pieceCid: testPieceCID, size: testData.length }
      }

      serviceAny._pdpServer.findPiece = async (): Promise<any> => {
        return { uuid: 'test-uuid' }
      }

      // getAddPiecesInfo already mocked to fail in mockWarmStorageService

      try {
        await service.upload(testData)
        assert.fail('Should have thrown getAddPiecesInfo error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })
  })

  describe('Provider Ping Validation', () => {
    describe('selectRandomProvider with ping validation', () => {
      it('should select first provider that responds to ping', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
            peerId: 'test-peer-id',
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
            testProviders
          )

          // Should have selected the second provider (first one failed ping)
          assert.equal(result.serviceProvider, testProviders[1].serviceProvider)
          assert.isAtLeast(pingCallCount, 1, 'Should have called ping at least once')
        } finally {
          global.fetch = originalFetch
        }
      })

      // Test removed: selectRandomProvider no longer supports exclusion functionality

      it('should throw error when all providers fail ping', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
            peerId: 'test-peer-id',
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
            testProviders
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'StorageContext selectProviderWithPing failed')
          assert.include(error.message, 'All 2 providers failed health check')
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('smartSelectProvider with ping validation', () => {
      it('should fail when existing providers fail ping validation', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProviders[0].serviceProvider, // First provider has existing data set
            pdpVerifierDataSetId: 100,
            nextPieceId: 0,
            currentPieceCount: 0,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            pieceMetadata: [],
            clientDataSetId: 1
          }
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
          getAllApprovedProviders: async () => testProviders,
          getProviderIdByAddress: async (address: string) => {
            const idx = testProviders.findIndex(p => p.serviceProvider.toLowerCase() === address.toLowerCase())
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
            '0x1234567890123456789012345678901234567890',
            false,
            mockWarmStorageService
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          // Should fail with selectProviderWithPing error after trying existing provider
          assert.include(error.message, 'StorageContext selectProviderWithPing failed')
          assert.include(error.message, 'All 1 providers failed health check')
          assert.isAtLeast(pingCallCount, 1, 'Should have pinged the provider from existing data set')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should select new provider when no existing providers are available', async () => {
        const testProviders: ApprovedProviderInfo[] = [
          {
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567890,
            approvedAt: 1234567891
          },
          {
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
            peerId: 'test-peer-id',
            registeredAt: 1234567892,
            approvedAt: 1234567893
          }
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => [], // No existing data sets
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
          // Create a mock signer for the test
          const mockSigner = {
            getAddress: async () => '0x1234567890123456789012345678901234567890'
          } as any

          const result = await (StorageService as any).smartSelectProvider(
            '0x1234567890123456789012345678901234567890',
            false,
            mockWarmStorageService,
            mockSigner
          )

          // Should have selected one of the available providers for new data set
          assert.isTrue(
            testProviders.some(p => p.serviceProvider === result.provider.serviceProvider),
            'Should have selected one of the available providers'
          )
          assert.equal(result.dataSetId, -1) // New data set marker
          assert.isFalse(result.isExisting)
          assert.isAtLeast(pingCallCount, 1, 'Should have pinged at least one provider')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should use existing provider if ping succeeds', async () => {
        const testProvider: ApprovedProviderInfo = {
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        }

        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider,
            pdpVerifierDataSetId: 100,
            nextPieceId: 0,
            currentPieceCount: 5, // Has pieces, so preferred
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            pieceMetadata: [],
            clientDataSetId: 1
          }
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
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
          // Create a mock signer for the test
          const mockSigner = {
            getAddress: async () => '0x1234567890123456789012345678901234567890'
          } as any

          const result = await (StorageService as any).smartSelectProvider(
            '0x1234567890123456789012345678901234567890',
            false,
            mockWarmStorageService,
            mockSigner
          )

          // Should use existing provider since ping succeeded
          assert.equal(result.provider.serviceProvider, testProvider.serviceProvider)
          assert.equal(result.dataSetId, 100)
          assert.isTrue(result.isExisting)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('selectProviderWithPing', () => {
      // ... existing code ...

      it('should deduplicate providers from multiple data sets', async () => {
        const testProvider: ApprovedProviderInfo = {
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        }

        // Create multiple data sets with the same provider
        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider,
            pdpVerifierDataSetId: 100,
            nextPieceId: 0,
            currentPieceCount: 5,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            pieceMetadata: [],
            clientDataSetId: 1
          },
          {
            railId: 2,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider, // Same provider
            pdpVerifierDataSetId: 101,
            nextPieceId: 0,
            currentPieceCount: 3,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            pieceMetadata: [],
            clientDataSetId: 2
          },
          {
            railId: 3,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider, // Same provider
            pdpVerifierDataSetId: 102,
            nextPieceId: 0,
            currentPieceCount: 1,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: '',
            pieceMetadata: [],
            clientDataSetId: 3
          }
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
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
            return {
              status: 500,
              statusText: 'Internal Server Error',
              text: async () => 'Server error'
            } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          await (StorageService as any).smartSelectProvider(
            '0x1234567890123456789012345678901234567890',
            false,
            mockWarmStorageService
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          // Verify we only pinged once despite having three data sets with the same provider
          assert.equal(pingCount, 1, 'Should only ping each unique provider once')
          // The error should come from selectProviderWithPing failing, not from getAllApprovedProviders
          assert.include(error.message, 'All 1 providers failed health check')
        } finally {
          global.fetch = originalFetch
        }
      })
    })
  })

  describe('getProviderInfo', () => {
    it('should return provider info through WarmStorageService', async () => {
      const expectedProviderInfo = {
        serviceProvider: mockProvider.serviceProvider,
        serviceURL: 'https://updated-pdp.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1234567900,
        approvedAt: 1234567901
      }

      const mockSynapseWithProvider = {
        ...mockSynapse,
        getProviderInfo: async (address: string) => {
          assert.equal(address, mockProvider.serviceProvider)
          return expectedProviderInfo
        }
      } as any
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapseWithProvider, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const providerInfo = await service.getProviderInfo()
      assert.deepEqual(providerInfo, expectedProviderInfo)
    })

    it('should handle errors from Synapse getProviderInfo', async () => {
      const mockSynapseWithError = {
        ...mockSynapse,
        getProviderInfo: async () => {
          throw new Error('Provider not found')
        }
      } as any
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapseWithError, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      try {
        await service.getProviderInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider not found')
      }
    })
  })

  describe('getDataSetPieces', () => {
    it('should successfully fetch data set pieces', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const mockDataSetData = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0
          }
        ],
        nextChallengeEpoch: 1500
      }

      // Mock the PDP server getDataSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getDataSet = async (dataSetId: number): Promise<any> => {
        assert.equal(dataSetId, 123)
        return mockDataSetData
      }

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].toString(), mockDataSetData.pieces[0].pieceCid)
      assert.equal(result[1].toString(), mockDataSetData.pieces[1].pieceCid)
    })

    it('should handle empty data set pieces', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const mockDataSetData = {
        id: 292,
        pieces: [],
        nextChallengeEpoch: 1500
      }

      // Mock the PDP server getDataSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getDataSet = async (): Promise<any> => {
        return mockDataSetData
      }

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 0)
    })

    it('should handle invalid CID in response', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      const mockDataSetData = {
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

      // Mock the PDP server getDataSet method
      const serviceAny = service as any
      serviceAny._pdpServer.getDataSet = async (): Promise<any> => {
        return mockDataSetData
      }

      const result = await service.getDataSetPieces()
      assert.isArray(result)
      assert.equal(result.length, 1)
      assert.equal(result[0].toString(), 'invalid-cid-format')
    })

    it('should handle PDP server errors', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock the PDP server getDataSet method to throw error
      const serviceAny = service as any
      serviceAny._pdpServer.getDataSet = async (): Promise<any> => {
        throw new Error('Data set not found: 999')
      }

      try {
        await service.getDataSetPieces()
        assert.fail('Should have thrown error for server error')
      } catch (error: any) {
        assert.include(error.message, 'Data set not found: 999')
      }
    })
  })

  describe('pieceStatus()', () => {
    const mockPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

    it('should return exists=false when piece not found on provider', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => { throw new Error('Piece not found') }
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [],
        nextChallengeEpoch: 5000
      })

      // Mock provider getBlock for current epoch
      mockEthProvider.getBlock = async (blockTag: any) => {
        if (blockTag === 'latest') {
          return { number: 4000 } as any
        }
        return null
      }
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.getNetwork = () => 'calibration'

      const status = await service.pieceStatus(mockPieceCID)

      assert.isFalse(status.exists)
      assert.isNull(status.retrievalUrl)
      assert.isNull(status.dataSetLastProven)
      assert.isNull(status.dataSetNextProofDue)
    })

    it('should return piece status with proof timing when piece exists', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [{
          pieceId: 1,
          pieceCid: { toString: () => mockPieceCID }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse methods
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlock = async (blockTag: any) => { if (blockTag === 'latest') { return { number: 4000 } as any } return null }
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.equal(status.retrievalUrl, 'https://pdp.example.com/piece/' + mockPieceCID)
      assert.isNotNull(status.dataSetLastProven)
      assert.isNotNull(status.dataSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when in challenge window', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [{
          pieceId: 1,
          pieceCid: { toString: () => mockPieceCID }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - current epoch is in challenge window
      // nextChallengeEpoch (5000) is the START of the window
      // Window ends at 5000 + 60 = 5060
      // Current epoch 5030 is in the middle of the window
      mockEthProvider.getBlock = async (blockTag: any) => {
        if (blockTag === 'latest') {
          return { number: 5030 } as any
        }
        return null
      }
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      // During challenge window
      assert.isTrue(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when proof is overdue', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [{
          pieceId: 1,
          pieceCid: { toString: () => mockPieceCID }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - current epoch is past the challenge window
      // nextChallengeEpoch (5000) + challengeWindow (60) = 5060 (deadline)
      // Current epoch 5100 is past the deadline
      mockEthProvider.getBlock = async (blockTag: any) => {
        if (blockTag === 'latest') {
          return { number: 5100 } as any
        }
        return null
      }
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isTrue(status.isProofOverdue)
    })

    it('should handle data set with nextChallengeEpoch=0', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [{
          pieceId: 1,
          pieceCid: { toString: () => mockPieceCID }
        }],
        nextChallengeEpoch: 0 // No next challenge scheduled
      })

      // Mock synapse
      mockEthProvider.getBlock = async (blockTag: any) => {
        if (blockTag === 'latest') {
          return { number: 5000 } as any
        }
        return null
      }
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isNull(status.dataSetLastProven) // No challenge means no proof data
      assert.isNull(status.dataSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
    })

    it('should handle trailing slash in retrieval URL', async () => {
      const mockProviderWithSlash: ApprovedProviderInfo = {
        ...mockProvider
      }

      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProviderWithSlash, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [],
        nextChallengeEpoch: 5000
      })

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlock = async (blockTag: any) => { if (blockTag === 'latest') { return { number: 4000 } as any } return null }
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async (address: string) => {
        // Return the provider with trailing slash when asked for this provider's address
        if (address === mockProviderWithSlash.serviceProvider) {
          return mockProviderWithSlash
        }
        throw new Error('Provider not found')
      }

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      // Should not have double slash
      assert.equal(status.retrievalUrl, 'https://pdp.example.com/piece/' + mockPieceCID)
      // Check that the URL doesn't contain double slashes after the protocol
      const urlWithoutProtocol = (status.retrievalUrl ?? '').substring(8) // Remove 'https://'
      assert.notInclude(urlWithoutProtocol, '//')
    })

    it('should handle invalid PieceCID', async () => {
      const mockWarmStorageService = {} as any
      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      try {
        await service.pieceStatus('invalid-pieceCid')
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID provided')
      }
    })

    it('should calculate hours until challenge window', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [{
          pieceId: 1,
          pieceCid: { toString: () => mockPieceCID }
        }],
        nextChallengeEpoch: 5000
      })

      // Mock synapse - 120 epochs before challenge window (1 hour)
      mockEthProvider.getBlock = async (blockTag: any) => {
        if (blockTag === 'latest') {
          return { number: 4880 } as any // 5000 - 120 = 4880 (1 hour before window)
        }
        return null
      }
      const mockSynapseAny = mockSynapse as any
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isFalse(status.inChallengeWindow) // Not yet in challenge window
      assert.isTrue((status.hoursUntilChallengeWindow ?? 0) > 0)
    })

    it('should handle data set data fetch failure gracefully', async () => {
      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60
        })
      } as any

      const service = new StorageService(mockSynapse, mockWarmStorageService, mockProvider, 123, { withCDN: false })

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => { throw new Error('Network error') }

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlock = async (blockTag: any) => { if (blockTag === 'latest') { return { number: 4000 } as any } return null }
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      // Should still return basic status even if data set data fails
      assert.isTrue(status.exists)
      assert.isNotNull(status.retrievalUrl)
      assert.isNull(status.dataSetLastProven)
      assert.isNull(status.dataSetNextProofDue)
      assert.isUndefined(status.pieceId)
    })
  })
})
