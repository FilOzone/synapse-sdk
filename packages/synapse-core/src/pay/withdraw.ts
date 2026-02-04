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
import { parseEventLogs } from 'viem'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import type { filecoinPay as paymentsAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import { InsufficientAvailableFundsError } from '../errors/pay.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'
import { accounts } from './accounts.ts'

export namespace withdraw {
  export type OptionsType = {
    /** The address of the ERC20 token to withdraw. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The amount to withdraw (in token base units). Must be greater than 0. */
    amount: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ErrorType = withdrawCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Withdraw funds from the Filecoin Pay contract
 *
 * Withdraws ERC20 tokens from the payments contract to the caller's address.
 * The withdrawal amount must not exceed available funds (deposited funds minus locked funds).
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link withdraw.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link withdraw.ErrorType}
 *
 * @example
 * ```ts
 * import { withdraw } from '@filoz/synapse-core/pay'
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
 * // Withdraw 100 USDFC to own account
 * const hash = await withdraw(client, {
 *   amount: parseUnits('100', 18),
 * })
 *
 * console.log(hash)
 * ```
 */
export async function withdraw(
  client: Client<Transport, Chain, Account>,
  options: withdraw.OptionsType
): Promise<Hash> {
  const account = await accounts(client, {
    address: client.account.address,
    token: options.token,
    contractAddress: options.contractAddress,
  })

  if (account.availableFunds < options.amount) {
    throw new InsufficientAvailableFundsError(account.availableFunds, options.amount)
  }
  const { request } = await simulateContract(
    client,
    withdrawCall({
      chain: client.chain,
      token: options.token,
      amount: options.amount,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace withdrawSync {
  export type OptionsType = Simplify<withdraw.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractWithdrawEvent>

  export type ErrorType =
    | withdrawCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Withdraw funds from the Filecoin Pay contract and wait for confirmation
 *
 * Withdraws ERC20 tokens and waits for the transaction to be confirmed.
 * Returns the receipt with the WithdrawRecorded event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link withdrawSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link withdrawSync.OutputType}
 * @throws Errors {@link withdrawSync.ErrorType}
 *
 * @example
 * ```ts
 * import { withdrawSync } from '@filoz/synapse-core/pay'
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
 * const { receipt, event } = await withdrawSync(client, {
 *   amount: parseUnits('100', 18),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Withdrawn amount:', event.args.amount)
 * console.log('To:', event.args.to)
 * ```
 */
export async function withdrawSync(
  client: Client<Transport, Chain, Account>,
  options: withdrawSync.OptionsType
): Promise<withdrawSync.OutputType> {
  const hash = await withdraw(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractWithdrawEvent(receipt.logs)

  return { receipt, event }
}

export namespace withdrawCall {
  export type OptionsType = Simplify<withdraw.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType | ValidationError
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'nonpayable', 'withdraw'>
}

/**
 * Create a call to the withdraw function
 *
 * This function is used to create a call to the withdraw function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link withdrawCall.OptionsType}
 * @returns The call to the withdraw function {@link withdrawCall.OutputType}
 * @throws Errors {@link withdrawCall.ErrorType}
 *
 * @example
 * ```ts
 * import { withdrawCall } from '@filoz/synapse-core/pay'
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
 * const { request } = await simulateContract(client, withdrawCall({
 *   chain: calibration,
 *   amount: parseUnits('100', 18),
 * }))
 *
 * console.log(request)
 * ```
 */
export function withdrawCall(options: withdrawCall.OptionsType): withdrawCall.OutputType {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address

  if (options.amount <= 0n) {
    throw new ValidationError('Withdraw amount must be greater than 0')
  }

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'withdraw',
    args: [token, options.amount],
  } satisfies withdrawCall.OutputType
}

/**
 * Extracts the WithdrawRecorded event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The WithdrawRecorded event
 * @throws Error if the event is not found in the logs
 */
export function extractWithdrawEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.filecoinPay,
    logs,
    eventName: 'WithdrawRecorded',
    strict: true,
  })
  if (!log) throw new Error('`WithdrawRecorded` event not found.')
  return log
}
