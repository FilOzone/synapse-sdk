import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getClientDataSetsIds, getClientDataSetsIdsCall } from '../src/warm-storage/get-client-data-sets-ids.ts'

describe('getClientDataSetsIds', () => {
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

  describe('getClientDataSetsIdsCall', () => {
    it('should create call with calibration chain defaults and default offset/limit', () => {
      const call = getClientDataSetsIdsCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'clientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 0n])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getClientDataSetsIdsCall({
        chain: mainnet,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'clientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 0n])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use explicit offset and limit', () => {
      const call = getClientDataSetsIdsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        offset: 10n,
        limit: 50n,
      })

      assert.equal(call.functionName, 'clientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1, 10n, 50n])
    })

    it('should use custom contract address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getClientDataSetsIdsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })

    it('should default offset to 0n when only limit is provided', () => {
      const call = getClientDataSetsIdsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        limit: 100n,
      })

      assert.deepEqual(call.args, [ADDRESSES.client1, 0n, 100n])
    })
  })

  describe('getClientDataSetsIds (with mocked RPC)', () => {
    it('should fetch client data set IDs', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const ids = await getClientDataSetsIds(client, {
        address: ADDRESSES.client1,
      })

      assert.ok(Array.isArray(ids))
      assert.ok(ids.length > 0)
      assert.equal(typeof ids[0], 'bigint')
    })
  })
})
