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
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import * as Abis from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace removeProvider {
  export type OptionsType = {
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = removeProviderCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Remove a service provider from the Service Provider Registry
 *
 * Removes the calling provider from the registry. Only the provider themselves
 * can remove their own registration.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link removeProvider.OptionsType}
 * @returns The transaction hash {@link removeProvider.OutputType}
 * @throws Errors {@link removeProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProvider } from '@filoz/synapse-core/sp-registry'
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
 * const hash = await removeProvider(client, {})
 *
 * console.log(hash)
 * ```
 */
export async function removeProvider(
  client: Client<Transport, Chain, Account>,
  options: removeProvider.OptionsType = {}
): Promise<removeProvider.OutputType> {
  const { request } = await simulateContract(
    client,
    removeProviderCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace removeProviderSync {
  export type OptionsType = removeProvider.OptionsType & {
    /** Callback function called with the transaction hash before waiting for the receipt. */
    onHash?: (hash: Hash) => void
  }

  export type OutputType = {
    /** The transaction receipt */
    receipt: Awaited<ReturnType<typeof waitForTransactionReceipt>>
    /** The extracted ProviderRemoved event */
    event: ReturnType<typeof extractRemoveProviderEvent>
  }

  export type ErrorType =
    | removeProviderCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Remove a service provider and wait for confirmation
 *
 * Removes the calling provider from the registry and waits for the transaction
 * to be confirmed. Returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link removeProviderSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link removeProviderSync.OutputType}
 * @throws Errors {@link removeProviderSync.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProviderSync } from '@filoz/synapse-core/sp-registry'
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
 * const { receipt, event } = await removeProviderSync(client, {
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Removed provider ID:', event.args.providerId)
 * ```
 */
export async function removeProviderSync(
  client: Client<Transport, Chain, Account>,
  options: removeProviderSync.OptionsType = {}
): Promise<removeProviderSync.OutputType> {
  const hash = await removeProvider(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractRemoveProviderEvent(receipt.logs)

  return { receipt, event }
}

export namespace removeProviderCall {
  export type OptionsType = Simplify<
    removeProvider.OptionsType & {
      /** The chain to use for the contract call. */
      chain: Chain
    }
  >

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof serviceProviderRegistryAbi, 'nonpayable', 'removeProvider'>
}

/**
 * Create a call to the removeProvider function
 *
 * This function is used to create a call to the removeProvider function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link removeProviderCall.OptionsType}
 * @returns The call to the removeProvider function {@link removeProviderCall.OutputType}
 * @throws Errors {@link removeProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProviderCall } from '@filoz/synapse-core/sp-registry'
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
 * const { request } = await simulateContract(client, removeProviderCall({
 *   chain: calibration,
 * }))
 *
 * console.log(request)
 * ```
 */
export function removeProviderCall(options: removeProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'removeProvider',
    args: [],
  } satisfies removeProviderCall.OutputType
}

/**
 * Extracts the ProviderRemoved event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProviderRemoved event
 * @throws Error if the event is not found in the logs
 */
export function extractRemoveProviderEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProviderRemoved',
    strict: true,
  })
  if (!log) throw new Error('`ProviderRemoved` event not found.')
  return log
}
