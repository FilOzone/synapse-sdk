/* globals describe it before after */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { METADATA_KEYS } from '../utils/constants.ts'
import { metadataMatches, withCDNToMetadata } from '../utils/metadata.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { ADDRESSES, JSONRPC, presets } from './mocks/jsonrpc/index.ts'

describe('Metadata-based Data Set Selection', () => {
  describe('Metadata Utilities', () => {
    describe('metadataMatches', () => {
      it('should not match when data set has extra keys', () => {
        const dataSetMetadata: Record<string, string> = {
          environment: 'production',
          [METADATA_KEYS.WITH_CDN]: '',
          region: 'us-east',
        }

        const requested: Record<string, string> = {
          [METADATA_KEYS.WITH_CDN]: '',
          environment: 'production',
        }

        // With exact matching, extra keys in dataSet mean no match
        assert.isFalse(metadataMatches(dataSetMetadata, requested))
      })

      it('should not match when requested value differs', () => {
        const dataSetMetadata: Record<string, string> = {
          environment: 'production',
          [METADATA_KEYS.WITH_CDN]: '',
        }

        const requested: Record<string, string> = { environment: 'development' }

        assert.isFalse(metadataMatches(dataSetMetadata, requested))
      })

      it('should not match when requested key is missing', () => {
        const dataSetMetadata: Record<string, string> = { environment: 'production' }

        const requested: Record<string, string> = { [METADATA_KEYS.WITH_CDN]: '' }

        assert.isFalse(metadataMatches(dataSetMetadata, requested))
      })

      it('should not match when data set has metadata but empty requested', () => {
        const dataSetMetadata: Record<string, string> = { environment: 'production' }

        const requested: Record<string, string> = {}

        // With exact matching, non-empty dataSet doesn't match empty request
        assert.isFalse(metadataMatches(dataSetMetadata, requested))
      })

      it('should be order-independent with exact matching', () => {
        const dataSetMetadata: Record<string, string> = {
          b: '2',
          a: '1',
          c: '3',
        }

        const requested: Record<string, string> = {
          c: '3',
          a: '1',
          b: '2',
        }

        // Order doesn't matter, but must have exact same keys
        assert.isTrue(metadataMatches(dataSetMetadata, requested))
      })

      it('should match when both have empty metadata', () => {
        const dataSetMetadata: Record<string, string> = {}
        const requested: Record<string, string> = {}

        // Both empty = exact match
        assert.isTrue(metadataMatches(dataSetMetadata, requested))
      })

      it('should match when metadata is exactly the same', () => {
        const dataSetMetadata: Record<string, string> = {
          [METADATA_KEYS.WITH_CDN]: '',
          environment: 'production',
        }

        const requested: Record<string, string> = {
          [METADATA_KEYS.WITH_CDN]: '',
          environment: 'production',
        }

        assert.isTrue(metadataMatches(dataSetMetadata, requested))
      })
    })

    describe('withCDNToMetadata', () => {
      it('should convert true to metadata entry', () => {
        const metadata = withCDNToMetadata(true)
        assert.equal(metadata.length, 1)
        assert.equal(metadata[0].key, METADATA_KEYS.WITH_CDN)
        assert.equal(metadata[0].value, '')
      })

      it('should convert false to empty array', () => {
        const metadata = withCDNToMetadata(false)
        assert.equal(metadata.length, 0)
      })
    })
  })

  describe('WarmStorageService with Metadata', () => {
    let server: any
    let warmStorageService: WarmStorageService

    before(async () => {
      server = setup([])
      await server.start({ quiet: true })
    })

    after(() => {
      server.stop()
    })

    beforeEach(async () => {
      server.resetHandlers()

      // Create custom preset that returns different metadata for different data sets
      const customPreset: any = {
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          railToDataSet: (args: any) => {
            const [railId] = args
            // Map rail IDs directly to data set IDs for this test
            return [railId] // railId 1 -> dataSetId 1, railId 2 -> dataSetId 2, etc.
          },
          getClientDataSets: () => [
            [
              {
                pdpRailId: 1n,
                cacheMissRailId: 0n,
                cdnRailId: 0n, // No CDN
                payer: ADDRESSES.client1,
                payee: ADDRESSES.serviceProvider1,
                serviceProvider: ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                cdnEndEpoch: 0n,
              },
              {
                pdpRailId: 2n,
                cacheMissRailId: 0n,
                cdnRailId: 100n, // Has CDN
                payer: ADDRESSES.client1,
                payee: ADDRESSES.serviceProvider1,
                serviceProvider: ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 1n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                cdnEndEpoch: 0n,
              },
              {
                pdpRailId: 3n,
                cacheMissRailId: 0n,
                cdnRailId: 0n, // No CDN
                payer: ADDRESSES.client1,
                payee: ADDRESSES.serviceProvider2,
                serviceProvider: ADDRESSES.serviceProvider2,
                commissionBps: 100n,
                clientDataSetId: 2n,
                pdpEndEpoch: 0n,
                providerId: 2n,
                cdnEndEpoch: 0n,
              },
            ],
          ],
          getAllDataSetMetadata: (args: any) => {
            const [dataSetId] = args
            if (dataSetId === 1n) {
              // Data set 1: no metadata
              return [[], []]
            }
            if (dataSetId === 2n) {
              // Data set 2: has withCDN
              return [[METADATA_KEYS.WITH_CDN], ['']]
            }
            if (dataSetId === 3n) {
              // Data set 3: has withIPFSIndexing
              return [[METADATA_KEYS.WITH_IPFS_INDEXING], ['']]
            }
            return [[], []]
          },
        },
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getNextPieceId: (args: any) => {
            const [dataSetId] = args
            if (dataSetId === 1n) return [5n] as const // Has pieces
            if (dataSetId === 2n) return [0n] as const // Empty
            if (dataSetId === 3n) return [2n] as const // Has pieces
            return [0n] as const
          },
        },
      }

      server.use(JSONRPC(customPreset))

      const provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
      warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
    })

    it('should fetch metadata for each data set', async () => {
      const dataSets = await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1)

      assert.equal(dataSets.length, 3)

      // Data set 1: no metadata, no CDN from rail
      assert.equal(dataSets[0].pdpVerifierDataSetId, 1)
      assert.isFalse(dataSets[0].withCDN)
      assert.deepEqual(dataSets[0].metadata, {})

      // Data set 2: withCDN metadata, also has CDN rail
      assert.equal(dataSets[1].pdpVerifierDataSetId, 2)
      assert.isTrue(dataSets[1].withCDN)
      assert.deepEqual(dataSets[1].metadata, { [METADATA_KEYS.WITH_CDN]: '' })

      // Data set 3: withIPFSIndexing metadata, no CDN
      assert.equal(dataSets[2].pdpVerifierDataSetId, 3)
      assert.isFalse(dataSets[2].withCDN)
      assert.deepEqual(dataSets[2].metadata, { [METADATA_KEYS.WITH_IPFS_INDEXING]: '' })
    })

    it('should prefer data sets with matching metadata', async () => {
      const dataSets = await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1)

      // Filter for data sets with withIPFSIndexing
      const withIndexing = dataSets.filter((ds) =>
        metadataMatches(ds.metadata, { [METADATA_KEYS.WITH_IPFS_INDEXING]: '' })
      )

      assert.equal(withIndexing.length, 1)
      assert.equal(withIndexing[0].pdpVerifierDataSetId, 3)

      // Filter for data sets with withCDN
      const withCDN = dataSets.filter((ds) => metadataMatches(ds.metadata, { [METADATA_KEYS.WITH_CDN]: '' }))

      assert.equal(withCDN.length, 1)
      assert.equal(withCDN[0].pdpVerifierDataSetId, 2)

      // Filter for data sets with no specific metadata (exact empty match)
      const noRequirements = dataSets.filter((ds) => metadataMatches(ds.metadata, {}))

      // With exact matching, only data set 1 with empty metadata matches
      assert.equal(noRequirements.length, 1)
      assert.equal(noRequirements[0].pdpVerifierDataSetId, 1)
    })
  })
})
