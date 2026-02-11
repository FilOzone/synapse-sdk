import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getClientDataSets, getClientDataSetsCall } from '../src/warm-storage/get-client-data-sets.ts'

describe('getClientDataSets', () => {
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

  describe('getClientDataSetsCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getClientDataSetsCall({
        chain: mainnet,
        address: ADDRESSES.client1,
      })

      assert.equal(call.functionName, 'getClientDataSets')
      assert.deepEqual(call.args, [ADDRESSES.client1])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getClientDataSetsCall({
        chain: calibration,
        address: ADDRESSES.client1,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getClientDataSets (with mocked RPC)', () => {
    it('should fetch client data sets', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSets = await getClientDataSets(client, {
        address: ADDRESSES.client1,
      })

      assert.ok(dataSets.length > 0)
      const [first] = dataSets
      assert.ok(first)
      if (!first) return

      assert.equal(typeof first.pdpRailId, 'bigint')
      assert.equal(typeof first.cacheMissRailId, 'bigint')
      assert.equal(typeof first.cdnRailId, 'bigint')
      assert.equal(typeof first.payer, 'string')
      assert.equal(typeof first.payee, 'string')
      assert.equal(typeof first.serviceProvider, 'string')
      assert.equal(typeof first.commissionBps, 'bigint')
      assert.equal(typeof first.clientDataSetId, 'bigint')
      assert.equal(typeof first.pdpEndEpoch, 'bigint')
      assert.equal(typeof first.providerId, 'bigint')
      assert.equal(typeof first.dataSetId, 'bigint')
    })
  })
})
