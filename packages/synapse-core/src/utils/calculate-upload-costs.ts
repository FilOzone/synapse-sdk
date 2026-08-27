import { ValidationError } from '../errors/base.ts'
import { calculateAdditionalLockupRequired } from '../warm-storage/calculate-additional-lockup-required.ts'
import { calculateEffectiveRate } from '../warm-storage/calculate-effective-rate.ts'
import { calculateLifecycleReserveFunding } from '../warm-storage/calculate-lifecycle-reserve-funding.ts'
import { calculateUploadFees } from '../warm-storage/calculate-upload-fees.ts'
import type { getPriceList } from '../warm-storage/price-list.ts'
import { DEFAULT_BUFFER_EPOCHS, DEFAULT_RUNWAY_EPOCHS, TIME_CONSTANTS } from './constants.ts'
import { leafCountToRawSize, pieceSizesToLeafCount } from './pdp-size.ts'

export type CalculateRunwayAmountFromStateOptions = {
  netRateAfterUpload: bigint
  extraRunwayEpochs: bigint
}

/**
 * Calculate extra account funding for the requested post-upload runway.
 *
 * @param options - Projected account rate and requested runway duration
 * @returns Runway funding in token base units
 */
export function calculateRunwayAmountFromState(options: CalculateRunwayAmountFromStateOptions): bigint {
  return options.netRateAfterUpload * options.extraRunwayEpochs
}

export type CalculateBufferAmountFromStateOptions = {
  rawDepositNeeded: bigint
  netRateAfterUpload: bigint
  runwayInEpochs: bigint
  availableFunds: bigint
  bufferEpochs: bigint
}

/**
 * Calculate the account funding buffer for transaction execution delay.
 *
 * @param options - Resolved account state and requested buffer duration
 * @returns Buffer funding in token base units
 */
export function calculateBufferAmountFromState(options: CalculateBufferAmountFromStateOptions): bigint {
  const { rawDepositNeeded, netRateAfterUpload, runwayInEpochs, availableFunds, bufferEpochs } = options

  if (rawDepositNeeded > 0n) {
    return netRateAfterUpload * bufferEpochs
  }

  if (runwayInEpochs <= bufferEpochs) {
    const needed = netRateAfterUpload * bufferEpochs - availableFunds
    return needed > 0n ? needed : 0n
  }

  return 0n
}

export namespace calculateUploadCosts {
  /** Resolved on-chain state for an existing data set. */
  export type ExistingDataSetType = {
    /** Aggregate leaf count reported by PDP Verifier. */
    leafCount: bigint
    /** Current fixed lifecycle reserve balance mirrored from the PDP payment rail. */
    lifecycleReserveBalance: bigint
    /** One-time operation fees waiting to be flushed from the lifecycle reserve. */
    pendingOneTimePayments: bigint
  }

  /** One storage context affected by the planned upload. */
  export type ContextType = {
    /** Exact raw payload size of every piece committed to this context, in bytes. */
    pieceSizes: readonly bigint[]
    /** Whether CDN is enabled for this context's data set. */
    withCDN: boolean
    /** Existing state, or null when the upload creates a new data set. */
    dataSet: ExistingDataSetType | null
  }

  /** Resolved payer state shared by all upload contexts. */
  export type AccountType = {
    /** Current aggregate payment-rail lockup rate. */
    currentLockupRate: bigint
    /** Accrued account debt at the pricing snapshot epoch. */
    debt: bigint
    /** Funds available after settling the account at the pricing snapshot epoch. */
    availableFunds: bigint
    /** Current account runway returned by resolveAccountState. */
    runwayInEpochs: bigint
    /** Whether FWSS already has the required maximum operator approval. */
    fwssMaxApproved: boolean
  }

