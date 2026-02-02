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

export namespace removeApprovedProvider {
  export type OptionsType = {
    /** The ID of the provider to remove from approved list. Reverts if provider is not in list. */
    providerId: bigint
    /**
     * The index of the provider in the approvedProviderIds array.
     * Must match the providerId at that index (reverts on mismatch).
     * Use `getApprovedProviders` to find the correct index.
     */
    index: bigint
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = asChain.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Remove an approved provider for the client
 *
 * Removes a provider ID from the approved list using a swap-and-pop pattern.
 * After removal, the client can no longer create data sets with this provider.
 *
 * @param client - The client to use to remove the approved provider.
 * @param options - {@link removeApprovedProvider.OptionsType}
 * @returns The transaction hash {@link removeApprovedProvider.OutputType}
 * @throws Errors {@link removeApprovedProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { removeApprovedProvider, getApprovedProviders } from '@filoz/synapse-core/warm-storage'
 * import { createWalletClient, createPublicClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const walletClient = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 * const publicClient = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // First, get the list to find the index
 * const providers = await getApprovedProviders(publicClient, {
 *   client: account.address,
 * })
 * const providerId = 1n
 * const index = providers.findIndex((id) => id === providerId)
 *
 * const txHash = await removeApprovedProvider(walletClient, {
 *   providerId,
 *   index: BigInt(index),
 * })
 *
 * console.log(txHash)
 * ```
 */
export async function removeApprovedProvider(
  client: Client<Transport, Chain, Account>,
  options: removeApprovedProvider.OptionsType
): Promise<removeApprovedProvider.OutputType> {
  const { request } = await simulateContract(
    client,
    removeApprovedProviderCall({
      chain: client.chain,
      providerId: options.providerId,
      index: options.index,
      contractAddress: options.contractAddress,
    })
  )

  const hash = await writeContract(client, request)
  return hash
}

export namespace removeApprovedProviderSync {
  export type OptionsType = Simplify<removeApprovedProvider.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractRemoveApprovedProviderEvent>

  export type ErrorType =
    | removeApprovedProviderCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Remove an approved provider for the client and wait for confirmation
 *
 * Removes a provider ID from the approved list using a swap-and-pop pattern.
 * After removal, the client can no longer create data sets with this provider.
 * Waits for the transaction to be confirmed and returns the receipt with the event.
 *
 * @param client - The client to use to remove the approved provider.
 * @param options - {@link removeApprovedProviderSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link removeApprovedProviderSync.OutputType}
 * @throws Errors {@link removeApprovedProviderSync.ErrorType}
 *
 * @example
 * ```ts
 * import { removeApprovedProviderSync, getApprovedProviders } from '@filoz/synapse-core/warm-storage'
 * import { createWalletClient, createPublicClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const walletClient = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 * const publicClient = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // First, get the list to find the index
 * const providers = await getApprovedProviders(publicClient, {
 *   client: account.address,
 * })
 * const providerId = 1n
 * const index = providers.findIndex((id) => id === providerId)
 *
 * const { receipt, event } = await removeApprovedProviderSync(walletClient, {
 *   providerId,
 *   index: BigInt(index),
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Removed provider ID:', event.args.providerId)
 * ```
 */
export async function removeApprovedProviderSync(
  client: Client<Transport, Chain, Account>,
  options: removeApprovedProviderSync.OptionsType
): Promise<removeApprovedProviderSync.OutputType> {
  const hash = await removeApprovedProvider(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractRemoveApprovedProviderEvent(receipt.logs)

  return { receipt, event }
}

export namespace removeApprovedProviderCall {
  export type OptionsType = Simplify<removeApprovedProvider.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'nonpayable', 'removeApprovedProvider'>
}

/**
 * Create a call to the removeApprovedProvider function
 *
 * This function is used to create a call to the removeApprovedProvider function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link removeApprovedProviderCall.OptionsType}
 * @returns The call to the removeApprovedProvider function {@link removeApprovedProviderCall.OutputType}
 * @throws Errors {@link removeApprovedProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { removeApprovedProviderCall, getApprovedProvidersCall } from '@filoz/synapse-core/warm-storage'
 * import { createWalletClient, createPublicClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { simulateContract, writeContract, readContract } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const walletClient = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 * const publicClient = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // First, get the list to find the index
 * const providers = await readContract(publicClient, getApprovedProvidersCall({
 *   chain: calibration,
 *   client: account.address,
 * }))
 * const providerId = 1n
 * const index = providers.findIndex((id) => id === providerId)
 *
 * const { request } = await simulateContract(walletClient, removeApprovedProviderCall({
 *   chain: calibration,
 *   providerId,
 *   index: BigInt(index),
 * }))
 *
 * const hash = await writeContract(walletClient, request)
 * console.log(hash)
 * ```
 */
export function removeApprovedProviderCall(options: removeApprovedProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwss.abi,
    address: options.contractAddress ?? chain.contracts.fwss.address,
    functionName: 'removeApprovedProvider',
    args: [options.providerId, options.index],
  } satisfies removeApprovedProviderCall.OutputType
}

/**
 * Extracts the ProviderUnapproved event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProviderUnapproved event
 * @throws Error if the event is not found in the logs
 */
export function extractRemoveApprovedProviderEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.fwss,
    logs,
    eventName: 'ProviderUnapproved',
    strict: true,
  })
  if (!log) throw new Error('`ProviderUnapproved` event not found.')
  return log
}
