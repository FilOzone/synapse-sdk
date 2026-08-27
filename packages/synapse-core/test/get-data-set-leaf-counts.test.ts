import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getDataSetLeafCounts } from '../src/pdp-verifier/get-data-set-leaf-counts.ts'

describe('getDataSetLeafCounts', () => {
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

  it('should return an empty map for empty input', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const leafCounts = await getDataSetLeafCounts(client, { dataSetIds: [] })

    assert.deepEqual(leafCounts, new Map())
  })

  it('should return the leaf count for a single data set', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [100n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const leafCounts = await getDataSetLeafCounts(client, { dataSetIds: [1n] })

    assert.deepEqual(leafCounts, new Map([[1n, 100n]]))
  })

  it('should index leaf counts by data set ID', async () => {
    const leafCountsByDataSet = new Map<bigint, bigint>([
      [1n, 100n],
      [2n, 200n],
      [3n, 0n],
    ])

    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: (args) => [leafCountsByDataSet.get(args[0]) ?? 0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const leafCounts = await getDataSetLeafCounts(client, {
      dataSetIds: [2n, 3n, 1n],
    })

    assert.deepEqual(
      leafCounts,
      new Map([
        [2n, 200n],
        [3n, 0n],
        [1n, 100n],
      ])
    )
  })

  it('should read duplicate data set IDs once', async () => {
    let callCount = 0

    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: () => {
            callCount++
            return [100n]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const leafCounts = await getDataSetLeafCounts(client, { dataSetIds: [1n, 1n] })

    assert.deepEqual(leafCounts, new Map([[1n, 100n]]))
    assert.equal(callCount, 1)
  })

  it('should return zero for a data set that is not live', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: (args) => {
            if (args[0] === 2n) {
              throw new Error('Data set not live')
            }
            return [10n]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const leafCounts = await getDataSetLeafCounts(client, { dataSetIds: [1n, 2n] })

    assert.deepEqual(
      leafCounts,
      new Map([
        [1n, 10n],
        [2n, 0n],
      ])
    )
  })
})
