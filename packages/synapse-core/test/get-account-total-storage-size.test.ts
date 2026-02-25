import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'
import { getAccountTotalStorageSize } from '../src/warm-storage/get-account-total-storage-size.ts'

describe('getAccountTotalStorageSize', () => {
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

  it('should return zero for an account with no datasets', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: () => [[]],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountTotalStorageSize(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.totalSizeBytes, 0n)
    assert.equal(result.datasetCount, 0)
  })

  it('should only count live datasets', async () => {
    const liveStatus = new Map<bigint, boolean>([
      [1n, true],
      [2n, false],
      [3n, true],
    ])

    const leafCounts = new Map<bigint, bigint>([
      [1n, 100n],
      [2n, 200n],
      [3n, 300n],
    ])

    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: () => [[{ ...makeDataSet(1n) }, { ...makeDataSet(2n) }, { ...makeDataSet(3n) }]],
        },
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          dataSetLive: (args) => {
            const dataSetId = args[0]
            return [liveStatus.get(dataSetId) ?? false]
          },
          getDataSetLeafCount: (args) => {
            const dataSetId = args[0]
            return [leafCounts.get(dataSetId) ?? 0n]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountTotalStorageSize(client, {
      address: ADDRESSES.client1,
    })

    // Only datasets 1 and 3 are live: (100 + 300) * 32
    assert.equal(result.totalSizeBytes, (100n + 300n) * SIZE_CONSTANTS.BYTES_PER_LEAF)
    assert.equal(result.datasetCount, 2)
  })

  it('should sum sizes of multiple live datasets correctly', async () => {
    const leafCounts = new Map<bigint, bigint>([
      [1n, 500n],
      [2n, 1000n],
      [3n, 250n],
    ])

    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: () => [[{ ...makeDataSet(1n) }, { ...makeDataSet(2n) }, { ...makeDataSet(3n) }]],
        },
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          dataSetLive: () => [true],
          getDataSetLeafCount: (args) => {
            const dataSetId = args[0]
            return [leafCounts.get(dataSetId) ?? 0n]
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getAccountTotalStorageSize(client, {
      address: ADDRESSES.client1,
    })

    assert.equal(result.totalSizeBytes, (500n + 1000n + 250n) * SIZE_CONSTANTS.BYTES_PER_LEAF)
    assert.equal(result.datasetCount, 3)
  })
})

function makeDataSet(dataSetId: bigint) {
  return {
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
    dataSetId,
  }
}
