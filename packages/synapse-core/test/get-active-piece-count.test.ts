import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getActivePieceCount, getActivePieceCountCall } from '../src/pdp-verifier/get-active-piece-count.ts'

describe('getActivePieceCount', () => {
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

  describe('getActivePieceCountCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getActivePieceCountCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getActivePieceCount')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.pdp.address)
      assert.equal(call.abi, calibration.contracts.pdp.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getActivePieceCountCall({
        chain: mainnet,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getActivePieceCount')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, mainnet.contracts.pdp.address)
      assert.equal(call.abi, mainnet.contracts.pdp.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getActivePieceCountCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getActivePieceCount (with mocked RPC)', () => {
    it('should fetch active piece count', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const count = await getActivePieceCount(client, { dataSetId: 1n })

      assert.equal(typeof count, 'bigint')
      assert.equal(count, 2n)
    })
  })
})
