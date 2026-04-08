import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, zeroAddress } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  getDataSetStorageProvider,
  getDataSetStorageProviderCall,
  parseDataSetStorageProvider,
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

      const data = await getDataSetStorageProvider(client, { dataSetId: 1n })

      if (data == null) {
        assert.fail('Data set storage provider is null')
      }

      assert.equal(typeof data[0], 'string')
      assert.ok(data[0].startsWith('0x'))
      assert.equal(data[1], null)
    })

    it('should convert a zero proposed provider address to null', () => {
      const provider = parseDataSetStorageProvider(['0x1234567890123456789012345678901234567890', zeroAddress])

      assert.equal(provider?.[1], null)
    })

    it('should return null when the data set is not live', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getDataSetStorageProvider: () => {
              throw new Error('Data set not live')
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const data = await getDataSetStorageProvider(client, { dataSetId: 1n })

      assert.equal(data, null)
    })
  })
})
