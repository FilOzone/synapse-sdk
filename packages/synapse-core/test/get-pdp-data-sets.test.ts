import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPdpDataSets } from '../src/warm-storage/get-pdp-data-sets.ts'

describe('getPdpDataSets', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('getPdpDataSets (with mocked RPC)', () => {
    it('should fetch PDP data sets for a client', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getPdpDataSets(client, {
        address: ADDRESSES.client1,
      })

      assert.ok(dataSets.items.length > 0)
      const [first] = dataSets.items
      assert.ok(first)
      if (!first) return

      // DataSetInfo fields
      assert.equal(typeof first.pdpRailId, 'bigint')
      assert.equal(typeof first.cacheMissRailId, 'bigint')
      assert.equal(typeof first.cdnRailId, 'bigint')
      assert.equal(typeof first.payer, 'string')
      assert.equal(typeof first.payee, 'string')
      assert.equal(typeof first.serviceProvider, 'string')
      assert.equal(typeof first.commissionBps, 'bigint')
      assert.equal(typeof first.clientDataSetId, 'bigint')
      assert.equal(typeof first.pdpEndEpoch, 'bigint')
      assert.equal(typeof first.providerId, 'bigint')
      assert.equal(typeof first.dataSetId, 'bigint')

      // PdpDataSetInfo fields
      assert.equal(typeof first.live, 'boolean')
      assert.equal(typeof first.managed, 'boolean')
      assert.equal(typeof first.cdn, 'boolean')
      assert.equal(typeof first.metadata, 'object')
      assert.ok(first.provider)
      assert.equal(first.provider.id, 1n)
      assert.equal(first.provider.name, 'Test Provider')
    })

    it('should return empty array for client with no data sets', async () => {
      const emptyClientAddress = '0x0000000000000000000000000000000000000001'
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              const [client] = args
              // Return empty array for the specific client address
              if (client.toLowerCase() === emptyClientAddress.toLowerCase()) {
                return [[]]
              }
              // Use default behavior for other addresses
              return presets.basic.warmStorageView?.getClientDataSets?.(args) ?? [[]]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getPdpDataSets(client, {
        address: emptyClientAddress,
      })

      assert.deepEqual(dataSets, { items: [] })
    })

    it('should fetch PDP data sets with custom contract address', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getPdpDataSets(client, {
        address: ADDRESSES.client1,
        contractAddress: calibration.contracts.fwssView.address,
      })

      assert.ok(Array.isArray(dataSets.items))
      if (dataSets.items.length > 0) {
        assert.ok(dataSets.items[0])
        assert.equal(typeof dataSets.items[0].dataSetId, 'bigint')
      }
    })

    it('should preserve order and deduplicate provider enrichment across batches', async () => {
      let providerReads = 0
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getClientDataSets: (args) => {
              const source = presets.basic.warmStorageView?.getClientDataSets?.(args)
              const template = source?.[0]?.[0]
              assert.ok(template)
              return [
                Array.from({ length: 21 }, (_, index) => ({
                  ...template,
                  clientDataSetId: BigInt(index),
                  dataSetId: BigInt(index + 1),
                })),
              ]
            },
          },
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: (args) => {
              providerReads++
              const result = presets.basic.serviceRegistry?.getProviderWithProduct?.(args)
              assert.ok(result)
              return result
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })
      const dataSets = await getPdpDataSets(client, {
        address: ADDRESSES.client1,
        limit: 21n,
      })

      assert.deepEqual(
        dataSets.items.map(({ dataSetId }) => dataSetId),
        Array.from({ length: 21 }, (_, index) => BigInt(index + 1))
      )
      assert.equal(providerReads, 1)
    })
  })
})
