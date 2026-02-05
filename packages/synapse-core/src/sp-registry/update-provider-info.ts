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

export namespace updateProviderInfo {
  export type OptionsType = {
    /** The name of the service provider */
    name: string
    /** The description of the service provider */
    description: string
    /** Service provider registry contract address. If not provided, the default is the registry contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Hash

  export type ErrorType = updateProviderInfoCall.ErrorType | SimulateContractErrorType | WriteContractErrorType
}

/**
 * Update provider information in the Service Provider Registry
 *
 * Updates the name and description for the calling provider. Only the provider
 * themselves can update their own information.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link updateProviderInfo.OptionsType}
 * @returns The transaction hash {@link updateProviderInfo.OutputType}
 * @throws Errors {@link updateProviderInfo.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProviderInfo } from '@filoz/synapse-core/sp-registry'
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
 * const hash = await updateProviderInfo(client, {
 *   name: 'Updated Provider Name',
 *   description: 'Updated provider description',
 * })
 *
 * console.log(hash)
 * ```
 */
export async function updateProviderInfo(
  client: Client<Transport, Chain, Account>,
  options: updateProviderInfo.OptionsType
): Promise<updateProviderInfo.OutputType> {
  const chain = asChain(client.chain)
  const contractAddress = options.contractAddress ?? chain.contracts.serviceProviderRegistry.address

  const { request } = await simulateContract(
    client,
    updateProviderInfoCall({
      chain: client.chain,
      name: options.name,
      description: options.description,
      contractAddress,
    })
  )

  return writeContract(client, request)
}

export namespace updateProviderInfoSync {
  export type OptionsType = Simplify<updateProviderInfo.OptionsType & ActionSyncCallback>
  export type OutputType = ActionSyncOutput<typeof extractUpdateProviderInfoEvent>

  export type ErrorType =
    | updateProviderInfoCall.ErrorType
    | SimulateContractErrorType
    | WriteContractErrorType
    | WaitForTransactionReceiptErrorType
}

/**
 * Update provider information and wait for confirmation
 *
 * Updates the name and description for the calling provider and waits for
 * the transaction to be confirmed. Returns the receipt with the event.
 *
 * @param client - The viem client with account to use for the transaction.
 * @param options - {@link updateProviderInfoSync.OptionsType}
 * @returns The transaction receipt and extracted event {@link updateProviderInfoSync.OutputType}
 * @throws Errors {@link updateProviderInfoSync.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProviderInfoSync } from '@filoz/synapse-core/sp-registry'
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
 * const { receipt, event } = await updateProviderInfoSync(client, {
 *   name: 'Updated Provider Name',
 *   description: 'Updated provider description',
 *   onHash: (hash) => console.log('Transaction sent:', hash),
 * })
 *
 * console.log('Provider ID:', event.args.providerId)
 * ```
 */
export async function updateProviderInfoSync(
  client: Client<Transport, Chain, Account>,
  options: updateProviderInfoSync.OptionsType
): Promise<updateProviderInfoSync.OutputType> {
  const hash = await updateProviderInfo(client, options)

  if (options.onHash) {
    options.onHash(hash)
  }

  const receipt = await waitForTransactionReceipt(client, { hash })
  const event = extractUpdateProviderInfoEvent(receipt.logs)

  return { receipt, event }
}

export namespace updateProviderInfoCall {
  export type OptionsType = Simplify<updateProviderInfo.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'nonpayable',
    'updateProviderInfo'
  >
}

/**
 * Create a call to the updateProviderInfo function
 *
 * This function is used to create a call to the updateProviderInfo function for use with
 * sendCalls, sendTransaction, multicall, estimateContractGas, or simulateContract.
 *
 * @param options - {@link updateProviderInfoCall.OptionsType}
 * @returns The call to the updateProviderInfo function {@link updateProviderInfoCall.OutputType}
 * @throws Errors {@link updateProviderInfoCall.ErrorType}
 *
 * @example
 * ```ts
 * import { updateProviderInfoCall } from '@filoz/synapse-core/sp-registry'
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
 * const { request } = await simulateContract(client, updateProviderInfoCall({
 *   chain: calibration,
 *   name: 'Updated Provider Name',
 *   description: 'Updated provider description',
 * }))
 *
 * console.log(request)
 * ```
 */
export function updateProviderInfoCall(options: updateProviderInfoCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'updateProviderInfo',
    args: [options.name, options.description],
  } satisfies updateProviderInfoCall.OutputType
}

/**
 * Extracts the ProviderInfoUpdated event from transaction logs
 *
 * @param logs - The transaction logs
 * @returns The ProviderInfoUpdated event
 * @throws Error if the event is not found in the logs
 */
export function extractUpdateProviderInfoEvent(logs: Log[]) {
  const [log] = parseEventLogs({
    abi: Abis.serviceProviderRegistry,
    logs,
    eventName: 'ProviderInfoUpdated',
    strict: true,
  })
  if (!log) throw new Error('`ProviderInfoUpdated` event not found.')
  return log
}
