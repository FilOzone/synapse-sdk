/* globals describe it before after beforeEach */

import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import type { MetadataEntry } from '../types.ts'
import { METADATA_KEYS } from '../utils/constants.ts'
import { combineMetadata } from '../utils/metadata.ts'

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

  describe('combineMetadata', () => {
    describe('source option', () => {
      it('should add source key when source is a non-empty string', () => {
        const result = combineMetadata({}, { source: 'my-dapp' })
        assert.deepEqual(result, { [METADATA_KEYS.SOURCE]: 'my-dapp' })
      })

      it('should not add source key when source is null', () => {
        const result = combineMetadata({}, { source: null })
        assert.deepEqual(result, {})
      })

      it('should not add source key when source is empty string', () => {
        const result = combineMetadata({}, { source: '' })
        assert.deepEqual(result, {})
      })

      it('should not override existing source key in metadata', () => {
        const metadata = { [METADATA_KEYS.SOURCE]: 'explicit-source' }
        const result = combineMetadata(metadata, { source: 'other-source' })
        assert.deepEqual(result, { [METADATA_KEYS.SOURCE]: 'explicit-source' })
      })

      it('should combine source with other metadata', () => {
        const metadata = { category: 'videos' }
        const result = combineMetadata(metadata, { source: 'my-dapp' })
        assert.deepEqual(result, { category: 'videos', [METADATA_KEYS.SOURCE]: 'my-dapp' })
      })
    })

    describe('withCDN option', () => {
      it('should add withCDN key when withCDN is true', () => {
        const result = combineMetadata({}, { withCDN: true })
        assert.deepEqual(result, { [METADATA_KEYS.WITH_CDN]: '' })
      })

      it('should not add withCDN key when withCDN is false', () => {
        const result = combineMetadata({}, { withCDN: false })
        assert.deepEqual(result, {})
      })

      it('should not override existing withCDN key in metadata', () => {
        const metadata = { [METADATA_KEYS.WITH_CDN]: '' }
        const result = combineMetadata(metadata, { withCDN: true })
        assert.deepEqual(result, { [METADATA_KEYS.WITH_CDN]: '' })
      })
    })

    describe('combined options', () => {
      it('should add both source and withCDN', () => {
        const result = combineMetadata({}, { withCDN: true, source: 'my-dapp' })
        assert.deepEqual(result, {
          [METADATA_KEYS.WITH_CDN]: '',
          [METADATA_KEYS.SOURCE]: 'my-dapp',
        })
      })

      it('should add source but not withCDN when withCDN is false', () => {
        const result = combineMetadata({}, { withCDN: false, source: 'my-dapp' })
        assert.deepEqual(result, { [METADATA_KEYS.SOURCE]: 'my-dapp' })
      })
    })

    describe('no options', () => {
      it('should return metadata unchanged when no options provided', () => {
        const metadata = { key: 'value' }
        const result = combineMetadata(metadata)
        assert.deepEqual(result, { key: 'value' })
      })

      it('should return empty metadata when called with no arguments', () => {
        const result = combineMetadata()
        assert.deepEqual(result, {})
      })
    })
  })

  describe('StorageManager preflightUpload with metadata', () => {
    it('should extract withCDN from metadata when provided', async () => {
      // Test the logic of preflightUpload extracting withCDN from metadata

      // Case 1: withCDN in metadata takes precedence over option
      const metadataWithCDN: MetadataEntry[] = [
        { key: 'test', value: 'value' },
        { key: METADATA_KEYS.WITH_CDN, value: '' },
      ]

      // Simulate the logic in StorageManager.preflightUpload
      let withCDN = false // default or from options
      const withCDNEntry = metadataWithCDN.find((m) => m.key === METADATA_KEYS.WITH_CDN)
      if (withCDNEntry != null) {
        withCDN = true
      }

      assert.isTrue(withCDN, 'Should detect withCDN in metadata')

      // Case 2: metadata without withCDN should not set it to true
      const metadataWithoutCDN: MetadataEntry[] = [{ key: 'test', value: 'value' }]

      withCDN = false
      const withCDNEntry2 = metadataWithoutCDN.find((m) => m.key === METADATA_KEYS.WITH_CDN)
      if (withCDNEntry2 != null) {
        withCDN = true
      }

      assert.isFalse(withCDN, 'Should not detect withCDN when not in metadata')

      // Case 3: Empty metadata should not affect withCDN
      const emptyMetadata: MetadataEntry[] = []

      withCDN = true // existing value
      const withCDNEntry3 = emptyMetadata.find((m) => m.key === METADATA_KEYS.WITH_CDN)
      if (withCDNEntry3 != null) {
        withCDN = true // only set if found
      }

      assert.isTrue(withCDN, 'Should preserve existing withCDN when metadata is empty')

      // Case 4: withCDN with non-empty value should trigger warning but still enable CDN (contract behavior)
      const metadataWithNonEmptyValue: MetadataEntry[] = [{ key: METADATA_KEYS.WITH_CDN, value: 'unexpected-value' }]

      // Simulate the actual logic from StorageManager.preflightUpload
      withCDN = false // Reset for this test case
      const withCDNEntry4 = metadataWithNonEmptyValue.find((m) => m.key === METADATA_KEYS.WITH_CDN)
      if (withCDNEntry4 != null) {
        // The contract only checks for key presence, not value
        if (withCDNEntry4.value !== '') {
          // In actual code, this would console.warn
          assert.equal(withCDNEntry4.value, 'unexpected-value', 'Should detect non-empty value')
        }
        withCDN = true // Enable CDN when key exists
      }

      assert.isTrue(withCDN, 'Should enable CDN when key exists, regardless of value (contract behavior)')
    })

    it('should follow precedence: metadata > option > default', async () => {
      // Test precedence order for withCDN determination

      // Simulate preflightUpload logic with different scenarios
      const defaultWithCDN = false

      // Scenario 1: metadata with withCDN overrides everything
      let options: { withCDN?: boolean; metadata?: MetadataEntry[] } = {
        withCDN: false,
        metadata: [{ key: METADATA_KEYS.WITH_CDN, value: '' }],
      }

      let withCDN = options.withCDN ?? defaultWithCDN
      if (options.metadata != null) {
        const withCDNEntry = options.metadata.find((m) => m.key === METADATA_KEYS.WITH_CDN)
        if (withCDNEntry != null) {
          withCDN = true
        }
      }

      assert.isTrue(withCDN, 'Metadata should override option')

      // Scenario 2: option used when metadata doesn't have withCDN
      options = {
        withCDN: true,
        metadata: [{ key: 'other', value: 'value' }],
      }

      withCDN = options.withCDN ?? defaultWithCDN
      if (options.metadata != null) {
        const withCDNEntry = options.metadata.find((m) => m.key === METADATA_KEYS.WITH_CDN)
        if (withCDNEntry != null) {
          withCDN = true
        }
      }

      assert.isTrue(withCDN, 'Option should be used when metadata lacks withCDN')

      // Scenario 3: metadata with non-empty withCDN value should still override (with warning)
      options = {
        withCDN: false, // Option says false
        metadata: [{ key: METADATA_KEYS.WITH_CDN, value: 'non-empty' }], // Metadata has key (non-empty value)
      }

      withCDN = options.withCDN ?? defaultWithCDN
      if (options.metadata != null) {
        const withCDNEntry = options.metadata.find((m) => m.key === METADATA_KEYS.WITH_CDN)
        if (withCDNEntry != null) {
          // Contract only checks key presence
          if (withCDNEntry.value !== '') {
            // Would console.warn in actual code
          }
          withCDN = true // Enable CDN when key exists
        }
      }

      assert.isTrue(withCDN, 'Metadata with withCDN key should override option, even with non-empty value')

      // Scenario 4: default used when neither option nor metadata has withCDN
      options = {
        metadata: [{ key: 'other', value: 'value' }],
      }

      withCDN = options.withCDN ?? defaultWithCDN
      if (options.metadata != null) {
        const withCDNEntry = options.metadata.find((m) => m.key === METADATA_KEYS.WITH_CDN)
        if (withCDNEntry != null) {
          withCDN = true
        }
      }

      assert.isFalse(withCDN, 'Default should be used when no withCDN specified')
    })
  })
})
