/* globals describe it beforeEach */

/**
 * Tests for PDPVerifier class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPVerifier } from '../pdp/index.js'
import { createMockProvider } from './test-utils.js'

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
      assert.isFunction(pdpVerifier.proofSetLive)
      assert.isFunction(pdpVerifier.getNextRootId)
    })

    it('should create instance with custom address', () => {
      const customAddress = '0x1234567890123456789012345678901234567890'
      const customVerifier = new PDPVerifier(mockProvider, customAddress)
      assert.exists(customVerifier)
      assert.isFunction(customVerifier.proofSetLive)
      assert.isFunction(customVerifier.getNextRootId)
    })
  })

  describe('proofSetLive', () => {
    it('should check if proof set is live', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xf5cac1ba') === true) { // proofSetLive selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }
        return '0x' + '0'.repeat(64)
      }

      const isLive = await pdpVerifier.proofSetLive(123)
      assert.isTrue(isLive)
    })
  })

  describe('getNextRootId', () => {
    it('should get next root ID', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xd49245c1') === true) { // getNextRootId selector
          return ethers.zeroPadValue('0x05', 32) // Return 5
        }
        return '0x' + '0'.repeat(64)
      }

      const nextRootId = await pdpVerifier.getNextRootId(123)
      assert.equal(nextRootId, 5)
    })
  })

  describe('getProofSetListener', () => {
    it('should get proof set listener', async () => {
      const listenerAddress = '0x1234567890123456789012345678901234567890'
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x31601226') === true) { // getProofSetListener selector
          return ethers.zeroPadValue(listenerAddress, 32)
        }
        return '0x' + '0'.repeat(64)
      }

      const listener = await pdpVerifier.getProofSetListener(123)
      assert.equal(listener.toLowerCase(), listenerAddress.toLowerCase())
    })
  })

  describe('getProofSetOwner', () => {
    it('should get proof set owner', async () => {
      const owner = '0x1234567890123456789012345678901234567890'
      const proposedOwner = '0xabcdef1234567890123456789012345678901234'

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4726075b') === true) { // getProofSetOwner selector
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'address'],
            [owner, proposedOwner]
          )
        }
        return '0x' + '0'.repeat(64)
      }

      const result = await pdpVerifier.getProofSetOwner(123)
      assert.equal(result.owner.toLowerCase(), owner.toLowerCase())
      assert.equal(result.proposedOwner.toLowerCase(), proposedOwner.toLowerCase())
    })
  })

  describe('getProofSetLeafCount', () => {
    it('should get proof set leaf count', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x3f84135f') === true) { // getProofSetLeafCount selector
          return ethers.zeroPadValue('0x0a', 32) // Return 10
        }
        return '0x' + '0'.repeat(64)
      }

      const leafCount = await pdpVerifier.getProofSetLeafCount(123)
      assert.equal(leafCount, 10)
    })
  })

  describe('extractProofSetIdFromReceipt', () => {
    it('should extract proof set ID from receipt', async () => {
      const mockReceipt = {
        logs: [{
          address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
          topics: [
            ethers.id('ProofSetCreated(uint256,address)'),
            ethers.zeroPadValue('0x7b', 32), // proof set ID 123
            ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32)
          ],
          data: '0x'
        }]
      } as any

      const proofSetId = pdpVerifier.extractProofSetIdFromReceipt(mockReceipt)
      assert.equal(proofSetId, 123)
    })

    it('should return null if no ProofSetCreated event found', async () => {
      const mockReceipt = { logs: [] } as any

      const proofSetId = pdpVerifier.extractProofSetIdFromReceipt(mockReceipt)
      assert.isNull(proofSetId)
    })
  })

  describe('getContractAddress', () => {
    it('should return the contract address', async () => {
      const address = pdpVerifier.getContractAddress()
      assert.equal(address, testAddress)
    })
  })
})
