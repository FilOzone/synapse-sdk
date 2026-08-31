import type { AccountClient, ReadClient, SessionKeyClient } from '@filoz/synapse-core'
import type { FilecoinChain } from '@filoz/synapse-core/chains'
import { asClient, getTransport, toReadClient } from '@filoz/synapse-core/client'
import * as SessionKey from '@filoz/synapse-core/session-key'
import {
  type Address,
  createClient,
  isAddress,
  type PublicActions,
  type PublicRpcSchema,
  publicActions,
  type RpcSchema,
  type Transport,
} from 'viem'
import { FilBeamService } from './filbeam/index.ts'
import { PaymentsService } from './payments/index.ts'
import { SPRegistryService } from './sp-registry/index.ts'
import { StorageManager } from './storage/manager.ts'
import { PieceBatchingService, registerPieceBatchingService } from './storage/piece-batching.ts'
import type { PDPProvider, SynapseFromClientOptions, SynapseOptions } from './types.ts'
import { DEFAULT_CHAIN } from './utils/constants.ts'
import { WarmStorageService } from './warm-storage/index.ts'

/**
 * Class for interacting with Filecoin storage and other on-chain services
 */
export class Synapse {
  private readonly _withCDN: boolean
  private readonly _source: string | null
  private readonly _payments: PaymentsService
  private readonly _warmStorageService: WarmStorageService
  private readonly _storageManager: StorageManager
  private readonly _filbeamService: FilBeamService
  private readonly _providers: SPRegistryService

  private readonly _client: AccountClient<PublicRpcSchema, PublicActions<Transport, FilecoinChain>>
  private readonly _sessionClient: SessionKeyClient | undefined
  private readonly _readClient: ReadClient<RpcSchema, PublicActions<Transport, FilecoinChain>>
  private readonly _chain: FilecoinChain

  /**
   * Create a new Synapse instance.
   *
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static create(options: SynapseOptions) {
    const chain = options.chain ?? DEFAULT_CHAIN
    const client = createClient({
      // todo: change to mainnet chain for GA
      chain,
      transport: options.transport ?? getTransport(chain),
      account: options.account,
      name: 'Synapse Client',
      key: 'synapse-client',
    })

    if (options.sessionKey != null) {
      const sessionKey = options.sessionKey
      const requiredPermissions = options.requiredPermissions ?? SessionKey.DefaultFwssPermissions
      const missing = requiredPermissions
        .filter((permission) => !sessionKey.hasPermission(permission))
        .map((permission) => {
          const name = SessionKey.PermissionNames[permission] ?? permission
          const expiry = sessionKey.expirations[permission]
          if (expiry == null || expiry === 0n) {
            return `${name} (not authorized)`
          }
          return `${name} (expired at ${new Date(Number(expiry) * 1000).toISOString()})`
        })
      if (missing.length > 0) {
        throw new Error(
          `Session key is missing required FWSS permissions: ${missing.join(', ')}. ` +
            'Synapse.create requires every permission in requiredPermissions (defaults to SessionKey.DefaultFwssPermissions) to be authorized and unexpired. ' +
            'Authorize the session key for all of them (SessionKey.login) and refresh local state (sessionKey.syncExpirations), ' +
            'pass a narrower requiredPermissions set, ' +
            'or drop down to @filoz/synapse-core to operate with a custom permission scope. ' +
            'See https://docs.filecoin.cloud/developer-guides/session-keys/ for details.'
        )
      }
    }

    return new Synapse({
      client,
      withCDN: options.withCDN,
      source: options.source,
      sessionClient: options.sessionKey?.client,
      pieceBatching: options.pieceBatching,
    })
  }

  public constructor(options: SynapseFromClientOptions) {
    this._client = asClient(options.client).extend(publicActions)
    this._readClient = options.readClient
      ? asClient(options.readClient).extend(publicActions)
      : toReadClient(options.client).extend(publicActions)
    this._sessionClient = options.sessionClient ? asClient(options.sessionClient) : undefined
    this._chain = this._client.chain
    this._withCDN = options.withCDN ?? false
    this._source = options.source ?? null
    this._providers = new SPRegistryService({ client: this._client, readClient: this._readClient })
    this._filbeamService = new FilBeamService(this._chain)
    this._warmStorageService = new WarmStorageService({ client: this._client, readClient: this._readClient })
    this._payments = new PaymentsService({ client: this._client })

    if (options.pieceBatching !== false) {
      registerPieceBatchingService(this, new PieceBatchingService(this, options.pieceBatching ?? {}))
    }

    // Initialize StorageManager
    this._storageManager = new StorageManager({
      synapse: this,
      warmStorageService: this._warmStorageService,
      withCDN: this._withCDN,
      source: this._source,
    })
  }

  get client() {
    return this._client
  }
  get readClient() {
    return this._readClient
  }

  get sessionClient() {
    return this._sessionClient
  }

  get chain() {
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
        providerInfo = await this._providers.getProviderByAddress({ address: providerAddress })
      } else {
        providerInfo = await this._providers.getProvider({ providerId: providerAddress })
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
}
