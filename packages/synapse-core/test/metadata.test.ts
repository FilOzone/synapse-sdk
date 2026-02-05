import assert from 'assert'
import {
  datasetMetadataObjectToEntry,
  METADATA_LIMITS,
  type MetadataArray,
  metadataArrayToObject,
  pieceMetadataObjectToEntry,
} from '../src/utils/metadata.ts'

describe('Metadata Utils', () => {
  describe('metadataArrayToObject', () => {
    it('should convert metadata array to object', () => {
      const data: MetadataArray = [
        ['category', 'name', 'withCDN'],
        ['videos', 'my-dataset', ''],
      ]
      const result = metadataArrayToObject(data)

      assert.deepEqual(result, {
        category: 'videos',
        name: 'my-dataset',
        withCDN: '',
      })
    })

    it('should handle empty metadata', () => {
      const data: MetadataArray = [[], []]
      const result = metadataArrayToObject(data)

      assert.deepEqual(result, {})
    })

    it('should handle single key-value pair', () => {
      const data: MetadataArray = [['key'], ['value']]
      const result = metadataArrayToObject(data)

      assert.deepEqual(result, { key: 'value' })
    })

    it('should handle multiple keys with various values', () => {
      const data: MetadataArray = [
        ['environment', 'project', 'version'],
        ['production', 'my-project', '1.0.0'],
      ]
      const result = metadataArrayToObject(data)

      assert.deepEqual(result, {
        environment: 'production',
        project: 'my-project',
        version: '1.0.0',
      })
    })
  })

  describe('datasetMetadataObjectToEntry', () => {
    it('should convert object to sorted entries', () => {
      const result = datasetMetadataObjectToEntry({
        zebra: 'last',
        alpha: 'first',
        middle: 'center',
      })

      assert.deepEqual(result, [
        { key: 'alpha', value: 'first' },
        { key: 'middle', value: 'center' },
        { key: 'zebra', value: 'last' },
      ])
    })

    it('should handle empty object', () => {
      const result = datasetMetadataObjectToEntry({})
      assert.deepEqual(result, [])
    })

    it('should handle undefined', () => {
      const result = datasetMetadataObjectToEntry()
      assert.deepEqual(result, [])
    })

    it('should add withCDN when cdn internal flag is true', () => {
      const result = datasetMetadataObjectToEntry({ project: 'test' }, { cdn: true })

      assert.deepEqual(result, [
        { key: 'project', value: 'test' },
        { key: 'withCDN', value: '' },
      ])
    })

    it('should not add withCDN when cdn internal flag is false', () => {
      const result = datasetMetadataObjectToEntry({ project: 'test' }, { cdn: false })

      assert.deepEqual(result, [{ key: 'project', value: 'test' }])
    })

    it('should throw when exceeding max keys per dataset', () => {
      const tooManyKeys: Record<string, string> = {}
      for (let i = 0; i < METADATA_LIMITS.MAX_KEYS_PER_DATASET + 1; i++) {
        tooManyKeys[`key${i}`] = 'value'
      }

      assert.throws(() => datasetMetadataObjectToEntry(tooManyKeys), /exceeds the maximum number of keys per data set/)
    })

    it('should throw when key exceeds max length', () => {
      const longKey = 'a'.repeat(METADATA_LIMITS.MAX_KEY_LENGTH + 1)
      assert.throws(() => datasetMetadataObjectToEntry({ [longKey]: 'value' }), /key exceeds the maximum length/)
    })

    it('should throw when value exceeds max length', () => {
      const longValue = 'a'.repeat(METADATA_LIMITS.MAX_VALUE_LENGTH + 1)
      assert.throws(() => datasetMetadataObjectToEntry({ key: longValue }), /value exceeds the maximum length/)
    })

    it('should accept key at max length', () => {
      const maxKey = 'a'.repeat(METADATA_LIMITS.MAX_KEY_LENGTH)
      const result = datasetMetadataObjectToEntry({ [maxKey]: 'value' })
      assert.equal(result[0].key, maxKey)
    })

    it('should accept value at max length', () => {
      const maxValue = 'a'.repeat(METADATA_LIMITS.MAX_VALUE_LENGTH)
      const result = datasetMetadataObjectToEntry({ key: maxValue })
      assert.equal(result[0].value, maxValue)
    })
  })

  describe('pieceMetadataObjectToEntry', () => {
    it('should convert object to sorted entries', () => {
      const result = pieceMetadataObjectToEntry({
        contentType: 'application/json',
        version: '1.0.0',
      })

      assert.deepEqual(result, [
        { key: 'contentType', value: 'application/json' },
        { key: 'version', value: '1.0.0' },
      ])
    })

    it('should handle empty object', () => {
      const result = pieceMetadataObjectToEntry({})
      assert.deepEqual(result, [])
    })

    it('should handle undefined', () => {
      const result = pieceMetadataObjectToEntry()
      assert.deepEqual(result, [])
    })

    it('should add withIPNI when ipni internal flag is true', () => {
      const result = pieceMetadataObjectToEntry({ key: 'value' }, { ipni: true })

      assert.deepEqual(result, [
        { key: 'key', value: 'value' },
        { key: 'withIPNI', value: '' },
      ])
    })

    it('should add ipfsRootCID when provided', () => {
      const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      const result = pieceMetadataObjectToEntry({ key: 'value' }, { ipfsRootCID: cid })

      assert.deepEqual(result, [
        { key: 'ipfsRootCID', value: cid },
        { key: 'key', value: 'value' },
      ])
    })

    it('should add both ipni and ipfsRootCID when both provided', () => {
      const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      const result = pieceMetadataObjectToEntry({}, { ipni: true, ipfsRootCID: cid })

      assert.deepEqual(result, [
        { key: 'ipfsRootCID', value: cid },
        { key: 'withIPNI', value: '' },
      ])
    })

    it('should throw when exceeding max keys per piece', () => {
      const tooManyKeys: Record<string, string> = {}
      for (let i = 0; i < METADATA_LIMITS.MAX_KEYS_PER_PIECE + 1; i++) {
        tooManyKeys[`key${i}`] = 'value'
      }

      assert.throws(() => pieceMetadataObjectToEntry(tooManyKeys), /exceeds the maximum number of keys per piece/)
    })

    it('should throw when key exceeds max length', () => {
      const longKey = 'a'.repeat(METADATA_LIMITS.MAX_KEY_LENGTH + 1)
      assert.throws(() => pieceMetadataObjectToEntry({ [longKey]: 'value' }), /key exceeds the maximum length/)
    })

    it('should throw when value exceeds max length', () => {
      const longValue = 'a'.repeat(METADATA_LIMITS.MAX_VALUE_LENGTH + 1)
      assert.throws(() => pieceMetadataObjectToEntry({ key: longValue }), /value exceeds the maximum length/)
    })
  })

  describe('METADATA_LIMITS', () => {
    it('should have expected limit values', () => {
      assert.equal(METADATA_LIMITS.MAX_KEY_LENGTH, 32)
      assert.equal(METADATA_LIMITS.MAX_VALUE_LENGTH, 128)
      assert.equal(METADATA_LIMITS.MAX_KEYS_PER_DATASET, 10)
      assert.equal(METADATA_LIMITS.MAX_KEYS_PER_PIECE, 5)
    })
  })
})
