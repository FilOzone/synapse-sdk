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

export namespace addApprovedProvider {
  export type OptionsType = {
    /** The ID of the provider to approve. */
    providerId: bigint
    /** The address of the storage contract. If not provided, the default is the storage contract address for the chain. */
    address?: Address
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
 * ```ts twoslash
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
      address: options.address,
    })
  )

  const hash = await writeContract(client, request)
  return hash
}

export namespace addApprovedProviderCall {
  export type OptionsType = {
    /** The ID of the provider to approve. */
    providerId: bigint
    /** The address of the storage contract. If not provided, the default is the storage contract address for the chain. */
    address?: Address
    /** The chain to use to add the approved provider. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'nonpayable', 'addApprovedProvider'>
}

/**
 * Create a call to the addApprovedProvider function
 *
 * This function is used to create a call to the addApprovedProvider function for use with simulateContract.
 *
 * @param options - {@link addApprovedProviderCall.OptionsType}
 * @returns The call to the addApprovedProvider function {@link addApprovedProviderCall.OutputType}
 * @throws Errors {@link addApprovedProviderCall.ErrorType}
 *
 * @example
 * ```ts twoslash
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
    abi: chain.contracts.storage.abi,
    address: options.address ?? chain.contracts.storage.address,
    functionName: 'addApprovedProvider',
    args: [options.providerId],
  } satisfies addApprovedProviderCall.OutputType
}
