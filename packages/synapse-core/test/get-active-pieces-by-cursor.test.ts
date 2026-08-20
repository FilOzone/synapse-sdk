import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, toHex } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getActivePiecesByCursor,
  getActivePiecesByCursorCall,
} from '../src/pdp-verifier/get-active-pieces-by-cursor.ts'
import * as Piece from '../src/piece/index.ts'

describe('getActivePiecesByCursor', () => {
  const server = setup()

  before(async () => server.start())
  after(() => server.stop())
  beforeEach(() => server.resetHandlers())

  it('creates literal ABI calls', () => {
    for (const chain of [calibration, mainnet]) {
      const call = getActivePiecesByCursorCall({ chain, dataSetId: 1n, startPieceId: 10n, limit: 50n })
      assert.equal(call.functionName, 'getActivePiecesByCursor')
      assert.deepEqual(call.args, [1n, 10n, 50n])
      assert.equal(call.address, chain.contracts.pdp.address)
    }
  })

  it('keeps the raw call literal', () => {
    const call = getActivePiecesByCursorCall({ chain: calibration, dataSetId: 1n, startPieceId: 0n, limit: 0n })
    assert.deepEqual(call.args, [1n, 0n, 0n])
  })

  it('returns sparse piece IDs and advances from the last source ID', async () => {
    const first = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
    const second = Piece.from('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace')
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getActivePiecesByCursor: (args) => {
            assert.deepEqual(args, [1n, 5n, 2n])
            return [[{ data: toHex(first.bytes) }, { data: toHex(second.bytes) }], [5n, 11n], true]
          },
        },
      })
    )
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getActivePiecesByCursor(client, { dataSetId: 1n, cursor: 5n, limit: 2n })
    assert.deepEqual(
      page.items.map((item) => item.id),
      [5n, 11n]
    )
    assert.equal(page.nextCursor, 12n)
  })

  it('uses the bounded default and terminates exactly', async () => {
    server.use(JSONRPC(presets.basic))
    const client = createPublicClient({ chain: calibration, transport: http() })
    const page = await getActivePiecesByCursor(client, { dataSetId: 1n })
    assert.equal(page.items.length, 2)
    assert.equal(page.nextCursor, undefined)
  })

  it('rejects invalid action pagination before RPC', async () => {
    const client = createPublicClient({ chain: calibration, transport: http() })
    await assert.rejects(getActivePiecesByCursor(client, { dataSetId: 1n, limit: 0n }))
    await assert.rejects(getActivePiecesByCursor(client, { dataSetId: 1n, cursor: -1n }))
  })
})
