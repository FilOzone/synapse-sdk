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
import { erc20Abi, parseEventLogs } from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import { asChain } from '../chains.ts'
import { AllowanceAmountError } from '../errors/erc20.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'

export namespace approve {
  export type OptionsType = {
    /** The address of the ERC20 token to approve. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The amount to approve (in token base units). */
    amount: bigint
    /** The address of the spender to approve. If not provided, the Filecoin Pay contract address will be used. */
    spender?: Address
  }

  export type ErrorType = approveCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
  export type OutputType = Hash
}

/**
 * Approve an ERC20 token allowance
 *
 * Approves a spender to transfer tokens on behalf of the caller up to the specified amount.
 * This is required before depositing tokens into the Filecoin Pay contract or allowing operators
 * to manage payment rails.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link approve.OptionsType}
 * @returns The transaction hash {@link approve.OutputType}
 * @throws Errors {@link approve.ErrorType}
 *
 * @example
 * ```ts
 * import { approve } from '@filoz/synapse-core/erc20'
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
 * // Approve Filecoin Pay contract to spend 100 USDFC
 * const hash = await approve(client, {
 *   amount: parseUnits('100', 18),
 * })
 *
 * // Approve custom spender
 * const hash2 = await approve(client, {
 *   amount: parseUnits('50', 18),
 *   spender: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(hash)
 * ```
 */
export async function approve(
  client: Client<Transport, Chain, Account>,
  options: approve.OptionsType
): Promise<approve.OutputType> {
  const { request } = await simulateContract(
    client,
    approveCall({
      chain: client.chain,
      token: options.token,
      spender: options.spender,
      amount: options.amount,
    })
  )

  return writeContract(client, request)
}

export namespace approveSync {
  export type OptionsType = Simplify<approve.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractApproveEvent>

  export type ErrorType =
    | approveCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Approve an ERC20 token allowance and wait for confirmation
 *
 * Approves a spender to transfer tokens and waits for the transaction to be confirmed.
 * Returns the receipt with the Approval event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link approveSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link approveSync.OutputType}
 * @throws Errors {@link approveSync.ErrorType}
 *
 * @example
 * ```ts
 * import { approveSync } from '@filoz/synapse-core/erc20'
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
 * const { receipt, event } = await approveSync(client, {
 *   amount: parseUnits('100', 18),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Approved amount:', event.args.value)
 * console.log('Spender:', event.args.spender)
 * ```
 */
export async function approveSync(
  client: Client<Transport, Chain, Account>,
  options: approveSync.OptionsType
): Promise<approveSync.OutputType> {
  const hash = await approve(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractApproveEvent(receipt.logs)

  return { receipt, event }
}

export namespace approveCall {
  export type OptionsType = Simplify<approve.OptionsType & ActionCallChain>

  export type ErrorType = asChain.ErrorType | AllowanceAmountError
  export type OutputType = ContractFunctionParameters<typeof erc20Abi, 'nonpayable', 'approve'>
}

/**
 * Create a call to the approve function
 *
 * This function is used to create a call to the approve function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link approveCall.OptionsType}
 * @returns The call to the approve function {@link approveCall.OutputType}
 * @throws Errors {@link approveCall.ErrorType}
 *
 * @example
 * ```ts
 * import { approveCall } from '@filoz/synapse-core/erc20'
 * import { createWalletClient, http, parseUnits } from 'viem'
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
 * const { request } = await simulateContract(client, approveCall({
 *   chain: calibration,
 *   amount: parseUnits('100', 18),
 * }))
 *
 * console.log(request)
 * ```
 */
export function approveCall(options: approveCall.OptionsType): approveCall.OutputType {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address
  const spender = options.spender ?? chain.contracts.filecoinPay.address

  if (options.amount < 0n) {
    throw new AllowanceAmountError(options.amount)
  }

  return {
    abi: erc20Abi,
    address: token,
    functionName: 'approve',
    args: [spender, options.amount],
  } satisfies approveCall.OutputType
}

/**
 * Extracts the Approval event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The Approval event
 * @throws Error if the event is not found in the logs
 */
export function extractApproveEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: erc20Abi,
    logs,
    eventName: 'Approval',
    strict: true,
  })
  if (!log) throw new Error('`Approval` event not found.')
  return log
}
