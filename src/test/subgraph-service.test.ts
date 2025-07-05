/* globals describe, it, beforeEach, afterEach */
import { assert } from 'chai'
import { SubgraphService } from '../subgraph/service.js'
import { asCommP } from '../commp/index.js'
import type { CommP } from '../types.js'

describe('SubgraphService', () => {
  const mockEndpoint = 'http://localhost:8000/subgraphs/name/test'
  const mockCommP = asCommP(
    'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
  ) as CommP
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
          version: 'v1'
        }
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

  describe('getApprovedProvidersForCommP', () => {
    it('should return providers for a given CommP', async () => {
      const mockResponse = {
        data: {
          roots: [
            {
              id: mockCommP.toString(),
              proofSet: {
                setId: '1',
                owner: {
                  id: '0x123',
                  pdpUrl: 'http://provider.url/pdp',
                  pieceRetrievalUrl: 'http://provider.url/piece',
                  status: 'Approved',
                  address: '0x123'
                }
              }
            }
          ]
        }
      }
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify(mockResponse))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        const providers = await service.getApprovedProvidersForCommP(mockCommP)

        assert.isArray(providers)
        assert.lengthOf(providers, 1)
        assert.equal(providers[0].owner, '0x123')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle invalid CommP', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ data: { roots: [] } }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForCommP(asCommP('invalid') as CommP)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /Invalid CommP/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle no providers found', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ data: { roots: [] } }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        const providers = await service.getApprovedProvidersForCommP(mockCommP)
        assert.isArray(providers)
        assert.lengthOf(providers, 0)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle GraphQL errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response(JSON.stringify({ errors: [{ message: 'GraphQL error' }] }))
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForCommP(mockCommP)
        assert.fail('should have thrown')
      } catch (err) {
        assert.match((err as Error).message, /GraphQL error/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle HTTP errors', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockEndpoint)) {
          return new Response('Internal Server Error', { status: 500 })
        }
        throw new Error(`Unexpected URL: ${url}`)
      }
      try {
        const service = new SubgraphService({ endpoint: mockEndpoint })
        await service.getApprovedProvidersForCommP(mockCommP)
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
            pdpUrl: 'http://provider.url/pdp',
            pieceRetrievalUrl: 'http://provider.url/piece'
          }
        }
      }
      global.fetch = async () => new Response(JSON.stringify(mockResponse))

      const service = new SubgraphService({ endpoint: mockEndpoint })
      const provider = await service.getProviderByAddress(mockAddress)

      assert.isNotNull(provider)
      assert.equal(provider?.owner, mockAddress)
    })

    it('should return null if provider not found', async () => {
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
                address: '0x123',
                pdpUrl: 'https://provider1.com',
                pieceRetrievalUrl: 'https://retrieval1.com',
                registeredAt: '1640995200',
                approvedAt: '1641081600'
              },
              {
                id: '0x456',
                address: '0x456',
                pdpUrl: 'https://provider2.com',
                pieceRetrievalUrl: 'https://retrieval2.com',
                registeredAt: '1640995300',
                approvedAt: '1641081700'
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
          assert.equal(providers[0].owner, '0x123')
          assert.equal(providers[1].owner, '0x456')
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
                address: '0x123',
                pdpUrl: 'https://provider1.com',
                pieceRetrievalUrl: 'https://retrieval1.com',
                registeredAt: '1640995200',
                approvedAt: '1641081600'
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'ProvidersFlexible')
            assert.deepEqual(body.variables.where, { status: 'APPROVED', totalProofSets_gte: '5' })
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
            where: { status: 'APPROVED', totalProofSets_gte: '5' },
            first: 10,
            skip: 20,
            orderBy: 'approvedAt',
            orderDirection: 'desc'
          })

          assert.isArray(providers)
          assert.lengthOf(providers, 1)
          assert.equal(providers[0].owner, '0x123')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should return empty array when no providers found', async () => {
        const mockResponse = {
          data: {
            providers: []
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const providers = await service.queryProviders({ where: { status: 'NONEXISTENT' } })

          assert.isArray(providers)
          assert.lengthOf(providers, 0)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('queryProofSets', () => {
      it('should query proof sets with default options', async () => {
        const mockResponse = {
          data: {
            proofSets: [
              {
                id: 'proof-set-1',
                setId: '1',
                listener: '0xlistener1',
                clientAddr: '0xclient1',
                withCDN: true,
                isActive: true,
                leafCount: '100',
                challengeRange: '10',
                lastProvenEpoch: '1000',
                nextChallengeEpoch: '1010',
                totalRoots: '50',
                totalDataSize: '1000000',
                totalProofs: '25',
                totalProvedRoots: '45',
                totalFaultedPeriods: '2',
                totalFaultedRoots: '5',
                metadata: 'test metadata',
                createdAt: '1640995200',
                updatedAt: '1641081600',
                owner: {
                  id: '0x123',
                  address: '0x123',
                  pdpUrl: 'https://provider1.com',
                  pieceRetrievalUrl: 'https://retrieval1.com',
                  registeredAt: '1640995200',
                  approvedAt: '1641081600'
                },
                rail: {
                  id: 'rail-1',
                  railId: '1',
                  token: '0xtoken',
                  paymentRate: '1000',
                  lockupPeriod: '86400',
                  settledUpto: '1000',
                  endEpoch: '2000'
                }
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'ProofSetsFlexible')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const proofSets = await service.queryProofSets()

          assert.isArray(proofSets)
          assert.lengthOf(proofSets, 1)
          assert.equal(proofSets[0].id, 'proof-set-1')
          assert.equal(proofSets[0].setId, 1)
          assert.equal(proofSets[0].isActive, true)
          assert.equal(proofSets[0].owner.owner, '0x123')
          assert.isObject(proofSets[0].rail)
          assert.equal(proofSets[0].rail?.railId, 1)
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query proof sets with custom filters', async () => {
        const mockResponse = {
          data: {
            proofSets: [
              {
                id: 'proof-set-active',
                setId: '2',
                listener: '0xlistener2',
                clientAddr: '0xclient2',
                withCDN: false,
                isActive: true,
                leafCount: '200',
                challengeRange: '20',
                lastProvenEpoch: '2000',
                nextChallengeEpoch: '2020',
                totalRoots: '100',
                totalDataSize: '2000000',
                totalProofs: '50',
                totalProvedRoots: '90',
                totalFaultedPeriods: '1',
                totalFaultedRoots: '10',
                metadata: 'active proof set',
                createdAt: '1640995300',
                updatedAt: '1641081700',
                owner: {
                  id: '0x456',
                  address: '0x456',
                  pdpUrl: 'https://provider2.com',
                  pieceRetrievalUrl: 'https://retrieval2.com',
                  registeredAt: '1640995300',
                  approvedAt: '1641081700'
                },
                rail: null
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'ProofSetsFlexible')
            assert.deepEqual(body.variables.where, { isActive: true, totalDataSize_gte: '1000000' })
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const proofSets = await service.queryProofSets({
            where: { isActive: true, totalDataSize_gte: '1000000' },
            first: 20,
            orderBy: 'totalDataSize',
            orderDirection: 'desc'
          })

          assert.isArray(proofSets)
          assert.lengthOf(proofSets, 1)
          assert.equal(proofSets[0].isActive, true)
          assert.isUndefined(proofSets[0].rail)
        } finally {
          global.fetch = originalFetch
        }
      })
    })

    describe('queryRoots', () => {
      it('should query roots with default options', async () => {
        const mockResponse = {
          data: {
            roots: [
              {
                id: 'root-1',
                setId: '1',
                rootId: '100',
                rawSize: '1048576',
                leafCount: '256',
                cid: '0x0181e203922020ad7d9bed3fb5acbb7db4fb4feeac94c1dde689886cd1e8b64f1bbdf935eec011',
                removed: false,
                totalProofsSubmitted: '10',
                totalPeriodsFaulted: '1',
                lastProvenEpoch: '1000',
                lastProvenAt: '1640995200',
                lastFaultedEpoch: '999',
                lastFaultedAt: '1640995100',
                createdAt: '1640995000',
                metadata: 'root metadata',
                proofSet: {
                  id: 'proof-set-1',
                  setId: '1',
                  isActive: true,
                  owner: {
                    id: '0x123',
                    address: '0x123',
                    pdpUrl: 'https://provider1.com',
                    pieceRetrievalUrl: 'https://retrieval1.com',
                    registeredAt: '1640995200',
                    approvedAt: '1641081600'
                  }
                }
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'RootsFlexible')
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const roots = await service.queryRoots()

          assert.isArray(roots)
          assert.lengthOf(roots, 1)
          assert.equal(roots[0].id, 'root-1')
          assert.equal(roots[0].rootId, 100)
          assert.equal(roots[0].removed, false)
          assert.equal(roots[0].proofSet.owner.owner, '0x123')
        } finally {
          global.fetch = originalFetch
        }
      })

      it('should query roots with size filter', async () => {
        const mockResponse = {
          data: {
            roots: [
              {
                id: 'large-root',
                setId: '2',
                rootId: '200',
                rawSize: '10485760',
                leafCount: '2560',
                cid: '0x0181e203922020ad7d9bed3fb5acbb7db4fb4feeac94c1dde689886cd1e8b64f1bbdf935eec011',
                removed: false,
                totalProofsSubmitted: '20',
                totalPeriodsFaulted: '0',
                lastProvenEpoch: '2000',
                lastProvenAt: '1641000000',
                lastFaultedEpoch: '0',
                lastFaultedAt: '0',
                createdAt: '1641000000',
                metadata: 'large root',
                proofSet: {
                  id: 'proof-set-2',
                  setId: '2',
                  isActive: true,
                  owner: {
                    id: '0x456',
                    address: '0x456',
                    pdpUrl: 'https://provider2.com',
                    pieceRetrievalUrl: 'https://retrieval2.com',
                    registeredAt: '1640995300',
                    approvedAt: '1641081700'
                  }
                }
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'RootsFlexible')
            assert.deepEqual(body.variables.where, { removed: false, rawSize_gte: '5000000' })
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const roots = await service.queryRoots({
            where: { removed: false, rawSize_gte: '5000000' },
            first: 50,
            orderBy: 'rawSize',
            orderDirection: 'desc'
          })

          assert.isArray(roots)
          assert.lengthOf(roots, 1)
          assert.equal(roots[0].rawSize, 10485760)
          assert.equal(
            roots[0].cid?.toString(),
            'baga6ea4seaqk27m35u73llf3pw2pwt7ovskmdxpgrgegzupiwzhrxppzgxxmaei'
          )
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
                proofSetId: '1',
                rootIds: ['100', '101', '102'],
                currentChallengeEpoch: '1000',
                nextChallengeEpoch: '1010',
                periodsFaulted: '3',
                deadline: '1641000000',
                createdAt: '1640995200',
                proofSet: {
                  id: 'proof-set-1',
                  setId: '1',
                  owner: {
                    id: '0x123',
                    address: '0x123',
                    pdpUrl: 'https://provider1.com',
                    pieceRetrievalUrl: 'https://retrieval1.com',
                    registeredAt: '1640995200',
                    approvedAt: '1641081600'
                  }
                }
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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
          assert.equal(faultRecords[0].proofSetId, 1)
          assert.deepEqual(faultRecords[0].rootIds, [100, 101, 102])
          assert.equal(faultRecords[0].proofSet.owner.owner, '0x123')
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
                proofSetId: '2',
                rootIds: ['200'],
                currentChallengeEpoch: '2000',
                nextChallengeEpoch: '2010',
                periodsFaulted: '1',
                deadline: '1641100000',
                createdAt: '1641000000',
                proofSet: {
                  id: 'proof-set-2',
                  setId: '2',
                  owner: {
                    id: '0x456',
                    address: '0x456',
                    pdpUrl: 'https://provider2.com',
                    pieceRetrievalUrl: 'https://retrieval2.com',
                    registeredAt: '1640995300',
                    approvedAt: '1641081700'
                  }
                }
              }
            ]
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            const body = JSON.parse(init?.body as string)
            assert.include(body.query, 'FaultRecordsFlexible')
            assert.deepEqual(body.variables.where, { createdAt_gte: '1640995200' })
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
            orderDirection: 'desc'
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
            faultRecords: []
          }
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response(JSON.stringify(mockResponse))
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          const faultRecords = await service.queryFaultRecords({
            where: { proofSetId: '999' }
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
          errors: [{ message: 'Invalid where clause' }]
        }

        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
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

      it('should handle HTTP errors in queryProofSets', async () => {
        global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes(mockEndpoint)) {
            return new Response('Bad Request', { status: 400 })
          }
          throw new Error(`Unexpected URL: ${url}`)
        }

        try {
          const service = new SubgraphService({ endpoint: mockEndpoint })
          await service.queryProofSets()
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
