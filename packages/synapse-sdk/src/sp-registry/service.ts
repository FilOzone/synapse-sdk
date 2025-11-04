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

import { capabilitiesListToObject, decodePDPCapabilities, encodePDPCapabilities } from '@filoz/synapse-core/utils'
import { ethers } from 'ethers'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from '../utils/constants.ts'
import { getFilecoinNetworkType } from '../utils/index.ts'
import type {
  PDPOffering,
  PDPServiceInfo,
  ProductType,
  ProviderInfo,
  ProviderRegistrationInfo,
  ServiceProduct,
} from './types.ts'

export class SPRegistryService {
  private readonly _provider: ethers.Provider
  private readonly _registryAddress: string
  private _registryContract: ethers.Contract | null = null

  /**
   * Constructor for SPRegistryService
   */
  constructor(provider: ethers.Provider, registryAddress: string) {
    this._provider = provider
    this._registryAddress = registryAddress
  }

  /**
   * Create a new SPRegistryService instance
   */
  static async create(provider: ethers.Provider, registryAddress: string): Promise<SPRegistryService> {
    return new SPRegistryService(provider, registryAddress)
  }

  /**
   * Get cached registry contract instance or create new one
   */
  private _getRegistryContract(): ethers.Contract {
    if (this._registryContract == null) {
      this._registryContract = new ethers.Contract(
        this._registryAddress,
        CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY,
        this._provider
      )
    }
    return this._registryContract
  }

  // ========== Provider Management ==========

  /**
   * Register as a new service provider with optional PDP product
   * @param signer - Signer to register as provider
   * @param info - Provider registration information
   * @returns Transaction response containing the provider ID
   *
   * @example
   * ```typescript
   * const tx = await spRegistry.registerProvider(signer, {
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
   * // Wait for transaction and get provider ID from event
   * const receipt = await tx.wait()
   * const event = receipt.logs.find(log =>
   *   log.topics[0] === ethers.id('ProviderRegistered(uint256,address,address)')
   * )
   * const providerId = event ? parseInt(event.topics[1], 16) : null
   * ```
   */
  async registerProvider(signer: ethers.Signer, info: ProviderRegistrationInfo): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract

    // Get registration fee
    const registrationFee = await contract.REGISTRATION_FEE()

    // Prepare product data and capabilities
    const productType = 0 // ProductType.PDP

    const [capabilityKeys, capabilityValues] = encodePDPCapabilities(info.pdpOffering, info.capabilities)

    // Register provider with all parameters in a single call
    const tx = await contract.registerProvider(
      info.payee,
      info.name,
      info.description,
      productType,
      capabilityKeys,
      capabilityValues,
      { value: registrationFee }
    )

