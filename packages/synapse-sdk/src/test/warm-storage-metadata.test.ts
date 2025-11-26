/* globals describe it before after beforeEach */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { METADATA_KEYS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { ADDRESSES, JSONRPC, presets } from './mocks/jsonrpc/index.ts'

describe('WarmStorageService Metadata', () => {
  let server: any
  let warmStorageService: WarmStorageService

  before(async () => {
    server = setup()
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    server.use(JSONRPC(presets.basic))

    const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
  })

  describe('Data Set Metadata', () => {
    it('should get all data set metadata', async () => {
      const metadata = await warmStorageService.getDataSetMetadata(1)

      assert.equal(Object.keys(metadata).length, 2)
      assert.equal(metadata.environment, 'test')
      assert.equal(metadata[METADATA_KEYS.WITH_CDN], '')
    })

    it('should get specific data set metadata by key', async () => {
      const value = await warmStorageService.getDataSetMetadataByKey(1, METADATA_KEYS.WITH_CDN)
      assert.equal(value, '')

      const envValue = await warmStorageService.getDataSetMetadataByKey(1, 'environment')
      assert.equal(envValue, 'test')

      const nonExistent = await warmStorageService.getDataSetMetadataByKey(1, 'nonexistent')
      assert.isNull(nonExistent)
    })

    it('should return empty metadata for non-existent data set', async () => {
      const metadata = await warmStorageService.getDataSetMetadata(999)
      assert.equal(Object.keys(metadata).length, 0)
    })
  })

  describe('Piece Metadata', () => {
    it('should get all piece metadata', async () => {
      const metadata = await warmStorageService.getPieceMetadata(1, 0)

      assert.equal(Object.keys(metadata).length, 2)
      assert.equal(metadata[METADATA_KEYS.WITH_IPFS_INDEXING], '')
      assert.equal(metadata[METADATA_KEYS.IPFS_ROOT_CID], 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')
    })

    it('should get specific piece metadata by key', async () => {
      const indexingValue = await warmStorageService.getPieceMetadataByKey(1, 0, METADATA_KEYS.WITH_IPFS_INDEXING)
      assert.equal(indexingValue, '')

      const cidValue = await warmStorageService.getPieceMetadataByKey(1, 0, METADATA_KEYS.IPFS_ROOT_CID)
      assert.equal(cidValue, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')

      const nonExistent = await warmStorageService.getPieceMetadataByKey(1, 0, 'nonexistent')
      assert.isNull(nonExistent)
    })

    it('should return empty metadata for non-existent piece', async () => {
      const metadata = await warmStorageService.getPieceMetadata(1, 999)
      assert.equal(Object.keys(metadata).length, 0)
    })
  })
})
