import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createPublicClient, http as viemHttp } from 'viem'
import { calibration, devnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import * as Piece from '../src/piece/piece.ts'
import {
  chainResolver,
  filbeamResolver,
  pingProviders,
  providersResolver,
  resolvePieceUrl,
} from '../src/piece/resolve-piece-url.ts'
import type { PDPProvider } from '../src/sp-registry/types.ts'

describe('resolve-piece-url', () => {
  const server = setup()
  const client = createPublicClient({
    chain: calibration,
    transport: viemHttp(),
  })
  const pieceCidString = 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy'
  const pieceCid = Piece.parse(pieceCidString)
  const expectedPdpUrl = `https://pdp.example.com/piece/${pieceCidString}`

  function createProvider(serviceURL: string, id: bigint = 1n): PDPProvider {
    return {
      id,
      serviceProvider: ADDRESSES.serviceProvider1,
      payee: ADDRESSES.payee1,
      isActive: true,
      name: `provider-${id}`,
      description: 'test provider',
      pdp: {
        serviceURL,
        minPieceSizeInBytes: 127n,
        maxPieceSizeInBytes: 1024n * 1024n * 1024n,
        storagePricePerTibPerDay: 1n,
        minProvingPeriodInEpochs: 1n,
        location: 'US',
        paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        ipniPiece: false,
        ipniIpfs: false,
      },
    }
  }

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('resolvePieceUrl', () => {
    it('returns the first successful resolver result', async () => {
      let aborted = false

      const fastResolver = async () => expectedPdpUrl
      const slowResolver = async ({ signal }: resolvePieceUrl.ResolverFnOptionsType) => {
        return await new Promise<string>((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
          setTimeout(() => resolve('https://slow.example/piece'), 100)
        })
      }

      const url = await resolvePieceUrl({
        client,
        address: ADDRESSES.client1,
        pieceCid,
        resolvers: [fastResolver, slowResolver],
      })

      assert.equal(url, expectedPdpUrl)
      assert.equal(aborted, true)
    })

    it('throws AggregateError when all resolvers fail', async () => {
      const failA = async () => {
        throw new Error('resolver a failed')
      }
      const failB = async () => {
        throw new Error('resolver b failed')
      }

      await assert.rejects(
        resolvePieceUrl({
          client,
          address: ADDRESSES.client1,
          pieceCid,
          resolvers: [failA, failB],
        }),
        AggregateError
      )
    })

    it('uses defaultResolvers and falls back from FilBeam to chain resolver', async () => {
      const filbeamUrl = `https://${ADDRESSES.client1}.${calibration.filbeam?.retrievalDomain}/${pieceCidString}`

      server.use(
        JSONRPC(presets.basic),
        http.head(filbeamUrl, () => HttpResponse.text('not found', { status: 404 })),
        http.get('https://pdp.example.com/pdp/piece', ({ request }) => {
          const url = new URL(request.url)
          return HttpResponse.json({ pieceCid: url.searchParams.get('pieceCid') }, { status: 200 })
        })
      )

      const result = await resolvePieceUrl({
        client,
        address: ADDRESSES.client1,
        pieceCid,
      })

      assert.equal(result, expectedPdpUrl)
    })

    it('throws AggregateError when defaultResolvers all fail', async () => {
      const filbeamUrl = `https://${ADDRESSES.client1}.${calibration.filbeam?.retrievalDomain}/${pieceCidString}`

      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: () => [[]],
          },
        }),
        http.head(filbeamUrl, () => HttpResponse.text('not found', { status: 404 }))
      )

      await assert.rejects(
        resolvePieceUrl({
          client,
          address: ADDRESSES.client1,
          pieceCid,
        }),
        AggregateError
      )
    })
  })

  describe('filbeamResolver', () => {
    it('returns filbeam URL when HEAD succeeds', async () => {
      const url = `https://${ADDRESSES.client1}.${calibration.filbeam?.retrievalDomain}/${pieceCidString}`
      server.use(
        http.head(url, () => {
          return new HttpResponse(null, { status: 200 })
        })
      )

      const result = await filbeamResolver({
        client,
        address: ADDRESSES.client1,
        pieceCid,
      })
      assert.equal(result, url)
    })

    it('throws when chain does not support FilBeam', async () => {
      const devnetClient = createPublicClient({
        chain: devnet,
        transport: viemHttp(),
      })

      await assert.rejects(
        filbeamResolver({
          client: devnetClient,
          address: ADDRESSES.client1,
          pieceCid,
        }),
        /FilBeam not supported on this chain/
      )
    })
  })

  describe('pingProviders', () => {
    it('returns first provider with piece found', async () => {
      const providers: PDPProvider[] = [
        createProvider('https://missing.example.com/'),
        createProvider('https://pdp.example.com/', 2n),
      ]

      server.use(
        http.get('https://missing.example.com/pdp/piece', () => HttpResponse.text('not found', { status: 404 })),
        http.get('https://pdp.example.com/pdp/piece', ({ request }) => {
          const url = new URL(request.url)
          return HttpResponse.json({ pieceCid: url.searchParams.get('pieceCid') }, { status: 200 })
        })
      )

      const result = await pingProviders(providers, pieceCid)
      assert.ok(result)
      assert.equal(result?.id, 2n)
    })

    it('returns undefined when no provider has the piece', async () => {
      const providers: PDPProvider[] = [createProvider('https://missing.example.com/')]

      server.use(
        http.get('https://missing.example.com/pdp/piece', () => HttpResponse.text('not found', { status: 404 }))
      )

      const result = await pingProviders(providers, pieceCid)
      assert.equal(result, undefined)
    })
  })

  describe('providersResolver', () => {
    it('returns serviceURL when a provider contains the piece', async () => {
      const providers: PDPProvider[] = [createProvider('https://pdp.example.com/', 5n)]
      server.use(
        http.get('https://pdp.example.com/pdp/piece', ({ request }) => {
          const url = new URL(request.url)
          return HttpResponse.json({ pieceCid: url.searchParams.get('pieceCid') }, { status: 200 })
        })
      )

      const resolver = providersResolver(providers)
      const result = await resolver({
        client,
        address: ADDRESSES.client1,
        pieceCid,
      })
      assert.equal(result, 'https://pdp.example.com/')
    })

    it('throws when no provider has the piece', async () => {
      const providers: PDPProvider[] = [createProvider('https://missing.example.com/')]
      server.use(
        http.get('https://missing.example.com/pdp/piece', () => HttpResponse.text('not found', { status: 404 }))
      )

      const resolver = providersResolver(providers)
      await assert.rejects(
        resolver({
          client,
          address: ADDRESSES.client1,
          pieceCid,
        }),
        /No provider found/
      )
    })
  })

  describe('chainResolver', () => {
    it('resolves piece URL from on-chain provider list', async () => {
      server.use(
        JSONRPC(presets.basic),
        http.get('https://pdp.example.com/pdp/piece', ({ request }) => {
          const url = new URL(request.url)
          return HttpResponse.json({ pieceCid: url.searchParams.get('pieceCid') }, { status: 200 })
        })
      )

      const result = await chainResolver({
        client,
        address: ADDRESSES.client1,
        pieceCid,
      })

      assert.equal(result, expectedPdpUrl)
    })

    it('throws when client has no active managed data sets', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: () => [[]],
          },
        })
      )

      await assert.rejects(
        chainResolver({
          client,
          address: ADDRESSES.client1,
          pieceCid,
        }),
        /No provider found/
      )
    })

    it('ignores non-live, unmanaged, and expired data sets', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: () => [
              [
                {
                  pdpRailId: 1n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: ADDRESSES.client1,
                  payee: ADDRESSES.serviceProvider1,
                  serviceProvider: ADDRESSES.serviceProvider1,
                  commissionBps: 100n,
                  clientDataSetId: 0n,
                  pdpEndEpoch: 0n,
                  providerId: 1n,
                  cdnEndEpoch: 0n,
                  dataSetId: 1n,
                },
                {
                  pdpRailId: 2n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: ADDRESSES.client1,
                  payee: ADDRESSES.serviceProvider2,
                  serviceProvider: ADDRESSES.serviceProvider2,
                  commissionBps: 100n,
                  clientDataSetId: 1n,
                  pdpEndEpoch: 0n,
                  providerId: 2n,
                  cdnEndEpoch: 0n,
                  dataSetId: 2n,
                },
                {
                  pdpRailId: 3n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: ADDRESSES.client1,
                  payee: ADDRESSES.serviceProvider1,
                  serviceProvider: ADDRESSES.serviceProvider1,
                  commissionBps: 100n,
                  clientDataSetId: 2n,
                  pdpEndEpoch: 1n,
                  providerId: 1n,
                  cdnEndEpoch: 0n,
                  dataSetId: 3n,
                },
              ],
            ],
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: (args) => {
              const [dataSetId] = args
              return [dataSetId === 2n]
            },
            getDataSetListener: (args) => {
              const [dataSetId] = args
              if (dataSetId === 2n) {
                return [ADDRESSES.zero]
              }
              return [ADDRESSES.calibration.warmStorage]
            },
          },
        })
      )

      await assert.rejects(
        chainResolver({
          client,
          address: ADDRESSES.client1,
          pieceCid,
        }),
        /No provider found/
      )
    })
  })
})
