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
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4234653a') === true) {
          // Return empty array
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [[]]
          )
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      const proofSets = await pdpService.getClientProofSets(clientAddress)
      assert.isArray(proofSets)
      assert.lengthOf(proofSets, 0)
    })

    it('should return proof sets for a client', async () => {
      // Mock provider to return proof sets
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
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
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
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x4234653a') === true) {
          throw new Error('Contract call failed')
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
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

  describe('getClientProofSetsWithDetails', () => {
    it('should enhance proof sets with PDPVerifier details', async () => {
      // Mock provider for multiple contract calls
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientProofSets call
        if (data?.startsWith('0x4234653a') === true) {
          const proofSet = {
            railId: 48n,
            payer: clientAddress,
            payee: '0xabcdef1234567890123456789012345678901234',
            commissionBps: 100n,
            metadata: 'Test',
            rootMetadata: [],
            clientDataSetId: 0n,
            withCDN: false
          }
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [[[proofSet.railId, proofSet.payer, proofSet.payee, proofSet.commissionBps, proofSet.metadata, proofSet.rootMetadata, proofSet.clientDataSetId, proofSet.withCDN]]]
          )
        }

        // railToProofSet call
        if (data?.startsWith('0x76704486') === true) { // railToProofSet(uint256) selector
          return ethers.zeroPadValue('0xf2', 32) // Return proof set ID 242
        }

        // proofSetLive call
        if (data?.startsWith('0xf5cac1ba') === true) { // proofSetLive(uint256) selector
          return ethers.zeroPadValue('0x01', 32) // Return true
        }

        // getNextRootId call
        if (data?.startsWith('0xd49245c1') === true) { // getNextRootId(uint256) selector
          return ethers.zeroPadValue('0x02', 32) // Return 2
        }

        // getProofSetListener call
        if (data?.startsWith('0x31601226') === true) { // getProofSetListener(uint256) selector
          return ethers.zeroPadValue(mockPandoraAddress, 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      // Mock network for PDPVerifier address
      const originalGetNetwork = mockProvider.getNetwork
      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const detailedProofSets = await pdpService.getClientProofSetsWithDetails(clientAddress)

      assert.lengthOf(detailedProofSets, 1)
      assert.equal(detailedProofSets[0].railId, 48)
      assert.equal(detailedProofSets[0].pdpVerifierProofSetId, 242)
      assert.equal(detailedProofSets[0].nextRootId, 2)
      assert.equal(detailedProofSets[0].currentRootCount, 2)
      assert.isTrue(detailedProofSets[0].isLive)
      assert.isTrue(detailedProofSets[0].isManaged)

      mockProvider.getNetwork = originalGetNetwork
    })

    it('should filter unmanaged proof sets when onlyManaged is true', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientProofSets - return 2 proof sets
        if (data?.startsWith('0x4234653a') === true) {
          const proofSets = [
            [48n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test1', [], 0n, false],
            [49n, clientAddress, '0xdef1234567890123456789012345678901234567', 100n, 'Test2', [], 1n, false]
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [proofSets]
          )
        }

        // railToProofSet - both return valid IDs
        if (data?.startsWith('0x76704486') === true) {
          // Extract the rail ID from the encoded data
          const railIdHex = data.slice(10, 74) // Skip function selector and get 32 bytes
          if (railIdHex === ethers.zeroPadValue('0x30', 32).slice(2)) { // rail ID 48
            return ethers.zeroPadValue('0xf2', 32) // 242
          } else if (railIdHex === ethers.zeroPadValue('0x31', 32).slice(2)) { // rail ID 49
            return ethers.zeroPadValue('0xf3', 32) // 243
          }
          return ethers.zeroPadValue('0x00', 32) // 0
        }

        // proofSetLive - both are live
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getProofSetListener - first is managed, second is not
        if (data?.startsWith('0x31601226') === true) {
          // Extract the proof set ID from the encoded data
          const proofSetIdHex = data.slice(10, 74) // Skip function selector and get 32 bytes
          if (proofSetIdHex === ethers.zeroPadValue('0xf2', 32).slice(2)) { // proof set 242
            return ethers.zeroPadValue(mockPandoraAddress, 32) // Managed by us
          } else if (proofSetIdHex === ethers.zeroPadValue('0xf3', 32).slice(2)) { // proof set 243
            return ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32) // Different address
          }
          return ethers.zeroPadValue('0x0000000000000000000000000000000000000000', 32)
        }

        // getNextRootId
        if (data?.startsWith('0xd49245c1') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      // Get all proof sets
      const allProofSets = await pdpService.getClientProofSetsWithDetails(clientAddress, false)
      assert.lengthOf(allProofSets, 2)

      // Get only managed proof sets
      const managedProofSets = await pdpService.getClientProofSetsWithDetails(clientAddress, true)
      assert.lengthOf(managedProofSets, 1)
      assert.equal(managedProofSets[0].railId, 48)
      assert.isTrue(managedProofSets[0].isManaged)
    })
  })

  describe('getManagedProofSets', () => {
    it('should return only managed proof sets', async () => {
      // Set up mocks similar to above
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        if (data?.startsWith('0x4234653a') === true) {
          const proofSet = [48n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test', [], 0n, false]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [[proofSet]]
          )
        }

        if (data?.startsWith('0x76704486') === true) {
          return ethers.zeroPadValue('0xf2', 32)
        }

        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        if (data?.startsWith('0x31601226') === true) {
          return ethers.zeroPadValue(mockPandoraAddress, 32)
        }

        if (data?.startsWith('0xd49245c1') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const managedProofSets = await pdpService.getManagedProofSets(clientAddress)
      assert.lengthOf(managedProofSets, 1)
      assert.isTrue(managedProofSets[0].isManaged)
    })
  })

  describe('getAddRootsInfo', () => {
    it('should return correct add roots information', async () => {
      const railId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // railToProofSet
        if (data?.startsWith('0x76704486') === true) {
          return ethers.zeroPadValue('0xf2', 32) // 242
        }

        // proofSetLive
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }

        // getNextRootId
        if (data?.startsWith('0xd49245c1') === true) {
          return ethers.zeroPadValue('0x05', 32) // 5
        }

        // getProofSetListener
        if (data?.startsWith('0x31601226') === true) {
          return ethers.zeroPadValue(mockPandoraAddress, 32)
        }

        // proofSetInfo
        if (data?.startsWith('0xd2ba5965') === true) {
          const info = [
            railId,
            clientAddress,
            '0xabc1234567890123456789012345678901234567',
            100n,
            'Metadata',
            [],
            3n, // clientDataSetId
            false
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)'],
            [info]
          )
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const addRootsInfo = await pdpService.getAddRootsInfo(railId)
      assert.equal(addRootsInfo.nextRootId, 5)
      assert.equal(addRootsInfo.clientDataSetId, 3)
      assert.equal(addRootsInfo.currentRootCount, 5)
    })

    it('should throw error if proof set is not managed by this Pandora', async () => {
      const railId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // railToProofSet
        if (data?.startsWith('0x76704486') === true) {
          return ethers.zeroPadValue('0xf2', 32)
        }

        // proofSetLive
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // getProofSetListener
        if (data?.startsWith('0x31601226') === true) {
          return ethers.zeroPadValue('0x1234567890123456789012345678901234567890', 32) // Different address
        }

        // getNextRootId
        if (data?.startsWith('0xd49245c1') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }

        // proofSetInfo - needed for getAddRootsInfo
        if (data?.startsWith('0xd2ba5965') === true) {
          const info = [
            railId,
            clientAddress,
            '0xabc1234567890123456789012345678901234567',
            100n,
            'Metadata',
            [],
            3n, // clientDataSetId
            false
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)'],
            [info]
          )
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await pdpService.getAddRootsInfo(railId)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'not managed by this Pandora contract')
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

      const nextId = await pdpService.getNextClientDataSetId(clientAddress)
      assert.equal(nextId, 5)
    })
  })

  describe('verifyProofSetCreation', () => {
    it('should verify successful proof set creation', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

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
              ethers.id('ProofSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32), // proof set ID 123
              ethers.zeroPadValue(clientAddress, 32) // owner address
            ],
            data: '0x' // Empty data for indexed parameters
          }]
        } as any
      }

      // Mock proofSetLive check
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32) // true
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await pdpService.verifyProofSetCreation(mockTxHash)

      assert.isTrue(result.transactionMined)
      assert.isTrue(result.transactionSuccess)
      assert.equal(result.proofSetId, 123)
      assert.isTrue(result.proofSetLive)
      assert.equal(result.blockNumber, 12345)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })

    it('should handle transaction not mined yet', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null

      const result = await pdpService.verifyProofSetCreation(mockTxHash)

      assert.isFalse(result.transactionMined)
      assert.isFalse(result.transactionSuccess)
      assert.isFalse(result.proofSetLive)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })
  })

  describe('waitForProofSetCreation', () => {
    it('should wait for proof set to be created', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      let callCount = 0

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
        callCount++
        if (callCount === 1) {
          return null // Not mined yet
        }
        return {
          status: 1,
          blockNumber: 12345,
          gasUsed: 100000n,
          logs: [{
            address: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC',
            topics: [
              ethers.id('ProofSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32),
              ethers.zeroPadValue(clientAddress, 32)
            ],
            data: '0x' // Empty data for indexed parameters
          }]
        } as any
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await pdpService.waitForProofSetCreation(mockTxHash, 5000, 100)

      assert.isTrue(result.transactionMined)
      assert.isTrue(result.transactionSuccess)
      assert.isTrue(result.proofSetLive)
      assert.equal(result.proofSetId, 123)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })

    it('should timeout if proof set creation takes too long', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null // Never mines

      try {
        await pdpService.waitForProofSetCreation(mockTxHash, 300, 100)
        assert.fail('Should have thrown timeout error')
      } catch (error: any) {
        assert.include(error.message, 'Timeout waiting for proof set creation')
      }

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })
  })

  describe('getPandoraAddress', () => {
    it('should return the configured Pandora address', () => {
      assert.equal(pdpService.getPandoraAddress(), mockPandoraAddress)
    })
  })
})
