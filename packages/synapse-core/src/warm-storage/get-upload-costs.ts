import type { Address, Chain, Client, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { ValidationError } from '../errors/base.ts'
import { calculateAccountDebt } from '../pay/account-debt.ts'
import { accounts } from '../pay/accounts.ts'
import { isFwssMaxApproved } from '../pay/is-fwss-max-approved.ts'
import { resolveAccountState } from '../pay/resolve-account-state.ts'
import { calculateUploadCosts } from '../utils/calculate-upload-costs.ts'
import { getPriceList } from './price-list.ts'

export namespace getUploadCosts {
  export type OptionsType = {
    /** The payer address to check account state and approval for. */
    clientAddress: Address

    /** Whether a new dataset will be created. Default: true */
    isNewDataSet?: boolean
    /** Whether CDN is enabled. Default: false */
    withCDN?: boolean
    /** Aggregate leaf count reported by PDP Verifier. Required for an existing data set. */
    dataSetLeafCount?: bigint
    /** Current lifecycle reserve balance. Required for an existing data set. */
    currentLifecycleReserveBalance?: bigint
    /** One-time operation fees already pending on an existing data set. Defaults to 0. */
    pendingOneTimePayments?: bigint

    /** Exact raw payload size of every piece added by this operation, in bytes. */
    pieceSizes: readonly bigint[]

    /** Extra runway in epochs beyond the required lockup. */
    extraRunwayEpochs?: bigint
    /** Safety margin in epochs. Default: 5n */
    bufferEpochs?: bigint
  }

  /** Upload costs calculated from the resolved single-context state. */
  export type OutputType = calculateUploadCosts.OutputType
}

/**
 * Read-only function that computes upload costs, reserve-aware deposit needed,
 * and approval state.
 *
 * Fetches account state, pricing, and approval via read-only contract calls,
 * then delegates all cost arithmetic to the shared pure
 * `calculateUploadCosts` utility. Existing-data-set calls must provide
 * `dataSetLeafCount` and `currentLifecycleReserveBalance`; pass
 * `pendingOneTimePayments` when the data set has unflushed lifecycle fees.
 *
 * @param client - The client to use to compute upload costs.
 * @param options - {@link getUploadCosts.OptionsType}
 * @returns {@link getUploadCosts.OutputType}
 * @throws {@link ValidationError} when existing-data-set state, leaf count, or piece sizes are invalid
 */
export async function getUploadCosts(
  client: Client<Transport, Chain>,
  options: getUploadCosts.OptionsType
): Promise<getUploadCosts.OutputType> {
  const isNewDataSet = options.isNewDataSet ?? true
  const withCDN = options.withCDN ?? false

  let dataSet: calculateUploadCosts.ExistingDataSetType | null = null
  if (!isNewDataSet) {
    const leafCount = options.dataSetLeafCount
    const lifecycleReserveBalance = options.currentLifecycleReserveBalance
    if (leafCount == null) {
      throw new ValidationError('dataSetLeafCount is required for an existing data set')
    }
    if (lifecycleReserveBalance == null) {
      throw new ValidationError('currentLifecycleReserveBalance is required for an existing data set')
    }
    dataSet = {
      leafCount,
      lifecycleReserveBalance,
      pendingOneTimePayments: options.pendingOneTimePayments ?? 0n,
    }
  }

  // Fetch all needed data in parallel
  const [accountInfo, priceList, currentEpoch] = await Promise.all([
    accounts(client, { address: options.clientAddress }),
    getPriceList(client),
    getBlockNumber(client, { cacheTime: 0 }),
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

  return calculateUploadCosts({
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
}
