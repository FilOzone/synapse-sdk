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
 * const spRegistry = SPRegistryService.create({ account })
 *
 * // Register as a provider
 * const tx = await spRegistry.registerProvider({
 *   info: {
 *     name: 'My Storage Service',
 *     description: 'Fast and reliable storage',
 *     pdpOffering: { ... }
 *   }
 * })
 *
 * // Query providers
 * const providers = await spRegistry.getAllActiveProviders()
 * ```
 */

import * as SP from '@filoz/synapse-core/sp-registry'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  createClient,
  type Hash,
  http,
  type Transport,
} from 'viem'
import { DEFAULT_CHAIN } from '../utils/constants.ts'
import type { PDPOffering, ProductType, ProviderRegistrationInfo } from './types.ts'

export class SPRegistryService {
  private readonly _client: Client<Transport, Chain, Account>

  /**
   * Constructor for SPRegistryService
   * @param options - Options for the SPRegistryService
   * @param options.client - Wallet client used for read and write operations
   */
  constructor(options: { client: Client<Transport, Chain, Account> }) {
    this._client = options.client
  }

  /**
   * Create a new SPRegistryService instance
   * @param options - Options for the SPRegistryService
   * @param options.transport - Viem transport (optional, defaults to http())
   * @param options.chain - Filecoin chain (optional, defaults to {@link DEFAULT_CHAIN})
   * @param options.account - Viem account (required)
   */
  static create(options: { transport?: Transport; chain?: Chain; account: Account }): SPRegistryService {
    const client = createClient({
      chain: options.chain ?? DEFAULT_CHAIN,
      transport: options.transport ?? http(),
      account: options.account,
      name: 'SPRegistryService',
      key: 'sp-registry-service',
    })

    if (client.account.type === 'json-rpc' && client.transport.type !== 'custom') {
      throw new Error('Transport must be a custom transport. See https://viem.sh/docs/clients/transports/custom.')
    }
    return new SPRegistryService({ client })
  }

  // ========== Provider Management ==========

  /**
   * Register as a new service provider with optional PDP product
   * @param options - Options for provider registration
   * @param options.info - Provider registration information
   * @returns Transaction hash
   *
   * @example
   * ```ts
   * const hash = await spRegistry.registerProvider({
   *   info: {
   *     payee: '0x...', // Address that will receive payments
   *     name: 'My Storage Provider',
   *     description: 'High-performance storage service',
   *     pdpOffering: {
   *       serviceURL: 'https://provider.example.com',
   *       minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
   *       maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
   *       // ... other PDP fields
   *     },
   *     capabilities: { 'region': 'us-east', 'tier': 'premium' }
   *   }
   * })
   *
   * console.log(hash)
   * ```
   */
  async registerProvider(options: { info: ProviderRegistrationInfo }): Promise<Hash> {
    const hash = await SP.registerProvider(this._client, {
      payee: options.info.payee,
      name: options.info.name,
      description: options.info.description,
      pdpOffering: options.info.pdpOffering,
      capabilities: options.info.capabilities,
    })

    return hash
  }

  /**
   * Update provider information
   * @param options - Options for provider info updates
   * @param options.name - New name
   * @param options.description - New description
   * @returns Transaction response
   */
  async updateProviderInfo(options: { name: string; description: string }): Promise<Hash> {
    return SP.updateProviderInfo(this._client, {
      name: options.name,
      description: options.description,
    })
  }

  /**
   * Remove provider registration
   * @returns Transaction response
   */
  async removeProvider(): Promise<Hash> {
    return SP.removeProvider(this._client)
  }

  // ========== Provider Queries ==========

  /**
   * Get provider information by ID
   * @param options - Options for provider lookup
   * @param options.providerId - Provider ID
   * @returns Provider info with decoded products
   */
  async getProvider(options: { providerId: bigint }): Promise<SP.getPDPProvider.OutputType | null> {
    try {
      return await SP.getPDPProvider(this._client, { providerId: options.providerId })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Provider not found')) {
        return null
      }
      throw error
    }
  }

  /**
   * Get provider information by address
   * @param options - Options for provider lookup
   * @param options.address - Provider address
   * @returns Provider info with decoded products
   */
  async getProviderByAddress(options: { address: Address }): Promise<SP.getPDPProvider.OutputType | null> {
    const providerId = await SP.getProviderIdByAddress(this._client, { providerAddress: options.address })
    if (providerId === 0n) {
      return null
    }

    return this.getProvider({ providerId })
  }

  /**
   * Get provider ID by address
   * @param options - Options for provider ID lookup
   * @param options.address - Provider address
   * @returns Provider ID (0 if not found)
   */
  async getProviderIdByAddress(options: { address: Address }): Promise<bigint> {
    return SP.getProviderIdByAddress(this._client, { providerAddress: options.address })
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
   * @param options - Options for provider filtering
   * @param options.productType - Product type to filter by
   * @returns List of providers with specified product type
   */
  async getActiveProvidersByProductType(options: { productType: ProductType }): Promise<SP.ProviderWithProduct[]> {
    const providers: SP.ProviderWithProduct[] = []

    const limit = 50n // Fetch in batches (conservative for multicall limits)
    let offset = 0n
    let hasMore = true

    // Loop through all pages and start fetching provider details in parallel
    while (hasMore) {
      const result = await SP.getProvidersByProductType(this._client, {
        productType: options.productType,
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
   * @param options - Options for provider status lookup
   * @param options.providerId - Provider ID
   * @returns Whether provider is active
   */
  async isProviderActive(options: { providerId: bigint }): Promise<boolean> {
    return SP.isProviderActive(this._client, { providerId: options.providerId })
  }

  /**
   * Check if address is a registered provider
   * @param options - Options for provider registration lookup
   * @param options.address - Address to check
   * @returns Whether address is registered
   */
  async isRegisteredProvider(options: { address: Address }): Promise<boolean> {
    return SP.isRegisteredProvider(this._client, { provider: options.address })
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
   * @param options - Options for adding a PDP product
   * @param options.pdpOffering - PDP offering details
   * @param options.capabilities - Optional capability keys
   * @returns Transaction hash
   */
  async addPDPProduct(options: { pdpOffering: PDPOffering; capabilities?: Record<string, string> }): Promise<Hash> {
    const hash = await SP.addProduct(this._client, {
      pdpOffering: options.pdpOffering,
      capabilities: options.capabilities ?? {},
    })

    return hash
  }

  /**
   * Update PDP product with capabilities
   * @param options - Options for updating a PDP product
   * @param options.pdpOffering - Updated PDP offering
   * @param options.capabilities - Updated capability key-value pairs
   * @returns Transaction hash
   */
  async updatePDPProduct(options: { pdpOffering: PDPOffering; capabilities?: Record<string, string> }): Promise<Hash> {
    const hash = await SP.updateProduct(this._client, {
      pdpOffering: options.pdpOffering,
      capabilities: options.capabilities ?? {},
    })

    return hash
  }

  /**
   * Remove product from provider
   * @param options - Options for product removal
   * @param options.productType - Type of product to remove
   * @returns Transaction hash
   */
  async removeProduct(options: { productType: ProductType }): Promise<Hash> {
    const hash = await SP.removeProduct(this._client, {
      productType: options.productType,
    })

    return hash
  }

  // ========== Batch Operations ==========

  /**
   * Get multiple providers by IDs using Multicall3 for efficiency
   * @param options - Options for provider batch lookup
   * @param options.providerIds - Array of provider IDs
   * @returns Array of provider info
   */
  async getProviders(options: { providerIds: bigint[] }): Promise<SP.PDPProvider[]> {
    if (options.providerIds.length === 0) {
      return []
    }

    return SP.getPDPProvidersByIds(this._client, {
      providerIds: options.providerIds,
    })
  }
}
