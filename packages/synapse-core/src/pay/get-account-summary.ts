import type { Address, Chain, Client, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { TIME_CONSTANTS } from '../utils/constants.ts'
import { calculateAccountDebt } from './account-debt.ts'
import { accounts } from './accounts.ts'
import { resolveAccountState } from './resolve-account-state.ts'
import { totalAccountFixedLockup } from './total-account-fixed-lockup.ts'

export namespace getAccountSummary {
  export type OptionsType = {
    /** The address of the account to query. */
    address: Address
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Epoch to evaluate at. If not provided, current block number is fetched. */
    epoch?: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = {
    /** Total deposited funds in the contract */
    funds: bigint
    /** Funds available for withdrawal or new commitments */
    availableFunds: bigint
    /** Outstanding debt (0n if healthy) */
    debt: bigint

    /** Per-epoch lockup rate (aggregate across all rails) */
    lockupRatePerEpoch: bigint
    /** Per-month lockup rate (lockupRatePerEpoch * EPOCHS_PER_MONTH) */
    lockupRatePerMonth: bigint

    /** Total effective lockup at the given epoch (fixed + rate-based) */
    totalLockup: bigint
    /** Sum of lockupFixed across all rails (CDN deposits, etc.) */
    totalFixedLockup: bigint
    /** Rate-based portion of lockup (totalLockup - totalFixedLockup) */
    totalRateBasedLockup: bigint

    /**
     * Absolute epoch at which funds run out at the current lockup rate.
     * `maxUint256` when `lockupRate` is 0n.
     */
    fundedUntilEpoch: bigint
    /**
     * Number of epochs that can pass from `epoch` before the account runs out
     * of funds at the current lockup rate — i.e. how long until the user needs
     * to deposit more funds. `maxUint256` when `lockupRatePerEpoch` is 0n
     * (no drain), `0n` when the account is already insolvent.
     */
    runwayInEpochs: bigint
    /** The epoch used for all calculations */
    epoch: bigint
  }

  export type ErrorType = accounts.ErrorType | totalAccountFixedLockup.ErrorType
}

/**
 * Get a comprehensive account summary from the Payments contract.
 *
 * Fetches account state, fixed lockup totals, and (optionally) current epoch
 * in parallel, then derives debt, available funds, lockup breakdown, and
 * funded-until timeline client-side.
 *
 * @param client - The client to use for the query.
 * @param options - {@link getAccountSummary.OptionsType}
 * @returns Full account summary {@link getAccountSummary.OutputType}
 * @throws Errors {@link getAccountSummary.ErrorType}
 *
 * @example
 * ```ts
 * import { getAccountSummary } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const summary = await getAccountSummary(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log('Available:', summary.availableFunds)
 * console.log('Funded until epoch:', summary.fundedUntilEpoch)
 * console.log('Runway in epochs:', summary.runwayInEpochs)
 * ```
 */
export async function getAccountSummary(
  client: Client<Transport, Chain>,
  options: getAccountSummary.OptionsType
): Promise<getAccountSummary.OutputType> {
  const { address, token, epoch, contractAddress } = options

  // Parallel RPC: accounts + fixedLockup + (optionally) blockNumber
  const [accountInfo, fixedLockupResult, resolvedEpoch] = await Promise.all([
    accounts(client, { address, token, contractAddress, blockNumber: epoch }),
    totalAccountFixedLockup(client, { address, token, contractAddress }),
    epoch ?? getBlockNumber(client, { cacheTime: 0 }),
  ])

  const params = {
    funds: accountInfo.funds,
    lockupCurrent: accountInfo.lockupCurrent,
    lockupRate: accountInfo.lockupRate,
    lockupLastSettledAt: accountInfo.lockupLastSettledAt,
    currentEpoch: resolvedEpoch,
  }

  const { fundedUntilEpoch, availableFunds, runwayInEpochs } = resolveAccountState(params)
  const debt = calculateAccountDebt(params)

  const totalLockup = accountInfo.funds > availableFunds ? accountInfo.funds - availableFunds : 0n
  const { totalFixedLockup } = fixedLockupResult
  const totalRateBasedLockup = totalLockup > totalFixedLockup ? totalLockup - totalFixedLockup : 0n

  return {
    funds: accountInfo.funds,
    availableFunds,
    debt,

    lockupRatePerEpoch: accountInfo.lockupRate,
    lockupRatePerMonth: accountInfo.lockupRate * TIME_CONSTANTS.EPOCHS_PER_MONTH,

    totalLockup,
    totalFixedLockup,
    totalRateBasedLockup,

    fundedUntilEpoch,
    runwayInEpochs,
    epoch: resolvedEpoch,
  }
}
