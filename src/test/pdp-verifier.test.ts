/* globals describe it beforeEach */

/**
 * Tests for PDPVerifier class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { PDPVerifier } from '../pdp/index.js'
import { useSinon, createMockProvider, stubContractCall } from './sinon-helpers.js'

describe('PDPVerifier', () => {
  const getSandbox = useSinon()
  let mockProvider: ethers.Provider
  let pdpVerifier: PDPVerifier

  beforeEach(() => {
    const sandbox = getSandbox()
    mockProvider = createMockProvider(sandbox, { chainId: 314159, network: 'calibration' })
    pdpVerifier = new PDPVerifier(mockProvider)
  })

  describe('Instantiation', () => {
    it('should create instance with provider', () => {
      assert.exists(pdpVerifier)
      assert.isFunction(pdpVerifier.proofSetLive)
      assert.isFunction(pdpVerifier.getNextRootId)
    })

    it('should reject unsupported networks', async () => {
      const sandbox = getSandbox()
      const unsupportedProvider = createMockProvider(sandbox, { chainId: 1, network: 'mainnet' })
      const unsupportedVerifier = new PDPVerifier(unsupportedProvider)

      try {
        await unsupportedVerifier.proofSetLive(1)
        assert.fail('Should have thrown for unsupported network')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported network')
      }
    })
  })

  describe('proofSetLive', () => {
    it('should check if proof set is live', async () => {
      stubContractCall(
        mockProvider,
        '0xf5cac1ba',
        ethers.zeroPadValue('0x01', 32)
      )

      const isLive = await pdpVerifier.proofSetLive(123)
      assert.isTrue(isLive)
    })
  })

  describe('getNextRootId', () => {
    it('should get next root ID', async () => {
      stubContractCall(
        mockProvider,
        '0xd49245c1',
        ethers.zeroPadValue('0x05', 32)
      )

      const nextRootId = await pdpVerifier.getNextRootId(123)
      assert.equal(nextRootId, 5)
    })
  })

  describe('getProofSetListener', () => {
    it('should get proof set listener', async () => {
      const listenerAddress = '0x1234567890123456789012345678901234567890'
      stubContractCall(
        mockProvider,
        '0x31601226',
        ethers.zeroPadValue(listenerAddress, 32)
      )

      const listener = await pdpVerifier.getProofSetListener(123)
      assert.equal(listener.toLowerCase(), listenerAddress.toLowerCase())
    })
  })

  describe('getProofSetOwner', () => {
    it('should get proof set owner', async () => {
      const owner = '0x1234567890123456789012345678901234567890'
      const proposedOwner = '0xabcdef1234567890123456789012345678901234'

      stubContractCall(
        mockProvider,
        '0x4726075b',
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['address', 'address'],
          [owner, proposedOwner]
        )
      )

      const result = await pdpVerifier.getProofSetOwner(123)
      assert.equal(result.owner.toLowerCase(), owner.toLowerCase())
      assert.equal(result.proposedOwner.toLowerCase(), proposedOwner.toLowerCase())
    })
  })

  describe('getProofSetLeafCount', () => {
    it('should get proof set leaf count', async () => {
      stubContractCall(
        mockProvider,
        '0x3f84135f',
        ethers.zeroPadValue('0x0a', 32)
      )

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

      const proofSetId = await pdpVerifier.extractProofSetIdFromReceipt(mockReceipt)
      assert.equal(proofSetId, 123)
    })

    it('should return null if no ProofSetCreated event found', async () => {
      const mockReceipt = { logs: [] } as any

      const proofSetId = await pdpVerifier.extractProofSetIdFromReceipt(mockReceipt)
      assert.isNull(proofSetId)
    })
  })

  describe('getContractAddress', () => {
    it('should return the contract address', async () => {
      const address = await pdpVerifier.getContractAddress()
      assert.equal(address, '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC')
    })
  })
})
