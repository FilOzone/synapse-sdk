/* globals describe, it, beforeEach, afterEach */
import { assert } from 'chai'
import { asPieceCID } from '../piece/index.ts'
import { SubgraphService } from '../subgraph/service.ts'
import type { PieceCID } from '../types.ts'

describe('SubgraphService', () => {
  const mockEndpoint = 'http://localhost:8000/subgraphs/name/test'
  const mockPieceCID = asPieceCID('bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq') as PieceCID
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('constructor', () => {
    it('should initialize with a direct endpoint', () => {
      const service = new SubgraphService({ endpoint: mockEndpoint })
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
              id: mockPieceCID.toString(),
              dataSet: {
                setId: '1',
                serviceProvider: {
                  id: '0x123',
                  serviceProvider: '0x123',
                  payee: '0x123',
                  serviceURL: 'http://provider.url/pdp',
                  status: 'Approved',
                },
              },
            },
          ],
        },
      }
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify(mockResponse))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        const providers = await service.getApprovedProvidersForPieceCID(mockPieceCID)

        assert.isArray(providers)
        assert.lengthOf(providers, 1)
        assert.equal(providers[0].serviceProvider, '0x123')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle invalid PieceCID', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ data: { pieces: [] } }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForPieceCID(asPieceCID('invalid') as PieceCID)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /Invalid PieceCID/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle no providers found', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ data: { pieces: [] } }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        const providers = await service.getApprovedProvidersForPieceCID(mockPieceCID)
        assert.isArray(providers)
        assert.lengthOf(providers, 0)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle GraphQL errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ errors: [{ message: 'GraphQL error' }] }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForPieceCID(mockPieceCID)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /GraphQL error/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle HTTP errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response('Internal Server Error', { status: 500 })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForPieceCID(mockPieceCID)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /HTTP 500: Internal Server Error/)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('getProviderByAddress', () => {
    const mockAddress = '0x456'

    it('should return a provider for a given address', async () => {
      const mockResponse = {
        data: {
          provider: {
            id: mockAddress,
            serviceURL: 'http://provider.url/pdp',
          },
        },
      }
      global.fetch = async () => new Response(JSON.stringify(mockResponse))

      const service = new SubgraphService({ endpoint: mockEndpoint })
      const provider = await service.getProviderByAddress(mockAddress)

      assert.isNotNull(provider)
      assert.equal(provider?.serviceProvider, mockAddress)
    })

    it('should return null if provider not found', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ data: { provider: null } }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        const provider = await service.getProviderByAddress(mockAddress)
        assert.isNull(provider)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle GraphQL errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ errors: [{ message: 'GraphQL error' }] }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getProviderByAddress(mockAddress)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /GraphQL error/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle HTTP errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response('Internal Server Error', { status: 500 })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getProviderByAddress(mockAddress)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /HTTP 500: Internal Server Error/)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('flexible query methods', () => {
    describe('queryProviders', () => {
      it('should query providers with default options', async () => {
        const mockResponse = {
          data: {
            providers: [
              {
                id: '0x123',
                serviceProvider: '0x123',
                payee: '0x123',
                serviceURL: 'https://provider1.com',
                registeredAt: '1640995200',
                approvedAt: '1641081600',
              },
              {
                id: '0x456',
                serviceProvider: '0x456',
                payee: '0x456',
                serviceURL: 'https://provider2.com',
                registeredAt: '1640995300',
                approvedAt: '1641081700',
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'ProvidersFlexible')
            assert.deepEqual(body.variables.where, {})
            assert.equal(body.variables.first, 10)
            assert.equal(body.variables.skip, 0)
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const providers = await service.queryProviders()

          assert.isArray(providers)
          assert.lengthOf(providers, 2)
          assert.equal(providers[0].serviceProvider, '0x123')
          assert.equal(providers[1].serviceProvider, '0x456')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query providers with custom where clause and pagination', async () => {
        const mockResponse = {
          data: {
            providers: [
              {
                id: '0x123',
                serviceProvider: '0x123',
                payee: '0x123',
                serviceURL: 'https://provider1.com',
                registeredAt: '1640995200',
                approvedAt: '1641081600',
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'ProvidersFlexible')
            assert.deepEqual(body.variables.where, {
              status: 'APPROVED',
              totalDataSets_gte: '5',
            })
            assert.equal(body.variables.first, 10)
            assert.equal(body.variables.skip, 20)
            assert.equal(body.variables.orderBy, 'approvedAt')
            assert.equal(body.variables.orderDirection, 'desc')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const providers = await service.queryProviders({
            where: { status: 'APPROVED', totalDataSets_gte: '5' },
            first: 10,
            skip: 20,
            orderBy: 'approvedAt',
            orderDirection: 'desc',
          })

          assert.isArray(providers)
          assert.lengthOf(providers, 1)
          assert.equal(providers[0].serviceProvider, '0x123')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should return empty array when no providers found', async () => {
        const mockResponse = {
          data: {
            providers: [],
          },
        }

        global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const providers = await service.queryProviders({
            where: { status: 'NONEXISTENT' },
          })

          assert.isArray(providers)
          assert.lengthOf(providers, 0)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('queryDataSets', () => {
      it('should query data sets with default options', async () => {
        const mockResponse = {
          data: {
            dataSets: [
              {
                id: 'data-set-1',
                setId: '1',
                listener: '0xlistener1',
                clientAddr: '0xclient1',
                withCDN: true,
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
                metadata: 'test metadata',
                createdAt: '1640995200',
                updatedAt: '1641081600',
                serviceProvider: {
                  id: '0x123',
                  serviceProvider: '0x123',
                  payee: '0x123',
                  serviceURL: 'https://provider1.com',
                  registeredAt: '1640995200',
                  approvedAt: '1641081600',
                },
                rail: {
                  id: 'rail-1',
                  railId: '1',
                  token: '0xtoken',
                  paymentRate: '1000',
                  lockupPeriod: '86400',
                  settledUpto: '1000',
                  endEpoch: '2000',
                },
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'DataSetsFlexible')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const dataSets = await service.queryDataSets()

          assert.isArray(dataSets)
          assert.lengthOf(dataSets, 1)
          assert.equal(dataSets[0].id, 'data-set-1')
          assert.equal(dataSets[0].setId, 1)
          assert.equal(dataSets[0].isActive, true)
          assert.equal(dataSets[0].serviceProvider.serviceProvider, '0x123')
          assert.isObject(dataSets[0].rail)
          assert.equal(dataSets[0].rail?.railId, 1)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query data sets with custom filters', async () => {
        const mockResponse = {
          data: {
            dataSets: [
              {
                id: 'data-set-active',
                setId: '2',
                listener: '0xlistener2',
                clientAddr: '0xclient2',
                withCDN: false,
                isActive: true,
                leafCount: '200',
                challengeRange: '20',
                lastProvenEpoch: '2000',
                nextChallengeEpoch: '2020',
                totalPieces: '100',
                totalDataSize: '2000000',
                totalProofs: '50',
                totalProvedPieces: '90',
                totalFaultedPeriods: '1',
                totalFaultedPieces: '10',
                metadata: 'active data set',
                createdAt: '1640995300',
                updatedAt: '1641081700',
                serviceProvider: {
                  id: '0x456',
                  serviceProvider: '0x456',
                  payee: '0x456',
                  serviceURL: 'https://provider2.com',
                  registeredAt: '1640995300',
                  approvedAt: '1641081700',
                },
                rail: null,
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'DataSetsFlexible')
            assert.deepEqual(body.variables.where, {
              isActive: true,
              totalDataSize_gte: '1000000',
            })
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const dataSets = await service.queryDataSets({
            where: { isActive: true, totalDataSize_gte: '1000000' },
            first: 20,
            orderBy: 'totalDataSize',
            orderDirection: 'desc',
          })

          assert.isArray(dataSets)
          assert.lengthOf(dataSets, 1)
          assert.equal(dataSets[0].isActive, true)
          assert.isUndefined(dataSets[0].rail)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('queryPieces', () => {
      it('should query pieces with default options', async () => {
        const mockResponse = {
          data: {
            pieces: [
              {
                id: 'piece-1',
                setId: '1',
                pieceId: '100',
                rawSize: '1048576',
                leafCount: '256',
                cid: '0x015591202480803f10ad7d9bed3fb5acbb7db4fb4feeac94c1dde689886cd1e8b64f1bbdf935eec011',
                removed: false,
                totalProofsSubmitted: '10',
                totalPeriodsFaulted: '1',
                lastProvenEpoch: '1000',
                lastProvenAt: '1640995200',
                lastFaultedEpoch: '999',
                lastFaultedAt: '1640995100',
                createdAt: '1640995000',
                metadata: 'piece metadata',
                dataSet: {
                  id: 'data-set-1',
                  setId: '1',
                  isActive: true,
                  serviceProvider: {
                    id: '0x123',
                    serviceProvider: '0x123',
                    payee: '0x123',
                    serviceURL: 'https://provider1.com',
                    registeredAt: '1640995200',
                    approvedAt: '1641081600',
                  },
                },
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'PiecesFlexible')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const pieces = await service.queryPieces()

          assert.isArray(pieces)
          assert.lengthOf(pieces, 1)
          assert.equal(pieces[0].id, 'piece-1')
          assert.equal(pieces[0].pieceId, 100)
          assert.equal(pieces[0].removed, false)
          assert.equal(pieces[0].dataSet.serviceProvider.serviceProvider, '0x123')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query pieces with size filter', async () => {
        const mockResponse = {
          data: {
            pieces: [
              {
                id: 'large-piece',
                setId: '2',
                pieceId: '200',
                rawSize: '10485760',
                leafCount: '2560',
                cid: '0x015591202480803f10ad7d9bed3fb5acbb7db4fb4feeac94c1dde689886cd1e8b64f1bbdf935eec011',
                removed: false,
                totalProofsSubmitted: '20',
                totalPeriodsFaulted: '0',
                lastProvenEpoch: '2000',
                lastProvenAt: '1641000000',
                lastFaultedEpoch: '0',
                lastFaultedAt: '0',
                createdAt: '1641000000',
                metadata: 'large piece',
                dataSet: {
                  id: 'data-set-2',
                  setId: '2',
                  isActive: true,
                  serviceProvider: {
                    id: '0x456',
                    serviceProvider: '0x456',
                    payee: '0x456',
                    serviceURL: 'https://provider2.com',
                    registeredAt: '1640995300',
                    approvedAt: '1641081700',
                  },
                },
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'PiecesFlexible')
            assert.deepEqual(body.variables.where, {
              removed: false,
              rawSize_gte: '5000000',
            })
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const pieces = await service.queryPieces({
            where: { removed: false, rawSize_gte: '5000000' },
            first: 50,
            orderBy: 'rawSize',
            orderDirection: 'desc',
          })

          assert.isArray(pieces)
          assert.lengthOf(pieces, 1)
          assert.equal(pieces[0].rawSize, 10485760)
          assert.equal(pieces[0].cid?.toString(), 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace')
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('queryFaultRecords', () => {
      it('should query fault records with default options', async () => {
        const mockResponse = {
          data: {
            faultRecords: [
              {
                id: 'fault-1',
                dataSetId: '1',
                pieceIds: ['100', '101', '102'],
                currentChallengeEpoch: '1000',
                nextChallengeEpoch: '1010',
                periodsFaulted: '3',
                deadline: '1641000000',
                createdAt: '1640995200',
                dataSet: {
                  id: 'data-set-1',
                  setId: '1',
                  serviceProvider: {
                    id: '0x123',
                    serviceProvider: '0x123',
                    payee: '0x123',
                    serviceURL: 'https://provider1.com',
                    registeredAt: '1640995200',
                    approvedAt: '1641081600',
                  },
                },
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'FaultRecordsFlexible')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const faultRecords = await service.queryFaultRecords()

          assert.isArray(faultRecords)
          assert.lengthOf(faultRecords, 1)
          assert.equal(faultRecords[0].id, 'fault-1')
          assert.equal(faultRecords[0].dataSetId, 1)
          assert.deepEqual(faultRecords[0].pieceIds, [100, 101, 102])
          assert.equal(faultRecords[0].dataSet.serviceProvider.serviceProvider, '0x123')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query fault records with time filter', async () => {
        const mockResponse = {
          data: {
            faultRecords: [
              {
                id: 'recent-fault',
                dataSetId: '2',
                pieceIds: ['200'],
                currentChallengeEpoch: '2000',
                nextChallengeEpoch: '2010',
                periodsFaulted: '1',
                deadline: '1641100000',
                createdAt: '1641000000',
                dataSet: {
                  id: 'data-set-2',
                  setId: '2',
                  serviceProvider: {
                    id: '0x456',
                    serviceProvider: '0x456',
                    payee: '0x456',
                    serviceURL: 'https://provider2.com',
                    registeredAt: '1640995300',
                    approvedAt: '1641081700',
                  },
                },
              },
            ],
          },
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'FaultRecordsFlexible')
            assert.deepEqual(body.variables.where, {
              createdAt_gte: '1640995200',
            })
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const faultRecords = await service.queryFaultRecords({
            where: { createdAt_gte: '1640995200' },
            first: 25,
            orderBy: 'createdAt',
            orderDirection: 'desc',
          })

          assert.isArray(faultRecords)
          assert.lengthOf(faultRecords, 1)
          assert.equal(faultRecords[0].createdAt, 1641000000)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should handle empty fault records response', async () => {
        const mockResponse = {
          data: {
            faultRecords: [],
          },
        }

        global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const faultRecords = await service.queryFaultRecords({
            where: { dataSetId: '999' },
          })

          assert.isArray(faultRecords)
          assert.lengthOf(faultRecords, 0)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('error handling for flexible queries', () => {
      it('should handle GraphQL errors in queryProviders', async () => {
        const mockErrorResponse = {
          errors: [{ message: 'Invalid where clause' }],
        }

        global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response(JSON.stringify(mockErrorResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          await service.queryProviders({ where: { invalidField: 'value' } })
          assert.fail('should have thrown')
        } catch (err) {
          assert.match((err as Error).message, /GraphQL error/)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should handle HTTP errors in queryDataSets', async () => {
        global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response('Bad Request', { status: 400 })
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          await service.queryDataSets()
          assert.fail('should have thrown')
        } catch (err) {
          assert.match((err as Error).message, /HTTP 400: Bad Request/)
        } finally {
          global.fetch = originalFetch
        }
      })
    })
  })
})
