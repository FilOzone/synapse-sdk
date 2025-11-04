/* globals describe it beforeEach afterEach before after */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { CID } from 'multiformats/cid'
import { calculate as calculatePieceCID } from '../piece/index.ts'
import { StorageContext } from '../storage/context.ts'
import type { Synapse } from '../synapse.ts'
import type { PieceCID, ProviderInfo } from '../types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'
import { createMockProviderInfo, createSimpleProvider, setupProviderRegistryMocks } from './test-utils.ts'

// MSW server for JSONRPC mocking
const server = setup([])

// Create a mock Ethereum provider that doesn't try to connect
const mockEthProvider = {
  getTransaction: async (_hash: string) => null,
  getNetwork: async () => ({ chainId: BigInt(314159), name: 'calibration' }),
  call: async (_tx: any) => {
    // Mock contract calls - return empty data for other calls
    return '0x'
  },
} as any

function cidBytesToContractHex(bytes: Uint8Array): `0x${string}` {
  return ethers.hexlify(bytes) as `0x${string}`
}

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getClient: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => mockEthProvider,
  getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
  getChainId: () => BigInt(314159),
  payments: {
    serviceApproval: async () => ({
      service: '0x1234567890123456789012345678901234567890',
      rateAllowance: BigInt(1000000),
      lockupAllowance: BigInt(10000000),
      rateUsed: BigInt(0),
      lockupUsed: BigInt(0),
    }),
  },
  download: async (_pieceCid: string | PieceCID, _options?: any) => {
    // Mock download that returns test data - will be overridden in specific tests
    return new Uint8Array(127).fill(42)
  },
  getProviderInfo: async (_providerAddress: string) => {
    // Mock getProviderInfo - will be overridden in specific tests
    throw new Error('getProviderInfo not mocked')
  },
} as unknown as Synapse

