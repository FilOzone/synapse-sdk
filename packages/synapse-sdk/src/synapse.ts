import { asChain, type Chain } from '@filoz/synapse-core/chains'
import {
  type Account,
  type Address,
  type Client,
  createClient,
  http,
  isAddress,
  type PublicActions,
  type PublicRpcSchema,
  publicActions,
  type Transport,
} from 'viem'
import { FilBeamService } from './filbeam/index.ts'
import { PaymentsService } from './payments/index.ts'
import { ChainRetriever, FilBeamRetriever } from './retriever/index.ts'
import { SPRegistryService } from './sp-registry/index.ts'
import type { StorageContext } from './storage/index.ts'
import { StorageManager } from './storage/manager.ts'
import type {
  PDPProvider,
  PieceCID,
  StorageInfo,
  StorageServiceOptions,
  SynapseFromClientOptions,
  SynapseOptions,
} from './types.ts'
import { DEFAULT_CHAIN } from './utils/constants.ts'
import { WarmStorageService } from './warm-storage/index.ts'

/**
 * Class for interacting with Filecoin storage and other on-chain services
 */
export class Synapse {
  private readonly _withCDN: boolean
  private readonly _payments: PaymentsService
  private readonly _warmStorageService: WarmStorageService
  private readonly _storageManager: StorageManager
  private readonly _filbeamService: FilBeamService
  private readonly _providers: SPRegistryService

  private readonly _client: Client<Transport, Chain, Account, PublicRpcSchema, PublicActions<Transport, Chain>>
  private readonly _chain: Chain

  /**
   * Create a new Synapse instance with async initialization.
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static create(options: SynapseOptions) {
    const client = createClient({
      // todo: change to mainnet chain for GA
      chain: options.chain ?? DEFAULT_CHAIN,
      // todo: add better fallback transport
      transport: options.transport ?? http(),
      account: options.account,
      name: 'Synapse Client',
      key: 'synapse-client',
    })

    if (client.account.type === 'json-rpc' && client.transport.type !== 'custom') {
      throw new Error('Transport must be a custom transport. See https://viem.sh/docs/clients/transports/custom.')
    }

    return new Synapse({ client, withCDN: options.withCDN, withIpni: options.withIpni })
  }

  public constructor(options: SynapseFromClientOptions) {
    this._client = options.client.extend(publicActions)
    this._chain = asChain(options.client.chain)
    this._withCDN = options.withCDN ?? false
    this._providers = new SPRegistryService(options.client)
    this._filbeamService = new FilBeamService(this._chain)
    this._warmStorageService = new WarmStorageService({ client: options.client })
    this._payments = new PaymentsService({ client: options.client })

    // Initialize StorageManager
    this._storageManager = new StorageManager(
      this,
      this._warmStorageService,
      new FilBeamRetriever(new ChainRetriever(this._warmStorageService, this._providers), this._chain),
      this._withCDN,
      options.withIpni
    )
  }

  get client(): Client<Transport, Chain, Account, PublicRpcSchema, PublicActions<Transport, Chain>> {
    return this._client
  }

  get chain(): Chain {
    return this._chain
  }

  /**
   * Gets the payment service instance
   * @returns The payment service
   */
  get payments(): PaymentsService {
    return this._payments
  }

  /**
   * Gets the storage manager instance
   *
   * @returns The storage manager for all storage operations
   */
  get storage(): StorageManager {
    return this._storageManager
  }

  /**
   * Gets the FilBeam service instance
   *
   * @returns The FilBeam service for interacting with FilBeam infrastructure
   */
  get filbeam(): FilBeamService {
    return this._filbeamService
  }

  /**
   * Gets the service provider registry instance
   *
   * @returns The service provider registry for interacting with service providers
   */
  get providers(): SPRegistryService {
    return this._providers
  }

  /**
   * Create a storage service instance.
   *
   * Automatically selects the best available service provider and creates or reuses a data set.
   *
   * @deprecated Use synapse.storage.createContext() instead. This method will be removed in a future version.
   * @param options - Optional storage configuration
   * @returns A configured StorageService instance ready for uploads/downloads
   *
   * @example
   * ```typescript
   * // Basic usage - auto-selects provider
   * const storage = await synapse.createStorage()
   * const result = await storage.upload(data)
   *
   * // With specific provider
   * const storage = await synapse.createStorage({
   *   providerId: 123
   * })
   *
   * // With CDN enabled
   * const storage = await synapse.createStorage({
   *   withCDN: true
   * })
   * ```
   */
  async createStorage(options: StorageServiceOptions = {}): Promise<StorageContext> {
    // Use StorageManager to create context
    return await this._storageManager.createContext(options)
  }

  /**
   * Download data from service providers
   * @deprecated Use synapse.storage.download() instead. This method will be removed in a future version.
   * @param pieceCid - The PieceCID identifier (string or PieceCID object)
   * @param options - Download options
   * @returns The downloaded data as Uint8Array
   *
   * @example
   * ```typescript
   * // Download by PieceCID string
   * const data = await synapse.download('bafkzcib...')
   *
   * // Download from specific provider
   * const data = await synapse.download(pieceCid, {
   *   providerAddress: '0x123...'
   * })
   * ```
   */
  async download(
    pieceCid: string | PieceCID,
    options?: {
      providerAddress?: Address
      withCDN?: boolean
    }
  ): Promise<Uint8Array> {
    console.warn('synapse.download() is deprecated. Use synapse.storage.download() instead.')
    return await this._storageManager.download(pieceCid, options)
  }

  /**
   * Get detailed information about a specific service provider
   * @param providerAddress - The provider's address or provider ID
   * @returns Provider information including URLs and pricing
   */
  async getProviderInfo(providerAddress: Address | bigint): Promise<PDPProvider> {
    try {
      // Validate address format if string provided
      if (typeof providerAddress === 'string') {
        try {
          isAddress(providerAddress) // Will throw if invalid
        } catch {
          throw new Error(`Invalid provider address: ${providerAddress}`)
        }
      }

      let providerInfo: PDPProvider | null
      if (typeof providerAddress === 'string') {
        providerInfo = await this._providers.getProviderByAddress(providerAddress)
      } else {
        providerInfo = await this._providers.getProvider(providerAddress)
      }

      // Check if provider was found in registry
      if (providerInfo == null) {
        throw new Error(`Provider ${providerAddress} not found in registry`)
      }

      return providerInfo
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid provider address')) {
        throw error
      }
      if (error instanceof Error && error.message.includes('not found')) {
        throw error
      }
      throw new Error(`Failed to get provider info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get comprehensive information about the storage service including
   * approved providers, pricing, contract addresses, and current allowances
   * @deprecated Use synapse.storage.getStorageInfo() instead. This method will be removed in a future version.
   * @returns Complete storage service information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    console.warn('synapse.getStorageInfo() is deprecated. Use synapse.storage.getStorageInfo() instead.')
    return await this._storageManager.getStorageInfo()
  }
}
