import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getClientDataSetsLength,
  getClientDataSetsLengthCall,
} from '../src/warm-storage/get-client-data-sets-length.ts'

describe('getClientDataSetsLength', () => {
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

  describe('getClientDataSetsLengthCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getClientDataSetsLengthCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSetsLength')
      assert.deepEqual(call.args, [ADDRESSES.client1])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getClientDataSetsLengthCall({
        chain: mainnet,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSetsLength')
      assert.deepEqual(call.args, [ADDRESSES.client1])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getClientDataSetsLengthCall({
        chain: calibration,
        address: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getClientDataSetsLength (with mocked RPC)', () => {
    it('should fetch client data sets length', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const count = await getClientDataSetsLength(client, {
        address: ADDRESSES.client1,
      })

      assert.equal(typeof count, 'bigint')
      assert.equal(count, 1n)
    })
  })
})
