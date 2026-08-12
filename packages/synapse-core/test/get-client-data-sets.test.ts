import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getClientDataSets, getClientDataSetsCall } from '../src/warm-storage/get-client-data-sets.ts'

describe('getClientDataSets', () => {
  const server = setup()

  before(async () => server.start())
  after(() => server.stop())
  beforeEach(() => server.resetHandlers())

  it('creates literal ABI calls', () => {
    for (const chain of [calibration, mainnet]) {
      const call = getClientDataSetsCall({
        chain,
        address: ADDRESSES.client1,
        offset: 10n,
        limit: 51n,
      })
      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 10n, 51n])
      assert.equal(call.address, chain.contracts.fwssView.address)
    }
  })

  it('uses a bounded default with one-item look-ahead', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: (args) => {
            assert.deepEqual(args.slice(1), [0n, 101n])
            return presets.basic.warmStorageView.getClientDataSets?.(args) ?? [[]]
          },
        },
      })
    )
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getClientDataSets(client, { address: ADDRESSES.client1 })
    assert.ok(page.items.length > 0)
    assert.equal(page.nextCursor, undefined)
  })

  it('hides the look-ahead item and returns an exact cursor', async () => {
    const [sample] = presets.basic.warmStorageView.getClientDataSets?.([ADDRESSES.client1, 0n, 3n])?.[0] ?? []
    assert.ok(sample)
    const source = [sample, { ...sample, dataSetId: 2n }, { ...sample, dataSetId: 3n }]
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: (args) => {
            assert.deepEqual(args.slice(1), [7n, 3n])
            return [source.slice(0, 3)]
          },
        },
      })
    )
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getClientDataSets(client, { address: ADDRESSES.client1, cursor: 7n, limit: 2n })
    assert.equal(page.items.length, 2)
    assert.equal(page.nextCursor, 9n)
  })

  it('rejects invalid pagination before RPC', async () => {
    const client = createPublicClient({ chain: calibration, transport: http() })
    await assert.rejects(getClientDataSets(client, { address: ADDRESSES.client1, limit: 0n }))
    await assert.rejects(getClientDataSets(client, { address: ADDRESSES.client1, cursor: -1n }))
  })
})
