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
    /** Total deposited funds in the contract. */
    funds: bigint
    /**
     * Funds available for withdrawal or new rail commitments at `epoch`.
     * Equal to `funds - totalLockup`, the *unreserved* portion described on
     * {@link runwayInEpochs}. Active payments draw from this; once it reaches
     * zero, settlement halts.
     */
    availableFunds: bigint
    /**
     * Outstanding payment obligation that couldn't be moved into
     * `lockupCurrent` because `funds` was insufficient. `0n` when the account
     * is healthy; positive when in deficit. Effectively the gap between the
     * lockup the account should be holding and what it actually holds.
     */
    debt: bigint

    /** Per-epoch lockup rate (aggregate across all rails). */
    lockupRatePerEpoch: bigint
    /** Per-month lockup rate (`lockupRatePerEpoch * EPOCHS_PER_MONTH`). */
    lockupRatePerMonth: bigint

    /** Total effective lockup at `epoch` (fixed + rate-based). */
    totalLockup: bigint
    /**
     * Sum of `lockupFixed` across all rails. Reserved for one-time payments,
     * for example, FWSS CDN egress and cache miss credits, rather than
     * streaming rate.
     */
    totalFixedLockup: bigint
    /** Rate-based portion of lockup (`totalLockup - totalFixedLockup`). */
    totalRateBasedLockup: bigint

    /**
     * Epochs from `epoch` until this account enters deficit and the standard
     * payment flow to providers halts. Treat as "when must the user act?".
     *
     * The account holds a reserve in `totalLockup`, set aside as a payment
     * guarantee for the providers this account is paying. Each rail
     * contributes its own piece of the reserve under its own terms (typically
     * a streaming guarantee tied to that rail's payment period). Active
     * payments draw from `availableFunds` (`funds - totalLockup`). Once
     * `availableFunds` reaches zero, the account is in deficit: standard
     * settlement of active rails halts and providers stop being paid for
     * new epochs even though `funds` is still positive. The reserve is not
     * automatically spent. It becomes claimable only after a provider
     * terminates the rail (settlement then proceeds up to one `lockupPeriod`
     * from the last solvent epoch, drawing from the reserve). Termination
     * is one-way: once a rail has an `endEpoch` it's heading to
     * finalization and topping up the account won't revive it. Providers
     * may keep serving briefly in deficit, but the user should top up
     * before reaching this point to keep existing rails alive.
     *
     * - `maxUint256` when `lockupRatePerEpoch` is 0n (nothing is being spent).
     * - `0n` when the account is already past this point (in deficit).
     *
     * To get the absolute epoch form, add `epoch` (skip when this is
     * `maxUint256`).
     */
    runwayInEpochs: bigint
    /**
     * Total spend the account's `funds` would cover at `lockupRatePerEpoch`,
     * calculated as `funds / lockupRatePerEpoch`. Treat as "how much
     * coverage has the user prepaid in total?".
     *
     * Always >= {@link runwayInEpochs}, typically by roughly the size of
     * the reserve held in `totalLockup`. `runwayInEpochs` accounts for the
     * reserve as a floor that halts settlement; `grossCoverageInEpochs`
     * treats `funds` as a single bucket without modeling whether the
     * reserve is actually flowing as ongoing payment.
     *
     * Useful as a complement to `runwayInEpochs` in user-facing displays,
     * e.g. "your deposit covers ~X days of storage in total; you have ~Y
     * days of runway before your account enters deficit".
     *
     * - `maxUint256` when `lockupRatePerEpoch` is 0n (nothing is being
     *   spent; takes precedence over `funds === 0n`).
     * - `0n` when `funds` is 0n and `lockupRatePerEpoch` is positive.
     */
    grossCoverageInEpochs: bigint
    /** The epoch used for all calculations. */
    epoch: bigint
  }

  export type ErrorType = accounts.ErrorType | totalAccountFixedLockup.ErrorType
}

/**
 * Get a comprehensive account summary from the Payments contract.
 *
 * Fetches account state, fixed lockup totals, and (optionally) current epoch
 * in parallel, then derives debt, available funds, lockup breakdown, runway,
 * and gross coverage client-side.
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
 * console.log('Runway in epochs:', summary.runwayInEpochs)
 * console.log('Gross coverage in epochs:', summary.grossCoverageInEpochs)
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

  const { availableFunds, runwayInEpochs, grossCoverageInEpochs } = resolveAccountState(params)
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

    runwayInEpochs,
    grossCoverageInEpochs,
    epoch: resolvedEpoch,
  }
}
