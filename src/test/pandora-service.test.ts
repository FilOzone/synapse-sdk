/* globals describe it beforeEach */

/**
 * Tests for PandoraService class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PandoraService } from '../pandora/index.js'
import { createMockProvider } from './test-utils.js'

describe('PandoraService', () => {
  let mockProvider: ethers.Provider
  let pandoraService: PandoraService
  const mockPandoraAddress = '0xEB022abbaa66D9F459F3EC2FeCF81a6D03c2Cb6F'
  const clientAddress = '0x1234567890123456789012345678901234567890'

  beforeEach(() => {
    mockProvider = createMockProvider()
    pandoraService = new PandoraService(mockProvider, mockPandoraAddress)
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', () => {
      assert.exists(pandoraService)
      assert.isFunction(pandoraService.getClientProofSets)
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

      const proofSets = await pandoraService.getClientProofSets(clientAddress)
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

      const proofSets = await pandoraService.getClientProofSets(clientAddress)

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
        await pandoraService.getClientProofSets(clientAddress)
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

      const detailedProofSets = await pandoraService.getClientProofSetsWithDetails(clientAddress)

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
      const allProofSets = await pandoraService.getClientProofSetsWithDetails(clientAddress, false)
      assert.lengthOf(allProofSets, 2)

      // Get only managed proof sets
      const managedProofSets = await pandoraService.getClientProofSetsWithDetails(clientAddress, true)
      assert.lengthOf(managedProofSets, 1)
      assert.equal(managedProofSets[0].railId, 48)
      assert.isTrue(managedProofSets[0].isManaged)
    })

    it('should throw error when contract calls fail', async () => {
      // Mock getClientProofSets to return a proof set
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // getClientProofSets - return 1 proof set
        if (data?.startsWith('0x4234653a') === true) {
          const proofSet = [48n, clientAddress, '0xabc1234567890123456789012345678901234567', 100n, 'Test1', [], 0n, false]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)[]'],
            [[proofSet]]
          )
        }

        // railToProofSet - throw error
        if (data?.startsWith('0x76704486') === true) {
          throw new Error('Contract call failed')
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await pandoraService.getClientProofSetsWithDetails(clientAddress)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get details for proof set with rail ID 48')
        assert.include(error.message, 'Contract call failed')
      }
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

      const proofSets = await pandoraService.getClientProofSetsWithDetails(clientAddress)
      const managedProofSets = proofSets.filter(ps => ps.isManaged)
      assert.lengthOf(managedProofSets, 1)
      assert.isTrue(managedProofSets[0].isManaged)
    })
  })

  describe('getAddRootsInfo', () => {
    it('should return correct add roots information', async () => {
      const proofSetId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

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

        // getProofSet
        if (data?.startsWith('0x96f25cf3') === true) {
          const info = [
            48n, // railId
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

      const addRootsInfo = await pandoraService.getAddRootsInfo(proofSetId)
      assert.equal(addRootsInfo.nextRootId, 5)
      assert.equal(addRootsInfo.clientDataSetId, 3)
      assert.equal(addRootsInfo.currentRootCount, 5)
    })

    it('should throw error if proof set is not managed by this Pandora', async () => {
      const proofSetId = 48
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

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

        // getProofSet - needed for getAddRootsInfo
        if (data?.startsWith('0x96f25cf3') === true) {
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
            ['tuple(uint256,address,address,uint256,string,string[],uint256,bool)'],
            [info]
          )
        }

        // Default return for any other calls
        return '0x' + '0'.repeat(64) // Return 32 bytes of zeros
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await pandoraService.getAddRootsInfo(proofSetId)
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

      const nextId = await pandoraService.getNextClientDataSetId(clientAddress)
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

      const result = await pandoraService.verifyProofSetCreation(mockTxHash)

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

      const result = await pandoraService.verifyProofSetCreation(mockTxHash)

      assert.isFalse(result.transactionMined)
      assert.isFalse(result.transactionSuccess)
      assert.isFalse(result.proofSetLive)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
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

      const isApproved = await pandoraService.isProviderApproved(providerAddress)
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

      const providerId = await pandoraService.getProviderIdByAddress(providerAddress)
      assert.equal(providerId, 5)
    })

    it('should get approved provider info', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x1c7db86a') === true) { // getApprovedProvider selector
          const providerInfo = [
            '0x1234567890123456789012345678901234567890', // owner
            'https://pdp.provider.com', // pdpUrl
            'https://retrieval.provider.com', // pieceRetrievalUrl
            1234567890n, // registeredAt
            1234567900n // approvedAt
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,string,uint256,uint256)'],
            [providerInfo]
          )
        }
        return '0x' + '0'.repeat(64)
      }

      const info = await pandoraService.getApprovedProvider(1)
      assert.equal(info.owner.toLowerCase(), '0x1234567890123456789012345678901234567890')
      assert.equal(info.pdpUrl, 'https://pdp.provider.com')
      assert.equal(info.pieceRetrievalUrl, 'https://retrieval.provider.com')
      assert.equal(info.registeredAt, 1234567890)
      assert.equal(info.approvedAt, 1234567900)
    })

    it('should get pending provider info', async () => {
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x3faef523') === true) { // pendingProviders selector
          const pendingInfo = [
            'https://pdp.pending.com', // pdpUrl
            'https://retrieval.pending.com', // pieceRetrievalUrl
            1234567880n // registeredAt
          ]
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['string', 'string', 'uint256'],
            pendingInfo
          )
        }
        return '0x' + '0'.repeat(64)
      }

      const info = await pandoraService.getPendingProvider('0xabcdef1234567890123456789012345678901234')
      assert.equal(info.pdpUrl, 'https://pdp.pending.com')
      assert.equal(info.pieceRetrievalUrl, 'https://retrieval.pending.com')
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

      const nextId = await pandoraService.getNextProviderId()
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

      const owner = await pandoraService.getOwner()
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

      const isOwner = await pandoraService.isOwner(mockSigner)
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

      const providers = await pandoraService.getAllApprovedProviders()
      assert.lengthOf(providers, 2)
      assert.equal(providers[0].owner.toLowerCase(), '0x1111111111111111111111111111111111111111')
      assert.equal(providers[1].owner.toLowerCase(), '0x2222222222222222222222222222222222222222')
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

        // Override _getPandoraContract to return our mock
        const originalGetPandoraContract = (pandoraService as any)._getPandoraContract
        ;(pandoraService as any)._getPandoraContract = () => mockContract

        const tx = await pandoraService.addServiceProvider(
          mockSigner,
          providerAddress,
          pdpUrl,
          pieceRetrievalUrl
        )

        assert.isTrue(addServiceProviderCalled)
        assert.equal(tx.hash, '0xmocktxhash')

        // Restore original method
        ;(pandoraService as any)._getPandoraContract = originalGetPandoraContract
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

        // Override _getPandoraContract to return our mock
        const originalGetPandoraContract = (pandoraService as any)._getPandoraContract
        ;(pandoraService as any)._getPandoraContract = () => mockContract

        try {
          await pandoraService.addServiceProvider(
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
        ;(pandoraService as any)._getPandoraContract = originalGetPandoraContract
      })
    })
  })

  describe('Storage Cost Operations', () => {
    describe('calculateStorageCost', () => {
      it('should calculate storage costs correctly for 1 GiB', async () => {
        // Mock the getServicePrice call on Pandora contract
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
        const costs = await pandoraService.calculateStorageCost(sizeInBytes)

        assert.exists(costs.perEpoch)
        assert.exists(costs.perDay)
        assert.exists(costs.perMonth)
        assert.exists(costs.withCDN)

        // Verify costs are reasonable
        assert.isTrue(costs.perEpoch > 0n)
        assert.isTrue(costs.perDay > costs.perEpoch)
        assert.isTrue(costs.perMonth > costs.perDay)

        // CDN costs should be higher
        assert.isTrue(costs.withCDN.perEpoch > costs.perEpoch)
        assert.isTrue(costs.withCDN.perDay > costs.perDay)
        assert.isTrue(costs.withCDN.perMonth > costs.perMonth)

        // Verify CDN is 1.5x base rate (3 USDFC vs 2 USDFC per TiB/month)
        assert.equal((costs.withCDN.perEpoch * 2n) / costs.perEpoch, 3n)
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

        const costs1GiB = await pandoraService.calculateStorageCost(1024 * 1024 * 1024)
        const costs10GiB = await pandoraService.calculateStorageCost(10 * 1024 * 1024 * 1024)

        // 10 GiB should cost approximately 10x more than 1 GiB
        // Allow for small rounding differences in bigint division
        const ratio = Number(costs10GiB.perEpoch) / Number(costs1GiB.perEpoch)
        assert.closeTo(ratio, 10, 0.01)

        // Verify the relationship holds for day and month calculations
        assert.equal(costs10GiB.perDay.toString(), (costs10GiB.perEpoch * 2880n).toString())
        assert.equal(costs10GiB.perMonth.toString(), (costs10GiB.perEpoch * 86400n).toString())
      })

      it('should fetch pricing from Pandora contract', async () => {
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

        await pandoraService.calculateStorageCost(1024 * 1024 * 1024)
        assert.isTrue(getServicePriceCalled, 'Should have called getServicePrice on Pandora contract')
      })
    })

    describe('checkAllowanceForStorage', () => {
      it('should check allowances for storage operations', async () => {
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockPandoraAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
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

        const check = await pandoraService.checkAllowanceForStorage(
          10 * 1024 * 1024 * 1024, // 10 GiB
          false,
          mockPaymentsService
        )

        assert.exists(check.rateAllowanceNeeded)
        assert.exists(check.lockupAllowanceNeeded)
        assert.exists(check.currentRateAllowance)
        assert.exists(check.currentLockupAllowance)
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
        assert.exists(check.depositAmountNeeded)
        assert.isTrue(check.depositAmountNeeded > 0n)

        // With no current allowances, should not be sufficient
        assert.isFalse(check.sufficient)
        assert.exists(check.message)
        assert.include(check.message, 'insufficient')
      })

      it('should return sufficient when allowances are adequate', async () => {
        // Create a mock PaymentsService with adequate allowances
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockPandoraAddress)
            return {
              isApproved: true,
              rateAllowance: ethers.parseUnits('100', 18),
              lockupAllowance: ethers.parseUnits('10000', 18),
              rateUsed: 0n,
              lockupUsed: 0n
            }
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

        const check = await pandoraService.checkAllowanceForStorage(
          1024 * 1024, // 1 MiB - small amount
          false,
          mockPaymentsService
        )

        assert.isTrue(check.sufficient)
        assert.isUndefined(check.message)

        // Verify costs are included
        assert.exists(check.costs)
        assert.exists(check.costs.perEpoch)
        assert.exists(check.costs.perDay)
        assert.exists(check.costs.perMonth)

        // Verify depositAmountNeeded is included
        assert.exists(check.depositAmountNeeded)
        assert.isTrue(check.depositAmountNeeded > 0n)
      })

      it('should include depositAmountNeeded in response', async () => {
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockPandoraAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
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

        const check = await pandoraService.checkAllowanceForStorage(
          1024 * 1024 * 1024, // 1 GiB
          false,
          mockPaymentsService
        )

        // Verify depositAmountNeeded is present and reasonable
        assert.exists(check.depositAmountNeeded)
        assert.isTrue(check.depositAmountNeeded > 0n)

        // depositAmountNeeded should equal the lockup amount (rate * lockup period)
        // Default is 10 days = 10 * 2880 epochs = 28800 epochs
        const expectedDeposit = check.costs.perEpoch * 28800n
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())
      })

      it('should use custom lockup days when provided', async () => {
        // Create a mock PaymentsService
        const mockPaymentsService: any = {
          serviceApproval: async (serviceAddress: string) => {
            assert.strictEqual(serviceAddress, mockPandoraAddress)
            return {
              isApproved: false,
              rateAllowance: 0n,
              lockupAllowance: 0n,
              rateUsed: 0n,
              lockupUsed: 0n
            }
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

        // Test with custom lockup period of 20 days
        const customLockupDays = 20
        const check = await pandoraService.checkAllowanceForStorage(
          1024 * 1024 * 1024, // 1 GiB
          false,
          mockPaymentsService,
          customLockupDays
        )

        // Verify depositAmountNeeded uses custom lockup period
        const expectedDeposit = check.costs.perEpoch * BigInt(customLockupDays) * 2880n // 2880 epochs per day
        assert.equal(check.depositAmountNeeded.toString(), expectedDeposit.toString())

        // Compare with default (10 days) to ensure they're different
        const defaultCheck = await pandoraService.checkAllowanceForStorage(
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
          approveService: async (serviceAddress: string, rateAllowance: bigint, lockupAllowance: bigint) => {
            assert.strictEqual(serviceAddress, mockPandoraAddress)
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

        const prep = await pandoraService.prepareStorageUpload({
          dataSize: 10 * 1024 * 1024 * 1024, // 10 GiB
          withCDN: false
        }, mockPaymentsService)

        assert.exists(prep.estimatedCost)
        assert.exists(prep.allowanceCheck)
        assert.isArray(prep.actions)

        // Should have at least approval action (since mock has no allowances)
        assert.isAtLeast(prep.actions.length, 1)

        const approvalAction = prep.actions.find(a => a.type === 'approveService')
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

        const prep = await pandoraService.prepareStorageUpload({
          dataSize: 10 * 1024 * 1024 * 1024, // 10 GiB
          withCDN: false
        }, mockPaymentsService)

        // Should have both deposit and approval actions
        assert.isAtLeast(prep.actions.length, 2)

        const depositAction = prep.actions.find(a => a.type === 'deposit')
        assert.exists(depositAction)
        assert.include(depositAction.description, 'Deposit')
        assert.include(depositAction.description, 'USDFC')

        const approvalAction = prep.actions.find(a => a.type === 'approveService')
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

        const prep = await pandoraService.prepareStorageUpload({
          dataSize: 1024 * 1024, // 1 MiB - small amount
          withCDN: false
        }, mockPaymentsService)

        assert.lengthOf(prep.actions, 0)
        assert.isTrue(prep.allowanceCheck.sufficient)
      })
    })
  })

  describe('Comprehensive Status Methods', () => {
    it('should combine PDP server and chain verification status', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer
      const mockPDPServer: any = {
        getProofSetCreationStatus: async (txHash: string) => {
          assert.strictEqual(txHash, mockTxHash)
          return {
            createMessageHash: mockTxHash,
            proofsetCreated: true,
            service: 'test-service',
            txStatus: 'confirmed',
            ok: true,
            proofSetId: 123
          }
        }
      }

      // Mock provider for chain verification
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
              ethers.id('ProofSetCreated(uint256,address)'),
              ethers.zeroPadValue('0x7b', 32),
              ethers.zeroPadValue(clientAddress, 32)
            ],
            data: '0x'
          }]
        } as any
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32) // isLive = true
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await pandoraService.getComprehensiveProofSetStatus(mockTxHash, mockPDPServer)

      assert.strictEqual(result.txHash, mockTxHash)
      assert.exists(result.serverStatus)
      assert.exists(result.chainStatus)
      assert.exists(result.summary)

      // Verify server status
      assert.isTrue(result.serverStatus.proofsetCreated)
      assert.strictEqual(result.serverStatus.proofSetId, 123)

      // Verify chain status
      assert.isTrue(result.chainStatus.transactionMined)
      assert.isTrue(result.chainStatus.transactionSuccess)
      assert.isTrue(result.chainStatus.proofSetLive)
      assert.strictEqual(result.chainStatus.proofSetId, 123)

      // Verify summary
      assert.isTrue(result.summary.isComplete)
      assert.isTrue(result.summary.isLive)
      assert.strictEqual(result.summary.proofSetId, 123)
      assert.isNull(result.summary.error)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })

    it('should handle PDP server failure gracefully', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer that throws error
      const mockPDPServer: any = {
        getProofSetCreationStatus: async () => {
          throw new Error('Server unavailable')
        }
      }

      // Mock provider for chain verification (still works)
      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => {
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
            data: '0x'
          }]
        } as any
      }

      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await pandoraService.getComprehensiveProofSetStatus(mockTxHash, mockPDPServer)

      // Server status should be null due to error
      assert.isNull(result.serverStatus)

      // Chain status should still work
      assert.isTrue(result.chainStatus.transactionMined)
      assert.isTrue(result.chainStatus.proofSetLive)

      // Summary should still work based on chain data, except isComplete
      assert.isFalse(result.summary.isComplete)
      assert.isTrue(result.summary.isLive)
      assert.strictEqual(result.summary.proofSetId, 123)

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })

    it('should wait for proof set to become live', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      let callCount = 0

      // Create a mock PDPServer
      const mockPDPServer: any = {
        getProofSetCreationStatus: async () => {
          callCount++
          if (callCount === 1) {
            // First call - not created yet
            return {
              createMessageHash: mockTxHash,
              proofsetCreated: false,
              service: 'test-service',
              txStatus: 'pending',
              ok: null,
              proofSetId: undefined
            }
          } else {
            // Second call - created
            return {
              createMessageHash: mockTxHash,
              proofsetCreated: true,
              service: 'test-service',
              txStatus: 'confirmed',
              ok: true,
              proofSetId: 123
            }
          }
        }
      }

      // Mock provider
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
                ethers.id('ProofSetCreated(uint256,address)'),
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
        if (data?.startsWith('0xf5cac1ba') === true) {
          return ethers.zeroPadValue('0x01', 32)
        }
        return '0x' + '0'.repeat(64)
      }

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      const result = await pandoraService.waitForProofSetCreationWithStatus(
        mockTxHash,
        mockPDPServer,
        5000, // 5 second timeout
        100 // 100ms poll interval
      )

      assert.isTrue(result.summary.isComplete)
      assert.isTrue(result.summary.isLive)
      assert.strictEqual(result.summary.proofSetId, 123)
      assert.strictEqual(callCount, 2) // Should have polled twice

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })

    it('should timeout if proof set takes too long', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

      // Create a mock PDPServer that always returns pending
      const mockPDPServer: any = {
        getProofSetCreationStatus: async () => {
          return {
            createMessageHash: mockTxHash,
            proofsetCreated: false,
            service: 'test-service',
            txStatus: 'pending',
            ok: null,
            proofSetId: undefined
          }
        }
      }

      // Mock provider - transaction never mines
      const originalGetTransactionReceipt = mockProvider.getTransactionReceipt
      mockProvider.getTransactionReceipt = async () => null

      mockProvider.getNetwork = async () => ({ chainId: 314159n, name: 'calibration' }) as any

      try {
        await pandoraService.waitForProofSetCreationWithStatus(
          mockTxHash,
          mockPDPServer,
          300, // 300ms timeout
          100 // 100ms poll interval
        )
        assert.fail('Should have thrown timeout error')
      } catch (error: any) {
        assert.include(error.message, 'Timeout waiting for proof set creation')
      }

      mockProvider.getTransactionReceipt = originalGetTransactionReceipt
    })
  })
})
