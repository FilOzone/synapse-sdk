import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getActivePieces, getActivePiecesCall } from '../src/pdp-verifier/get-active-pieces.ts'

describe('getActivePieces', () => {
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

  describe('getActivePiecesCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getActivePiecesCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getActivePieces')
      assert.deepEqual(call.args, [1n, 0n, 100n])
      assert.equal(call.address, calibration.contracts.pdp.address)
      assert.equal(call.abi, calibration.contracts.pdp.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getActivePiecesCall({
        chain: mainnet,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getActivePieces')
      assert.deepEqual(call.args, [1n, 0n, 100n])
      assert.equal(call.address, mainnet.contracts.pdp.address)
      assert.equal(call.abi, mainnet.contracts.pdp.abi)
    })

    it('should use provided offset and limit', () => {
      const call = getActivePiecesCall({
        chain: calibration,
        dataSetId: 1n,
        offset: 10n,
        limit: 50n,
      })

      assert.deepEqual(call.args, [1n, 10n, 50n])
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getActivePiecesCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getActivePieces (with mocked RPC)', () => {
    it('should fetch active pieces', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const [piecesData, pieceIds, hasMore] = await getActivePieces(client, { dataSetId: 1n })

      assert.ok(Array.isArray(piecesData))
      assert.ok(Array.isArray(pieceIds))
      assert.equal(typeof hasMore, 'boolean')
    })
  })
})
