import type {
  Account,
  Chain,
  Client,
  Hash,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { maxUint256 } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
import type { ActionSyncCallback } from '../types.ts'
import { LOCKUP_PERIOD } from '../utils/constants.ts'
import { depositWithPermit } from './deposit-with-permit.ts'
import { isFwssMaxApproved } from './is-fwss-max-approved.ts'
import { depositAndApprove } from './payments.ts'
import { setOperatorApproval } from './set-operator-approval.ts'

export namespace fund {
  export type OptionsType = {
    /** Amount of USDFC to deposit. 0n when only FWSS approval is needed. */
    amount: bigint
    /** Override for FWSS approval state. When omitted, checks via isFwssMaxApproved RPC. */
    needsFwssMaxApproval?: boolean
  }

  export type ErrorType =
    | depositWithPermit.ErrorType
    | setOperatorApproval.ErrorType
    | isFwssMaxApproved.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
}

/**
 * Smart deposit that picks the right contract call based on FWSS approval state
 *
 * Routes to the appropriate action based on current state:
 * - Needs approval + amount > 0: `depositAndApprove` (deposit with permit + approve FWSS operator)
 * - Needs approval + amount === 0: `setOperatorApproval` (approve FWSS operator only)
 * - Already approved + amount > 0: `depositWithPermit` (deposit only via permit)
 * - Already approved + amount === 0: no-op, returns `'0x'`
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link fund.OptionsType}
 * @returns The transaction hash (or `'0x'` for no-op)
 * @throws Errors {@link fund.ErrorType}
 *
 * @example
 * ```ts
 * import { fund } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http, parseUnits } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Deposit 100 USDFC (auto-detects approval state)
 * const hash = await fund(client, {
 *   amount: parseUnits('100', 18),
 * })
 *
 * console.log(hash)
 * ```
 */
export async function fund(client: Client<Transport, Chain, Account>, options: fund.OptionsType): Promise<Hash> {
  const needsApproval =
    options.needsFwssMaxApproval ?? !(await isFwssMaxApproved(client, { clientAddress: client.account.address }))

  if (needsApproval && options.amount > 0n) {
    return depositAndApprove(client, {
      amount: options.amount,
      rateAllowance: maxUint256,
      lockupAllowance: maxUint256,
      maxLockupPeriod: LOCKUP_PERIOD,
    })
  }

  if (needsApproval && options.amount === 0n) {
    return setOperatorApproval(client, {
      approve: true,
      rateAllowance: maxUint256,
      lockupAllowance: maxUint256,
      maxLockupPeriod: LOCKUP_PERIOD,
    })
  }

  if (options.amount > 0n) {
    return depositWithPermit(client, { amount: options.amount })
  }

  // Already approved, no deposit needed
  return '0x' as Hash
}

export namespace fundSync {
  export type OptionsType = fund.OptionsType & ActionSyncCallback

  export type OutputType = {
    /** The transaction hash (or `'0x'` for no-op) */
    hash: Hash
    /** The transaction receipt, or null for no-op */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>> | null
  }

  export type ErrorType = fund.ErrorType | WaitForTransactionReceiptErrorType
}

/**
 * Smart deposit and wait for confirmation
 *
 * Calls {@link fund} and waits for the transaction receipt.
 * For no-op cases (already approved, no deposit), returns a null receipt.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link fundSync.OptionsType}
 * @returns The transaction hash and receipt {@link fundSync.OutputType}
 * @throws Errors {@link fundSync.ErrorType}
 *
 * @example
 * ```ts
 * import { fundSync } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http, parseUnits } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { hash, receipt } = await fundSync(client, {
 *   amount: parseUnits('100', 18),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * if (receipt) {
 *   console.log('Confirmed in block:', receipt.blockNumber)
 * }
 * ```
 */
export async function fundSync(
  client: Client<Transport, Chain, Account>,
  options: fundSync.OptionsType
): Promise<fundSync.OutputType> {
  const hash = await fund(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  // No-op case: skip waitForTransactionReceipt
  if (hash === '0x') {
    return { hash, receipt: null }
  }

  const receipt = await waitForTransactionReceipt(client, { hash })

  return { hash, receipt }
}