  export type OptionsType = {
    /** Every data-set context that will receive the upload. Must not be empty. */
    contexts: readonly ContextType[]
    /** Canonical warm storage price list. */
    priceList: getPriceList.OutputType
    /** Resolved payer state shared by all contexts. */
    account: AccountType
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to priceList.lockups.defaultLockupPeriod. */
    lockupEpochs?: bigint
    /** Extra runway beyond the required lockup. Defaults to DEFAULT_RUNWAY_EPOCHS. */
    extraRunwayEpochs?: bigint
    /** Safety margin for transaction execution delay. Defaults to DEFAULT_BUFFER_EPOCHS. */
    bufferEpochs?: bigint
  }

  export type OutputType = {
    /** Sum of the final recurring rates for all affected data sets. */
    rates: {
      /** Aggregate on-chain rate per epoch. */
      perEpoch: bigint
      /** Aggregate higher-precision rate per month for display. */
      perMonth: bigint
    }
    /** Sum of upload operation fees across all contexts. */
    fees: calculateUploadFees.OutputType
    /** Sum of additional lockups required across all contexts. */
    lockups: {
      lifecycleLockup: bigint
      /** Additional fixed lockup needed to replenish lifecycle reserves. */
      reserveReplenishment: bigint
      streamingLockup: bigint
      cdnLockup: bigint
      cacheMissLockup: bigint
      total: bigint
    }
    /** Total USDFC to deposit. 0n when the account is sufficiently funded. */
    depositNeeded: bigint
    /** Whether FWSS needs maximum operator approval. */
    needsFwssMaxApproval: boolean
    /** Whether no deposit or approval transaction is required. */
    ready: boolean
  }
}

/**
 * Calculate upload costs from already-resolved pricing, account, and data-set state.
 *
 * Context-specific rates, fees, and lockups are calculated independently and
 * summed. Account debt, available funds, runway, and the execution buffer are
 * then applied exactly once to the aggregate, making this function suitable
 * for both single-copy and multi-copy uploads.
 *
 * This function performs no network requests and does not mutate its inputs.
 * Callers must resolve existing data-set and payer state at a consistent chain
 * snapshot before calling it.
 *
 * @param options - {@link calculateUploadCosts.OptionsType}
 * @returns Aggregated upload costs and funding readiness {@link calculateUploadCosts.OutputType}
 * @throws {@link ValidationError} when no contexts are supplied or context state is invalid
 *
 * @example
 * ```ts
 * import { calculateUploadCosts } from '@filoz/synapse-core/utils'
 * import { getPriceList } from '@filoz/synapse-core/warm-storage'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 * const priceList = await getPriceList(client)
 *
 * const costs = calculateUploadCosts({
 *   contexts: [{ pieceSizes: [1_000_000n], withCDN: false, dataSet: null }],
 *   priceList,
 *   account: {
 *     currentLockupRate: 0n,
 *     debt: 0n,
 *     availableFunds: 0n,
 *     runwayInEpochs: 0n,
 *     fwssMaxApproved: true,
 *   },
 * })
 *
 * console.log(costs.depositNeeded)
 * ```
 */
