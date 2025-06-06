import { type Signer, Contract, type ContractTransactionResponse } from 'ethers'
import { CONTRACT_ABIS } from '../utils/index.js'

/**
 * Information about an approved storage provider
 */
export interface ApprovedProviderInfo {
  owner: string
  pdpUrl: string
  pieceRetrievalUrl: string
  registeredAt: bigint
  approvedAt: bigint
}

/**
 * Information about a pending storage provider registration
 */
export interface PendingProviderInfo {
  pdpUrl: string
  pieceRetrievalUrl: string
  registeredAt: bigint
}

/**
 * Tool for interacting with Pandora contract for storage provider operations
 *
 * This class is intended to be stand-alone, and is not intended for general use. Its functionality
 * is applicable to either storage providers offering PDP services, or contract owners managing
 * approved storage providers.
 */
export class StorageProviderTool {
  private readonly contract: Contract
  private readonly signer: Signer

  /**
   * Create a new StorageProviderTool instance
   * @param contractAddress - Address of the Pandora contract
   * @param signer - Ethers signer for transactions
   */
  constructor (contractAddress: string, signer: Signer) {
    this.signer = signer
    this.contract = new Contract(contractAddress, CONTRACT_ABIS.PANDORA_SERVICE, signer)
  }

  /**
   * Register as a service provider (storage provider calls this)
   * @param pdpUrl - URL for PDP API endpoint
   * @param pieceRetrievalUrl - URL for piece retrieval endpoint
   * @returns Transaction response
   */
  async register (pdpUrl: string, pieceRetrievalUrl: string): Promise<ContractTransactionResponse> {
    return await this.contract.registerServiceProvider(pdpUrl, pieceRetrievalUrl)
  }

  /**
   * Approve a pending service provider (only contract owner can call this)
   * @param providerAddress - Address of the provider to approve
   * @returns Transaction response
   */
  async approve (providerAddress: string): Promise<ContractTransactionResponse> {
    return await this.contract.approveServiceProvider(providerAddress)
  }

  /**
   * Reject a pending service provider (only contract owner can call this)
   * @param providerAddress - Address of the provider to reject
   * @returns Transaction response
   */
  async reject (providerAddress: string): Promise<ContractTransactionResponse> {
    return await this.contract.rejectServiceProvider(providerAddress)
  }

  /**
   * Remove an approved service provider by ID (only contract owner can call this)
   * @param providerId - ID of the provider to remove
   * @returns Transaction response
   */
  async remove (providerId: bigint): Promise<ContractTransactionResponse> {
    return await this.contract.removeServiceProvider(providerId)
  }

  /**
   * Check if a provider is approved
   * @param providerAddress - Address to check
   * @returns True if approved, false otherwise
   */
  async isApproved (providerAddress: string): Promise<boolean> {
    return await this.contract.isProviderApproved(providerAddress)
  }

  /**
   * Get provider ID by address
   * @param providerAddress - Provider address
   * @returns Provider ID (0 if not approved)
   */
  async getProviderIdByAddress (providerAddress: string): Promise<bigint> {
    return await this.contract.getProviderIdByAddress(providerAddress)
  }

  /**
   * Get approved provider information by ID
   * @param providerId - Provider ID
   * @returns Provider information
   */
  async getApprovedProvider (providerId: bigint): Promise<ApprovedProviderInfo> {
    const result = await this.contract.getApprovedProvider(providerId)
    return {
      owner: result.owner,
      pdpUrl: result.pdpUrl,
      pieceRetrievalUrl: result.pieceRetrievalUrl,
      registeredAt: result.registeredAt,
      approvedAt: result.approvedAt
    }
  }

  /**
   * Get pending provider information
   * @param providerAddress - Provider address
   * @returns Pending provider info (or null values if not pending)
   */
  async getPendingProvider (providerAddress: string): Promise<PendingProviderInfo> {
    const [pdpUrl, pieceRetrievalUrl, registeredAt] = await this.contract.pendingProviders(providerAddress)
    return {
      pdpUrl,
      pieceRetrievalUrl,
      registeredAt
    }
  }

  /**
   * Get the next provider ID (useful to see how many providers exist)
   * @returns Next provider ID
   */
  async getNextProviderId (): Promise<bigint> {
    return await this.contract.nextServiceProviderId()
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner (): Promise<string> {
    return await this.contract.owner()
  }

  /**
   * Get signer address
   * @returns Address of the signer
   */
  async getSignerAddress (): Promise<string> {
    return await this.signer.getAddress()
  }

  /**
   * Check if the current signer is the contract owner
   * @returns True if signer is owner, false otherwise
   */
  async isOwner (): Promise<boolean> {
    const [owner, signerAddress] = await Promise.all([
      this.getOwner(),
      this.getSignerAddress()
    ])
    return owner.toLowerCase() === signerAddress.toLowerCase()
  }

  /**
   * Get all approved providers (convenience method)
   * @returns Array of approved providers with their IDs
   */
  async getAllApprovedProviders (): Promise<Array<{ id: bigint, info: ApprovedProviderInfo }>> {
    const nextId = await this.getNextProviderId()
    const providers: Array<{ id: bigint, info: ApprovedProviderInfo }> = []

    for (let i = 1n; i < nextId; i++) {
      try {
        const info = await this.getApprovedProvider(i)
        if (info.owner !== '0x0000000000000000000000000000000000000000') {
          providers.push({ id: i, info })
        }
      } catch (e) {
        // Provider might have been removed
        continue
      }
    }

    return providers
  }
}
