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
import type { ActionCallChain, ActionSyncCallback, ActionSyncOutput } from '../types.ts'

export namespace removeProduct {
  export type OptionsType = {
    /** The product type to remove (0 for PDP). Defaults to 0. */
    productType?: number
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = removeProductCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Remove a product from the service provider
 *
 * Removes a product (e.g., PDP) from the calling provider's offerings.
 * Only the provider themselves can remove their own products.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link removeProduct.OptionsType}
 * @returns The transaction hash {@link removeProduct.OutputType}
 * @throws Errors {@link removeProduct.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProduct } from '@filoz/synapse-core/sp-registry'
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
 * const hash = await removeProduct(client, {
 *   productType: 0,
 * })
 *
 * console.log(hash)
 * ```
 */
export async function removeProduct(
  client: Client<Transport, Chain, Account>,
  options: removeProduct.OptionsType = {}
): Promise<removeProduct.OutputType> {
  const { request } = await simulateContract(
    client,
    removeProductCall({
      chain: client.chain,
      productType: options.productType,
      contractAddress: options.contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace removeProductSync {
  export type OptionsType = Simplify<removeProduct.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractRemoveProductEvent>

  export type ErrorType =
    | removeProductCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Remove a product from the service provider and wait for confirmation
 *
 * Removes a product from the calling provider's offerings and waits for the
 * transaction to be confirmed. Returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link removeProductSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link removeProductSync.OutputType}
 * @throws Errors {@link removeProductSync.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProductSync } from '@filoz/synapse-core/sp-registry'
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
 * const { receipt, event } = await removeProductSync(client, {
 *   productType: 0,
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Removed provider ID:', event.args.providerId)
 * console.log('Removed product type:', event.args.productType)
 * ```
 */
export async function removeProductSync(
  client: Client<Transport, Chain, Account>,
  options: removeProductSync.OptionsType = {}
): Promise<removeProductSync.OutputType> {
  const hash = await removeProduct(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractRemoveProductEvent(receipt.logs)

  return { receipt, event }
}

export namespace removeProductCall {
  export type OptionsType = Simplify<removeProduct.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof serviceProviderRegistryAbi, 'nonpayable', 'removeProduct'>
}

/**
 * Create a call to the removeProduct function
 *
 * This function is used to create a call to the removeProduct function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link removeProductCall.OptionsType}
 * @returns The call to the removeProduct function {@link removeProductCall.OutputType}
 * @throws Errors {@link removeProductCall.ErrorType}
 *
 * @example
 * ```ts
 * import { removeProductCall } from '@filoz/synapse-core/sp-registry'
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
 * const { request } = await simulateContract(client, removeProductCall({
 *   chain: calibration,
 * }))
 *
 * console.log(request)
 * ```
 */
export function removeProductCall(options: removeProductCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'removeProduct',
    args: [options.productType ?? 0],
  } satisfies removeProductCall.OutputType
}

/**
 * Extracts the ProductRemoved event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProductRemoved event
 * @throws Error if the event is not found in the logs
 */
export function extractRemoveProductEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProductRemoved',
    strict: true,
  })
  if (!log) throw new Error('`ProductRemoved` event not found.')
  return log
}
