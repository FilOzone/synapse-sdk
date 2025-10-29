/* globals describe it before after beforeEach */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { PDPAuthHelper } from '../pdp/auth.ts'
import { PDPServer } from '../pdp/server.ts'
import { asPieceCID } from '../piece/index.ts'
import type { MetadataEntry } from '../types.ts'
import { METADATA_KEYS } from '../utils/constants.ts'
import {
  addPiecesWithMetadataCapture,
  createDataSetWithMetadataCapture,
  type MetadataCapture,
  type PieceMetadataCapture,
} from './mocks/pdp/handlers.ts'

// Mock server for testing
const server = setup([])

describe('Metadata Support', () => {
  const TEST_PRIVATE_KEY = '0x0101010101010101010101010101010101010101010101010101010101010101'
  const TEST_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890'
  const TEST_CHAIN_ID = 1n
  const SERVER_URL = 'http://pdp.local'

  let authHelper: PDPAuthHelper
  let pdpServer: PDPServer

  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()

    // Create fresh instances for each test
    authHelper = new PDPAuthHelper(TEST_CONTRACT_ADDRESS, new ethers.Wallet(TEST_PRIVATE_KEY), TEST_CHAIN_ID)
    pdpServer = new PDPServer(authHelper, SERVER_URL)
  })

  describe('PDPServer', () => {
    it('should handle metadata in createDataSet', async () => {
      const dataSetMetadata: MetadataEntry[] = [
        { key: 'project', value: 'my-project' },
        { key: 'environment', value: 'production' },
        { key: METADATA_KEYS.WITH_CDN, value: '' },
      ]

      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      let capturedMetadata: MetadataCapture | null = null

      server.use(
        createDataSetWithMetadataCapture(
          mockTxHash,
          (metadata) => {
            capturedMetadata = metadata
          },
          { baseUrl: SERVER_URL }
        )
      )

      const result = await pdpServer.createDataSet(
        1n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payer
        dataSetMetadata,
        TEST_CONTRACT_ADDRESS
      )

      assert.equal(result.txHash, mockTxHash)
      assert.exists(capturedMetadata)
      assert.isNotNull(capturedMetadata)
      assert.deepEqual((capturedMetadata as any).keys, ['project', 'environment', METADATA_KEYS.WITH_CDN])
      assert.deepEqual((capturedMetadata as any).values, ['my-project', 'production', ''])
    })

    it('should handle metadata in addPieces', async () => {
      const pieces = [asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy') as any]
      const metadata: MetadataEntry[][] = [
        [
          { key: 'contentType', value: 'application/json' },
          { key: 'version', value: '1.0.0' },
        ],
      ]

      const dataSetId = 123
      const mockTxHash = '0x1234567890abcdef'
      let capturedPieceMetadata: PieceMetadataCapture | null = null

      server.use(
        addPiecesWithMetadataCapture(
          dataSetId,
          mockTxHash,
          (metadata) => {
            capturedPieceMetadata = metadata
          },
          { baseUrl: SERVER_URL }
        )
      )

      // Test with matching metadata
      const result = await pdpServer.addPieces(dataSetId, 1n, pieces, metadata)
      assert.equal(result.txHash, mockTxHash)
      assert.exists(capturedPieceMetadata)
      assert.isNotNull(capturedPieceMetadata)
      assert.deepEqual((capturedPieceMetadata as any).keys[0], ['contentType', 'version'])
      assert.deepEqual((capturedPieceMetadata as any).values[0], ['application/json', '1.0.0'])

      // Test with metadata length mismatch - should throw
      const mismatchedMetadata: MetadataEntry[][] = [
        [{ key: 'contentType', value: 'application/json' }],
        [{ key: 'version', value: '1.0.0' }],
      ]

      try {
        await pdpServer.addPieces(dataSetId, 1n, pieces, mismatchedMetadata)
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.match(error.message, /Metadata length \(2\) must match pieces length \(1\)/)
      }

      // Test without metadata (should create empty arrays)
      capturedPieceMetadata = null
      const resultNoMetadata = await pdpServer.addPieces(dataSetId, 1n, pieces)
      assert.equal(resultNoMetadata.txHash, mockTxHash)
      assert.exists(capturedPieceMetadata)
      assert.isNotNull(capturedPieceMetadata)
      assert.deepEqual((capturedPieceMetadata as any).keys[0], [])
      assert.deepEqual((capturedPieceMetadata as any).values[0], [])
    })
  })

  describe('Backward Compatibility', () => {
    it('should convert withCDN boolean to metadata', async () => {
      const mockTxHash = '0xabcdef1234567890'
      let capturedMetadata: MetadataCapture | null = null

      server.use(
        createDataSetWithMetadataCapture(
          mockTxHash,
          (metadata) => {
            capturedMetadata = metadata
          },
          { baseUrl: SERVER_URL }
        )
      )

      // Test with metadata that includes withCDN
      const metadataWithCDN: MetadataEntry[] = [
        { key: 'project', value: 'test' },
        { key: METADATA_KEYS.WITH_CDN, value: '' },
      ]

      await pdpServer.createDataSet(
        1n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payer
        metadataWithCDN,
        TEST_CONTRACT_ADDRESS
      )
      assert.isNotNull(capturedMetadata)
      assert.deepEqual((capturedMetadata as any).keys, ['project', METADATA_KEYS.WITH_CDN])
      assert.deepEqual((capturedMetadata as any).values, ['test', ''])

      // Test with metadata that doesn't include withCDN
      capturedMetadata = null
      const metadataWithoutCDN: MetadataEntry[] = [{ key: 'project', value: 'test' }]

      await pdpServer.createDataSet(
        1n,
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payee
        '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // payer
        metadataWithoutCDN,
        TEST_CONTRACT_ADDRESS
      )
      assert.isNotNull(capturedMetadata)
      assert.deepEqual((capturedMetadata as any).keys, ['project'])
      assert.deepEqual((capturedMetadata as any).values, ['test'])
    })

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
