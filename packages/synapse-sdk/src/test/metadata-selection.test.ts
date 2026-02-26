/* globals describe it before after */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { createWalletClient, http as viemHttp, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { METADATA_KEYS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'

describe('Metadata-based Data Set Selection', () => {
  describe('WarmStorageService with Metadata', () => {
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

      // Create custom preset that returns different metadata for different data sets
      const customPreset: any = {
        ...Mocks.presets.basic,
        warmStorageView: {
          ...Mocks.presets.basic.warmStorageView,
          clientDataSets: () => [[1n, 2n, 3n]],
          // Provide base dataset info per dataset id
          getDataSet: (args: any) => {
            const [dataSetId] = args as [bigint]
            if (dataSetId === 1n) {
              return [
                {
                  pdpRailId: 1n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: Mocks.ADDRESSES.client1,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  commissionBps: 100n,
                  clientDataSetId: 0n,
                  pdpEndEpoch: 0n,
                  providerId: 1n,
                  cdnEndEpoch: 0n,
                  dataSetId,
                },
              ]
            }
            if (dataSetId === 2n) {
              return [
                {
                  pdpRailId: 2n,
                  cacheMissRailId: 0n,
                  cdnRailId: 100n,
                  payer: Mocks.ADDRESSES.client1,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  commissionBps: 100n,
                  clientDataSetId: 1n,
                  pdpEndEpoch: 0n,
                  providerId: 1n,
                  cdnEndEpoch: 0n,
                  dataSetId,
                },
              ]
            }
            if (dataSetId === 3n) {
              return [
                {
                  pdpRailId: 3n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: Mocks.ADDRESSES.client1,
                  payee: Mocks.ADDRESSES.serviceProvider2,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider2,
                  commissionBps: 100n,
                  clientDataSetId: 2n,
                  pdpEndEpoch: 0n,
                  providerId: 2n,
                  cdnEndEpoch: 0n,
                  dataSetId,
                },
              ]
            }
            // default empty/non-existent
            return [
              {
                pdpRailId: 0n,
                cacheMissRailId: 0n,
                cdnRailId: 0n,
                payer: zeroAddress,
                payee: zeroAddress,
                serviceProvider: zeroAddress,
                commissionBps: 0n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 0n,
                cdnEndEpoch: 0n,
                dataSetId,
              },
            ]
          },
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
          ...Mocks.presets.basic.pdpVerifier,
          getNextPieceId: (args: any) => {
            const [dataSetId] = args
            if (dataSetId === 1n) return [5n] as const // Has pieces
            if (dataSetId === 2n) return [0n] as const // Empty
            if (dataSetId === 3n) return [2n] as const // Has pieces
            return [0n] as const
          },
        },
      }

      server.use(Mocks.JSONRPC(customPreset))

      const client = createWalletClient({
        chain: calibration,
        transport: viemHttp(),
        account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
      })
      warmStorageService = new WarmStorageService({ client })
    })

    it('should fetch metadata for each data set', async () => {
      const dataSets = await warmStorageService.getClientDataSetsWithDetails({ address: Mocks.ADDRESSES.client1 })

      assert.equal(dataSets.length, 3)

      // Data set 1: no metadata, no CDN from rail
      assert.equal(dataSets[0].pdpVerifierDataSetId, 1n)
      assert.isFalse(dataSets[0].withCDN)
      assert.deepEqual(dataSets[0].metadata, {})

      // Data set 2: withCDN metadata, also has CDN rail
      assert.equal(dataSets[1].pdpVerifierDataSetId, 2n)
      assert.isTrue(dataSets[1].withCDN)
      assert.deepEqual(dataSets[1].metadata, { [METADATA_KEYS.WITH_CDN]: '' })

      // Data set 3: withIPFSIndexing metadata, no CDN
      assert.equal(dataSets[2].pdpVerifierDataSetId, 3n)
      assert.isFalse(dataSets[2].withCDN)
      assert.deepEqual(dataSets[2].metadata, { [METADATA_KEYS.WITH_IPFS_INDEXING]: '' })
    })
  })
})
