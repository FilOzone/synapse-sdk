import type {
  Account,
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  Hash,
  SimulateContractErrorType,
  Transport,
  WriteContractErrorType,
} from 'viem'
import { simulateContract, writeContract } from 'viem/actions'
import type { storage as storageAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'

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
    /** The address of the storage contract. If not provided, the default is the storage contract address for the chain. */
    address?: Address
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
 * ```ts twoslash
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
      address: options.address,
    })
  )

  const hash = await writeContract(client, request)
  return hash
}

export namespace removeApprovedProviderCall {
  export type OptionsType = {
    /** The ID of the provider to remove from approved list. Reverts if provider is not in list. */
    providerId: bigint
    /**
     * The index of the provider in the approvedProviderIds array.
     * Must match the providerId at that index (reverts on mismatch).
     * Use `getApprovedProviders` to find the correct index.
     */
    index: bigint
    /** The address of the storage contract. If not provided, the default is the storage contract address for the chain. */
    address?: Address
    /** The chain to use to remove the approved provider. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'nonpayable', 'removeApprovedProvider'>
}

/**
 * Create a call to the removeApprovedProvider function
 *
 * This function is used to create a call to the removeApprovedProvider function for use with simulateContract.
 *
 * @param options - {@link removeApprovedProviderCall.OptionsType}
 * @returns The call to the removeApprovedProvider function {@link removeApprovedProviderCall.OutputType}
 * @throws Errors {@link removeApprovedProviderCall.ErrorType}
 *
 * @example
 * ```ts twoslash
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
    abi: chain.contracts.storage.abi,
    address: options.address ?? chain.contracts.storage.address,
    functionName: 'removeApprovedProvider',
    args: [options.providerId, options.index],
  } satisfies removeApprovedProviderCall.OutputType
}
