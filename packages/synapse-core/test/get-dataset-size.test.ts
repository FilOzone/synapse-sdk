import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getDataSetSizes } from '../src/pdp-verifier/get-dataset-size.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

describe('getDataSetSizes', () => {
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

  it('should return empty array for empty input', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const sizes = await getDataSetSizes(client, { dataSetIds: [] })

    assert.deepEqual(sizes, [])
  })

  it('should return size for a single dataset', async () => {
    const leafCount = 100n

    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [leafCount],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const [size] = await getDataSetSizes(client, { dataSetIds: [1n] })

    assert.equal(size, leafCount * SIZE_CONSTANTS.BYTES_PER_LEAF)
  })

  it('should return 0 for an empty dataset', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [0n],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const [size] = await getDataSetSizes(client, { dataSetIds: [1n] })

    assert.equal(size, 0n)
  })

  it('should return correct sizes for multiple datasets', async () => {
    const leafCounts = new Map<bigint, bigint>([
      [1n, 100n],
      [2n, 200n],
      [3n, 0n],
    ])

    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
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

    const sizes = await getDataSetSizes(client, {
      dataSetIds: [1n, 2n, 3n],
    })

    assert.equal(sizes.length, 3)
    assert.equal(sizes[0], 100n * SIZE_CONSTANTS.BYTES_PER_LEAF)
    assert.equal(sizes[1], 200n * SIZE_CONSTANTS.BYTES_PER_LEAF)
    assert.equal(sizes[2], 0n)
  })
})
