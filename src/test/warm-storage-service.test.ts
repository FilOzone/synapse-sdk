/* globals describe it beforeEach */

/**
 * Tests for WarmStorageService class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { WarmStorageService } from '../warm-storage/index.js'
import { createMockProvider } from './test-utils.js'
import { TIME_CONSTANTS } from '../utils/constants.js'

describe('WarmStorageService', () => {
  let mockProvider: ethers.Provider
  let warmStorageService: WarmStorageService
  const mockWarmStorageAddress = '0xEB022abbaa66D9F459F3EC2FeCF81a6D03c2Cb6F'
  const clientAddress = '0x1234567890123456789012345678901234567890'

  beforeEach(() => {
    mockProvider = createMockProvider()
    const mockPdpVerifierAddress = '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC'
    warmStorageService = new WarmStorageService(mockProvider, mockWarmStorageAddress, mockPdpVerifierAddress)
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', () => {
      assert.exists(warmStorageService)
      assert.isFunction(warmStorageService.getClientDataSets)
    })
  })

  describe('getClientDataSets', () => {
    it('should return empty array when client has no data sets', async () => {
      // Mock provider will return empty array by default
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x967c6f21') === true) {
          // Return empty array
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[]]
          )
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      const dataSets = await warmStorageService.getClientDataSets(clientAddress)
      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 0)
    })

    it('should return data sets for a client', async () => {
      // Mock provider to return data sets
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x967c6f21') === true) {
          // Return two data sets
          const dataSet1 = {
            pdpRailId: 123n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0xabcdef1234567890123456789012345678901234',
            commissionBps: 100n, // 1%
            metadata: 'Test metadata 1',
            pieceMetadata: ['piece1', 'piece2'],
            clientDataSetId: 0n,
            withCDN: false,
            paymentEndEpoch: 0n
          }

          const dataSet2 = {
            pdpRailId: 456n,
            cacheMissRailId: 0n,
            cdnRailId: 0n,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0x9876543210987654321098765432109876543210',
            commissionBps: 200n, // 2%
            metadata: 'Test metadata 2',
            pieceMetadata: ['piece3'],
            clientDataSetId: 1n,
            withCDN: true,
            paymentEndEpoch: 0n
          }

          // Create properly ordered arrays for encoding
          const dataSets = [
            [
              dataSet1.pdpRailId,
              dataSet1.cacheMissRailId,
              dataSet1.cdnRailId,
              dataSet1.payer,
              dataSet1.payee,
              dataSet1.commissionBps,
              dataSet1.metadata,
              dataSet1.pieceMetadata,
              dataSet1.clientDataSetId,
              dataSet1.withCDN,
              dataSet1.paymentEndEpoch
            ],
            [
              dataSet2.pdpRailId,
              dataSet2.cacheMissRailId,
              dataSet2.cdnRailId,
              dataSet2.payer,
              dataSet2.payee,
              dataSet2.commissionBps,
              dataSet2.metadata,
              dataSet2.pieceMetadata,
              dataSet2.clientDataSetId,
              dataSet2.withCDN,
              dataSet2.paymentEndEpoch
            ]
          ]

          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [dataSets]
          )
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      const dataSets = await warmStorageService.getClientDataSets(clientAddress)

      assert.isArray(dataSets)
      assert.lengthOf(dataSets, 2)

      // Check first data set
      assert.equal(dataSets[0].railId, 123)
      assert.equal(dataSets[0].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(dataSets[0].payee.toLowerCase(), '0xabcdef1234567890123456789012345678901234'.toLowerCase())
      assert.equal(dataSets[0].commissionBps, 100)
      assert.equal(dataSets[0].metadata, 'Test metadata 1')
      assert.equal(dataSets[0].pieceMetadata.length, 2)
      assert.equal(dataSets[0].clientDataSetId, 0)
      assert.equal(dataSets[0].withCDN, false)

      // Check second data set
      assert.equal(dataSets[1].railId, 456)
      assert.equal(dataSets[1].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(dataSets[1].payee.toLowerCase(), '0x9876543210987654321098765432109876543210'.toLowerCase())
      assert.equal(dataSets[1].commissionBps, 200)
      assert.equal(dataSets[1].metadata, 'Test metadata 2')
      assert.equal(dataSets[1].pieceMetadata.length, 1)
      assert.equal(dataSets[1].clientDataSetId, 1)
      assert.equal(dataSets[1].withCDN, true)
    })

    it('should handle contract call errors gracefully', async () => {
      // Mock provider to throw error
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x967c6f21') === true) {
          throw new Error('Contract call failed')
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

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
      // Mock provider for multiple contract calls
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientDataSets call
        if (data?.startsWith('0x967c6f21') === true) {
          const dataSet = [
            48n, // pdpRailId
            0n, // cacheMissRailId
            0n, // cdnRailId
            clientAddress, // payer
            '0xabcdef1234567890123456789012345678901234', // payee
            100n, // commissionBps
            'Test', // metadata
            [], // pieceMetadata
            0n, // clientDataSetId
            false, // withCDN
            0n // paymentEndEpoch
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[dataSet]]
          )
        }

        // railToDataSet call
        if (data?.startsWith('0x2ad6e6b5') === true) { // railToDataSet(uint256) selector
          return ethers.zeroPadValue('0xf2', 32) // Return data set ID 242
        }

        // dataSetId call
        if (data?.startsWith('0xca759f27') === true) { // dataSetId(uint256) selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }

        // getNextPieceId call
        if (data?.startsWith('0x1c5ae80f') === true) { // getNextPieceId(uint256) selector
          return ethers.zeroPadValue('0x02', 32) // Return 2
        }

        // getDataSetListener call
        if (data?.startsWith('0x2b3129bb') === true) { // getDataSetListener(uint256) selector
          return ethers.zeroPadValue(mockWarmStorageAddress, 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      // Mock network for PDPVerifier address
      const originalGetNetwork = mockProvider.getNetwork
      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const detailedDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)

      assert.lengthOf(detailedDataSets, 1)
      assert.equal(detailedDataSets[0].railId, 48)
      assert.equal(detailedDataSets[0].pdpVerifierDataSetId, 242)
      assert.equal(detailedDataSets[0].nextPieceId, 0)
      assert.equal(detailedDataSets[0].currentPieceCount, 0)
      assert.isTrue(detailedDataSets[0].isLive)
      assert.isTrue(detailedDataSets[0].isManaged)

      mockProvider.getNetwork = originalGetNetwork
    })

    it('should filter unmanaged data sets when onlyManaged is true', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientDataSets - return 2 data sets
        if (data?.startsWith('0x967c6f21') === true) {
          const dataSets = [
            [48n, 0n, 0n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test1', [], 0n, false, 0n],
            [49n, 0n, 0n, clientAddress, '0xdef1234567890123456789012345678901234567', 100n, 'Test2', [], 1n, false, 0n]
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [dataSets]
          )
        }

        // railToDataSet - both return valid IDs
        if (data?.startsWith('0x2ad6e6b5') === true) {
          // Extract the rail ID from the encoded data
          const railIdHex = data.slice(10, 74) // Skip function selector and get 32 bytes
          if (railIdHex === ethers.zeroPadValue('0x30', 32).slice(2)) { // rail ID 48
            return ethers.zeroPadValue('0xf2', 32) // 242
          } else if (railIdHex === ethers.zeroPadValue('0x31', 32).slice(2)) { // rail ID 49
            return ethers.zeroPadValue('0xf3', 32) // 243
          }
          return ethers.zeroPadValue('0x00', 32) // 0
        }

        // dataSetId - both are live
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getDataSetListener - first is managed, second is not
        if (data?.startsWith('0x2b3129bb') === true) {
          // Extract the data set ID from the encoded data
          const dataSetIdHex = data.slice(10, 74) // Skip function selector and get 32 bytes
          if (dataSetIdHex === ethers.zeroPadValue('0xf2', 32).slice(2)) { // data set 242
            return ethers.zeroPadValue(mockWarmStorageAddress, 32) // Managed by us
          } else if (dataSetIdHex === ethers.zeroPadValue('0xf3', 32).slice(2)) { // data set 243
            return ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32) // Different address
          }
          return ethers.zeroPadValue('0x0000000000000000000000000000000000000000', 32)
        }

        // getNextPieceId
        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      // Get all data sets
      const allDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress, false)
      assert.lengthOf(allDataSets, 2)

      // Get only managed data sets
      const managedDataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress, true)
      assert.lengthOf(managedDataSets, 1)
      assert.equal(managedDataSets[0].railId, 48)
      assert.isTrue(managedDataSets[0].isManaged)
    })

    it('should throw error when contract calls fail', async () => {
      // Mock getClientDataSets to return a data set
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientDataSets - return 1 data set
        if (data?.startsWith('0x967c6f21') === true) {
          const dataSet = [48n, 0n, 0n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test1', [], 0n, false, 0n]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[dataSet]]
          )
        }

        // railToDataSet - throw error
        if (data?.startsWith('0x2ad6e6b5') === true) {
          throw new Error('Contract call failed')
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await warmStorageService.getClientDataSetsWithDetails(clientAddress)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get details for data set with enhanced info')
        assert.include(error.message, 'Contract call failed')
      }
    })
  })

  describe('getManagedDataSets', () => {
    it('should return only managed data sets', async () => {
      // Set up mocks similar to above
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        if (data?.startsWith('0x967c6f21') === true) {
          const dataSet = [48n, 0n, 0n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test', [], 0n, false, 0n]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[dataSet]]
          )
        }

        if (data?.startsWith('0x2ad6e6b5') === true) {
          return ethers.zeroPadValue('0xf2', 32)
        }

        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        if (data?.startsWith('0x2b3129bb') === true) {
          return ethers.zeroPadValue(mockWarmStorageAddress, 32)
        }

        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const dataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)
      const managedDataSets = dataSets.filter(ps => ps.isManaged)
      assert.lengthOf(managedDataSets, 1)
      assert.isTrue(managedDataSets[0].isManaged)
    })
  })

  describe('getAddPiecesInfo', () => {
    it('should return correct add pieces information', async () => {
      const dataSetId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // railToDataSet - maps rail ID to data set ID
        if (data?.includes('railToDataSet') === true || data?.startsWith('0x2ad6e6b5') === true) {
          // Rail ID 48 maps to data set ID 48
          return ethers.zeroPadValue('0x30', 32) // 48 in hex
        }

        // dataSetId
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }

        // getNextPieceId
        if (data?.startsWith('0x1c5ae80f') === true) {
          return ethers.zeroPadValue('0x05', 32) // 5
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
            100n, // commissionBps
            'Metadata', // metadata
            [], // pieceMetadata
            3n, // clientDataSetId
            false, // withCDN
            0n // paymentEndEpoch
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[dataSet]]
          )
        }

        // getDataSet
        if (data?.startsWith('0xbdaac056') === true) {
          const info = [
            48n, // pdpRailId
            clientAddress,
            '0xabc1234567890123456789012345678901234567',
            100n,
            'Metadata',
            [],
            3n, // clientDataSetId
            false
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)'],
            [info]
          )
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const addPiecesInfo = await warmStorageService.getAddPiecesInfo(dataSetId, '0x1234567890123456789012345678901234567890')
      assert.equal(addPiecesInfo.nextPieceId, 5)
      assert.equal(addPiecesInfo.clientDataSetId, 0) // This is the index in the client's list
      assert.equal(addPiecesInfo.currentPieceCount, 0) // Empty pieceMetadata array
    })

    it('should throw error if data set is not managed by this WarmStorage', async () => {
      const dataSetId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

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
            100n, // commissionBps
            'Metadata', // metadata
            [], // pieceMetadata
            3n, // clientDataSetId
            false, // withCDN
            0n // paymentEndEpoch
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)[]'],
            [[dataSet]]
          )
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

        // getDataSet - needed for getAddPiecesInfo
        if (data?.startsWith('0xbdaac056') === true) {
          const info = [
            48, // railId
            clientAddress,
            '0xabc1234567890123456789012345678901234567',
            100n,
            'Metadata',
            [],
            3n, // clientDataSetId
            false
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,uint256,address,address,uint256,string,string[],uint256,bool,uint256)'],
            [info]
          )
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await warmStorageService.getAddPiecesInfo(dataSetId, '0x1234567890123456789012345678901234567890')
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 48 not found for client')
      }
    })
  })

  describe('getNextClientDataSetId', () => {
    it('should return the next client dataset ID', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // clientDataSetIDs mapping call
        if (data?.startsWith('0x196ed89b') === true) {
          return ethers.zeroPadValue('0x05', 32) // Return 5
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      const nextId = await warmStorageService.getNextClientDataSetId(clientAddress)
      assert.equal(nextId, 5)
    })
  })

  describe('verifyDataSetCreation', () => {
    it('should verify successful data set creation', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Mock getTransaction
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash)
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
          logs: [{
            address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
            topics: [
              ethers.id('DataSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32), // data set ID 123
              ethers.zeroPadValue(clientAddress, 32) // owner address
            ],
            data: '0x' // Empty data for indexed parameters
          }]
        } as any
      }

      // Mock dataSetId check
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isTrue(result.isConfirmed)
      assert.isTrue(result.isSuccessful)
      assert.equal(result.dataSetId, 123)
      assert.exists(result.dataSetId)
      // blockNumber is not directly available in this interface

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should handle transaction not mined yet', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => null
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null

      const result = await warmStorageService.verifyDataSetCreation(mockTxHash)

      assert.isFalse(result.isConfirmed)
      assert.isNull(result.isSuccessful)
      assert.isNull(result.dataSetId)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })
  })

  describe('Storage Provider Operations', () => {
    it('should check if provider is approved', async () => {
      const providerAddress = '0x1234567890123456789012345678901234567890'

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xbd0efaab') === true) { // isProviderApproved selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }
        return '0x' + '0'.repeat(64)
      }

      const isApproved = await warmStorageService.isProviderApproved(providerAddress)
      assert.isTrue(isApproved)
    })

    it('should get provider ID by address', async () => {
      const providerAddress = '0x1234567890123456789012345678901234567890'

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x93ecb91e') === true) { // getProviderIdByAddress selector
          return ethers.zeroPadValue('0x05', 32) // Return ID 5
        }
        return '0x' + '0'.repeat(64)
      }

      const providerId = await warmStorageService.getProviderIdByAddress(providerAddress)
      assert.equal(providerId, 5)
    })

    it('should get approved provider info', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x1c7db86a') === true) { // getApprovedProvider selector
          const providerInfo = [
            '0x1234567890123456789012345678901234567890', // storageProvider
            'https://pdp.provider.com', // serviceURL
            ethers.hexlify(ethers.toUtf8Bytes('test-peer-id')), // peerId
            1234567890n, // registeredAt
            1234567900n // approvedAt
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)'],
            [providerInfo]
          )
        }
        return '0x' + '0'.repeat(64)
      }

      const info = await warmStorageService.getApprovedProvider(1)
      assert.equal(info.storageProvider.toLowerCase(), '0x1234567890123456789012345678901234567890')
      assert.equal(info.serviceURL, 'https://pdp.provider.com')
      assert.equal(info.peerId, 'test-peer-id')
      assert.equal(info.registeredAt, 1234567890)
      assert.equal(info.approvedAt, 1234567900)
    })

    it('should get pending provider info', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x3faef523') === true) { // pendingProviders(address) selector
          // The ABI returns (string serviceURL, bytes peerId, uint256 registeredAt) not a tuple
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['string', 'bytes', 'uint256'],
            ['https://pdp.pending.com', ethers.toUtf8Bytes('test-peer-id'), 1234567880n]
          )
        }
        // Return empty struct for any other call including pendingProviders
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['string', 'bytes', 'uint256'],
          ['', '0x', 0n]
        )
      }

      const info = await warmStorageService.getPendingProvider('0xabcdef1234567890123456789012345678901234')
      assert.equal(info.serviceURL, 'https://pdp.pending.com')
      assert.equal(info.peerId, 'test-peer-id') // Now available as bytes decoded to string
      assert.equal(info.registeredAt, 1234567880)
    })

    it('should get next provider ID', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x9b0274da') === true) { // nextServiceProviderId selector
          return ethers.zeroPadValue('0x0a', 32) // Return 10
        }
        return '0x' + '0'.repeat(64)
      }

      const nextId = await warmStorageService.getNextProviderId()
      assert.equal(nextId, 10)
    })

    it('should get owner address', async () => {
      const ownerAddress = '0xabcdef1234567890123456789012345678901234'

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x8da5cb5b') === true) { // owner selector
          return ethers.zeroPadValue(ownerAddress, 32)
        }
        return '0x' + '0'.repeat(64)
      }

      const owner = await warmStorageService.getOwner()
      assert.equal(owner.toLowerCase(), ownerAddress.toLowerCase())
    })

    it('should check if signer is owner', async () => {
      const signerAddress = '0x1234567890123456789012345678901234567890'
      const mockSigner = {
        getAddress: async () => signerAddress
      } as any

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x8da5cb5b') === true) { // owner selector
          return ethers.zeroPadValue(signerAddress, 32)
        }
        return '0x' + '0'.repeat(64)
      }

      const isOwner = await warmStorageService.isOwner(mockSigner)
      assert.isTrue(isOwner)
    })

    it('should get all approved providers', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getAllApprovedProviders
        if (data?.startsWith('0x0af14754') === true) {
          const provider1 = [
            '0x1111111111111111111111111111111111111111',
            'https://pdp1.com',
            'https://retrieval1.com',
            1111111111n,
            1111111112n
          ]
          const provider2 = [
            '0x2222222222222222222222222222222222222222',
            'https://pdp2.com',
            'https://retrieval2.com',
            2222222222n,
            2222222223n
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,string,uint256,uint256)[]'],
            [[provider1, provider2]]
          )
        }

        return '0x' + '0'.repeat(64)
      }

      const providers = await warmStorageService.getAllApprovedProviders()
      assert.lengthOf(providers, 2)
      assert.equal(providers[0].storageProvider.toLowerCase(), '0x1111111111111111111111111111111111111111')
      assert.equal(providers[1].storageProvider.toLowerCase(), '0x2222222222222222222222222222222222222222')
    })

    describe('addServiceProvider', () => {
      it('should add a service provider directly', async () => {
        const providerAddress = '0x1234567890123456789012345678901234567890'
        const pdpUrl = 'https://pdp.example.com'
        const pieceRetrievalUrl = 'https://retrieval.example.com'

        // Create a mock signer
        const mockSigner = {
          getAddress: async () => '0xabcdef1234567890123456789012345678901234', // owner address
          provider: mockProvider
        } as any

        // Mock the contract connection and transaction
        let addServiceProviderCalled = false
        const mockContract = {
          connect: (signer: any) => ({
            addServiceProvider: async (addr: string, pdp: string, retrieval: string) => {
              assert.equal(addr, providerAddress)
              assert.equal(pdp, pdpUrl)
              assert.equal(retrieval, pieceRetrievalUrl)
              addServiceProviderCalled = true
              return {
                hash: '0xmocktxhash',
                wait: async () => ({ status: 1 })
              }
            }
          })
        }

        // Override _getWarmStorageContract to return our mock
        const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
        ;(warmStorageService as any)._getWarmStorageContract = () => mockContract

        const tx = await (warmStorageService as any).addServiceProvider(
          mockSigner,
          providerAddress,
          pdpUrl,
          pieceRetrievalUrl
        )

        assert.isTrue(addServiceProviderCalled)
        assert.equal(tx.hash, '0xmocktxhash')

        // Restore original method
        ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
      })

      it('should handle errors when adding service provider', async () => {
        const providerAddress = '0x1234567890123456789012345678901234567890'
        const pdpUrl = 'https://pdp.example.com'
        const pieceRetrievalUrl = 'https://retrieval.example.com'

        // Create a mock signer
        const mockSigner = {
          getAddress: async () => '0xabcdef1234567890123456789012345678901234',
          provider: mockProvider
        } as any

        // Mock the contract to throw an error
        const mockContract = {
          connect: () => ({
            addServiceProvider: async () => {
              throw new Error('Provider already approved')
            }
          })
        }

        // Override _getWarmStorageContract to return our mock
        const originalGetWarmStorageContract = (warmStorageService as any)._getWarmStorageContract
        ;(warmStorageService as any)._getWarmStorageContract = () => mockContract

        try {
          await (warmStorageService as any).addServiceProvider(
            mockSigner,
            providerAddress,
            pdpUrl,
            pieceRetrievalUrl
          )
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'Provider already approved')
        }

        // Restore original method
        ;(warmStorageService as any)._getWarmStorageContract = originalGetWarmStorageContract
      })
    })
  })

  describe('Storage Cost Operations', () => {
    describe('calculateStorageCost', () => {
      it('should calculate storage costs correctly for 1 GiB', async () => {
        // Mock the getServicePrice call on WarmStorage contract
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) { // getServicePrice selector
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            // Encode as a tuple (struct)
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const sizeInBytes = 1024 * 1024 * 1024 // 1 GiB
        const costs = await warmStorageService.calculateStorageCost(sizeInBytes)

        assert.exists(costs.perEpoch)
        assert.exists(costs.perDay)
        assert.exists(costs.perMonth)
        assert.exists(costs.withCDN)

        // Verify costs are reasonable
        assert.isTrue(costs.perEpoch > 0n)
        assert.isTrue(costs.perDay > costs.perEpoch)
        assert.isTrue(costs.perMonth > costs.perDay)

        // Get CDN costs to compare
        const cdnCosts = await warmStorageService.calculateStorageCost(sizeInBytes, true)

        // CDN costs should be higher
        assert.isTrue(cdnCosts.perEpoch > costs.perEpoch)
        assert.isTrue(cdnCosts.perDay > costs.perDay)
        assert.isTrue(cdnCosts.perMonth > costs.perMonth)

        // Verify CDN is 1.5x base rate (3 USDFC vs 2 USDFC per TiB/month)
        assert.equal((cdnCosts.perEpoch * 2n) / costs.perEpoch, 3n)
      })

      it('should scale costs linearly with size', async () => {
        // Mock the getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const costs1GiB = await warmStorageService.calculateStorageCost(1024 * 1024 * 1024)
        const costs10GiB = await warmStorageService.calculateStorageCost(10 * 1024 * 1024 * 1024)

        // 10 GiB should cost approximately 10x more than 1 GiB
        // Allow for small rounding differences in bigint division
        const ratio = Number(costs10GiB.perEpoch) / Number(costs1GiB.perEpoch)
        assert.closeTo(ratio, 10, 0.01)

        // Verify the relationship holds for day and month calculations
        assert.equal(costs10GiB.perDay.toString(), (costs10GiB.perEpoch * 2880n).toString())
        // For month calculation, allow for rounding errors due to integer division
        const expectedMonth = costs10GiB.perEpoch * 86400n
        const monthRatio = Number(costs10GiB.perMonth) / Number(expectedMonth)
        assert.closeTo(monthRatio, 1, 0.0001) // Allow 0.01% difference due to rounding
      })

      it('should fetch pricing from WarmStorage contract', async () => {
        // This test verifies that the getServicePrice function is called
        let getServicePriceCalled = false
        const originalCall = mockProvider.call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            getServicePriceCalled = true
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            // Encode as a tuple (struct)
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return await originalCall.call(mockProvider, transaction)
        }

        await warmStorageService.calculateStorageCost(1024 * 1024 * 1024)
        assert.isTrue(getServicePriceCalled, 'Should have called getServicePrice on WarmStorage contract')
      })
    })

    describe('checkAllowanceForStorage', () => {
      it('should check allowances for storage operations', async () => {
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
          },
          walletBalance: async () => ethers.parseUnits('1000', 18)
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          10 * 1024 * 1024 * 1024, // 10 GiB
          false,
          mockPaymentsService
        )

        assert.exists(check.rateAllowanceNeeded)
        assert.exists(check.lockupAllowanceNeeded)
        assert.exists(check.currentAllowances.rateAllowance)
        assert.exists(check.currentAllowances.lockupAllowance)
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
        // message property no longer exists in interface
      })

      it('should return sufficient when allowances are adequate', async () => {
        // Create a mock PaymentsService with adequate allowances
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: true,
              rateAllowance: ethers.parseUnits('100', 18),
              lockupAllowance: ethers.parseUnits('10000', 18),
              rateUsed: 0n,
              lockupUsed: 0n
            }
          },
          walletBalance: async () => ethers.parseUnits('1000', 18)
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          1024 * 1024, // 1 MiB - small amount
          false,
          mockPaymentsService
        )

        assert.isTrue(check.sufficient)
        // message property no longer exists in interface

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
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
          },
          walletBalance: async () => ethers.parseUnits('1000', 18)
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const check = await warmStorageService.checkAllowanceForStorage(
          1024 * 1024 * 1024, // 1 GiB
          false,
          mockPaymentsService
        )

        // Verify lockupAllowanceNeeded and depositAmountNeeded are present and reasonable
        assert.exists(check.lockupAllowanceNeeded)
        assert.isTrue(check.lockupAllowanceNeeded > 0n)
        assert.exists(check.depositAmountNeeded)
        assert.isTrue(check.depositAmountNeeded > 0n)

        // depositAmountNeeded should equal 10 days of costs (default lockup)
        const expectedDeposit = check.costs.perEpoch * BigInt(10) * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())
      })

      it('should use custom lockup days when provided', async () => {
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
          },
          walletBalance: async () => ethers.parseUnits('1000', 18)
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        // Test with custom lockup period of 20 days
        const customLockupDays = 20
        const check = await warmStorageService.checkAllowanceForStorage(
          1024 * 1024 * 1024, // 1 GiB
          false,
          mockPaymentsService,
          customLockupDays
        )

        // Verify depositAmountNeeded uses custom lockup period
        const expectedDeposit = check.costs.perEpoch * BigInt(customLockupDays) * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())

        // Compare with default (10 days) to ensure they're different
        const defaultCheck = await warmStorageService.checkAllowanceForStorage(
          1024 * 1024 * 1024, // 1 GiB
          false,
          mockPaymentsService
        )

        // Custom should be exactly 2x default (20 days vs 10 days)
        assert.equal(check.depositAmountNeeded.toString(), (defaultCheck.depositAmountNeeded * 2n).toString())
      })
    })

    describe('prepareStorageUpload', () => {
      it('should prepare storage upload with required actions', async () => {
        let approveServiceCalled = false

        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: false,
            rateAllowance: 0n,
            lockupAllowance: 0n,
            rateUsed: 0n,
            lockupUsed: 0n
          }),
          accountInfo: async () => ({
            funds: ethers.parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('10000', 18)
          }),
          walletBalance: async () => ethers.parseUnits('1000', 18), // Simulate low wallet balance to test deposit action
          approveService: async (serviceAddress: string, rateAllowance: bigint, lockupAllowance: bigint) => {
            assert.strictEqual(serviceAddress, mockWarmStorageAddress)
            assert.isTrue(rateAllowance > 0n)
            assert.isTrue(lockupAllowance > 0n)
            approveServiceCalled = true
            return '0xmocktxhash'
          }
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const prep = await warmStorageService.prepareStorageUpload({
          sizeBytes: 10 * 1024 * 1024 * 1024, // 10 GiB
          withCDN: false,
          paymentsService: mockPaymentsService
        })

        assert.exists(prep.costs)
        assert.exists(prep.allowanceCheck)
        assert.isArray(prep.requiredSteps)

        // Should have at least approval action (since mock has no allowances)
        assert.isAtLeast(prep.requiredSteps.length, 1)

        const approvalAction = prep.requiredSteps.find(a => a.step === 'approveService')
        assert.exists(approvalAction)
        assert.include(approvalAction.description, 'Approve service')
        assert.isFunction(approvalAction.execute)

        // Execute the action and verify it was called
        await approvalAction.execute()
        assert.isTrue(approveServiceCalled)
      })

      it('should include deposit action when balance insufficient', async () => {
        let depositCalled = false

        // Create a mock PaymentsService with low balance
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: false,
            rateAllowance: 0n,
            lockupAllowance: 0n,
            rateUsed: 0n,
            lockupUsed: 0n
          }),
          walletBalance: async () => ethers.parseUnits('0.001', 18), // Very low balance
          accountInfo: async () => ({
            funds: ethers.parseUnits('0.001', 18), // Very low balance
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('0.001', 18)
          }),
          deposit: async (amount: bigint) => {
            assert.isTrue(amount > 0n)
            depositCalled = true
            return '0xmockdeposittxhash'
          },
          approveService: async () => '0xmocktxhash'
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const prep = await warmStorageService.prepareStorageUpload({
          sizeBytes: 10 * 1024 * 1024 * 1024, // 10 GiB
          withCDN: false,
          paymentsService: mockPaymentsService
        })

        // Should have both deposit and approval actions
        assert.isAtLeast(prep.requiredSteps.length, 2)

        const depositAction = prep.requiredSteps.find(a => a.step === 'deposit')
        assert.exists(depositAction)
        assert.include(depositAction.description, 'Deposit')
        assert.include(depositAction.description, 'USDFC')

        const approvalAction = prep.requiredSteps.find(a => a.step === 'approveService')
        assert.exists(approvalAction)

        // Execute deposit action and verify
        await depositAction.execute()
        assert.isTrue(depositCalled)
      })

      it('should return no actions when everything is ready', async () => {
        // Create a mock PaymentsService with sufficient balance and allowances
        const mockPaymentsService: any = {
          serviceApproval: async () => ({
            isApproved: true,
            rateAllowance: ethers.parseUnits('1000', 18),
            lockupAllowance: ethers.parseUnits('100000', 18),
            rateUsed: 0n,
            lockupUsed: 0n
          }),
          walletBalance: async () => ethers.parseUnits('10000', 18),
          accountInfo: async () => ({
            funds: ethers.parseUnits('10000', 18),
            lockupCurrent: 0n,
            lockupRate: 0n,
            lockupLastSettledAt: 1000000,
            availableFunds: ethers.parseUnits('10000', 18)
          })
        }

        // Mock getServicePrice call
        mockProvider.call = async (transaction: any) => {
          const data = transaction.data
          if (data?.startsWith('0x5482bdf9') === true) {
            const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
            const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
            const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
            const epochsPerMonth = 86400n
            return ethers.AbiCoder.defaultAbiCoder().encode(
              ['tuple(uint256,uint256,address,uint256)'],
              [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
            )
          }
          return '0x' + '0'.repeat(64)
        }

        const prep = await warmStorageService.prepareStorageUpload({
          sizeBytes: 1024 * 1024, // 1 MiB - small amount
          withCDN: false,
          paymentsService: mockPaymentsService
        })

        assert.lengthOf(prep.requiredSteps, 0)
        assert.isTrue(prep.allowanceCheck.sufficient)
      })
    })
  })

  describe('Comprehensive Status Methods', () => {
    it('should combine PDP server and chain verification status', async () => {
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
            dataSetId: 123
          }
        }
      }

      // Mock provider for chain verification
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash)
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async (txHash) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [{
            address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
            topics: [
              ethers.id('DataSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32),
              ethers.zeroPadValue(clientAddress, 32)
            ],
            data: '0x'
          }]
        } as any
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32) // isLive = true
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await warmStorageService.getComprehensiveDataSetStatus(mockTxHash, mockPDPServer)

      // Transaction hash was passed to method, doesn't need to be in result
      assert.exists(result.server)
      assert.exists(result.chain)

      // Verify server status - using correct interface properties
      assert.isTrue(result.server?.dataSetCreated)
      assert.isTrue(result.server?.ok)
      assert.strictEqual(result.server?.dataSetId, 123)

      // Verify chain status - using correct interface properties
      assert.isTrue(result.chain.isConfirmed)
      assert.isTrue(result.chain.isSuccessful)
      assert.exists(result.chain.dataSetId)
      assert.strictEqual(result.chain.dataSetId, 123)

      // Verify summary
      assert.isTrue(result.summary.isComplete)
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isNull(result.summary.error)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
    })

    it('should handle PDP server failure gracefully', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer that throws error
      const mockPDPServer: any = {
        getDataSetCreationStatus: async () => {
          throw new Error('Server unavailable')
        }
      }

      // Mock provider for chain verification (still works)
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash)
        } as any
      }

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [{
            address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
            topics: [
              ethers.id('DataSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32),
              ethers.zeroPadValue(clientAddress, 32)
            ],
            data: '0x'
          }]
        } as any
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await warmStorageService.getComprehensiveDataSetStatus(mockTxHash, mockPDPServer)

      // Server status should be null due to error
      assert.isNull(result.server)

      // Chain status should still work
      assert.isTrue(result.chain.isConfirmed)
      assert.isTrue(result.chain.isSuccessful)
      assert.strictEqual(result.chain.dataSetId, 123)

      // Summary should still work based on chain data
      assert.isTrue(result.summary.isComplete)
      assert.strictEqual(result.summary.dataSetId, 123)
      assert.isNull(result.summary.error)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
      mockProvider.getTransaction = originalGetTransaction
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
              dataSetId: undefined
            }
          } else {
            // Second call - created
            return {
              createMessageHash: mockTxHash,
              dataSetCreated: true,
              service: 'test-service',
              txStatus: 'confirmed',
              ok: true,
              dataSetId: 123
            }
          }
        }
      }

      // Mock provider
      const originalGetTransaction = mockProvider.getTransaction
      mockProvider.getTransaction = async (txHash: string) => {
        assert.strictEqual(txHash, mockTxHash)
        return {
          hash: mockTxHash,
          wait: async () => await mockProvider.getTransactionReceipt(mockTxHash)
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
            logs: [{
              address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
              topics: [
                ethers.id('DataSetCreated(uint256,address)'),
                ethers.zeroPadValue('0x7b', 32),
                ethers.zeroPadValue(clientAddress, 32)
              ],
              data: '0x'
            }]
          } as any
        }
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xca759f27') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const mockTransaction = {
        hash: mockTxHash,
        wait: async () => await mockProvider.getTransactionReceipt(mockTxHash)
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
            dataSetId: undefined
          }
        }
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
})
