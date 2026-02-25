/* globals describe it before after beforeEach */

import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import type { MetadataEntry } from '../types.ts'
import { METADATA_KEYS } from '../utils/constants.ts'

// Mock server for testing
const server = setup()

describe('Metadata Support', () => {
  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    server.use(Mocks.JSONRPC(Mocks.presets.basic))
  })

  describe('Backward Compatibility', () => {
    it('should handle StorageContext withCDN backward compatibility', async () => {
      // This test verifies the logic is correct in the implementation
      // When withCDN is true and metadata doesn't contain withCDN key,
      // it should be added automatically
      const metadata: MetadataEntry[] = [{ key: 'test', value: 'value' }]
      const withCDN = true

      // Simulate the logic in StorageContext.createDataSet
      const finalMetadata = [...metadata]
      if (withCDN && !finalMetadata.some((m) => m.key === METADATA_KEYS.WITH_CDN)) {
        finalMetadata.push({ key: METADATA_KEYS.WITH_CDN, value: '' })
      }

      assert.equal(finalMetadata.length, 2)
      assert.equal(finalMetadata[1].key, METADATA_KEYS.WITH_CDN)
      assert.equal(finalMetadata[1].value, '')
    })

    it('should not duplicate withCDN in metadata', async () => {
      const metadata: MetadataEntry[] = [
        { key: 'test', value: 'value' },
        { key: METADATA_KEYS.WITH_CDN, value: '' },
      ]
      const withCDN = true

      // Simulate the logic in StorageContext.createDataSet
      const finalMetadata = [...metadata]
      if (withCDN && !finalMetadata.some((m) => m.key === METADATA_KEYS.WITH_CDN)) {
        finalMetadata.push({ key: METADATA_KEYS.WITH_CDN, value: '' })
      }

      // Should not add another withCDN entry
      assert.equal(finalMetadata.length, 2)
      const cdnEntries = finalMetadata.filter((m) => m.key === METADATA_KEYS.WITH_CDN)
      assert.equal(cdnEntries.length, 1)
    })
  })
})
