import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getAllDataSetMetadata, getAllDataSetMetadataCall } from '../src/warm-storage/get-all-data-set-metadata.ts'

describe('getAllDataSetMetadata', () => {
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

  describe('getAllDataSetMetadataCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getAllDataSetMetadataCall({
        chain: calibration,
        dataSetId: 123n,
      })

      assert.equal(call.functionName, 'getAllDataSetMetadata')
      assert.deepEqual(call.args, [123n])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getAllDataSetMetadataCall({
        chain: mainnet,
        dataSetId: 456n,
      })

      assert.equal(call.functionName, 'getAllDataSetMetadata')
      assert.deepEqual(call.args, [456n])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getAllDataSetMetadataCall({
        chain: calibration,
        dataSetId: 789n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
      assert.deepEqual(call.args, [789n])
    })

    it('should handle large dataSetId values', () => {
      const largeId = 2n ** 128n
      const call = getAllDataSetMetadataCall({
        chain: calibration,
        dataSetId: largeId,
      })

      assert.deepEqual(call.args, [largeId])
    })
  })

  describe('getAllDataSetMetadata (with mocked RPC)', () => {
    it('should fetch and format metadata for a data set', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const metadata = await getAllDataSetMetadata(client, {
        dataSetId: 1n,
      })

      assert.deepEqual(metadata, {
        environment: 'test',
        withCDN: '',
      })
    })

    it('should return empty object for data set with no metadata', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const metadata = await getAllDataSetMetadata(client, {
        dataSetId: 999n,
      })

      assert.deepEqual(metadata, {})
    })

    it('should fetch metadata with custom mock', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata: (args) => {
              const [dataSetId] = args
              if (dataSetId === 42n) {
                return [
                  ['customKey', 'anotherKey'],
                  ['customValue', 'anotherValue'],
                ]
              }
              return [[], []]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const metadata = await getAllDataSetMetadata(client, {
        dataSetId: 42n,
      })

      assert.deepEqual(metadata, {
        customKey: 'customValue',
        anotherKey: 'anotherValue',
      })
    })
  })
})
