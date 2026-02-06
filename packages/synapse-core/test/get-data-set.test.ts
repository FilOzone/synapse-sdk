import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getDataSet, getDataSetCall } from '../src/warm-storage/get-data-set.ts'

describe('getDataSet', () => {
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

  describe('getDataSetCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getDataSetCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getDataSet')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getDataSetCall({
        chain: mainnet,
        dataSetId: 2n,
      })

      assert.equal(call.functionName, 'getDataSet')
      assert.deepEqual(call.args, [2n])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getDataSetCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getDataSet (with mocked RPC)', () => {
    it('should fetch data set', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSet = await getDataSet(client, {
        dataSetId: 1n,
      })

      assert.deepEqual(dataSet, {
        cacheMissRailId: 0n,
        cdnRailId: 0n,
        clientDataSetId: 0n,
        commissionBps: 100n,
        dataSetId: 1n,
        payee: ADDRESSES.serviceProvider1,
        payer: ADDRESSES.client1,
        pdpEndEpoch: 0n,
        pdpRailId: 1n,
        providerId: 1n,
        serviceProvider: ADDRESSES.serviceProvider1,
      })
    })

    it('should fail to fetch data set that does not exist', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const dataSet = await getDataSet(client, {
        dataSetId: 999n,
      })

      assert.equal(dataSet, undefined)
    })
  })
})
