/* globals describe it beforeEach */

/**
 * Tests for PDPVerifier class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPVerifier } from '../pdp/index.ts'
import { createMockProvider } from './test-utils.ts'

describe('PDPVerifier', () => {
  let mockProvider: ethers.Provider
  let pdpVerifier: PDPVerifier
  const testAddress = '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC'

  beforeEach(() => {
    mockProvider = createMockProvider()
    pdpVerifier = new PDPVerifier(mockProvider, testAddress)
  })

  describe('Instantiation', () => {
    it('should create instance and connect provider', () => {
      assert.exists(pdpVerifier)
      assert.isFunction(pdpVerifier.dataSetLive)
      assert.isFunction(pdpVerifier.getNextPieceId)
    })

    it('should create instance with custom address', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const customVerifier = new PDPVerifier(mockProvider, customAddress)
      assert.exists(customVerifier)
      assert.isFunction(customVerifier.dataSetLive)
      assert.isFunction(customVerifier.getNextPieceId)
    })
  })

  describe('dataSetLive', () => {
    it('should check if data set is live', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xca759f27') === true) {
          // dataSetLive selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }
        return `0x${'0'.repeat(64)}`
      }

      const isLive = await pdpVerifier.dataSetLive(123)
      assert.isTrue(isLive)
    })
  })

  describe('getNextPieceId', () => {
    it('should get next piece ID', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x1c5ae80f') === true) {
          // getNextPieceId selector
          return ethers.zeroPadValue('0x05', 32) // Return 5
        }
        return `0x${'0'.repeat(64)}`
      }

      const nextPieceId = await pdpVerifier.getNextPieceId(123)
      assert.equal(nextPieceId, 5)
    })
  })

  describe('getDataSetListener', () => {
    it('should get data set listener', async () => {
      const listenerAddress = '0x1234567890123456789012345678901234567890'
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x2b3129bb') === true) {
          // getDataSetListener selector
          return ethers.zeroPadValue(listenerAddress, 32)
        }
        return `0x${'0'.repeat(64)}`
      }

      const listener = await pdpVerifier.getDataSetListener(123)
      assert.equal(listener.toLowerCase(), listenerAddress.toLowerCase())
    })
  })

  describe('getDataSetStorageProvider', () => {
    it('should get data set storage provider', async () => {
      const storageProvider = '0x1234567890123456789012345678901234567890'
      const proposedStorageProvider = '0xabcdef1234567890123456789012345678901234'

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x21b7cd1c') === true) {
          // getDataSetStorageProvider selector
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address'],
            [storageProvider, proposedStorageProvider]
          )
        }
        return `0x${'0'.repeat(64)}`
      }

      const result = await pdpVerifier.getDataSetStorageProvider(123)
      assert.equal(result.storageProvider.toLowerCase(), storageProvider.toLowerCase())
      assert.equal(result.proposedStorageProvider.toLowerCase(), proposedStorageProvider.toLowerCase())
    })
  })

  describe('getDataSetLeafCount', () => {
    it('should get data set leaf count', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xa531998c') === true) {
          // getDataSetLeafCount selector
          return ethers.zeroPadValue('0x0a', 32) // Return 10
        }
        return `0x${'0'.repeat(64)}`
      }

      const leafCount = await pdpVerifier.getDataSetLeafCount(123)
      assert.equal(leafCount, 10)
    })
  })

  describe('extractDataSetIdFromReceipt', () => {
    it('should extract data set ID from receipt', () => {
      const mockReceipt = {
        logs: [
          {
            topics: [
              '0x1234567890123456789012345678901234567890123456789012345678901234', // Event signature
              ethers.zeroPadValue('0x7b', 32), // Data set ID = 123
            ],
            data: `0x${'0'.repeat(64)}`,
          },
        ],
      } as any

      // Mock the interface to parse logs
      ;(pdpVerifier as any)._contract.interface.parseLog = (log: any) => {
        if (log.topics[0] === '0x1234567890123456789012345678901234567890123456789012345678901234') {
          return {
            name: 'DataSetCreated',
            args: {
              setId: BigInt(123),
            },
            fragment: {} as any,
            signature: 'DataSetCreated(uint256)',
            topic: log.topics[0],
          } as any
        }
        return null
      }

      const dataSetId = pdpVerifier.extractDataSetIdFromReceipt(mockReceipt)
      assert.equal(dataSetId, 123)
    })

    it('should return null if no DataSetCreated event found', () => {
      const mockReceipt = {
        logs: [],
      } as any

      const dataSetId = pdpVerifier.extractDataSetIdFromReceipt(mockReceipt)
      assert.isNull(dataSetId)
    })
  })

  describe('getContractAddress', () => {
    it('should return the contract address', () => {
      const address = pdpVerifier.getContractAddress()
      assert.equal(address, testAddress)
    })
  })
})
