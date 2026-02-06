import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPdpDataSet } from '../src/warm-storage/get-pdp-data-set.ts'

describe('getPdpDataSet', () => {
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

  describe('getPdpDataSet (with mocked RPC)', () => {
    it('should fetch PDP data set', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSet = await getPdpDataSet(client, {
        dataSetId: 1n,
      })

      assert.ok(dataSet)
      if (!dataSet) return

      // DataSetInfo fields
      assert.equal(typeof dataSet.pdpRailId, 'bigint')
      assert.equal(typeof dataSet.cacheMissRailId, 'bigint')
      assert.equal(typeof dataSet.cdnRailId, 'bigint')
      assert.equal(typeof dataSet.payer, 'string')
      assert.equal(typeof dataSet.payee, 'string')
      assert.equal(typeof dataSet.serviceProvider, 'string')
      assert.equal(typeof dataSet.commissionBps, 'bigint')
      assert.equal(typeof dataSet.clientDataSetId, 'bigint')
      assert.equal(typeof dataSet.pdpEndEpoch, 'bigint')
      assert.equal(typeof dataSet.providerId, 'bigint')
      assert.equal(typeof dataSet.dataSetId, 'bigint')
      assert.equal(dataSet.dataSetId, 1n)

      // PdpDataSetInfo fields
      assert.equal(typeof dataSet.live, 'boolean')
      assert.equal(typeof dataSet.managed, 'boolean')
      assert.equal(typeof dataSet.cdn, 'boolean')
      assert.equal(typeof dataSet.metadata, 'object')
      assert.ok(dataSet.provider)
      assert.equal(dataSet.provider.id, 1n)
      assert.equal(dataSet.provider.name, 'Test Provider')
      assert.equal(dataSet.provider.serviceProvider.toLowerCase(), ADDRESSES.serviceProvider1.toLowerCase())
    })

    it('should return undefined for non-existent data set', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSet = await getPdpDataSet(client, {
        dataSetId: 999n,
      })

      assert.equal(dataSet, undefined)
    })

    it('should fetch PDP data set with custom contract address', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSet = await getPdpDataSet(client, {
        dataSetId: 1n,
        contractAddress: calibration.contracts.fwssView.address,
      })

      assert.ok(dataSet)
      assert.equal(dataSet.dataSetId, 1n)
    })
  })
})