// Standard test providers - reusable across tests
const TEST_PROVIDERS = {
  // Default provider with ID 1
  provider1: createMockProviderInfo({
    id: 1,
    serviceProvider: '0x1111111111111111111111111111111111111111',
    name: 'Test Provider 1',
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: { serviceStatus: 'dev' }, // Will be hex-encoded by the mock
        data: {
          serviceURL: 'https://provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: false,
          ipniIpfs: false,
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  }),
  // Provider with ID 2
  provider2: createMockProviderInfo({
    id: 2,
    serviceProvider: '0x2222222222222222222222222222222222222222',
    name: 'Test Provider 2',
    products: {
      PDP: {
        type: 'PDP',
        isActive: true,
        capabilities: {},
        data: {
          serviceURL: 'https://provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: true,
          ipniIpfs: true,
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      },
    },
  }),
  // Provider with ID 3
  provider3: createMockProviderInfo({
    id: 3,
    serviceProvider: '0x3333333333333333333333333333333333333333',
    name: 'Test Provider 3',
  }),
  // Provider with ID 4
  provider4: createMockProviderInfo({
    id: 4,
    serviceProvider: '0x4444444444444444444444444444444444444444',
    name: 'Test Provider 4',
  }),
  // Provider with ID 5
  provider5: createMockProviderInfo({
    id: 5,
    serviceProvider: '0x5555555555555555555555555555555555555555',
    name: 'Test Provider 5',
  }),
  // Provider with ID 7
  provider7: createMockProviderInfo({
    id: 7,
    serviceProvider: '0x7777777777777777777777777777777777777777',
    name: 'Test Provider 7',
  }),
  // Provider with ID 9
  provider9: createMockProviderInfo({
    id: 9,
    serviceProvider: '0x9999999999999999999999999999999999999999',
    name: 'Test Provider 9',
  }),
}

// Legacy mock provider for backward compatibility
const mockProvider: ProviderInfo = createSimpleProvider({
  serviceProvider: '0xabcdef1234567890123456789012345678901234',
  serviceURL: 'https://pdp.example.com',
})

// Helper to create a standard mock WarmStorageService
function createMockWarmStorageService(dataSets?: any[], overrides: any = {}) {
  return {
    getClientDataSetsWithDetails: async () => dataSets ?? [],
    getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
    getDataSetMetadata: async () => ({}),
    getApprovedProviderIds: async () => [],
    ...overrides,
  } as any
}

// Helper to mock PDPServer.addPieces with standard behavior
function mockAddPieces(
  serviceAny: any,
  options: {
    txHash?: string
    onCall?: (dataSetId: number, clientDataSetId: bigint, pieceCids: any[]) => void | Promise<void>
    shouldFail?: boolean
    failureMessage?: string
    addDelay?: number // Add delay in ms to simulate network latency
    startPieceId?: number // Starting piece ID for generating piece IDs
  } = {}
) {
  const txHash = options.txHash || `0x${'0'.repeat(64)}`
  let nextPieceId = options.startPieceId ?? 0

  serviceAny._pdpServer.addPieces = async (
    dataSetId: number,
    clientDataSetId: bigint,
    pieceCids: any[]
  ): Promise<any> => {
    if (options.shouldFail) {
      throw new Error(options.failureMessage || 'Network error during addPieces')
    }

    const currentPieceId = nextPieceId

    if (options.onCall) {
      await options.onCall(dataSetId, clientDataSetId, pieceCids)
    }

    // Generate piece IDs for the batch
    const pieceIds = Array.from({ length: pieceCids.length }, (_, i) => currentPieceId + i)
    nextPieceId += pieceCids.length
    // Store piece IDs for status mock
    ;(serviceAny._pdpServer as any)._lastPieceIds = pieceIds

    // Add optional delay to simulate network latency
    if (options.addDelay) {
      await new Promise((resolve) => setTimeout(resolve, options.addDelay))
    }

    return {
      message: 'success',
      txHash,
      ...(options.txHash && {
        statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${txHash}`,
      }),
    }
  }

  return txHash
}

describe('StorageService', () => {
  // MSW lifecycle hooks
  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('create() factory method', () => {
    let cleanupMocks: (() => void) | null = null
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      originalFetch = global.fetch
      // Default mock for ping validation - can be overridden in specific tests
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/ping')) {
          return {
            status: 200,
            statusText: 'OK',
            text: async () => '',
            json: async () => ({}),
          } as any
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
    })

    afterEach(() => {
      global.fetch = originalFetch
      if (cleanupMocks) {
        cleanupMocks()
        cleanupMocks = null
      }
    })

    it('should select a random provider when no providerId specified', async () => {
      // Create mock providers
      const mockProviders: ProviderInfo[] = [TEST_PROVIDERS.provider1, TEST_PROVIDERS.provider2]

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider, // Matches first provider
          providerId: 1, // Provider ID for first provider
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].serviceProvider, // Matches second provider
          providerId: 2, // Provider ID for second provider
          pdpVerifierDataSetId: 101,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      // Set up registry mocks with our providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [1, 2],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets, {
        getApprovedProviderIds: async () => [1, 2],
      })

      // Create storage service without specifying providerId
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService)

      // Should have selected one of the providers
      assert.isTrue(
        service.serviceProvider === mockProviders[0].serviceProvider ||
          service.serviceProvider === mockProviders[1].serviceProvider
      )
    })

    it('should select a random provider but filter allow IPNI providers', async () => {
      // Create mock providers
      const mockProviders: ProviderInfo[] = [TEST_PROVIDERS.provider1, TEST_PROVIDERS.provider2]

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider, // Matches first provider
          providerId: 1, // Provider ID for first provider
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].serviceProvider, // Matches second provider
          providerId: 2, // Provider ID for second provider
          pdpVerifierDataSetId: 101,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      // Set up registry mocks with our providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [1, 2],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets, {
        getApprovedProviderIds: async () => [1, 2],
      })

      // Create storage service without specifying providerId
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        withIpni: true,
      })

      // Should have selected one of the providers
      assert.isTrue(service.serviceProvider === mockProviders[1].serviceProvider)
    })

    it('should never select a dev provider by default', async () => {
      // Create mock providers
      const mockProviders: ProviderInfo[] = [TEST_PROVIDERS.provider1, TEST_PROVIDERS.provider2]

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider, // Matches first provider
          providerId: 1, // Provider ID for first provider
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pdpEndEpoch: 0,
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].serviceProvider, // Matches second provider
          providerId: 2, // Provider ID for second provider
          pdpVerifierDataSetId: 101,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      // Set up registry mocks with our providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [1, 2],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets, {
        getApprovedProviderIds: async () => [1, 2],
      })

      // Create storage service without specifying providerId
      // dev defaults to false, so dev providers should be filtered out
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        dev: false,
      })

      // Should have selected provider2 (non-dev), never provider1 (dev)
      assert.equal(service.serviceProvider, mockProviders[1].serviceProvider)
      assert.notEqual(service.serviceProvider, mockProviders[0].serviceProvider, 'Should not select dev provider')
    })

    it('should include dev providers when dev option is true', async () => {
      // Create mock providers - provider1 has serviceStatus=dev
      const mockProviders: ProviderInfo[] = [TEST_PROVIDERS.provider1, TEST_PROVIDERS.provider2]

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider,
          providerId: 1,
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pdpEndEpoch: 0,
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[1].serviceProvider,
          providerId: 2,
          pdpVerifierDataSetId: 101,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      // Set up registry mocks with our providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [1, 2],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets, {
        getApprovedProviderIds: async () => [1, 2],
      })

      // Create storage service with dev: true
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        dev: true,
      })

      // Should be able to select from either provider, including the dev one
      assert.isTrue(
        service.serviceProvider === mockProviders[0].serviceProvider ||
          service.serviceProvider === mockProviders[1].serviceProvider
      )
    })

    it('should filter providers with serviceStatus=dev when dev option is false', async () => {
      // Create a provider with serviceStatus=dev explicitly
      const devProvider: ProviderInfo = createMockProviderInfo({
        id: 10,
        serviceProvider: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Dev Provider',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: { serviceStatus: 'dev' }, // Will be hex-encoded by the mock
            data: {
              serviceURL: 'https://dev-provider.example.com',
              minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
              maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerDay: BigInt(1000000),
              minProvingPeriodInEpochs: 2880n,
              location: 'US',
              paymentTokenAddress: '0x0000000000000000000000000000000000000000',
            },
          },
        },
      })

      // Create a non-dev provider
      const productionProvider: ProviderInfo = createMockProviderInfo({
        id: 11,
        serviceProvider: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name: 'Production Provider',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {}, // No serviceStatus capability
            data: {
              serviceURL: 'https://prod-provider.example.com',
              minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
              maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerDay: BigInt(1000000),
              minProvingPeriodInEpochs: 2880n,
              location: 'US',
              paymentTokenAddress: '0x0000000000000000000000000000000000000000',
            },
          },
        },
      })

      const mockProviders: ProviderInfo[] = [devProvider, productionProvider]

      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [10, 11],
      })

      const mockWarmStorageService = createMockWarmStorageService([], {
        getApprovedProviderIds: async () => [10, 11],
      })

      // Create storage service with dev: false (default)
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        dev: false,
      })

      // Should only select the production provider, not the dev one
      assert.equal(
        service.serviceProvider.toLowerCase(),
        productionProvider.serviceProvider.toLowerCase(),
        'Should select production provider, not dev provider'
      )
      assert.notEqual(
        service.serviceProvider.toLowerCase(),
        devProvider.serviceProvider.toLowerCase(),
        'Should NOT select dev provider'
      )
    })

    it('should use specific provider when providerId specified', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          providerId: 3, // Provider ID for provider3
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets)

      // Create storage service with specific providerId
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 3,
      })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
    })

    it('should skip existing datasets and return -1 with providerId when forceCreateDataSet is true', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      // Create existing data set for this provider
      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 3,
          pdpVerifierDataSetId: 100, // Existing data set
          currentPieceCount: 5, // Has pieces
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets)

      // Track if getClientDataSetsWithDetails was called (should be skipped with forceCreateDataSet)
      let fetchedDataSets = false
      const originalGetClientDataSets = mockWarmStorageService.getClientDataSetsWithDetails
      mockWarmStorageService.getClientDataSetsWithDetails = async (address: string) => {
        fetchedDataSets = true
        return await originalGetClientDataSets(address)
      }

      // Call the resolution method directly to test without data set creation
      const resolution = await (StorageContext as any).resolveProviderAndDataSet(
        mockSynapse,
        mockWarmStorageService,
        {
          getProvider: async () => mockProvider,
          getProviders: async () => [mockProvider],
          getProviderByAddress: async () => mockProvider,
        },
        { providerId: 3, forceCreateDataSet: true }
      )

      // Should signal new data set creation with -1
      assert.equal(resolution.dataSetId, -1, 'Should return -1 to signal new data set creation')
      assert.equal(resolution.provider.id, 3, 'Should select the requested provider')
      assert.isFalse(fetchedDataSets, 'Should not have fetched existing data sets when forceCreateDataSet is true')
    })

    it('should skip existing datasets and return -1 with providerAddress when forceCreateDataSet is true', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      // Create existing data set for this provider
      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 3,
          pdpVerifierDataSetId: 100, // Existing data set
          currentPieceCount: 5, // Has pieces
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets)

      // Track if getClientDataSetsWithDetails was called (should be skipped with forceCreateDataSet)
      let fetchedDataSets = false
      const originalGetClientDataSets = mockWarmStorageService.getClientDataSetsWithDetails
      mockWarmStorageService.getClientDataSetsWithDetails = async (address: string) => {
        fetchedDataSets = true
        return await originalGetClientDataSets(address)
      }

      // Call the resolution method directly to test without data set creation
      const resolution = await (StorageContext as any).resolveProviderAndDataSet(
        mockSynapse,
        mockWarmStorageService,
        {
          getProvider: async () => mockProvider,
          getProviders: async () => [mockProvider],
          getProviderByAddress: async () => mockProvider,
        },
        { providerAddress: mockProvider.serviceProvider, forceCreateDataSet: true }
      )

      // Should signal new data set creation with -1
      assert.equal(resolution.dataSetId, -1, 'Should return -1 to signal new data set creation')
      assert.equal(
        resolution.provider.serviceProvider.toLowerCase(),
        mockProvider.serviceProvider.toLowerCase(),
        'Should select the requested provider'
      )
      assert.isFalse(fetchedDataSets, 'Should not have fetched existing data sets when forceCreateDataSet is true')
    })

    it('should reuse existing data set with providerId when forceCreateDataSet is not set', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      // Create existing data set for this provider
      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 3,
          pdpVerifierDataSetId: 100, // Existing data set
          currentPieceCount: 5, // Has pieces
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets)

      // Track if a new data set was created
      let createdDataSet = false
      mockWarmStorageService.getNextClientDataSetId = async () => {
        createdDataSet = true
        return 2
      }

      // Create storage service with just providerId (no forceCreateDataSet)
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 3,
      })

      // Should have reused existing data set (not created new one)
      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
      assert.equal(service.dataSetId, 100, 'Should reuse existing data set ID')
      assert.isFalse(createdDataSet, 'Should not have created a new data set')
    })

    it('should throw when no approved providers available', async () => {
      // Set up registry mocks with no providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [],
        approvedIds: [],
      })

      const mockWarmStorageService = createMockWarmStorageService()

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {})
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved service providers available')
      }
    })

    it('should throw when specified provider not found', async () => {
      // Set up registry mocks with some providers but not the one we're looking for
      const mockProviders = [TEST_PROVIDERS.provider1, TEST_PROVIDERS.provider2]
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: mockProviders,
        approvedIds: [1, 2],
      })

      const mockWarmStorageService = createMockWarmStorageService()

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          providerId: 999,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 999 not found in registry')
      }
    })

    it('should select existing data set when available', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333', // Matches provider
          providerId: 3, // Provider ID for provider3
          pdpVerifierDataSetId: 100,
          currentPieceCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 3,
      })

      // Should use existing data set
      assert.equal(service.dataSetId, 100)
    })

    it.skip('should create new data set when none exist', async () => {
      // Skip: Requires real PDPServer for createDataSet
      // This would need mocking of PDPServer which is created internally
      // TODO: Implement PDPServer mocking and get this working
    })

    it('should prefer data sets with existing pieces', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          providerId: 3,
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0, // No pieces
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x3333333333333333333333333333333333333333',
          providerId: 3,
          pdpVerifierDataSetId: 101,
          currentPieceCount: 5, // Has pieces - should be preferred
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 3,
      })

      // Should select the data set with pieces
      assert.equal(service.dataSetId, 101)
    })

    it('should handle provider selection callbacks', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      let providerCallbackFired = false
      let dataSetCallbackFired = false

      const dataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 3,
          pdpVerifierDataSetId: 100,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(dataSets)

      await StorageContext.create(mockSynapse, mockWarmStorageService, {
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
          },
        },
      })

      assert.isTrue(providerCallbackFired, 'onProviderSelected should have been called')
      assert.isTrue(dataSetCallbackFired, 'onDataSetResolved should have been called')
    })

    it('should select by explicit dataSetId', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider3

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 3, // Provider ID for provider3
          pdpVerifierDataSetId: 456,
          nextPieceId: 10,
          currentPieceCount: 10,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [3],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        dataSetId: 456,
      })

      assert.equal(service.dataSetId, 456)
      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
    })

    it('should select by providerAddress', async () => {
      const mockProvider: ProviderInfo = TEST_PROVIDERS.provider4

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          providerId: 4,
          pdpVerifierDataSetId: 789,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          pdpEndEpoch: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [4],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerAddress: mockProvider.serviceProvider,
      })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
      assert.equal(service.dataSetId, 789)
    })

    it('should throw when dataSetId not found', async () => {
      // Set up registry mocks with no data
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [],
        approvedIds: [],
      })

      const mockWarmStorageService = createMockWarmStorageService()

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 999,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 not found')
      }
    })

    it('should throw when dataSetId conflicts with providerId', async () => {
      const mockProvider1: ProviderInfo = TEST_PROVIDERS.provider5

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider1.serviceProvider, // Owned by provider 5
          providerId: 5, // Provider ID for provider5
          pdpVerifierDataSetId: 111,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider1],
        approvedIds: [5],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 111,
          providerId: 3, // Conflicts with actual owner
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider ID 5')
        assert.include(error.message, 'but provider ID 3 was requested')
      }
    })

    it('should throw when providerAddress not approved', async () => {
      // Set up registry mocks with no approved providers
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [],
        approvedIds: [],
      })

      const mockWarmStorageService = createMockWarmStorageService()

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          providerAddress: '0x6666666666666666666666666666666666666666',
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'not found in registry')
      }
    })

    it.skip('should filter by CDN setting in smart selection', async () => {
      // SKIPPED: Requires SPRegistryService mocking
      // TODO: get this working

      const mockProviders: ProviderInfo[] = [
        createSimpleProvider({
          serviceProvider: '0x7777777777777777777777777777777777777777',
          serviceURL: 'https://pdp7.example.com',
        }),
      ]

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider,
          pdpVerifierDataSetId: 200,
          currentPieceCount: 5,
          isLive: true,
          isManaged: true,
          withCDN: false, // No CDN
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
        {
          railId: 2,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProviders[0].serviceProvider,
          pdpVerifierDataSetId: 201,
          currentPieceCount: 3,
          isLive: true,
          isManaged: true,
          withCDN: true, // With CDN
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 2,
        },
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getProviderIdByAddress: async () => 7,
        getApprovedProvider: async () => mockProviders[0],
        getAllApprovedProviders: async () => mockProviders,
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
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
        const serviceNoCDN = await StorageContext.create(mockSynapse, mockWarmStorageService, {
          withCDN: false,
        })
        assert.equal(serviceNoCDN.dataSetId, 200, 'Should select non-CDN data set')

        // Test with CDN = true
        const serviceWithCDN = await StorageContext.create(mockSynapse, mockWarmStorageService, {
          withCDN: true,
        })
        assert.equal(serviceWithCDN.dataSetId, 201, 'Should select CDN data set')
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should handle data sets not managed by current WarmStorage', async () => {
      // SKIP: Requires PDPServer mocking for data set creation
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x8888888888888888888888888888888888888888',
          pdpVerifierDataSetId: 300,
          currentPieceCount: 0,
          isLive: true,
          isManaged: false, // Not managed by current WarmStorage
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      const mockProvider = TEST_PROVIDERS.provider9

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [mockProvider],
        approvedIds: [9],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      // Should create new data set since existing one is not managed
      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {})

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
          providerId: 999, // Non-existent/non-approved provider
          pdpVerifierDataSetId: 400,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      // Set up registry mocks with no approved providers (so provider 999 is not approved)
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [],
        approvedIds: [],
      })

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 400,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        // Provider 999 is not in the registry, so we'll get a "not found in registry" error
        assert.include(error.message, 'not found in registry')
      }
    })

    it.skip('should create new data set when none exist for provider', async () => {
      const mockProvider: ProviderInfo = createSimpleProvider({
        serviceProvider: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        serviceURL: 'https://pdp-b.example.com',
      })

      const mockWarmStorageService = {
        getApprovedProvider: async () => mockProvider,
        getClientDataSetsWithDetails: async () => [], // No data sets
        getProviderIdByAddress: async () => 11,
        getNextClientDataSetId: async () => 1,
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 11,
      })

      assert.equal(service.serviceProvider, mockProvider.serviceProvider)
      // Note: actual data set creation is skipped in tests
    })

    it.skip('should validate parallel fetching in resolveByProviderId', async () => {
      let getApprovedProviderCalled = false
      let getClientDataSetsCalled = false
      const callOrder: string[] = []

      const mockProvider: ProviderInfo = createSimpleProvider({
        serviceProvider: '0xcccccccccccccccccccccccccccccccccccccccc',
        serviceURL: 'https://pdp-c.example.com',
      })

      const mockWarmStorageService = {
        getApprovedProvider: async () => {
          callOrder.push('getApprovedProvider-start')
          getApprovedProviderCalled = true
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10))
          callOrder.push('getApprovedProvider-end')
          return mockProvider
        },
        getClientDataSetsWithDetails: async () => {
          callOrder.push('getClientDataSetsWithDetails-start')
          getClientDataSetsCalled = true
          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10))
          callOrder.push('getClientDataSetsWithDetails-end')
          return []
        },
        getNextClientDataSetId: async () => 1,
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: 12,
      })

      assert.isTrue(getApprovedProviderCalled)
      assert.isTrue(getClientDataSetsCalled)

      // Verify both calls started before either finished (parallel execution)
      const providerStartIndex = callOrder.indexOf('getApprovedProvider-start')
      const dataSetsStartIndex = callOrder.indexOf('getClientDataSetsWithDetails-start')
      const providerEndIndex = callOrder.indexOf('getApprovedProvider-end')

      assert.isBelow(providerStartIndex, providerEndIndex)
      assert.isBelow(dataSetsStartIndex, providerEndIndex)
    })

    it.skip('should use progressive loading in smart selection', async () => {
      // SKIPPED: Requires SPRegistryService mocking
      let getClientDataSetsCalled = false
      let getAllApprovedProvidersCalled = false

      const mockProvider: ProviderInfo = createSimpleProvider({
        serviceProvider: '0xdddddddddddddddddddddddddddddddddddddddd',
        serviceURL: 'https://pdp-d.example.com',
      })

      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: mockProvider.serviceProvider,
          pdpVerifierDataSetId: 500,
          currentPieceCount: 2,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
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
        },
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
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
        const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {})

        assert.isTrue(getClientDataSetsCalled, 'Should fetch client data sets')
        assert.isFalse(getAllApprovedProvidersCalled, 'Should NOT fetch all providers')
        assert.equal(service.dataSetId, 500)
      } finally {
        global.fetch = originalFetch
      }
    })

    it.skip('should fetch all providers only when no data sets exist', async () => {
      let getAllApprovedProvidersCalled = false

      const mockProviders: ProviderInfo[] = [
        createSimpleProvider({
          serviceProvider: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          serviceURL: 'https://pdp-e.example.com',
        }),
      ]

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => [], // No data sets
        getAllApprovedProviders: async () => {
          getAllApprovedProvidersCalled = true
          return mockProviders
        },
        getNextClientDataSetId: async () => 1,
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      await StorageContext.create(mockSynapse, mockWarmStorageService, {})

      assert.isTrue(getAllApprovedProvidersCalled, 'Should fetch all providers when no data sets')
    })

    it.skip('should handle data set not live', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0xffffffffffffffffffffffffffffffffffffffffffff',
          pdpVerifierDataSetId: 600,
          currentPieceCount: 0,
          isLive: false, // Not live
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
      ]

      const mockWarmStorageService = createMockWarmStorageService(mockDataSets)

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 600,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 600 not found')
      }
    })

    it.skip('should handle conflict between dataSetId and providerAddress', async () => {
      const mockDataSets = [
        {
          railId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x1111222233334444555566667777888899990000', // Different from requested
          pdpVerifierDataSetId: 700,
          currentPieceCount: 0,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          metadata: {},
          pieceMetadata: [],
          clientDataSetId: 1,
        },
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
            return createSimpleProvider({
              serviceProvider: '0x1111222233334444555566667777888899990000',
              serviceURL: 'https://example.com',
            })
          }
          if (providerId === 8) {
            return createSimpleProvider({
              serviceProvider: '0x9999888877776666555544443333222211110000',
              serviceURL: 'https://example2.com',
            })
          }
          return {
            serviceProvider: ADDRESSES.calibration.spRegistry,
            serviceURL: '',
          }
        },
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {
          dataSetId: 700,
          providerAddress: '0x9999888877776666555544443333222211110000', // Different address
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider')
        assert.include(error.message, 'but provider')
        assert.include(error.message, 'was requested')
      }
    })

    it.skip('should retry transaction fetch for up to 180 seconds', async () => {
      // This test validates that the transaction retry logic is implemented
      // The implementation retries getTransaction() for up to 180 seconds (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS)
      // with a 2-second interval (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_POLL_INTERVAL_MS)
      // before throwing an error if the transaction is not found
    })

    it.skip('should fail after 180 seconds if transaction never appears', async () => {
      // This test validates that the transaction retry logic times out after 180 seconds
      // If a transaction is not found after TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS (180 seconds),
      // the implementation throws an error indicating the transaction was not found
    })

    it('should match providers by ID even when payee differs from serviceProvider', async () => {
      // Test scenario: Provider has different payee and serviceProvider addresses
      // This mimics the real-world case where a provider's beneficiary address
      // differs from their operator address
      const provider2WithDifferentPayee = createMockProviderInfo({
        id: 2,
        serviceProvider: '0x682467D59F5679cB0BF13115d4C94550b8218CF2',
        name: 'Provider with different payee',
      })

      const mockDataSets = [
        {
          pdpRailId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x7A1CBda3352f7A2f24CD61Bec32580fb709a8913', // Different from serviceProvider
          serviceProvider: '0x682467D59F5679cB0BF13115d4C94550b8218CF2',
          providerId: 2,
          pdpVerifierDataSetId: 100,
          currentPieceCount: 1,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          clientDataSetId: 1,
          pdpEndEpoch: 0,
          cdnRailId: 0,
          cdnEndEpoch: 0,
          cacheMissRailId: 0,
          metadata: {},
        },
      ]

      // Set up provider registry mocks
      const cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [provider2WithDifferentPayee],
        approvedIds: [2],
      })

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getApprovedProvider: async (id: number) => {
          if (id === 2) return provider2WithDifferentPayee
          return null
        },
        getAllApprovedProviders: async () => [provider2WithDifferentPayee],
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        isProviderIdApproved: async (id: number) => id === 2,
        getApprovedProviderIds: async () => [2],
        getDataSetMetadata: async (dataSetId: number) => {
          const dataSet = mockDataSets.find((d) => d.pdpVerifierDataSetId === dataSetId)
          return dataSet?.metadata ?? {}
        },
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
        const service = await StorageContext.create(mockSynapse, mockWarmStorageService, {})

        // Should successfully match by provider ID despite different payee
        assert.equal(service.dataSetId, 100)
        assert.equal(service.provider.id, 2)
        assert.equal(service.provider.serviceProvider, '0x682467D59F5679cB0BF13115d4C94550b8218CF2')
      } finally {
        global.fetch = originalFetch
        cleanupMocks()
      }
    })

    it('should gracefully fall back to creating new data set when provider not matched', async () => {
      // Test scenario: Selected provider doesn't match any existing data sets
      // Should fall back to creating a new data set instead of throwing error
      const provider3 = createMockProviderInfo({
        id: 3,
        serviceProvider: '0x3333333333333333333333333333333333333333',
        name: 'New Provider',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {},
            data: {
              serviceURL: 'https://provider3.example.com',
              minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
              maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerDay: BigInt(1000000),
              minProvingPeriodInEpochs: 2880n,
              location: 'US',
              paymentTokenAddress: '0x0000000000000000000000000000000000000000',
            },
          },
        },
      })

      const mockDataSets = [
        {
          pdpRailId: 1,
          payer: '0x1234567890123456789012345678901234567890',
          payee: '0x1111111111111111111111111111111111111111',
          serviceProvider: '0x1111111111111111111111111111111111111111',
          providerId: 1, // Different provider ID
          pdpVerifierDataSetId: 50,
          currentPieceCount: 1,
          isLive: true,
          isManaged: true,
          withCDN: false,
          commissionBps: 0,
          clientDataSetId: 1,
          pdpEndEpoch: 0,
          cdnRailId: 0,
          cdnEndEpoch: 0,
          cacheMissRailId: 0,
          metadata: {}, // Empty metadata for exact matching
        },
      ]

      let consoleWarnCalled = false
      const originalWarn = console.warn
      console.warn = (message: string) => {
        if (message.includes('All providers from existing data sets failed health check')) {
          consoleWarnCalled = true
        }
      }

      // Set up provider registry mocks
      const cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [TEST_PROVIDERS.provider1, provider3],
        approvedIds: [1, 3],
      })

      const mockWarmStorageService = {
        getClientDataSetsWithDetails: async () => mockDataSets,
        getApprovedProvider: async (id: number) => {
          if (id === 1) return TEST_PROVIDERS.provider1
          if (id === 3) return provider3
          return null
        },
        getAllApprovedProviders: async () => [TEST_PROVIDERS.provider1, provider3],
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        getNextClientDataSetId: async () => 2,
        isProviderIdApproved: async (id: number) => id === 1 || id === 3,
        getApprovedProviderIds: async () => [1, 3],
      } as any

      // Mock fetch for ping validation
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/ping')) {
          // provider1 uses default 'provider.example.com' - fail it
          if (url.includes('provider.example.com')) {
            throw new Error('Connection refused')
          }
          // provider3 uses custom 'provider3.example.com' - succeed
          if (url.includes('provider3.example.com')) {
            return { status: 200, statusText: 'OK' } as any
          }
          // Default: fail
          throw new Error('Connection refused')
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {})
        // If we reach here without error, it means the fallback succeeded and a provider was selected
        assert.isTrue(consoleWarnCalled, 'Should have logged warning about fallback')
      } catch (_error) {
        // If all providers fail, that's also acceptable as long as the fallback was attempted
        assert.isTrue(consoleWarnCalled, 'Should have logged warning about fallback')
      } finally {
        global.fetch = originalFetch
        console.warn = originalWarn
        cleanupMocks()
      }
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
            perMonth: BigInt(864000),
          },
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const preflight = await service.preflightUpload(Number(SIZE_CONSTANTS.MiB)) // 1 MiB

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
            perMonth: BigInt(1728000),
          },
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: true,
        },
        {}
      )

      const preflight = await service.preflightUpload(Number(SIZE_CONSTANTS.MiB)) // 1 MiB

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
          message:
            'Rate allowance insufficient: current 1000000, need 2000000. Lockup allowance insufficient: current 10000000, need 20000000',
          costs: {
            perEpoch: BigInt(100),
            perDay: BigInt(28800),
            perMonth: BigInt(864000),
          },
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const preflight = await service.preflightUpload(Number(100n * SIZE_CONSTANTS.MiB)) // 100 MiB

      assert.isFalse(preflight.allowanceCheck.sufficient)
      assert.include(preflight.allowanceCheck.message, 'Rate allowance insufficient')
      assert.include(preflight.allowanceCheck.message, 'Lockup allowance insufficient')
    })

    it('should enforce minimum size limit in preflightUpload', async () => {
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      try {
        await service.preflightUpload(126) // 126 bytes (1 under minimum)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'below minimum allowed size')
        assert.include(error.message, '126 bytes')
        assert.include(error.message, '127 bytes')
      }
    })

    it('should enforce maximum size limit in preflightUpload', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      try {
        await service.preflightUpload(Number(210n * SIZE_CONSTANTS.MiB)) // 210 MiB
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
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'

      // Create a mock Synapse with custom download
      const mockSynapseWithDownload = {
        ...mockSynapse,
        download: async (pieceCid: string | PieceCID, options?: any) => {
          assert.equal(pieceCid, testPieceCID)
          assert.equal(options?.providerAddress, mockProvider.serviceProvider)
          assert.equal(options?.withCDN, false)
          return testData
        },
      } as unknown as Synapse

      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapseWithDownload,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

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
        },
      } as unknown as Synapse

      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapseWithError,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      try {
        await service.download(testPieceCID)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.equal(error.message, 'Network error')
      }
    })

    it('should accept empty download options', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
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
        },
      } as unknown as Synapse

      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapseWithOptions,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Test with and without empty options object
      const downloaded1 = await service.download(testPieceCID)
      assert.deepEqual(downloaded1, testData)

      const downloaded2 = await service.download(testPieceCID, {})
      assert.deepEqual(downloaded2, testData)
    })
  })

  describe('upload', () => {
    it('should handle errors in batch processing gracefully', async () => {
      const mockWarmStorageService = {
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
          uploadBatchSize: 2,
        },
        {}
      )
      const serviceAny = service as any

      // Mock PDPServer methods
      serviceAny._pdpServer.uploadPiece = async (data: Uint8Array): Promise<any> => ({
        pieceCid: `bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigm${data[0]}`,
        size: data.length,
      })
      serviceAny._pdpServer.findPiece = async (): Promise<any> => ({
        uuid: 'test-uuid',
      })

      // Use helper to make addPieces fail
      mockAddPieces(serviceAny, {
        shouldFail: true,
        failureMessage: 'Network error during addPieces',
      })

      // Create 3 uploads
      const uploads = [
        service.upload(new Uint8Array(127).fill(1)),
        service.upload(new Uint8Array(128).fill(2)),
        service.upload(new Uint8Array(129).fill(3)),
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
        assert.include(results[2].reason.message, 'Network error during addPieces')
      }
    })

    it('should enforce 200 MiB size limit', async () => {
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Create data that exceeds the limit
      const oversizedData = new Uint8Array(Number(210n * SIZE_CONSTANTS.MiB)) // 210 MiB

      try {
        await service.upload(oversizedData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, '220200960') // 210 * 1024 * 1024
        assert.include(error.message, '209715200') // 200 * 1024 * 1024
      }
    })

    it.skip('should fail if new server transaction is not found on-chain', async () => {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockWarmStorageService = {
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const testData = new Uint8Array(127).fill(42)
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
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`,
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

    it.skip('should fail if new server verification fails', async () => {
      // Skip: This test requires waiting for timeout which makes tests slow
      const mockWarmStorageService = {
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const testData = new Uint8Array(127).fill(42)
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
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`,
        }
      }

      // Mock getTransaction
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 1 }),
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
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const testData = new Uint8Array(127).fill(42)
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
          statusUrl: `https://pdp.example.com/pdp/data-sets/123/pieces/added/${mockTxHash}`,
        }
      }

      // Mock getTransaction
      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => ({ status: 0 }), // Failed transaction
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

    it.skip('should work with old servers that do not provide transaction tracking', async () => {
      // Skipped: Old servers without transaction tracking are no longer supported
      const mockWarmStorageService = {
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const testData = new Uint8Array(127).fill(42)
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

      // Mock addPieces with txHash
      const mockTxHash7 = `0x${'7'.repeat(64)}`
      serviceAny._pdpServer.addPieces = async (
        _dataSetId: number,
        _clientDataSetId: number,
        nextPieceId: number
      ): Promise<any> => {
        const pieceIds = [nextPieceId]
        ;(serviceAny._pdpServer as any)._lastPieceIds = pieceIds
        return {
          message: 'success',
          txHash: mockTxHash7,
        }
      }

      // Mock getPieceAdditionStatus
      serviceAny._pdpServer.getPieceAdditionStatus = async (): Promise<any> => {
        const pieceIds = (serviceAny._pdpServer as any)._lastPieceIds || []
        return {
          txStatus: 'confirmed',
          addMessageOk: true,
          confirmedPieceIds: pieceIds,
        }
      }

      // Mock the provider's getTransaction method

      const result = await service.upload(testData, {
        onPieceAdded: () => {
          pieceAddedCallbackFired = true
        },
      })

      assert.isTrue(pieceAddedCallbackFired, 'onPieceAdded should have been called')
      assert.isUndefined(pieceAddedTransaction, 'Transaction should be undefined for old servers')
      assert.equal(result.pieceId, 0)
    })

    it.skip('should handle piece parking timeout', async () => {
      // Skip this test as it's timing-sensitive and causes issues in CI
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
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
        configurable: true,
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
          configurable: true,
        })
      }
    })

    it('should handle upload piece failure', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum

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
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
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

      // getDataSet already mocked in mockWarmStorageService

      // Use helper to mock addPieces failure
      mockAddPieces(serviceAny, {
        shouldFail: true,
        failureMessage: 'Signature validation failed',
      })

      try {
        await service.upload(testData)
        assert.fail('Should have thrown add pieces error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })

    it('should handle validateDataSet failure', async () => {
      const mockWarmStorageService = {
        validateDataSet: async (): Promise<void> => {
          throw new Error('Data set not managed by this WarmStorage')
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
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

      // getDataSet already mocked to fail in mockWarmStorageService

      try {
        await service.upload(testData)
        assert.fail('Should have thrown getDataSet error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })
  })

  describe('Provider Ping Validation', () => {
    describe('selectRandomProvider with ping validation', () => {
      it('should select first provider that responds to ping', async () => {
        const testProviders: ProviderInfo[] = [
          createSimpleProvider({
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
          }),
          createSimpleProvider({
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
          }),
        ]

        let pingCallCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCallCount++
            // First provider fails, second succeeds
            if (url.includes('pdp1.example.com')) {
              return {
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'Down',
              } as any
            } else if (url.includes('pdp2.example.com')) {
              return { status: 200, statusText: 'OK' } as any
            }
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const result = await (StorageContext as any).selectRandomProvider(testProviders)

          // Should have selected the second provider (first one failed ping)
          assert.equal(result.serviceProvider, testProviders[1].serviceProvider)
          assert.isAtLeast(pingCallCount, 1, 'Should have called ping at least once')
        } finally {
          global.fetch = originalFetch
        }
      })

      // Test removed: selectRandomProvider no longer supports exclusion functionality

      it('should throw error when all providers fail ping', async () => {
        const testProviders: ProviderInfo[] = [
          createSimpleProvider({
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
          }),
          createSimpleProvider({
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
          }),
        ]

        const originalFetch = global.fetch
        global.fetch = async () => {
          // All pings fail
          return {
            status: 500,
            statusText: 'Internal Server Error',
            text: async () => 'All servers down',
          } as any
        }

        try {
          await (StorageContext as any).selectRandomProvider(testProviders)
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'StorageContext selectProviderWithPing failed')
          assert.include(error.message, 'All 2 providers failed health check')
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe.skip('smartSelectProvider with ping validation', () => {
      // SKIPPED: smartSelectProvider is now a private method of StorageContext
      it.skip('should fail when existing providers fail ping validation', async () => {
        // SKIPPED: Requires SPRegistryService mocking
        const testProviders: ProviderInfo[] = [
          createSimpleProvider({
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
          }),
          createSimpleProvider({
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
          }),
        ]

        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProviders[0].serviceProvider, // First provider has existing data set
            pdpVerifierDataSetId: 100,
            currentPieceCount: 0,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: {},
            pieceMetadata: [],
            clientDataSetId: 1,
          },
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
          getAllApprovedProviders: async () => testProviders,
          getProviderIdByAddress: async (address: string) => {
            const idx = testProviders.findIndex((p) => p.serviceProvider.toLowerCase() === address.toLowerCase())
            return idx >= 0 ? idx + 1 : 0
          },
          getApprovedProvider: async (id: number) => testProviders[id - 1] ?? null,
          getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        } as any

        let pingCallCount = 0
        const originalFetch = global.fetch
        global.fetch = async (input: string | URL | Request) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

          if (url.includes('/ping')) {
            pingCallCount++
            // All providers fail ping
            return {
              status: 500,
              statusText: 'Internal Server Error',
              text: async () => 'Down',
            } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          await (StorageContext as any).smartSelectProvider(
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

      it.skip('should select provider when no existing providers are available', async () => {
        // SKIPPED: smartSelectProvider is now a private method requiring full context
        const testProviders: ProviderInfo[] = [
          createSimpleProvider({
            serviceProvider: '0x1111111111111111111111111111111111111111',
            serviceURL: 'https://pdp1.example.com',
          }),
          createSimpleProvider({
            serviceProvider: '0x2222222222222222222222222222222222222222',
            serviceURL: 'https://pdp2.example.com',
          }),
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => [], // No existing data sets
          getAllApprovedProviders: async () => testProviders,
          getProviderIdByAddress: async () => 0,
          getApprovedProvider: async () => null,
          getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
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
            getAddress: async () => '0x1234567890123456789012345678901234567890',
          } as any

          const result = await (StorageContext as any).smartSelectProvider(
            '0x1234567890123456789012345678901234567890',
            false,
            mockWarmStorageService,
            mockSigner
          )

          // Should have selected one of the available providers for new data set
          assert.isTrue(
            testProviders.some((p) => p.serviceProvider === result.provider.serviceProvider),
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
        const testProvider: ProviderInfo = createSimpleProvider({
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
        })

        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider,
            pdpVerifierDataSetId: 100,
            currentPieceCount: 5, // Has pieces, so preferred
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: {},
            pieceMetadata: [],
            clientDataSetId: 1,
          },
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
          getProviderIdByAddress: async () => 1,
          getApprovedProvider: async () => testProvider,
          getAllApprovedProviders: async () => [], // Return empty list to prevent fallback
          getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
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
            getAddress: async () => '0x1234567890123456789012345678901234567890',
          } as any

          const result = await (StorageContext as any).smartSelectProvider(
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

    describe.skip('selectProviderWithPing', () => {
      // SKIPPED: selectProviderWithPing is now a private method of StorageContext
      // ... existing code ...

      it('should deduplicate providers from multiple data sets', async () => {
        const testProvider: ProviderInfo = createSimpleProvider({
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
        })

        // Create multiple data sets with the same provider
        const dataSets = [
          {
            railId: 1,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider,
            pdpVerifierDataSetId: 100,
            currentPieceCount: 5,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: {},
            pieceMetadata: [],
            clientDataSetId: 1,
          },
          {
            railId: 2,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider, // Same provider
            pdpVerifierDataSetId: 101,
            currentPieceCount: 3,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: {},
            pieceMetadata: [],
            clientDataSetId: 2,
          },
          {
            railId: 3,
            payer: '0x1234567890123456789012345678901234567890',
            payee: testProvider.serviceProvider, // Same provider
            pdpVerifierDataSetId: 102,
            currentPieceCount: 1,
            isLive: true,
            isManaged: true,
            withCDN: false,
            commissionBps: 0,
            metadata: {},
            pieceMetadata: [],
            clientDataSetId: 3,
          },
        ]

        const mockWarmStorageService = {
          getClientDataSetsWithDetails: async () => dataSets,
          getProviderIdByAddress: async () => 1,
          getApprovedProvider: async () => testProvider,
          getAllApprovedProviders: async () => [], // Return empty list to prevent fallback
          getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
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
              text: async () => 'Server error',
            } as any
          }

          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          await (StorageContext as any).smartSelectProvider(
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
      const expectedProviderInfo = createSimpleProvider({
        serviceProvider: mockProvider.serviceProvider,
        serviceURL: 'https://updated-pdp.example.com',
      })

      const mockSynapseWithProvider = {
        ...mockSynapse,
        getProviderInfo: async (address: string) => {
          assert.equal(address, mockProvider.serviceProvider)
          return expectedProviderInfo
        },
      } as any
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapseWithProvider,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const providerInfo = await service.getProviderInfo()
      assert.deepEqual(providerInfo, expectedProviderInfo)
    })

    it('should handle errors from Synapse getProviderInfo', async () => {
      const mockSynapseWithError = {
        ...mockSynapse,
        getProviderInfo: async () => {
          throw new Error('Provider not found')
        },
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapseWithError,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      try {
        await service.getProviderInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider not found')
      }
    })
  })

  describe('getDataSetPieces', () => {
    let provider: ethers.Provider
    let signer: ethers.Signer

    beforeEach(() => {
      provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
      signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
    })

    it('should successfully fetch data set pieces', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        getPDPVerifierAddress: () => ADDRESSES.calibration.pdpVerifier,
      } as any

      const testSynapse = {
        getProvider: () => provider,
        getSigner: () => signer,
        getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
        getChainId: () => BigInt(314159),
      } as any

      const service = new StorageContext(
        testSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      const mockDataSetData = {
        id: 292,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0,
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 1500,
      }

      // Mock getActivePieces to return the expected pieces
      const piecesData = mockDataSetData.pieces.map((piece) => {
        const cid = CID.parse(piece.pieceCid)
        return { data: cidBytesToContractHex(cid.bytes) }
      })
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [piecesData, [101n, 102n], false],
          },
        })
      )

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].toString(), mockDataSetData.pieces[0].pieceCid)
      assert.equal(result[1].toString(), mockDataSetData.pieces[1].pieceCid)
    })

    it('should handle empty data set pieces', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        getPDPVerifierAddress: () => ADDRESSES.calibration.pdpVerifier,
      } as any

      const testSynapse = {
        getProvider: () => provider,
        getSigner: () => signer,
        getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
        getChainId: () => BigInt(314159),
      } as any

      const service = new StorageContext(
        testSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock getActivePieces to return no pieces
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        })
      )

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 0)
    })

    it('should handle invalid CID in response', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        getPDPVerifierAddress: () => ADDRESSES.calibration.pdpVerifier,
      } as any

      const testSynapse = {
        getProvider: () => provider,
        getSigner: () => signer,
        getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
        getChainId: () => BigInt(314159),
      } as any

      const service = new StorageContext(
        testSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock getActivePieces to return invalid CID data
      const invalidCidBytes = cidBytesToContractHex(ethers.toUtf8Bytes('invalid-cid-format'))
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[{ data: invalidCidBytes }], [101n], false],
          },
        })
      )

      // The new implementation should throw an error when trying to decode invalid CID data
      try {
        await service.getDataSetPieces()
        assert.fail('Expected an error to be thrown for invalid CID data')
      } catch (error: any) {
        // The error occurs during CID.decode(), not during PieceCID validation
        assert.include(error.message, 'Invalid CID version')
      }
    })

    it('should handle PDP server errors', async () => {
      const mockWarmStorageService = {
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
        getPDPVerifierAddress: () => ADDRESSES.calibration.pdpVerifier,
      } as any

      const testSynapse = {
        getProvider: () => provider,
        getSigner: () => signer,
        getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
        getChainId: () => BigInt(314159),
      } as any

      const service = new StorageContext(
        testSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock getActivePieces to throw an error
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => {
              throw new Error('Data set not found: 999')
            },
          },
        })
      )

      try {
        await service.getDataSetPieces()
        assert.fail('Should have thrown error for contract call error')
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
        getChallengeWindow: async () => 60,
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => {
        throw new Error('Piece not found')
      }
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [],
        nextChallengeEpoch: 5000,
      })

      // Mock provider getBlockNumber for current epoch
      mockEthProvider.getBlockNumber = async () => 4000
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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [
          {
            pieceId: 1,
            pieceCid: { toString: () => mockPieceCID },
          },
        ],
        nextChallengeEpoch: 5000,
      })

      // Mock synapse methods
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlockNumber = async () => 4000
      mockSynapseAny.getNetwork = () => 'calibration'
      mockSynapseAny.getProviderInfo = async () => mockProvider

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.equal(status.retrievalUrl, `https://pdp.example.com/piece/${mockPieceCID}`)
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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [
          {
            pieceId: 1,
            pieceCid: { toString: () => mockPieceCID },
          },
        ],
        nextChallengeEpoch: 5000,
      })

      // Mock synapse - current epoch is in challenge window
      // nextChallengeEpoch (5000) is the START of the window
      // Window ends at 5000 + 60 = 5060
      // Current epoch 5030 is in the middle of the window
      mockEthProvider.getBlockNumber = async () => 5030
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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [
          {
            pieceId: 1,
            pieceCid: { toString: () => mockPieceCID },
          },
        ],
        nextChallengeEpoch: 5000,
      })

      // Mock synapse - current epoch is past the challenge window
      // nextChallengeEpoch (5000) + challengeWindow (60) = 5060 (deadline)
      // Current epoch 5100 is past the deadline
      mockEthProvider.getBlockNumber = async () => 5100
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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [
          {
            pieceId: 1,
            pieceCid: { toString: () => mockPieceCID },
          },
        ],
        nextChallengeEpoch: 0, // No next challenge scheduled
      })

      // Mock synapse
      mockEthProvider.getBlockNumber = async () => 5000
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
      const mockProviderWithSlash: ProviderInfo = {
        ...mockProvider,
      }

      const mockWarmStorageService = {
        getMaxProvingPeriod: async () => 2880,
        getChallengeWindow: async () => 60,
        getCurrentProvingParams: async () => ({
          maxProvingPeriod: 2880,
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProviderWithSlash,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [],
        nextChallengeEpoch: 5000,
      })

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlockNumber = async () => 4000
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
      assert.equal(status.retrievalUrl, `https://pdp.example.com/piece/${mockPieceCID}`)
      // Check that the URL doesn't contain double slashes after the protocol
      const urlWithoutProtocol = (status.retrievalUrl ?? '').substring(8) // Remove 'https://'
      assert.notInclude(urlWithoutProtocol, '//')
    })

    it('should handle invalid PieceCID', async () => {
      const mockWarmStorageService = createMockWarmStorageService()
      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => ({
        id: 123,
        pieces: [
          {
            pieceId: 1,
            pieceCid: { toString: () => mockPieceCID },
          },
        ],
        nextChallengeEpoch: 5000,
      })

      // Mock synapse - 120 epochs before challenge window (1 hour)
      // 5000 - 120 = 4880 (1 hour before window)
      mockEthProvider.getBlockNumber = async () => 4880
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
          challengeWindow: 60,
        }),
        validateDataSet: async (): Promise<void> => {
          /* no-op */
        },
        getDataSet: async (): Promise<any> => ({ clientDataSetId: 1n }),
        getServiceProviderRegistryAddress: () => ADDRESSES.calibration.spRegistry,
      } as any

      const service = new StorageContext(
        mockSynapse,
        mockWarmStorageService,
        mockProvider,
        123,
        {
          withCDN: false,
        },
        {}
      )

      // Mock PDP server methods
      const serviceAny = service as any
      serviceAny._pdpServer.findPiece = async () => ({ uuid: 'test-uuid' })
      serviceAny._pdpServer.getDataSet = async () => {
        throw new Error('Network error')
      }

      // Mock synapse
      const mockSynapseAny = mockSynapse as any
      mockEthProvider.getBlockNumber = async () => 4000
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

  describe('getPieces', () => {
    let provider: ethers.Provider
    let signer: ethers.Signer
    let mockWarmStorage: any
    let testSynapse: any

    beforeEach(() => {
      provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
      signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)

      mockWarmStorage = {
        getPDPVerifierAddress: () => ADDRESSES.calibration.pdpVerifier,
      }

      testSynapse = {
        getProvider: () => provider,
        getSigner: () => signer,
        getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
        getChainId: () => BigInt(314159),
      }
    })

    const createContext = () => {
      return new StorageContext(testSynapse, mockWarmStorage, TEST_PROVIDERS.provider1, 123, { withCDN: false }, {})
    }

    it('should be available on StorageContext', () => {
      // Basic test to ensure the method exists
      assert.isFunction(StorageContext.prototype.getPieces)
    })

    it('should get all active pieces with pagination', async () => {
      // Use actual valid PieceCIDs from test data
      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))
      const piece2Cid = calculatePieceCID(new Uint8Array(256).fill(2))
      const piece3Cid = calculatePieceCID(new Uint8Array(512).fill(3))

      // Mock getActivePieces to return paginated results
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page: return 2 pieces with hasMore=true
              if (offset === 0) {
                return [
                  [{ data: cidBytesToContractHex(piece1Cid.bytes) }, { data: cidBytesToContractHex(piece2Cid.bytes) }],
                  [1n, 2n],
                  true,
                ]
              }
              // Second page: return 1 piece with hasMore=false
              if (offset === 2) {
                return [[{ data: cidBytesToContractHex(piece3Cid.bytes) }], [3n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const context = createContext()

      // Test getPieces - should collect all pages
      const allPieces = []
      for await (const piece of context.getPieces({ batchSize: 2 })) {
        allPieces.push(piece)
      }

      assert.equal(allPieces.length, 3, 'Should return all 3 pieces across pages')
      assert.equal(allPieces[0].pieceId, 1)
      assert.equal(allPieces[0].pieceCid.toString(), piece1Cid.toString())

      assert.equal(allPieces[1].pieceId, 2)
      assert.equal(allPieces[1].pieceCid.toString(), piece2Cid.toString())

      assert.equal(allPieces[2].pieceId, 3)
      assert.equal(allPieces[2].pieceCid.toString(), piece3Cid.toString())
    })

    it('should handle empty results', async () => {
      // Mock getActivePieces to return no pieces
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        })
      )

      const context = createContext()

      const allPieces = []
      for await (const piece of context.getPieces()) {
        allPieces.push(piece)
      }
      assert.equal(allPieces.length, 0, 'Should return empty array for data set with no pieces')
    })

    it('should handle AbortSignal in getPieces', async () => {
      const controller = new AbortController()

      server.use(JSONRPC(presets.basic))

      const context = createContext()

      // Abort before making the call
      controller.abort()

      try {
        for await (const _piece of context.getPieces({ signal: controller.signal })) {
          // Should not reach here
        }
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.equal(error.message, 'StorageContext getPieces failed: Operation aborted')
      }
    })

    it('should work with getPieces generator', async () => {
      // Use actual valid PieceCIDs from test data
      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))
      const piece2Cid = calculatePieceCID(new Uint8Array(256).fill(2))

      // Mock getActivePieces to return paginated results
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page
              if (offset === 0) {
                return [[{ data: cidBytesToContractHex(piece1Cid.bytes) }], [1n], true]
              }
              // Second page
              if (offset === 1) {
                return [[{ data: cidBytesToContractHex(piece2Cid.bytes) }], [2n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const context = createContext()

      // Test the async generator
      const pieces = []
      for await (const piece of context.getPieces({ batchSize: 1 })) {
        pieces.push(piece)
      }

      assert.equal(pieces.length, 2, 'Should yield 2 pieces')
      assert.equal(pieces[0].pieceId, 1)
      assert.equal(pieces[0].pieceCid.toString(), piece1Cid.toString())
      assert.equal(pieces[1].pieceId, 2)
      assert.equal(pieces[1].pieceCid.toString(), piece2Cid.toString())
    })

    it('should handle AbortSignal in getPieces generator during iteration', async () => {
      const controller = new AbortController()

      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))

      // Mock getActivePieces to return a result that triggers pagination
      let callCount = 0
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => {
              callCount++
              // Only return data on first call, then abort
              if (callCount === 1) {
                setTimeout(() => controller.abort(), 0)
                return [[{ data: cidBytesToContractHex(piece1Cid.bytes) }], [1n], true]
              }
              return [[], [], false]
            },
          },
        })
      )

      const context = createContext()

      try {
        const pieces = []
        for await (const piece of context.getPieces({
          batchSize: 1,
          signal: controller.signal,
        })) {
          pieces.push(piece)
          // Give the abort a chance to trigger
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.equal(error.message, 'StorageContext getPieces failed: Operation aborted')
      }
    })
  })
})
