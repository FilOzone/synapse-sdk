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

import { ethers } from 'ethers'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from '../utils/constants.js'
import { getFilecoinNetworkType } from '../utils/index.js'
import type {
  PDPOffering,
  PDPServiceInfo,
  ProductType,
  ProviderInfo,
  ProviderRegistrationInfo,
  ServiceProduct,
} from './types.js'

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
   *   name: 'My Storage Provider',
   *   description: 'High-performance storage service',
   *   pdpOffering: {
   *     serviceURL: 'https://provider.example.com',
   *     minPieceSizeInBytes: BigInt(1024),
   *     maxPieceSizeInBytes: BigInt(1024 * 1024 * 1024),
   *     // ... other PDP fields
   *   },
   *   capabilities: { 'region': 'us-east', 'tier': 'premium' }
   * })
   *
   * // Wait for transaction and get provider ID from event
   * const receipt = await tx.wait()
   * const event = receipt.logs.find(log =>
   *   log.topics[0] === ethers.id('ProviderRegistered(uint256,address,uint256)')
   * )
   * const providerId = event ? parseInt(event.topics[1], 16) : null
   * ```
   */
  async registerProvider(signer: ethers.Signer, info: ProviderRegistrationInfo): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract

    // Get registration fee
    const registrationFee = await contract.REGISTRATION_FEE()

    // Prepare product data and capabilities
    let productType = 0 // No product
    let productData = '0x'
    let capabilityKeys: string[] = []
    let capabilityValues: string[] = []

    if (info.pdpOffering != null) {
      productType = 0 // ProductType.PDP
      productData = await this.encodePDPOffering(info.pdpOffering)

      // Convert capabilities object to key/value arrays
      if (info.capabilities != null) {
        capabilityKeys = []
        capabilityValues = []
        for (const [key, value] of Object.entries(info.capabilities)) {
          capabilityKeys.push(key)
          capabilityValues.push(value ?? '') // Normalize falsy/undefined to empty string
        }
      }
    }

    // Register provider with all parameters in a single call
    const tx = await contract.registerProvider(
      info.name,
      info.description,
      productType,
      productData,
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

  /**
   * Transfer provider beneficiary to new address
   * @param signer - Current beneficiary's signer
   * @param newBeneficiary - New beneficiary address
   * @returns Transaction response
   */
  async transferProviderBeneficiary(
    signer: ethers.Signer,
    newBeneficiary: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getRegistryContract().connect(signer) as ethers.Contract
    return await contract.transferProviderBeneficiary(newBeneficiary)
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
      const rawProvider = await contract.getProvider(providerId)

      if (rawProvider.beneficiary === ethers.ZeroAddress) {
        return null
      }

      // Get products for this provider
      const products = await this._getProviderProducts(providerId)

      return this._convertToProviderInfo(providerId, rawProvider, products)
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

      // Get provider info and ID in parallel
      const [rawProvider, providerId] = await Promise.all([
        contract.getProviderByAddress(address),
        contract.getProviderIdByAddress(address),
      ])

      // Check if provider exists (beneficiary address will be zero if not found)
      if (rawProvider.beneficiary === ethers.ZeroAddress) {
        return null
      }

      // Get products for this provider
      const products = await this._getProviderProducts(Number(providerId))

      // Convert to ProviderInfo
      return this._convertToProviderInfo(Number(providerId), rawProvider, products)
    } catch {
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
      const result = await contract.getProvidersByProductType(productType, offset, limit)

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

    // Filter to only active providers (getProvidersByProductType may include inactive ones)
    return allProviders.filter((provider) => provider.active)
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
    const encodedOffering = await this.encodePDPOffering(pdpOffering)

    // Convert capabilities object to arrays
    const entries = Object.entries(capabilities)
    const capabilityKeys = entries.map(([key]) => key)
    const capabilityValues = entries.map(([, value]) => value || '') // Handle empty values

    // Add product
    return await contract.addProduct(
      0, // ProductType.PDP
      encodedOffering,
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
    const encodedOffering = await this.encodePDPOffering(pdpOffering)

    // Convert capabilities object to arrays
    const entries = Object.entries(capabilities)
    const capabilityKeys = entries.map(([key]) => key)
    const capabilityValues = entries.map(([, value]) => value || '') // Handle empty values

    // Update product
    return await contract.updateProduct(
      0, // ProductType.PDP
      encodedOffering,
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
      const result = await contract.getPDPService(providerId)

      // Check if product actually exists (Solidity returns empty values if no product)
      // If serviceURL is empty, the product doesn't exist
      if (!result.pdpOffering.serviceURL) {
        return null
      }

      return {
        offering: {
          serviceURL: result.pdpOffering.serviceURL,
          minPieceSizeInBytes: result.pdpOffering.minPieceSizeInBytes,
          maxPieceSizeInBytes: result.pdpOffering.maxPieceSizeInBytes,
          ipniPiece: result.pdpOffering.ipniPiece,
          ipniIpfs: result.pdpOffering.ipniIpfs,
          storagePricePerTibPerMonth: result.pdpOffering.storagePricePerTibPerMonth,
          minProvingPeriodInEpochs: Number(result.pdpOffering.minProvingPeriodInEpochs),
          location: result.pdpOffering.location,
          paymentTokenAddress: result.pdpOffering.paymentTokenAddress,
        },
        capabilities: this._convertCapabilitiesToObject(result.capabilityKeys, result.capabilityValues || []),
        isActive: result.isActive,
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
      return await this._getProvidersWithMulticall(providerIds)
    } catch {
      // TODO: Remove this fallback block and properly mock Multicall3 in tests
      // The fallback is only needed because SPRegistryService tests don't currently
      // mock Multicall3 calls. Once proper test infrastructure is in place, this
      // try/catch and the _getProvidersIndividually method can be removed.
      // Fall back to individual calls if Multicall3 fails
      return await this._getProvidersIndividually(providerIds)
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
      // Add getProvider call
      calls.push({
        target: this._registryAddress,
        allowFailure: true,
        callData: iface.encodeFunctionData('getProvider', [id]),
      })
      // Add getPDPService call
      calls.push({
        target: this._registryAddress,
        allowFailure: true,
        callData: iface.encodeFunctionData('getPDPService', [id]),
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
      const providerResultIndex = i * 2
      const pdpServiceResultIndex = i * 2 + 1

      if (!results[providerResultIndex].success) {
        continue
      }

      try {
        const decoded = iface.decodeFunctionResult('getProvider', results[providerResultIndex].returnData)
        const rawProvider = decoded[0]

        // Process PDP service if available
        const products = this._extractProductsFromMulticallResult(results[pdpServiceResultIndex], iface)

        // Convert to ProviderInfo
        const providerInfo = this._convertToProviderInfo(providerIds[i], rawProvider, products)
        providers.push(providerInfo)
      } catch {
        // Skip failed decoding
      }
    }

    return providers
  }

  /**
   * Extract products from multicall PDP service result
   */
  private _extractProductsFromMulticallResult(pdpServiceResult: any, iface: ethers.Interface): ServiceProduct[] {
    const products: ServiceProduct[] = []

    if (!pdpServiceResult.success) {
      return products
    }

    try {
      const pdpDecoded = iface.decodeFunctionResult('getPDPService', pdpServiceResult.returnData)

      // getPDPService returns a tuple of (pdpOffering, capabilityKeys, isActive)
      const [pdpOffering, capabilityKeys, isActive] = pdpDecoded

      // Check if product actually exists (serviceURL is the first element)
      if (!pdpOffering[0]) {
        return products
      }

      // Build capabilities object
      const capabilities = this._buildCapabilitiesFromKeys(capabilityKeys)

      // Build PDP product
      products.push({
        type: 'PDP',
        isActive,
        capabilities,
        data: {
          serviceURL: pdpOffering[0],
          minPieceSizeInBytes: pdpOffering[1],
          maxPieceSizeInBytes: pdpOffering[2],
          ipniPiece: pdpOffering[3],
          ipniIpfs: pdpOffering[4],
          storagePricePerTibPerMonth: pdpOffering[5],
          minProvingPeriodInEpochs: Number(pdpOffering[6]),
          location: pdpOffering[7],
          paymentTokenAddress: pdpOffering[8],
        },
      })
    } catch {
      // Skip if PDP service decoding fails
    }

    return products
  }

  /**
   * Build capabilities object from keys array
   */
  private _buildCapabilitiesFromKeys(capabilityKeys: any): Record<string, string> {
    const capabilities: Record<string, string> = {}

    if (capabilityKeys && Array.isArray(capabilityKeys)) {
      for (const key of capabilityKeys) {
        // For getPDPService, capabilities are returned as keys only
        // Values would need to be fetched separately if needed
        capabilities[key] = ''
      }
    }

    return capabilities
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
  private _convertToProviderInfo(providerId: number, rawProvider: any, productsArray: ServiceProduct[]): ProviderInfo {
    // Convert products array to Record for direct access by type
    const products: Partial<Record<'PDP', ServiceProduct>> = {}

    for (const product of productsArray) {
      if (product.type === 'PDP') {
        products.PDP = product
      }
    }

    return {
      id: providerId,
      address: rawProvider.beneficiary,
      name: rawProvider.name,
      description: rawProvider.description,
      active: rawProvider.isActive,
      products,
    }
  }

  /**
   * Convert capability arrays to object map
   * @param keys - Array of capability keys
   * @param values - Array of capability values
   * @returns Object map of capabilities
   */
  private _convertCapabilitiesToObject(keys: string[], values: string[]): Record<string, string> {
    const capabilities: Record<string, string> = {}
    for (let i = 0; i < keys.length; i++) {
      capabilities[keys[i]] = values[i] || ''
    }
    return capabilities
  }

  /**
   * Encode PDP offering to bytes
   * @param offering - PDP offering to encode
   * @returns Encoded bytes as hex string
   */
  private async encodePDPOffering(offering: PDPOffering): Promise<string> {
    const contract = this._getRegistryContract()
    return await contract.encodePDPOffering(offering)
  }
}
