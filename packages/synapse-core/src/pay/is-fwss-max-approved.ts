import type { Address, Chain, Client, ReadContractErrorType, Transport } from 'viem'
import { maxUint256 } from 'viem'
import type { asChain } from '../chains.ts'
import { LOCKUP_PERIOD } from '../utils/constants.ts'
import { operatorApprovals } from './operator-approvals.ts'

export namespace isFwssMaxApproved {
  export type OptionsType = {
    /** The address of the client to check approval for. */
    clientAddress: Address
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Check whether FWSS is approved with maxUint256 rate/lockup allowances
 * and at least LOCKUP_PERIOD (30 days) for maxLockupPeriod.
 *
 * Returns `true` when `isApproved && rateAllowance === maxUint256
 * && lockupAllowance === maxUint256 && maxLockupPeriod >= LOCKUP_PERIOD`.
 *
 * @param client - Read-only viem client
 * @param options - {@link isFwssMaxApproved.OptionsType}
 * @returns `true` if FWSS is fully approved with sufficient allowances
 */
export async function isFwssMaxApproved(
  client: Client<Transport, Chain>,
  options: isFwssMaxApproved.OptionsType
): Promise<boolean> {
  const approval = await operatorApprovals(client, {
    address: options.clientAddress,
  })

  return (
    approval.isApproved &&
    approval.rateAllowance === maxUint256 &&
    approval.lockupAllowance === maxUint256 &&
    approval.maxLockupPeriod >= LOCKUP_PERIOD
  )
}
