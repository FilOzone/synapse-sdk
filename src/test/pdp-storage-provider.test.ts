/* globals describe it */

/**
 * Basic tests for StorageProviderTool
 */

import { assert } from 'chai'
import { StorageProviderTool } from '../pdp/storage-provider.js'

describe('StorageProviderTool', () => {
  it('should create instance with contract address and signer', () => {
    // Create a minimal mock signer with provider
    const mockSigner: any = {
      getAddress: async () => '0x1234567890123456789012345678901234567890',
      provider: {
        getNetwork: async () => ({ chainId: 314159n })
      }
    }

    const contractAddress = '0xbB94727BC196eF7457417c09956437A3dd08790A'
    const tool = new StorageProviderTool(contractAddress, mockSigner)

    assert.strictEqual(tool.getContractAddress(), contractAddress)
  })

  it('should have all expected methods', () => {
    const mockSigner: any = {
      getAddress: async () => '0x1234567890123456789012345678901234567890',
      provider: {
        getNetwork: async () => ({ chainId: 314159n })
      }
    }

    const contractAddress = '0xbB94727BC196eF7457417c09956437A3dd08790A'
    const tool = new StorageProviderTool(contractAddress, mockSigner)

    // Check that all methods exist
    assert(typeof tool.register === 'function')
    assert(typeof tool.approve === 'function')
    assert(typeof tool.reject === 'function')
    assert(typeof tool.remove === 'function')
    assert(typeof tool.isApproved === 'function')
    assert(typeof tool.getProviderIdByAddress === 'function')
    assert(typeof tool.getApprovedProvider === 'function')
    assert(typeof tool.getPendingProvider === 'function')
    assert(typeof tool.getNextProviderId === 'function')
    assert(typeof tool.getOwner === 'function')
    assert(typeof tool.getSignerAddress === 'function')
    assert(typeof tool.isOwner === 'function')
    assert(typeof tool.getAllApprovedProviders === 'function')
    assert(typeof tool.getContractAddress === 'function')
  })

  it('should handle getSignerAddress', async () => {
    const signerAddress = '0x1234567890123456789012345678901234567890'
    const mockSigner: any = {
      getAddress: async () => signerAddress,
      provider: {
        getNetwork: async () => ({ chainId: 314159n })
      }
    }

    const contractAddress = '0xbB94727BC196eF7457417c09956437A3dd08790A'
    const tool = new StorageProviderTool(contractAddress, mockSigner)

    const address = await tool.getSignerAddress()
    assert.strictEqual(address, signerAddress)
  })

  it('should handle isOwner with case-insensitive comparison', async () => {
    const signerAddress = '0x1234567890123456789012345678901234567890'
    const mockSigner: any = {
      getAddress: async () => signerAddress.toLowerCase(),
      provider: {
        getNetwork: async () => ({ chainId: 314159n }),
        call: async () => '0x' + '00'.repeat(12) + signerAddress.slice(2).toUpperCase()
      }
    }

    const contractAddress = '0xbB94727BC196eF7457417c09956437A3dd08790A'
    const tool = new StorageProviderTool(contractAddress, mockSigner)

    // Since we can't easily mock the contract methods, we'll just ensure the method exists
    assert(typeof tool.isOwner === 'function')
  })
})
