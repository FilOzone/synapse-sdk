import type { Address, Chain, Client, GetBlockNumberErrorType, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { ValidationError } from '../errors/base.ts'
import type { ServiceAlreadyTerminatedError } from '../errors/pdp.ts'
import { DataSetNotFoundError } from '../errors/warm-storage.ts'
import { calculateAccountDebt } from '../pay/account-debt.ts'
import { accounts } from '../pay/accounts.ts'
import { isFwssMaxApproved } from '../pay/is-fwss-max-approved.ts'
import { resolveAccountState } from '../pay/resolve-account-state.ts'
import { getDataSetLeafCount } from '../pdp-verifier/get-data-set-leaf-count.ts'
import { calculateUploadCosts } from '../utils/calculate-upload-costs.ts'
import { resolveUploadDataSet, type UploadDataSetState } from '../utils/resolve-upload-data-set.ts'
import { getDataSet } from './get-data-set.ts'
import { getPriceList } from './price-list.ts'

export namespace getUploadCosts {
  export type OptionsType = {
    /** The payer address to check account state and approval for. */
    clientAddress: Address

    /**
     * ID of the existing data set that will receive the upload. When set, the
     * data set's leaf count, lifecycle reserve balance, pending one-time
     * payments and PDP end epoch are read on-chain and the upload is priced as
     * an addition to it. Cannot be combined with `isNewDataSet: true` or with
     * the explicit existing-data-set fields below.
     */
    dataSetId?: bigint
    /** Whether a new dataset will be created. Default: `false` when `dataSetId` is set, otherwise `true` */
    isNewDataSet?: boolean
    /** Whether CDN is enabled. Default: false */
    withCDN?: boolean
    /** Aggregate leaf count reported by PDP Verifier. Required for an existing data set without `dataSetId`. */
    dataSetLeafCount?: bigint
    /** Current lifecycle reserve balance. Required for an existing data set without `dataSetId`. */
    currentLifecycleReserveBalance?: bigint
    /** One-time operation fees already pending on an existing data set. Defaults to 0. */
    pendingOneTimePayments?: bigint
    /** Epoch at which the PDP payment rail ends. Required for an existing data set without `dataSetId`; must be 0n. */
    pdpEndEpoch?: bigint

    /** Exact raw payload size of every piece planned for upload, in bytes. */
    pieceSizes: readonly bigint[]

    /** Extra runway in epochs beyond the required lockup. */
    extraRunwayEpochs?: bigint
    /** Safety margin in epochs. Default: 5n */
    bufferEpochs?: bigint
  }

  /** Upload costs calculated from the resolved single-context state. */
  export type OutputType = calculateUploadCosts.OutputType & {
    /**
     * Payer account state at the pricing snapshot epoch, as used to calculate
     * `depositNeeded`. The available balance after depositing is
     * `availableFunds + depositNeeded - debt`.
     */
    account: {
      /** Funds available after settling the account at the pricing snapshot epoch. */
      availableFunds: bigint
      /** Accrued account debt at the pricing snapshot epoch. */
      debt: bigint
      /** Epochs until the account enters deficit; `maxUint256` when nothing is being spent. */
      runwayInEpochs: bigint
    }
  }

  export type ErrorType =
    | ValidationError
    | DataSetNotFoundError
    | ServiceAlreadyTerminatedError
    | getDataSet.ErrorType
    | getDataSetLeafCount.ErrorType
    | accounts.ErrorType
    | getPriceList.ErrorType
    | isFwssMaxApproved.ErrorType
    | GetBlockNumberErrorType
}

/**
 * Read-only function that computes upload costs, reserve-aware deposit needed,
 * and approval state.
 *
 * Fetches account state, pricing, and approval via read-only contract calls,
 * then delegates all cost arithmetic to the shared pure
 * `calculateUploadCosts` utility. To price an upload to an existing data set,
 * pass `dataSetId` and its state is read on-chain. Callers that already hold
 * that state can instead pass `isNewDataSet: false` with `dataSetLeafCount`,
 * `currentLifecycleReserveBalance`, and `pdpEndEpoch`, plus
 * `pendingOneTimePayments` when the data set has unflushed lifecycle fees.
 * Multi-piece fee and reserve estimates conservatively treat each piece as a
 * separate add-pieces operation because actual batching is runtime-dependent.
 *
 * Approval is checked with `isFwssMaxApproved`: only an unlimited FWSS
 * approval counts. A bounded approval reports `needsFwssMaxApproval: true`
 * and `ready: false`, even when its remaining allowances cover this upload.
 *
 * The result includes the payer `account` values used in the calculation, so
 * callers can show the balance after depositing without reading the account
 * again.
 *
 * @param client - The client to use to compute upload costs.
 * @param options - {@link getUploadCosts.OptionsType}
 * @returns {@link getUploadCosts.OutputType}
 * @throws When existing-data-set state or piece sizes are invalid, the data set does not exist, or the data-set service is terminated {@link getUploadCosts.ErrorType}
 *
 * @example
 * ```ts
 * import { getUploadCosts } from '@filoz/synapse-core/warm-storage'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const costs = await getUploadCosts(client, {
 *   clientAddress: '0x1234567890123456789012345678901234567890',
 *   dataSetId: 1n,
 *   pieceSizes: [1_000_000n],
 * })
 *
 * const { availableFunds, debt } = costs.account
 * console.log(costs.depositNeeded, availableFunds + costs.depositNeeded - debt)
 * ```
 */
export async function getUploadCosts(
  client: Client<Transport, Chain>,
  options: getUploadCosts.OptionsType
): Promise<getUploadCosts.OutputType> {
  const withCDN = options.withCDN ?? false

  // Validate inputs before any chain read.
  let explicitDataSet: UploadDataSetState | null = null
  if (options.dataSetId == null) {
    explicitDataSet = resolveUploadDataSet({
      isNewDataSet: options.isNewDataSet ?? true,
      dataSetLeafCount: options.dataSetLeafCount,
      currentLifecycleReserveBalance: options.currentLifecycleReserveBalance,
      pendingOneTimePayments: options.pendingOneTimePayments,
      pdpEndEpoch: options.pdpEndEpoch,
    })
  } else {
    assertDataSetIdOptions(options)
  }

  // Fetch all needed data in parallel
  const [accountInfo, priceList, currentEpoch, dataSet] = await Promise.all([
    accounts(client, { address: options.clientAddress }),
    getPriceList(client),
    getBlockNumber(client, { cacheTime: 0 }),
    options.dataSetId == null ? explicitDataSet : readUploadDataSet(client, options.dataSetId),
  ])

  // Reuse the fetched price list's lockup period so the approval check
  // doesn't read getPriceList again.
  const approved = await isFwssMaxApproved(client, {
    clientAddress: options.clientAddress,
    requiredMaxLockupPeriod: priceList.lockups.defaultLockupPeriod,
  })

  const accountParams = {
    funds: accountInfo.funds,
    lockupCurrent: accountInfo.lockupCurrent,
    lockupRate: accountInfo.lockupRate,
    lockupLastSettledAt: accountInfo.lockupLastSettledAt,
    currentEpoch,
  }
  const debt = calculateAccountDebt(accountParams)
  const { availableFunds, runwayInEpochs } = resolveAccountState(accountParams)

  const costs = calculateUploadCosts({
    contexts: [{ pieceSizes: options.pieceSizes, withCDN, dataSet }],
    priceList,
    account: {
      currentLockupRate: accountInfo.lockupRate,
      debt,
      availableFunds,
      runwayInEpochs,
      fwssMaxApproved: approved,
    },
    extraRunwayEpochs: options.extraRunwayEpochs,
    bufferEpochs: options.bufferEpochs,
  })

  return {
    ...costs,
    account: { availableFunds, debt, runwayInEpochs },
  }
}

/** Throw when `dataSetId` is combined with options that describe the data set another way. */
function assertDataSetIdOptions(options: getUploadCosts.OptionsType): void {
  if (options.isNewDataSet === true) {
    throw new ValidationError('dataSetId cannot be combined with isNewDataSet: true')
  }
  if (
    options.dataSetLeafCount != null ||
    options.currentLifecycleReserveBalance != null ||
    options.pendingOneTimePayments != null ||
    options.pdpEndEpoch != null
  ) {
    throw new ValidationError(
      'dataSetId cannot be combined with dataSetLeafCount, currentLifecycleReserveBalance, pendingOneTimePayments or pdpEndEpoch'
    )
  }
}

/** Read and validate the on-chain state of an existing data set. */
async function readUploadDataSet(
  client: Client<Transport, Chain>,
  dataSetId: bigint
): Promise<UploadDataSetState | null> {
  const [dataSet, leafCount] = await Promise.all([
    getDataSet(client, { dataSetId }),
    getDataSetLeafCount(client, { dataSetId }),
  ])
  if (dataSet == null) {
    throw new DataSetNotFoundError(dataSetId)
  }

  return resolveUploadDataSet({
    isNewDataSet: false,
    dataSetLeafCount: leafCount,
    currentLifecycleReserveBalance: dataSet.lifecycleReserveBalance,
    pendingOneTimePayments: dataSet.pendingOneTimePayments,
    pdpEndEpoch: dataSet.pdpEndEpoch,
  })
}
