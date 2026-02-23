import type { Simplify } from 'type-fest'
import type {
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  Hash,
  Log,
  SimulateContractErrorType,
  Transport,
  WaitForTransactionReceiptErrorType,
  WriteContractErrorType,
} from 'viem'
import { isAddressEqual, maxUint256, parseEventLogs } from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { filecoinPay as paymentsAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { LOCKUP_PERIOD } from '../utils/constants.ts'

export namespace setOperatorApproval {
  export type OptionsType = {
    /** The address of the ERC20 token. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The address of the operator to approve/revoke. If not provided, the Warm Storage contract address will be used. */
    operator?: Address
    /** Whether to approve (true) or revoke (false) the operator. */
    approve: boolean
    /** Maximum rate the operator can use per epoch (in token base units). Defaults to maxUint256 when approving, 0n when revoking. */
    rateAllowance?: bigint
    /** Maximum lockup amount the operator can use (in token base units). Defaults to maxUint256 when approving, 0n when revoking. */
    lockupAllowance?: bigint
    /** Maximum lockup period in epochs the operator can set for payment rails. Defaults to 30 days in epochs when approving, 0n when revoking. */
    maxLockupPeriod?: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ErrorType = setOperatorApprovalCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Set operator approval on the Filecoin Pay contract
 *
 * Approves or revokes an operator to act on behalf of the caller's account.
 * When approving, defaults to maximum allowances (maxUint256) and 30-day lockup period.
 * When revoking, defaults to zero allowances.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link setOperatorApproval.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link setOperatorApproval.ErrorType}
 *
 * @example
 * ```ts
 * import { setOperatorApproval } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
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
 * // Approve operator with defaults
 * const hash = await setOperatorApproval(client, {
 *   approve: true,
 * })
 *
 * // Revoke operator
 * const revokeHash = await setOperatorApproval(client, {
 *   approve: false,
 * })
 *
 * console.log(hash)
 * ```
 */
export async function setOperatorApproval(
  client: Client<Transport, Chain, Account>,
  options: setOperatorApproval.OptionsType
): Promise<Hash> {
  const { request } = await simulateContract(
    client,
    setOperatorApprovalCall({
      chain: client.chain,
      token: options.token,
      operator: options.operator,
      approve: options.approve,
      rateAllowance: options.rateAllowance,
      lockupAllowance: options.lockupAllowance,
      maxLockupPeriod: options.maxLockupPeriod,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace setOperatorApprovalSync {
  export type OptionsType = Simplify<setOperatorApproval.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractSetOperatorApprovalEvent>

  export type ErrorType =
    | setOperatorApprovalCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Set operator approval on the Filecoin Pay contract and wait for confirmation
 *
 * Approves or revokes an operator to act on behalf of the caller's account.
 * Waits for the transaction to be confirmed and returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link setOperatorApprovalSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link setOperatorApprovalSync.OutputType}
 * @throws Errors {@link setOperatorApprovalSync.ErrorType}
 *
 * @example
 * ```ts
 * import { setOperatorApprovalSync } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
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
 * const { receipt, event } = await setOperatorApprovalSync(client, {
 *   approve: true,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Approved:', event.args.approved)
 * console.log('Rate allowance:', event.args.rateAllowance)
 * ```
 */
export async function setOperatorApprovalSync(
  client: Client<Transport, Chain, Account>,
  options: setOperatorApprovalSync.OptionsType
): Promise<setOperatorApprovalSync.OutputType> {
  const hash = await setOperatorApproval(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractSetOperatorApprovalEvent(receipt.logs)

  return { receipt, event }
}

export namespace setOperatorApprovalCall {
  export type OptionsType = Simplify<setOperatorApproval.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType | ValidationError
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'nonpayable', 'setOperatorApproval'>
}

/**
 * Create a call to the setOperatorApproval function
 *
 * This function is used to create a call to the setOperatorApproval function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link setOperatorApprovalCall.OptionsType}
 * @returns The call to the setOperatorApproval function {@link setOperatorApprovalCall.OutputType}
 * @throws Errors {@link setOperatorApprovalCall.ErrorType}
 *
 * @example
 * ```ts
 * import { setOperatorApprovalCall } from '@filoz/synapse-core/pay'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Use with simulateContract
 * const { request } = await simulateContract(client, setOperatorApprovalCall({
 *   chain: calibration,
 *   approve: true,
 * }))
 *
 * console.log(request)
 * ```
 */
export function setOperatorApprovalCall(
  options: setOperatorApprovalCall.OptionsType
): setOperatorApprovalCall.OutputType {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address
  const operator = options.operator ?? chain.contracts.fwss.address

  const isCustomOperator =
    options.operator !== undefined && !isAddressEqual(options.operator, chain.contracts.fwss.address)
  if (options.approve && isCustomOperator) {
    if (
      options.rateAllowance === undefined ||
      options.lockupAllowance === undefined ||
      options.maxLockupPeriod === undefined
    ) {
      throw new ValidationError('Custom operator requires explicit rateAllowance, lockupAllowance and maxLockupPeriod')
    }
  }

  // Defaults based on approve flag
  const rateAllowance = options.rateAllowance ?? (options.approve ? maxUint256 : 0n)
  const lockupAllowance = options.lockupAllowance ?? (options.approve ? maxUint256 : 0n)
  const maxLockupPeriod = options.maxLockupPeriod ?? (options.approve ? LOCKUP_PERIOD : 0n)

  if (rateAllowance < 0n || lockupAllowance < 0n || maxLockupPeriod < 0n) {
    throw new ValidationError('Allowance or lockup period values cannot be negative')
  }

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'setOperatorApproval',
    args: [token, operator, options.approve, rateAllowance, lockupAllowance, maxLockupPeriod],
  } satisfies setOperatorApprovalCall.OutputType
}

/**
 * Extracts the OperatorApprovalUpdated event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The OperatorApprovalUpdated event
 * @throws Error if the event is not found in the logs
 */
export function extractSetOperatorApprovalEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.filecoinPay,
    logs,
    eventName: 'OperatorApprovalUpdated',
    strict: true,
  })
  if (!log) throw new Error('`OperatorApprovalUpdated` event not found.')
  return log
}
