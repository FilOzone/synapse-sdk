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

export namespace settleTerminatedRailWithoutValidation {
  export type OptionsType = {
    /** The rail ID to settle */
    railId: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type ErrorType =
    | settleTerminatedRailWithoutValidationCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
}

/**
 * Settle a terminated payment rail without validation
 *
 * Emergency settlement for terminated rails only - bypasses service contract validation.
 * This ensures payment even if the validator contract is buggy or unresponsive (pays in full).
 * Can only be called by the client after the max settlement epoch has passed.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link settleTerminatedRailWithoutValidation.OptionsType}
 * @returns The transaction hash
 * @throws Errors {@link settleTerminatedRailWithoutValidation.ErrorType}
 *
 * @example
 * ```ts
 * import { settleTerminatedRailWithoutValidation } from '@filoz/synapse-core/pay'
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
 * // Settle terminated rail
 * const hash = await settleTerminatedRailWithoutValidation(client, {
 *   railId: 1n,
 * })
 *
 * console.log(hash)
 * ```
 */
export async function settleTerminatedRailWithoutValidation(
  client: Client<Transport, Chain, Account>,
  options: settleTerminatedRailWithoutValidation.OptionsType
): Promise<Hash> {
  const { request } = await simulateContract(
    client,
    settleTerminatedRailWithoutValidationCall({
      chain: client.chain,
      railId: options.railId,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace settleTerminatedRailWithoutValidationSync {
  export type OptionsType = settleTerminatedRailWithoutValidation.OptionsType & {
    /** Callback function called with the transaction hash before waiting for the receipt. */
    onHash?: (hash: Hash) => void
  }

  export type OutputType = {
    /** The transaction receipt */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>>
    /** The extracted RailSettled event */
    event: ReturnType<typeof extractSettleTerminatedRailWithoutValidationEvent>
  }

  export type ErrorType =
    | settleTerminatedRailWithoutValidationCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Settle a terminated payment rail without validation and wait for confirmation
 *
 * Emergency settlement for terminated rails and waits for the transaction to be confirmed.
 * Returns the receipt with the RailSettled event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link settleTerminatedRailWithoutValidationSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link settleTerminatedRailWithoutValidationSync.OutputType}
 * @throws Errors {@link settleTerminatedRailWithoutValidationSync.ErrorType}
 *
 * @example
 * ```ts
 * import { settleTerminatedRailWithoutValidationSync } from '@filoz/synapse-core/pay'
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
 * const { receipt, event } = await settleTerminatedRailWithoutValidationSync(client, {
 *   railId: 1n,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Total settled amount:', event.args.totalSettledAmount)
 * console.log('Settled up to epoch:', event.args.settledUpTo)
 * ```
 */
export async function settleTerminatedRailWithoutValidationSync(
  client: Client<Transport, Chain, Account>,
  options: settleTerminatedRailWithoutValidationSync.OptionsType
): Promise<settleTerminatedRailWithoutValidationSync.OutputType> {
  const hash = await settleTerminatedRailWithoutValidation(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractSettleTerminatedRailWithoutValidationEvent(receipt.logs)

  return { receipt, event }
}

export namespace settleTerminatedRailWithoutValidationCall {
  export type OptionsType = {
    /** The rail ID to settle */
    railId: bigint
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
    /** The chain to use for the contract call. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof paymentsAbi,
    'nonpayable',
    'settleTerminatedRailWithoutValidation'
  >
}

/**
 * Create a call to the settleTerminatedRailWithoutValidation function
 *
 * This function is used to create a call to the settleTerminatedRailWithoutValidation function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link settleTerminatedRailWithoutValidationCall.OptionsType}
 * @returns The call to the settleTerminatedRailWithoutValidation function {@link settleTerminatedRailWithoutValidationCall.OutputType}
 * @throws Errors {@link settleTerminatedRailWithoutValidationCall.ErrorType}
 *
 * @example
 * ```ts
 * import { settleTerminatedRailWithoutValidationCall } from '@filoz/synapse-core/pay'
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
 * const { request } = await simulateContract(client, settleTerminatedRailWithoutValidationCall({
 *   chain: calibration,
 *   railId: 1n,
 * }))
 *
 * console.log(request)
 * ```
 */
export function settleTerminatedRailWithoutValidationCall(
  options: settleTerminatedRailWithoutValidationCall.OptionsType
): settleTerminatedRailWithoutValidationCall.OutputType {
  const chain = asChain(options.chain)

  return {
    abi: chain.contracts.filecoinPay.abi,
    address: options.contractAddress ?? chain.contracts.filecoinPay.address,
    functionName: 'settleTerminatedRailWithoutValidation',
    args: [options.railId],
  } satisfies settleTerminatedRailWithoutValidationCall.OutputType
}

/**
 * Extracts the RailSettled event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The RailSettled event
 * @throws Error if the event is not found in the logs
 */
export function extractSettleTerminatedRailWithoutValidationEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.filecoinPay,
    logs,
    eventName: 'RailSettled',
    strict: true,
  })
  if (!log) throw new Error('`RailSettled` event not found.')
  return log
}
