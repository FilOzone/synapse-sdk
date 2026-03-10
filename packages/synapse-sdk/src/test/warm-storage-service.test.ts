/* globals describe it beforeEach */

/**
 * Tests for WarmStorageService class
 */

import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { type Address, createWalletClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { WarmStorageService } from '../warm-storage/index.ts'

// mock server for testing
const server = setup()
const client = createWalletClient({
  chain: calibration,
  transport: viemHttp(),
  account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
})

describe('WarmStorageService', () => {
  // Helper to create WarmStorageService with factory pattern
  const createWarmStorageService = async () => {
    return new WarmStorageService({ client })
  }

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const warmStorageService = await createWarmStorageService()
      assert.exists(warmStorageService)
      assert.isFunction(warmStorageService.getClientDataSets)
    })
  })

  describe('getDataSet', () => {
    it('should return a single data set by ID', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 1n

      const result = await warmStorageService.getDataSet({ dataSetId })
      assert.exists(result)
      assert.equal(result?.pdpRailId, 1n)
      assert.equal(result?.cacheMissRailId, 0n)
      assert.equal(result?.cdnRailId, 0n)
      assert.equal(result?.payer, Mocks.ADDRESSES.client1)
      assert.equal(result?.payee, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(result?.serviceProvider, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(result?.commissionBps, 100n)
      assert.equal(result?.clientDataSetId, 0n)
      assert.equal(result?.pdpEndEpoch, 0n)
      assert.equal(result?.providerId, 1n)
      assert.equal(result?.dataSetId, 1n)
    })

    it('should return undefined for non-existent data set', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999n

      const result = await warmStorageService.getDataSet({ dataSetId })
      assert.isUndefined(result, 'Should return undefined for non-existent data set')
    })

    it('should handle contract revert gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            // @ts-expect-error - test error
            getDataSet: () => {
              return null
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999n

      try {
        await warmStorageService.getDataSet({ dataSetId })
        assert.fail('Should have thrown error for contract revert')
      } catch (error: any) {
        assert.include(error.message, 'contract reverted')
      }
    })
  })

  describe('getClientDataSets', () => {
    it('should return empty array when client has no data sets', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            getClientDataSets: () => [[]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSets = await warmStorageService.getClientDataSets({ address: Mocks.ADDRESSES.client1 })
      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 0)
    })

    it('should return data sets for a client', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            getClientDataSets: () => [
              [
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
                  dataSetId: 1n,
                },
                {
                  pdpRailId: 2n,
                  cacheMissRailId: 0n,
                  cdnRailId: 100n,
                  payer: Mocks.ADDRESSES.client1,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  commissionBps: 200n,
                  clientDataSetId: 1n,
                  pdpEndEpoch: 0n,
                  providerId: 1n,
                  cdnEndEpoch: 0n,
                  dataSetId: 2n,
                },
              ],
            ],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const dataSets = await warmStorageService.getClientDataSets({ address: Mocks.ADDRESSES.client1 })

      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 2)

      // Check first data set
      assert.equal(dataSets[0].pdpRailId, 1n)
      assert.equal(dataSets[0].payer, Mocks.ADDRESSES.client1)
      assert.equal(dataSets[0].payee, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(dataSets[0].commissionBps, 100n)
      assert.equal(dataSets[0].clientDataSetId, 0n)
      assert.equal(dataSets[0].cdnRailId, 0n)

      // Check second data set
      assert.equal(dataSets[1].pdpRailId, 2n)
      assert.equal(dataSets[1].payer, Mocks.ADDRESSES.client1)
      assert.equal(dataSets[1].payee, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(dataSets[1].commissionBps, 200n)
      assert.equal(dataSets[1].clientDataSetId, 1n)
      assert.isAbove(Number(dataSets[1].cdnRailId), 0)
      assert.equal(dataSets[1].cdnRailId, 100n)
    })

    it('should handle contract call errors gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            // @ts-expect-error - test error
            getClientDataSets: () => null,
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getClientDataSets({ address: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'contract reverted')
      }
    })
  })

  describe('getClientDataSetsWithDetails', () => {
    it('should enhance data sets with PDPVerifier details', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => [
              {
                pdpRailId: 48n,
                cacheMissRailId: 0n,
                cdnRailId: 0n,
                payer: Mocks.ADDRESSES.client1,
                payee: Mocks.ADDRESSES.payee1,
                serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                dataSetId: 242n,
              },
            ],
          },
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [2n],
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails({
        address: Mocks.ADDRESSES.client1,
      })

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].pdpRailId, 48n)
      assert.equal(detailedDataSets[0].pdpVerifierDataSetId, 242n)
      assert.equal(detailedDataSets[0].activePieceCount, 2n)
      assert.isTrue(detailedDataSets[0].isLive)
      assert.isTrue(detailedDataSets[0].isManaged)
    })

    it('should filter unmanaged data sets when onlyManaged is true', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[242n, 243n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 242n) {
                return [
                  {
                    pdpRailId: 48n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 0n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    dataSetId: 242n,
                  },
                ]
              } else {
                return [
                  {
                    pdpRailId: 49n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 2n,
                    dataSetId: 243n,
                  },
                ]
              }
            },
          },
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [1n],
            getDataSetListener: (args) => {
              const [dataSetId] = args
              if (dataSetId === 242n) {
                return [Mocks.ADDRESSES.calibration.warmStorage] // Managed by us
              }
              return ['0x1234567890123456789012345678901234567890' as `0x${string}`] // Different address
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      // Get all data sets
      const allDataSets = await warmStorageService.getClientDataSetsWithDetails({
        address: Mocks.ADDRESSES.client1,
        onlyManaged: false,
      })
      assert.lengthOf(allDataSets, 2)

      // Get only managed data sets
      const managedDataSets = await warmStorageService.getClientDataSetsWithDetails({
        address: Mocks.ADDRESSES.client1,
        onlyManaged: true,
      })
      assert.lengthOf(managedDataSets, 1)
      assert.equal(managedDataSets[0].pdpRailId, 48n)
      assert.isTrue(managedDataSets[0].isManaged)
    })

    it('should set withCDN true when cdnRailId > 0 and withCDN metadata key present', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => [
              {
                pdpRailId: 48n,
                cacheMissRailId: 50n,
                cdnRailId: 51n, // CDN rail exists
                payer: Mocks.ADDRESSES.client1,
                payee: Mocks.ADDRESSES.payee1,
                serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                dataSetId: 242n,
              },
            ],
            getAllDataSetMetadata: () => [
              ['withCDN'], // withCDN key present
              [''],
            ],
          },
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [2n],
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails({
        address: Mocks.ADDRESSES.client1,
      })

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].cdnRailId, 51n)
      assert.isTrue(detailedDataSets[0].withCDN)
    })

    it('should set withCDN false when cdnRailId > 0 but withCDN metadata key missing (terminated)', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => [
              {
                pdpRailId: 48n,
                cacheMissRailId: 50n,
                cdnRailId: 51n, // CDN rail still exists
                payer: Mocks.ADDRESSES.client1,
                payee: Mocks.ADDRESSES.payee1,
                serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                dataSetId: 242n,
              },
            ],
            getAllDataSetMetadata: () => [
              [], // No metadata keys - CDN was terminated
              [],
            ],
          },
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [2n],
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails({
        address: Mocks.ADDRESSES.client1,
      })

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].cdnRailId, 51n)
      assert.isFalse(detailedDataSets[0].withCDN) // CDN terminated, metadata cleared
    })

    it('should throw error when contract calls fail', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getClientDataSetsWithDetails({ address: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get details for data set')
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('validateDataSet', () => {
    it('should validate dataset successfully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48n

      // Should not throw
      await warmStorageService.validateDataSet({ dataSetId })
    })

    it('should throw error if data set is not managed by this WarmStorage', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getDataSetListener: () => ['0x1234567890123456789012345678901234567890' as Address], // Different address
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48n

      try {
        await warmStorageService.validateDataSet({ dataSetId })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'is not managed by this WarmStorage contract')
      }
    })
  })

  describe('Service Provider ID Operations', () => {
    it('should get list of approved provider IDs', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const providerIds = await warmStorageService.getApprovedProviderIds()
      assert.lengthOf(providerIds, 3)
      assert.equal(providerIds[0], 1n)
      assert.equal(providerIds[1], 4n)
      assert.equal(providerIds[2], 7n)
    })

    it('should return empty array when no providers are approved', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const providerIds = await warmStorageService.getApprovedProviderIds()
      assert.lengthOf(providerIds, 0)
    })

    it('should check if a provider ID is approved', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            isProviderApproved: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const isApproved = await warmStorageService.isProviderIdApproved({ providerId: 4n })
      assert.isTrue(isApproved)
    })

    it('should check if a provider ID is not approved', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            isProviderApproved: () => [false],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const isApproved = await warmStorageService.isProviderIdApproved({ providerId: 99n })
      assert.isFalse(isApproved)
    })

    it('should get owner address', async () => {
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorage: {
            ...Mocks.presets.basic.warmStorage,
            owner: () => [ownerAddress as `0x${string}`],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const owner = await warmStorageService.getOwner()
      assert.equal(owner.toLowerCase(), ownerAddress.toLowerCase())
    })

    it('should check if signer is owner', async () => {
      const signerAddress = '0x1234567890123456789012345678901234567890'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorage: {
            ...Mocks.presets.basic.warmStorage,
            owner: () => [signerAddress as `0x${string}`],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const isOwner = await warmStorageService.isOwner({ address: signerAddress })
      assert.isTrue(isOwner)
    })

    it('should check if signer is not owner', async () => {
      const signerAddress = '0x1234567890123456789012345678901234567890'
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorage: {
            ...Mocks.presets.basic.warmStorage,
            owner: () => [ownerAddress as `0x${string}`],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const isOwner = await warmStorageService.isOwner({ address: signerAddress })
      assert.isFalse(isOwner)
    })

    it('should add approved provider (mock transaction)', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        })
      )
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.addApprovedProvider({ providerId: 4n })
      assert.equal(tx, '0x43471ce4a501b1701aab800e10ea29882944dc1b4bfb85aa3fab7a82c5dba343')
    })

    it('should terminate dataset (mock tx)', async () => {
      server.use(Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }))
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.terminateDataSet({ dataSetId: 4n })
      assert.equal(tx, '0xe1a356b6152a11ea58ac7bfb00498d1f9dbf47d6755207a5691a3a8f4a7f6d35')
    })

    it('should remove approved provider with correct index', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.removeApprovedProvider({ providerId: 4n })
      assert.equal(tx, '0xfa867814246175591c887b2fc918c006f258ce141128c9a3fbcdde5a64de1e89')
    })

    it('should throw when removing non-existent provider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      try {
        await warmStorageService.removeApprovedProvider({ providerId: 99n })
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.include(error.message, 'Provider 99 is not in the approved list')
      }
    })
  })

  describe('getMaxProvingPeriod() and getChallengeWindow()', () => {
    it('should return max proving period from WarmStorage contract', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getPDPConfig: () => [BigInt(2880), BigInt(60), BigInt(1), BigInt(0)],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const pdpConfig = await warmStorageService.getPDPConfig()
      const result = pdpConfig.maxProvingPeriod
      assert.equal(result, 2880n)
    })

    it('should return challenge window from WarmStorage contract', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getPDPConfig: () => [BigInt(2880), BigInt(60), BigInt(1), BigInt(0)],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const pdpConfig = await warmStorageService.getPDPConfig()
      const result = pdpConfig.challengeWindowSize
      assert.equal(result, 60n)
    })

    it('should handle contract call failures', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getPDPConfig: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getPDPConfig()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('CDN Operations', () => {
    it('should top up CDN payment rails (mock transaction)', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: true,
        })
      )
      const dataSetId = 49n
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.topUpCDNPaymentRails({
        dataSetId,
        cdnAmountToAdd: 1n,
        cacheMissAmountToAdd: 1n,
      })
      assert.equal(tx, '0x8a743df561386558f7e9468beb4538cd0afc41297e54959359cb96e3ca36b822')
    })
  })
})
