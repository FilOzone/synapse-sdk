import type { SetRequired, Simplify } from 'type-fest'
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
import * as erc20 from '../erc20/index.ts'
import { ValidationError } from '../errors/base.ts'
import { InsufficientAllowanceError, InsufficientBalanceError } from '../errors/pay.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'

export namespace deposit {
  export type OptionsType = {
    /** The address of the ERC20 token to deposit. If not provided, the USDFC token address will be used. */
    token?: Address
    /** The recipient address for the deposit. If not provided, the sender's address will be used. */
    to?: Address
    /** The amount to deposit (in token base units). Must be greater than 0. */
    amount: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ErrorType = depositCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Deposit funds into the Filecoin Pay contract
 *
 * Deposits ERC20 tokens into the Filecoin Pay contract for the specified recipient.
 * The deposit must be approved on the token contract before calling this function.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link deposit.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link deposit.ErrorType}
 *
 * @example
 * ```ts
 * import { deposit } from '@filoz/synapse-core/pay'
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
 * // Deposit 100 USDFC to own account
 * const hash = await deposit(client, {
 *   amount: parseUnits('100', 18),
 * })
 *
 * // Deposit to another address
 * const hash2 = await deposit(client, {
 *   amount: parseUnits('50', 18),
 *   to: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(hash)
 * ```
 */
export async function deposit(client: Client<Transport, Chain, Account>, options: deposit.OptionsType): Promise<Hash> {
  const balance = await erc20.balance(client, {
    address: client.account.address,
    token: options.token,
  })

  if (balance.value < options.amount) {
    throw new InsufficientBalanceError(balance.value, options.amount)
  }

  if (balance.allowance < options.amount) {
    throw new InsufficientAllowanceError(balance.allowance, options.amount)
  }

  const { request } = await simulateContract(
    client,
    depositCall({
      chain: client.chain,
      token: options.token,
      to: options.to ?? client.account.address,
      amount: options.amount,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace depositSync {
  export type OptionsType = Simplify<deposit.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractDepositEvent>

  export type ErrorType =
    | depositCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Deposit funds into the Filecoin Pay contract and wait for confirmation
 *
 * Deposits ERC20 tokens and waits for the transaction to be confirmed.
 * Returns the receipt with the DepositRecorded event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link depositSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link depositSync.OutputType}
 * @throws Errors {@link depositSync.ErrorType}
 *
 * @example
 * ```ts
 * import { depositSync } from '@filoz/synapse-core/pay'
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
 * const { receipt, event } = await depositSync(client, {
 *   amount: parseUnits('100', 18),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Deposited amount:', event.args.amount)
 * console.log('To:', event.args.to)
 * ```
 */
export async function depositSync(
  client: Client<Transport, Chain, Account>,
  options: depositSync.OptionsType
): Promise<depositSync.OutputType> {
  const hash = await deposit(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractDepositEvent(receipt.logs)

  return { receipt, event }
}

export namespace depositCall {
  export type OptionsType = Simplify<SetRequired<deposit.OptionsType, 'to'> & ActionCallChain>
  export type ErrorType = asChain.ErrorType | ValidationError
  export type OutputType = ContractFunctionParameters<typeof paymentsAbi, 'payable', 'deposit'>
}

/**
 * Create a call to the deposit function
 *
 * This function is used to create a call to the deposit function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link depositCall.OptionsType}
 * @returns The call to the deposit function {@link depositCall.OutputType}
 * @throws Errors {@link depositCall.ErrorType}
 *
 * @example
 * ```ts
 * import { depositCall } from '@filoz/synapse-core/pay'
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
 * const { request } = await simulateContract(client, depositCall({
 *   chain: calibration,
 *   to: account.address,
 *   amount: parseUnits('100', 18),
 * }))
 *
 * console.log(request)
 * ```
 */
export function depositCall(options: depositCall.OptionsType): depositCall.OutputType {
  const chain = asChain(options.chain)
  const token = options.token ?? chain.contracts.usdfc.address

  if (options.amount <= 0n) {
    throw new ValidationError('Deposit amount must be greater than 0')
  }

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'deposit',
    args: [token, options.to, options.amount],
  } satisfies depositCall.OutputType
}

/**
 * Extracts the DepositRecorded event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The DepositRecorded event
 * @throws Error if the event is not found in the logs
 */
export function extractDepositEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.filecoinPay,
    logs,
    eventName: 'DepositRecorded',
    strict: true,
  })
  if (!log) throw new Error('`DepositRecorded` event not found.')
  return log
}
