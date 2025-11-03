/* globals describe it beforeEach */

/**
 * Tests for WarmStorageService class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { type Address, parseUnits } from 'viem'
import { PaymentsService } from '../payments/index.ts'
import { CONTRACT_ADDRESSES, SIZE_CONSTANTS, TIME_CONSTANTS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { makeDataSetCreatedLog } from './mocks/events.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'

// mock server for testing
const server = setup([])

describe('WarmStorageService', () => {
  let provider: ethers.Provider
  let signer: ethers.Signer
  let paymentsService: PaymentsService

  // Helper to create WarmStorageService with factory pattern
  const createWarmStorageService = async () => {
    return await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
  }

  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
    paymentsService = new PaymentsService(
      provider,
      signer,
      ADDRESSES.calibration.payments,
      ADDRESSES.calibration.usdfcToken,
      false
    )
    server.resetHandlers()
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', async () => {
      server.use(JSONRPC(presets.basic))
      const warmStorageService = await createWarmStorageService()
      assert.exists(warmStorageService)
      assert.isFunction(warmStorageService.getClientDataSets)
    })
  })

  describe('getDataSet', () => {
    it('should return a single data set by ID', async () => {
      server.use(JSONRPC(presets.basic))
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 1

      const result = await warmStorageService.getDataSet(dataSetId)
      assert.exists(result)
      assert.equal(result?.pdpRailId, 1)
      assert.equal(result?.cacheMissRailId, 0)
      assert.equal(result?.cdnRailId, 0)
      assert.equal(result?.payer, ADDRESSES.client1)
      assert.equal(result?.payee, ADDRESSES.serviceProvider1)
      assert.equal(result?.serviceProvider, ADDRESSES.serviceProvider1)
      assert.equal(result?.commissionBps, 100)
      assert.equal(result?.clientDataSetId, 0n)
      assert.equal(result?.pdpEndEpoch, 0)
      assert.equal(result?.providerId, 1)
      assert.equal(result?.dataSetId, 1)
    })

    it('should throw for non-existent data set', async () => {
      server.use(JSONRPC(presets.basic))
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999

      try {
        await warmStorageService.getDataSet(dataSetId)
        assert.fail('Should have thrown error for non-existent data set')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 does not exist')
      }
    })

    it('should handle contract revert gracefully', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            // @ts-expect-error - we want to test the error case
            getDataSet: () => {
              return null
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999

      try {
        await warmStorageService.getDataSet(dataSetId)
        assert.fail('Should have thrown error for contract revert')
      } catch (error: any) {
        assert.include(error.message, 'execution reverted')
      }
    })
  })

  describe('getClientDataSets', () => {
    it('should return empty array when client has no data sets', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            getClientDataSets: () => [[]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSets = await warmStorageService.getClientDataSets(ADDRESSES.client1)
      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 0)
    })

    it('should return data sets for a client', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            getClientDataSets: () => [
              [
                {
                  pdpRailId: 1n,
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  payer: ADDRESSES.client1,
                  payee: ADDRESSES.serviceProvider1,
                  serviceProvider: ADDRESSES.serviceProvider1,
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
                  payer: ADDRESSES.client1,
                  payee: ADDRESSES.serviceProvider1,
                  serviceProvider: ADDRESSES.serviceProvider1,
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

      const dataSets = await warmStorageService.getClientDataSets(ADDRESSES.client1)

      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 2)

      // Check first data set
      assert.equal(dataSets[0].pdpRailId, 1)
      assert.equal(dataSets[0].payer, ADDRESSES.client1)
      assert.equal(dataSets[0].payee, ADDRESSES.serviceProvider1)
      assert.equal(dataSets[0].commissionBps, 100)
      assert.equal(dataSets[0].clientDataSetId, 0n)
      assert.equal(dataSets[0].cdnRailId, 0)

      // Check second data set
      assert.equal(dataSets[1].pdpRailId, 2)
      assert.equal(dataSets[1].payer, ADDRESSES.client1)
      assert.equal(dataSets[1].payee, ADDRESSES.serviceProvider1)
      assert.equal(dataSets[1].commissionBps, 200)
      assert.equal(dataSets[1].clientDataSetId, 1n)
      assert.isAbove(dataSets[1].cdnRailId, 0)
      assert.equal(dataSets[1].cdnRailId, 100)
    })

    it('should handle contract call errors gracefully', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            // @ts-expect-error - we want to test the error case
            getClientDataSets: () => null,
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getClientDataSets(ADDRESSES.client1)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get client data sets')
      }
    })
  })

  describe('getClientDataSetsWithDetails', () => {
    it('should enhance data sets with PDPVerifier details', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => [
              {
                pdpRailId: 48n,
                cacheMissRailId: 0n,
                cdnRailId: 0n,
                payer: ADDRESSES.client1,
                payee: ADDRESSES.payee1,
                serviceProvider: ADDRESSES.serviceProvider1,
                commissionBps: 100n,
                clientDataSetId: 0n,
                pdpEndEpoch: 0n,
                providerId: 1n,
                dataSetId: 242n,
              },
            ],
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [2n],
            getDataSetListener: () => [ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1)

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].pdpRailId, 48)
      assert.equal(detailedDataSets[0].pdpVerifierDataSetId, 242)
      assert.equal(detailedDataSets[0].nextPieceId, 2)
      assert.equal(detailedDataSets[0].currentPieceCount, 2)
      assert.isTrue(detailedDataSets[0].isLive)
      assert.isTrue(detailedDataSets[0].isManaged)
    })

    it('should filter unmanaged data sets when onlyManaged is true', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[242n, 243n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 242n) {
                return [
                  {
                    pdpRailId: 48n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
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
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
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
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getNextPieceId: () => [1n],
            getDataSetListener: (args) => {
              const [dataSetId] = args
              if (dataSetId === 242n) {
                return [ADDRESSES.calibration.warmStorage] // Managed by us
              }
              return ['0x1234567890123456789012345678901234567890' as `0x${string}`] // Different address
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      // Get all data sets
      const allDataSets = await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1, false)
      assert.lengthOf(allDataSets, 2)

      // Get only managed data sets
      const managedDataSets = await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1, true)
      assert.lengthOf(managedDataSets, 1)
      assert.equal(managedDataSets[0].pdpRailId, 48)
      assert.isTrue(managedDataSets[0].isManaged)
    })

    it('should throw error when contract calls fail', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[242n]],
            getDataSet: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getClientDataSetsWithDetails(ADDRESSES.client1)
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
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getDataSetListener: () => [ADDRESSES.calibration.warmStorage],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48

      // Should not throw
      await warmStorageService.validateDataSet(dataSetId)
    })

    it('should throw error if data set is not managed by this WarmStorage', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
            getDataSetListener: () => ['0x1234567890123456789012345678901234567890' as Address], // Different address
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48

      try {
        await warmStorageService.validateDataSet(dataSetId)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'is not managed by this WarmStorage contract')
      }
    })
  })

  describe('verifyDataSetCreation', () => {
    it('should verify successful data set creation', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              hash: mockTxHash,
              from: ADDRESSES.client1,
              gas: '0x5208',
              value: '0x0',
              nonce: '0x444',
              input: '0x',
              v: '0x01',
              r: '0x4e2eef88cc6f2dc311aa3b1c8729b6485bd606960e6ae01522298278932c333a',
              s: '0x5d0e08d8ecd6ed8034aa956ff593de9dc1d392e73909ef0c0f828918b58327c9',
            }
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              transactionHash: mockTxHash,
              transactionIndex: '0x10',
              blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
              status: '0x1',
              blockNumber: '0x3039', // 12345
              cumulativeGasUsed: '0x52080',
              gasUsed: '0x186a0', // 100000
              logs: [makeDataSetCreatedLog(123, 1)],
            }
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isTrue(result.transactionMined)
      assert.isTrue(result.transactionSuccess)
      assert.equal(result.dataSetId, 123)
      assert.exists(result.dataSetId)
      assert.isTrue(result.dataSetLive)
      assert.exists(result.blockNumber)
      assert.exists(result.gasUsed)
    })

    it('should handle transaction not mined yet', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return null
          },
          eth_getTransactionReceipt: () => null,
        })
      )
      const warmStorageService = await createWarmStorageService()
      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isFalse(result.transactionMined)
      assert.isFalse(result.transactionSuccess)
      assert.isUndefined(result.dataSetId)
      assert.isFalse(result.dataSetLive)
    })
  })

  describe('Service Provider ID Operations', () => {
    it('should get list of approved provider IDs', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const providerIds = await warmStorageService.getApprovedProviderIds()
      assert.lengthOf(providerIds, 3)
      assert.equal(providerIds[0], 1)
      assert.equal(providerIds[1], 4)
      assert.equal(providerIds[2], 7)
    })

    it('should return empty array when no providers are approved', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            isProviderApproved: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const isApproved = await warmStorageService.isProviderIdApproved(4)
      assert.isTrue(isApproved)
    })

    it('should check if a provider ID is not approved', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            isProviderApproved: () => [false],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const isApproved = await warmStorageService.isProviderIdApproved(99)
      assert.isFalse(isApproved)
    })

    it('should get owner address', async () => {
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
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
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            owner: () => [signerAddress as `0x${string}`],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => signerAddress,
      } as any

      const isOwner = await warmStorageService.isOwner(mockSigner)
      assert.isTrue(isOwner)
    })

    it('should check if signer is not owner', async () => {
      const signerAddress = '0x1234567890123456789012345678901234567890'
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorage: {
            ...presets.basic.warmStorage,
            owner: () => [ownerAddress as `0x${string}`],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => signerAddress,
      } as any

      const isOwner = await warmStorageService.isOwner(mockSigner)
      assert.isFalse(isOwner)
    })

    it('should get service provider registry address', async () => {
      server.use(JSONRPC(presets.basic))
      const warmStorageService = await createWarmStorageService()
      const registryAddress = warmStorageService.getServiceProviderRegistryAddress()
      // The mock returns this default address for spRegistry
      assert.equal(registryAddress, ADDRESSES.calibration.spRegistry)
    })

    it('should add approved provider (mock transaction)', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
        })
      )
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.addApprovedProvider(signer, 4)
      assert.equal(tx.hash, '0x7696bafeeb480986a9f2409a9b7bdb18703c5833c8b38b94e71c1c9c49b6cace')
    })

    it('should terminate dataset (mock tx)', async () => {
      server.use(JSONRPC(presets.basic))
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.terminateDataSet(signer, 4)
      assert.equal(tx.hash, '0x571f6e23f644237c0765c5904db5140acedb56cc170568c8fa364c435c7f82c4')
    })

    it('should remove approved provider with correct index', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.removeApprovedProvider(signer, 4)
      assert.equal(tx.hash, '0xfabcd114dfa1fe3fe802756baa1db7b915a20a64baf693ea614f17b1f28b36e4')
    })

    it('should throw when removing non-existent provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: () => [[1n, 4n, 7n]],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      try {
        await warmStorageService.removeApprovedProvider(signer, 99)
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.include(error.message, 'Provider 99 is not in the approved list')
      }
    })
  })

  describe('Storage Cost Operations', () => {
    describe('calculateStorageCost', () => {
      it('should calculate storage costs correctly for 1 GiB', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()
        const sizeInBytes = Number(SIZE_CONSTANTS.GiB) // 1 GiB
        const costs = await warmStorageService.calculateStorageCost(sizeInBytes)

        assert.exists(costs.perEpoch)
        assert.exists(costs.perDay)
        assert.exists(costs.perMonth)
        assert.exists(costs.withCDN)
        assert.exists(costs.withCDN.perEpoch)
        assert.exists(costs.withCDN.perDay)
        assert.exists(costs.withCDN.perMonth)

        // Verify costs are reasonable
        assert.isTrue(costs.perEpoch > 0n)
        assert.isTrue(costs.perDay > costs.perEpoch)
        assert.isTrue(costs.perMonth > costs.perDay)

        // CDN costs are usage-based (egress pricing), so withCDN equals base storage cost
        assert.equal(costs.withCDN.perEpoch, costs.perEpoch)
        assert.equal(costs.withCDN.perDay, costs.perDay)
        assert.equal(costs.withCDN.perMonth, costs.perMonth)
      })

      it('should scale costs linearly with size', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()

        const costs1GiB = await warmStorageService.calculateStorageCost(Number(SIZE_CONSTANTS.GiB))
        const costs10GiB = await warmStorageService.calculateStorageCost(Number(10n * SIZE_CONSTANTS.GiB))

        // 10 GiB should cost approximately 10x more than 1 GiB
        // Allow for small rounding differences in bigint division
        const ratio = Number(costs10GiB.perEpoch) / Number(costs1GiB.perEpoch)
        assert.closeTo(ratio, 10, 0.01)

        // Verify the relationship holds for day and month calculations
        assert.equal(costs10GiB.perDay.toString(), (costs10GiB.perEpoch * 2880n).toString())
        // For month calculation, allow for rounding errors due to integer division
        const expectedMonth = costs10GiB.perEpoch * TIME_CONSTANTS.EPOCHS_PER_MONTH
        const monthRatio = Number(costs10GiB.perMonth) / Number(expectedMonth)
        assert.closeTo(monthRatio, 1, 0.0001) // Allow 0.01% difference due to rounding
      })

      it('should fetch pricing from WarmStorage contract', async () => {
        let getServicePriceCalled = false
        server.use(
          JSONRPC({
            ...presets.basic,
            warmStorage: {
              ...presets.basic.warmStorage,
              getServicePrice: () => {
                getServicePriceCalled = true
                return [
                  {
                    pricePerTiBPerMonthNoCDN: parseUnits('2', 18),
                    pricePerTiBCdnEgress: parseUnits('0.05', 18),
                    pricePerTiBCacheMissEgress: parseUnits('0.1', 18),
                    tokenAddress: CONTRACT_ADDRESSES.USDFC.calibration,
                    epochsPerMonth: TIME_CONSTANTS.EPOCHS_PER_MONTH,
                    minimumPricePerMonth: parseUnits('0.01', 18),
                  },
                ]
              },
            },
          })
        )
        const warmStorageService = await createWarmStorageService()
        await warmStorageService.calculateStorageCost(Number(SIZE_CONSTANTS.GiB))
        assert.isTrue(getServicePriceCalled, 'Should have called getServicePrice on WarmStorage contract')
      })
    })

    describe('checkAllowanceForStorage', () => {
      it('should check allowances for storage operations', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(10n * SIZE_CONSTANTS.GiB), // 10 GiB
          false,
          paymentsService
        )

        assert.exists(check.rateAllowanceNeeded)
        assert.exists(check.lockupAllowanceNeeded)
        assert.exists(check.currentRateAllowance)
        assert.exists(check.currentLockupAllowance)
        assert.exists(check.currentRateUsed)
        assert.exists(check.currentLockupUsed)
        assert.exists(check.sufficient)

        // Check for new costs field
        assert.exists(check.costs)
        assert.exists(check.costs.perEpoch)
        assert.exists(check.costs.perDay)
        assert.exists(check.costs.perMonth)
        assert.isAbove(Number(check.costs.perEpoch), 0)
        assert.isAbove(Number(check.costs.perDay), 0)
        assert.isAbove(Number(check.costs.perMonth), 0)

        // Check for depositAmountNeeded field
        assert.exists(check.lockupAllowanceNeeded)
        assert.isTrue(check.lockupAllowanceNeeded > 0n)

        // With no current allowances, should not be sufficient
        assert.isFalse(check.sufficient)
      })

      it('should return sufficient when allowances are adequate', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
            payments: {
              ...presets.basic.payments,
              operatorApprovals: () => [true, parseUnits('100', 18), parseUnits('10000', 18), 0n, 0n, 0n],
            },
          })
        )
        const warmStorageService = await createWarmStorageService()

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.MiB), // 1 MiB - small amount
          false,
          paymentsService
        )

        assert.isTrue(check.sufficient)

        // Verify costs are included
        assert.exists(check.costs)
        assert.exists(check.costs.perEpoch)
        assert.exists(check.costs.perDay)
        assert.exists(check.costs.perMonth)

        // When sufficient, no additional allowance is needed
        assert.exists(check.lockupAllowanceNeeded)
        assert.equal(check.lockupAllowanceNeeded, 0n)
      })

      it('should include depositAmountNeeded in response', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          paymentsService
        )

        // Verify lockupAllowanceNeeded and depositAmountNeeded are present and reasonable
        assert.exists(check.lockupAllowanceNeeded)
        assert.isTrue(check.lockupAllowanceNeeded > 0n)
        assert.exists(check.depositAmountNeeded)
        assert.isTrue(check.depositAmountNeeded > 0n)

        // depositAmountNeeded should equal 30 days of costs (default lockup)
        const expectedDeposit =
          check.costs.perEpoch * TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS * TIME_CONSTANTS.EPOCHS_PER_DAY
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())
      })

      it('should use custom lockup days when provided', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()

        // Test with custom lockup period of 60 days
        const customLockupDays = TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS * 2n
        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          paymentsService,
          Number(customLockupDays)
        )

        // Verify depositAmountNeeded uses custom lockup period
        const expectedDeposit = check.costs.perEpoch * customLockupDays * TIME_CONSTANTS.EPOCHS_PER_DAY
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())

        // Compare with default (30 days) to ensure they're different
        const defaultCheck = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          paymentsService
        )

        // Custom should be exactly 2x default (60 days vs 30 days)
        assert.equal(check.depositAmountNeeded.toString(), (defaultCheck.depositAmountNeeded * 2n).toString())
      })
    })

    describe('prepareStorageUpload', () => {
      it('should prepare storage upload with required actions', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()
        let approveServiceCalled = false

        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: false,
            rateAllowance: 0n,
            lockupAllowance: 0n,
            rateUsed: 0n,
            lockupUsed: 0n,
          }),
          accountInfo: async () => ({
            funds: parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: parseUnits('10000', 18),
          }),
          approveService: async (serviceAddress: string, rateAllowance: bigint, lockupAllowance: bigint) => {
            assert.strictEqual(serviceAddress, ADDRESSES.calibration.warmStorage)
            assert.isTrue(rateAllowance > 0n)
            assert.isTrue(lockupAllowance > 0n)
            approveServiceCalled = true
            return '0xmocktxhash'
          },
        }

        const prep = await warmStorageService.prepareStorageUpload(
          {
            dataSize: Number(10n * SIZE_CONSTANTS.GiB), // 10 GiB
            withCDN: false,
          },
          mockPaymentsService
        )

        assert.exists(prep.estimatedCost)
        assert.exists(prep.estimatedCost.perEpoch)
        assert.exists(prep.estimatedCost.perDay)
        assert.exists(prep.estimatedCost.perMonth)
        assert.exists(prep.allowanceCheck)
        assert.isArray(prep.actions)

        // Should have at least approval action (since mock has no allowances)
        assert.isAtLeast(prep.actions.length, 1)

        const approvalAction = prep.actions.find((a) => a.type === 'approveService')
        assert.exists(approvalAction)
        assert.include(approvalAction.description, 'Approve service')
        assert.isFunction(approvalAction.execute)

        // Execute the action and verify it was called
        await approvalAction.execute()
        assert.isTrue(approveServiceCalled)
      })

      it('should include deposit action when balance insufficient', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()
        let depositCalled = false

        // Create a mock PaymentsService with low balance
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: false,
            rateAllowance: 0n,
            lockupAllowance: 0n,
            rateUsed: 0n,
            lockupUsed: 0n,
          }),
          accountInfo: async () => ({
            funds: parseUnits('0.001', 18), // Very low balance
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: parseUnits('0.001', 18),
          }),
          deposit: async (amount: bigint) => {
            assert.isTrue(amount > 0n)
            depositCalled = true
            return '0xmockdeposittxhash'
          },
          approveService: async () => '0xmocktxhash',
        }

        const prep = await warmStorageService.prepareStorageUpload(
          {
            dataSize: Number(10n * SIZE_CONSTANTS.GiB), // 10 GiB
            withCDN: false,
          },
          mockPaymentsService
        )

        // Should have both deposit and approval actions
        assert.isAtLeast(prep.actions.length, 2)

        const depositAction = prep.actions.find((a) => a.type === 'deposit')
        assert.exists(depositAction)
        assert.include(depositAction.description, 'Deposit')
        assert.include(depositAction.description, 'USDFC')

        const approvalAction = prep.actions.find((a) => a.type === 'approveService')
        assert.exists(approvalAction)

        // Execute deposit action and verify
        await depositAction.execute()
        assert.isTrue(depositCalled)
      })

      it('should return no actions when everything is ready', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
          })
        )
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService with sufficient balance and allowances
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: true,
            rateAllowance: parseUnits('1000', 18),
            lockupAllowance: parseUnits('100000', 18),
            rateUsed: 0n,
            lockupUsed: 0n,
          }),
          accountInfo: async () => ({
            funds: parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: parseUnits('10000', 18),
          }),
        }

        const prep = await warmStorageService.prepareStorageUpload(
          {
            dataSize: Number(SIZE_CONSTANTS.MiB), // 1 MiB - small amount
            withCDN: false,
          },
          mockPaymentsService
        )

        assert.lengthOf(prep.actions, 0)
        assert.isTrue(prep.allowanceCheck.sufficient)
      })
    })
  })

  describe('Comprehensive Status Methods', () => {
    it('should combine PDP server and chain verification status', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              hash: mockTxHash,
              from: ADDRESSES.client1,
              gas: '0x5208',
              value: '0x0',
              nonce: '0x444',
              input: '0x',
              v: '0x01',
              r: '0x4e2eef88cc6f2dc311aa3b1c8729b6485bd606960e6ae01522298278932c333a',
              s: '0x5d0e08d8ecd6ed8034aa956ff593de9dc1d392e73909ef0c0f828918b58327c9',
            }
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              transactionHash: mockTxHash,
              transactionIndex: '0x10',
              blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
              status: '0x1',
              blockNumber: '0x3039', // 12345
              cumulativeGasUsed: '0x52080',
              gasUsed: '0x186a0', // 100000
              logs: [makeDataSetCreatedLog(123, 1)],
            }
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      // Create a mock PDPServer
      const mockPDPServer: any = {
        getDataSetCreationStatus: async (txHash: string) => {
          assert.strictEqual(txHash, mockTxHash)
          return {
            createMessageHash: mockTxHash,
            dataSetCreated: true,
            service: 'test-service',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: 123,
          }
        },
      }

      const result = await warmStorageService.getComprehensiveDataSetStatus(mockTxHash, mockPDPServer)

      // Verify transaction hash is included
      assert.strictEqual(result.txHash, mockTxHash)
      assert.exists(result.serverStatus)
      assert.exists(result.chainStatus)

      // Verify server status - using correct interface properties
      assert.isTrue(result.serverStatus?.dataSetCreated)
      assert.isTrue(result.serverStatus?.ok)
      assert.strictEqual(result.serverStatus?.dataSetId, 123)

      // Verify chain status - using correct interface properties
      assert.isTrue(result.chainStatus.transactionMined)
      assert.isTrue(result.chainStatus.transactionSuccess)
      assert.exists(result.chainStatus.dataSetId)
      assert.strictEqual(result.chainStatus.dataSetId, 123)
      assert.isTrue(result.chainStatus.dataSetLive)

      // Verify summary
      assert.isTrue(result.summary.isComplete)
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isNull(result.summary.error)
    })

    it('should handle PDP server failure gracefully', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              hash: mockTxHash,
              from: ADDRESSES.client1,
              gas: '0x5208',
              value: '0x0',
              nonce: '0x444',
              input: '0x',
            }
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              transactionHash: mockTxHash,
              transactionIndex: '0x10',
              blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
              status: '0x1',
              blockNumber: '0x3039', // 12345
              cumulativeGasUsed: '0x52080',
              gasUsed: '0x186a0', // 100000
              logs: [makeDataSetCreatedLog(123, 1)],
            }
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      // Create a mock PDPServer that throws error
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          throw new Error('Server unavailable')
        },
      }

      const result = await warmStorageService.getComprehensiveDataSetStatus(mockTxHash, mockPDPServer)

      // Server status should be null due to error
      assert.isNull(result.serverStatus)

      // Chain status should still work
      assert.isTrue(result.chainStatus.transactionMined)
      assert.isTrue(result.chainStatus.transactionSuccess)
      assert.strictEqual(result.chainStatus.dataSetId, 123)
      assert.isTrue(result.chainStatus.dataSetLive)

      // Summary should reflect that completion requires BOTH chain AND server confirmation
      // Since server status is null (unavailable), isComplete should be false
      assert.isFalse(result.summary.isComplete, 'isComplete should be false when server status is unavailable')
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isNull(result.summary.error)
    })

    it('should NOT mark as complete when server has not caught up yet', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              hash: mockTxHash,
              from: ADDRESSES.client1,
              gas: '0x5208',
              value: '0x0',
              nonce: '0x444',
              input: '0x',
            }
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              transactionHash: mockTxHash,
              transactionIndex: '0x10',
              blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
              status: '0x1',
              blockNumber: '0x3039', // 12345
              cumulativeGasUsed: '0x52080',
              gasUsed: '0x186a0', // 100000
              logs: [makeDataSetCreatedLog(123, 1)],
            }
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      // Create a mock PDPServer that returns null (server hasn't caught up)
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          throw new Error('Data set creation status not found')
        },
      }

      const result = await warmStorageService.getComprehensiveDataSetStatus(mockTxHash, mockPDPServer)

      // Chain status should show success
      assert.isTrue(result.chainStatus.transactionMined)
      assert.isTrue(result.chainStatus.transactionSuccess)
      assert.isTrue(result.chainStatus.dataSetLive)
      assert.strictEqual(result.chainStatus.dataSetId, 123)

      // Server status should be null (server hasn't caught up)
      assert.isNull(result.serverStatus)

      // IMPORTANT: isComplete should be FALSE because server hasn't confirmed yet
      // This test will FAIL with the current implementation, proving the bug
      assert.isFalse(result.summary.isComplete, 'isComplete should be false when server has not caught up')
    })

    it('should wait for data set to become live', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      let callCount = 0

      // Create a mock PDPServer
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          callCount++
          if (callCount === 1) {
            // First call - not created yet
            return {
              createMessageHash: mockTxHash,
              dataSetCreated: false,
              service: 'test-service',
              txStatus: 'pending',
              ok: null,
              dataSetId: undefined,
            }
          } else {
            // Second call - created
            return {
              createMessageHash: mockTxHash,
              dataSetCreated: true,
              service: 'test-service',
              txStatus: 'confirmed',
              ok: true,
              dataSetId: 123,
            }
          }
        },
      }

      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionByHash: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            return {
              hash: mockTxHash,
              from: ADDRESSES.client1,
              gas: '0x5208',
              value: '0x0',
              nonce: '0x444',
              input: '0x',
            }
          },
          eth_getTransactionReceipt: (params) => {
            const hash = params[0]
            assert.equal(hash, mockTxHash)
            // Receipt should be available after first PDPServer call (callCount >= 1)
            if (callCount < 1) {
              return null // Not mined yet
            } else {
              return {
                transactionHash: mockTxHash,
                transactionIndex: '0x10',
                blockHash: '0xb91b7314248aaae06f080ad427dbae78b8c5daf72b2446cf843739aef80c6417',
                status: '0x1',
                blockNumber: '0x3039', // 12345
                cumulativeGasUsed: '0x52080',
                gasUsed: '0x186a0', // 100000
                logs: [makeDataSetCreatedLog(123, 1)],
              }
            }
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: () => [true],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      const result = await warmStorageService.waitForDataSetCreationWithStatus(
        mockTxHash,
        mockPDPServer,
        5000, // 5 second timeout
        100 // 100ms poll interval
      )

      assert.isTrue(result.summary.isComplete)
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isTrue(callCount >= 2) // Should have polled at least twice
    })

    it('should timeout if data set takes too long', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_getTransactionReceipt: () => null,
        })
      )
      const warmStorageService = await createWarmStorageService()

      // Create a mock PDPServer that always returns pending
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          return {
            createMessageHash: mockTxHash,
            dataSetCreated: false,
            service: 'test-service',
            txStatus: 'pending',
            ok: null,
            dataSetId: undefined,
          }
        },
      }

      try {
        const mockTransaction = { hash: mockTxHash } as any
        await warmStorageService.waitForDataSetCreationWithStatus(
          mockTransaction,
          mockPDPServer,
          300, // 300ms timeout
          100 // 100ms poll interval
        )
        assert.fail('Should have thrown timeout error')
      } catch (error: any) {
        assert.include(error.message, 'Data set creation timed out after')
      }
    })
  })

  describe('getMaxProvingPeriod() and getChallengeWindow()', () => {
    it('should return max proving period from WarmStorage contract', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getMaxProvingPeriod: () => [BigInt(2880)],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const result = await warmStorageService.getMaxProvingPeriod()
      assert.equal(result, 2880)
    })

    it('should return challenge window from WarmStorage contract', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            challengeWindow: () => [BigInt(60)],
          },
        })
      )
      const warmStorageService = await createWarmStorageService()
      const result = await warmStorageService.getChallengeWindow()
      assert.equal(result, 60)
    })

    it('should handle contract call failures', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getMaxProvingPeriod: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )
      const warmStorageService = await createWarmStorageService()

      try {
        await warmStorageService.getMaxProvingPeriod()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('CDN Operations', () => {
    it('should top up CDN payment rails (mock transaction)', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
        })
      )
      const dataSetId = 49
      const warmStorageService = await createWarmStorageService()

      const tx = await warmStorageService.topUpCDNPaymentRails(signer, dataSetId, 1n, 1n)
      assert.equal(tx.hash, '0x5ecec136ca6818e5d8a1d46c6efe2cbbdd615e9b74353957d01fbe6f8c67d0f3')
    })
  })
})