    return tx
  }

  /**
   * Update provider information
   * @param signer - Provider's signer
   * @param name - New name
   * @param description - New description
   * @returns Transaction response
   */
  async updateProviderInfo(
    signer: ethers.Signer,
    name: string,
    description: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract
    return await contract.updateProviderInfo(name, description)
  }

  /**
   * Remove provider registration
   * @param signer - Provider's signer
   * @returns Transaction response
   */
  async removeProvider(signer: ethers.Signer): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract
    return await contract.removeProvider()
  }

  // ========== Provider Queries ==========

  /**
   * Get provider information by ID
   * @param providerId - Provider ID
   * @returns Provider info with decoded products
   */
  async getProvider(providerId: number): Promise<ProviderInfo | null> {
    try {
      const contract = this._getRegistryContract()
      // TODO: use getProviderWithProduct
      const rawProvider = await contract.getProvider(providerId)

      if (rawProvider.info.serviceProvider === ethers.ZeroAddress) {
        return null
      }

      // Get products for this provider
      const products = await this._getProviderProducts(providerId)

      return this._convertToProviderInfo(providerId, rawProvider.info, products)
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
  async getProviderByAddress(address: string): Promise<ProviderInfo | null> {
    try {
      const contract = this._getRegistryContract()
      const provider = await contract.getProviderByAddress(address)

      // Check if provider exists (beneficiary address will be zero if not found)
      if (provider.info.serviceProvider === ethers.ZeroAddress) {
        return null
      }

      // Get products for this provider and convert to ProviderInfo
      const products = await this._getProviderProducts(Number(provider.providerId))
      return this._convertToProviderInfo(Number(provider.providerId), provider.info, products)
    } catch (error) {
      console.warn('Error fetching provider by address:', error)
      return null
    }
  }

  /**
   * Get provider ID by address
   * @param address - Provider address
   * @returns Provider ID (0 if not found)
   */
  async getProviderIdByAddress(address: string): Promise<number> {
    const contract = this._getRegistryContract()
    const id = await contract.getProviderIdByAddress(address)
    return Number(id)
  }

  /**
   * Get all active providers (handles pagination internally)
   * @returns List of all active providers
   */
  async getAllActiveProviders(): Promise<ProviderInfo[]> {
    const contract = this._getRegistryContract()
    const providerPromises: Promise<ProviderInfo[]>[] = []
    const pageSize = 50 // Fetch 50 providers at a time (conservative for multicall limits)
    let offset = 0
    let hasMore = true

    // Loop through all pages and start fetching provider details in parallel
    while (hasMore) {
      const result = await contract.getAllActiveProviders(offset, pageSize)
      const providerIds = result[0] // First element is the array of provider IDs
      hasMore = result[1] // Second element is the hasMore flag

      // Convert BigInt IDs to numbers and start fetching provider details
      if (providerIds.length > 0) {
        const ids = providerIds.map((id: bigint) => Number(id))
        providerPromises.push(this.getProviders(ids))
      }

      offset += pageSize
    }

    // Wait for all provider details to be fetched and flatten the results
    const providerBatches = await Promise.all(providerPromises)
    return providerBatches.flat()
  }

  /**
   * Get active providers by product type (handles pagination internally)
   * @param productType - Product type to filter by
   * @returns List of providers with specified product type
   */
  async getActiveProvidersByProductType(productType: ProductType): Promise<ProviderInfo[]> {
    const contract = this._getRegistryContract()
    const providerPromises: Promise<ProviderInfo[]>[] = []

    let offset = 0
    const limit = 50 // Fetch in batches (conservative for multicall limits)
    let hasMore = true

    // Loop through all pages and start fetching provider details in parallel
    while (hasMore) {
      const result = await contract.getProvidersByProductType(productType, true, offset, limit)

      // Convert BigInt IDs to numbers and start fetching provider details
      if (result.providerIds.length > 0) {
        const ids = result.providerIds.map((id: bigint) => Number(id))
        providerPromises.push(this.getProviders(ids))
      }

      hasMore = result.hasMore
      offset += limit
    }

    // Wait for all provider details to be fetched and flatten the results
    const providerBatches = await Promise.all(providerPromises)
    const allProviders = providerBatches.flat()

    return allProviders
  }

  /**
   * Check if provider is active
   * @param providerId - Provider ID
   * @returns Whether provider is active
   */
  async isProviderActive(providerId: number): Promise<boolean> {
    const contract = this._getRegistryContract()
    return await contract.isProviderActive(providerId)
  }

  /**
   * Check if address is a registered provider
   * @param address - Address to check
   * @returns Whether address is registered
   */
  async isRegisteredProvider(address: string): Promise<boolean> {
    const contract = this._getRegistryContract()
    return await contract.isRegisteredProvider(address)
  }

  /**
   * Get total number of providers
   * @returns Total provider count
   */
  async getProviderCount(): Promise<number> {
    const contract = this._getRegistryContract()
    const count = await contract.getProviderCount()
    return Number(count)
  }

  /**
   * Get number of active providers
   * @returns Active provider count
   */
  async activeProviderCount(): Promise<number> {
    const contract = this._getRegistryContract()
    const count = await contract.activeProviderCount()
    return Number(count)
  }

  // ========== Product Management ==========

  /**
   * Add PDP product to provider
   * @param signer - Provider's signer
   * @param pdpOffering - PDP offering details
   * @param capabilities - Optional capability keys
   * @returns Transaction response
   */
  async addPDPProduct(
    signer: ethers.Signer,
    pdpOffering: PDPOffering,
    capabilities: Record<string, string> = {}
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract

    // Encode PDP offering
    const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering, capabilities)

    // Add product
    return await contract.addProduct(
      0, // ProductType.PDP
      capabilityKeys,
      capabilityValues
    )
  }

  /**
   * Update PDP product with capabilities
   * @param signer - Provider's signer
   * @param pdpOffering - Updated PDP offering
   * @param capabilities - Updated capability key-value pairs
   * @returns Transaction response
   */
  async updatePDPProduct(
    signer: ethers.Signer,
    pdpOffering: PDPOffering,
    capabilities: Record<string, string> = {}
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract

    // Encode PDP offering
    const [capabilityKeys, capabilityValues] = encodePDPCapabilities(pdpOffering, capabilities)

    // Update product
    return await contract.updateProduct(
      0, // ProductType.PDP
      capabilityKeys,
      capabilityValues
    )
  }

  /**
   * Remove product from provider
   * @param signer - Provider's signer
   * @param productType - Type of product to remove
   * @returns Transaction response
   */
  async removeProduct(signer: ethers.Signer, productType: ProductType): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract
    return await contract.removeProduct(productType)
  }

  /**
   * Get PDP service info for a provider
   * @param providerId - Provider ID
   * @returns PDP service info or null if not found
   */
  async getPDPService(providerId: number): Promise<PDPServiceInfo | null> {
    try {
      const contract = this._getRegistryContract()
      const result = await contract.getProviderWithProduct(providerId, 0) // 0 = ProductType.PDP

      // This also handles the case where the product does not exist
      if (!result.product.isActive) {
        return null
      }

      const capabilities = capabilitiesListToObject(result.product.capabilityKeys, result.productCapabilityValues)

      return {
        offering: decodePDPCapabilities(capabilities),
        capabilities,
        isActive: result.product.isActive,
      }
    } catch {
      return null
    }
  }

  /**
   * Check if provider has a specific product type
   * @param providerId - Provider ID
   * @param productType - Product type to check
   * @returns Whether provider has the product
   */
  async providerHasProduct(providerId: number, productType: ProductType): Promise<boolean> {
    const contract = this._getRegistryContract()
    return await contract.providerHasProduct(providerId, productType)
  }

  // ========== Batch Operations ==========

  /**
   * Get multiple providers by IDs using Multicall3 for efficiency
   * @param providerIds - Array of provider IDs
   * @returns Array of provider info
   */
  async getProviders(providerIds: number[]): Promise<ProviderInfo[]> {
    if (providerIds.length === 0) {
      return []
    }

    try {
      // Use Multicall3 for efficiency
      const result = await this._getProvidersWithMulticall(providerIds)
      return result
    } catch (_error) {
      // TODO: Remove this fallback block and properly mock Multicall3 in tests
      // The fallback is only needed because SPRegistryService tests don't currently
      // mock Multicall3 calls. Once proper test infrastructure is in place, this
      // try/catch and the _getProvidersIndividually method can be removed.
      // Fall back to individual calls if Multicall3 fails
      const result = await this._getProvidersIndividually(providerIds)
      return result
    }
  }

  /**
   * Get providers using Multicall3 for batch efficiency
   */
  private async _getProvidersWithMulticall(providerIds: number[]): Promise<ProviderInfo[]> {
    const network = await getFilecoinNetworkType(this._provider)
    const multicall3Address = CONTRACT_ADDRESSES.MULTICALL3[network]
    const multicall = new ethers.Contract(multicall3Address, CONTRACT_ABIS.MULTICALL3, this._provider)
    const iface = new ethers.Interface(CONTRACT_ABIS.SERVICE_PROVIDER_REGISTRY)

    // Prepare multicall batch
    const calls = this._prepareMulticallCalls(providerIds, iface)

    // Execute multicall
    const results = await multicall.aggregate3.staticCall(calls)

    // Process results
    return this._processMulticallResults(providerIds, results, iface)
  }

  /**
   * Prepare calls for Multicall3 batch
   */
  private _prepareMulticallCalls(
    providerIds: number[],
    iface: ethers.Interface
  ): Array<{ target: string; allowFailure: boolean; callData: string }> {
    const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = []

    for (const id of providerIds) {
      // Add getProviderWithProduct call
      calls.push({
        target: this._registryAddress,
        allowFailure: true,
        callData: iface.encodeFunctionData('getProviderWithProduct', [id, 0]),
      })
    }

    return calls
  }

  /**
   * Process Multicall3 results into ProviderInfo array
   */
  private _processMulticallResults(providerIds: number[], results: any[], iface: ethers.Interface): ProviderInfo[] {
    const providers: ProviderInfo[] = []

    for (let i = 0; i < providerIds.length; i++) {
      if (!results[i].success) {
        continue
      }

      try {
        const [, rawProvider, product, productCapabilityValues] = iface.decodeFunctionResult(
          'getProviderWithProduct',
          results[i].returnData
        )[0]

        const capabilities = capabilitiesListToObject(product.capabilityKeys, productCapabilityValues)
        // Convert to ProviderInfo
        const providerInfo = this._convertToProviderInfo(providerIds[i], rawProvider, [
          {
            type: 'PDP',
            isActive: product.isActive,
            capabilities,
            data: decodePDPCapabilities(capabilities),
          },
        ])
        if (providerInfo.serviceProvider === ethers.ZeroAddress) {
          continue
        }
        providers.push(providerInfo)
      } catch {
        // Skip failed decoding
      }
    }

    return providers
  }

  /**
   * Fallback method to get providers individually
   */
  private async _getProvidersIndividually(providerIds: number[]): Promise<ProviderInfo[]> {
    const providers: ProviderInfo[] = []
    const promises = providerIds.map((id) => this.getProvider(id))
    const results = await Promise.all(promises)

    for (const provider of results) {
      if (provider != null) {
        providers.push(provider)
      }
    }

    return providers
  }

  // ========== Internal Helpers ==========

  /**
   * Get products for a provider
   * @param providerId - Provider ID
   * @returns Array of decoded service products
   */
  private async _getProviderProducts(providerId: number): Promise<ServiceProduct[]> {
    const products: ServiceProduct[] = []

    // Get PDP product directly - getPDPService returns null if product doesn't exist
    const pdpService = await this.getPDPService(providerId)
    if (pdpService != null) {
      products.push({
        type: 'PDP',
        isActive: pdpService.isActive,
        capabilities: pdpService.capabilities,
        data: pdpService.offering,
      })
    }

    // Future: Add other product types here

    return products
  }

  /**
   * Convert raw provider data to ProviderInfo
   */
  private _convertToProviderInfo(providerId: number, providerInfo: any, productsArray: ServiceProduct[]): ProviderInfo {
    // Convert products array to Record for direct access by type
    const products: Partial<Record<'PDP', ServiceProduct>> = {}

    for (const product of productsArray) {
      if (product.type === 'PDP') {
        products.PDP = product
      }
    }

    return {
      id: providerId,
      serviceProvider: providerInfo.serviceProvider,
      payee: providerInfo.payee,
      name: providerInfo.name,
      description: providerInfo.description,
      active: providerInfo.isActive,
      products,
    }
  }
}
