import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getDataSetStorageProvider,
  getDataSetStorageProviderCall,
} from '../src/pdp-verifier/get-data-set-storage-provider.ts'

describe('getDataSetStorageProvider', () => {
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

  describe('getDataSetStorageProviderCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getDataSetStorageProviderCall({
        chain: calibration,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getDataSetStorageProvider')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, calibration.contracts.pdp.address)
      assert.equal(call.abi, calibration.contracts.pdp.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getDataSetStorageProviderCall({
        chain: mainnet,
        dataSetId: 1n,
      })

      assert.equal(call.functionName, 'getDataSetStorageProvider')
      assert.deepEqual(call.args, [1n])
      assert.equal(call.address, mainnet.contracts.pdp.address)
      assert.equal(call.abi, mainnet.contracts.pdp.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getDataSetStorageProviderCall({
        chain: calibration,
        dataSetId: 1n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
    })
  })

  describe('getDataSetStorageProvider (with mocked RPC)', () => {
    it('should fetch data set storage provider', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const [storageProvider, proposedStorageProvider] = await getDataSetStorageProvider(client, { dataSetId: 1n })

      assert.equal(typeof storageProvider, 'string')
      assert.ok(storageProvider.startsWith('0x'))
      assert.equal(typeof proposedStorageProvider, 'string')
      assert.ok(proposedStorageProvider.startsWith('0x'))
    })
  })
})
