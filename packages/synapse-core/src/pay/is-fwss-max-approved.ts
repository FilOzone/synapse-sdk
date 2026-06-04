import type { Address, Chain, Client, ReadContractErrorType, Transport } from 'viem'
import { maxUint256 } from 'viem'
import type { asChain } from '../chains.ts'
import { getPriceList } from '../warm-storage/price-list.ts'
import { operatorApprovals } from './operator-approvals.ts'

export namespace isFwssMaxApproved {
  export type OptionsType = {
    /** The address of the client to check approval for. */
    clientAddress: Address
    /**
     * The lockup period the approval must cover. Defaults to the chain's
     * `getPriceList().lockups.defaultLockupPeriod`. Callers that already hold
     * the price list can pass it to skip the extra read.
     */
    requiredMaxLockupPeriod?: bigint
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | getPriceList.ErrorType
}

/**
 * Check whether FWSS is approved with sufficient rate/lockup allowances and a
 * `maxLockupPeriod` covering the chain's default lockup period.
 *
 * rateAllowance is checked for exact maxUint256 since the contract never
 * decrements it — it only tracks usage separately via rateUsage.
 *
 * lockupAllowance uses a >= maxUint256 / 2 threshold instead of exact equality
 * because the contract permanently decrements lockupAllowance on one-time
 * payments (e.g. when settleFilBeamPaymentRails processes CDN egress charges).
 * After initially approving with maxUint256, each CDN settlement reduces
 * lockupAllowance by the one-time payment amount, causing an exact === check
 * to fail and unnecessarily prompt the user for a new approval transaction.
 * Half of maxUint256 is still astronomically large — no realistic usage would
 * ever cross this threshold.
 *
 * @param client - Read-only viem client
 * @param options - {@link isFwssMaxApproved.OptionsType}
 * @returns `true` if FWSS is fully approved with sufficient allowances
 */
export async function isFwssMaxApproved(
  client: Client<Transport, Chain>,
  options: isFwssMaxApproved.OptionsType
): Promise<boolean> {
  const requiredMaxLockupPeriod =
    options.requiredMaxLockupPeriod ?? (await getPriceList(client)).lockups.defaultLockupPeriod

  const approval = await operatorApprovals(client, {
    address: options.clientAddress,
  })

  return (
    approval.isApproved &&
    approval.rateAllowance === maxUint256 &&
    approval.lockupAllowance >= maxUint256 / 2n &&
    approval.maxLockupPeriod >= requiredMaxLockupPeriod
  )
}
