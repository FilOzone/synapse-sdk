import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getClientDataSetIds, getClientDataSetIdsCall } from '../src/warm-storage/get-client-data-set-ids.ts'

describe('getClientDataSetIds', () => {
  const server = setup()

  before(async () => server.start())
  after(() => server.stop())
  beforeEach(() => server.resetHandlers())

  it('creates literal ABI calls', () => {
    for (const chain of [calibration, mainnet]) {
      const call = getClientDataSetIdsCall({
        chain,
        address: ADDRESSES.client1,
        offset: 10n,
        limit: 51n,
      })
      assert.equal(call.functionName, 'clientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 10n, 51n])
    }
  })

  it('uses look-ahead and hides the extra ID', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          clientDataSets: (args) => {
            assert.deepEqual(args.slice(1), [5n, 3n])
            return [[10n, 11n, 12n]]
          },
        },
      })
    )
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getClientDataSetIds(client, { address: ADDRESSES.client1, cursor: 5n, limit: 2n })
    assert.deepEqual(page, { items: [10n, 11n], nextCursor: 7n })
  })

  it('returns a terminal partial page', async () => {
    server.use(JSONRPC(presets.basic))
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getClientDataSetIds(client, { address: ADDRESSES.client1 })
    assert.ok(page.items.every((id) => typeof id === 'bigint'))
    assert.equal(page.nextCursor, undefined)
  })
})
