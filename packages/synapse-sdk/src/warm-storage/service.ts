/**
 * WarmStorageService - Consolidated interface for all Warm Storage contract operations
 *
 * This combines functionality for:
 * - Data set management and queries
 * - Service provider registration and management
 * - Client dataset ID tracking
 * - Data set creation verification
 * - CDN service management
 *
 * @example
 * ```typescript
 * import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
 *
 * const warmStorageService = WarmStorageService.create()
 *
 * ```
 */

import { asChain, type Chain as SynapseChain } from '@filoz/synapse-core/chains'
import * as PDPVerifier from '@filoz/synapse-core/pdp-verifier'
import { dataSetLiveCall, getDataSetListenerCall } from '@filoz/synapse-core/pdp-verifier'
import { type MetadataObject, metadataArrayToObject } from '@filoz/synapse-core/utils'
import {
  addApprovedProvider,
  getAccountTotalStorageSize,
  getAllDataSetMetadata,
  getAllDataSetMetadataCall,
  getAllPieceMetadata,
  getApprovedProviderIds,
  getClientDataSetIds,
  getClientDataSets,
  getClientDataSetsLength,
  getDataSet,
  getServicePrice,
  removeApprovedProvider,
  terminateService,
} from '@filoz/synapse-core/warm-storage'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  createClient,
  type Hash,
  http,
  isAddressEqual,
  type Transport,
} from 'viem'
import { multicall, readContract, simulateContract, writeContract } from 'viem/actions'
import type { EnhancedDataSetInfo } from '../types.ts'
import { DEFAULT_CHAIN, METADATA_KEYS } from '../utils/constants.ts'

export class WarmStorageService {
  private readonly _client: Client<Transport, Chain, Account>
  private readonly _chain: SynapseChain

  /**
   * Create a new WarmStorageService instance
   *
   * @param options - Options for the WarmStorageService
   * @param options.client - Wallet client
   * @returns A new WarmStorageService instance
   */
  constructor(options: { client: Client<Transport, Chain, Account> }) {
    this._client = options.client
    this._chain = asChain(options.client.chain)
  }

  /**
   * Create a new WarmStorageService with pre-configured client
   *
   * @param options - Options for the WarmStorageService
   * @param options.transport - Viem transport (optional, defaults to http())
   * @param options.chain - Filecoin chain (optional, defaults to {@link DEFAULT_CHAIN})
   * @param options.account - Viem account (required)
   * @returns A new {@link WarmStorageService} instance
   */
  static create(options: { transport?: Transport; chain?: Chain; account: Account }): WarmStorageService {
    const client = createClient({
      chain: options.chain ?? DEFAULT_CHAIN,
      transport: options.transport ?? http(),
      account: options.account,
      name: 'WarmStorageService',
      key: 'warm-storage-service',
    })

    if (client.account.type === 'json-rpc' && client.transport.type !== 'custom') {
      throw new Error('Transport must be a custom transport. See https://viem.sh/docs/clients/transports/custom.')
    }
    return new WarmStorageService({ client })
  }

  // ========== Client Data Set Operations ==========

  /**
   * Get a single data set by ID
   * @param options - Options for the data set
   * @param options.dataSetId - The data set ID to retrieve
   * @returns Data set information {@link getDataSet.OutputType}
   * @throws Errors {@link getDataSet.ErrorType}
   */
  async getDataSet(options: { dataSetId: bigint }): Promise<getDataSet.OutputType> {
    return getDataSet(this._client, options)
  }

  /**
   * Get all data sets for a specific client
   * @param options - Options for the client data sets
   * @param options.address - The client address
   * @param options.offset - Starting index (0-based). Use `0n` to start from beginning.
   * @param options.limit - Maximum number of data sets to return. Use `0n` to get all remaining.
   * @returns Array of data set information {@link getClientDataSets.OutputType}
   * @throws Errors {@link getClientDataSets.ErrorType}
   */
  async getClientDataSets(options: {
    address: Address
    offset?: bigint
    limit?: bigint
  }): Promise<getClientDataSets.OutputType> {
    return getClientDataSets(this._client, {
      address: options.address,
      offset: options.offset,
      limit: options.limit,
    })
  }

