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
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const warmStorageService = new WarmStorageService(provider, warmStorageAddress, pdpVerifierAddress)
 *
 * // Get data sets for a client
 * const dataSets = await warmStorageService.getClientDataSets(clientAddress)
 * console.log(`Client has ${dataSets.length} data sets`)
 *
 * // Register as a service provider
 * const signer = await provider.getSigner()
 * await warmStorageService.registerServiceProvider(signer, pdpUrl, retrievalUrl)
 * ```
 */

import { asChain, type Chain as SynapseChain } from '@filoz/synapse-core/chains'
import { dataSetLiveCall, getDataSetListenerCall } from '@filoz/synapse-core/pdp-verifier'
import { type MetadataObject, metadataArrayToObject } from '@filoz/synapse-core/utils'
import {
  addApprovedProvider,
  getAllDataSetMetadata,
  getAllPieceMetadata,
  getApprovedProviders,
  getServicePrice,
  removeApprovedProvider,
  terminateDataSet,
} from '@filoz/synapse-core/warm-storage'
import { type Account, type Address, type Chain, type Client, type Hash, isAddressEqual, type Transport } from 'viem'
import { multicall, readContract, simulateContract, writeContract } from 'viem/actions'
import type { PaymentsService } from '../payments/service.ts'
import { PDPVerifier } from '../pdp/verifier.ts'
import type { DataSetInfo, EnhancedDataSetInfo } from '../types.ts'
import { METADATA_KEYS, SIZE_CONSTANTS, TIME_CONSTANTS, TOKENS } from '../utils/constants.ts'
import { createError } from '../utils/index.ts'

export class WarmStorageService {
  private readonly _client: Client<Transport, Chain>
  private readonly _pdpVerifier: PDPVerifier
  private readonly _chain: SynapseChain

  /**
   * Private constructor - use WarmStorageService.create() instead
   */
  private constructor(client: Client<Transport, Chain>) {
    this._client = client
    this._pdpVerifier = new PDPVerifier({ client })
    this._chain = asChain(client.chain)
  }

  /**
   * Create a new WarmStorageService instance with initialized addresses
   */
  static async create(client: Client<Transport, Chain>): Promise<WarmStorageService> {
    return new WarmStorageService(client)
  }

  getPDPVerifierAddress(): Address {
    return this._chain.contracts.pdp.address
  }

  getPaymentsAddress(): Address {
    return this._chain.contracts.payments.address
  }

  getUSDFCTokenAddress(): Address {
    return this._chain.contracts.usdfc.address
  }

  getViewContractAddress(): Address {
    return this._chain.contracts.storageView.address
  }

  getServiceProviderRegistryAddress(): Address {
    return this._chain.contracts.serviceProviderRegistry.address
  }

  getSessionKeyRegistryAddress(): Address {
    return this._chain.contracts.sessionKeyRegistry.address
  }

  // ========== Client Data Set Operations ==========

  /**
   * Get a single data set by ID
   * @param dataSetId - The data set ID to retrieve
   * @returns Data set information
   * @throws Error if data set doesn't exist
   */
  async getDataSet(dataSetId: bigint): Promise<DataSetInfo> {
    const ds = await readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'getDataSet',
      args: [dataSetId],
    })

    if (ds.pdpRailId === 0n) {
      throw createError('WarmStorageService', 'getDataSet', `Data set ${dataSetId} does not exist`)
    }

    // Convert from on-chain format to our interface
    return ds
  }

  /**
   * Get all data sets for a specific client
   * @param clientAddress - The client address
   * @returns Array of data set information
   */
  async getClientDataSets(clientAddress: Address): Promise<readonly DataSetInfo[]> {
    return await readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'getClientDataSets',
      args: [clientAddress],
    })
  }

  /**
   * Get all data sets for a client with enhanced details
   * This includes live status and management information
   * @param client - The client address
   * @param onlyManaged - If true, only return data sets managed by this Warm Storage contract
   * @returns Array of enhanced data set information
   */
  async getClientDataSetsWithDetails(client: Address, onlyManaged: boolean = false): Promise<EnhancedDataSetInfo[]> {
    // Query dataset IDs directly from the view contract
    const ids = await readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'clientDataSets',
      args: [client],
    })
    if (ids.length === 0) return []

    // Enhance all in parallel using dataset IDs
    const enhancedDataSetsPromises = ids.map(async (dataSetId) => {
      try {
        const base = await this.getDataSet(dataSetId)

        const [isLive, listener, metadata] = await multicall(this._client, {
          allowFailure: false,
          contracts: [
            dataSetLiveCall({
              chain: this._client.chain,
              dataSetId: dataSetId,
            }),
            getDataSetListenerCall({
              chain: this._client.chain,
              dataSetId: dataSetId,
            }),
            {
              address: this._chain.contracts.storageView.address,
              abi: this._chain.contracts.storageView.abi,
              functionName: 'getAllDataSetMetadata',
              args: [dataSetId],
            },
          ],
        })

        // Check if this data set is managed by our Warm Storage contract
        const isManaged = listener != null && isAddressEqual(listener, this._chain.contracts.storage.address)

        // Skip unmanaged data sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get active piece count only if the data set is live
        const activePieceCount = isLive ? await this._pdpVerifier.getActivePieceCount(dataSetId) : 0n

        return {
          ...base,
          pdpVerifierDataSetId: dataSetId,
          activePieceCount,
          isLive,
          isManaged,
          withCDN: base.cdnRailId > 0 && metadata[0].includes(METADATA_KEYS.WITH_CDN),
          metadata: metadataArrayToObject(metadata),
        }
      } catch (error) {
        throw new Error(
          `Failed to get details for data set ${dataSetId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedDataSetsPromises)

    // Filter out null values (from skipped data sets when onlyManaged is true)
    return results.filter((result): result is EnhancedDataSetInfo => result !== null)
  }

  /**
   * Validate that a dataset is live and managed by this WarmStorage contract
   *
   * Performs validation checks in parallel:
   * - Dataset exists and is live
   * - Dataset is managed by this WarmStorage contract
   *
   * @param dataSetId - The PDPVerifier data set ID
   * @throws if dataset is not valid for operations
   */
  async validateDataSet(dataSetId: bigint): Promise<void> {
    // Parallelize validation checks
    const [isLive, listener] = await multicall(this._client, {
      allowFailure: false,
      contracts: [
        dataSetLiveCall({
          chain: this._client.chain,
          dataSetId: dataSetId,
        }),
        getDataSetListenerCall({
          chain: this._client.chain,
          dataSetId: dataSetId,
        }),
      ],
    })

    // Check if data set exists and is live
    if (!isLive) {
      throw new Error(`Data set ${dataSetId} does not exist or is not live`)
    }

    // Verify this data set is managed by our Warm Storage contract
    if (!isAddressEqual(listener, this._chain.contracts.storage.address)) {
      throw new Error(
        `Data set ${dataSetId} is not managed by this WarmStorage contract (${
          this._chain.contracts.storage.address
        }), managed by ${String(listener)}`
      )
    }
  }

  /**
   * Get the count of active pieces in a dataset (excludes removed pieces)
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The number of active pieces
   */
  async getActivePieceCount(dataSetId: bigint): Promise<bigint> {
    return this._pdpVerifier.getActivePieceCount(dataSetId)
  }

  // ========== Metadata Operations ==========

  /**
   * Get all metadata for a data set
   * @param dataSetId - The data set ID
   * @returns Object with metadata key-value pairs
   */
  async getDataSetMetadata(dataSetId: bigint): Promise<MetadataObject> {
    return getAllDataSetMetadata(this._client, { dataSetId })
  }

  /**
   * Get specific metadata key for a data set
   * @param dataSetId - The data set ID
   * @param key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getDataSetMetadataByKey(dataSetId: bigint, key: string): Promise<string | null> {
    const [exists, value] = await readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'getDataSetMetadata',
      args: [dataSetId, key],
    })
    return exists ? value : null
  }

  /**
   * Get all metadata for a piece in a data set
   * @param dataSetId - The data set ID
   * @param pieceId - The piece ID
   * @returns Object with metadata key-value pairs
   */
  async getPieceMetadata(dataSetId: bigint, pieceId: bigint): Promise<MetadataObject> {
    return getAllPieceMetadata(this._client, { dataSetId, pieceId })
  }

  /**
   * Get specific metadata key for a piece in a data set
   * @param dataSetId - The data set ID
   * @param pieceId - The piece ID
   * @param key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getPieceMetadataByKey(dataSetId: bigint, pieceId: bigint, key: string): Promise<string | null> {
    const [exists, value] = await readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'getPieceMetadata',
      args: [dataSetId, pieceId, key],
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

  /**
   * Calculate storage costs for a given size
   * @param sizeInBytes - Size of data to store in bytes
   * @returns Cost estimates per epoch, day, and month
   * @remarks CDN costs are usage-based (egress pricing), so withCDN field reflects base storage cost only
   */
  async calculateStorageCost(sizeInBytes: number): Promise<{
    perEpoch: bigint
    perDay: bigint
    perMonth: bigint
    withCDN: {
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
    }
  }> {
    const servicePriceInfo = await this.getServicePrice()

    // Calculate price per byte per epoch (base storage cost)
    const sizeInBytesBigint = BigInt(sizeInBytes)
    const pricePerEpoch =
      (servicePriceInfo.pricePerTiBPerMonthNoCDN * sizeInBytesBigint) /
      (SIZE_CONSTANTS.TiB * servicePriceInfo.epochsPerMonth)

    const costs = {
      perEpoch: pricePerEpoch,
      perDay: pricePerEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY),
      perMonth: pricePerEpoch * servicePriceInfo.epochsPerMonth,
    }

    // CDN costs are usage-based (egress pricing), so withCDN returns base storage cost
    // Actual CDN costs will be charged based on egress usage
    return {
      ...costs,
      withCDN: costs,
    }
  }

  /**
   * Check if user has sufficient allowances for a storage operation and calculate costs
   * @param sizeInBytes - Size of data to store
   * @param withCDN - Whether CDN is enabled
   * @param paymentsService - PaymentsService instance to check allowances
   * @param lockupDays - Number of days for lockup period (defaults to 10)
   * @returns Allowance requirement details and storage costs
   */
  async checkAllowanceForStorage(
    sizeInBytes: number,
    withCDN: boolean,
    paymentsService: PaymentsService,
    lockupDays?: number
  ): Promise<{
    rateAllowanceNeeded: bigint
    lockupAllowanceNeeded: bigint
    currentRateAllowance: bigint
    currentLockupAllowance: bigint
    currentRateUsed: bigint
    currentLockupUsed: bigint
    sufficient: boolean
    message?: string
    costs: {
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
    }
    depositAmountNeeded: bigint
  }> {
    // Get current allowances and calculate costs in parallel
    const [approval, costs] = await Promise.all([
      paymentsService.serviceApproval(this._chain.contracts.storage.address, TOKENS.USDFC),
      this.calculateStorageCost(sizeInBytes),
    ])

    const selectedCosts = withCDN ? costs.withCDN : costs
    const rateNeeded = selectedCosts.perEpoch

    // Calculate lockup period based on provided days (default: 10)
    const lockupPeriod =
      BigInt(lockupDays ?? Number(TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS)) * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
    const lockupNeeded = rateNeeded * lockupPeriod

    // Calculate required allowances (current usage + new requirement)
    const totalRateNeeded = approval.rateUsage + rateNeeded
    const totalLockupNeeded = approval.lockupUsage + lockupNeeded

    // Check if allowances are sufficient
    const sufficient = approval.rateAllowance >= totalRateNeeded && approval.lockupAllowance >= totalLockupNeeded

    // Calculate how much more is needed
    const rateAllowanceNeeded = totalRateNeeded > approval.rateAllowance ? totalRateNeeded - approval.rateAllowance : 0n

    const lockupAllowanceNeeded =
      totalLockupNeeded > approval.lockupAllowance ? totalLockupNeeded - approval.lockupAllowance : 0n

    // Build optional message
    let message: string | undefined
    if (!sufficient) {
      const needsRate = rateAllowanceNeeded > 0n
      const needsLockup = lockupAllowanceNeeded > 0n
      if (needsRate && needsLockup) {
        message = 'Insufficient rate and lockup allowances'
      } else if (needsRate) {
        message = 'Insufficient rate allowance'
      } else if (needsLockup) {
        message = 'Insufficient lockup allowance'
      }
    }

    return {
      rateAllowanceNeeded,
      lockupAllowanceNeeded,
      currentRateAllowance: approval.rateAllowance,
      currentLockupAllowance: approval.lockupAllowance,
      currentRateUsed: approval.rateUsage,
      currentLockupUsed: approval.lockupUsage,
      sufficient,
      message,
      costs: selectedCosts,
      depositAmountNeeded: lockupNeeded,
    }
  }

  /**
   * Prepare for storage upload by checking balances and allowances
   *
   * This method performs a comprehensive check of the prerequisites for storage upload,
   * including verifying sufficient funds and service allowances. It returns a list of
   * actions that need to be executed before the upload can proceed.
   *
   * @param options - Configuration options for the storage upload
   * @param options.dataSize - Size of data to store in bytes
   * @param options.withCDN - Whether to enable CDN for faster retrieval (optional, defaults to false)
   * @param paymentsService - Instance of PaymentsService for handling payment operations
   *
   * @returns Object containing:
   *   - estimatedCost: Breakdown of storage costs (per epoch, day, and month)
   *   - allowanceCheck: Status of service allowances with optional message
   *   - actions: Array of required actions (deposit, approveService) that need to be executed
   *
   * @example
   * ```typescript
   * const prep = await warmStorageService.prepareStorageUpload(
   *   { dataSize: Number(SIZE_CONSTANTS.GiB), withCDN: true },
   *   paymentsService
   * )
   *
   * if (prep.actions.length > 0) {
   *   for (const action of prep.actions) {
   *     console.log(`Executing: ${action.description}`)
   *     await action.execute()
   *   }
   * }
   * ```
   */
  async prepareStorageUpload(
    options: {
      dataSize: number
      withCDN?: boolean
    },
    paymentsService: PaymentsService
  ): Promise<{
    estimatedCost: {
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
    }
    allowanceCheck: {
      sufficient: boolean
      message?: string
    }
    actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<Hash>
    }>
  }> {
    // Parallelize cost calculation and allowance check
    const [costs, allowanceCheck] = await Promise.all([
      this.calculateStorageCost(options.dataSize),
      this.checkAllowanceForStorage(options.dataSize, options.withCDN ?? false, paymentsService),
    ])

    // Select the appropriate costs based on CDN option
    const selectedCosts = (options.withCDN ?? false) ? costs.withCDN : costs

    const actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<Hash>
    }> = []

    // Check if deposit is needed
    const accountInfo = await paymentsService.accountInfo(TOKENS.USDFC)
    const requiredBalance = selectedCosts.perMonth // Require at least 1 month of funds

    if (accountInfo.availableFunds < requiredBalance) {
      const depositAmount = requiredBalance - accountInfo.availableFunds
      actions.push({
        type: 'deposit',
        description: `Deposit ${depositAmount} USDFC to payments contract`,
        execute: async () => await paymentsService.deposit(depositAmount, TOKENS.USDFC),
      })
    }

    // Check if service approval is needed
    if (!allowanceCheck.sufficient) {
      actions.push({
        type: 'approveService',
        description: `Approve service with rate allowance ${allowanceCheck.rateAllowanceNeeded} and lockup allowance ${allowanceCheck.lockupAllowanceNeeded}`,
        execute: async () =>
          await paymentsService.approveService(
            this._chain.contracts.storage.address,
            allowanceCheck.rateAllowanceNeeded,
            allowanceCheck.lockupAllowanceNeeded,
            TIME_CONSTANTS.EPOCHS_PER_MONTH, // 30 days max lockup period
            TOKENS.USDFC
          ),
      })
    }

    return {
      estimatedCost: {
        perEpoch: selectedCosts.perEpoch,
        perDay: selectedCosts.perDay,
        perMonth: selectedCosts.perMonth,
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.sufficient
          ? undefined
          : `Insufficient allowances: rate needed ${allowanceCheck.rateAllowanceNeeded}, lockup needed ${allowanceCheck.lockupAllowanceNeeded}`,
      },
      actions,
    }
  }

  // ========== Data Set Operations ==========

  /**
   * Terminate a data set with given ID
   * @param client - Wallet client to terminate the data set
   * @param dataSetId  - ID of the data set to terminate
   * @returns Transaction receipt
   */
  async terminateDataSet(client: Client<Transport, Chain, Account>, dataSetId: bigint): Promise<Hash> {
    return terminateDataSet(client, { dataSetId })
  }

  // ========== Service Provider Approval Operations ==========

  /**
   * Add an approved provider by ID (owner only)
   * @param client - Wallet client to add the approved provider
   * @param providerId - Provider ID from registry
   * @returns Transaction response
   */
  async addApprovedProvider(
    client: Client<Transport, Chain, Account>,
    providerId: bigint
  ): Promise<addApprovedProvider.OutputType> {
    return addApprovedProvider(client, { providerId })
  }

  /**
   * Remove an approved provider by ID (owner only)
   * @param client - Wallet client to remove the approved provider
   * @param providerId - Provider ID from registry
   * @returns Transaction response
   */
  async removeApprovedProvider(
    client: Client<Transport, Chain, Account>,
    providerId: bigint
  ): Promise<removeApprovedProvider.OutputType> {
    // First, we need to find the index of this provider in the array
    const approvedIds = await getApprovedProviders(client)
    const index = approvedIds.indexOf(providerId)

    if (index === -1) {
      throw new Error(`Provider ${providerId} is not in the approved list`)
    }

    return removeApprovedProvider(client, { providerId, index: BigInt(index) })
  }

  /**
   * Get list of approved provider IDs
   * @returns Array of approved provider IDs
   */
  async getApprovedProviderIds(): Promise<getApprovedProviders.OutputType> {
    return getApprovedProviders(this._client)
  }

  /**
   * Check if a provider ID is approved
   * @param providerId - Provider ID to check
   * @returns Whether the provider is approved
   */
  async isProviderIdApproved(providerId: bigint): Promise<boolean> {
    return readContract(this._client, {
      address: this._chain.contracts.storageView.address,
      abi: this._chain.contracts.storageView.abi,
      functionName: 'isProviderApproved',
      args: [providerId],
    })
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner(): Promise<Address> {
    return readContract(this._client, {
      address: this._chain.contracts.storage.address,
      abi: this._chain.contracts.storage.abi,
      functionName: 'owner',
    })
  }

  /**
   * Check if an address is the contract owner
   * @param address - Address to check
   * @returns Whether the address is the owner
   */
  async isOwner(address: Address): Promise<boolean> {
    const ownerAddress = await this.getOwner()
    return isAddressEqual(address, ownerAddress)
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
        address: this._chain.contracts.storageView.address,
        abi: this._chain.contracts.storageView.abi,
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
   * @param dataSetId - The ID of the data set
   * @param cdnAmountToAdd - Amount to add to the CDN rail lockup
   * @param cacheMissAmountToAdd - Amount to add to the cache miss rail lockup
   * @returns Transaction response
   */
  async topUpCDNPaymentRails(
    client: Client<Transport, Chain, Account>,
    dataSetId: bigint,
    cdnAmountToAdd: bigint,
    cacheMissAmountToAdd: bigint
  ): Promise<Hash> {
    if (cdnAmountToAdd < 0n || cacheMissAmountToAdd < 0n) {
      throw new Error('Top up amounts must be positive')
    }
    if (cdnAmountToAdd === 0n && cacheMissAmountToAdd === 0n) {
      throw new Error('At least one top up amount must be >0')
    }

    const { request } = await simulateContract(client, {
      address: this._chain.contracts.storage.address,
      abi: this._chain.contracts.storage.abi,
      functionName: 'topUpCDNPaymentRails',
      args: [dataSetId, cdnAmountToAdd, cacheMissAmountToAdd],
    })

    const hash = await writeContract(client, request)

    return hash
  }
}
