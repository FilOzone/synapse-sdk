import type { Address, Chain, Client, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { calculateAccountDebt } from '../pay/account-debt.ts'
import { accounts } from '../pay/accounts.ts'
import { isFwssMaxApproved } from '../pay/is-fwss-max-approved.ts'
import { DEFAULT_BUFFER_EPOCHS, DEFAULT_RUNWAY_EPOCHS, LOCKUP_PERIOD } from '../utils/constants.ts'
import { calculateDepositNeeded } from './calculate-deposit-needed.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'
import { getServicePrice } from './get-service-price.ts'

export namespace getUploadCosts {
  export type OptionsType = {
    /** The payer address to check account state and approval for. */
    clientAddress: Address

    /** Whether a new dataset will be created. Default: true */
    isNewDataSet?: boolean
    /** Whether CDN is enabled. Default: false */
    withCDN?: boolean
    /** Current total data size in the existing dataset, in bytes. */
    currentDataSetSize?: bigint

    /** Size of new data to upload, in bytes. */
    dataSize: bigint

    /** Extra runway in epochs beyond the required lockup. */
    runwayEpochs?: bigint
    /** Safety margin in epochs. Default: 5n */
    bufferEpochs?: bigint
  }

  export type OutputType = {
    /** Effective rate for the dataset after adding dataSize bytes. */
    rate: {
      /** Rate per epoch — matches on-chain PDP rail rate. */
      perEpoch: bigint
      /** Rate per month — full precision for display. */
      perMonth: bigint
    }
    /** Total USDFC to deposit. 0n if sufficient funds available. */
    depositNeeded: bigint
    /** Whether FWSS needs to be approved (or re-approved with maxUint256). */
    needsFwssMaxApproval: boolean
    /** True when depositNeeded == 0n and needsFwssMaxApproval == false. */
    ready: boolean
  }
}

/**
 * Read-only function that computes upload costs, deposit needed, and approval state.
 *
 * Fetches account state, pricing, and approval via read-only contract calls,
 * then feeds results into pure calculation functions.
 *
 * @param client - Read-only viem client
 * @param options - {@link getUploadCosts.OptionsType}
 * @returns {@link getUploadCosts.OutputType}
 */
export async function getUploadCosts(
  client: Client<Transport, Chain>,
  options: getUploadCosts.OptionsType
): Promise<getUploadCosts.OutputType> {
  const isNewDataSet = options.isNewDataSet ?? true
  const withCDN = options.withCDN ?? false
  const currentDataSetSize = options.currentDataSetSize ?? 0n
  const runwayEpochs = options.runwayEpochs ?? DEFAULT_RUNWAY_EPOCHS
  const bufferEpochs = options.bufferEpochs ?? DEFAULT_BUFFER_EPOCHS

  // Fetch all needed data in parallel
  const [accountInfo, pricing, approved, currentEpoch] = await Promise.all([
    accounts(client, { address: options.clientAddress }),
    getServicePrice(client),
    isFwssMaxApproved(client, { clientAddress: options.clientAddress }),
    getBlockNumber(client, { cacheTime: 0 }),
  ])

  // Calculate effective rate for the new total dataset size
  const totalSize = isNewDataSet ? options.dataSize : currentDataSetSize + options.dataSize
  const rate = calculateEffectiveRate({
    sizeInBytes: totalSize,
    pricePerTiBPerMonth: pricing.pricePerTiBPerMonthNoCDN,
    minimumPricePerMonth: pricing.minimumPricePerMonth,
    epochsPerMonth: pricing.epochsPerMonth,
  })

  // Calculate account debt
  const debtInfo = calculateAccountDebt({
    funds: accountInfo.funds,
    lockupCurrent: accountInfo.lockupCurrent,
    lockupRate: accountInfo.lockupRate,
    lockupLastSettledAt: accountInfo.lockupLastSettledAt,
    currentEpoch,
  })

  // Calculate deposit needed
  const depositNeeded = calculateDepositNeeded({
    dataSize: options.dataSize,
    currentDataSetSize,
    pricePerTiBPerMonth: pricing.pricePerTiBPerMonthNoCDN,
    minimumPricePerMonth: pricing.minimumPricePerMonth,
    epochsPerMonth: pricing.epochsPerMonth,
    lockupEpochs: LOCKUP_PERIOD,
    isNewDataset: isNewDataSet,
    withCDN,
    currentLockupRate: accountInfo.lockupRate,
    runwayEpochs,
    debt: debtInfo.debt,
    availableFunds: debtInfo.availableFunds,
    fundedUntilEpoch: debtInfo.fundedUntilEpoch,
    currentEpoch,
    bufferEpochs,
  })

  const needsFwssMaxApproval = !approved

  return {
    rate: {
      perEpoch: rate.ratePerEpoch,
      perMonth: rate.ratePerMonth,
    },
    depositNeeded,
    needsFwssMaxApproval,
    ready: depositNeeded === 0n && !needsFwssMaxApproval,
  }
}
