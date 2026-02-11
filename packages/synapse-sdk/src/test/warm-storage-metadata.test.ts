/* globals describe it before after beforeEach */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { createWalletClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { METADATA_KEYS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'

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
    server.use(Mocks.JSONRPC(Mocks.presets.basic))

    const client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    warmStorageService = new WarmStorageService({ client })
  })

  describe('Data Set Metadata', () => {
    it('should get all data set metadata', async () => {
      const metadata = await warmStorageService.getDataSetMetadata({ dataSetId: 1n })

      assert.equal(Object.keys(metadata).length, 2)
      assert.equal(metadata.environment, 'test')
      assert.equal(metadata[METADATA_KEYS.WITH_CDN], '')
    })

    it('should get specific data set metadata by key', async () => {
      const value = await warmStorageService.getDataSetMetadataByKey({ dataSetId: 1n, key: METADATA_KEYS.WITH_CDN })
      assert.equal(value, '')

      const envValue = await warmStorageService.getDataSetMetadataByKey({ dataSetId: 1n, key: 'environment' })
      assert.equal(envValue, 'test')

      const nonExistent = await warmStorageService.getDataSetMetadataByKey({ dataSetId: 1n, key: 'nonexistent' })
      assert.isNull(nonExistent)
    })

    it('should return empty metadata for non-existent data set', async () => {
      const metadata = await warmStorageService.getDataSetMetadata({ dataSetId: 999n })
      assert.equal(Object.keys(metadata).length, 0)
    })
  })

  describe('Piece Metadata', () => {
    it('should get all piece metadata', async () => {
      const metadata = await warmStorageService.getPieceMetadata({ dataSetId: 1n, pieceId: 0n })

      assert.equal(Object.keys(metadata).length, 2)
      assert.equal(metadata[METADATA_KEYS.WITH_IPFS_INDEXING], '')
      assert.equal(metadata[METADATA_KEYS.IPFS_ROOT_CID], 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')
    })

    it('should get specific piece metadata by key', async () => {
      const indexingValue = await warmStorageService.getPieceMetadataByKey({
        dataSetId: 1n,
        pieceId: 0n,
        key: METADATA_KEYS.WITH_IPFS_INDEXING,
      })
      assert.equal(indexingValue, '')

      const cidValue = await warmStorageService.getPieceMetadataByKey({
        dataSetId: 1n,
        pieceId: 0n,
        key: METADATA_KEYS.IPFS_ROOT_CID,
      })
      assert.equal(cidValue, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')

      const nonExistent = await warmStorageService.getPieceMetadataByKey({
        dataSetId: 1n,
        pieceId: 0n,
        key: 'nonexistent',
      })
      assert.isNull(nonExistent)
    })

    it('should return empty metadata for non-existent piece', async () => {
      const metadata = await warmStorageService.getPieceMetadata({ dataSetId: 1n, pieceId: 999n })
      assert.equal(Object.keys(metadata).length, 0)
    })
  })
})