export function calculateUploadCosts(options: calculateUploadCosts.OptionsType): calculateUploadCosts.OutputType {
  if (options.contexts.length === 0) {
    throw new ValidationError('contexts must contain at least one storage context')
  }

  const epochsPerMonth = options.epochsPerMonth ?? TIME_CONSTANTS.EPOCHS_PER_MONTH
  const extraRunwayEpochs = options.extraRunwayEpochs ?? DEFAULT_RUNWAY_EPOCHS
  const bufferEpochs = options.bufferEpochs ?? DEFAULT_BUFFER_EPOCHS

  let totalRateDeltaPerEpoch = 0n
  let totalLockup = 0n
  let totalLifecycleLockup = 0n
  let totalReserveReplenishment = 0n
  let totalStreamingLockup = 0n
  let totalCdnLockup = 0n
  let totalCacheMissLockup = 0n
  let totalRatePerEpoch = 0n
  let totalRatePerMonth = 0n
  let totalCreateDataSetFee = 0n
  let totalAddPiecesFee = 0n

  for (const context of options.contexts) {
    const isNewDataSet = context.dataSet == null
    const dataSetLeafCount = context.dataSet?.leafCount ?? 0n
    const addedLeafCount = pieceSizesToLeafCount(context.pieceSizes)

    const lockup = calculateAdditionalLockupRequired({
      pieceSizes: context.pieceSizes,
      dataSetLeafCount,
      priceList: options.priceList,
      epochsPerMonth,
      lockupEpochs: options.lockupEpochs,
      isNewDataSet,
      withCDN: context.withCDN,
    })
    const fees = calculateUploadFees({
      priceList: options.priceList,
      isNewDataSet,
      pieceSizes: context.pieceSizes,
    })
    const reserveFunding = calculateLifecycleReserveFunding({
      priceList: options.priceList,
      isNewDataSet,
      pieceSizes: context.pieceSizes,
      currentReserveBalance: context.dataSet?.lifecycleReserveBalance,
      pendingOneTimePayments: context.dataSet?.pendingOneTimePayments,
    })
    const rate = calculateEffectiveRate({
      sizeInBytes: leafCountToRawSize(dataSetLeafCount + addedLeafCount),
      storagePerTibPerMonth: options.priceList.rates.storagePerTibPerMonth,
      datasetFeePerMonth: options.priceList.rates.datasetFeePerMonth,
      epochsPerMonth,
    })

    totalRateDeltaPerEpoch += lockup.rateDeltaPerEpoch
    totalLockup += lockup.total + reserveFunding.replenishmentLockup
    totalLifecycleLockup += lockup.lifecycleLockup
    totalReserveReplenishment += reserveFunding.replenishmentLockup
    totalStreamingLockup += lockup.streamingLockup
    totalCdnLockup += lockup.cdnLockup
    totalCacheMissLockup += lockup.cacheMissLockup
    totalRatePerEpoch += rate.ratePerEpoch
    totalRatePerMonth += rate.ratePerMonth
    totalCreateDataSetFee += fees.createDataSetFee
    totalAddPiecesFee += fees.addPiecesFee
  }

  const netRateAfterUpload = options.account.currentLockupRate + totalRateDeltaPerEpoch
  const runway = calculateRunwayAmountFromState({ netRateAfterUpload, extraRunwayEpochs })
  const rawDepositNeeded = totalLockup + runway + options.account.debt - options.account.availableFunds
  const skipBuffer =
    options.account.currentLockupRate === 0n && options.contexts.every((context) => context.dataSet == null)
  const buffer = skipBuffer
    ? 0n
    : calculateBufferAmountFromState({
        rawDepositNeeded,
        netRateAfterUpload,
        runwayInEpochs: options.account.runwayInEpochs,
        availableFunds: options.account.availableFunds,
        bufferEpochs,
      })

  const depositNeeded = (rawDepositNeeded > 0n ? rawDepositNeeded : 0n) + buffer
  const needsFwssMaxApproval = !options.account.fwssMaxApproved
  const createDataSetFee = totalCreateDataSetFee
  const addPiecesFee = totalAddPiecesFee

  return {
    rates: {
      perEpoch: totalRatePerEpoch,
      perMonth: totalRatePerMonth,
    },
    fees: {
      createDataSetFee,
      addPiecesFee,
      total: createDataSetFee + addPiecesFee,
    },
    lockups: {
      lifecycleLockup: totalLifecycleLockup,
      reserveReplenishment: totalReserveReplenishment,
      streamingLockup: totalStreamingLockup,
      cdnLockup: totalCdnLockup,
      cacheMissLockup: totalCacheMissLockup,
      total: totalLockup,
    },
    depositNeeded,
    needsFwssMaxApproval,
    ready: depositNeeded === 0n && !needsFwssMaxApproval,
  }
}
