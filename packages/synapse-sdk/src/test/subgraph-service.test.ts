/* globals describe, it, beforeEach, afterEach */
import { assert } from 'chai'
import { asPieceCID } from '../piece/index.ts'
import { SubgraphService } from '../subgraph/service.ts'
import type { PieceCID } from '../types.ts'

// Test utilities and mock data factories
const TEST_CONSTANTS = {
  MOCK_ENDPOINT: 'http://localhost:8000/subgraphs/name/test',
  MOCK_PIECE_CID: asPieceCID('bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq') as PieceCID,
  MOCK_ADDRESS: '0x123',
  MOCK_PRODUCT_DATA:
    '{"serviceURL": "https://calib.ezpdpz.net", "minPieceSizeInBytes": "1024", "maxPieceSizeInBytes": "34359738368", "ipniPiece": "false", "ipniIpfs": "false", "storagePricePerTibPerDay": "1000000", "minProvingPeriodInEpochs": "30", "location": "unknown", "paymentTokenAddress": ""}',
} as const

/**
 * Creates a mock provider object with default values
 */
function createMockProvider(overrides: Partial<any> = {}) {
  return {
    id: '0x123',
    providerId: 1,
    name: 'Test Provider',
    description: 'Test Provider Description',
    serviceProvider: '0x123',
    payee: '0x123',
    status: 'APPROVED',
    approvedAt: 1633072800,
    registeredAt: 1633072800,
    products: [
      {
        decodedProductData: TEST_CONSTANTS.MOCK_PRODUCT_DATA,
        productType: '0',
        isActive: true,
        capabilityValues: [],
        capabilityKeys: [],
      },
    ],
    ...overrides,
  }
}

/**
 * Creates a mock data set object
 */
function createMockDataSet(overrides: Partial<any> = {}) {
  return {
    id: '0x123-1',
    setId: '1',
    listener: '0xlistener',
    payer: '0xpayer',
    withCDN: false,
    isActive: true,
    leafCount: '100',
    challengeRange: '10',
    lastProvenEpoch: '1000',
    nextChallengeEpoch: '1010',
    totalPieces: '50',
    totalDataSize: '1000000',
    totalProofs: '25',
    totalProvedPieces: '45',
    totalFaultedPeriods: '2',
    totalFaultedPieces: '5',
    metadataKeys: ['key1'],
    metadataValues: ['value1'],
    createdAt: '1633072800',
    updatedAt: '1633072900',
    serviceProvider: createMockProvider(),
    rails: [
      {
        id: 'rail-1',
        type: 'PAYMENT',
        railId: '1',
        token: '0xtoken',
        paymentRate: '1000',
        settledUpto: '500',
        endEpoch: '2000',
      },
    ],
    ...overrides,
  }
}

/**
 * Creates a mock piece object
 */
function createMockPiece(overrides: Partial<any> = {}) {
  return {
    id: 'piece-1',
    setId: '1',
    pieceId: '1',
    rawSize: '1024',
    leafCount: '10',
    cid: `0x${TEST_CONSTANTS.MOCK_PIECE_CID.bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '')}`,
    removed: false,
    totalProofsSubmitted: '5',
    totalPeriodsFaulted: '1',
    lastProvenEpoch: '1000',
    lastProvenAt: '1633072800',
    lastFaultedEpoch: '999',
    lastFaultedAt: '1633072700',
    createdAt: '1633072800',
    metadataKeys: ['key1'],
    metadataValues: ['value1'],
    dataSet: {
      id: '0x123-1',
      setId: '1',
      isActive: true,
      serviceProvider: createMockProvider(),
    },
    ...overrides,
  }
}

/**
 * Creates a mock fault record object
 */
function createMockFaultRecord(overrides: Partial<any> = {}) {
  return {
    id: 'fault-1',
    dataSetId: '1',
    pieceIds: ['1', '2'],
    currentChallengeEpoch: '1000',
    nextChallengeEpoch: '1010',
    periodsFaulted: '2',
    deadline: '1633072800',
    createdAt: '1633072800',
    dataSet: {
      id: '0x123-1',
      setId: '1',
      serviceProvider: createMockProvider(),
    },
    ...overrides,
  }
}

/**
 * Creates a mock fetch function that responds to specific endpoints
 */
function createMockFetch(responses: Record<string, any>) {
  return async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (url.includes(TEST_CONSTANTS.MOCK_ENDPOINT)) {
      const responseKey = Object.keys(responses).find((key) => key === 'default' || url.includes(key))
      const response = responses[responseKey || 'default']

      if (response.error) {
        return new Response(response.error.body || 'Error', {
          status: response.error.status || 500,
        })
      }

      return new Response(JSON.stringify(response))
    }

    throw new Error(`Unexpected URL: ${url}`)
  }
}

