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
        client: ADDRESSES.client1,
      })

      assert.ok(dataSets.length > 0)
      const [first] = dataSets
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
        client: emptyClientAddress,
      })

      assert.ok(Array.isArray(dataSets))
      assert.equal(dataSets.length, 0)
    })

    it('should fetch PDP data sets with custom contract address', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getPdpDataSets(client, {
        client: ADDRESSES.client1,
        contractAddress: calibration.contracts.fwssView.address,
      })

      assert.ok(Array.isArray(dataSets))
      if (dataSets.length > 0) {
        assert.ok(dataSets[0])
        assert.equal(typeof dataSets[0].dataSetId, 'bigint')
      }
    })
  })
})
