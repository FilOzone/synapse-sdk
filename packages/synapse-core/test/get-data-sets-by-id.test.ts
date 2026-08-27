/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getDataSetsById } from '../src/warm-storage/get-data-sets-by-id.ts'

describe('getDataSetsById', () => {
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

  it('returns an empty map for empty input', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const dataSets = await getDataSetsById(client, { dataSetIds: [] })

    assert.deepEqual(dataSets, new Map())
  })

  it('indexes data sets by ID and preserves missing entries as null', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const dataSets = await getDataSetsById(client, { dataSetIds: [1n, 999n] })

    assert.equal(dataSets.size, 2)
    assert.deepEqual(dataSets.get(1n), {
      cacheMissRailId: 0n,
      cdnRailId: 0n,
      clientDataSetId: 0n,
      commissionBps: 100n,
      dataSetId: 1n,
      payee: ADDRESSES.serviceProvider1,
      payer: ADDRESSES.client1,
      pdpEndEpoch: 0n,
      pdpRailId: 1n,
      providerId: 1n,
      pendingOneTimePayments: 0n,
      lifecycleReserveBalance: 0n,
      serviceProvider: ADDRESSES.serviceProvider1,
    })
    assert.equal(dataSets.get(999n), null)
  })

  it('reads duplicate IDs once', async () => {
    let callCount = 0
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getDataSet: (args) => {
            callCount++
            return presets.basic.warmStorageView.getDataSet(args)
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const dataSets = await getDataSetsById(client, { dataSetIds: [1n, 1n] })

    assert.equal(dataSets.size, 1)
    assert.equal(callCount, 1)
  })
})