/**
 * Utility to run a test with mocked fetch and automatic cleanup
 */
async function withMockFetch<T>(responses: Record<string, any>, testFn: () => Promise<T>): Promise<T> {
  const originalFetch = global.fetch
  global.fetch = createMockFetch(responses)

  try {
    return await testFn()
  } finally {
    global.fetch = originalFetch
  }
}

/**
 * Utility to test error scenarios
 */
async function expectError(testFn: () => Promise<any>, expectedPattern: RegExp, message = 'should have thrown') {
  try {
    await testFn()
    assert.fail(message)
  } catch (err) {
    assert.match((err as Error).message, expectedPattern)
  }
}

describe('SubgraphService', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('constructor', () => {
    it('should initialize with a direct endpoint', () => {
      const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
      assert.isNotNull(service)
    })

    it('should initialize with a Goldsky config', () => {
      const service = new SubgraphService({
        goldsky: {
          projectId: 'test-project',
          subgraphName: 'test-subgraph',
          version: 'v1',
        },
      })
      assert.isNotNull(service)
    })

    it('should throw an error for invalid config', () => {
      assert.throws(
        () => new SubgraphService({}),
        /Invalid configuration: provide either endpoint or complete goldsky config/
      )
    })
  })

  describe('getApprovedProvidersForPieceCID', () => {
    it('should return providers for a given PieceCID', async () => {
      const mockResponse = {
        data: {
          pieces: [
            {
              id: TEST_CONSTANTS.MOCK_PIECE_CID.toString(),
              dataSet: {
                setId: '1',
                serviceProvider: createMockProvider(),
              },
            },
          ],
        },
      }

      await withMockFetch({ default: mockResponse }, async () => {
        const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
        const providers = await service.getApprovedProvidersForPieceCID(TEST_CONSTANTS.MOCK_PIECE_CID)

        assert.isArray(providers)
        assert.lengthOf(providers, 1)
        assert.equal(providers[0].serviceProvider, '0x123')
      })
    })

    it('should handle invalid PieceCID', async () => {
      await expectError(async () => {
        const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
        await service.getApprovedProvidersForPieceCID(asPieceCID('invalid') as PieceCID)
      }, /Invalid PieceCID/)
    })

    it('should handle no providers found', async () => {
      const mockResponse = { data: { pieces: [] } }

      await withMockFetch({ default: mockResponse }, async () => {
        const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
        const providers = await service.getApprovedProvidersForPieceCID(TEST_CONSTANTS.MOCK_PIECE_CID)

        assert.isArray(providers)
        assert.lengthOf(providers, 0)
      })
    })

    it('should handle GraphQL errors', async () => {
      const mockResponse = { errors: [{ message: 'GraphQL error' }] }

      await expectError(
        () =>
          withMockFetch({ default: mockResponse }, async () => {
            const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
            await service.getApprovedProvidersForPieceCID(TEST_CONSTANTS.MOCK_PIECE_CID)
          }),
        /GraphQL error/
      )
    })

    it('should handle HTTP errors', async () => {
      const mockResponse = { error: { status: 500, body: 'Internal Server Error' } }

      await expectError(
        () =>
          withMockFetch({ default: mockResponse }, async () => {
            const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
            await service.getApprovedProvidersForPieceCID(TEST_CONSTANTS.MOCK_PIECE_CID)
          }),
        /HTTP 500: Internal Server Error/
      )
    })
  })

  describe('getProviderByAddress', () => {
    it('should return a provider for a given address', async () => {
      const mockResponse = {
        data: {
          provider: createMockProvider(),
        },
      }

      await withMockFetch({ default: mockResponse }, async () => {
        const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
        const provider = await service.getProviderByAddress(TEST_CONSTANTS.MOCK_ADDRESS)

        assert.isNotNull(provider)
        assert.equal(provider?.serviceProvider, TEST_CONSTANTS.MOCK_ADDRESS)
      })
    })

    it('should return null if provider not found', async () => {
      const mockResponse = { data: { provider: null } }

      await withMockFetch({ default: mockResponse }, async () => {
        const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
        const provider = await service.getProviderByAddress(TEST_CONSTANTS.MOCK_ADDRESS)

        assert.isNull(provider)
      })
    })

    it('should handle GraphQL errors', async () => {
      const mockResponse = { errors: [{ message: 'GraphQL error' }] }

      await expectError(
        () =>
          withMockFetch({ default: mockResponse }, async () => {
            const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
            await service.getProviderByAddress(TEST_CONSTANTS.MOCK_ADDRESS)
          }),
        /GraphQL error/
      )
    })

    it('should handle HTTP errors', async () => {
      const mockResponse = { error: { status: 500, body: 'Internal Server Error' } }

      await expectError(
        () =>
          withMockFetch({ default: mockResponse }, async () => {
            const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
            await service.getProviderByAddress(TEST_CONSTANTS.MOCK_ADDRESS)
          }),
        /HTTP 500: Internal Server Error/
      )
    })
  })

  describe('flexible query methods', () => {
    describe('queryProviders', () => {
      it('should query providers with default options', async () => {
        const mockResponse = {
          data: {
            providers: [createMockProvider()],
          },
        }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const providers = await service.queryProviders()

          assert.isArray(providers)
          assert.lengthOf(providers, 1)
          assert.equal(providers[0].serviceProvider, '0x123')
        })
      })

      it('should handle empty results', async () => {
        const mockResponse = { data: { providers: [] } }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const providers = await service.queryProviders()

          assert.isArray(providers)
          assert.lengthOf(providers, 0)
        })
      })

      it('should handle HTTP errors', async () => {
        const mockResponse = { error: { status: 400, body: 'Bad Request' } }

        await expectError(
          () =>
            withMockFetch({ default: mockResponse }, async () => {
              const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
              await service.queryProviders()
            }),
          /HTTP 400: Bad Request/
        )
      })
    })

    describe('queryDataSets', () => {
      it('should query data sets with default options', async () => {
        const mockResponse = {
          data: {
            dataSets: [createMockDataSet()],
          },
        }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const dataSets = await service.queryDataSets()

          assert.isArray(dataSets)
          assert.lengthOf(dataSets, 1)
          assert.equal(dataSets[0].id, '0x123-1')
        })
      })

      it('should handle empty results', async () => {
        const mockResponse = { data: { dataSets: [] } }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const dataSets = await service.queryDataSets()

          assert.isArray(dataSets)
          assert.lengthOf(dataSets, 0)
        })
      })

      it('should handle HTTP errors', async () => {
        const mockResponse = { error: { status: 400, body: 'Bad Request' } }

        await expectError(
          () =>
            withMockFetch({ default: mockResponse }, async () => {
              const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
              await service.queryDataSets()
            }),
          /HTTP 400: Bad Request/
        )
      })
    })

    describe('queryPieces', () => {
      it('should query pieces with default options', async () => {
        const mockResponse = {
          data: {
            pieces: [createMockPiece()],
          },
        }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const pieces = await service.queryPieces()

          assert.isArray(pieces)
          assert.lengthOf(pieces, 1)
          assert.equal(pieces[0].id, 'piece-1')
        })
      })

      it('should handle empty results', async () => {
        const mockResponse = { data: { pieces: [] } }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const pieces = await service.queryPieces()

          assert.isArray(pieces)
          assert.lengthOf(pieces, 0)
        })
      })

      it('should handle HTTP errors', async () => {
        const mockResponse = { error: { status: 400, body: 'Bad Request' } }

        await expectError(
          () =>
            withMockFetch({ default: mockResponse }, async () => {
              const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
              await service.queryPieces()
            }),
          /HTTP 400: Bad Request/
        )
      })
    })

    describe('queryFaultRecords', () => {
      it('should query fault records with default options', async () => {
        const mockResponse = {
          data: {
            faultRecords: [createMockFaultRecord()],
          },
        }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const faultRecords = await service.queryFaultRecords()

          assert.isArray(faultRecords)
          assert.lengthOf(faultRecords, 1)
          assert.equal(faultRecords[0].id, 'fault-1')
        })
      })

      it('should handle empty results', async () => {
        const mockResponse = { data: { faultRecords: [] } }

        await withMockFetch({ default: mockResponse }, async () => {
          const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
          const faultRecords = await service.queryFaultRecords()

          assert.isArray(faultRecords)
          assert.lengthOf(faultRecords, 0)
        })
      })

      it('should handle HTTP errors', async () => {
        const mockResponse = { error: { status: 400, body: 'Bad Request' } }

        await expectError(
          () =>
            withMockFetch({ default: mockResponse }, async () => {
              const service = new SubgraphService({ endpoint: TEST_CONSTANTS.MOCK_ENDPOINT })
              await service.queryFaultRecords()
            }),
          /HTTP 400: Bad Request/
        )
      })
    })
  })
})
