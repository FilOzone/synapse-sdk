import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getAllPieceMetadata, getAllPieceMetadataCall } from '../src/warm-storage/get-all-piece-metadata.ts'

describe('getAllPieceMetadata', () => {
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

  describe('getAllPieceMetadataCall', () => {
    it('should create call with calibration chain defaults', () => {
      const call = getAllPieceMetadataCall({
        chain: calibration,
        dataSetId: 1n,
        pieceId: 0n,
      })

      assert.equal(call.functionName, 'getAllPieceMetadata')
      assert.deepEqual(call.args, [1n, 0n])
      assert.equal(call.address, calibration.contracts.fwssView.address)
      assert.equal(call.abi, calibration.contracts.fwssView.abi)
    })

    it('should create call with mainnet chain defaults', () => {
      const call = getAllPieceMetadataCall({
        chain: mainnet,
        dataSetId: 456n,
        pieceId: 789n,
      })

      assert.equal(call.functionName, 'getAllPieceMetadata')
      assert.deepEqual(call.args, [456n, 789n])
      assert.equal(call.address, mainnet.contracts.fwssView.address)
      assert.equal(call.abi, mainnet.contracts.fwssView.abi)
    })

    it('should use custom address when provided', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const call = getAllPieceMetadataCall({
        chain: calibration,
        dataSetId: 1n,
        pieceId: 2n,
        contractAddress: customAddress,
      })

      assert.equal(call.address, customAddress)
      assert.deepEqual(call.args, [1n, 2n])
    })

    it('should handle large dataSetId and pieceId values', () => {
      const largeDataSetId = 2n ** 128n
      const largePieceId = 2n ** 64n
      const call = getAllPieceMetadataCall({
        chain: calibration,
        dataSetId: largeDataSetId,
        pieceId: largePieceId,
      })

      assert.deepEqual(call.args, [largeDataSetId, largePieceId])
    })
  })

  describe('getAllPieceMetadata (with mocked RPC)', () => {
    it('should fetch and format metadata for a piece', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const metadata = await getAllPieceMetadata(client, {
        dataSetId: 1n,
        pieceId: 0n,
      })

      assert.deepEqual(metadata, {
        withIPFSIndexing: '',
        ipfsRootCID: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      })
    })

    it('should return empty object for piece with no metadata', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const metadata = await getAllPieceMetadata(client, {
        dataSetId: 999n,
        pieceId: 999n,
      })

      assert.deepEqual(metadata, {})
    })

    it('should fetch metadata with custom mock', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllPieceMetadata: (args) => {
              const [dataSetId, pieceId] = args
              if (dataSetId === 42n && pieceId === 7n) {
                return [
                  ['contentType', 'version'],
                  ['application/json', '1.0.0'],
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

      const metadata = await getAllPieceMetadata(client, {
        dataSetId: 42n,
        pieceId: 7n,
      })

      assert.deepEqual(metadata, {
        contentType: 'application/json',
        version: '1.0.0',
      })
    })
  })
})
