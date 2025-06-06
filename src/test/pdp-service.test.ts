/* globals describe it beforeEach */

/**
 * Tests for PDPService class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPService } from '../pdp/index.js'
import { createMockProvider } from './test-utils.js'

describe('PDPService', () => {
  let mockProvider: ethers.Provider
  let pdpService: PDPService
  const mockPandoraAddress = '0xEB022abbaa66D9F459F3EC2FeCF81a6D03c2Cb6F'
  const clientAddress = '0x1234567890123456789012345678901234567890'

  beforeEach(() => {
    mockProvider = createMockProvider()
    pdpService = new PDPService(mockProvider, mockPandoraAddress)
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', () => {
      assert.exists(pdpService)
      assert.isFunction(pdpService.getClientProofSets)
    })
  })

  describe('getClientProofSets', () => {
    it('should return empty array when client has no proof sets', async () => {
      // Mock provider will return empty array by default
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4234653a') === true) {
          // Return empty array
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [[]]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const proofSets = await pdpService.getClientProofSets(clientAddress)
      assert.isArray(proofSets)
      assert.lengthOf(proofSets, 0)
    })

    it('should return proof sets for a client', async () => {
      // Mock provider to return proof sets
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4234653a') === true) {
          // Return two proof sets
          const proofSet1 = {
            railId: 123n,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0xabcdef1234567890123456789012345678901234',
            commissionBps: 100n, // 1%
            metadata: 'Test metadata 1',
            rootMetadata: ['root1', 'root2'],
            clientDataSetId: 0n,
            withCDN: false
          }

          const proofSet2 = {
            railId: 456n,
            payer: '0x1234567890123456789012345678901234567890',
            payee: '0x9876543210987654321098765432109876543210',
            commissionBps: 200n, // 2%
            metadata: 'Test metadata 2',
            rootMetadata: ['root3'],
            clientDataSetId: 1n,
            withCDN: true
          }

          // Create properly ordered arrays for encoding
          const proofSets = [
            [
              proofSet1.railId,
              proofSet1.payer,
              proofSet1.payee,
              proofSet1.commissionBps,
              proofSet1.metadata,
              proofSet1.rootMetadata,
              proofSet1.clientDataSetId,
              proofSet1.withCDN
            ],
            [
              proofSet2.railId,
              proofSet2.payer,
              proofSet2.payee,
              proofSet2.commissionBps,
              proofSet2.metadata,
              proofSet2.rootMetadata,
              proofSet2.clientDataSetId,
              proofSet2.withCDN
            ]
          ]

          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [proofSets]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const proofSets = await pdpService.getClientProofSets(clientAddress)

      assert.isArray(proofSets)
      assert.lengthOf(proofSets, 2)

      // Check first proof set
      assert.equal(proofSets[0].railId, 123)
      assert.equal(proofSets[0].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(proofSets[0].payee.toLowerCase(), '0xabcdef1234567890123456789012345678901234'.toLowerCase())
      assert.equal(proofSets[0].commissionBps, 100)
      assert.equal(proofSets[0].metadata, 'Test metadata 1')
      assert.deepEqual(proofSets[0].rootMetadata, ['root1', 'root2'])
      assert.equal(proofSets[0].clientDataSetId, 0)
      assert.equal(proofSets[0].withCDN, false)

      // Check second proof set
      assert.equal(proofSets[1].railId, 456)
      assert.equal(proofSets[1].payer.toLowerCase(), '0x1234567890123456789012345678901234567890'.toLowerCase())
      assert.equal(proofSets[1].payee.toLowerCase(), '0x9876543210987654321098765432109876543210'.toLowerCase())
      assert.equal(proofSets[1].commissionBps, 200)
      assert.equal(proofSets[1].metadata, 'Test metadata 2')
      assert.deepEqual(proofSets[1].rootMetadata, ['root3'])
      assert.equal(proofSets[1].clientDataSetId, 1)
      assert.equal(proofSets[1].withCDN, true)
    })

    it('should handle contract call errors gracefully', async () => {
      // Mock provider to throw error
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4234653a') === true) {
          throw new Error('Contract call failed')
        }
        return await originalCall.call(mockProvider, transaction)
      }

      try {
        await pdpService.getClientProofSets(clientAddress)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get client proof sets')
        assert.include(error.message, 'Contract call failed')
      }
    })
  })
})
