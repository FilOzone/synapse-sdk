/* globals describe it beforeEach */

/**
 * Tests for WarmStorageService class
 */

import * as Abis from '@filoz/synapse-core/abis'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { CONTRACT_ADDRESSES, SIZE_CONSTANTS, TIME_CONSTANTS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { createMockProvider, extendMockProviderCall, MOCK_ADDRESSES } from './test-utils.ts'

describe('WarmStorageService', () => {
  let mockProvider: ethers.Provider
  let cleanup: (() => void) | undefined
  const mockWarmStorageAddress = MOCK_ADDRESSES.WARM_STORAGE
  const mockViewAddress = MOCK_ADDRESSES.WARM_STORAGE_VIEW
  const clientAddress = '0x1234567890123456789012345678901234567890'

  // Create Interface instances for encoding/decoding contract responses
  const viewInterface = new ethers.Interface(Abis.storageView)
  const warmInterface = new ethers.Interface(Abis.storage)

  // Helper to handle viewContractAddress calls
  const handleViewContractAddress = (data: string | undefined): string | null => {
    if (data?.startsWith('0x7a9ebc15') === true) {
      return ethers.AbiCoder.defaultAbiCoder().encode(['address'], [mockViewAddress])
    }
    return null
  }

  // Helper to create WarmStorageService with factory pattern
  const createWarmStorageService = async () => {
    return await WarmStorageService.create(mockProvider, mockWarmStorageAddress)
  }

  /**
   * Helper to create a mock provider call that automatically handles viewContractAddress
   * Eliminates duplication of the viewContractAddress check in every test
   */
  const mockProviderWithView = (
    customHandler: (data: string | undefined) => string | null | Promise<string | null>
  ) => {
    return extendMockProviderCall(mockProvider, async (transaction: any) => {
      const data = transaction.data

      // Always check viewContractAddress first
      const viewResult = handleViewContractAddress(data)
      if (viewResult != null) return viewResult

      // Then run the custom handler
      const customResult = await customHandler(data)
      if (customResult != null) return customResult

      // Default fallback
      return `0x${'0'.repeat(64)}`
    })
  }

  beforeEach(() => {
    mockProvider = createMockProvider()
    cleanup = undefined
  })

  afterEach(() => {
    if (cleanup) {
      cleanup()
    }
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', async () => {
      const warmStorageService = await createWarmStorageService()
      assert.exists(warmStorageService)
      assert.isFunction(warmStorageService.getClientDataSets)
    })
  })

  describe('getDataSet', () => {
    it('should return a single data set by ID', async () => {
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 123

      cleanup = mockProviderWithView((data) => {
        // getDataSet call - function selector for getDataSet(uint256)
        if (data?.startsWith('0xbdaac056') === true) {
          // Create a valid data set object
          const dataSetInfo = {
            pdpRailId: 456,
            cacheMissRailId: 457,
            cdnRailId: 458,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0x2345678901234567890123456789012345678901',
            serviceProvider: '0x3456789012345678901234567890123456789012',
            commissionBps: 100,
            clientDataSetId: 5n,
            pdpEndEpoch: 0,
            providerId: 1,
            dataSetId: BigInt(dataSetId),
          }
          // Use the Interface to encode the return data properly
          return viewInterface.encodeFunctionResult('getDataSet', [dataSetInfo])
        }
        return null
      })

      const result = await warmStorageService.getDataSet(dataSetId)
      assert.exists(result)
      assert.equal(result?.pdpRailId, 456)
      assert.equal(result?.cacheMissRailId, 457)
      assert.equal(result?.cdnRailId, 458)
      assert.equal(result?.payer, '0x1234567890123456789012345678901234567890')
      assert.equal(result?.clientDataSetId, 5n)
    })

    it('should throw for non-existent data set', async () => {
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999

      cleanup = mockProviderWithView((data) => {
        // getDataSet call
        if (data?.startsWith('0xbdaac056') === true) {
          // Return a data set with pdpRailId = 0 (indicates non-existent)
          const emptyDataSet = {
            pdpRailId: 0,
            cacheMissRailId: 0,
            cdnRailId: 0,
            payer: ethers.ZeroAddress,
            payee: ethers.ZeroAddress,
            serviceProvider: ethers.ZeroAddress,
            commissionBps: 0,
            clientDataSetId: 0n,
            pdpEndEpoch: 0,
            providerId: 0,
            dataSetId: BigInt(dataSetId),
          }
          // Use the Interface to encode the return data properly
          return viewInterface.encodeFunctionResult('getDataSet', [emptyDataSet])
        }
        return null
      })

      try {
        await warmStorageService.getDataSet(dataSetId)
        assert.fail('Should have thrown error for non-existent data set')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 does not exist')
      }
    })

    it('should handle contract revert gracefully', async () => {
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 999

      // Override the call method to simulate a revert
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Check for viewContractAddress first
        const viewResult = handleViewContractAddress(data)
        if (viewResult != null) return viewResult

        // Simulate revert for getDataSet
        if (data?.startsWith('0xbdaac056') === true) {
          throw new Error('execution reverted: Contract error')
        }

        return originalCall.call(mockProvider, transaction)
      }

      try {
        await warmStorageService.getDataSet(dataSetId)
        assert.fail('Should have thrown error for contract revert')
      } catch (error: any) {
        assert.include(error.message, 'execution reverted')
      }

      // Restore original call
      mockProvider.call = originalCall
    })
  })

  describe('getClientDataSets', () => {
    it('should return empty array when client has no data sets', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock provider will return empty array by default
      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x967c6f21') === true) {
          // Return empty array
          return viewInterface.encodeFunctionResult('getClientDataSets', [[]])
        }
        return null
      })

      const dataSets = await warmStorageService.getClientDataSets(clientAddress)
      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 0)
    })

    it('should return data sets for a client', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock provider to return data sets
      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x967c6f21') === true) {
          // Return two data sets
          const dataSet1 = {
            id: 1n,
            pdpRailId: 123n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0xabcdef1234567890123456789012345678901234',
            commissionBps: 100n, // 1%
            clientDataSetId: 0n,
            paymentEndEpoch: 0n,
            providerId: 1n,
          }

          const dataSet2 = {
            id: 2n,
            pdpRailId: 456n,
            cacheMissRailId: 457n,
            cdnRailId: 458n, // Has CDN
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0x9876543210987654321098765432109876543210',
            commissionBps: 200n, // 2%
            clientDataSetId: 1n,
            paymentEndEpoch: 0n,
            providerId: 2n,
          }

          // Create properly ordered arrays for encoding
          const dataSets = [
            [
              dataSet1.pdpRailId,
              dataSet1.cacheMissRailId,
              dataSet1.cdnRailId,
              dataSet1.payer,
              dataSet1.payee,
              dataSet1.payee, // serviceProvider (using same as payee for test)
              dataSet1.commissionBps,
              dataSet1.clientDataSetId,
              dataSet1.paymentEndEpoch, // pdpEndEpoch
              dataSet1.providerId,
              dataSet1.id,
            ],
            [
              dataSet2.pdpRailId,
              dataSet2.cacheMissRailId,
              dataSet2.cdnRailId,
              dataSet2.payer,
              dataSet2.payee,
              dataSet2.payee, // serviceProvider (using same as payee for test)
              dataSet2.commissionBps,
              dataSet2.clientDataSetId,
              dataSet2.paymentEndEpoch, // pdpEndEpoch
              dataSet2.providerId,
              dataSet2.id,
            ],
          ]

          return viewInterface.encodeFunctionResult('getClientDataSets', [dataSets])
        }
        return null
      })

      const dataSets = await warmStorageService.getClientDataSets(clientAddress)

      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 2)

      // Check first data set
      assert.equal(dataSets[0].pdpRailId, 123)
      assert.equal(dataSets[0].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(dataSets[0].payee.toLowerCase(), '0xabcdef1234567890123456789012345678901234'.toLowerCase())
      assert.equal(dataSets[0].commissionBps, 100)
      assert.equal(dataSets[0].clientDataSetId, 0n)
      assert.equal(dataSets[0].cdnRailId, 0) // No CDN

      // Check second data set
      assert.equal(dataSets[1].pdpRailId, 456)
      assert.equal(dataSets[1].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(dataSets[1].payee.toLowerCase(), '0x9876543210987654321098765432109876543210'.toLowerCase())
      assert.equal(dataSets[1].commissionBps, 200)
      assert.equal(dataSets[1].clientDataSetId, 1n)
      assert.isAbove(dataSets[1].cdnRailId, 0) // Has CDN
    })

    it('should handle contract call errors gracefully', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock provider to throw error
      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x967c6f21') === true) {
          throw new Error('Contract call failed')
        }
        return null
      })

      try {
        await warmStorageService.getClientDataSets(clientAddress)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get client data sets')
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('getClientDataSetsWithDetails', () => {
    it('should enhance data sets with PDPVerifier details', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock provider for multiple contract calls
      cleanup = mockProviderWithView((data) => {
        // clientDataSets(address) selector: 0x7dab7c40
        if (data?.startsWith('0x7dab7c40') === true) {
          return viewInterface.encodeFunctionResult('clientDataSets', [[242n]])
        }

        // dataSetLive call (using existing selector used in tests)
        if (data?.startsWith('0xca759f27') === true) {
          // dataSetId(uint256) selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }

        // getNextPieceId call
        if (data?.startsWith('0x1c5ae80f') === true) {
          // getNextPieceId(uint256) selector
          return ethers.zeroPadValue('0x02', 32) // Return 2
        }

        // getDataSetListener call
        if (data?.startsWith('0x2b3129bb') === true) {
          // getDataSetListener(uint256) selector
          return ethers.zeroPadValue(mockWarmStorageAddress, 32)
        }

        // getDataSet(view) for PDPVerifier dataset id 242
        if (data?.startsWith('0xbdaac056') === true) {
          const dataSetInfo = {
            pdpRailId: 48,
            cacheMissRailId: 0,
            cdnRailId: 0,
            payer: clientAddress,
            payee: '0xabcdef1234567890123456789012345678901234',
            serviceProvider: '0xabcdef1234567890123456789012345678901234',
            commissionBps: 100,
            clientDataSetId: 0n,
            pdpEndEpoch: 0,
            providerId: 1,
            dataSetId: 242n,
          }
          return viewInterface.encodeFunctionResult('getDataSet', [dataSetInfo])
        }

        return null
      })

      // Mock network for PDPVerifier address
      const originalGetNetwork = mockProvider.getNetwork
      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].pdpRailId, 48)
      assert.equal(detailedDataSets[0].pdpVerifierDataSetId, 242)
      assert.equal(detailedDataSets[0].nextPieceId, 2)
      assert.equal(detailedDataSets[0].currentPieceCount, 2)
      assert.isTrue(detailedDataSets[0].isLive)
      assert.isTrue(detailedDataSets[0].isManaged)

      mockProvider.getNetwork = originalGetNetwork
    })

    it('should filter unmanaged data sets when onlyManaged is true', async () => {
      const warmStorageService = await createWarmStorageService()
      cleanup = mockProviderWithView((data) => {
        // clientDataSets(address) selector: 0x7dab7c40
        if (data?.startsWith('0x7dab7c40') === true) {
          return viewInterface.encodeFunctionResult('clientDataSets', [[242n, 243n]])
        }

        // dataSetId - both are live
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSetListener - first is managed, second is not
        if (data?.startsWith('0x2b3129bb') === true) {
          // Extract the data set ID from the encoded data
          const dataSetIdHex = data.slice(10, 74) // Skip function selector and get 32 bytes
          if (dataSetIdHex === ethers.zeroPadValue('0xf2', 32).slice(2)) {
            // data set 242
            return ethers.zeroPadValue(mockWarmStorageAddress, 32) // Managed by us
          } else if (dataSetIdHex === ethers.zeroPadValue('0xf3', 32).slice(2)) {
            // data set 243
            return ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32) // Different address
          }
          return ethers.zeroPadValue('0x0000000000000000000000000000000000000000', 32)
        }

        // getNextPieceId
        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSet(view) for each dataset id
        if (data?.startsWith('0xbdaac056') === true) {
          // Determine which ID was requested by inspecting calldata (not strictly necessary for mock)
          // Return appropriate base info so pdpRailId differs
          const dataSetIdHex = data.slice(10, 74)
          const baseInfo = (id: number) => ({
            pdpRailId: id === 242 ? 48 : 49,
            cacheMissRailId: 0,
            cdnRailId: 0,
            payer: clientAddress,
            payee:
              id === 242 ? '0xabc1234567890123456789012345678901234567' : '0xdef1234567890123456789012345678901234567',
            serviceProvider:
              id === 242 ? '0xabc1234567890123456789012345678901234567' : '0xdef1234567890123456789012345678901234567',
            commissionBps: 100,
            clientDataSetId: id === 242 ? 0n : 1n,
            pdpEndEpoch: 0,
            providerId: id === 242 ? 1 : 2,
            dataSetId: BigInt(id),
          })
          const id = dataSetIdHex === ethers.zeroPadValue('0xf2', 32).slice(2) ? 242 : 243
          return viewInterface.encodeFunctionResult('getDataSet', [baseInfo(id)])
        }

        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      // Get all data sets
      const allDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress, false)
      assert.lengthOf(allDataSets, 2)

      // Get only managed data sets
      const managedDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress, true)
      assert.lengthOf(managedDataSets, 1)
      assert.equal(managedDataSets[0].pdpRailId, 48)
      assert.isTrue(managedDataSets[0].isManaged)
    })

    it('should throw error when contract calls fail', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock clientDataSets to return a data set ID, then cause failure in subsequent call
      cleanup = mockProviderWithView((data) => {
        // clientDataSets(address) selector: 0x7dab7c40
        if (data?.startsWith('0x7dab7c40') === true) {
          return viewInterface.encodeFunctionResult('clientDataSets', [[242n]])
        }

        // Cause failure during getDataSet(view)
        if (data?.startsWith('0xbdaac056') === true) {
          throw new Error('Contract call failed')
        }

        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await warmStorageService.getClientDataSetsWithDetails(clientAddress)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get details for data set')
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('getManagedDataSets', () => {
    it('should return only managed data sets', async () => {
      const warmStorageService = await createWarmStorageService()
      // Set up mocks similar to above
      cleanup = mockProviderWithView((data) => {
        // clientDataSets(address) -> [242]
        if (data?.startsWith('0x7dab7c40') === true) {
          return viewInterface.encodeFunctionResult('clientDataSets', [[242n]])
        }

        // dataSetLive
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSetListener -> managed by warm storage
        if (data?.startsWith('0x2b3129bb') === true) {
          return ethers.zeroPadValue(mockWarmStorageAddress, 32)
        }

        // getNextPieceId
        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSet(view)
        if (data?.startsWith('0xbdaac056') === true) {
          const info = {
            pdpRailId: 48,
            cacheMissRailId: 0,
            cdnRailId: 0,
            payer: clientAddress,
            payee: '0xabc1234567890123456789012345678901234567',
            serviceProvider: '0xabc1234567890123456789012345678901234567',
            commissionBps: 100,
            clientDataSetId: 0n,
            pdpEndEpoch: 0,
            providerId: 1,
            dataSetId: 242n,
          }
          return viewInterface.encodeFunctionResult('getDataSet', [info])
        }

        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const dataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)
      const managedDataSets = dataSets.filter((ps) => ps.isManaged)
      assert.lengthOf(managedDataSets, 1)
      assert.isTrue(managedDataSets[0].isManaged)
    })
  })

  describe('validateDataSet', () => {
    it('should validate dataset successfully', async () => {
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48
      cleanup = mockProviderWithView((data) => {
        // railToDataSet - maps rail ID to data set ID
        if (data?.includes('railToDataSet') === true || data?.startsWith('0x2ad6e6b5') === true) {
          // Rail ID 48 maps to data set ID 48
          return ethers.zeroPadValue('0x30', 32) // 48 in hex
        }

        // dataSetLive
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }

        // getDataSetListener
        if (data?.startsWith('0x2b3129bb') === true) {
          return ethers.zeroPadValue(mockWarmStorageAddress, 32)
        }

        // getClientDataSets - returns array of data sets for the client (with new fields)
        if (data?.startsWith('0x967c6f21') === true) {
          const dataSet = [
            48n, // pdpRailId
            0n, // cacheMissRailId
            0n, // cdnRailId
            clientAddress, // payer
            '0xabc1234567890123456789012345678901234567', // payee
            '0xabc1234567890123456789012345678901234567', // serviceProvider
            100n, // commissionBps
            3n, // clientDataSetId
            0n, // pdpEndEpoch
            1n, // providerId
            BigInt(dataSetId),
          ]
          return viewInterface.encodeFunctionResult('getClientDataSets', [[dataSet]])
        }

        // getDataSet
        if (data?.startsWith('0xbdaac056') === true) {
          const info = {
            pdpRailId: 48n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: clientAddress,
            payee: '0xabc1234567890123456789012345678901234567',
            serviceProvider: '0xabc1234567890123456789012345678901234567',
            commissionBps: 100n,
            clientDataSetId: 0n, // expecting 0
            pdpEndEpoch: 0n,
            providerId: 1n,
            dataSetId: BigInt(dataSetId),
          }
          return viewInterface.encodeFunctionResult('getDataSet', [info])
        }

        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      // Should not throw
      await warmStorageService.validateDataSet(dataSetId)
    })

    it('should throw error if data set is not managed by this WarmStorage', async () => {
      const warmStorageService = await createWarmStorageService()
      const dataSetId = 48
      cleanup = mockProviderWithView((data) => {
        // railToDataSet - maps rail ID to data set ID
        if (data?.includes('railToDataSet') === true || data?.startsWith('0x2ad6e6b5') === true) {
          // Rail ID 48 maps to a different data set ID (99) to simulate not found
          return ethers.zeroPadValue('0x63', 32) // 99 in hex - different from expected 48
        }

        // getClientDataSets - returns array of data sets for the client (with new fields)
        if (data?.startsWith('0x967c6f21') === true) {
          const dataSet = [
            48n, // pdpRailId
            0n, // cacheMissRailId
            0n, // cdnRailId
            clientAddress, // payer
            '0xabc1234567890123456789012345678901234567', // payee
            '0xabc1234567890123456789012345678901234567', // serviceProvider
            100n, // commissionBps
            3n, // clientDataSetId
            0n, // pdpEndEpoch
            1n, // providerId
            BigInt(dataSetId),
          ]
          return viewInterface.encodeFunctionResult('getClientDataSets', [[dataSet]])
        }

        // dataSetId
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSetListener
        if (data?.startsWith('0x2b3129bb') === true) {
          return ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32) // Different address
        }

        // getNextPieceId
        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSet
        if (data?.startsWith('0xbdaac056') === true) {
          const info = {
            pdpRailId: 48n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: clientAddress,
            payee: '0xabc1234567890123456789012345678901234567',
            serviceProvider: '0xabc1234567890123456789012345678901234567',
            commissionBps: 100n,
            clientDataSetId: 3n,
            pdpEndEpoch: 0n,
            providerId: 1n,
          }
          return viewInterface.encodeFunctionResult('getDataSet', [info])
        }

        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

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
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock getTransaction
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
        } as any
      }

      // Mock getTransactionReceipt
      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [
            {
              serviceProvider: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
              topics: [
                ethers.id('DataSetCreated(uint256,address)'),
                ethers.zeroPadValue('0x7b', 32), // data set ID 123
                ethers.zeroPadValue(clientAddress, 32), // owner address
              ],
              data: '0x', // Empty data for indexed parameters
            },
          ],
        } as any
      }

      // Mock dataSetId check
      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }
        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isTrue(result.transactionMined)
      assert.isTrue(result.transactionSuccess)
      assert.equal(result.dataSetId, 123)
      assert.exists(result.dataSetId)
      assert.isTrue(result.dataSetLive)
      assert.exists(result.blockNumber)
      assert.exists(result.gasUsed)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should handle transaction not mined yet', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => null,
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null

      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isFalse(result.transactionMined)
      assert.isFalse(result.transactionSuccess)
      assert.isUndefined(result.dataSetId)
      assert.isFalse(result.dataSetLive)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })
  })

  describe('Service Provider ID Operations', () => {
    it('should get list of approved provider IDs', async () => {
      const warmStorageService = await createWarmStorageService()

      cleanup = mockProviderWithView((data) => {
        // getApprovedProviders selector
        if (data?.startsWith('0x7709a7f7') === true) {
          // Return array of provider IDs [1, 4, 7]
          return viewInterface.encodeFunctionResult('getApprovedProviders', [[1n, 4n, 7n]])
        }
        return null
      })

      const providerIds = await warmStorageService.getApprovedProviderIds()
      assert.lengthOf(providerIds, 3)
      assert.equal(providerIds[0], 1)
      assert.equal(providerIds[1], 4)
      assert.equal(providerIds[2], 7)
    })

    it('should return empty array when no providers are approved', async () => {
      const warmStorageService = await createWarmStorageService()

      cleanup = mockProviderWithView((data) => {
        // getApprovedProviders selector
        if (data?.startsWith('0x7709a7f7') === true) {
          // Return empty array
          return viewInterface.encodeFunctionResult('getApprovedProviders', [[]])
        }
        return null
      })

      const providerIds = await warmStorageService.getApprovedProviderIds()
      assert.lengthOf(providerIds, 0)
    })

    it('should check if a provider ID is approved', async () => {
      const warmStorageService = await createWarmStorageService()

      cleanup = mockProviderWithView((data) => {
        // isProviderApproved selector
        if (data?.startsWith('0xb6133b7a') === true) {
          // Return true for provider ID 4
          return viewInterface.encodeFunctionResult('isProviderApproved', [true])
        }
        return null
      })

      const isApproved = await warmStorageService.isProviderIdApproved(4)
      assert.isTrue(isApproved)
    })

    it('should check if a provider ID is not approved', async () => {
      const warmStorageService = await createWarmStorageService()

      cleanup = mockProviderWithView((data) => {
        // isProviderApproved selector
        if (data?.startsWith('0xb6133b7a') === true) {
          // Return false for provider ID 99
          return viewInterface.encodeFunctionResult('isProviderApproved', [false])
        }
        return null
      })

      const isApproved = await warmStorageService.isProviderIdApproved(99)
      assert.isFalse(isApproved)
    })

    it('should get owner address', async () => {
      const warmStorageService = await createWarmStorageService()
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x8da5cb5b') === true) {
          // owner selector
          return ethers.zeroPadValue(ownerAddress, 32)
        }
        return null
      })

      const owner = await warmStorageService.getOwner()
      assert.equal(owner.toLowerCase(), ownerAddress.toLowerCase())
    })

    it('should check if signer is owner', async () => {
      const warmStorageService = await createWarmStorageService()
      const signerAddress = '0x1234567890123456789012345678901234567890'
      const mockSigner = {
        getAddress: async () => signerAddress,
      } as any

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x8da5cb5b') === true) {
          // owner selector - return same address as signer
          return ethers.zeroPadValue(signerAddress, 32)
        }
        return null
      })

      const isOwner = await warmStorageService.isOwner(mockSigner)
      assert.isTrue(isOwner)
    })

    it('should check if signer is not owner', async () => {
      const warmStorageService = await createWarmStorageService()
      const signerAddress = '0x1234567890123456789012345678901234567890'
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'
      const mockSigner = {
        getAddress: async () => signerAddress,
      } as any

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0x8da5cb5b') === true) {
          // owner selector - return different address
          return ethers.zeroPadValue(ownerAddress, 32)
        }
        return null
      })

      const isOwner = await warmStorageService.isOwner(mockSigner)
      assert.isFalse(isOwner)
    })

    it('should get service provider registry address', async () => {
      const warmStorageService = await createWarmStorageService()
      const registryAddress = warmStorageService.getServiceProviderRegistryAddress()
      // The mock returns this default address for spRegistry
      assert.equal(registryAddress, '0x0000000000000000000000000000000000000001')
    })

    it('should add approved provider (mock transaction)', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890',
      } as any

      cleanup = mockProviderWithView((data) => {
        // addApprovedProvider selector
        if (data?.startsWith('0xe4f77d7f') === true) {
          // Mock successful transaction
          return `0x${'0'.repeat(64)}`
        }
        return null
      })

      // Mock the contract connection
      const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
      ;(warmStorageService as any)._getWarmStorageContract = () => ({
        connect: () => ({
          addApprovedProvider: async () => ({
            hash: '0xmocktxhash',
            wait: async () => ({ status: 1 }),
          }),
        }),
      })

      const tx = await warmStorageService.addApprovedProvider(mockSigner, 4)
      assert.equal(tx.hash, '0xmocktxhash')

      ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
    })

    it('should terminate dataset (mock tx)', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890',
      } as any

      // Mock the contract connection
      const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
      ;(warmStorageService as any)._getWarmStorageContract = () => ({
        connect: () => ({
          terminateService: async (id: number) => {
            assert.equal(id, 4)
            return {
              hash: '0xmocktxhash',
              wait: async () => ({ status: 1 }),
            }
          },
        }),
      })

      const tx = await warmStorageService.terminateDataSet(mockSigner, 4)
      assert.equal(tx.hash, '0xmocktxhash')

      ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
    })

    it('should remove approved provider with correct index', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890',
      } as any

      cleanup = mockProviderWithView((data) => {
        // getApprovedProviders selector - return array with provider 4 at index 1
        if (data?.startsWith('0x7709a7f7') === true) {
          return viewInterface.encodeFunctionResult('getApprovedProviders', [[1n, 4n, 7n]])
        }
        return null
      })

      // Mock the contract connection
      const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
      ;(warmStorageService as any)._getWarmStorageContract = () => ({
        connect: () => ({
          removeApprovedProvider: async (id: number, index: number) => {
            assert.equal(id, 4)
            assert.equal(index, 1) // Provider 4 is at index 1
            return {
              hash: '0xmocktxhash',
              wait: async () => ({ status: 1 }),
            }
          },
        }),
      })

      const tx = await warmStorageService.removeApprovedProvider(mockSigner, 4)
      assert.equal(tx.hash, '0xmocktxhash')

      ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
    })

    it('should throw when removing non-existent provider', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890',
      } as any

      cleanup = mockProviderWithView((data) => {
        // getApprovedProviders selector - return array without provider 99
        if (data?.startsWith('0x7709a7f7') === true) {
          return viewInterface.encodeFunctionResult('getApprovedProviders', [[1n, 4n, 7n]])
        }
        return null
      })

      try {
        await warmStorageService.removeApprovedProvider(mockSigner, 99)
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.include(error.message, 'Provider 99 is not in the approved list')
      }
    })
  })

  describe('Storage Cost Operations', () => {
    describe('calculateStorageCost', () => {
      it('should calculate storage costs correctly for 1 GiB', async () => {
        const warmStorageService = await createWarmStorageService()
        // Mock the getServicePrice call on WarmStorage contract
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            // getServicePrice selector
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            // Encode as a tuple (struct) matching ServicePricing contract struct
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

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
        const warmStorageService = await createWarmStorageService()
        // Mock the getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

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
        const warmStorageService = await createWarmStorageService()
        // This test verifies that the getServicePrice function is called
        let getServicePriceCalled = false
        const originalCall = mockProvider.call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            getServicePriceCalled = true
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            // Encode as a tuple (struct) matching ServicePricing contract struct
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return await originalCall.call(mockProvider, transaction)
        }

        await warmStorageService.calculateStorageCost(Number(SIZE_CONSTANTS.GiB))
        assert.isTrue(getServicePriceCalled, 'Should have called getServicePrice on WarmStorage contract')
      })
    })

    describe('checkAllowanceForStorage', () => {
      it('should check allowances for storage operations', async () => {
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n,
            }
          },
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(10n * SIZE_CONSTANTS.GiB), // 10 GiB
          false,
          mockPaymentsService
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
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService with adequate allowances
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: true,
              rateAllowance: ethers.parseUnits('100', 18),
              lockupAllowance: ethers.parseUnits('10000', 18),
              rateUsed: 0n,
              lockupUsed: 0n,
            }
          },
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.MiB), // 1 MiB - small amount
          false,
          mockPaymentsService
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
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n,
            }
          },
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          mockPaymentsService
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
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n,
            }
          },
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
        }

        // Test with custom lockup period of 60 days
        const customLockupDays = TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS * 2n
        const check = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          mockPaymentsService,
          Number(customLockupDays)
        )

        // Verify depositAmountNeeded uses custom lockup period
        const expectedDeposit = check.costs.perEpoch * customLockupDays * TIME_CONSTANTS.EPOCHS_PER_DAY
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())

        // Compare with default (30 days) to ensure they're different
        const defaultCheck = await warmStorageService.checkAllowanceForStorage(
          Number(SIZE_CONSTANTS.GiB), // 1 GiB
          false,
          mockPaymentsService
        )

        // Custom should be exactly 2x default (60 days vs 30 days)
        assert.equal(check.depositAmountNeeded.toString(), (defaultCheck.depositAmountNeeded * 2n).toString())
      })
    })

    describe('prepareStorageUpload', () => {
      it('should prepare storage upload with required actions', async () => {
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
            funds: ethers.parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('10000', 18),
          }),
          approveService: async (serviceAddress: string, rateAllowance: bigint, lockupAllowance: bigint) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            assert.isTrue(rateAllowance > 0n)
            assert.isTrue(lockupAllowance > 0n)
            approveServiceCalled = true
            return '0xmocktxhash'
          },
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
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
            funds: ethers.parseUnits('0.001', 18), // Very low balance
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('0.001', 18),
          }),
          deposit: async (amount: bigint) => {
            assert.isTrue(amount > 0n)
            depositCalled = true
            return '0xmockdeposittxhash'
          },
          approveService: async () => '0xmocktxhash',
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
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
        const warmStorageService = await createWarmStorageService()
        // Create a mock PaymentsService with sufficient balance and allowances
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: true,
            rateAllowance: ethers.parseUnits('1000', 18),
            lockupAllowance: ethers.parseUnits('100000', 18),
            rateUsed: 0n,
            lockupUsed: 0n,
          }),
          accountInfo: async () => ({
            funds: ethers.parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('10000', 18),
          }),
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data

          // Handle viewContractAddress
          const viewResult = handleViewContractAddress(data)
          if (viewResult != null) return viewResult

          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const tokenAddress = CONTRACT_ADDRESSES.USDFC.calibration
            const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH
            const servicePriceInfo = {
              pricePerTiBPerMonthNoCDN: pricePerTiBPerMonthNoCDN,
              pricePerTiBCdnEgress: ethers.parseUnits('0.05', 18),
              pricePerTiBCacheMissEgress: ethers.parseUnits('0.1', 18),
              tokenAddress: tokenAddress,
              epochsPerMonth: epochsPerMonth,
              minimumPricePerMonth: ethers.parseUnits('0.01', 18),
            }
            return warmInterface.encodeFunctionResult('getServicePrice', [servicePriceInfo])
          }
          return `0x${'0'.repeat(64)}`
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
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

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

      // Mock provider for chain verification
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async (txHash) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [
            {
              serviceProvider: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
              topics: [
                ethers.id('DataSetCreated(uint256,address)'),
                ethers.zeroPadValue('0x7b', 32),
                ethers.zeroPadValue(clientAddress, 32),
              ],
              data: '0x',
            },
          ],
        } as any
      }

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // isLive = true
        }
        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

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

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should handle PDP server failure gracefully', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer that throws error
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          throw new Error('Server unavailable')
        },
      }

      // Mock provider for chain verification (still works)
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [
            {
              serviceProvider: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
              topics: [
                ethers.id('DataSetCreated(uint256,address)'),
                ethers.zeroPadValue('0x7b', 32),
                ethers.zeroPadValue(clientAddress, 32),
              ],
              data: '0x',
            },
          ],
        } as any
      }

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

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

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should NOT mark as complete when server has not caught up yet', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer that returns null (server hasn't caught up)
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          throw new Error('Data set creation status not found')
        },
      }

      // Mock provider for chain verification (transaction succeeded on chain)
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [
            {
              serviceProvider: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
              topics: [
                ethers.id('DataSetCreated(uint256,address)'),
                ethers.zeroPadValue('0x7b', 32),
                ethers.zeroPadValue(clientAddress, 32),
              ],
              data: '0x',
            },
          ],
        } as any
      }

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // isLive = true
        }
        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

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

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should wait for data set to become live', async () => {
      const warmStorageService = await createWarmStorageService()
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

      // Mock provider
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
        if (callCount === 1) {
          return null // Not mined yet
        } else {
          return {
            status: 1,
            blockNumber: 12345,
            gasUsed: 100000n,
            logs: [
              {
                serviceProvider: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
                topics: [
                  ethers.id('DataSetCreated(uint256,address)'),
                  ethers.zeroPadValue('0x7b', 32),
                  ethers.zeroPadValue(clientAddress, 32),
                ],
                data: '0x',
              },
            ],
          } as any
        }
      }

      cleanup = mockProviderWithView((data) => {
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return null
      })

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => await mockProvider.getTransactionReceipt(mockTxHash),
      } as any
      const result = await warmStorageService.waitForDataSetCreationWithStatus(
        mockTransaction,
        mockPDPServer,
        5000, // 5 second timeout
        100 // 100ms poll interval
      )

      assert.isTrue(result.summary.isComplete)
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isTrue(callCount >= 2) // Should have polled at least twice

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should timeout if data set takes too long', async () => {
      const warmStorageService = await createWarmStorageService()
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

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

      // Mock provider - transaction never mines
      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

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

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })
  })

  describe('getMaxProvingPeriod() and getChallengeWindow()', () => {
    it('should return max proving period from WarmStorage contract', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock contract call
      const originalCall = mockProvider.call
      mockProvider.call = async ({ data }: any) => {
        // Check if it's the getMaxProvingPeriod call on WarmStorage
        if (typeof data === 'string' && data.includes('0x')) {
          // Return encoded uint64 value of 2880
          return '0x0000000000000000000000000000000000000000000000000000000000000b40'
        }
        return '0x'
      }

      const result = await warmStorageService.getMaxProvingPeriod()
      assert.equal(result, 2880)

      mockProvider.call = originalCall
    })

    it('should return challenge window from WarmStorage contract', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock contract call
      const originalCall = mockProvider.call
      mockProvider.call = async ({ data }: any) => {
        // Check if it's the challengeWindow call on WarmStorage
        if (typeof data === 'string' && data.includes('0x')) {
          // Return encoded uint256 value of 60
          return '0x000000000000000000000000000000000000000000000000000000000000003c'
        }
        return '0x'
      }

      const result = await warmStorageService.getChallengeWindow()
      assert.equal(result, 60)

      mockProvider.call = originalCall
    })

    it('should handle contract call failures', async () => {
      const warmStorageService = await createWarmStorageService()
      // Mock contract call to throw error
      const originalCall = mockProvider.call
      mockProvider.call = async () => {
        throw new Error('Contract call failed')
      }

      try {
        await warmStorageService.getMaxProvingPeriod()
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Contract call failed')
      }

      mockProvider.call = originalCall
    })
  })

  describe('CDN Operations', () => {
    it('should top up CDN payment rails (mock transaction)', async () => {
      const dataSetId = 49
      const warmStorageService = await createWarmStorageService()
      const mockSigner = {
        getAddress: async () => '0x1234567890123456789012345678901234567890',
      } as any

      // Mock the contract connection
      const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
      ;(warmStorageService as any)._getWarmStorageContract = () => ({
        connect: () => ({
          topUpCDNPaymentRails: async () => ({
            hash: '0xmocktxhash',
            wait: async () => ({ status: 1 }),
          }),
        }),
      })

      const tx = await warmStorageService.topUpCDNPaymentRails(mockSigner, dataSetId, 1n, 1n)
      assert.equal(tx.hash, '0xmocktxhash')

      ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
    })
  })
})
