/**
 * SPRegistryService - Service for interacting with ServiceProviderRegistry contract
 *
 * Manages service provider registration, product offerings, and provider queries.
 * Handles encoding/decoding of product data internally.
 *
 * @example
 * ```typescript
 * import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'
 *
 * const spRegistry = await SPRegistryService.create(provider, registryAddress)
 *
 * // Register as a provider
 * const tx = await spRegistry.registerProvider(signer, {
 *   name: 'My Storage Service',
 *   description: 'Fast and reliable storage',
 *   pdpOffering: { ... }
 * })
 *
 * // Query providers
 * const providers = await spRegistry.getAllActiveProviders()
 * ```
 */

import type { Chain } from '@filoz/synapse-core/chains'
import * as SP from '@filoz/synapse-core/sp-registry'
import { shuffle } from '@filoz/synapse-core/utils'
import type { Account, Address, Client, Hash, Transport } from 'viem'
import {
  type PDPOffering,
  PRODUCTS,
  type ProductType,
  type ProviderFilterOptions,
  type ProviderRegistrationInfo,
} from './types.ts'

export class SPRegistryService {
  private readonly _client: Client<Transport, Chain>

  /**
   * Constructor for SPRegistryService
   */
  constructor(client: Client<Transport, Chain>) {
    this._client = client
  }

  /**
   * Create a new SPRegistryService instance
   */
  static async create(client: Client<Transport, Chain>): Promise<SPRegistryService> {
    return new SPRegistryService(client)
  }

  // ========== Provider Management ==========

  /**
   * Register as a new service provider with optional PDP product
   * @param client - Client to use for the transaction
   * @param info - Provider registration information
   * @returns Transaction hash
   *
   * @example
   * ```ts
   * const hash = await spRegistry.registerProvider(client, {
   *   payee: '0x...', // Address that will receive payments
   *   name: 'My Storage Provider',
   *   description: 'High-performance storage service',
   *   pdpOffering: {
   *     serviceURL: 'https://provider.example.com',
   *     minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
   *     maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
   *     // ... other PDP fields
   *   },
   *   capabilities: { 'region': 'us-east', 'tier': 'premium' }
   * })
   *
   * console.log(hash)
   * ```
   */
  async registerProvider(client: Client<Transport, Chain, Account>, info: ProviderRegistrationInfo): Promise<Hash> {
    const hash = await SP.registerProvider(client, {
      payee: info.payee,
      name: info.name,
      description: info.description,
      pdpOffering: info.pdpOffering,
      capabilities: info.capabilities,
    })

    return hash
  }

  /**
   * Update provider information
   * @param client - Client to use for the transaction
   * @param name - New name
   * @param description - New description
   * @returns Transaction response
   */
  async updateProviderInfo(
    client: Client<Transport, Chain, Account>,
    name: string,
    description: string
  ): Promise<Hash> {
    return SP.updateProviderInfo(client, { name, description })
  }

  /**
   * Remove provider registration
   * @param client - Client to use for the transaction
   * @returns Transaction response
   */
  async removeProvider(client: Client<Transport, Chain, Account>): Promise<Hash> {
    return SP.removeProvider(client)
  }

  // ========== Provider Queries ==========

