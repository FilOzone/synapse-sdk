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
import type { fwss as storageAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'

export namespace addApprovedProvider {
  export type OptionsType = {
    /** The ID of the provider to approve. */
    providerId: bigint
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = asChain.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Add an approved provider for the client
 *
 * This function approves a provider so that the client can create data sets with them.
 *
 * @param client - The client to use to add the approved provider.
 * @param options - {@link addApprovedProvider.OptionsType}
 * @returns The transaction hash {@link addApprovedProvider.OutputType}
 * @throws Errors {@link addApprovedProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { addApprovedProvider } from '@filoz/synapse-core/warm-storage'
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
 * const txHash = await addApprovedProvider(client, {
 *   providerId: 1n,
 * })
 *
 * console.log(txHash)
 * ```
 */
export async function addApprovedProvider(
  client: Client<Transport, Chain, Account>,
  options: addApprovedProvider.OptionsType
): Promise<addApprovedProvider.OutputType> {
  const { request } = await simulateContract(
    client,
    addApprovedProviderCall({
      chain: client.chain,
      providerId: options.providerId,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace addApprovedProviderSync {
  export type OptionsType = Simplify<addApprovedProvider.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractAddApprovedProviderEvent>
  export type ErrorType =
    | addApprovedProviderCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Add an approved provider for the client and wait for confirmation
 *
 * This function approves a provider so that the client can create data sets with them.
 * Waits for the transaction to be confirmed and returns the receipt with the event.
 *
 * @param client - The client to use to add the approved provider.
 * @param options - {@link addApprovedProviderSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link addApprovedProviderSync.OutputType}
 * @throws Errors {@link addApprovedProviderSync.ErrorType}
 *
 * @example
 * ```ts
 * import { addApprovedProviderSync } from '@filoz/synapse-core/warm-storage'
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
 * const { receipt, event } = await addApprovedProviderSync(client, {
 *   providerId: 1n,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Provider ID:', event.args.providerId)
 * ```
 */
export async function addApprovedProviderSync(
  client: Client<Transport, Chain, Account>,
  options: addApprovedProviderSync.OptionsType
): Promise<addApprovedProviderSync.OutputType> {
  const hash = await addApprovedProvider(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractAddApprovedProviderEvent(receipt.logs)

  return { receipt, event }
}

export namespace addApprovedProviderCall {
  export type OptionsType = Simplify<addApprovedProvider.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'nonpayable', 'addApprovedProvider'>
}

/**
 * Create a call to the addApprovedProvider function
 *
 * This function is used to create a call to the addApprovedProvider function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link addApprovedProviderCall.OptionsType}
 * @returns The call to the addApprovedProvider function {@link addApprovedProviderCall.OutputType}
 * @throws Errors {@link addApprovedProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { addApprovedProviderCall } from '@filoz/synapse-core/warm-storage'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract, writeContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { request } = await simulateContract(client, addApprovedProviderCall({
 *   chain: calibration,
 *   providerId: 1n,
 * }))
 *
 * const hash = await writeContract(client, request)
 * console.log(hash)
 * ```
 */
export function addApprovedProviderCall(options: addApprovedProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwss.abi,
    address: options.contractAddress ?? chain.contracts.fwss.address,
    functionName: 'addApprovedProvider',
    args: [options.providerId],
  } satisfies addApprovedProviderCall.OutputType
}

/**
 * Extracts the ProviderApproved event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProviderApproved event
 * @throws Error if the event is not found in the logs
 */
export function extractAddApprovedProviderEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.fwss,
    logs,
    eventName: 'ProviderApproved',
    strict: true,
  })
  if (!log) throw new Error('`ProviderApproved` event not found.')
  return log
}
