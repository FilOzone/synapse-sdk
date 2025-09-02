/**
 * ProviderResolver - Helper class to resolve approved providers
 *
 * Combines data from WarmStorageService (approval status) and
 * SPRegistryService (provider details) to provide a unified interface
 * for provider discovery and resolution.
 *
 * @example
 * ```typescript
 * const resolver = new ProviderResolver(warmStorage, spRegistry)
 *
 * // Get all approved providers with details
 * const providers = await resolver.getApprovedProviders()
 *
 * // Check specific provider
 * const provider = await resolver.getApprovedProvider(providerId)
 * ```
 */

import { ethers } from 'ethers'
import type { SPRegistryService } from '../sp-registry/index.js'
import type { ProviderInfo } from '../sp-registry/types.js'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from '../utils/constants.js'
import { getFilecoinNetworkType } from '../utils/index.js'
import type { WarmStorageService } from '../warm-storage/index.js'

export class ProviderResolver {
  constructor(
    private readonly warmStorage: WarmStorageService,
    private readonly spRegistry: SPRegistryService
  ) {}

  /**
   * Get all approved providers with details (with pagination support)
   * @param limit - Maximum number of providers to fetch per batch
   * @returns Array of approved provider information
   */
  async getApprovedProviders(limit: number = 50): Promise<ProviderInfo[]> {
    const approvedIds = await this.warmStorage.getApprovedProviderIds()

    // For small sets, use batch fetch
    if (approvedIds.length <= limit) {
      return await this.spRegistry.getProviders(approvedIds)
    }

    // For large sets, use paginated fetch
    const allProviders: ProviderInfo[] = []
    let offset = 0
    while (offset < approvedIds.length) {
      const batch = approvedIds.slice(offset, offset + limit)
      const providers = await this.spRegistry.getProviders(batch)
      allProviders.push(...providers)
      offset += limit
    }
    return allProviders
  }

  /**
   * Get specific approved provider by ID
   * @param providerId - Provider ID to fetch
   * @returns Provider info if approved, null otherwise
   */
  async getApprovedProvider(providerId: number): Promise<ProviderInfo | null> {
    const isApproved = await this.warmStorage.isProviderIdApproved(providerId)
    if (!isApproved) return null
    return await this.spRegistry.getProvider(providerId)
  }

  /**
   * Get multiple approved providers by IDs efficiently using Multicall3
   * @param providerIds - Array of provider IDs to fetch
   * @returns Array of approved provider info (null entries for unapproved/missing providers)
   */
  async getApprovedProvidersByIds(providerIds: number[]): Promise<(ProviderInfo | null)[]> {
    if (providerIds.length === 0) return []

    try {
      // Get provider to access network
      const provider = this.warmStorage.getProvider()
      const network = await getFilecoinNetworkType(provider)
      const multicall3Address = CONTRACT_ADDRESSES.MULTICALL3[network]

      // Create Multicall3 contract instance
      const multicall = new ethers.Contract(multicall3Address, CONTRACT_ABIS.MULTICALL3, provider)

      // Get WarmStorage view contract address
      const warmStorageViewAddress = this.warmStorage.getViewContractAddress()

      // Create interface for encoding/decoding
      const iface = new ethers.Interface(CONTRACT_ABIS.WARM_STORAGE_VIEW)

      // Prepare calls to check approval status for each provider
      const approvalCalls = providerIds.map((id) => ({
        target: warmStorageViewAddress,
        allowFailure: true,
        callData: iface.encodeFunctionData('isProviderApproved', [id]),
      }))

      // Execute multicall for approval checks
      const approvalResults = await multicall.aggregate3.staticCall(approvalCalls)

      // Decode approval results
      const approvalChecks = approvalResults.map((result: any) => {
        if (!result.success) return false
        try {
          const decoded = iface.decodeFunctionResult('isProviderApproved', result.returnData)
          return decoded[0] as boolean
        } catch {
          return false
        }
      })

      // Get only approved provider IDs
      const approvedIds = providerIds.filter((_, index) => approvalChecks[index])

      if (approvedIds.length === 0) {
        return providerIds.map(() => null)
      }

      // Batch fetch all approved providers
      const providers = await this.spRegistry.getProviders(approvedIds)

      // Create a map for quick lookup
      const providerMap = new Map<number, ProviderInfo>()
      for (const provider of providers) {
        providerMap.set(provider.id, provider)
      }

      // Return results in the same order as input, with null for unapproved
      return providerIds.map((id, index) => {
        if (!approvalChecks[index]) return null
        return providerMap.get(id) ?? null
      })
    } catch {
      // Fallback to individual calls if Multicall3 fails (e.g., in tests)
      const approvalChecks = await Promise.all(providerIds.map((id) => this.warmStorage.isProviderIdApproved(id)))

      const approvedIds = providerIds.filter((_, index) => approvalChecks[index])

      if (approvedIds.length === 0) {
        return providerIds.map(() => null)
      }

      const providers = await this.spRegistry.getProviders(approvedIds)
      const providerMap = new Map<number, ProviderInfo>()
      for (const provider of providers) {
        providerMap.set(provider.id, provider)
      }

      return providerIds.map((id, index) => {
        if (!approvalChecks[index]) return null
        return providerMap.get(id) ?? null
      })
    }
  }

  /**
   * Find approved provider by address
   * @param address - Provider address to find
   * @returns Provider info if found and approved, null otherwise
   */
  async getApprovedProviderByAddress(address: string): Promise<ProviderInfo | null> {
    const provider = await this.spRegistry.getProviderByAddress(address)
    if (provider == null) return null

    const isApproved = await this.warmStorage.isProviderIdApproved(provider.id)
    return isApproved ? provider : null
  }

  /**
   * Check if a provider is registered and approved
   * @param providerId - Provider ID to check
   * @returns True if provider exists and is approved
   */
  async isProviderApproved(providerId: number): Promise<boolean> {
    // First check if approved in WarmStorage
    const isApproved = await this.warmStorage.isProviderIdApproved(providerId)
    if (!isApproved) return false

    // Then verify provider exists and is active in registry
    const isActive = await this.spRegistry.isProviderActive(providerId)
    return isActive
  }
}