  /**
   * Get provider information by ID
   * @param providerId - Provider ID
   * @returns Provider info with decoded products
   */
  async getProvider(providerId: bigint): Promise<SP.getPDPProvider.OutputType | null> {
    try {
      return await SP.getPDPProvider(this._client, { providerId })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Provider not found')) {
        return null
      }
      throw error
    }
  }

  /**
   * Get provider information by address
   * @param address - Provider address
   * @returns Provider info with decoded products
   */
  async getProviderByAddress(address: Address): Promise<SP.getPDPProvider.OutputType | null> {
    const providerId = await SP.getProviderIdByAddress(this._client, { providerAddress: address })
    if (providerId === 0n) {
      return null
    }

    return this.getProvider(providerId)
  }

  /**
   * Get provider ID by address
   * @param address - Provider address
   * @returns Provider ID (0 if not found)
   */
  async getProviderIdByAddress(address: Address): Promise<bigint> {
    return SP.getProviderIdByAddress(this._client, { providerAddress: address })
  }

  /**
   * Get all active providers (handles pagination internally)
   * @returns List of all active providers
   */
  async getAllActiveProviders(): Promise<SP.PDPProvider[]> {
    const providers: SP.PDPProvider[] = []
    const limit = 50n // Fetch 50 providers at a time (conservative for multicall limits)
    let offset = 0n
    let hasMore = true

    // Loop through all pages and start fetching
    while (hasMore) {
      const result = await SP.getPDPProviders(this._client, {
        onlyActive: true,
        offset,
        limit,
      })
      providers.push(...result.providers)
      hasMore = result.hasMore

      offset += limit
    }

    return providers
  }

  /**
   * Get active providers by product type (handles pagination internally)
   * @param productType - Product type to filter by
   * @returns List of providers with specified product type
   */
  async getActiveProvidersByProductType(productType: ProductType): Promise<SP.ProviderWithProduct[]> {
    const providers: SP.ProviderWithProduct[] = []

    const limit = 50n // Fetch in batches (conservative for multicall limits)
    let offset = 0n
    let hasMore = true

    // Loop through all pages and start fetching provider details in parallel
    while (hasMore) {
      const result = await SP.getProvidersByProductType(this._client, {
        productType,
        onlyActive: true,
        offset,
        limit,
      })
      providers.push(...result.providers)

      hasMore = result.hasMore
      offset += limit
    }

    // Wait for all provider details to be fetched and flatten the results
    return providers
  }

  /**
   * Check if provider is active
   * @param providerId - Provider ID
   * @returns Whether provider is active
   */
  async isProviderActive(providerId: bigint): Promise<boolean> {
    return SP.isProviderActive(this._client, { providerId })
  }

  /**
   * Check if address is a registered provider
   * @param address - Address to check
   * @returns Whether address is registered
   */
  async isRegisteredProvider(address: Address): Promise<boolean> {
    return SP.isRegisteredProvider(this._client, { provider: address })
  }

  /**
   * Get total number of providers
   * @returns Total provider count
   */
  async getProviderCount(): Promise<bigint> {
    return SP.getProviderCount(this._client)
  }

  /**
   * Get number of active providers
   * @returns Active provider count
   */
  async activeProviderCount(): Promise<bigint> {
    return SP.activeProviderCount(this._client)
  }

  // ========== Product Management ==========

  /**
   * Add PDP product to provider
   * @param client - Client to use for the transaction
   * @param pdpOffering - PDP offering details
   * @param capabilities - Optional capability keys
   * @returns Transaction hash
   */
  async addPDPProduct(
    client: Client<Transport, Chain, Account>,
    pdpOffering: PDPOffering,
    capabilities: Record<string, string> = {}
  ): Promise<Hash> {
    const hash = await SP.addProduct(client, {
      pdpOffering,
      capabilities,
    })

    return hash
  }

  /**
   * Update PDP product with capabilities
   * @param client - Client to use for the transaction
   * @param pdpOffering - Updated PDP offering
   * @param capabilities - Updated capability key-value pairs
   * @returns Transaction hash
   */
  async updatePDPProduct(
    client: Client<Transport, Chain, Account>,
    pdpOffering: PDPOffering,
    capabilities: Record<string, string> = {}
  ): Promise<Hash> {
    const hash = await SP.updateProduct(client, {
      pdpOffering,
      capabilities,
    })

    return hash
  }

  /**
   * Remove product from provider
   * @param client - Client to use for the transaction
   * @param productType - Type of product to remove
   * @returns Transaction hash
   */
  async removeProduct(client: Client<Transport, Chain, Account>, productType: ProductType): Promise<Hash> {
    const hash = await SP.removeProduct(client, {
      productType,
    })

    return hash
  }

  // ========== Batch Operations ==========

  /**
   * Get multiple providers by IDs using Multicall3 for efficiency
   * @param providerIds - Array of provider IDs
   * @returns Array of provider info
   */
  async getProviders(providerIds: bigint[]): Promise<SP.PDPProvider[]> {
    if (providerIds.length === 0) {
      return []
    }

    return SP.getPDPProvidersByIds(this._client, {
      providerIds,
    })
  }

  /**
   * Filter providers based on criteria
   * @param filter - Filtering options
   * @returns Filtered list of providers
   */
  async filterProviders(filter?: ProviderFilterOptions): Promise<SP.PDPProvider[]> {
    const providers = await this.getAllActiveProviders()
    if (!filter) return providers

    if (filter.type !== undefined) {
      const requestedTypeValue = PRODUCTS[filter.type]
      if (requestedTypeValue === undefined) {
        return [] // Invalid product type
      }
    }

    const typeKey = (filter.type ?? 'PDP').toLowerCase()

    const result = providers.filter((d) => {
      switch (typeKey) {
        case 'pdp': {
          const offering = d[typeKey as keyof typeof d] as PDPOffering
          return (
            (!filter.location || offering.location?.toLowerCase().includes(filter.location.toLowerCase())) &&
            (filter.minPieceSizeInBytes === undefined ||
              offering.maxPieceSizeInBytes >= BigInt(filter.minPieceSizeInBytes)) &&
            (filter.maxPieceSizeInBytes === undefined ||
              offering.minPieceSizeInBytes <= BigInt(filter.maxPieceSizeInBytes)) &&
            (filter.ipniIpfs === undefined || offering.ipniIpfs === filter.ipniIpfs) &&
            (filter.ipniPiece === undefined || offering.ipniPiece === filter.ipniPiece) &&
            (filter.maxStoragePricePerTibPerDay === undefined ||
              offering.storagePricePerTibPerDay <= BigInt(filter.maxStoragePricePerTibPerDay)) &&
            (filter.minProvingPeriodInEpochs === undefined ||
              offering.minProvingPeriodInEpochs >= BigInt(filter.minProvingPeriodInEpochs))
          )
        }
        default:
          return false // Unsupported product type
      }
    })

    return filter.randomize ? shuffle(result) : result
  }
}