  /**
   * Get total count of data sets for a specific client
   * @param options - Options for the client data sets length
   * @param options.address - The client address
   * @returns Total count of data sets
   */
  async getClientDataSetsLength(options: { address: Address }): Promise<getClientDataSetsLength.OutputType> {
    return getClientDataSetsLength(this._client, options)
  }

  /**
   * Get data set IDs for a specific client with optional pagination
   * @param options - Options for the client data set IDs
   * @param options.address - The client address
   * @param options.offset - Starting index (0-based). Use `0n` to start from beginning.
   * @param options.limit - Maximum number of IDs to return. Use `0n` to get all remaining.
   * @returns Array of data set IDs {@link getClientDataSetIds.OutputType}
   */
  async getClientDataSetIds(options: {
    address: Address
    offset?: bigint
    limit?: bigint
  }): Promise<getClientDataSetIds.OutputType> {
    return getClientDataSetIds(this._client, options)
  }

  /**
   * Get all data sets for a client with enhanced details
   * This includes live status and management information
   * @param options - Options for the client data sets
   * @param options.address - The client address. Defaults to the client account address.
   * @param options.onlyManaged - If true, only return data sets managed by this Warm Storage contract. Defaults to false.
   * @returns Array of enhanced data set information {@link EnhancedDataSetInfo}
   */
  async getClientDataSetsWithDetails(options: {
    address?: Address
    onlyManaged?: boolean
  }): Promise<EnhancedDataSetInfo[]> {
    const { address = this._client.account.address, onlyManaged = false } = options

    const dataSets = await getClientDataSets(this._client, { address })

    // Enhance all in parallel using dataset IDs
    const enhancedDataSetsPromises = dataSets.map(async (dataSet) => {
      try {
        const [isLive, listener, metadata] = await multicall(this._client, {
          allowFailure: false,
          contracts: [
            dataSetLiveCall({
              chain: this._client.chain,
              dataSetId: dataSet.dataSetId,
            }),
            getDataSetListenerCall({
              chain: this._client.chain,
              dataSetId: dataSet.dataSetId,
            }),
            getAllDataSetMetadataCall({
              chain: this._client.chain,
              dataSetId: dataSet.dataSetId,
            }),
          ],
        })

        // Check if this data set is managed by our Warm Storage contract
        const isManaged = isAddressEqual(listener, this._chain.contracts.fwss.address)

        // Skip unmanaged data sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get active piece count only if the data set is live
        const activePieceCount = isLive
          ? await PDPVerifier.getActivePieceCount(this._client, { dataSetId: dataSet.dataSetId })
          : 0n

        return {
          ...dataSet,
          pdpVerifierDataSetId: dataSet.dataSetId,
          activePieceCount,
          isLive,
          isManaged,
          withCDN: dataSet.cdnRailId > 0 && metadata[0].includes(METADATA_KEYS.WITH_CDN),
          metadata: metadataArrayToObject(metadata),
        }
      } catch (error) {
        throw new Error(
          `Failed to get details for data set ${dataSet.dataSetId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedDataSetsPromises)

    // Filter out null values (from skipped data sets when onlyManaged is true)
    return results.filter((result): result is EnhancedDataSetInfo => result !== null)
  }

  /**
   * Get the total storage size across all live datasets for an account.
   *
   * @param options - Options for the total storage size query
   * @param options.address - Address to query. Defaults to the client account address.
   * @returns Total storage size and dataset count {@link getAccountTotalStorageSize.OutputType}
   * @throws Errors {@link getAccountTotalStorageSize.ErrorType}
   */
  async getAccountTotalStorageSize(
    options: { address?: Address } = {}
  ): Promise<getAccountTotalStorageSize.OutputType> {
    return getAccountTotalStorageSize(this._client, {
      address: options.address ?? this._client.account.address,
    })
  }

  /**
   * Validate that a dataset is live and managed by this WarmStorage contract
   *
   * Performs validation checks in parallel:
   * - Dataset exists and is live
   * - Dataset is managed by this WarmStorage contract
   *
   * @param options - Options for the data set
   * @param options.dataSetId - The PDPVerifier data set ID
   * @throws if dataset is not valid for operations
   */
  async validateDataSet(options: { dataSetId: bigint }): Promise<void> {
    // Parallelize validation checks
    const [isLive, listener] = await multicall(this._client, {
      allowFailure: false,
      contracts: [
        dataSetLiveCall({
          chain: this._client.chain,
          dataSetId: options.dataSetId,
        }),
        getDataSetListenerCall({
          chain: this._client.chain,
          dataSetId: options.dataSetId,
        }),
      ],
    })

    // Check if data set exists and is live
    if (!isLive) {
      throw new Error(`Data set ${options.dataSetId} does not exist or is not live`)
    }

    // Verify this data set is managed by our Warm Storage contract
    if (!isAddressEqual(listener, this._chain.contracts.fwss.address)) {
      throw new Error(
        `Data set ${options.dataSetId} is not managed by this WarmStorage contract (${
          this._chain.contracts.fwss.address
        }), managed by ${String(listener)}`
      )
    }
  }

  /**
   * Get the count of active pieces in a dataset (excludes removed pieces)
   * @param options - Options for the data set
   * @param options.dataSetId - The PDPVerifier data set ID
   * @returns The number of active pieces
   */
  async getActivePieceCount(options: { dataSetId: bigint }): Promise<bigint> {
    return PDPVerifier.getActivePieceCount(this._client, { dataSetId: options.dataSetId })
  }

  // ========== Metadata Operations ==========

  /**
   * Get all metadata for a data set
   *
   * @param options - Options for the data set
   * @param options.dataSetId - The data set ID
   * @returns Object with metadata key-value pairs
   */
  async getDataSetMetadata(options: { dataSetId: bigint }): Promise<MetadataObject> {
    return getAllDataSetMetadata(this._client, { dataSetId: options.dataSetId })
  }

  /**
   * Get specific metadata key for a data set
   *
   * @param options - Options for the data set
   * @param options.dataSetId - The data set ID
   * @param options.key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getDataSetMetadataByKey(options: { dataSetId: bigint; key: string }): Promise<string | null> {
    const [exists, value] = await readContract(this._client, {
      address: this._chain.contracts.fwssView.address,
      abi: this._chain.contracts.fwssView.abi,
      functionName: 'getDataSetMetadata',
      args: [options.dataSetId, options.key],
    })
    return exists ? value : null
  }

  /**
   * Get all metadata for a piece in a data set
   *
   * @param options - Options for the piece
   * @param options.dataSetId - The data set ID
   * @param options.pieceId - The piece ID
   * @returns Object with metadata key-value pairs
   */
  async getPieceMetadata(options: { dataSetId: bigint; pieceId: bigint }): Promise<MetadataObject> {
    return getAllPieceMetadata(this._client, options)
  }

  /**
   * Get specific metadata key for a piece in a data set
   *
   * @param options - Options for the piece
   * @param options.dataSetId - The data set ID
   * @param options.pieceId - The piece ID
   * @param options.key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getPieceMetadataByKey(options: { dataSetId: bigint; pieceId: bigint; key: string }): Promise<string | null> {
    const [exists, value] = await readContract(this._client, {
      address: this._chain.contracts.fwssView.address,
      abi: this._chain.contracts.fwssView.abi,
      functionName: 'getPieceMetadata',
      args: [options.dataSetId, options.pieceId, options.key],
    })
    return exists ? value : null
  }

  // ========== Storage Cost Operations ==========

  /**
   * Get the current service price per TiB per month
   * @returns Service price information for both CDN and non-CDN options
   */
  async getServicePrice(): Promise<getServicePrice.OutputType> {
    return getServicePrice(this._client)
  }

  // ========== Data Set Operations ==========

  /**
   * Terminate a data set with given ID
   * @param options - Options for the data set termination
   * @param options.dataSetId - ID of the data set to terminate
   * @returns Transaction receipt
   */
  async terminateDataSet(options: { dataSetId: bigint }): Promise<Hash> {
    return terminateService(this._client, { dataSetId: options.dataSetId })
  }

  // ========== Service Provider Approval Operations ==========

  /**
   * Add an approved provider by ID (owner only)
   * @param options - Options for the approved provider addition
   * @param options.providerId - Provider ID from registry
   * @returns Transaction response
   */
  async addApprovedProvider(options: { providerId: bigint }): Promise<addApprovedProvider.OutputType> {
    return addApprovedProvider(this._client, { providerId: options.providerId })
  }

  /**
   * Remove an approved provider by ID (owner only)
   * @param options - Options for the approved provider removal
   * @param options.providerId - Provider ID from registry
   * @returns Transaction response
   */
  async removeApprovedProvider(options: { providerId: bigint }): Promise<removeApprovedProvider.OutputType> {
    // First, we need to find the index of this provider in the array
    const approvedIds = await getApprovedProviderIds(this._client)
    const index = approvedIds.indexOf(options.providerId)

    if (index === -1) {
      throw new Error(`Provider ${options.providerId} is not in the approved list`)
    }

    return removeApprovedProvider(this._client, { providerId: options.providerId, index: BigInt(index) })
  }

  /**
   * Get list of approved provider IDs
   * @returns Array of approved provider IDs
   */
  async getApprovedProviderIds(): Promise<getApprovedProviderIds.OutputType> {
    return getApprovedProviderIds(this._client)
  }

  /**
   * Check if a provider ID is approved
   * @param options - Options for the provider ID approval check
   * @param options.providerId - Provider ID to check
   * @returns Whether the provider is approved
   */
  async isProviderIdApproved(options: { providerId: bigint }): Promise<boolean> {
    return readContract(this._client, {
      address: this._chain.contracts.fwssView.address,
      abi: this._chain.contracts.fwssView.abi,
      functionName: 'isProviderApproved',
      args: [options.providerId],
    })
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner(): Promise<Address> {
    return readContract(this._client, {
      address: this._chain.contracts.fwss.address,
      abi: this._chain.contracts.fwss.abi,
      functionName: 'owner',
    })
  }

  /**
   * Check if an address is the contract owner
   * @param options - Options for the owner check
   * @param options.address - Address to check
   * @returns Whether the address is the owner
   */
  async isOwner(options: { address: Address }): Promise<boolean> {
    const ownerAddress = await this.getOwner()
    return isAddressEqual(options.address, ownerAddress)
  }

  /**
   * Get the PDP config from the WarmStorage contract.
   * Returns maxProvingPeriod, challengeWindowSize, challengesPerProof, initChallengeWindowStart
   */
  async getPDPConfig(): Promise<{
    maxProvingPeriod: bigint
    challengeWindowSize: bigint
    challengesPerProof: bigint
    initChallengeWindowStart: bigint
  }> {
    const [maxProvingPeriod, challengeWindowSize, challengesPerProof, initChallengeWindowStart] = await readContract(
      this._client,
      {
        address: this._chain.contracts.fwssView.address,
        abi: this._chain.contracts.fwssView.abi,
        functionName: 'getPDPConfig',
      }
    )

    return {
      maxProvingPeriod: maxProvingPeriod,
      challengeWindowSize: challengeWindowSize,
      challengesPerProof: challengesPerProof,
      initChallengeWindowStart: initChallengeWindowStart,
    }
  }
  /**
   * Increments the fixed locked-up amounts for CDN payment rails.
   *
   * This method tops up the prepaid balance for CDN services by adding to the existing
   * lockup amounts. Both CDN and cache miss rails can be incremented independently.
   *
   * @param options - Options for the top up CDN payment rails
   * @param options.dataSetId - The ID of the data set
   * @param options.cdnAmountToAdd - Amount to add to the CDN rail lockup
   * @param options.cacheMissAmountToAdd - Amount to add to the cache miss rail lockup
   * @returns Transaction response {@link Hash}
   */
  async topUpCDNPaymentRails(options: {
    dataSetId: bigint
    cdnAmountToAdd: bigint
    cacheMissAmountToAdd: bigint
  }): Promise<Hash> {
    if (options.cdnAmountToAdd < 0n || options.cacheMissAmountToAdd < 0n) {
      throw new Error('Top up amounts must be positive')
    }
    if (options.cdnAmountToAdd === 0n && options.cacheMissAmountToAdd === 0n) {
      throw new Error('At least one top up amount must be >0')
    }

    const { request } = await simulateContract(this._client, {
      address: this._chain.contracts.fwss.address,
      abi: this._chain.contracts.fwss.abi,
      functionName: 'topUpCDNPaymentRails',
      args: [options.dataSetId, options.cdnAmountToAdd, options.cacheMissAmountToAdd],
    })

    const hash = await writeContract(this._client, request)

    return hash
  }
}
